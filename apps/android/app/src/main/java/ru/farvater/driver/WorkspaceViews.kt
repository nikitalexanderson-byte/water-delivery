package ru.farvater.driver

import android.content.Intent
import android.net.Uri
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.*
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

@Composable
internal fun ShiftView(
    model: DriverModel,
    day: Day?,
    task: ShiftFocus?,
    locked: Boolean,
    run: (ShiftFocus) -> Unit,
) {
    Heading("Моя смена", true)
    if (day == null || task == null) {
        if (!model.busy)
            CardBlock {
                Heading("Смена не загружена")
                Muted("Обновите данные, когда появится связь.")
            }
        return
    }
    val shift = day.shift
    val trip = day.trips.firstOrNull { it.status != "returned" }
    val point = day.stops.firstOrNull { task.kind == "point" && it.id == task.id }
    val context =
        when (task.kind) {
            "point" -> "Рейс ${trip?.number}  /  Следующая точка"
            "start" -> "Рейс ${trip?.number}  /  Погрузка"
            "return" -> "Рейс ${trip?.number}  /  Возвращение"
            else -> "Смена  /  ${displayDay(model.date)}"
        }
    val title =
        when (task.kind) {
            "point" -> point?.address.orEmpty()
            "confirm" -> "Подтвердите выход"
            "start" -> "Пора на загрузку"
            "return" -> "Возврат на базу"
            "settle" -> "Сдайте смену"
            "report" -> if (day.report?.matched == false) "Есть расхождения" else "Смена сдана"
            "preview" -> "Маршрут готов"
            "unpublished" -> "Выход подтверждён"
            "absent" -> "Смена не назначена"
            else -> "Ожидаем маршрут"
        }
    val detail =
        when (task.kind) {
            "point" ->
                point?.let { "${it.name} · окно ${clock(it.start)}–${clock(it.end)}" }.orEmpty()
            "confirm" ->
                shift?.let { "${clock(it.start)}–${clock(it.end)} · ${it.vehicle}" }.orEmpty()
            "start" ->
                "${trip?.plannedWater} бут. по плану · ${model.base.ifBlank { "Производственная база" }}"
            "return" ->
                model.base.ifBlank {
                    "Все точки рейса обработаны. Отметьте время прибытия на производство."
                }
            "settle" -> "Все рейсы завершены. Пересчитайте тару и сверяйте суммы по видам оплаты."
            "report" -> day.report?.let { "Вознаграждение · ${money(it.earnings)}" }.orEmpty()
            "preview" -> "Первые точки уже доступны. Выезд можно отметить в день смены."
            "unpublished" -> "Маршрут на завтра откроется с 18:00 по времени базы."
            "absent" -> "Проверьте другую дату или уточните график у диспетчера."
            else -> "Диспетчер распределяет заказы. После назначения здесь появится первый рейс."
        }
    val cta =
        when (task.kind) {
            "point" -> "Открыть точку"
            "confirm" -> "Подтвердить выход"
            "start" -> "Проверить загрузку"
            "return" -> "Отметить возврат"
            "settle" -> "Сдать тару и деньги"
            "report" -> "Открыть отчёт"
            "preview" -> "Посмотреть маршрут"
            else -> null
        }
    Surface(shape = RoundedCornerShape(20.dp), color = Ink, contentColor = Color.White) {
        Column(
            Modifier.fillMaxWidth().padding(20.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            Row(
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(9.dp),
            ) {
                Symbol(if (point != null) Mark.Pin else Mark.Shift, color = Mint, size = 19)
                Text(context, color = Mint, style = MaterialTheme.typography.labelLarge)
            }
            Text(
                title,
                modifier = Modifier.semantics { heading() },
                fontSize = 26.sp,
                lineHeight = 31.sp,
                fontWeight = FontWeight.SemiBold,
            )
            if (detail.isNotBlank())
                Text(
                    withMetrics(detail, Color(0xFFD7B8F5)),
                    color = Color(0xFFD5E7E8),
                    style = MaterialTheme.typography.bodyMedium,
                )
            if (point != null)
                Text(
                    withMetrics(
                        "К выдаче · ${point.water} бут.  /  ${money(point.total)}",
                        Color(0xFFD7B8F5),
                    ),
                    fontWeight = FontWeight.Medium,
                )
            if (cta != null) {
                val viewing = task.kind in setOf("point", "report", "preview")
                Button(
                    onClick = { run(task) },
                    enabled = viewing || !locked,
                    modifier = Modifier.fillMaxWidth().heightIn(min = 52.dp),
                    shape = RoundedCornerShape(13.dp),
                    colors =
                        ButtonDefaults.buttonColors(
                            containerColor = Color(0xFF2762C2),
                            contentColor = Color.White,
                        ),
                ) {
                    Text(cta, Modifier.weight(1f), fontWeight = FontWeight.SemiBold)
                    Symbol(Mark.Arrow)
                }
            }
        }
    }
    if (shift != null) {
        if (trip?.status == "active")
            NewSaleAction(day, trip, locked) { run(ShiftFocus("new_sale", trip.id)) }
        val office = day.stops.filter { !it.onSite }
        if (office.isNotEmpty())
            CardBlock {
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                    Text("Обработано точек", fontWeight = FontWeight.SemiBold)
                    Text("${office.count { it.status != "assigned" }} из ${office.size}")
                }
                LinearProgressIndicator(
                    progress = { office.count { it.status != "assigned" }.toFloat() / office.size },
                    modifier = Modifier.fillMaxWidth(),
                    color = MaterialTheme.colorScheme.secondary,
                    trackColor = MaterialTheme.colorScheme.surfaceVariant,
                )
            }
        CardBlock {
            Heading("Экипаж")
            PairLine("Автомобиль", shift.vehicle)
            PairLine("Рабочее время", "${clock(shift.start)}–${clock(shift.end)}")
            PairLine("Экипаж", if (shift.loader) "С грузчиком" else "Без грузчика")
            if (shift.status == "confirmed" && day.canEditCrew())
                Setting(Mark.Person, "Изменить состав экипажа", enabled = !locked) {
                    run(ShiftFocus("crew", shift.id))
                }
        }
    }
}

