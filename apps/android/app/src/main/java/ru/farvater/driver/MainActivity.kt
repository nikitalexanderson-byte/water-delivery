package ru.farvater.driver

import android.os.Bundle
import android.content.Intent
import android.net.Uri
import androidx.activity.ComponentActivity
import androidx.activity.compose.BackHandler
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.selection.toggleable
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.saveable.rememberSaveableStateHolder
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusDirection
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.*
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.*
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.repeatOnLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import kotlinx.coroutines.delay

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        setContent {
            val model: DriverModel = viewModel()
            val dark = model.theme == "dark" || (model.theme == "system" && isSystemInDarkTheme())
            SideEffect {
                val bars =
                    androidx.core.view.WindowCompat.getInsetsController(window, window.decorView)
                bars.isAppearanceLightStatusBars = !dark
                bars.isAppearanceLightNavigationBars = !dark
            }
            MaterialTheme(colorScheme = if (dark) Dark else Light) {
                Surface(Modifier.fillMaxSize(), color = MaterialTheme.colorScheme.background) {
                    Box(Modifier.fillMaxSize().safeDrawingPadding()) {
                        val office = model.officeSession
                        when {
                            office != null -> key(office) { OfficeWorkspace(office, model) }
                            model.signedIn -> DriverWorkspace(model)
                            else -> SignIn(model)
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun SignIn(model: DriverModel) {
    var email by rememberSaveable { mutableStateOf("") }
    var password by remember { mutableStateOf("") }
    var visible by remember { mutableStateOf(false) }
    val focus = LocalFocusManager.current
    val ready = email.isNotBlank() && password.isNotBlank() && !model.busy
    val login = {
        if (ready) {
            focus.clearFocus()
            model.login(email, password)
        }
    }
    Column(
        Modifier.fillMaxSize().imePadding().verticalScroll(rememberScrollState()),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Surface(color = Ink, modifier = Modifier.fillMaxWidth()) {
            Column(Modifier.padding(start = 24.dp, top = 24.dp, end = 24.dp, bottom = 26.dp)) {
                Wordmark(true)
                Spacer(Modifier.height(26.dp))
                Text(
                    "Вход в\nФАРВАТЕР",
                    modifier = Modifier.semantics { heading() },
                    color = Color.White,
                    fontSize = 36.sp,
                    lineHeight = 40.sp,
                    letterSpacing = (-1).sp,
                    fontWeight = FontWeight.SemiBold,
                )
            }
        }
        Column(
            Modifier.widthIn(max = 520.dp).fillMaxWidth().padding(22.dp),
            verticalArrangement = Arrangement.spacedBy(14.dp),
        ) {
            Heading("Вход")
            OutlinedTextField(
                value = email,
                onValueChange = { email = it },
                label = { Text("Электронная почта") },
                modifier = Modifier.fillMaxWidth(),
                singleLine = true,
                shape = RoundedCornerShape(12.dp),
                keyboardOptions =
                    KeyboardOptions(keyboardType = KeyboardType.Email, imeAction = ImeAction.Next),
                keyboardActions = KeyboardActions(onNext = { focus.moveFocus(FocusDirection.Down) }),
            )
            OutlinedTextField(
                value = password,
                onValueChange = { password = it },
                label = { Text("Пароль") },
                modifier = Modifier.fillMaxWidth(),
                singleLine = true,
                shape = RoundedCornerShape(12.dp),
                visualTransformation =
                    if (visible) VisualTransformation.None else PasswordVisualTransformation(),
                keyboardOptions =
                    KeyboardOptions(
                        keyboardType = KeyboardType.Password,
                        imeAction = ImeAction.Done,
                    ),
                keyboardActions = KeyboardActions(onDone = { login() }),
                trailingIcon = {
                    IconButton(onClick = { visible = !visible }) {
                        Symbol(Mark.Eye, if (visible) "Скрыть пароль" else "Показать пароль")
                    }
                },
            )
            if (model.invitationRequired) {
                val context = LocalContext.current
                var unavailable by remember { mutableStateOf(false) }
                Feedback("Примите приглашение в веб-панели, затем войдите снова.")
                OutlinedButton(onClick = {
                    unavailable = runCatching {
                        context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(BuildConfig.API_URL + "/")))
                    }.isFailure
                }, modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp)) { Text("Открыть веб-панель") }
                if (unavailable) Muted("Откройте в браузере ${BuildConfig.API_URL}/")
            }
            if (model.message.isNotBlank()) Feedback(model.message, model.failed)
            Action(if (model.busy) "Вход…" else "Войти", ready, click = login)
        }
    }
}

private enum class Tab(val label: String, val icon: Mark) {
    Shift("Смена", Mark.Shift),
    Route("Маршрут", Mark.Route),
    Stock("Остатки", Mark.Stock),
    Account("Профиль", Mark.Person),
}

@Composable
private fun DriverWorkspace(model: DriverModel) {
    val pages = rememberSaveableStateHolder()
    var tab by rememberSaveable { mutableStateOf(Tab.Shift) }
    var detail by rememberSaveable(model.date) { mutableIntStateOf(0) }
    var form by rememberSaveable(model.date) { mutableStateOf("") }
    var objectId by rememberSaveable(model.date) { mutableIntStateOf(0) }
    val day = model.day
    val next = day?.focus(model.date == model.today)
    val locked = model.busy || model.offline || model.pending != null
    val stop = day?.stops?.find { it.id == detail }
    val lifecycle = LocalLifecycleOwner.current.lifecycle
    LaunchedEffect(lifecycle, form, model.date) {
        if (form.isEmpty())
            lifecycle.repeatOnLifecycle(Lifecycle.State.STARTED) {
                while (true) {
                    delay(60_000)
                    if (!model.busy && model.pending == null) model.refresh()
                }
            }
    }
    LaunchedEffect(model.pending, model.busy) {
        if (model.pending != null && !model.busy) form = ""
    }
    fun open(kind: String, id: Int) {
        form = kind
        objectId = id
        model.dismissMessage()
    }
    fun runNext(task: ShiftFocus) {
        when (task.kind) {
            "confirm", "crew" -> open("crew", task.id)
            "new_sale" -> open("new_sale", task.id)
            "point" -> detail = task.id
            "preview" -> tab = Tab.Route
            "report" -> tab = Tab.Stock
            "start",
            "return",
            "settle" -> open(task.kind, task.id)
        }
    }
    val canBack = stop != null || tab != Tab.Shift
    BackHandler(enabled = canBack && form.isEmpty()) {
        if (stop != null) detail = 0 else tab = Tab.Shift
    }
    Scaffold(
        containerColor = MaterialTheme.colorScheme.background,
        contentWindowInsets = WindowInsets(0, 0, 0, 0),
        topBar = {
            if (stop != null)
                Row(
                    Modifier.fillMaxWidth().padding(horizontal = 8.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    IconButton(onClick = { detail = 0 }) { Symbol(Mark.Back, "Назад") }
                    Text("Точка ${stop.position}", fontWeight = FontWeight.SemiBold)
                }
            else
                Row(
                    Modifier.fillMaxWidth().padding(start = 18.dp, end = 6.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Wordmark()
                    Spacer(Modifier.weight(1f))
                    if (tab != Tab.Account) {
                        var choose by remember { mutableStateOf(false) }
                        Box {
                            TextButton(
                                onClick = { choose = true },
                                enabled =
                                    !model.busy && model.pending == null && model.today.isNotBlank(),
                            ) {
                                Symbol(Mark.Calendar, size = 17)
                                Spacer(Modifier.width(6.dp))
                                Text(displayDay(model.date).ifBlank { "Дата" })
                                Symbol(Mark.Down, size = 15)
                            }
                            DropdownMenu(expanded = choose, onDismissRequest = { choose = false }) {
                                listOf("Сегодня" to model.today, "Завтра" to model.tomorrow)
                                    .forEach { (title, date) ->
                                        DropdownMenuItem(
                                            text = { Text("$title · ${displayDay(date)}") },
                                            onClick = {
                                                choose = false
                                                model.refresh(date)
                                            },
                                        )
                                    }
                            }
                        }
                        IconButton(onClick = { model.refresh() }, enabled = !model.busy) {
                            Symbol(Mark.Refresh, "Обновить смену")
                        }
                    }
                }
        },
        bottomBar = {
            if (stop == null)
                NavigationBar(
                    containerColor = MaterialTheme.colorScheme.surface,
                    tonalElevation = 0.dp,
                    windowInsets = WindowInsets(0, 0, 0, 0),
                ) {
                    Tab.entries.forEach { dest ->
                        NavigationBarItem(
                            selected = tab == dest,
                            onClick = { tab = dest },
                            icon = { Symbol(dest.icon) },
                            label = { Text(dest.label) },
                            colors =
                                NavigationBarItemDefaults.colors(
                                    indicatorColor = MaterialTheme.colorScheme.secondaryContainer,
                                    selectedIconColor =
                                        MaterialTheme.colorScheme.onSecondaryContainer,
                                ),
                        )
                    }
                }
            else if (next?.kind == "point" && next.id == stop.id) {
                Surface(color = MaterialTheme.colorScheme.surface) {
                    Box(
                        Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 10.dp),
                        contentAlignment = Alignment.Center,
                    ) {
                        Box(Modifier.widthIn(max = 600.dp)) {
                            Action("Подтвердить доставку", !locked, Mark.Check) {
                                open("deliver", stop.id)
                            }
                        }
                    }
                }
            }
        },
    ) { padding ->
        Column(
            Modifier.fillMaxSize().padding(padding),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            if (model.busy) LinearProgressIndicator(modifier = Modifier.fillMaxWidth())
            pages.SaveableStateProvider("${tab.name}/$detail/${model.date}") {
                Column(
                    Modifier.widthIn(max = 640.dp)
                        .fillMaxSize()
                        .verticalScroll(rememberScrollState())
                        .padding(16.dp),
                    verticalArrangement = Arrangement.spacedBy(14.dp),
                ) {
                    if (model.pending != null && !model.busy)
                        CardBlock {
                            Heading("Операция ожидает ответа")
                            Text(model.pending?.optString("label").orEmpty())
                            Muted("Повторно отправим сохранённые данные с тем же номером операции.")
                            Action("Проверить и повторить", !model.busy, Mark.Refresh) {
                                model.retry()
                            }
                        }
                    else if (model.offline)
                        Feedback("Нет связи. Показана последняя загруженная смена.", true)
                    if (model.message.isNotBlank() && (!model.offline || !model.failed))
                        Feedback(model.message, model.failed)
                    when {
                        stop != null -> PointView(stop, day, next, locked, ::open)
                        tab == Tab.Account -> AccountView(model) { open("password", 0) }
                        tab == Tab.Shift -> ShiftView(model, day, next, locked, ::runNext)
                        tab == Tab.Route -> RouteView(day, next, model.mapBase, model.roads) { detail = it }
                        else -> InventoryView(day, locked) { open("new_sale", it) }
                    }
                    Spacer(Modifier.height(2.dp))
                }
            }
        }
    }
    val dismiss = { if (!model.busy) form = "" }
    val saved = {
        if (form == "settle") tab = Tab.Stock
        form = ""
        detail = 0
    }
    val serverError = model.message.takeIf { model.failed }.orEmpty()
    when (form) {
        "" -> {}
        "crew" -> day?.shift?.takeIf { it.id == objectId }?.let { shift ->
            var loader by rememberSaveable(shift.id) { mutableStateOf(shift.loader) }
            val confirm = shift.status == "pending"
            FormPage(if (confirm) "Подтверждение выхода" else "Состав экипажа",
                if (confirm) "Подтвердить выход" else "Сохранить состав", dismiss,
                confirm = { model.write("shifts/${shift.id}/confirm", json("has_loader" to loader),
                    if (confirm) "Выход подтверждён" else "Состав экипажа обновлён", saved) },
                enabled = !locked && day.canEditCrew(), error = serverError) {
                CardBlock {
                    Heading(shift.vehicle)
                    Muted("${clock(shift.start)}–${clock(shift.end)} · ${displayDay(model.date)}")
                    Row(Modifier.fillMaxWidth().heightIn(min = 52.dp)
                        .toggleable(value = loader, role = Role.Checkbox, onValueChange = { loader = it }),
                        verticalAlignment = Alignment.CenterVertically) {
                        Checkbox(checked = loader, onCheckedChange = null)
                        Spacer(Modifier.width(12.dp))
                        Text("С грузчиком")
                    }
                }
            }
        }
        "password" -> PasswordDialog(dismiss, !model.busy, serverError, model::changePassword)
        "sale", "new_sale" -> {
            val existing = form == "sale"
            val point = if (existing) day?.stops?.find { it.id == objectId } else null
            val tripId = if (existing) point?.tripId else objectId
            val trip = day?.trips?.find { it.id == tripId }
            if (trip != null)
                SaleDialog(point, day.sales(trip), model.shellPrice, dismiss, !locked, serverError) { body ->
                    model.write(
                        "trips/${trip.id}/sale",
                        body,
                        "Заказ на месте учтён",
                        saved,
                    )
                }
        }
        else ->
            OperationDialog(form, objectId, day, dismiss, !locked, serverError) { path, body, label
                ->
                model.write(path, body, label, saved)
            }
    }
}
