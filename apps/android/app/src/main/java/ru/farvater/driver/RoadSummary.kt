package ru.farvater.driver

import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import org.json.JSONObject

internal data class RoadRow(val trip: JSONObject, val result: JSONObject, val retry: () -> Unit)

@Composable
internal fun roadRows(payload: JSONObject, base: MapBase, example: Boolean, repository: RoadRepository): List<RoadRow> {
    val trips = payload.getJSONArray("trips")
    val roads = JSONObject()
    val rows = List(trips.length()) { index ->
        val trip = trips.getJSONObject(index)
        val request = RoadRequest.from(trip, base, example)
        key(request) {
            var attempt by remember { mutableIntStateOf(0) }
            var result by remember(attempt) { mutableStateOf(json("status" to "loading")) }
            LaunchedEffect(repository, attempt) { result = repository.load(request) }
            roads.put(trip.getString("id"), result)
            RoadRow(trip, result) { attempt++ }
        }
    }
    payload.put("roads", roads)
    return rows
}

@Composable
internal fun RoadTotal(rows: List<RoadRow>) {
    if (rows.isEmpty() || rows.any { it.result.optString("status") != "ready" }) return
    val distance = rows.sumOf { it.result.getDouble("distance_m") }
    val duration = rows.sumOf { it.result.getDouble("duration_s") }
    Text(withMetrics("${roadDistance(distance)} по дорогам · ≈ ${drivingTime(duration)} в движении"),
        style = MaterialTheme.typography.titleMedium)
}

@Composable
internal fun RoadSummary(rows: List<RoadRow>, baseLabel: String) {
    if (rows.isEmpty()) return
    val ready = rows.filter { it.result.optString("status") == "ready" }
    val complete = ready.size == rows.size
    var details by rememberSaveable(rows.map { it.trip.getString("id") }) { mutableStateOf(false) }
    CardBlock {
        Heading("Путь по дорогам")
        if (complete) {
            val baseName = baseLabel.substringBefore(',').trim()
            val limits = if (ready.all { it.result.getBoolean("has_base") })
                (if (baseName.isEmpty()) "База" else "База ($baseName)") + " → остановки → база"
            else "Между остановками рейсов"
            Muted("$limits. Без учёта разгрузки и ожидания.")
        }
        for (row in rows) {
            val status = row.result.optString("status")
            if (status != "ready") {
                val fallback = when (status) {
                    "loading" -> "Ищем дорогу…"
                    "missing_points" -> "Недостаточно точек с координатами."
                    "disabled" -> "Дорожный расчёт выключен в настройках сервера."
                    else -> "Сервис маршрутов временно недоступен."
                }
                val reason = row.result.optString("message").takeIf { it.isNotBlank() } ?: fallback
                Text("${row.trip.getString("label")} · $reason",
                    modifier = Modifier.semantics { liveRegion = LiveRegionMode.Polite })
                if (status == "unavailable" || status == "disabled")
                    TextButton(onClick = row.retry, modifier = Modifier.heightIn(min = 48.dp)) {
                        Text("Повторить расчёт")
                    }
            } else if (!complete) {
                PairLine(row.trip.getString("label"), "≈ ${drivingTime(row.result.getDouble("duration_s"))} · ${roadDistance(row.result.getDouble("distance_m"))}")
            }
        }
        if (ready.isNotEmpty()) {
            TextButton(onClick = { details = !details }, modifier = Modifier.heightIn(min = 48.dp)) {
                Text(if (details) "Скрыть перегоны" else "Посмотреть перегоны")
            }
            if (details) ready.forEach { RoadLegs(it) }
        }
    }
}

@Composable
private fun RoadLegs(row: RoadRow) {
    val stops = row.trip.getJSONArray("stops")
    val names = mutableMapOf("base" to "База")
    for (i in 0 until stops.length()) {
        val stop = stops.getJSONObject(i)
        names[stop.getString("id")] = "Точка ${stop.getInt("position")}"
    }
    val legs = row.result.getJSONArray("legs")
    Text(row.trip.getString("label"), style = MaterialTheme.typography.titleMedium)
    for (i in 0 until legs.length()) {
        val leg = legs.getJSONObject(i)
        PairLine("${names[leg.getString("from_id")]} → ${names[leg.getString("to_id")]}",
            "${roadDistance(leg.getDouble("distance_m"))} · ≈ ${drivingTime(leg.getDouble("duration_s"))}")
    }
}
