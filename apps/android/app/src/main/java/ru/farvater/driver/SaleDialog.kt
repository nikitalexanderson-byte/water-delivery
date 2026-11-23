package ru.farvater.driver

import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.text.input.KeyboardType
import java.math.BigDecimal
import org.json.JSONObject

internal fun newSaleCustomer(name: String, phone: String, address: String, category: String): JSONObject? {
    val phoneText = phone.trim()
    if (name.trim().length !in 1..300 || address.trim().length !in 1..300 ||
        phoneText.count(Char::isDigit) !in 6..15 || !phoneText.matches(Regex("""\+?[0-9 ()-]{6,24}""")) ||
        category !in setOf("retail", "wholesale")) return null
    return json("name" to name.trim(), "phone" to phoneText, "address" to address.trim(), "category" to category)
}

@Composable
internal fun SaleDialog(
    stop: Stop?,
    options: List<SaleOption>,
    shellPrice: Long?,
    close: () -> Unit,
    enabled: Boolean,
    serverError: String,
    submit: (JSONObject) -> Unit,
) {
    var selected by rememberSaveable { mutableIntStateOf(options.firstOrNull()?.product?.id ?: 0) }
    val option = options.firstOrNull { it.product.id == selected }
    var quantity by rememberSaveable { mutableStateOf("") }
    var shells by rememberSaveable { mutableStateOf("0") }
    var empty by rememberSaveable { mutableStateOf("0") }
    var price by
        rememberSaveable(selected) {
            mutableStateOf(
                option
                    ?.let {
                        BigDecimal.valueOf(it.product.price, 2).toPlainString().replace('.', ',')
                    }
                    .orEmpty()
            )
        }
    var name by rememberSaveable { mutableStateOf("") }
    var phone by rememberSaveable { mutableStateOf("") }
    var address by rememberSaveable { mutableStateOf("") }
    var category by rememberSaveable { mutableStateOf("retail") }
    val customer = if (stop == null) newSaleCustomer(name, phone, address, category) else null
    var method by rememberSaveable { mutableStateOf(if (stop?.bank == true) "bank" else "cash") }
    var company by rememberSaveable { mutableStateOf(stop?.company.orEmpty()) }
    var paid by rememberSaveable { mutableStateOf<String?>(null) }
    var error by rememberSaveable { mutableStateOf("") }
    val units = readCount(quantity)
    val newShells = readCount(shells)
    val collected = readCount(empty)
    val unitPrice = readRubles(price)
    val total =
        if (units != null && newShells != null && unitPrice != null && (newShells == 0 || shellPrice != null))
            runCatching {
                    Math.addExact(
                        Math.multiplyExact(units.toLong(), unitPrice),
                        Math.multiplyExact(newShells.toLong(), shellPrice ?: 0),
                    )
                }
                .getOrNull()
        else null
    FormPage(
        "Заказ на месте",
        "Уже выдано",
        close,
        confirm = {
            error =
                when {
                    stop == null && customer == null -> "Проверьте имя, телефон и адрес нового клиента"
                    option == null -> "Выберите доступный бренд"
                    units == null || units !in 1..option.free ->
                        "Укажите количество в пределах свободного запаса"
                    newShells == null || newShells > units ->
                        "Количество новой тары превышает количество воды"
                    newShells > 0 && shellPrice == null -> "Обновите смену, чтобы загрузить цену тары"
                    unitPrice == null || unitPrice !in 1..10_000_000 || total == null -> "Проверьте цену воды"
                    collected == null || collected > 10_000 -> "Проверьте количество принятой тары"
                    method == "bank" && company.isBlank() -> "Укажите название компании для безнала"
                    method == "bank" && company.trim().length > 200 -> "Сократите название компании до 200 символов"
                    paid == null -> "Отметьте, получена ли оплата"
                    else -> {
                        submit(
                            json(
                                "product_id" to option.product.id,
                                "water" to units,
                                "new_shells" to newShells,
                                "water_price" to unitPrice,
                                "payment_method" to method,
                                "company" to if (method == "bank") company.trim() else "",
                                "paid" to (paid == "paid"),
                                "empty" to collected,
                            ).apply {
                                if (stop != null) put("customer_order_id", stop.id)
                                else put("new_customer", customer)
                            }
                        )
                        ""
                    }
                }
        },
        enabled = enabled,
        error = error.ifBlank { serverError },
    ) {
        CardBlock {
            if (stop != null) {
                Heading(stop.name)
                Muted(stop.address)
            } else {
                Heading("Новый клиент")
                Input("Имя клиента", name, { name = it }, KeyboardType.Text)
                Input("Телефон", phone, { phone = it }, KeyboardType.Phone)
                Input("Адрес выдачи", address, { address = it }, KeyboardType.Text)
                Choices(listOf("retail" to "Розничный клиент", "wholesale" to "Оптовый клиент"), category) { category = it }
            }
        }
        CardBlock {
            Heading("Свободная вода")
            Choices(
                options.map { it.product.id.toString() to "${it.product.name} · ${it.free} бут." },
                selected.toString(),
            ) {
                selected = it.toInt()
            }
            Input("Выдано", quantity, { quantity = it }, suffix = "бут.")
            Input("Цена за бутыль", price, { price = it }, KeyboardType.Decimal, suffix = "₽")
        }
        CardBlock {
            Heading("Тара")
            shellPrice?.let { PairLine("Цена новой тары", money(it)) }
            Input("Продано новой", shells, { shells = it }, suffix = "шт.")
            Input("Принято пустой", empty, { empty = it }, suffix = "шт.")
        }
        CardBlock {
            Heading("Оплата")
            Choices(listOf("cash" to "Наличные", "bank" to "Безналичные"), method) { method = it }
            if (method == "bank")
                Input("Название компании", company, { company = it }, KeyboardType.Text)
            PairLine("Итого", total?.let(::money) ?: "—")
            Choices(listOf("paid" to "Оплата подтверждена", "unpaid" to "Пока не оплачено"), paid) {
                paid = it
            }
            Muted("После подтверждения выданная вода спишется из свободного запаса рейса.")
        }
    }
}
