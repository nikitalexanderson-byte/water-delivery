package ru.farvater.driver

import org.json.JSONArray
import org.json.JSONObject
import java.math.BigDecimal
import java.text.NumberFormat
import java.util.Locale

internal fun json(vararg fields: Pair<String, Any>): JSONObject =
    JSONObject().apply { fields.forEach { (key, value) -> put(key, value) } }

private fun JSONObject.text(key: String) = if (isNull(key)) "" else getString(key)
private fun <T> JSONArray.mapObjects(transform: (JSONObject) -> T): List<T> =
    List(length()) { index -> transform(getJSONObject(index)) }

internal data class Product(val id: Int, val name: String, val price: Long)
internal data class OrderItem(val productId: Int, val name: String, val water: Int, val price: Long)
internal data class StockItem(val productId: Int, val name: String, val planned: Int, val left: Int)
internal data class StockReport(val productId: Int, val name: String, val expected: Int, val actual: Int, val difference: Int)
internal data class SaleOption(val product: Product, val free: Int)

internal fun saleOptions(products: List<Product>, stock: List<StockItem>, reserved: List<OrderItem>): List<SaleOption> {
    val reservedByBrand = reserved.groupBy { it.productId }.mapValues { (_, items) -> items.sumOf { it.water } }
    val productById = products.associateBy { it.id }
    return stock.mapNotNull { row ->
        val product = productById[row.productId] ?: return@mapNotNull null
        val free = row.left - (reservedByBrand[row.productId] ?: 0)
        if (free > 0) SaleOption(product, free) else null
    }
}

internal data class Stop(
    val id: Int, val tripId: Int, val position: Int, val version: Int,
    val name: String, val address: String, val phone: String, val note: String,
    val floor: Int, val lift: Boolean, val checkpoint: Boolean,
    val start: Int, val end: Int, val eta: Int, val water: Int, val shells: Int,
    val waterPrice: Long, val shellPrice: Long, val total: Long, val bank: Boolean,
    val company: String, val status: String, val paid: Boolean, val onSite: Boolean, val failureReason: String,
    val items: List<OrderItem>, val altPhone: String = "", val entrance: String = "",
    val unit: String = "", val intercom: String = "", val accessInstructions: String = "", val paidEntry: Boolean = false,
    val latitude: Double? = null, val longitude: Double? = null, val sourceOrderId: Int? = null
)

internal data class Trip(
    val id: Int, val number: Int, val status: String, val plannedWater: Int,
    val waterLeft: Int, val collected: Int, val startedAt: Int?, val stock: List<StockItem>
)

internal data class Shift(
    val id: Int, val driver: String, val vehicle: String, val capacity: Int,
    val start: Int, val end: Int, val loader: Boolean, val status: String, val published: Boolean
)

