package ru.farvater.driver

import android.content.Context
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.paneTitle
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties

internal data class HelpStep(val title: String, val instruction: String)
internal data class HelpGuide(val title: String, val steps: List<HelpStep>)

private val driverGuide = HelpGuide("Памятка экспедитора", listOf(
    HelpStep("Перед выездом", "В разделе «Смена» нажмите «Подтвердить выход» и укажите, едете ли с грузчиком. Когда появится рейс, нажмите «Проверить загрузку»."),
    HelpStep("У клиента", "Нажмите «Открыть точку». После выдачи воды выберите «Подтвердить доставку», укажите принятую тару и оплату."),
    HelpStep("На базе", "Нажмите «Отметить возврат». После последнего рейса выберите «Сдать тару и деньги» и введите фактические остатки."),
))

private val roleGuides = mapOf(
    "driver" to driverGuide,
    "operator" to HelpGuide("Памятка оператора", listOf(
        HelpStep("Примите заказ", "В разделе «Заказы» нажмите «Новый заказ». Выберите клиента или введите его имя, телефон и адрес."),
        HelpStep("Назначьте рейс", "Откройте «Маршруты» и нажмите «Распределить заказы». Если заказ остался в очереди, откройте его и проверьте причину."),
        HelpStep("Найдите прошлую доставку", "Через «Ещё» откройте «Клиенты» и выберите клиента. В его карточке есть раздел «История заказов»."),
    )),
    "manager" to HelpGuide("Памятка администратора", listOf(
        HelpStep("Соберите команду", "В разделе «Заказы» откройте «Команда». Выберите роль сотрудника и нажмите «Создать приглашение»."),
        HelpStep("Проверьте работу команды", "В разделе «Команда» откройте «Журнал работы». Посмотрите, кто принял заказ, кому его назначили и кто подтвердил доставку."),
        HelpStep("Сверьте итоги", "В меню «Ещё» откройте «Отчёты». Выберите рабочий день, проверьте расхождения по сменам и при необходимости нажмите «Скачать CSV»."),
    )),
)

internal fun firstRunGuide(role: String, alreadySeen: (String) -> Boolean): HelpGuide? =
    roleGuides[role]?.takeUnless { alreadySeen(role) }

@Composable
internal fun FirstRunHelpGuide(role: String) {
    val context = LocalContext.current
    val prefs = remember(context) { context.getSharedPreferences("first_run_guides", Context.MODE_PRIVATE) }
    val guide = roleGuides[role] ?: return
    key(role) {
        var visible by rememberSaveable {
            mutableStateOf(firstRunGuide(role) { prefs.getBoolean(it, false) } != null)
        }
        if (visible) HelpGuideDialog(guide, "Начать работу") {
            prefs.edit().putBoolean(role, true).apply()
            visible = false
        }
    }
}

@Composable
internal fun DriverHelpSetting() {
    var visible by rememberSaveable { mutableStateOf(false) }
    Setting(Mark.Info, driverGuide.title) { visible = true }
    if (visible) HelpGuideDialog(driverGuide, "Закрыть памятку") { visible = false }
}

@Composable
private fun HelpGuideDialog(guide: HelpGuide, action: String, dismiss: () -> Unit) {
    Dialog(onDismissRequest = dismiss, properties = DialogProperties(usePlatformDefaultWidth = false)) {
        BoxWithConstraints(Modifier.fillMaxSize().safeDrawingPadding().padding(12.dp),
            contentAlignment = Alignment.Center) {
            Surface(modifier = Modifier.widthIn(max = 480.dp).fillMaxWidth().heightIn(max = maxHeight)
                .semantics { paneTitle = guide.title }, shape = RoundedCornerShape(20.dp)) {
                Column(Modifier.padding(20.dp), verticalArrangement = Arrangement.spacedBy(16.dp)) {
                    Column(Modifier.weight(1f, fill = false).verticalScroll(rememberScrollState()),
                        verticalArrangement = Arrangement.spacedBy(16.dp)) {
                        Heading(guide.title)
                        guide.steps.forEach { step ->
                            Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                                Text(step.title, Modifier.semantics { heading() }, style = MaterialTheme.typography.titleMedium)
                                Muted(step.instruction)
                            }
                        }
                    }
                    Action(action, click = dismiss)
                }
            }
        }
    }
}
