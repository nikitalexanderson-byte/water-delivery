package ru.farvater.driver

import android.os.Bundle
import android.content.Intent
import android.net.Uri
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.repeatOnLifecycle
import kotlinx.coroutines.delay
import org.json.JSONObject

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        setContent {
            val colors = if (isSystemInDarkTheme()) darkColorScheme(
                primary = Color(0xFFA7C7FF), secondary = Color(0xFF82DBCD),
                background = Color(0xFF101923), surface = Color(0xFF1A2532)
            ) else lightColorScheme(
                primary = Color(0xFF1555AB), secondary = Color(0xFF05675F),
                background = Color(0xFFF3F6FA), surface = Color.White,
                onSurface = Color(0xFF172B42), onBackground = Color(0xFF172B42)
            )
            MaterialTheme(colorScheme = colors) {
                val model: DriverModel = viewModel()
                Surface(modifier = Modifier.fillMaxSize(), color = colors.background) {
                    Box(Modifier.fillMaxSize().safeDrawingPadding()) {
                        if (model.signedIn) ShiftScreen(model) else LoginScreen(model)
                    }
                }
            }
        }
    }
}

@Composable
internal fun SectionTitle(text: String) {
    Text(text, style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.SemiBold,
        modifier = Modifier.semantics { heading() })
}

@Composable
internal fun Panel(content: @Composable ColumnScope.() -> Unit) {
    Surface(color = MaterialTheme.colorScheme.surface, shape = RoundedCornerShape(16.dp)) {
        Column(Modifier.fillMaxWidth().padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp),
            content = content)
    }
}

@Composable
private fun StatusMessage(model: DriverModel) {
    if (model.busy) LinearProgressIndicator(modifier = Modifier.fillMaxWidth())
    if (model.message.isNotEmpty()) Text(model.message,
        modifier = Modifier.semantics { liveRegion = LiveRegionMode.Polite },
        color = if (model.failed) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.secondary)
}

@Composable
private fun LoginScreen(model: DriverModel) {
    var email by rememberSaveable { mutableStateOf("") }
    var password by remember { mutableStateOf("") }
    LazyColumn(contentPadding = PaddingValues(20.dp), verticalArrangement = Arrangement.spacedBy(16.dp)) {
        item {
            Text("ФАРВАТЕР", color = MaterialTheme.colorScheme.secondary, fontWeight = FontWeight.Bold)
            Spacer(Modifier.height(12.dp))
            Text("Вход экспедитора", style = MaterialTheme.typography.headlineLarge)
        }
        item {
            Panel {
                OutlinedTextField(value = email, onValueChange = { email = it }, label = { Text("Электронная почта") },
                    modifier = Modifier.fillMaxWidth(), singleLine = true,
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Email))
                OutlinedTextField(value = password, onValueChange = { password = it }, label = { Text("Пароль") },
                    modifier = Modifier.fillMaxWidth(), singleLine = true, visualTransformation = PasswordVisualTransformation(),
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password))
                Button(onClick = { model.login(email, password) }, enabled = !model.busy && email.isNotBlank() && password.isNotEmpty(),
                    modifier = Modifier.fillMaxWidth()) { Text("Войти") }
                StatusMessage(model)
            }
        }
    }
}

