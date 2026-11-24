package ru.farvater.driver

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

internal enum class RegistrationRole(val apiValue: String, val label: String, val description: String) {
    Driver("driver", "Экспедитор", "Доставляю заказы и сдаю смену."),
    Operator("operator", "Оператор", "Принимаю заказы и распределяю рейсы."),
}

private val invitationPattern = Regex("[0-9a-fA-F]{32}")

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
internal fun RegistrationChoices(choose: (RegistrationRole) -> Unit) {
    RegistrationRole.entries.forEach { role ->
        OutlinedButton(
            onClick = { choose(role) }, modifier = Modifier.fillMaxWidth().heightIn(min = 72.dp),
        ) {
            Column(Modifier.fillMaxWidth().padding(vertical = 6.dp)) {
                Text(role.label, style = MaterialTheme.typography.titleMedium)
                Muted(role.description)
            }
        }
    }
}

@Composable
internal fun RegisterAccount(model: DriverModel, role: RegistrationRole, back: () -> Unit) {
    var code by remember { mutableStateOf("") }
    var name by rememberSaveable { mutableStateOf("") }
    var email by rememberSaveable { mutableStateOf("") }
    var password by remember { mutableStateOf("") }
    var confirmation by remember { mutableStateOf("") }
    val mismatch = confirmation.isNotEmpty() && password != confirmation
    AccountEntry("Регистрация · ${role.label}", back.takeUnless { model.busy }) {
        Muted("Введите код приглашения от администратора команды.")
        EntryField(code, { code = it.take(60) }, "Код приглашения", KeyboardType.Ascii)
        EntryField(name, { name = it }, "Ваше имя")
        EntryField(email, { email = it }, "Электронная почта", KeyboardType.Email)
        EntryField(password, { password = it }, "Пароль", KeyboardType.Password)
        EntryField(confirmation, { confirmation = it }, "Повторите пароль", KeyboardType.Password)
        Muted("Минимум 10 символов")
        if (mismatch) Feedback("Пароли не совпадают.", true)
        if (model.message.isNotBlank()) Feedback(model.message, model.failed)
        Action(
            if (model.busy) "Регистрация…" else "Зарегистрироваться",
            !model.busy && code.trim().matches(invitationPattern) && name.isNotBlank() && email.isNotBlank() &&
                password.length >= 10 && password == confirmation,
        ) { model.register(name, email, password, role, code) }
    }
}

@Composable
internal fun TeamSetup(model: DriverModel) {
    var code by remember { mutableStateOf("") }
    AccountEntry("Вступить в команду", null) {
        Muted("Введите код от администратора. Роль уже указана в приглашении.")
        EntryField(code, { code = it.take(60) }, "Код приглашения", KeyboardType.Ascii)
        Action(
            if (model.busy) "Подключаем…" else "Присоединиться",
            !model.busy && code.trim().matches(invitationPattern),
        ) { model.joinTeam(code) }
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
