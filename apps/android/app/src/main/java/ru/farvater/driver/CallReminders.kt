package ru.farvater.driver

import android.Manifest
import android.app.AlarmManager
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.provider.Settings
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.lifecycle.compose.LifecycleResumeEffect
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.platform.LocalContext
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId

internal fun callTime(date: String, eta: Int, zone: String): Long =
    LocalDate.parse(date).atStartOfDay().plusMinutes(eta.toLong()).atZone(ZoneId.of(zone))
        .minusMinutes(90).toInstant().toEpochMilli()

private const val CHANNEL = "customer-calls"
private const val WINDOW = 90L * 60L * 1000L

internal fun pastRouteAlarmExpired(state: String, today: String, now: Long): Boolean {
    val trigger = state.substringAfter('|').substringBefore('|').toLongOrNull()
    return state.substringBefore('|') < today && (trigger == null || trigger <= now - WINDOW)
}

internal fun callSchedule(day: Day, date: String, zone: String, now: Long): Map<Int, Long> {
    if (day.shift?.published != true) return emptyMap()
    return day.stops.filter { !it.onSite && it.status == "assigned" }.associate {
        it.id to callTime(date, it.eta, zone)
    }.filterValues { it + WINDOW > now }
}

internal class CallReminders(private val context: Context) {
    // Non-sensitive schedule only. A row holds the route date, trigger time and whether it rang.
    private val prefs = context.getSharedPreferences("driver.alarms.v1", Context.MODE_PRIVATE)
    private val alarms = context.getSystemService(AlarmManager::class.java)
    private val notifications = context.getSystemService(NotificationManager::class.java)

    private fun alarm(id: Int, time: Long): PendingIntent {
        val intent = Intent(context, CallReceiver::class.java).putExtra("order", id).putExtra("time", time)
        return PendingIntent.getBroadcast(context, id, intent, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
    }
    private fun remove(id: Int) {
        alarms.cancel(alarm(id, 0))
        notifications.cancel("call", id)
        prefs.edit().remove(id.toString()).apply()
    }
    fun clear() {
        prefs.all.keys.mapNotNull { it.toIntOrNull() }.forEach { remove(it) }
        notifications.cancel("route", 1)
    }

    fun routeChanged(date: String) {
        if (!canNotify()) return
        val channel = "route-updates"
        notifications.createNotificationChannel(NotificationChannel(channel, "Изменения маршрута", NotificationManager.IMPORTANCE_DEFAULT))
        val open = PendingIntent.getActivity(context, 0, Intent(context, MainActivity::class.java),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
        notifications.notify("route", 1, Notification.Builder(context, channel)
            .setSmallIcon(android.R.drawable.ic_dialog_map).setContentTitle("Маршрут обновлён")
            .setContentText("Проверьте точки на $date").setContentIntent(open)
            .setVisibility(Notification.VISIBILITY_PRIVATE).setAutoCancel(true).build())
    }

    fun sync(day: Day, date: String, zone: String) {
        val now = Instant.now().toEpochMilli()
        val today = LocalDate.now(ZoneId.of(zone)).toString()
        val scheduled = callSchedule(day, date, zone, now)
        prefs.all.forEach { (key, state) ->
            val saved = state.toString()
            val id = key.toIntOrNull()
            if (id != null && (pastRouteAlarmExpired(saved, today, now) ||
                    (saved.substringBefore('|') == date && id !in scheduled))) remove(id)
        }
        if (!canNotify()) return
        notifications.createNotificationChannel(NotificationChannel(CHANNEL, "Звонки перед доставкой", NotificationManager.IMPORTANCE_DEFAULT))
        scheduled.forEach { (id, time) ->
            val old = prefs.getString(id.toString(), "").orEmpty()
            if (!old.endsWith("|sent")) {
                val next = "$date|$time|waiting"
                prefs.edit().putString(id.toString(), next).apply()
                // Reconcile on each sync as Android removes alarms on reboot.
                alarms.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, maxOf(time, now), alarm(id, time))
            }
        }
    }
    fun canNotify(): Boolean = notifications.areNotificationsEnabled() &&
        (Build.VERSION.SDK_INT < 33 || context.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED)

    fun show(id: Int, time: Long) {
        val value = prefs.getString(id.toString(), "").orEmpty()
        if (!value.endsWith("|$time|waiting") || !canNotify() || System.currentTimeMillis() >= time + WINDOW) return
        val open = PendingIntent.getActivity(context, id, Intent(context, MainActivity::class.java),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
        val notification = Notification.Builder(context, CHANNEL)
            .setSmallIcon(android.R.drawable.ic_menu_call).setContentTitle("Позвоните клиенту")
            .setContentText("Откройте маршрут и уточните приём заказа №$id.")
            .setVisibility(Notification.VISIBILITY_PRIVATE).setContentIntent(open).setAutoCancel(true).build()
        notifications.notify("call", id, notification)
        prefs.edit().putString(id.toString(), value.substringBeforeLast('|') + "|sent").apply()
    }
}

class CallReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        CallReminders(context).show(intent.getIntExtra("order", -1), intent.getLongExtra("time", 0))
    }
}

@Composable
internal fun ReminderPermission(model: DriverModel) {
    val context = LocalContext.current
    var enabled by remember { mutableStateOf(CallReminders(context).canNotify()) }
    var asked by remember { mutableStateOf(false) }
    LifecycleResumeEffect(context) {
        val allowed = CallReminders(context).canNotify()
        if (allowed && !enabled) model.refresh()
        enabled = allowed
        onPauseOrDispose {}
    }
    val launcher = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
        enabled = granted
        asked = true
        if (granted) model.refresh()
    }
    Setting(Mark.Bell, "Напоминания о звонках", if (enabled) "Включены · за 90 минут до прибытия" else "Выключены") {
        if (!enabled && !asked && Build.VERSION.SDK_INT >= 33) {
            launcher.launch(Manifest.permission.POST_NOTIFICATIONS)
        } else {
            val settings = Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS)
                .putExtra(Settings.EXTRA_APP_PACKAGE, context.packageName)
            context.startActivity(settings)
        }
    }
}
