package ru.farvater.driver

import android.content.Context
import android.content.Intent
import android.net.Uri
import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp

internal data class YandexDirections(val maps: String, val navigator: String)

internal fun yandexDirections(lat: Double?, lon: Double?): YandexDirections? {
    if (lat == null || lat !in -90.0..90.0 || lon == null || lon !in -180.0..180.0) return null
    return YandexDirections(
        "https://yandex.ru/maps/?rtt=auto&rtext=~$lat,$lon",
        "yandexnavi://build_route_on_map?lat_to=$lat&lon_to=$lon",
    )
}

private fun openYandex(context: Context, url: String, app: String? = null): Boolean = runCatching {
    context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url)).setPackage(app))
}.isSuccess

@Composable
internal fun NavigateTo(label: String, lat: Double?, lon: Double?) {
    val context = LocalContext.current
    val directions = yandexDirections(lat, lon)
    var choosing by remember(label, directions) { mutableStateOf(false) }
    var error by remember(label, directions) { mutableStateOf("") }
    fun maps(url: String) = openYandex(context, url, "ru.yandex.yandexmaps") || openYandex(context, url)
    Setting(Mark.Route, if (directions == null) "Найти адрес в Яндекс Картах" else "Показать маршрут") {
        error = ""
        if (directions != null) choosing = true
        else if (!maps("https://yandex.ru/maps/?text=${Uri.encode(label)}")) error = "Не удалось открыть Яндекс Карты."
    }
    if (choosing && directions != null) AlertDialog(
        onDismissRequest = { choosing = false },
        title = { Text("Навигация до точки") },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Text(label)
                Action("Яндекс Карты") {
                    choosing = false
                    if (!maps(directions.maps)) error = "Не удалось открыть Яндекс Карты."
                }
                OutlinedButton(
                    onClick = {
                        choosing = false
                        if (!openYandex(context, directions.navigator, "ru.yandex.yandexnavi")) {
                            if (!maps(directions.maps)) error = "Не удалось открыть навигацию."
                        }
                    },
                    modifier = Modifier.fillMaxWidth().heightIn(min = 52.dp),
                ) { Text("Яндекс Навигатор") }
            }
        },
        confirmButton = { TextButton(onClick = { choosing = false }) { Text("Закрыть") } },
    )
    if (error.isNotBlank()) Feedback(error, true)
}