@Composable
internal fun TripList(trip: Trip, day: Day, task: ShiftFocus?, select: (Int) -> Unit) {
    CardBlock {
        Row(
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            Symbol(Mark.Van, color = MaterialTheme.colorScheme.secondary)
            Heading("Рейс ${trip.number}")
        }
        Muted(
            when (trip.status) {
                "active" -> "В пути · выезд ${trip.startedAt?.let(::clock) ?: "—"}"
                "returned" -> "Завершён · возврат на производство"
                else -> "К выезду · ${trip.plannedWater} бут. по плану"
            }
        )
        val stops = day.stops.filter { !it.onSite && it.tripId == trip.id }
        val done = stops.filter { it.status != "assigned" }
        val todo = stops.filter { it.status == "assigned" }
        var showDone by rememberSaveable(trip.id) { mutableStateOf(todo.isEmpty()) }
        var limit by rememberSaveable(trip.id) { mutableIntStateOf(8) }
        todo.take(limit).forEach { p ->
            PointRow(p, task?.kind == "point" && task.id == p.id) { select(p.id) }
        }
        if (todo.size > limit)
            TextButton(onClick = { limit += 8 }) { Text("Ещё точки · ${todo.size-limit}") }
        if (done.isNotEmpty()) {
            HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
            TextButton(onClick = { showDone = !showDone }) {
                Text(if (showDone) "Скрыть обработанные" else "Обработанные · ${done.size}")
            }
            if (showDone) done.forEach { p -> PointRow(p, false) { select(p.id) } }
        }
    }
}

