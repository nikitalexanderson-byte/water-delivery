package ru.farvater.driver

import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.text.input.KeyboardType
import java.math.BigDecimal
import org.json.JSONObject

@Composable
internal fun SaleDialog(
    stop: Stop,
    options: List<SaleOption>,
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
    var method by rememberSaveable { mutableStateOf(if (stop.bank) "bank" else "cash") }
    var company by rememberSaveable { mutableStateOf(stop.company) }
    var paid by rememberSaveable { mutableStateOf<String?>(null) }
    var error by rememberSaveable { mutableStateOf("") }
    val units = readCount(quantity)
    val newShells = readCount(shells)
    val collected = readCount(empty)
    val unitPrice = readRubles(price)
    val total =
        if (units != null && newShells != null && unitPrice != null)
            runCatching {
                    Math.addExact(
                        Math.multiplyExact(units.toLong(), unitPrice),
                        Math.multiplyExact(newShells.toLong(), stop.shellPrice),
                    )
                }
                .getOrNull()
        else null
    FormPage(
        "Продажа из запаса",
        "Подтвердить выдачу",
        close,
        confirm = {
            error =
                when {
                    option == null -> "Выберите доступный бренд"
                    units == null || units !in 1..option.free ->
                        "Укажите количество в пределах свободного запаса"
                    newShells == null || newShells > units ->
                        "Количество новой тары превышает количество воды"
                    unitPrice == null || unitPrice <= 0 || total == null -> "Проверьте цену воды"
                    collected == null -> "Введите количество принятой тары"
                    method == "bank" && company.isBlank() -> "Укажите название компании для безнала"
                    paid == null -> "Отметьте, получена ли оплата"
                    else -> {
                        submit(
                            json(
                                "customer_order_id" to stop.id,
                                "product_id" to option.product.id,
                                "water" to units,
                                "new_shells" to newShells,
                                "water_price" to unitPrice,
                                "payment_method" to method,
                                "company" to if (method == "bank") company.trim() else "",
                                "paid" to (paid == "paid"),
                                "empty" to collected,
                            )
                        )
                        ""
                    }
                }
        },
        enabled = enabled,
        error = error.ifBlank { serverError },
    ) {
        CardBlock {
            Heading(stop.name)
            Muted(stop.address)
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
        }
    }
}
