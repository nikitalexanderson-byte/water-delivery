package ru.farvater.driver

import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import org.json.JSONArray
import org.json.JSONObject

@Composable
internal fun ExampleMap(tiles: Boolean, dark: Boolean, close: () -> Unit) {
    val context = LocalContext.current
    val examples =
        remember(context) {
            runCatching {
                    context.assets.open("route-map/example.json").bufferedReader().use { reader ->
                        val array = JSONArray(reader.readText())
                        List(array.length()) { array.getJSONObject(it) }
                    }
                }
                .getOrDefault(emptyList())
        }
    var selected by rememberSaveable { mutableStateOf("") }
    val visible = examples.filter { selected.isEmpty() || it.getString("id") == selected }
    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        TextButton(onClick = close, modifier = Modifier.heightIn(min = 48.dp)) {
            Symbol(Mark.Back, size = 18)
            Spacer(Modifier.width(6.dp))
            Text("К моим рейсам")
        }
    }
    Heading("Учебный маршрут")
    Muted("Пример рейсов по Москве · только просмотр")
    if (examples.isEmpty()) {
        Feedback("Не удалось прочитать учебный маршрут из приложения.", true)
        return
    }
    Row(
        Modifier.horizontalScroll(rememberScrollState()),
        horizontalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        FilterChip(
            selected = selected.isEmpty(),
            onClick = { selected = "" },
            label = { Text("Все рейсы") },
            modifier = Modifier.heightIn(min = 48.dp),
        )
        examples.forEachIndexed { i, trip ->
            FilterChip(
                selected = selected == trip.getString("id"),
                onClick = { selected = trip.getString("id") },
                label = { Text("Рейс ${i+1}") },
                modifier = Modifier.heightIn(min = 48.dp),
            )
        }
    }
    val points =
        visible.flatMap { trip ->
            val a = trip.getJSONArray("stops")
            List(a.length()) { a.getJSONObject(it) }
        }
    val water = points.sumOf { it.getInt("water") }
    Text(withMetrics("Маршрут · ${points.size} точ.    Груз · $water бут. / ${water*20} кг"))
    val payload =
        json(
            "trips" to JSONArray(visible),
            "base" to
                json(
                    "label" to "Производственная база",
                    "lat" to JSONObject.NULL,
                    "lon" to JSONObject.NULL,
                ),
            "activeTripId" to (selected.ifBlank { null } ?: JSONObject.NULL),
            "focusedStopId" to JSONObject.NULL,
            "location" to JSONObject.NULL,
            "locationRequest" to 0,
            "tilesEnabled" to tiles,
            "theme" to if (dark) "dark" else "light",
        )
    RouteMap(payload.toString(), tiles, emptySet())
}
