package ru.farvater.driver

import android.app.TimePickerDialog
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.selection.selectableGroup
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import java.time.LocalTime
import org.json.JSONArray
import org.json.JSONObject

internal data class BrandCount(val id: Int, val name: String, val expected: Int)

internal fun brandCounts(
    products: List<Product>,
    rows: List<StockItem>,
    loading: Boolean,
): List<BrandCount> {
    val names = (rows.map { it.productId to it.name } + products.map { it.id to it.name }).toMap()
    val expected =
        rows
            .groupBy { it.productId }
            .mapValues { (_, items) -> items.sumOf { if (loading) it.planned else it.left } }
    return names
        .map { (id, name) -> BrandCount(id, name, expected[id] ?: 0) }
        .sortedWith(compareByDescending<BrandCount> { it.expected > 0 }.thenBy { it.id })
}

internal fun defaultBrandIds(rows: List<StockItem>, loading: Boolean): Set<Int> =
    rows.filter { !loading || it.planned > 0 }.mapTo(mutableSetOf()) { it.productId }

internal fun enteredStock(
    brands: List<BrandCount>,
    values: List<String>,
    loading: Boolean,
): Map<Int, Int>? {
    if (brands.size != values.size || (loading && brands.isEmpty())) return null
    return buildMap {
        brands.forEachIndexed { i, b ->
            val n = readCount(values[i]) ?: return null
            if (n > 10000 || (loading && n < b.expected)) return null
            if (n > 0) put(b.id, n)
        }
    }
}

@Composable
internal fun Input(
    label: String,
    value: String,
    change: (String) -> Unit,
    keyboard: KeyboardType = KeyboardType.Number,
    hint: String? = null,
    suffix: String? = null,
) {
    OutlinedTextField(
        value = value,
        onValueChange = change,
        label = { Text(label) },
        singleLine = true,
        supportingText = hint?.let { { Text(withMetrics(it)) } },
        textStyle =
            LocalTextStyle.current.copy(
                color =
                    if (suffix != null) MaterialTheme.colorScheme.tertiary
                    else MaterialTheme.colorScheme.onSurface
            ),
        suffix = suffix?.let { { Text(it, color = MaterialTheme.colorScheme.tertiary) } },
        modifier = Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(11.dp),
        keyboardOptions = KeyboardOptions(keyboardType = keyboard, imeAction = ImeAction.Next),
    )
}

