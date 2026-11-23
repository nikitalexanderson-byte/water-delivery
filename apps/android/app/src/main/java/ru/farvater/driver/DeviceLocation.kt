package ru.farvater.driver

import android.Manifest
import android.annotation.SuppressLint
import android.content.Intent
import android.content.pm.PackageManager
import android.location.Location
import android.location.LocationListener
import android.location.LocationManager
import android.net.Uri
import android.os.Bundle
import android.os.Looper
import android.os.SystemClock
import android.provider.Settings
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.platform.LocalContext
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.compose.LocalLifecycleOwner
import kotlin.math.roundToInt
import kotlinx.coroutines.delay

internal data class DeviceFix(
    val lat: Double,
    val lon: Double,
    val accuracy: Float,
    val elapsed: Long,
) {
    fun json() = json("lat" to lat, "lon" to lon, "accuracy" to accuracy.toDouble())

    fun ageSeconds(now: Long) = ((now - elapsed).coerceAtLeast(0) / 1000)
}

internal fun usableFix(
    lat: Double,
    lon: Double,
    accuracy: Float,
    elapsed: Long,
    now: Long,
): Boolean =
    lat in -90.0..90.0 &&
        lon in -180.0..180.0 &&
        accuracy.isFinite() &&
        accuracy >= 0f &&
        elapsed in (now - 120_000).coerceAtLeast(0)..now

private enum class PositionState {
    Ready,
    Waiting,
    Available,
    Denied,
    Disabled,
    Timeout,
    Error,
}

