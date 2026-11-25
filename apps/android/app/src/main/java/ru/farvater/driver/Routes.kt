package ru.farvater.driver

import android.Manifest
import android.content.Intent
import android.net.Uri
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import org.json.JSONArray

private val routeColors =
    listOf(Color(0xFF16766C), Color(0xFF3865BA), Color(0xFFA55423), Color(0xFF7754A9))

@Composable
internal fun RouteView(day: Day?, task: ShiftFocus?, base: MapBase, repository: RoadRepository, select: (Int) -> Unit) {
    Heading("Маршрут", true)
    var mapped by rememberSaveable { mutableStateOf(true) }
    var example by rememberSaveable { mutableStateOf(false) }
    val dark = MaterialTheme.colorScheme.background == Dark.background
    if (example) {
        ExampleMap(base, dark, repository) { example = false }
        return
    }
    val published = day?.trips.orEmpty().takeIf { day?.shift?.published == true }.orEmpty()
    val choices = published.map { it.id }
    var filter by rememberSaveable(choices) { mutableIntStateOf(0) }
    val shown = day?.mapTrips(filter).orEmpty()
    val sharing by TripTrackingService.state.collectAsState()
    Surface(shape = RoundedCornerShape(14.dp), color = MaterialTheme.colorScheme.surfaceVariant) {
        Row(
            Modifier.fillMaxWidth().padding(4.dp).height(IntrinsicSize.Min),
            horizontalArrangement = Arrangement.spacedBy(4.dp),
        ) {
            listOf(false to "Список", true to "Карта рейсов").forEach { (map, label) ->
                val active = map == mapped
                Surface(
                    onClick = { mapped = map },
                    selected = active,
                    modifier = Modifier.weight(1f).heightIn(min = 48.dp).fillMaxHeight(),
                    shape = RoundedCornerShape(11.dp),
                    color =
                        if (active) MaterialTheme.colorScheme.surface
                        else MaterialTheme.colorScheme.surfaceVariant,
                ) {
                    Row(
                        Modifier.padding(horizontal = 5.dp),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.Center,
                    ) {
                        Symbol(if (map) Mark.Pin else Mark.Route, size = 17)
                        Spacer(Modifier.width(6.dp))
                        Text(label, style = MaterialTheme.typography.labelLarge)
                    }
                }
            }
        }
    }
    if (mapped) {
        TextButton(onClick = { example = true }, modifier = Modifier.heightIn(min = 48.dp)) {
            Symbol(Mark.Route, size = 17)
            Spacer(Modifier.width(8.dp))
            Text("Учебный маршрут")
        }
    }
    val activeTrip = published.firstOrNull { it.status == "active" }
    if (!mapped) activeTrip?.let { TrackingPanel(it.id, sharing) }
    if (published.size > 1)
        Row(
            Modifier.horizontalScroll(rememberScrollState()),
            horizontalArrangement = Arrangement.spacedBy(7.dp),
        ) {
            FilterChip(
                selected = filter == 0,
                onClick = { filter = 0 },
                label = { Text("Все рейсы") },
                modifier = Modifier.heightIn(min = 48.dp),
            )
            published.forEach { trip ->
                FilterChip(
                    selected = filter == trip.id,
                    onClick = { filter = trip.id },
                    label = { Text("Рейс ${trip.number}") },
                    leadingIcon = {
                        Surface(
                            color =
                                routeColors[(trip.number - 1).coerceAtLeast(0) % routeColors.size],
                            shape = CircleShape,
                            modifier = Modifier.size(11.dp),
                        ) {}
                    },
                    modifier = Modifier.heightIn(min = 48.dp),
                )
            }
        }
    val bottles = shown.sumOf { t -> t.points.sumOf { it.water } }
    Text(
        withMetrics(
            "Маршрут · ${shown.sumOf {it.points.size}} точ.    Груз · $bottles бут. / ${bottles*20} кг"
        ),
        style = MaterialTheme.typography.labelLarge,
        color = MaterialTheme.colorScheme.onSurfaceVariant,
    )
    val focus = task?.id.takeIf { task?.kind == "point" }
    val payload = mapPayload(shown, filter, focus, base, dark)
    val roads = roadRows(payload, base, false, repository)
    RoadTotal(roads)
    if (!mapped) {
        RoadSummary(roads, base.label)
        if (day == null || shown.isEmpty())
            CardBlock {
                Heading("Точек пока нет")
                Muted(
                    if (day?.shift?.published == false)
                        "Маршрут на завтра публикуется с 18:00 по времени базы."
                    else "Здесь появятся назначенные точки в порядке доставки."
                )
            }
        else shown.forEach { TripList(it.trip, day, task, select) }
    } else {
        val phones =
            shown.flatMap { t -> t.points.map { it.phone } }.filter { it.isNotBlank() }.toSet()
        LocatedMap { fix, request ->
            val tracked = sharing.fix?.takeIf { shown.any { route -> route.trip.id == sharing.tripId } }
            payload.put("tracked", JSONArray().apply { if (tracked != null) put(tracked.mapJson().put("driver_name", "Я на рейсе")) })
            payload.put("location", fix?.json() ?: org.json.JSONObject.NULL)
                .put("locationRequest", request)
            RouteMap(payload.toString(), base.tiles, phones)
        }
        activeTrip?.let { TrackingPanel(it.id, sharing) }
        RoadSummary(roads, base.label)
        val trip = shown.singleOrNull()
        if (trip != null) {
            CardBlock {
                val point = trip.points.find { it.id == focus }
                if (point != null) {
                    if (!point.arrived) NavigateTo(point.address, point.latitude, point.longitude)
                    Setting(Mark.Pin, "Следующая точка", point.address) { select(point.id) }
                }
                YandexActions(trip.trip.base ?: base, payload.getJSONArray("trips").getJSONObject(0).getJSONArray("stops"))
            }
        } else if (shown.size > 1) Muted("Выберите один рейс для маршрута в Яндекс Картах.")
    }
}