internal data class Counts(val water: Int, val empty: Int, val cash: Long, val bank: Long) {
    companion object {
        fun parse(data: JSONObject) = Counts(
            data.getInt("water"), data.getInt("empty"), data.getLong("cash"), data.getLong("bank")
        )
    }
}
internal data class Report(
    val matched: Boolean, val expected: Counts, val actual: Counts, val difference: Counts,
    val earnings: Long, val unpaid: Long, val stock: List<StockReport>
)
internal data class Day(val shift: Shift?, val trips: List<Trip>, val stops: List<Stop>, val report: Report?, val products: List<Product>) {
    fun sales(trip: Trip): List<SaleOption> {
        val reserved = stops.filter { it.tripId == trip.id && it.status == "assigned" }.flatMap { it.items }
        return saleOptions(products, trip.stock, reserved)
    }
    companion object {
        fun parse(data: JSONObject): Day {
            val shift = data.getJSONArray("shifts").optJSONObject(0)?.let {
                Shift(it.getInt("id"), it.text("driver_name"), it.text("vehicle_name"),
                    it.getInt("capacity_kg"), it.getInt("start_min"), it.getInt("end_min"),
                    it.getBoolean("has_loader"), it.text("status"), it.getBoolean("published"))
            }
            val trips = data.getJSONArray("trips").mapObjects {
                Trip(it.getInt("id"), it.getInt("number"), it.text("status"), it.getInt("planned_water"),
                    it.optInt("water_left"), it.optInt("empty_collected"),
                    if (it.isNull("actual_start")) null else it.getInt("actual_start"),
                    it.optJSONArray("stock_items")?.mapObjects { row ->
                        StockItem(row.getInt("product_id"), row.getString("name"), row.getInt("planned_water"), row.getInt("water_left"))
                    }.orEmpty())
            }.sortedBy { it.number }
            val stops = data.getJSONArray("orders").mapObjects {
                val onSite = it.text("origin") == "on_site"
                Stop(it.getInt("id"), it.getInt("trip_id"), if (onSite) it.optInt("position") else it.getInt("position"), it.getInt("version"),
                    it.text("name"), it.text("address"), it.text("phone"), it.text("note"),
                    it.optInt("floor"), it.optBoolean("lift"), it.optBoolean("checkpoint"),
                    it.getInt("window_start"), it.getInt("window_end"), if (onSite) it.optInt("eta") else it.getInt("eta"),
                    it.getInt("water"), it.getInt("new_shells"), it.getLong("water_price"), it.getLong("shell_price"),
                    it.getLong("total"), it.text("payment_method") == "bank", it.text("company"),
                    it.text("status"), it.optBoolean("paid"), onSite, it.text("failure_reason"),
                    it.optJSONArray("items")?.mapObjects { row ->
                        OrderItem(row.getInt("product_id"), row.getString("name"), row.getInt("water"), row.getLong("water_price"))
                    }.orEmpty(), it.text("alt_phone"), it.text("entrance"), it.text("unit"), it.text("intercom"),
                    it.text("access_instructions"), it.optBoolean("paid_entry"),
                    it.optDouble("latitude").takeIf { value -> value in -90.0..90.0 },
                    it.optDouble("longitude").takeIf { value -> value in -180.0..180.0 },
                    it.optInt("source_order_id").takeIf { id -> id > 0 })
            }.sortedBy { it.position }
            val report = data.getJSONArray("reports").optJSONObject(0)?.let {
                Report(it.getBoolean("matched"), Counts.parse(it.getJSONObject("expected")),
                    Counts.parse(it.getJSONObject("actual")), Counts.parse(it.getJSONObject("difference")),
                    it.getLong("earnings"), it.getLong("unpaid"),
                    it.optJSONArray("stock_items")?.mapObjects { row ->
                        StockReport(row.getInt("product_id"), row.getString("name"), row.getInt("expected"),
                            row.getInt("actual"), row.getInt("difference"))
                    }.orEmpty())
            }
            val products = data.optJSONArray("products")?.mapObjects {
                Product(it.getInt("id"), it.getString("name"), it.getLong("water_price"))
            }.orEmpty().sortedBy { it.id }
            return Day(shift, trips, stops, report, products)
        }
    }
}

internal fun clock(minutes: Int) = "%02d:%02d".format(Locale.ROOT, minutes / 60, minutes % 60)
internal fun readTime(value: String): Int? {
    val match = Regex("""(\d{1,2}):(\d{2})""").matchEntire(value.trim()) ?: return null
    val (hour, minute) = match.destructured
    return if (hour.toInt() in 0..23 && minute.toInt() in 0..59) hour.toInt() * 60 + minute.toInt() else null
}
internal fun readCount(value: String) = value.trim().toIntOrNull()?.takeIf { it >= 0 }
internal fun readRubles(value: String): Long? {
    val normalized = value.trim().replace(',', '.')
    if (!Regex("""\d+(\.\d{1,2})?""").matches(normalized)) return null
    return runCatching { BigDecimal(normalized).movePointRight(2).longValueExact() }.getOrNull()
}
internal fun money(kopecks: Long): String = NumberFormat.getCurrencyInstance(Locale.forLanguageTag("ru-RU"))
    .apply { minimumFractionDigits = if (kopecks % 100L == 0L) 0 else 2 }
    .format(BigDecimal.valueOf(kopecks, 2))
