package ru.farvater.driver

import java.text.NumberFormat
import java.util.Locale
import kotlin.math.roundToInt
import kotlinx.coroutines.CancellationException
import org.json.JSONObject

internal data class RoadPoint(val id: String, val lat: Double?, val lon: Double?)

internal data class RoadRequest(val path: String, val base: RoadPoint?, val stops: List<RoadPoint>) {
    val points = listOfNotNull(base) + stops + listOfNotNull(base)

    companion object {
        fun from(trip: JSONObject, base: MapBase, example: Boolean): RoadRequest {
            val path = "road-routes/" + (if (example) "example/" else "trip/") + trip.getString("id")
            val depot = if (base.lat != null && base.lon != null) RoadPoint("base", base.lat, base.lon) else null
            val array = trip.getJSONArray("stops")
            val stops = List(array.length()) { index ->
                val stop = array.getJSONObject(index)
                RoadPoint(stop.getString("id"), stop.optDouble("lat").takeIf { it in -90.0..90.0 },
                    stop.optDouble("lon").takeIf { it in -180.0..180.0 })
            }
            return RoadRequest(path, depot, stops)
        }
    }
}

private fun JSONObject.matches(request: RoadRequest): Boolean {
    if (optBoolean("has_base") != (request.base != null)) return false
    if (!hasMetrics()) return false
    val geo = optJSONObject("geometry") ?: return false
    val coordinates = geo.optJSONArray("coordinates") ?: return false
    if (geo.optString("type") != "LineString" || coordinates.length() < 2) return false
    for (i in 0 until coordinates.length()) {
        val pair = coordinates.optJSONArray(i) ?: return false
        if (pair.optDouble(0) !in -180.0..180.0 || pair.optDouble(1) !in -90.0..90.0) return false
    }
    val legs = optJSONArray("legs") ?: return false
    if (legs.length() != request.points.size - 1) return false
    return (0 until legs.length()).all { i ->
        val leg = legs.optJSONObject(i)
        leg?.optString("from_id") == request.points[i].id &&
            leg.optString("to_id") == request.points[i + 1].id && leg.hasMetrics()
    }
}

private fun JSONObject.hasMetrics() = listOf("distance_m", "duration_s").all {
    val value = optDouble(it)
    value.isFinite() && value >= 0
}

/** Keep successful routes for this signed-in session. The key includes point order and coordinates. */
internal class RoadRepository(
    private val now: () -> Long = { System.nanoTime() / 1_000_000 },
    private val get: suspend (String) -> JSONObject,
) {
    private data class Cached(val at: Long, val road: JSONObject, val vertices: Int)
    private val cache = LinkedHashMap<RoadRequest, Cached>()
    private var session = 0

    fun clear() {
        session++
        cache.clear()
    }

    suspend fun load(request: RoadRequest): JSONObject {
        if (request.stops.isEmpty() || request.points.size < 2 ||
            request.stops.any { it.lat == null || it.lon == null })
            return json("status" to "missing_points")
        cache[request]?.takeIf { now() - it.at < 300_000 }?.let { return it.road }
        val started = session
        val response = try {
            get(request.path)
        } catch (e: CancellationException) {
            throw e
        } catch (e: ApiError) {
            val reason = when (e.status) {
                401 -> "Сессия завершена. Обновите смену."
                403, 404 -> "Рейс недоступен. Обновите смену, чтобы получить текущие назначения."
                else -> "Сервис маршрутов временно недоступен."
            }
            return json("status" to "unavailable", "message" to reason)
        } catch (_: Exception) {
            return json("status" to "unavailable")
        }
        return when (response.optString("status")) {
            "ready" -> {
                if (session != started || !response.matches(request))
                    return json("status" to "unavailable")
                val vertices = response.getJSONObject("geometry").getJSONArray("coordinates").length()
                if (vertices <= 50_000) {
                    cache[request] = Cached(now(), response, vertices)
                    while (cache.size > 24 || cache.values.sumOf { it.vertices } > 50_000)
                        cache.remove(cache.keys.first())
                }
                response
            }
            "missing_points", "unavailable", "disabled" -> response
            else -> json("status" to "unavailable")
        }
    }
}

internal fun roadDistance(metres: Double): String {
    val formatter = NumberFormat.getNumberInstance(Locale.forLanguageTag("ru-RU"))
    formatter.maximumFractionDigits = 1
    return formatter.format(metres / 1000) + " км"
}

internal fun drivingTime(seconds: Double): String {
    val minutes = (seconds / 60).roundToInt().coerceAtLeast(if (seconds > 0) 1 else 0)
    return when {
        minutes < 60 -> "$minutes мин"
        minutes % 60 == 0 -> "${minutes / 60} ч"
        else -> "${minutes / 60} ч ${minutes % 60} мин"
    }
}
