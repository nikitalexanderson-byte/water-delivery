package ru.farvater.driver

import androidx.compose.ui.graphics.vector.PathParser
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test

class WorkspaceTest {
    private val shift = Shift(5, "Тест", "ГАЗель", 2600, 480, 1080, false, "active", true)
    private val trip = Trip(7, 1, "active", 4, 2, 2, 510, emptyList())

    private fun day(
        status: String = "active",
        trips: List<Trip> = listOf(trip),
        stops: List<Stop> = emptyList(),
    ) = Day(shift.copy(status = status), trips, stops, null, emptyList())

    private fun stop(id: Int, status: String) =
        Stop(
            id,
            7,
            id,
            1,
            "Клиент",
            "Адрес",
            "",
            "",
            1,
            true,
            false,
            540,
            780,
            570,
            2,
            0,
            10000,
            25000,
            20000,
            false,
            "",
            status,
            false,
            false,
            "",
            emptyList(),
        )

    @Test
    fun choosesOnlyTheNextOpenStop() {
        val d = day(stops = listOf(stop(1, "delivered"), stop(2, "assigned"), stop(3, "assigned")))
        assertEquals(ShiftFocus("point", 2), d.focus(true))
        assertEquals(ShiftFocus("return", 7), d.copy(stops = listOf(stop(1, "failed"))).focus(true))
    }

    @Test
    fun shiftLifecycleDeterminesThePrimaryAction() {
        assertEquals(ShiftFocus("confirm", 5), day(status = "pending").focus(false))
        assertEquals(
            ShiftFocus("preview", 7),
            day(status = "confirmed", trips = listOf(trip.copy(status = "planned"))).focus(false),
        )
        assertEquals(
            ShiftFocus("start", 7),
            day(status = "confirmed", trips = listOf(trip.copy(status = "planned"))).focus(true),
        )
        assertEquals(
            ShiftFocus("settle", 5),
            day(trips = listOf(trip.copy(status = "returned"))).focus(true),
        )
        assertEquals(ShiftFocus("report"), day(status = "closed").focus(true))
    }

    @Test
    fun countFormsStartWithOnlyRelevantProducts() {
        val rows = listOf(StockItem(1, "А", 5, 0), StockItem(3, "Б", 0, 2))
        assertEquals(setOf(1), defaultBrandIds(rows, true))
        assertEquals(setOf(1, 3), defaultBrandIds(rows, false))
        assertEquals(emptyMap<Int, Int>(), enteredStock(emptyList(), emptyList(), false))
        assertNull(enteredStock(emptyList(), emptyList(), true))
    }

    @Test
    fun optionalAccessDetailsWorkWithOldAndNewOrders() {
        val data =
            JSONObject(
                """{"shifts":[],"trips":[],"reports":[],"orders":[{"id":5,"trip_id":7,
          "position":1,"version":1,"window_start":480,"window_end":720,"eta":550,"water":3,
          "new_shells":0,"water_price":10000,"shell_price":25000,"total":30000}]}"""
            )
        assertEquals("", Day.parse(data).stops.single().altPhone)
        data
            .getJSONArray("orders")
            .getJSONObject(0)
            .put("alt_phone", "+70000000000")
            .put("entrance", "Б")
            .put("paid_entry", true)
            .put("intercom", JSONObject.NULL)
        val point = Day.parse(data).stops.single()
        assertEquals("+70000000000", point.altPhone)
        assertEquals("Б", point.entrance)
        assertTrue(point.paidEntry)
        assertEquals("", point.intercom)
    }

    @Test
    fun routeSymbolsContainValidVectorPaths() {
        Mark.entries.forEach {
            assertTrue(PathParser().parsePathString(it.shape).toNodes().isNotEmpty())
        }
    }
}
