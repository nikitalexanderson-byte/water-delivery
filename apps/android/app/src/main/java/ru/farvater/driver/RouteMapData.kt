package ru.farvater.driver

import java.net.URI
import org.json.JSONArray
import org.json.JSONObject

internal data class MapBase(
    val label: String = "",
    val lat: Double? = null,
    val lon: Double? = null,
    val tiles: Boolean = false,
) {
    companion object {
        fun from(data: JSONObject) =
            MapBase(
                if (data.isNull("base_address")) "" else data.getString("base_address"),
                data.optDouble("base_lat").takeIf { it in -90.0..90.0 },
                data.optDouble("base_lon").takeIf { it in -180.0..180.0 },
                data.optBoolean("map_tiles_enabled"),
            )
    }

    fun json() =
        json(
            "base_address" to label,
            "base_lat" to (lat ?: JSONObject.NULL),
            "base_lon" to (lon ?: JSONObject.NULL),
            "map_tiles_enabled" to tiles,
        )
}

internal data class ShownTrip(val trip: Trip, val points: List<Stop>)

internal fun Day.mapTrips(selection: Int): List<ShownTrip> {
    if (shift?.published != true) return emptyList()
    return trips
        .filter { selection == 0 || selection == it.id }
        .map { trip ->
            ShownTrip(
                trip,
                stops
                    .filter { it.tripId == trip.id && !it.onSite && it.status != "cancelled" }
                    .sortedBy { it.position },
            )
        }
}

internal fun mapPayload(
    trips: List<ShownTrip>,
    filter: Int,
    focus: Int?,
    base: MapBase,
    dark: Boolean,
): JSONObject {
    val routes = JSONArray()
    trips.forEach { shown ->
        val points = JSONArray()
        shown.points.forEach { p ->
            val valid = p.latitude != null && p.longitude != null
            points.put(
                json(
                    "id" to p.id.toString(),
                    "position" to p.position,
                    "address" to p.address,
                    "name" to p.name,
                    "phone" to p.phone,
                    "water" to p.water,
                    "lat" to (p.latitude.takeIf { valid } ?: JSONObject.NULL),
                    "lon" to (p.longitude.takeIf { valid } ?: JSONObject.NULL),
                )
            )
        }
        routes.put(
            json(
                "id" to shown.trip.id.toString(),
                "label" to "Рейс ${shown.trip.number}",
                "colorIndex" to (shown.trip.number - 1).coerceAtLeast(0),
                "stops" to points,
            )
        )
    }
    val stopId = focus?.takeIf { id -> trips.any { t -> t.points.any { it.id == id } } }
    return mapPayload(routes, filter.takeIf { it > 0 }?.toString(), stopId?.toString(), base, dark)
}

internal fun mapPayload(
    routes: JSONArray,
    selection: String?,
    focus: String?,
    base: MapBase,
    dark: Boolean,
): JSONObject {
    val hasBase = base.lat != null && base.lon != null
    return json(
        "trips" to routes,
        "base" to
            json(
                "label" to base.label.ifBlank { "Производственная база" },
                "lat" to (base.lat.takeIf { hasBase } ?: JSONObject.NULL),
                "lon" to (base.lon.takeIf { hasBase } ?: JSONObject.NULL),
            ),
        "activeTripId" to (selection ?: JSONObject.NULL),
        "focusedStopId" to (focus ?: JSONObject.NULL),
        "location" to JSONObject.NULL,
        "locationRequest" to 0,
        "tilesEnabled" to base.tiles,
        "theme" to if (dark) "dark" else "light",
    )
}

internal data class YandexLink(val title: String, val url: String)

internal fun yandexRoutes(base: MapBase, stops: JSONArray): List<YandexLink> {
    if (stops.length() == 0) return emptyList()
    val knownBase = base.lat != null && base.lon != null
    val points = buildList {
        if (knownBase) add("${base.lat},${base.lon}")
        for (i in 0 until stops.length()) {
            val stop = stops.getJSONObject(i)
            val lat = stop.optDouble("lat").takeIf { it in -90.0..90.0 } ?: return emptyList()
            val lon = stop.optDouble("lon").takeIf { it in -180.0..180.0 } ?: return emptyList()
            if (stops.length() == 1 && !knownBase)
                return listOf(YandexLink("Точка в Яндекс Картах", "https://yandex.ru/maps/?pt=$lon,$lat&z=16"))
            add("$lat,$lon")
        }
        if (knownBase) add("${base.lat},${base.lon}")
    }
    return (0 until points.lastIndex step 9).mapIndexed { part, start ->
        val path = points.drop(start).take(10).joinToString("~")
        YandexLink(
            if (points.size <= 10) "Открыть в Яндекс Картах"
            else "Яндекс Карты · участок ${part+1}",
            "https://yandex.ru/maps/?rtt=auto&rtext=" + path,
        )
    }
}

internal const val MAP_URL = "https://map.farvater.invalid/route-map/index.html"

internal fun bundledMapAsset(url: String): String? {
    val uri = runCatching { URI(url) }.getOrNull() ?: return null
    if (uri.scheme != "https" || uri.rawAuthority != "map.farvater.invalid") return null
    val path = uri.rawPath.orEmpty()
    if (!path.startsWith("/route-map/") || !path.matches(Regex("""/[A-Za-z0-9_./-]+""")))
        return null
    if (path.split('/').any { it == ".." || it == "." }) return null
    return path.removePrefix("/")
}

internal fun osmTileAllowed(url: String, enabled: Boolean): Boolean {
    if (!enabled) return false
    val uri = runCatching { URI(url) }.getOrNull() ?: return false
    return uri.scheme == "https" &&
        uri.rawAuthority == "tile.openstreetmap.org" &&
        uri.rawQuery == null &&
        uri.rawFragment == null &&
        uri.rawPath.orEmpty().matches(Regex("""/\d{1,2}/\d{1,8}/\d{1,8}\.png"""))
}