@Composable
private fun PointRow(point: Stop, next: Boolean, select: () -> Unit) {
    val colors = MaterialTheme.colorScheme
    Surface(
        onClick = select,
        shape = RoundedCornerShape(12.dp),
        color = if (next) colors.secondaryContainer else colors.surfaceVariant,
    ) {
        Row(
            Modifier.fillMaxWidth().padding(12.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(11.dp),
        ) {
            Surface(
                shape = CircleShape,
                color = if (next) colors.secondary else colors.surface,
                contentColor = if (next) colors.onSecondary else colors.onSurface,
            ) {
                Box(Modifier.size(31.dp), contentAlignment = Alignment.Center) {
                    Text(
                        point.position.toString(),
                        fontWeight = FontWeight.Bold,
                        style = MaterialTheme.typography.labelLarge,
                    )
                }
            }
            Column(Modifier.weight(1f)) {
                Text(
                    if (next) "Следующая · ${clock(point.eta)}"
                    else if (point.status == "assigned") clock(point.eta) else stopStatus(point),
                    style = MaterialTheme.typography.labelLarge,
                    color = if (next) colors.onSecondaryContainer else colors.onSurfaceVariant,
                )
                Text(point.address, fontWeight = FontWeight.SemiBold)
                Text(
                    "${point.name} · ${point.water} бут.",
                    style = MaterialTheme.typography.bodyMedium,
                )
            }
            Symbol(Mark.Chevron, size = 15)
        }
    }
}

@Composable
internal fun PointView(
    stop: Stop,
    day: Day,
    next: ShiftFocus?,
    locked: Boolean,
    open: (String, Int) -> Unit,
) {
    val trip = day.trips.firstOrNull { it.id == stop.tripId } ?: return
    val current = next?.kind == "point" && next.id == stop.id
    val context = LocalContext.current
    var error by rememberSaveable { mutableStateOf("") }
    if (current)
        Text(
            "СЛЕДУЮЩАЯ ТОЧКА",
            style = MaterialTheme.typography.labelLarge,
            color = MaterialTheme.colorScheme.secondary,
        )
    Heading(stop.address, true)
    Text(
        "${stop.name} · ${clock(stop.start)}–${clock(stop.end)}",
        style = MaterialTheme.typography.titleMedium,
    )
    CardBlock {
        if (stop.status == "assigned") {
            PairLine("Расчётное прибытие", clock(stop.eta))
            listOf("Основной телефон" to stop.phone, "Дополнительный телефон" to stop.altPhone)
                .filter { it.second.isNotBlank() }
                .forEach { (label, number) ->
                    Button(onClick = {
                        error = if (openDialApp(context, number)) "" else "Наберите $number в приложении телефона."
                    }, modifier = Modifier.fillMaxWidth().heightIn(min = 52.dp),
                        colors = ButtonDefaults.buttonColors(containerColor = Color(0xFF2762C2), contentColor = Color.White)) {
                        Symbol(Mark.Phone, size = 18)
                        Spacer(Modifier.width(8.dp))
                        Column(Modifier.weight(1f)) {
                            Text(label, style = MaterialTheme.typography.labelMedium)
                            Text(number, style = MaterialTheme.typography.titleMedium)
                        }
                    }
                }
            if (stop.phone.isNotBlank() || stop.altPhone.isNotBlank()) DialAppSetting()
            Setting(Mark.Pin, "Открыть адрес в картах") {
                val location = Uri.parse("geo:0,0?q=${Uri.encode(stop.address)}")
                runCatching { context.startActivity(Intent(Intent.ACTION_VIEW, location)) }
                    .onFailure { error = "Приложение карт не найдено. Адрес указан выше." }
            }
        } else
            Text(
                if (stop.status == "failed") "Доставка не состоялась · ${stop.failureReason}"
                else stopStatus(stop)
            )
        val instructions =
            listOfNotNull(
                "Подъезд ${stop.entrance}".takeIf { stop.entrance.isNotBlank() },
                "Этаж ${stop.floor}".takeIf { stop.floor > 0 },
                "без лифта".takeIf { stop.floor > 1 && !stop.lift },
                "Квартира / офис ${stop.unit}".takeIf { stop.unit.isNotBlank() },
                "Домофон ${stop.intercom}".takeIf { stop.intercom.isNotBlank() },
                "КПП".takeIf { stop.checkpoint },
                "Платный въезд".takeIf { stop.paidEntry },
                stop.accessInstructions.takeIf { it.isNotBlank() },
                stop.note.takeIf { it.isNotBlank() },
            )
        if (instructions.isNotEmpty()) Muted(instructions.joinToString(" · "))
    }
    if (error.isNotBlank()) Feedback(error, true)
    CardBlock {
        Heading("К выдаче")
        stop.items.forEach { PairLine(it.name, "${it.water} бут. × ${money(it.price)}") }
        if (stop.items.isEmpty()) PairLine("Вода", "${stop.water} бут.")
        if (stop.shells > 0) PairLine("Новая тара", "${stop.shells} шт.")
        HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
        PairLine(if (stop.bank) "Безналичные" else "Наличные", money(stop.total))
    }
    if (current) {
        OutlinedButton(
            onClick = { open("fail", stop.id) },
            enabled = !locked,
            modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp),
        ) {
            Text("Проблема с доставкой")
        }
    }
    val extras =
        day.stops.filter { it.onSite && it.tripId == trip.id && it.sourceOrderId == stop.id }
    if (extras.isNotEmpty())
        CardBlock {
            Heading("Допродажи")
            extras.forEach { sale ->
                PairLine(sale.items.joinToString { "${it.name} × ${it.water}" }, money(sale.total))
                Muted(if (sale.paid) "Оплата подтверждена" else "Без оплаты")
            }
        }
    if (
        trip.status == "active" &&
            (current || stop.status == "delivered") &&
            day.sales(trip).isNotEmpty()
    )
        TextButton(
            onClick = { open("sale", stop.id) },
            enabled = !locked,
            modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp),
        ) {
            Symbol(Mark.Plus)
            Spacer(Modifier.width(6.dp))
            Text("Заказ на месте этому клиенту")
        }
}

