package ru.farvater.driver

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp

@Composable
internal fun PasswordDialog(close: () -> Unit, submit: (String, String) -> Unit) {
    var current by remember { mutableStateOf("") }
    var replacement by remember { mutableStateOf("") }
    var confirmation by remember { mutableStateOf("") }
    val mismatch = confirmation.isNotEmpty() && confirmation != replacement
    AlertDialog(onDismissRequest = close, title = { Text("Сменить пароль") }, text = {
        Column(Modifier.verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            SecretField("Текущий пароль", current) { current = it }
            SecretField("Новый пароль", replacement) { replacement = it }
            Text("От 10 до 128 символов. После сохранения потребуется снова войти.")
            SecretField("Повторите новый пароль", confirmation) { confirmation = it }
            if (mismatch) Text("Пароли различаются", color = MaterialTheme.colorScheme.error)
        }
    }, dismissButton = { TextButton(onClick = close) { Text("Назад") } },
        confirmButton = { Button(onClick = { submit(current, replacement) },
            enabled = current.isNotEmpty() && replacement.length in 10..128 && replacement == confirmation) { Text("Сохранить") } })
}

@Composable
private fun SecretField(label: String, value: String, onChange: (String) -> Unit) {
    OutlinedTextField(value = value, onValueChange = onChange, label = { Text(label) }, singleLine = true,
        modifier = Modifier.fillMaxWidth(), visualTransformation = PasswordVisualTransformation(),
        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password))
}