@Composable
private fun TrackingPanel(tripId: Int, sharing: TrackingState) {
    val context = LocalContext.current
    var error by rememberSaveable(tripId) { mutableStateOf("") }
    fun start() {
        error = if (runCatching { TripTrackingService.start(context, tripId) }.isSuccess) ""
            else "Не удалось включить передачу. Откройте приложение и повторите."
    }
    val permission = rememberLauncherForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) {
        if (positionAllowed(context)) start() else error = "Разрешите приложению доступ к местоположению."
    }
    val enabled = sharing.tripId == tripId
    CardBlock {
        Heading("Геопозиция на рейсе")
        Muted(sharing.note ?: "Оператор и администратор увидят вашу геопозицию до возврата или отключения передачи. Android покажет уведомление.")
        if (error.isNotEmpty()) Feedback(error, true)
        if (enabled) {
            OutlinedButton(onClick = { TripTrackingService.stop(context) }, modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp)) {
                Text("Остановить передачу")
            }
        } else Action("Передавать геопозицию") {
            if (positionAllowed(context)) start()
            else permission.launch(arrayOf(Manifest.permission.ACCESS_COARSE_LOCATION, Manifest.permission.ACCESS_FINE_LOCATION))
        }
    }
}

@Composable
internal fun YandexActions(base: MapBase, stops: JSONArray) {
    val context = LocalContext.current
    val links = yandexRoutes(base, stops)
    var launchError by remember(links) { mutableStateOf(false) }
    if (links.isEmpty()) Muted("Для Яндекс Карт нужны координаты всех остановок рейса.")
    links.forEach { link ->
        Setting(Mark.Route, link.title) {
            launchError = runCatching {
                context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(link.url)))
            }.isFailure
        }
    }
    if (launchError) Feedback("Не удалось открыть Яндекс Карты на устройстве.", true)
}
