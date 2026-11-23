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

    @Test
    fun crewCanBeChangedAfterPlanningAndBeforeFirstDeparture() {
        val planned = listOf(trip.copy(status = "planned", startedAt = null))
        assertTrue(day(status = "pending", trips = emptyList()).canEditCrew())
        assertTrue(day(status = "confirmed", trips = planned).canEditCrew())
        assertFalse(day(status = "active").canEditCrew())
        assertFalse(day(status = "confirmed", trips = planned + trip.copy(status = "returned")).canEditCrew())
    }

    @Test
    fun choosesMttWhenInstalledAndRespectsDriverOverride() {
        val installed = listOf("com.example.dialer", MTT_PACKAGE)
        assertEquals(MTT_PACKAGE, dialChoice(null, installed))
        assertEquals("com.example.dialer", dialChoice("com.example.dialer", installed))
        assertEquals("ask", dialChoice("ask", installed))
        assertEquals("system", dialChoice("system", installed))
        assertEquals("system", dialChoice(MTT_PACKAGE, emptyList()))
    }

    @Test
    fun newOnSiteCustomerRequiresContactAddressAndCategory() {
        assertNull(newSaleCustomer("Тест", "+7", "Адрес", "retail"))
        assertNull(newSaleCustomer("Тест", "123456", "", "retail"))
        val customer = newSaleCustomer(" Тест ", "+7 (000) 000-00-00", " Адрес ", "wholesale")!!
        assertEquals("Тест", customer.getString("name"))
        assertEquals("Адрес", customer.getString("address"))
        assertEquals("wholesale", customer.getString("category"))
    }

    @Test
    fun remindersOnlyCoverUpcomingPublishedOfficeOrders() {
        val day = day(stops = listOf(stop(1,"assigned"), stop(2,"delivered"), stop(3,"assigned").copy(onSite = true)))
        val whenToCall = callTime("2026-11-23", 570, "Europe/Moscow")
        assertEquals(mapOf(1 to whenToCall), callSchedule(day, "2026-11-23", "Europe/Moscow", whenToCall))
        assertTrue(callSchedule(day, "2026-11-23", "Europe/Moscow", whenToCall + 90 * 60_000).isEmpty())
        assertTrue(callSchedule(day.copy(shift = shift.copy(published = false)), "2026-11-23", "Europe/Moscow", whenToCall).isEmpty())
    }

    @Test
    fun standaloneSaleIsAccountedWithoutScheduledEtaOrStopPosition() {
        val data = JSONObject("""{"shifts":[],"trips":[],"reports":[],"orders":[{"id":8,"trip_id":7,
          "position":null,"version":2,"window_start":480,"window_end":720,"eta":null,"water":1,
          "new_shells":0,"water_price":10000,"shell_price":25000,"total":10000,"status":"delivered",
          "paid":true,"origin":"on_site","source_order_id":null}]}""")
        val sale = Day.parse(data).stops.single()
        assertTrue(sale.paid && sale.onSite)
        assertNull(sale.sourceOrderId)
        val completed = day(stops = listOf(sale))
        assertTrue(completed.mapTrips(7).single().points.isEmpty())
        assertEquals("return", completed.focus(true).kind)
    }

    @Test
    fun onlyExplicitlyUnassignedAccountsNeedToAcceptAnInvitation() {
        assertTrue(needsTeamInvite(json("role" to "driver", "team_id" to JSONObject.NULL)))
        assertFalse(needsTeamInvite(json("role" to "driver", "team_id" to 2)))
        assertFalse(needsTeamInvite(json("role" to "driver")))
        assertEquals("local:5", accountScope("local", json("id" to 5)))
        assertNotEquals(accountScope("local", json("id" to 5, "team_id" to 1)),
            accountScope("local", json("id" to 5, "team_id" to 2)))
    }
}