@Composable
private fun NewSaleAction(day: Day, trip: Trip, locked: Boolean, click: () -> Unit) {
    val available = day.sales(trip).isNotEmpty()
    OutlinedButton(onClick = click, enabled = !locked && available,
        modifier = Modifier.fillMaxWidth().heightIn(min = 50.dp)) {
        Symbol(Mark.Plus)
        Spacer(Modifier.width(8.dp))
        Text("Заказ на месте")
    }
    if (!available) Muted("Вся вода зарезервирована для точек маршрута.")
}

@Composable
internal fun InventoryView(day: Day?, locked: Boolean, newSale: (Int) -> Unit) {
    Heading("Остатки и деньги", true)
    if (day == null || day.trips.isEmpty()) {
        CardBlock {
            Symbol(Mark.Stock, color = MaterialTheme.colorScheme.secondary)
            Heading("Загрузки пока нет")
            Muted("После назначения рейса здесь появится план воды по брендам.")
        }
        return
    }
    day.report?.let {
        SettlementView(it)
        return
    }
    day.trips.forEach { trip ->
        val planned = trip.status == "planned"
        CardBlock {
            Heading("Рейс ${trip.number}")
            Muted(
                when (trip.status) {
                    "planned" -> "План загрузки"
                    "active" -> "На борту"
                    else -> "К сдаче на базе"
                }
            )
            val rows = trip.stock.filter { it.planned > 0 || it.left > 0 }
            rows.forEach { PairLine(it.name, "${if(planned)it.planned else it.left} бут.") }
            if (!planned) PairLine("Собрано пустой тары", "${trip.collected} шт.")
            if (trip.status == "active") NewSaleAction(day, trip, locked) { newSale(trip.id) }
            val sales = day.stops.filter { it.tripId == trip.id && it.onSite }
            if (sales.isNotEmpty()) {
                HorizontalDivider()
                Text("Заказы на месте", fontWeight = FontWeight.SemiBold)
                sales.forEach { PairLine(it.name, "${it.water} бут. · ${money(it.total)}") }
            }
        }
    }
    val delivered = day.stops.filter { it.status == "delivered" }
    CardBlock {
        Heading("Оплата за смену")
        PairLine("Наличные", money(delivered.filter { it.paid && !it.bank }.sumOf { it.total }))
        PairLine("Безналичные", money(delivered.filter { it.paid && it.bank }.sumOf { it.total }))
        PairLine("Без оплаты", money(delivered.filter { !it.paid }.sumOf { it.total }))
    }
}

