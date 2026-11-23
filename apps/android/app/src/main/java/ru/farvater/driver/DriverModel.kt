package ru.farvater.driver

import android.app.Application
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch
import org.json.JSONObject
import java.io.IOException
import java.util.UUID

internal class DriverModel(app: Application) : AndroidViewModel(app) {
    private val api = DriverApi()
    private val store = SecureStore(app)
    private val reminders = CallReminders(app)
    private val scope = BuildConfig.API_URL
    private var token = ""
    private var actor = 0
    var name by mutableStateOf("")
        private set
    var signedIn by mutableStateOf(false)
        private set
    var busy by mutableStateOf(false)
        private set
    var message by mutableStateOf("")
        private set
    var failed by mutableStateOf(false)
        private set
    var offline by mutableStateOf(false)
        private set
    var today by mutableStateOf("")
        private set
    var tomorrow by mutableStateOf("")
        private set
    var date by mutableStateOf("")
        private set
    var day by mutableStateOf<Day?>(null)
        private set
    var base by mutableStateOf("")
        private set
    var pending by mutableStateOf<JSONObject?>(null)
        private set

    init {
        runCatching { store.get("session:$scope") }.getOrNull()?.let { session ->
            restoreSession(session)
            loadCached()
            refresh()
        }
    }

    private fun restoreSession(session: JSONObject) {
        token = session.getString("token")
        val user = session.getJSONObject("user")
        actor = user.getInt("id")
        name = user.getString("name")
        pending = store.get("write:$scope:$actor")
        signedIn = true
    }
    private fun loadCached() {
        store.get("day:$scope:$actor")?.let {
            day = Day.parse(it.getJSONObject("data"))
            date = it.getString("date")
            today = it.getString("today")
            tomorrow = it.getString("tomorrow")
            base = it.optString("base")
            offline = true
        }
    }
    private fun action(block: suspend () -> Unit) {
        if (busy) return
        busy = true
        message = ""
        failed = false
        viewModelScope.launch {
            try {
                block()
            } catch (e: ApiError) {
                failed = true
                message = if (e.status == 401 && signedIn) {
                    forgetSession()
                    "Сессия завершена. Войдите снова."
                } else e.message.orEmpty()
            } catch (e: CancellationException) {
                throw e
            } catch (e: IOException) {
                offline = true
                failed = true
                message = "Нет ответа от сервера. Проверьте соединение и повторите."
            } catch (e: Exception) {
                failed = true
                message = "Не удалось прочитать данные. Обновите смену."
            } finally {
                busy = false
            }
        }
    }
    private fun forgetSession() {
        reminders.clear()
        store.put("session:$scope", null)
        store.put("day:$scope:$actor", null)
        token = ""
        actor = 0
        signedIn = false
        day = null
        pending = null
        name = ""
        date = ""
        today = ""
        tomorrow = ""
        base = ""
        offline = false
    }
    fun login(email: String, password: String) = action {
        val session = api.call("login", body = json("email" to email.trim(), "password" to password))
        if (session.getJSONObject("user").getString("role") != "driver") {
            api.call("logout", session.getString("token"), JSONObject())
            throw ApiError(403, "Для приложения нужен профиль экспедитора")
        }
        store.put("session:$scope", session)
        restoreSession(session)
        loadCached()
        update()
    }
    fun logout() = action {
        try {
            api.call("logout", token, JSONObject())
        } catch (e: IOException) {
            message = "Выполнен выход на устройстве. Серверная сессия истечёт по таймеру."
        } finally {
            forgetSession()
        }
    }
    fun changePassword(current: String, replacement: String) = action {
        api.call("password", token, json("current_password" to current, "new_password" to replacement))
        forgetSession()
        message = "Пароль изменён. Войдите с новым паролем."
    }
    private suspend fun update(chosen: String? = null, announceChanges: Boolean = true) {
        val config = api.call("config")
        today = config.getString("today")
        tomorrow = config.getString("tomorrow")
        base = if (config.isNull("base_address")) "" else config.getString("base_address")
        val selected = chosen ?: pending?.optString("date") ?: date.takeIf { it == today || it == tomorrow } ?: today
        if (date != selected) day = null
        date = selected
        val data = api.call("day?date=$selected", token)
        val updatedDay = Day.parse(data)
        val oldDay = day
        if (announceChanges && oldDay != null && updatedDay.shift?.published == true &&
            oldDay.stops != updatedDay.stops) {
            message = "Маршрут обновлён. Проверьте список точек."
            reminders.routeChanged(selected)
        }
        day = updatedDay
        reminders.sync(updatedDay, selected, config.getString("timezone"))
        store.put("day:$scope:$actor", json("date" to selected, "today" to today,
            "tomorrow" to tomorrow, "base" to base, "data" to data))
        offline = false
    }
    fun refresh(chosen: String? = null) = action { update(chosen) }

    fun write(path: String, body: JSONObject, label: String) = action {
        check(pending == null)
        val command = json("path" to path, "body" to body, "key" to UUID.randomUUID().toString(),
            "date" to date, "label" to label)
        // Persist before dispatch, including the original body and order version.
        store.put("write:$scope:$actor", command)
        pending = command
        send(command)
    }
    fun retry() = action { pending?.let { send(it) } }

    private suspend fun send(command: JSONObject) {
        try {
            api.call(command.getString("path"), token, command.getJSONObject("body"), command.getString("key"))
        } catch (e: ApiError) {
            if (e.status in 400..499 && e.status !in listOf(401, 408, 429)) {
                store.put("write:$scope:$actor", null)
                pending = null
                runCatching { update() }
            }
            throw e
        }
        store.put("write:$scope:$actor", null)
        pending = null
        message = command.getString("label")
        try {
            update(command.getString("date"), announceChanges = false)
        } catch (e: ApiError) {
            throw e
        } catch (e: IOException) {
            offline = true
            message += ". Обновите смену после восстановления связи."
        }
    }
}
