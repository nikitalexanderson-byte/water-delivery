package ru.farvater.driver

import org.json.JSONArray
import org.junit.Assert.*
import org.junit.Test

class RouteMapTest {
    private val base = MapBase("Тестовая база", 50.0, 30.0)
    private val trip = Trip(7, 1, "active", 2, 2, 0, 480, emptyList())
    private val shift = Shift(1, "Тест", "Тест", 2600, 480, 1080, false, "active", true)
    private val stop =
        Stop(
            9,
            7,
            1,
            1,
            "Клиент",
            "Тестовый адрес",
            "123456",
            "",
            1,
            true,
            false,
            480,
            780,
            510,
            2,
            0,
            15000,
            25000,
            30000,
            false,
            "",
            "assigned",
            false,
            false,
            "",
            emptyList(),
            latitude = 51.0,
            longitude = 31.0,
        )
    private val day =
        Day(
            shift,
            listOf(trip, trip.copy(id = 8, number = 2)),
            listOf(
                stop,
                stop.copy(id = 10, tripId = 8),
                stop.copy(id = 11, onSite = true),
                stop.copy(id = 12, status = "cancelled"),
            ),
            null,
            emptyList(),
        )

    private fun stopsOf(shown: ShownTrip): JSONArray =
        mapPayload(listOf(shown), 0, null, base, false)
            .getJSONArray("trips").getJSONObject(0).getJSONArray("stops")

    @Test
    fun exampleUsesConfiguredBaseAndLeavesPersonalLocationUnset() {
        val configured = MapBase.from(
            json("base_address" to "Адрес из настроек", "base_lat" to 54.123,
                "base_lon" to 38.456, "map_tiles_enabled" to true)
        )
        val stops = JSONArray().put(json("lat" to 55.111, "lon" to 37.222))
        val routes = JSONArray().put(json("id" to "demo-1", "stops" to stops))
        val payload = mapPayload(routes, "demo-1", null, configured, false)
        assertEquals(configured.label, payload.getJSONObject("base").getString("label"))
        assertEquals(54.123, payload.getJSONObject("base").getDouble("lat"), 0.0)
        assertEquals(38.456, payload.getJSONObject("base").getDouble("lon"), 0.0)
        assertTrue(payload.getBoolean("tilesEnabled"))
        assertEquals("demo-1", payload.getString("activeTripId"))
        assertTrue(payload.isNull("location"))
        assertEquals(0, payload.getInt("locationRequest"))
        assertEquals(
            "54.123,38.456~55.111,37.222~54.123,38.456",
            yandexRoutes(configured, stops).single().url.substringAfter("rtext="),
        )
        val incomplete = mapPayload(routes, null, null, configured.copy(lon = null), false)
        assertTrue(incomplete.getJSONObject("base").isNull("lat"))
        assertTrue(incomplete.getJSONObject("base").isNull("lon"))
    }

    @Test
    fun onlyPublishedPointsOfSelectedTripsEnterMap() {
        assertEquals(listOf(9, 10), day.mapTrips(0).flatMap { it.points }.map { it.id })
        assertEquals(listOf(10), day.mapTrips(8).flatMap { it.points }.map { it.id })
        assertTrue(day.copy(shift = shift.copy(published = false)).mapTrips(0).isEmpty())
    }

    @Test
    fun unknownCoordinatesStayNullAndNeverEnableExternalRouting() {
        val shown = ShownTrip(trip, listOf(stop.copy(longitude = null)))
        val payload = mapPayload(listOf(shown), 0, 9, MapBase(), true)
        val point =
            payload.getJSONArray("trips").getJSONObject(0).getJSONArray("stops").getJSONObject(0)
        assertTrue(point.isNull("lat"))
        assertTrue(point.isNull("lon"))
        assertTrue(payload.getJSONObject("base").isNull("lat"))
        assertFalse(payload.getBoolean("tilesEnabled"))
        assertTrue(yandexRoutes(base, stopsOf(shown)).isEmpty())
        assertEquals(
            "https://yandex.ru/maps/?pt=31.0,51.0&z=16",
            yandexRoutes(MapBase(), stopsOf(day.mapTrips(7).single())).single().url,
        )
    }

    @Test
    fun yandexRoundTripUsesOnlyCoordinatesAndKeepsStopOrder() {
        val shown =
            ShownTrip(trip, listOf(stop, stop.copy(id = 20, latitude = 52.0, longitude = 32.0)))
        assertEquals(
            "https://yandex.ru/maps/?rtt=auto&rtext=50.0,30.0~51.0,31.0~52.0,32.0~50.0,30.0",
            yandexRoutes(base, stopsOf(shown)).single().url,
        )
    }

    @Test
    fun longRouteSegmentsOverlapAndRespectTenWaypoints() {
        val shown = ShownTrip(trip, (0..10).map { stop.copy(id = it, latitude = 40.0 + it) })
        val links = yandexRoutes(MapBase(), stopsOf(shown))
        assertEquals(2, links.size)
        val first = links[0].url.substringAfter("rtext=").split("~")
        val second = links[1].url.substringAfter("rtext=").split("~")
        assertEquals(10, first.size)
        assertEquals(first.last(), second.first())
        assertEquals("50.0,31.0", second.last())
    }

    @Test
    fun locationFixRejectsStaleOrInvalidMeasurements() {
        assertTrue(usableFix(54.0, 37.0, 15f, 200000, 205000))
        assertFalse(usableFix(54.0, 37.0, 15f, 1000, 205000))
        assertFalse(usableFix(Double.NaN, 37.0, 15f, 200000, 205000))
        assertFalse(usableFix(54.0, 37.0, -1f, 200000, 205000))
        assertFalse(usableFix(54.0, 37.0, 5f, 209000, 205000))
    }

    @Test
    fun viewerReadsOnlyBundledDirectoryAndOptionalRasterTiles() {
        assertEquals("route-map/index.html", bundledMapAsset(MAP_URL))
        for (url in
            listOf(
                "file:///etc/passwd",
                "https://map.farvater.invalid/route-map/%2e%2e/private",
                "https://map.farvater.invalid/route-map/../private",
                "https://map.farvater.invalid.evil/route-map/map.js",
                "https://evil@map.farvater.invalid/route-map/index.html",
                "content://files/test",
            )) assertNull(bundledMapAsset(url))
        val tile = "https://tile.openstreetmap.org/11/123/404.png"
        assertTrue(osmTileAllowed(tile, true))
        assertFalse(osmTileAllowed(tile, false))
        for (url in
            listOf(
                tile + "?q=payload",
                tile.replace("https:", "http:"),
                tile.replace("org", "org.example.com"),
                tile.replace("404.png", "notes.png"),
            )) assertFalse(osmTileAllowed(url, true))
    }
}
