package ru.farvater.driver

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp

internal enum class TeamIntent(val label: String, val description: String, val apiPath: String) {
    Create("Я организую доставку", "Создам команду и приглашу сотрудников.", "teams/create"),
    Join("Меня пригласили", "Войду в команду по коду от руководителя.", "teams/join"),
}

@Composable
internal fun AccountEntry(title: String, back: (() -> Unit)?, content: @Composable ColumnScope.() -> Unit) {
    Column(
        Modifier.fillMaxSize().imePadding().verticalScroll(rememberScrollState()),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Column(
            Modifier.widthIn(max = 520.dp).fillMaxWidth().padding(horizontal = 22.dp, vertical = 24.dp),
            verticalArrangement = Arrangement.spacedBy(14.dp),
        ) {
            Wordmark(false)
            if (back != null) TextButton(onClick = back) { Text("Назад") }
            Heading(title, true)
            content()
        }
    }
}

@Composable
internal fun TeamChoices(choose: (TeamIntent) -> Unit) {
    TeamIntent.entries.forEach { intent ->
        OutlinedButton(
            onClick = { choose(intent) }, modifier = Modifier.fillMaxWidth().heightIn(min = 72.dp),
        ) {
            Column(Modifier.fillMaxWidth().padding(vertical = 6.dp)) {
                Text(intent.label, style = MaterialTheme.typography.titleMedium)
                Muted(intent.description)
            }
        }
    }
}

@Composable
internal fun RegisterAccount(model: DriverModel, intent: TeamIntent, back: () -> Unit) {
    var name by rememberSaveable { mutableStateOf("") }
    var email by rememberSaveable { mutableStateOf("") }
    var password by remember { mutableStateOf("") }
    var confirmation by remember { mutableStateOf("") }
    val mismatch = confirmation.isNotEmpty() && password != confirmation
    AccountEntry("Создать аккаунт", back.takeUnless { model.busy }) {
        Muted(intent.description)
        EntryField(name, { name = it }, "Ваше имя")
        EntryField(email, { email = it }, "Электронная почта", KeyboardType.Email)
        EntryField(password, { password = it }, "Пароль", KeyboardType.Password)
        EntryField(confirmation, { confirmation = it }, "Повторите пароль", KeyboardType.Password)
        Muted("Минимум 10 символов")
        if (mismatch) Feedback("Пароли не совпадают.", true)
        if (model.message.isNotBlank()) Feedback(model.message, model.failed)
        Action(
            if (model.busy) "Регистрация…" else "Зарегистрироваться",
            !model.busy && name.isNotBlank() && email.isNotBlank() &&
                password.length >= 10 && password == confirmation,
        ) { model.register(name, email, password, intent) }
    }
}

@Composable
internal fun TeamSetup(model: DriverModel) {
    var intent by rememberSaveable { mutableStateOf(model.teamIntent) }
    var value by rememberSaveable { mutableStateOf("") }
    val back = { model.dismissMessage(); intent = null; value = "" }
    BackHandler(intent != null && !model.busy, onBack = back)
    val selected = intent
    val create = selected == TeamIntent.Create
    AccountEntry(
        if (selected == null) "Как вы будете работать?" else if (create) "Создать команду" else "Вступить в команду",
        back.takeIf { selected != null && !model.busy },
    ) {
        if (selected == null) TeamChoices { intent = it }
        else {
            Muted(if (create) "Команда получит свой кабинет и каталог." else "Возьмите код у руководителя команды.")
            EntryField(value, { value = it.take(if (create) 120 else 60) },
                if (create) "Название команды" else "Код приглашения")
            Action(
                if (model.busy) "Подключаем…" else if (create) "Создать команду" else "Присоединиться",
                !model.busy && (if (create) value.isNotBlank() else value.trim().matches(Regex("[0-9a-fA-F]{32}"))),
            ) { model.setUpTeam(selected, value) }
        }
        if (model.message.isNotBlank()) Feedback(model.message, model.failed)
        TextButton(onClick = model::logout, enabled = !model.busy) { Text("Выйти из аккаунта") }
    }
}

@Composable
private fun EntryField(value: String, change: (String) -> Unit, label: String, keyboard: KeyboardType = KeyboardType.Text) {
    OutlinedTextField(
        value = value, onValueChange = change, modifier = Modifier.fillMaxWidth(),
        label = { Text(label) }, singleLine = true, keyboardOptions = KeyboardOptions(keyboardType = keyboard),
        visualTransformation = if (keyboard == KeyboardType.Password) PasswordVisualTransformation()
            else androidx.compose.ui.text.input.VisualTransformation.None,
    )
}
