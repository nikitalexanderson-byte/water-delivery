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

internal fun needsTeamInvite(user: JSONObject) = user.has("team_id") && user.isNull("team_id")
internal fun accountScope(server: String, user: JSONObject): String {
    val original = "$server:${user.getInt("id")}"
    return if (user.isNull("team_id")) original else "$original:team:${user.getInt("team_id")}"
}

internal class DriverModel(app: Application) : AndroidViewModel(app) {
    private val api = DriverApi()
    private val store = SecureStore(app)
    private val reminders = CallReminders(app)
    private val scope = BuildConfig.API_URL
    private val appearance=app.getSharedPreferences("driver.appearance",android.content.Context.MODE_PRIVATE)
    var theme by mutableStateOf(appearance.getString("theme","system") ?: "system")
        private set
    fun chooseTheme(mode:String) {
        if(mode !in setOf("system","light","dark"))return
        appearance.edit().putString("theme",mode).apply()
        theme=mode
    }
    private var token = ""
    val roads = RoadRepository { path -> api.call(path, token, readTimeoutMs = 35_000) }
    private var account = ""
    var name by mutableStateOf("")
        private set
    var signedIn by mutableStateOf(false)
        private set
    var officeSession by mutableStateOf<String?>(null)
        private set
    var teamSetup by mutableStateOf(false)
        private set
    var teamIntent by mutableStateOf<TeamIntent?>(null)
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
    var shellPrice by mutableStateOf<Long?>(null)
        private set
    var mapBase by mutableStateOf(MapBase())
        private set
    var pending by mutableStateOf<JSONObject?>(null)
        private set

    init {
        runCatching { store.get("session:$scope") }.getOrNull()?.let { session ->
            restoreSession(session)
            if (signedIn && officeSession == null) {
                loadCached()
                refresh()
            }
        }
    }

    private fun restoreSession(session: JSONObject) {
        token = session.getString("token")
        val user = session.getJSONObject("user")
        teamSetup = needsTeamInvite(user)
        teamIntent = TeamIntent.entries.find { it.name == session.optString("team_intent") }
        account = accountScope(scope, user)
        name = user.getString("name")
        officeSession = if (isOfficeRole(user.getString("role"))) session.toString() else null
        pending = if (!teamSetup && officeSession == null) store.get("write:$account") else null
        signedIn = !teamSetup
    }
    private fun loadCached() {
        store.get("day:$account")?.let {
            day = Day.parse(it.getJSONObject("data"))
            date = it.getString("date")
            today = it.getString("today")
            tomorrow = it.getString("tomorrow")
            base = it.optString("base")
            shellPrice = it.optLong("shell_price", -1).takeIf { value -> value >= 0 }
            mapBase = MapBase.from(it.optJSONObject("map") ?: JSONObject())
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
                message = if (e.status == 401 && (signedIn || teamSetup)) {
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
        roads.clear()
        reminders.clear()
        store.put("session:$scope", null)
        store.put("day:$account", null)
        token = ""
        account = ""
        signedIn = false
        teamSetup = false
        teamIntent = null
        officeSession = null
        day = null
        pending = null
        name = ""
        date = ""
        today = ""
        tomorrow = ""
        base = ""
        shellPrice = null
        mapBase = MapBase()
        offline = false
    }
    fun login(email: String, password: String) = action {
        acceptSession(api.call("login", body = json("email" to email.trim(), "password" to password)))
    }

    fun register(name: String, email: String, password: String, intent: TeamIntent) = action {
        val session = api.call("register", body = json(
            "name" to name.trim(), "email" to email.trim(), "password" to password
        ))
        session.put("team_intent", intent.name)
        acceptSession(session)
    }

    fun setUpTeam(intent: TeamIntent, value: String) = action {
        // A retry after a lost response can recover an already-created membership.
        val current = api.call("me", token)
        val user = if (needsTeamInvite(current)) {
            val field = if (intent == TeamIntent.Create) "name" else "code"
            api.call(intent.apiPath, token, json(field to value.trim())).getJSONObject("user")
        } else current
        acceptSession(json("user" to user, "token" to token))
    }

    private suspend fun acceptSession(session: JSONObject) {
        val user = session.getJSONObject("user")
        if (user.getString("role") != "driver" && !isOfficeRole(user.getString("role"))) {
            api.call("logout", session.getString("token"), JSONObject())
            throw ApiError(403, "Для этой роли кабинет недоступен")
        }
        store.put("session:$scope", session)
        offline = false
        restoreSession(session)
        if (signedIn && officeSession == null) {
            loadCached()
            update()
        }
    }
    fun officeSignedOut(session: String, expired: Boolean) {
        if (officeSession != session) return
        forgetSession()
        failed = expired
        message = if (expired) "Сессия завершена. Войдите снова." else ""
    }
    suspend fun saveOfficeReport(session: String, date: String, uri: android.net.Uri) {
        check(session == officeSession)
        api.saveReport(date, token) {
            getApplication<Application>().contentResolver.openOutputStream(uri, "wt")
                ?: throw IOException("Не удалось открыть файл")
        }
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
        val config = api.call("config", token)
        today = config.getString("today")
        tomorrow = config.getString("tomorrow")
        base = if (config.isNull("base_address")) "" else config.getString("base_address")
        shellPrice = config.optLong("shell_price", -1).takeIf { it >= 0 }
        mapBase = MapBase.from(config)
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
        store.put("day:$account", json("date" to selected, "today" to today,
            "tomorrow" to tomorrow, "base" to base, "shell_price" to (shellPrice ?: JSONObject.NULL),
            "map" to mapBase.json(), "data" to data))
        offline = false
    }
    fun refresh(chosen: String? = null) = action { update(chosen) }

    fun dismissMessage() { message = ""; failed = false }

    fun write(path: String, body: JSONObject, label: String, saved: () -> Unit = {}) = action {
        check(pending == null)
        val command = json("path" to path, "body" to body, "key" to UUID.randomUUID().toString(),
            "date" to date, "label" to label)
        // Persist before dispatch, including the original body and order version.
        store.put("write:$account", command)
        pending = command
        send(command)
        saved()
    }
    fun retry() = action { pending?.let { send(it) } }

    private suspend fun send(command: JSONObject) {
        try {
            api.call(command.getString("path"), token, command.getJSONObject("body"), command.getString("key"))
        } catch (e: ApiError) {
            if (e.status in 400..499 && e.status !in listOf(401, 408, 429)) {
                store.put("write:$account", null)
                pending = null
                runCatching { update() }
            }
            throw e
        }
        store.put("write:$account", null)
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
