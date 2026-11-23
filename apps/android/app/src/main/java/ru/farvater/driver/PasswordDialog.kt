package ru.farvater.driver

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.input.*
import androidx.compose.ui.unit.dp

@Composable
internal fun PasswordDialog(
    close: () -> Unit,
    enabled: Boolean,
    serverError: String,
    submit: (String, String) -> Unit,
) {
    var current by remember { mutableStateOf("") }
    var replacement by remember { mutableStateOf("") }
    var confirmation by remember { mutableStateOf("") }
    var localError by remember { mutableStateOf("") }
    FormPage(
        "Смена пароля",
        "Сохранить пароль",
        close,
        confirm = {
            localError =
                when {
                    current.isEmpty() -> "Введите текущий пароль"
                    replacement.length !in 10..128 ->
                        "Новый пароль должен содержать от 10 до 128 символов"
                    confirmation != replacement -> "Пароли различаются"
                    else -> {
                        submit(current, replacement)
                        ""
                    }
                }
        },
        enabled = enabled,
        error = localError.ifBlank { serverError },
    ) {
        CardBlock {
            Heading("Доступ к кабинету")
            Muted("После сохранения войдите с новым паролем.")
            Secret("Текущий пароль", current) { current = it }
            Secret("Новый пароль", replacement) { replacement = it }
            Secret("Повторите новый пароль", confirmation) { confirmation = it }
        }
    }
}

@Composable
private fun Secret(label: String, value: String, change: (String) -> Unit) {
    var show by remember { mutableStateOf(false) }
    OutlinedTextField(
        value = value,
        onValueChange = change,
        label = { Text(label) },
        singleLine = true,
        modifier = Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(11.dp),
        visualTransformation =
            if (show) VisualTransformation.None else PasswordVisualTransformation(),
        keyboardOptions =
            KeyboardOptions(keyboardType = KeyboardType.Password, imeAction = ImeAction.Next),
        trailingIcon = {
            IconButton(onClick = { show = !show }) {
                Symbol(Mark.Eye, if (show) "Скрыть пароль" else "Показать пароль")
            }
        },
    )
}
