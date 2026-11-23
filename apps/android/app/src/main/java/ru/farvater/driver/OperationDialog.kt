package ru.farvater.driver

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import org.json.JSONObject

@Composable
internal fun Input(label: String, value: String, change: (String) -> Unit,
                  keyboard: KeyboardType = KeyboardType.Number, example: String? = null) {
    OutlinedTextField(value = value, onValueChange = change, label = { Text(label) }, singleLine = true,
        placeholder = example?.let { { Text(it) } }, modifier = Modifier.fillMaxWidth(),
        keyboardOptions = KeyboardOptions(keyboardType = keyboard))
}

@Composable
internal fun OperationDialog(
    kind: String, id: Int, day: Day?, onDismiss: () -> Unit,
    submit: (String, JSONObject, String) -> Unit
) {
    val trip = day?.trips?.find { it.id == id }
    val stop = day?.stops?.find { it.id == id }
    val shift = day?.shift ?: return
    var time by rememberSaveable { mutableStateOf("") }
    var water by rememberSaveable { mutableStateOf(if (kind == "start") trip?.plannedWater?.toString().orEmpty() else "") }
    var empty by rememberSaveable { mutableStateOf("") }
    var cash by rememberSaveable { mutableStateOf("") }
    var bank by rememberSaveable { mutableStateOf("") }
    var loader by rememberSaveable { mutableStateOf(if (shift.loader) "" else "0") }
    var paid by rememberSaveable { mutableStateOf<Boolean?>(null) }
    var error by rememberSaveable { mutableStateOf("") }
    var reason by rememberSaveable { mutableStateOf("") }
    val title = when (kind) {
        "start" -> "Загрузка и выезд"
        "deliver" -> "Факт доставки"
        "return" -> "Возврат на базу"
        "fail" -> "Доставка не состоялась"
        else -> "Сдать тару и деньги"
    }
    AlertDialog(onDismissRequest = onDismiss, title = { Text(title) }, text = {
        Column(modifier = Modifier.verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            when (kind) {
                "start" -> {
                    Text("Рейс ${trip?.number} · требуется ${trip?.plannedWater} полных бутылей")
                    Input("Фактически загружено, бут.", water, { water = it })
                    Input("Фактический выезд, чч:мм", time, { time = it }, KeyboardType.Ascii, "09:30")
                }
                "return" -> Input("Вернулись на базу, чч:мм", time, { time = it }, KeyboardType.Ascii, "17:10")
                "fail" -> {
                    Text(stop?.address.orEmpty())
                    Text("Укажите причину для диспетчера. Вода останется на борту.")
                    OutlinedTextField(value = reason, onValueChange = { reason = it },
                        label = { Text("Причина") }, modifier = Modifier.fillMaxWidth(), minLines = 2)
                }
                "deliver" -> {
                    Text(stop?.address.orEmpty(), style = MaterialTheme.typography.titleMedium)
                    Text("Выдано ${stop?.water} бут. воды и ${stop?.shells} новой тары")
                    Input("Принято пустой тары, шт.", empty, { empty = it })
                    Text("Оплата ${money(stop?.total ?: 0)} ${if (stop?.bank == true) "по безналу" else "наличными"}")
                    listOf(true to "Оплата подтверждена", false to "Пока не оплачено").forEach { (value, label) ->
                        FilterChip(selected = paid == value, onClick = { paid = value }, label = { Text(label) })
                    }
                }
                "settle" -> {
                    Text("Введите пересчитанные остатки и фактически сданные суммы. При отсутствии укажите 0.")
                    Input("Возвращено полных, бут.", water, { water = it })
                    Input("Сдано пустой тары, шт.", empty, { empty = it })
                    Input("Сдано наличными, ₽", cash, { cash = it }, KeyboardType.Decimal)
                    Input("Подтверждено по безналу, ₽", bank, { bank = it }, KeyboardType.Decimal)
                    if (shift.loader) Input("Работа грузчика, мин", loader, { loader = it })
                }
            }
            if (error.isNotEmpty()) Text(error, color = MaterialTheme.colorScheme.error)
        }
    }, confirmButton = {
        Button(onClick = {
            error = ""
            val full = readCount(water)
            val empties = readCount(empty)
            val minutes = readTime(time)
            when (kind) {
                "start" -> when {
                    trip == null -> error = "Обновите маршрут"
                    full == null || full < trip.plannedWater -> error = "Проверьте количество по плану рейса"
                    minutes == null -> error = "Введите время выезда в формате чч:мм"
                    else -> submit("trips/$id/start", json("actual_start" to minutes, "water" to full), "Выезд сохранён")
                }
                "return" -> when {
                    minutes == null -> error = "Введите время возврата в формате чч:мм"
                    minutes < (trip?.startedAt ?: 0) -> error = "Возврат должен быть после выезда"
                    else -> submit("trips/$id/return", json("actual_return" to minutes), "Возврат сохранён")
                }
                "deliver" -> when {
                    stop == null -> error = "Обновите маршрут"
                    empties == null -> error = "Укажите число пустых бутылей, в том числе 0"
                    paid == null -> error = "Отметьте, подтверждена ли оплата"
                    else -> submit("orders/$id/deliver", json("version" to stop.version,
                        "empty" to empties, "paid" to (paid == true)), "Доставка подтверждена")
                }
                "fail" -> when {
                    stop == null -> error = "Обновите маршрут"
                    reason.isBlank() -> error = "Опишите проблему с доставкой"
                    else -> submit("orders/$id/fail", json("version" to stop.version, "reason" to reason.trim()),
                        "Проблема передана диспетчеру")
                }
                "settle" -> {
                    val cashKop = readRubles(cash)
                    val bankKop = readRubles(bank)
                    val loaderMin = readCount(loader)
                    when {
                        full == null || empties == null -> error = "Укажите целое количество полных и пустых бутылей"
                        cashKop == null || bankKop == null -> error = "Введите суммы в рублях с точностью до копеек"
                        loaderMin == null -> error = "Укажите длительность работы грузчика в минутах"
                        else -> submit("shifts/$id/settle", json("water" to full, "empty" to empties,
                            "cash" to cashKop, "bank" to bankKop, "loader_minutes" to loaderMin), "Смена сдана")
                    }
                }
            }
        }) { Text("Подтвердить") }
    }, dismissButton = { TextButton(onClick = onDismiss) { Text("Назад") } })
}
