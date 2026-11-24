package ru.farvater.driver

import android.Manifest
import android.content.Context
import android.content.SharedPreferences
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.selection.toggleable
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.unit.dp
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.repeatOnLifecycle

internal fun trackingPreferences(context: Context): SharedPreferences =
    context.getSharedPreferences("driver.background_location", Context.MODE_PRIVATE)

@Composable
private fun backgroundLocationEnabled(account: String): Boolean {
    val context = LocalContext.current
    val prefs = remember(context) { trackingPreferences(context) }
    var enabled by remember(prefs, account) { mutableStateOf(prefs.getBoolean(account, false)) }
    DisposableEffect(prefs, account) {
        val listener = SharedPreferences.OnSharedPreferenceChangeListener { _, key ->
            if (key == account) enabled = prefs.getBoolean(account, false)
        }
        prefs.registerOnSharedPreferenceChangeListener(listener)
        onDispose { prefs.unregisterOnSharedPreferenceChangeListener(listener) }
    }
    return enabled
}

@Composable
internal fun AutomaticTripTracking(account: String, tripId: Int?) {
    val context = LocalContext.current
    val lifecycle = LocalLifecycleOwner.current.lifecycle
    val enabled = backgroundLocationEnabled(account)
    LaunchedEffect(lifecycle, enabled, tripId) {
        if (enabled && tripId != null) lifecycle.repeatOnLifecycle(Lifecycle.State.RESUMED) {
            if (positionAllowed(context) && TripTrackingService.state.value.tripId != tripId) {
                runCatching { TripTrackingService.start(context, tripId, automatic = true) }
            }
        }
    }
}

@Composable
internal fun BackgroundLocationSetting(account: String, activeTrip: Int?) {
    val context = LocalContext.current
    val enabled = backgroundLocationEnabled(account)
    val sharing by TripTrackingService.state.collectAsState()
    var error by remember(account) { mutableStateOf("") }
    fun choose(value: Boolean) {
        trackingPreferences(context).edit().putBoolean(account, value).apply()
        if (!value) TripTrackingService.stop(context)
    }
    val permission = rememberLauncherForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) {
        if (positionAllowed(context)) choose(true) else error = "Разрешите доступ к местоположению, чтобы включить передачу."
    }
    CardBlock {
        Heading("Геопозиция")
        Row(
            Modifier.fillMaxWidth().heightIn(min = 48.dp).toggleable(enabled, role = Role.Switch) { value ->
                error = ""
                if (!value || positionAllowed(context)) choose(value)
                else permission.launch(arrayOf(Manifest.permission.ACCESS_COARSE_LOCATION, Manifest.permission.ACCESS_FINE_LOCATION))
            },
            horizontalArrangement = Arrangement.spacedBy(12.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text("Фоновая геолокация", Modifier.weight(1f))
            Switch(checked = enabled, onCheckedChange = null)
        }
        Muted("На активном рейсе WaySlate передаёт геопозицию оператору и администратору, в том числе с выключенным экраном и при открытом навигаторе. Остановить передачу можно здесь, на маршруте или через уведомление.")
        if (enabled) Muted(sharing.note ?: if (activeTrip == null) "Передача включится при выезде на рейс."
            else if (!positionAllowed(context)) "Проверьте разрешение Android на доступ к местоположению."
            else "Передача геопозиции запускается на активном рейсе.")
        if (error.isNotBlank()) Feedback(error, true)
    }
}