@Composable
internal fun Choices(
    options: List<Pair<String, String>>,
    selected: String?,
    choose: (String) -> Unit,
) {
    Column(
        Modifier.fillMaxWidth().selectableGroup(),
        verticalArrangement = Arrangement.spacedBy(4.dp),
    ) {
        options.forEach { (id, name) ->
            Surface(
                shape = RoundedCornerShape(10.dp),
                color =
                    if (id == selected) MaterialTheme.colorScheme.secondaryContainer
                    else MaterialTheme.colorScheme.surfaceVariant,
            ) {
                Row(
                    Modifier.fillMaxWidth()
                        .selectable(
                            selected = id == selected,
                            role = Role.RadioButton,
                            onClick = { choose(id) },
                        )
                        .heightIn(min = 48.dp)
                        .padding(horizontal = 12.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(9.dp),
                ) {
                    RadioButton(selected = id == selected, onClick = null)
                    Text(name)
                }
            }
        }
    }
}

@Composable
private fun TimeField(label: String, time: String, change: (String) -> Unit) {
    val context = LocalContext.current
    OutlinedTextField(
        value = time,
        onValueChange = change,
        label = { Text(label) },
        placeholder = { Text("чч:мм") },
        modifier = Modifier.fillMaxWidth(),
        singleLine = true,
        shape = RoundedCornerShape(11.dp),
        keyboardOptions =
            KeyboardOptions(keyboardType = KeyboardType.Ascii, imeAction = ImeAction.Done),
        trailingIcon = {
            IconButton(
                onClick = {
                    val minutes = readTime(time)
                    val now = LocalTime.now()
                    TimePickerDialog(
                            context,
                            { _, h, m -> change(clock(h * 60 + m)) },
                            minutes?.div(60) ?: now.hour,
                            minutes?.rem(60) ?: now.minute,
                            true,
                        )
                        .show()
                }
            ) {
                Symbol(Mark.Time, "Выбрать время")
            }
        },
    )
}

@Composable
internal fun OperationDialog(
    kind: String,
    id: Int,
    day: Day?,
    onDismiss: () -> Unit,
    enabled: Boolean,
    serverError: String,
    submit: (String, JSONObject, String) -> Unit,
) {
    val shift = day?.shift ?: return
    val trip = day.trips.find { it.id == id }
    val stop = day.stops.find { it.id == id }
    val loading = kind == "start"
    val stock = if (loading) trip?.stock.orEmpty() else day.trips.flatMap { it.stock }
    val brands = brandCounts(day.products, stock, loading)
    val defaults = defaultBrandIds(stock, loading)
    var added by rememberSaveable(kind, id) { mutableStateOf(arrayListOf<Int>()) }
    val visible = brands.filter { it.id in defaults || it.id in added }
    var values by
        rememberSaveable(kind, id, brands.map { it.id }) {
            mutableStateOf(ArrayList(brands.map { if (loading) it.expected.toString() else "" }))
        }
    var time by rememberSaveable { mutableStateOf("") }
    var empty by rememberSaveable { mutableStateOf("") }
    var cash by rememberSaveable { mutableStateOf("") }
    var bank by rememberSaveable { mutableStateOf("") }
    var loader by rememberSaveable { mutableStateOf(if (shift.loader) "" else "0") }
    var paid by rememberSaveable { mutableStateOf<String?>(null) }
    var reason by rememberSaveable { mutableStateOf("") }
    var error by rememberSaveable { mutableStateOf("") }
    val title =
        when (kind) {
            "start" -> "Загрузка и выезд"
            "return" -> "Возврат на базу"
            "deliver" -> "Подтверждение доставки"
            "fail" -> "Проблема с доставкой"
            else -> "Сдача смены"
        }
    val action =
        when (kind) {
            "start" -> "Начать рейс"
            "return" -> "Зафиксировать возврат"
            "deliver" -> "Подтвердить доставку"
            "fail" -> "Сообщить оператору"
            else -> "Сдать тару и деньги"
        }
    FormPage(
        title,
        action,
        onDismiss,
        confirm = {
            error = ""
            val counts =
                enteredStock(
                    visible,
                    visible.map { row -> values[brands.indexOfFirst { it.id == row.id }] },
                    loading,
                )
            val items =
                JSONArray().apply {
                    counts?.forEach { (productId, n) ->
                        put(json("product_id" to productId, "water" to n))
                    }
                }
            val full = counts?.values?.sum()
            val empties = readCount(empty)
            val minutes = readTime(time)
            when (kind) {
                "start" ->
                    when {
                        trip == null -> error = "Обновите маршрут"
                        full == null || full < trip.plannedWater ->
                            error = "Проверьте загрузку каждого бренда по плану рейса"
                        minutes == null -> error = "Введите время выезда в формате чч:мм"
                        else ->
                            submit(
                                "trips/$id/start",
                                json("actual_start" to minutes, "water" to full, "items" to items),
                                "Выезд сохранён",
                            )
                    }
                "return" ->
                    when {
                        minutes == null -> error = "Введите время возврата в формате чч:мм"
                        minutes < (trip?.startedAt ?: 0) ->
                            error = "Время возврата должно быть после выезда"
                        else ->
                            submit(
                                "trips/$id/return",
                                json("actual_return" to minutes),
                                "Возврат сохранён",
                            )
                    }
                "deliver" ->
                    when {
                        stop == null -> error = "Обновите маршрут"
                        empties == null -> error = "Введите количество пустых бутылей, включая 0"
                        paid == null -> error = "Отметьте, получена ли оплата"
                        else ->
                            submit(
                                "orders/$id/deliver",
                                json(
                                    "version" to stop.version,
                                    "empty" to empties,
                                    "paid" to (paid == "paid"),
                                ),
                                "Доставка подтверждена",
                            )
                    }
                "fail" ->
                    when {
                        stop == null -> error = "Обновите маршрут"
                        reason.isBlank() -> error = "Укажите причину для оператора"
                        else ->
                            submit(
                                "orders/$id/fail",
                                json("version" to stop.version, "reason" to reason.trim()),
                                "Проблема передана оператору",
                            )
                    }
                "settle" -> {
                    val cashKop = readRubles(cash)
                    val bankKop = readRubles(bank)
                    val work = readCount(loader)
                    when {
                        full == null || empties == null ->
                            error = "Введите фактические остатки воды и пустой тары, включая 0"
                        cashKop == null || bankKop == null ->
                            error = "Введите обе суммы в рублях, включая 0"
                        work == null -> error = "Введите время работы грузчика в минутах"
                        else ->
                            submit(
                                "shifts/$id/settle",
                                json(
                                    "water" to full,
                                    "items" to items,
                                    "empty" to empties,
                                    "cash" to cashKop,
                                    "bank" to bankKop,
                                    "loader_minutes" to work,
                                ),
                                "Смена сдана",
                            )
                    }
                }
            }
        },
        enabled = enabled,
        error = error.ifBlank { serverError },
    ) {
        when (kind) {
            "start",
            "settle" -> {
                CardBlock {
                    Heading(if (loading) "Фактическая загрузка" else "Возврат воды")
                    if (loading) Muted("Рейс ${trip?.number} · план ${trip?.plannedWater} бут.")
                    else Muted("Пересчитайте остатки по брендам. Введите 0 для пустой позиции.")
                    visible.forEach { row ->
                        val index = brands.indexOfFirst { it.id == row.id }
                        Input(
                            row.name,
                            values[index],
                            { v -> values = ArrayList(values).apply { set(index, v) } },
                            hint =
                                if (loading) "По плану · ${row.expected} бут."
                                else "По учёту · ${row.expected} бут.",
                            suffix = "бут.",
                        )
                    }
                    val other = brands.filterNot { it.id in defaults || it.id in added }
                    if (other.isNotEmpty()) {
                        var expanded by remember { mutableStateOf(false) }
                        Box {
                            TextButton(
                                onClick = { expanded = true },
                                modifier = Modifier.heightIn(min = 48.dp),
                            ) {
                                Symbol(Mark.Plus, size = 18)
                                Text(
                                    if (loading) "Добавить воду в запас"
                                    else "Добавить другой бренд"
                                )
                            }
                            DropdownMenu(
                                expanded = expanded,
                                onDismissRequest = { expanded = false },
                            ) {
                                other.forEach { row ->
                                    DropdownMenuItem(
                                        text = { Text(row.name) },
                                        onClick = {
                                            added = ArrayList(added).apply { add(row.id) }
                                            expanded = false
                                        },
                                    )
                                }
                            }
                        }
                    }
                }
                if (loading)
                    CardBlock {
                        Heading("Выезд")
                        TimeField("Фактическое время", time) { time = it }
                        Muted("Рабочее время · ${clock(shift.start)}–${clock(shift.end)}")
                    }
                else {
                    CardBlock {
                        Heading("Пустая тара")
                        Input("Сдано на базу", empty, { empty = it }, suffix = "шт.")
                    }
                    CardBlock {
                        Heading("Деньги")
                        Input(
                            "Сдано наличными",
                            cash,
                            { cash = it },
                            KeyboardType.Decimal,
                            suffix = "₽",
                        )
                        Input(
                            "Подтверждено по безналу",
                            bank,
                            { bank = it },
                            KeyboardType.Decimal,
                            suffix = "₽",
                        )
                    }
                    if (shift.loader)
                        CardBlock {
                            Heading("Грузчик")
                            Input("Время работы", loader, { loader = it }, suffix = "мин")
                        }
                }
            }
            "return" ->
                CardBlock {
                    Heading("Рейс ${trip?.number}")
                    trip?.startedAt?.let { PairLine("Время выезда", clock(it)) }
                    TimeField("Прибытие на производство", time) { time = it }
                }
            "deliver" -> {
                CardBlock {
                    Heading(stop?.name.orEmpty())
                    Muted(stop?.address.orEmpty())
                    stop?.items?.forEach { PairLine(it.name, "${it.water} бут.") }
                    if ((stop?.shells ?: 0) > 0)
                        PairLine("Продано новой тары", "${stop?.shells} шт.")
                    Input("Принято пустой тары", empty, { empty = it }, suffix = "шт.")
                }
                CardBlock {
                    Heading("Оплата")
                    PairLine(
                        if (stop?.bank == true) "Безналичные" else "Наличные",
                        money(stop?.total ?: 0L),
                    )
                    Choices(
                        listOf("paid" to "Оплата подтверждена", "unpaid" to "Пока не оплачено"),
                        paid,
                    ) {
                        paid = it
                    }
                }
            }
            "fail" ->
                CardBlock {
                    Heading(stop?.name.orEmpty())
                    Muted(stop?.address.orEmpty())
                    Text("Вода останется в остатке рейса.")
                    OutlinedTextField(
                        value = reason,
                        onValueChange = { reason = it },
                        label = { Text("Причина для оператора") },
                        minLines = 3,
                        modifier = Modifier.fillMaxWidth(),
                        shape = RoundedCornerShape(11.dp),
                    )
                }
        }
    }
}
