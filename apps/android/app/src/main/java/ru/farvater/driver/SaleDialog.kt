package ru.farvater.driver

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import org.json.JSONObject
import java.math.BigDecimal

@Composable
internal fun SaleDialog(stop: Stop, options: List<SaleOption>, close: () -> Unit, submit: (JSONObject) -> Unit) {
    var selected by rememberSaveable { mutableIntStateOf(options.firstOrNull()?.product?.id ?: 0) }
    val option = options.firstOrNull { it.product.id == selected }
    val available = option?.free ?: 0
    var quantity by rememberSaveable { mutableStateOf("") }
    var shells by rememberSaveable { mutableStateOf("0") }
    var empty by rememberSaveable { mutableStateOf("0") }
    var price by rememberSaveable(selected) {
        mutableStateOf(option?.let { BigDecimal.valueOf(it.product.price, 2).toPlainString().replace('.', ',') }.orEmpty())
    }
    var bank by rememberSaveable { mutableStateOf(stop.bank) }
    var company by rememberSaveable { mutableStateOf(stop.company) }
    var paid by rememberSaveable { mutableStateOf<Boolean?>(null) }
    var error by rememberSaveable { mutableStateOf("") }
    val units = readCount(quantity)
    val newShells = readCount(shells)
    val collected = readCount(empty)
    val unitPrice = readRubles(price)
    val total = if (units != null && newShells != null && unitPrice != null) runCatching {
        Math.addExact(Math.multiplyExact(units.toLong(), unitPrice), Math.multiplyExact(newShells.toLong(), stop.shellPrice))
    }.getOrNull() else null
    AlertDialog(onDismissRequest = close, title = { Text("Дополнительная продажа") }, text = {
        Column(Modifier.verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text("${stop.name} · ${stop.address}")
            Text("Бренд воды и свободный запас")
            options.forEach {
                FilterChip(selected = it.product.id == selected, onClick = { selected = it.product.id },
                    label = { Text("${it.product.name} · ${it.free} бут.") })
            }
            Input("Выдано воды, бут.", quantity, { quantity = it })
            Input("Цена воды за бутыль, ₽", price, { price = it }, KeyboardType.Decimal)
            Input("Продано новой тары, шт.", shells, { shells = it })
            Input("Принято пустой тары, шт.", empty, { empty = it })
            Text("К оплате · ${total?.let(::money) ?: "—"}", style = MaterialTheme.typography.titleMedium)
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                FilterChip(selected = !bank, onClick = { bank = false }, label = { Text("Наличные") })
                FilterChip(selected = bank, onClick = { bank = true }, label = { Text("Безналичные") })
            }
            if (bank) Input("Название компании", company, { company = it }, KeyboardType.Text)
            listOf(true to "Оплата подтверждена", false to "Пока не оплачено").forEach { (value, label) ->
                FilterChip(selected = paid == value, onClick = { paid = value }, label = { Text(label) })
            }
            if (error.isNotEmpty()) Text(error, color = MaterialTheme.colorScheme.error)
        }
    }, confirmButton = {
        Button(onClick = {
            error = when {
                option == null -> "Выберите доступный бренд воды"
                units == null || units !in 1..available -> "Укажите количество в пределах свободного остатка выбранного бренда"
                newShells == null || newShells > units -> "Количество новой тары не может превышать количество воды"
                unitPrice == null || unitPrice <= 0 || total == null -> "Проверьте цену воды"
                collected == null -> "Укажите количество пустой тары"
                bank && company.isBlank() -> "Укажите название компании для безнала"
                paid == null -> "Отметьте, подтверждена ли оплата"
                else -> {
                    submit(json("customer_order_id" to stop.id, "product_id" to option.product.id, "water" to units, "new_shells" to newShells,
                        "water_price" to unitPrice, "payment_method" to if (bank) "bank" else "cash",
                        "company" to if (bank) company.trim() else "", "paid" to (paid == true), "empty" to collected))
                    ""
                }
            }
        }) { Text("Уже выдано") }
    }, dismissButton = { TextButton(onClick = close) { Text("Назад") } })
}
