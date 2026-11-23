package ru.farvater.driver

import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test

class BrandStockTest {
    private val catalog = listOf(Product(1, "А", 15000), Product(2, "Б", 18000))
    private val stock = listOf(StockItem(1, "А", 5, 6), StockItem(2, "Б", 2, 2))

    @Test fun cannotReplacePlannedBrandWithSameNumberOfAnotherBrand() {
        val rows = brandCounts(catalog, stock, loading = true)
        assertNull(enteredStock(rows, listOf("4", "3"), loading = true))
        assertEquals(mapOf(1 to 5, 2 to 3), enteredStock(rows, listOf("5", "3"), loading = true))
    }

    @Test fun additionalBrandCanBeLoadedWithoutChangingPlannedQuantity() {
        val rows = brandCounts(catalog, stock.take(1), loading = true)
        assertEquals(listOf(5, 0), rows.map { it.expected })
        assertEquals(mapOf(1 to 5, 2 to 1), enteredStock(rows, listOf("5", "1"), loading = true))
    }

    @Test fun freeStockHonorsAllReservationsForEachBrand() {
        val reserved = listOf(OrderItem(1, "А", 4, 15000), OrderItem(1, "А", 1, 15000), OrderItem(2, "Б", 2, 18000))
        assertEquals(listOf(SaleOption(catalog[0], 1)), saleOptions(catalog, stock, reserved))
        assertTrue(saleOptions(catalog, stock, reserved + OrderItem(1, "А", 1, 15000)).isEmpty())
    }

    @Test fun settlementKeepsRetiredBrandAndCombinesBothTrips() {
        val retired = StockItem(3, "Архивная вода", 2, 1)
        val rows = brandCounts(catalog, stock + retired + stock.take(1), loading = false)
        assertEquals(listOf(12, 2, 1), rows.map { it.expected })
        assertEquals(emptyMap<Int, Int>(), enteredStock(rows, listOf("0", "0", "0"), loading = false))
        assertNull(enteredStock(rows, listOf("0", "0", ""), loading = false))
    }

    @Test fun readsMixedOrderAndOpposingReconciliationDifferencesFromApi() {
        val data = JSONObject("""{
            "products":[{"id":1,"name":"А","water_price":15000},{"id":2,"name":"Б","water_price":18000}],
            "shifts":[], "trips":[{"id":7,"number":1,"status":"returned","planned_water":4,"stock_items":[
                {"product_id":1,"name":"А","planned_water":3,"water_left":1},
                {"product_id":2,"name":"Б","planned_water":1,"water_left":1}]}],
            "orders":[{"id":1,"trip_id":7,"position":1,"version":2,"window_start":660,"window_end":720,
                "eta":682,"water":4,"new_shells":0,"water_price":15000,"shell_price":25000,"total":63000,
                "status":"delivered","items":[{"product_id":1,"name":"А","water":3,"water_price":15000},
                {"product_id":2,"name":"Б","water":1,"water_price":18000}]}],
            "reports":[{"matched":false,"earnings":45000,"unpaid":0,
                "expected":{"water":2,"empty":0,"cash":63000,"bank":0},
                "actual":{"water":2,"empty":0,"cash":63000,"bank":0},
                "difference":{"water":0,"empty":0,"cash":0,"bank":0},
                "stock_items":[{"product_id":1,"name":"А","expected":1,"actual":2,"difference":1},
                {"product_id":2,"name":"Б","expected":1,"actual":0,"difference":-1}]}]
        }""")
        val day = Day.parse(data)
        assertEquals(catalog, day.products)
        assertEquals(listOf(3, 1), day.stops.single().items.map { it.water })
        assertEquals(listOf(1, 1), day.trips.single().stock.map { it.left })
        assertEquals(listOf(1, -1), day.report!!.stock.map { it.difference })
        assertFalse(day.report.matched)
    }
}