@Composable
private fun ShiftScreen(model: DriverModel) {
    val day = model.day
    val shift = day?.shift
    val locked = model.busy || model.pending != null || model.offline
    var form by rememberSaveable(model.date) { mutableStateOf<String?>(null) }
    var objectId by rememberSaveable(model.date) { mutableIntStateOf(0) }
    fun open(kind: String, id: Int) { form = kind; objectId = id }
    val lifecycle = LocalLifecycleOwner.current.lifecycle
    LaunchedEffect(lifecycle, form, model.date) {
        if (form == null) lifecycle.repeatOnLifecycle(Lifecycle.State.STARTED) {
            while (true) {
                delay(60_000)
                if (!model.busy && model.pending == null) model.refresh()
            }
        }
    }
    LazyColumn(contentPadding = PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        item {
            Text("ФАРВАТЕР", color = MaterialTheme.colorScheme.secondary, fontWeight = FontWeight.Bold)
            Text("Моя смена", style = MaterialTheme.typography.headlineLarge, modifier = Modifier.semantics { heading() })
            Text(model.name, style = MaterialTheme.typography.bodyLarge)
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                listOf("Сегодня" to model.today, "Завтра" to model.tomorrow).forEach { (label, date) ->
                    FilterChip(selected = model.date == date, onClick = { model.refresh(date) },
                        enabled = date.isNotEmpty() && !model.busy && model.pending == null,
                        label = { Text(label) })
                }
            }
            if (model.date.isNotEmpty()) Text("Дата смены · ${model.date}")
            StatusMessage(model)
        }
        if (model.offline) item { Text("Нет связи · показаны последние загруженные данные",
            color = MaterialTheme.colorScheme.error) }
        model.pending?.let { pending -> item {
            Panel {
                SectionTitle("Операция ожидает ответа")
                Text(pending.optString("label"))
                Text("Повтор отправит сохранённые данные с тем же номером операции.")
                Button(onClick = { model.retry() }, enabled = !model.busy) { Text("Проверить и повторить") }
            }
        } }
        if (shift == null && day != null) item { Panel { SectionTitle("Смена не назначена"); Text("Проверьте другую дату или обратитесь к диспетчеру.") } }
        if (shift != null) {
            item {
                Panel {
                    Text(shift.vehicle, style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.SemiBold)
                    Text("${clock(shift.start)}–${clock(shift.end)} · ${shift.capacity} кг")
                    Text(if (shift.loader) "С грузчиком" else "Без грузчика")
                    Text(when (shift.status) {
                        "confirmed" -> "Выход подтверждён"
                        "active" -> "Смена начата"
                        "closed" -> "Смена сдана"
                        else -> "Ожидается подтверждение выхода"
                    }, color = MaterialTheme.colorScheme.secondary)
                    if (shift.status == "pending") Button(enabled = !locked, onClick = {
                        model.write("shifts/${shift.id}/confirm", JSONObject(), "Выход подтверждён")
                    }, modifier = Modifier.fillMaxWidth()) { Text("Подтвердить выход") }
                }
            }
            if (!shift.published && shift.status != "closed") item { Text("Маршрут на завтра откроется с 18:00 по времени базы.") }
            if (shift.published && day.trips.isEmpty() && shift.status != "closed") item { Text("Назначенных рейсов пока нет. Обновите смену после распределения.") }
            day.trips.forEach { trip ->
                val stops = day.stops.filter { it.tripId == trip.id }
                val next = stops.firstOrNull { it.status == "assigned" }
                val options = day.sales(trip)
                item(key = "trip-${trip.id}") {
                    Panel {
                        SectionTitle("Рейс ${trip.number}")
                        Text(when (trip.status) {
                            "active" -> "В пути · осталось ${trip.waterLeft} полных · собрано ${trip.collected} пустых"
                            "returned" -> "Вернулись на базу"
                            else -> "К погрузке · ${trip.plannedWater} бут. · ${stops.count { !it.onSite }} точ."
                        })
                        trip.stock.filter { it.planned > 0 || it.left > 0 }.forEach { item ->
                            Text("${item.name} · план ${item.planned} бут." +
                                if (trip.status == "planned") "" else " · остаток ${item.left} бут.")
                        }
                        if (model.base.isNotBlank()) Text("База · ${model.base}")
                        trip.startedAt?.let { Text("Фактический выезд · ${clock(it)}") }
                        val currentDay = model.date == model.today
                        if (currentDay && trip == day.trips.firstOrNull { it.status != "returned" } && trip.status == "planned")
                            Button(onClick = { open("start", trip.id) }, enabled = !locked,
                                modifier = Modifier.fillMaxWidth()) { Text("Загрузка и выезд") }
                        if (trip.status == "active" && next == null)
                            Button(onClick = { open("return", trip.id) }, enabled = !locked,
                                modifier = Modifier.fillMaxWidth()) { Text("Отметить возврат на базу") }
                    }
                }
                items(stops, key = { "stop-${it.id}" }) { stop ->
                    if (stop.onSite) {
                        Panel {
                            Text("Допродажа · ${stop.name}", style = MaterialTheme.typography.titleMedium)
                            Text("${stop.water} бут. воды · ${stop.shells} новой тары · ${money(stop.total)}")
                            stop.items.forEach { Text("${it.name} · ${it.water} бут.") }
                            Text(if (stop.paid) "Оплата подтверждена" else "Пока не оплачено")
                        }
                        return@items
                    }
                    val atPoint = trip.status == "active" && (next?.id == stop.id || stop.status == "delivered")
                    StopCard(stop, actionable = next?.id == stop.id && trip.status == "active" && !locked,
                        canSell = atPoint && options.isNotEmpty() && !locked,
                        onAction = { kind -> open(kind, stop.id) })
                }
            }
            if (shift.status == "active" && model.today == model.date &&
                day.trips.all { it.status == "returned" }) item {
                Button(onClick = { open("settle", shift.id) }, enabled = !locked,
                    modifier = Modifier.fillMaxWidth()) { Text("Сдать тару и деньги") }
            }
            day.report?.let { report -> item { ReportCard(report) } }
        }
        item {
            ReminderPermission(model)
            TextButton(onClick = { open("password", 0) }, enabled = !model.busy && model.pending == null) {
                Text("Сменить пароль")
            }
            Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                OutlinedButton(onClick = { model.refresh() }, enabled = !model.busy) { Text("Обновить смену") }
                TextButton(onClick = { model.logout() }, enabled = !model.busy) { Text("Выйти") }
            }
        }
    }
    form?.let { kind ->
        if (kind == "password") PasswordDialog({ form = null }) { current, replacement ->
            form = null
            model.changePassword(current, replacement)
        } else if (kind == "sale") {
            val stop = day?.stops?.firstOrNull { it.id == objectId }
            val trip = day?.trips?.firstOrNull { it.id == stop?.tripId }
            if (stop != null && trip != null) {
                SaleDialog(stop, day.sales(trip), { form = null }) { body ->
                    form = null
                    model.write("trips/${trip.id}/sale", body, "Дополнительная продажа учтена")
                }
            }
        } else OperationDialog(kind, objectId, day, onDismiss = { form = null }) { path, body, label ->
            form = null
            model.write(path, body, label)
        }
    }
}