@SuppressLint("MissingPermission")
@Composable
internal fun LocatedMap(render: @Composable (DeviceFix?, Int) -> Unit) {
    val ctx = LocalContext.current
    val manager = remember(ctx) { ctx.getSystemService(LocationManager::class.java) }
    val lifecycle = LocalLifecycleOwner.current.lifecycle
    var phase by remember { mutableStateOf(PositionState.Ready) }
    var active by remember { mutableStateOf(false) }
    var request by remember { mutableIntStateOf(0) }
    var center by remember { mutableIntStateOf(0) }
    var fix by remember { mutableStateOf<DeviceFix?>(null) }
    var now by remember { mutableLongStateOf(SystemClock.elapsedRealtime()) }
    fun permitted(name: String) = ctx.checkSelfPermission(name) == PackageManager.PERMISSION_GRANTED
    fun start() {
        phase = PositionState.Waiting
        active = true
        request++
    }
    val permission =
        rememberLauncherForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) {
            if (
                permitted(Manifest.permission.ACCESS_COARSE_LOCATION) ||
                    permitted(Manifest.permission.ACCESS_FINE_LOCATION)
            )
                start()
            else {
                active = false
                phase = PositionState.Denied
            }
        }
    fun locate() {
        if (
            permitted(Manifest.permission.ACCESS_COARSE_LOCATION) ||
                permitted(Manifest.permission.ACCESS_FINE_LOCATION)
        )
            start()
        else
            permission.launch(
                arrayOf(
                    Manifest.permission.ACCESS_COARSE_LOCATION,
                    Manifest.permission.ACCESS_FINE_LOCATION,
                )
            )
    }
    DisposableEffect(active, request, lifecycle) {
        var listener: LocationListener? = null
        val observer = LifecycleEventObserver { _, event ->
            if (event == Lifecycle.Event.ON_STOP) {
                active = false
                fix = null
                phase = PositionState.Ready
            }
        }
        lifecycle.addObserver(observer)
        if (active) {
            val providers =
                listOf(LocationManager.GPS_PROVIDER, LocationManager.NETWORK_PROVIDER, "fused")
                    .filter { provider ->
                        runCatching { manager.isProviderEnabled(provider) }.getOrDefault(false)
                    }
            val locationEnabled =
                if (android.os.Build.VERSION.SDK_INT >= 28) manager.isLocationEnabled
                else
                    Settings.Secure.getInt(
                        ctx.contentResolver,
                        Settings.Secure.LOCATION_MODE,
                        Settings.Secure.LOCATION_MODE_OFF,
                    ) != Settings.Secure.LOCATION_MODE_OFF
            if (!locationEnabled || providers.isEmpty()) {
                active = false
                phase = PositionState.Disabled
            } else {
                var centered = false
                fun update(loc: Location) {
                    val stamp = loc.elapsedRealtimeNanos / 1_000_000
                    val instant = SystemClock.elapsedRealtime()
                    if (
                        !loc.hasAccuracy() ||
                            !usableFix(loc.latitude, loc.longitude, loc.accuracy, stamp, instant)
                    )
                        return
                    val previous = fix
                    if (previous != null && stamp < previous.elapsed) return
                    fix = DeviceFix(loc.latitude, loc.longitude, loc.accuracy, stamp)
                    now = instant
                    phase = PositionState.Available
                    if (!centered) {
                        center++
                        centered = true
                    }
                }
                val callbacks =
                    object : LocationListener {
                        override fun onLocationChanged(location: Location) = update(location)

                        override fun onProviderDisabled(provider: String) {
                            if (
                                providers.none {
                                    runCatching { manager.isProviderEnabled(it) }
                                        .getOrDefault(false)
                                }
                            ) {
                                active = false
                                fix = null
                                phase = PositionState.Disabled
                            }
                        }

                        override fun onProviderEnabled(provider: String) {}

                        @Deprecated("Android callback")
                        override fun onStatusChanged(
                            provider: String?,
                            status: Int,
                            extras: Bundle?,
                        ) {}
                    }
                listener = callbacks
                val subscriptions =
                    providers.count { name ->
                        runCatching {
                                manager.requestLocationUpdates(
                                    name,
                                    5000L,
                                    5f,
                                    callbacks,
                                    Looper.getMainLooper(),
                                )
                            }
                            .isSuccess
                    }
                if (subscriptions == 0) {
                    active = false
                    phase = PositionState.Error
                } else
                    providers
                        .mapNotNull { name ->
                            runCatching { manager.getLastKnownLocation(name) }.getOrNull()
                        }
                        .sortedBy { it.elapsedRealtimeNanos }
                        .forEach(::update)
            }
        }
        onDispose {
            listener?.let { runCatching { manager.removeUpdates(it) } }
            lifecycle.removeObserver(observer)
        }
    }
    LaunchedEffect(active, request) {
        if (!active) return@LaunchedEffect
        val began = SystemClock.elapsedRealtime()
        while (active) {
            delay(1000L)
            now = SystemClock.elapsedRealtime()
            if (phase == PositionState.Waiting && now - began >= 35_000) {
                active = false
                phase = PositionState.Timeout
            }
        }
    }
    val detail =
        when (phase) {
            PositionState.Ready -> "По данным телефона"
            PositionState.Waiting -> "Ищем координаты телефона…"
            PositionState.Available ->
                fix?.let {
                        val age = it.ageSeconds(now)
                        val freshness =
                            when {
                                age < 10 -> "только что"
                                age < 60 -> "$age с назад"
                                else -> "${age/60} мин назад"
                            }
                        "Точность ±${it.accuracy.roundToInt()} м · $freshness"
                    }
                    .orEmpty()
            PositionState.Denied -> "Нет разрешения. Маршрут доступен без местоположения."
            PositionState.Disabled -> "Определение местоположения выключено на телефоне."
            PositionState.Timeout ->
                "Телефон пока не определил позицию. Повторите на открытом месте."
            PositionState.Error -> "Доступный источник координат не найден."
        }
    CardBlock {
        Setting(Mark.Pin, "Моё местоположение", detail, click = ::locate)
        if (active && phase != PositionState.Waiting)
            TextButton(
                onClick = {
                    active = false
                    fix = null
                    phase = PositionState.Ready
                }
            ) {
                Text("Выключить геолокацию на карте")
            }
        if (phase == PositionState.Disabled || phase == PositionState.Denied)
            TextButton(
                onClick = {
                    val intent =
                        if (phase == PositionState.Disabled)
                            Intent(Settings.ACTION_LOCATION_SOURCE_SETTINGS)
                        else
                            Intent(
                                Settings.ACTION_APPLICATION_DETAILS_SETTINGS,
                                Uri.fromParts("package", ctx.packageName, null),
                            )
                    runCatching { ctx.startActivity(intent) }
                }
            ) {
                Text("Открыть настройки телефона")
            }
    }
    render(fix, center)
}