@Composable
private fun SettlementView(report: Report) {
    Surface(shape = RoundedCornerShape(14.dp),
        color = if (report.matched) Color(0xFF17673C) else Color(0xFF9F302E),
        contentColor = Color.White) {
        Row(Modifier.fillMaxWidth().semantics(mergeDescendants = true) { liveRegion = LiveRegionMode.Polite }
            .padding(16.dp), verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            Symbol(if (report.matched) Mark.Check else Mark.Info)
            Text(if (report.matched) "Отчёт совпал" else "Отчёт не совпал",
                style = MaterialTheme.typography.titleMedium)
        }
    }
    CardBlock {
        Heading("Вода и тара")
        report.stock.forEach {
            Reconciled(
                it.name,
                "${it.expected} бут.",
                "${it.actual} бут.",
                if (it.difference != 0) "${signed(it.difference.toLong())} бут." else "",
            )
        }
        if (report.stock.isEmpty())
            Reconciled(
                "Полные бутыли",
                "${report.expected.water} шт.",
                "${report.actual.water} шт.",
                signed(report.difference.water.toLong())
                    .takeIf { report.difference.water != 0 }
                    .orEmpty(),
            )
        Reconciled(
            "Пустая тара",
            "${report.expected.empty} шт.",
            "${report.actual.empty} шт.",
            signed(report.difference.empty.toLong())
                .takeIf { report.difference.empty != 0 }
                .orEmpty(),
        )
    }
    CardBlock {
        Heading("Деньги")
        Reconciled(
            "Наличные",
            money(report.expected.cash),
            money(report.actual.cash),
            signedMoney(report.difference.cash),
        )
        Reconciled(
            "Безналичные",
            money(report.expected.bank),
            money(report.actual.bank),
            signedMoney(report.difference.bank),
        )
        PairLine("Вознаграждение", money(report.earnings))
        PairLine("Без оплаты", money(report.unpaid))
    }
}

private fun signed(n: Long) = if (n > 0) "+$n" else n.toString()

private fun signedMoney(n: Long) = if (n == 0L) "" else (if (n > 0) "+" else "") + money(n)

@Composable
private fun Reconciled(name: String, expected: String, actual: String, diff: String) {
    Column(Modifier.fillMaxWidth().semantics(mergeDescendants = true) {}) {
        Text(name, fontWeight = FontWeight.Medium)
        Muted("По учёту $expected  ·  сдано $actual")
        if (diff.isNotEmpty()) Text("Расхождение $diff", color = MaterialTheme.colorScheme.error)
    }
}

@Composable
internal fun AccountView(model: DriverModel, password: () -> Unit) {
    Heading("Профиль", true)
    val modes = mapOf("system" to "Системная", "light" to "Светлая", "dark" to "Тёмная")
    CardBlock {
        Row(
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            Surface(shape = CircleShape, color = Ink) {
                Box(Modifier.size(48.dp), contentAlignment = Alignment.Center) {
                    Text(
                        model.name
                            .trim()
                            .split(Regex("\\s+"))
                            .take(2)
                            .joinToString("") { it.take(1) }
                            .uppercase(),
                        color = Mint,
                        fontWeight = FontWeight.Bold,
                    )
                }
            }
            Column {
                Heading(model.name)
                Muted("Экспедитор")
            }
        }
        Setting(
            Mark.Lock,
            "Сменить пароль",
            enabled = !model.busy && model.pending == null,
            click = password,
        )
    }
    CardBlock {
        var themes by remember { mutableStateOf(false) }
        Box {
            Setting(Mark.Eye, "Тема приложения", modes[model.theme].orEmpty()) { themes = true }
            DropdownMenu(expanded = themes, onDismissRequest = { themes = false }) {
                modes.forEach { (id, label) ->
                    DropdownMenuItem(
                        text = { Text(label) },
                        onClick = {
                            themes = false
                            model.chooseTheme(id)
                        },
                    )
                }
            }
        }
    }
    CardBlock {
        Heading("Связь")
        PairLine("Данные смены", if (model.offline) "Последняя копия" else "С сервера")
        Setting(Mark.Refresh, "Обновить данные", enabled = !model.busy) { model.refresh() }
        DialAppSetting()
        ReminderPermission(model)
    }
    OutlinedButton(
        onClick = { model.logout() },
        enabled = !model.busy,
        modifier = Modifier.fillMaxWidth().heightIn(min = 50.dp),
    ) {
        Text("Выйти из кабинета")
    }
}