@Composable
private fun StopCard(stop: Stop, actionable: Boolean, canSell: Boolean, onAction: (String) -> Unit) {
    val context = LocalContext.current
    var dialError by remember { mutableStateOf(false) }
    Panel {
        Text("Точка ${stop.position} · ${clock(stop.start)}–${clock(stop.end)}",
            color = MaterialTheme.colorScheme.secondary, fontWeight = FontWeight.SemiBold)
        SectionTitle(stop.address)
        Text("${stop.name} · расчётное прибытие ${clock(stop.eta)}")
        val access = listOfNotNull(
            "Этаж ${stop.floor}".takeIf { stop.floor > 0 },
            "Без лифта".takeIf { stop.floor > 1 && !stop.lift },
            "Проезд через КПП".takeIf { stop.checkpoint }, stop.note.takeIf { it.isNotBlank() })
        if (access.isNotEmpty()) Text(access.joinToString(" · "))
        Text("${stop.water} бут. воды · ${stop.shells} новой тары")
        stop.items.forEach { Text("${it.name} · ${it.water} × ${money(it.price)}") }
        Text("${money(stop.total)} · ${if (stop.bank) "безналичные" else "наличные"}")
        if (stop.status == "delivered") Text(if (stop.paid) "Доставлено · оплачено" else "Доставлено · без оплаты",
            color = MaterialTheme.colorScheme.secondary)
        if (stop.status == "failed") Text("Доставка не состоялась · ${stop.failureReason}", color = MaterialTheme.colorScheme.error)
        if (stop.phone.isNotBlank() && stop.status == "assigned") OutlinedButton(onClick = {
            dialError = runCatching { context.startActivity(Intent(Intent.ACTION_DIAL, Uri.fromParts("tel", stop.phone, null))) }.isFailure
        }) { Text("Позвонить · ${stop.phone}") }
        if (dialError) Text("Откройте приложение телефона и наберите ${stop.phone}")
        if (actionable) {
            Button(onClick = { onAction("deliver") }, modifier = Modifier.fillMaxWidth()) { Text("Подтвердить доставку") }
            OutlinedButton(onClick = { onAction("fail") }) { Text("Проблема с доставкой") }
        }
        if (canSell) OutlinedButton(onClick = { onAction("sale") }) { Text("+ Дополнительная продажа") }
    }
}

@Composable
private fun ReportCard(report: Report) {
    Panel {
        SectionTitle(if (report.matched) "Отчёт совпал" else "Отчёт не совпал")
        report.stock.forEach { item ->
            val delta = if (item.difference == 0) "" else " · разница ${signed(item.difference.toLong())}"
            Text("${item.name} · по учёту ${item.expected} · сдано ${item.actual}$delta",
                color = if (item.difference == 0) MaterialTheme.colorScheme.onSurface else MaterialTheme.colorScheme.error)
        }
        listOf(
            "Полные бутыли" to (report.expected.water.toString() to report.actual.water.toString()),
            "Пустая тара" to (report.expected.empty.toString() to report.actual.empty.toString()),
            "Наличные" to (money(report.expected.cash) to money(report.actual.cash)),
            "Безналичные" to (money(report.expected.bank) to money(report.actual.bank))
        ).forEach { (name, values) ->
            val (expected, actual) = values
            Text("$name · по учёту $expected · сдано $actual",
                color = if (expected == actual) MaterialTheme.colorScheme.onSurface else MaterialTheme.colorScheme.error)
        }
        Text("Вознаграждение · ${money(report.earnings)}")
        Text("Не оплачено клиентами · ${money(report.unpaid)}")
        if (!report.matched) {
            val d = report.difference
            Text("Разница между сданным и учётом", style = MaterialTheme.typography.titleMedium)
            if (d.water != 0) Text("Полные бутыли · ${signed(d.water.toLong())} шт.")
            if (d.empty != 0) Text("Пустая тара · ${signed(d.empty.toLong())} шт.")
            if (d.cash != 0L) Text("Наличные · ${if (d.cash > 0) "+" else ""}${money(d.cash)}")
            if (d.bank != 0L) Text("Безналичные · ${if (d.bank > 0) "+" else ""}${money(d.bank)}")
        }
    }
}

private fun signed(value: Long) = if (value > 0) "+$value" else value.toString()
