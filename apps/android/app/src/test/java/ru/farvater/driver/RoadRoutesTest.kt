package ru.farvater.driver

import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.async
import kotlinx.coroutines.runBlocking
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test

class RoadRoutesTest {
    private val base = MapBase("Учебная база", 52.0, 38.0)
    private val first = json("id" to "a", "lat" to 51.2, "lon" to 37.1)
    private val second = json("id" to "b", "lat" to 51.3, "lon" to 37.2)
    private val trip = json("id" to "demo-0", "stops" to JSONArray().put(first).put(second))
    private val request = RoadRequest.from(trip, base, true)

    private fun ready(query: RoadRequest = request): JSONObject {
        val legs = JSONArray()
        val coords = JSONArray()
        for (p in query.points) coords.put(JSONArray().put(p.lon).put(p.lat))
        for ((from, to) in query.points.zipWithNext())
            legs.put(json("from_id" to from.id, "to_id" to to.id, "duration_s" to 180.0, "distance_m" to 2100.0))
        return json("status" to "ready", "has_base" to (query.base != null),
            "distance_m" to 6300.0, "duration_s" to 540.0, "legs" to legs,
            "geometry" to json("type" to "LineString", "coordinates" to coords))
    }

    @Test fun publishedAndExamplePathsUseConfiguredBaseAndOrderedStops() {
        assertEquals("road-routes/example/demo-0", request.path)
        assertEquals(listOf("base", "a", "b", "base"), request.points.map { it.id })
        assertEquals("road-routes/trip/15", RoadRequest.from(
            json("id" to "15", "stops" to JSONArray()), base, false).path)
        assertNotEquals(request, RoadRequest.from(trip, base.copy(lat = 52.1), true))
        assertNotEquals(request, RoadRequest.from(trip, base.copy(lon = 38.1), true))
    }

    @Test fun cacheExpiresAndCoordinateOrOrderChangesRequireFreshResponse() = runBlocking {
        var calls = 0
        var time = 1000L
        var expected = request
        val repo = RoadRepository({ time }) { calls++; ready(expected) }
        assertEquals("ready", repo.load(request).getString("status"))
        repo.load(request)
        assertEquals(1, calls)
        time += 300_001
        repo.load(request)
        expected = request.copy(stops = request.stops.reversed())
        repo.load(expected)
        expected = expected.copy(stops = expected.stops.map { it.copy(lat = 52.22) })
        repo.load(expected)
        assertEquals(4, calls)
    }

    @Test fun incompleteAndObsoleteResponsesNeverSupplyGeometry() = runBlocking {
        var calls = 0
        val repo = RoadRepository { calls++; ready() }
        val missing = request.copy(stops = listOf(request.stops.first().copy(lat = null)))
        assertEquals("missing_points", repo.load(missing).getString("status"))
        assertEquals(0, calls)
        val obsolete = repo.load(request.copy(stops = request.stops.reversed()))
        assertEquals("unavailable", obsolete.getString("status"))
        assertFalse(obsolete.has("geometry"))
        val partial = RoadRepository { ready().also { it.getJSONArray("legs").getJSONObject(0).remove("distance_m") } }
        assertEquals("unavailable", partial.load(request).getString("status"))
    }

    @Test fun failuresCanBeRetriedAndLogoutDiscardsInFlightResponse() = runBlocking {
        var attempts = 0
        val repo = RoadRepository { if (++attempts == 1) error("offline") else ready() }
        assertEquals("unavailable", repo.load(request).getString("status"))
        assertEquals("ready", repo.load(request).getString("status"))
        val started = CompletableDeferred<Unit>()
        val release = CompletableDeferred<Unit>()
        val pending = RoadRepository { started.complete(Unit); release.await(); ready() }
        val lateResult = async { pending.load(request) }
        started.await()
        pending.clear()
        release.complete(Unit)
        assertEquals("unavailable", lateResult.await().getString("status"))
    }

    @Test fun travelEstimatesAreReadableInRussian() {
        assertEquals("11,3 км", roadDistance(11300.0))
        assertEquals("1 мин", drivingTime(5.0))
        assertEquals("1 ч", drivingTime(3599.0))
        assertEquals("2 ч 7 мин", drivingTime(7600.0))
    }
}
