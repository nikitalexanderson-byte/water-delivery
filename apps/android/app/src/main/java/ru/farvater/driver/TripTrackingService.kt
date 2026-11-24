package ru.farvater.driver

import android.Manifest
import android.annotation.SuppressLint
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.content.pm.ServiceInfo
import android.graphics.drawable.Icon
import android.location.Location
import android.location.LocationListener
import android.location.LocationManager
import android.os.Build
import android.os.IBinder
import android.os.Looper
import android.os.SystemClock
import java.io.IOException
import java.time.Instant
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow

internal data class TrackingFix(val point: DeviceFix, val bearing: Float?, val time: Long) {
    fun mapJson() = point.json().put("bearing", bearing ?: org.json.JSONObject.NULL)
    fun sampleJson() = mapJson().put("observed_at", Instant.ofEpochMilli(time).toString())
}

internal data class TrackingState(val tripId: Int? = null, val fix: TrackingFix? = null, val note: String? = null)

internal fun positionAllowed(context: Context) = listOf(Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION)
    .any { context.checkSelfPermission(it) == PackageManager.PERMISSION_GRANTED }

internal class TripTrackingService : Service() {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    private val api = DriverApi()
    private var upload: Job? = null
    private var stopJob: Job? = null
    private var token = ""
    private var tripId = 0
    private var lastFix: TrackingFix? = null
    private val manager by lazy { getSystemService(LocationManager::class.java) }
    private val listener = LocationListener { location -> receive(location) }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (intent?.action == STOP) {
            stopSharing()
        } else if (upload == null && stopJob == null) {
            tripId = intent?.getIntExtra("trip", 0) ?: 0
            val session = runCatching { SecureStore(this).get("session:${BuildConfig.API_URL}") }.getOrNull()
            token = session?.optString("token").orEmpty()
            if (tripId > 0 && token.isNotEmpty() && positionAllowed(this)) startSharing() else stopSelf()
        }
        return START_NOT_STICKY
    }

    @SuppressLint("MissingPermission")
    private fun startSharing() {
        val outcome = runCatching {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                startForeground(NOTIFICATION, notification(), ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION)
            } else startForeground(NOTIFICATION, notification())
            val providers = listOf(LocationManager.GPS_PROVIDER, LocationManager.NETWORK_PROVIDER)
            var subscribed = false
            for (provider in providers) {
                if (runCatching {
                    if (!manager.isProviderEnabled(provider)) return@runCatching false
                    manager.requestLocationUpdates(provider, 5_000L, 0f, listener, Looper.getMainLooper())
                    true
                }.getOrDefault(false)) subscribed = true
            }
            check(subscribed)
        }
        if (outcome.isFailure) {
            publish(TrackingState(note = "Проверьте разрешение и включите геолокацию устройства."))
            stopSelf()
            return
        }
        publish(TrackingState(tripId, note = "Ждём геопозицию устройства…"))
        upload = scope.launch {
            var sentTime = 0L
            while (isActive) {
                val fix = lastFix
                if (fix != null && fix.time > sentTime && fix.point.ageSeconds(SystemClock.elapsedRealtime()) < 35) {
                    try {
                        api.call("trips/$tripId/location", token, fix.sampleJson(), readTimeoutMs = 7_000)
                        sentTime = fix.time
                        publish(TrackingState(tripId, lastFix, "Геопозиция передаётся команде"))
                    } catch (error: ApiError) {
                        if (error.status in setOf(401, 403, 404, 409)) {
                            stopSelf()
                            break
                        }
                        if (error.status == 400) sentTime = fix.time
                        publish(TrackingState(tripId, lastFix, error.message))
                    } catch (_: IOException) {
                        publish(TrackingState(tripId, lastFix, "Нет связи. Повторяем отправку…"))
                    }
                } else if (fix != null && fix.point.ageSeconds(SystemClock.elapsedRealtime()) >= 35) {
                    publish(TrackingState(tripId, fix, "Новых координат пока нет"))
                }
                delay(8_000L)
            }
        }
    }

    private fun receive(location: Location) {
        if (stopJob != null || !location.hasAccuracy()) return
        val point = DeviceFix(location.latitude, location.longitude, location.accuracy, location.elapsedRealtimeNanos / 1_000_000)
        if (point.accuracy > 10_000 || !usableFix(point.lat, point.lon, point.accuracy, point.elapsed, SystemClock.elapsedRealtime()) ||
            point.elapsed <= (lastFix?.point?.elapsed ?: 0L)) return
        val bearing = location.bearing.takeIf { location.hasBearing() && (!location.hasSpeed() || location.speed >= 1f) && it in 0f..<360f }
        val fix = TrackingFix(point, bearing, location.time)
        lastFix = fix
        publish(state.value.copy(fix = fix))
    }

    private fun stopSharing() {
        if (stopJob != null) return
        val pending = upload
        pending?.cancel()
        manager.removeUpdates(listener)
        publish(TrackingState())
        stopJob = scope.launch {
            pending?.join()
            if (tripId > 0 && token.isNotEmpty()) runCatching {
                api.call("trips/$tripId/location", token, json("stop" to true), readTimeoutMs = 5_000)
            }
            stopSelf()
        }
    }

    private fun notification(): Notification {
        val notifications = getSystemService(NotificationManager::class.java)
        notifications.createNotificationChannel(NotificationChannel(CHANNEL, "Геопозиция на рейсе", NotificationManager.IMPORTANCE_LOW))
        val open = PendingIntent.getActivity(this, NOTIFICATION, Intent(this, MainActivity::class.java), PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
        val stop = PendingIntent.getService(this, NOTIFICATION, Intent(this, TripTrackingService::class.java).setAction(STOP), PendingIntent.FLAG_IMMUTABLE)
        return Notification.Builder(this, CHANNEL).setSmallIcon(R.drawable.wayslate_mark)
            .setContentTitle("Геопозиция на рейсе").setContentText("Оператор и администратор видят ход рейса.")
            .setOnlyAlertOnce(true).setOngoing(true).setContentIntent(open)
            .addAction(Notification.Action.Builder(Icon.createWithResource(this, R.drawable.wayslate_mark), "Остановить", stop).build()).build()
    }

    override fun onDestroy() {
        scope.cancel()
        manager.removeUpdates(listener)
        if (state.value.tripId == tripId) publish(TrackingState())
        super.onDestroy()
    }

    companion object {
        private const val STOP = "ru.farvater.driver.STOP_TRACKING"
        private const val CHANNEL = "trip_tracking"
        private const val NOTIFICATION = 8421
        private val shared = MutableStateFlow(TrackingState())
        val state = shared.asStateFlow()
        private fun publish(value: TrackingState) { shared.value = value }

        fun start(context: Context, trip: Int) {
            context.startForegroundService(Intent(context, TripTrackingService::class.java).putExtra("trip", trip))
        }

        fun stop(context: Context) {
            if (state.value.tripId != null) context.startService(Intent(context, TripTrackingService::class.java).setAction(STOP))
        }

        fun end(context: Context, trip: Int? = null) {
            if (trip == null || state.value.tripId == trip) context.stopService(Intent(context, TripTrackingService::class.java))
        }
    }
}
