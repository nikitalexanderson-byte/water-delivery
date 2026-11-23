package ru.farvater.driver

import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import androidx.compose.foundation.layout.Box
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.platform.LocalContext
import androidx.lifecycle.compose.LifecycleResumeEffect

internal const val MTT_PACKAGE = "ru.mtt.business"
private const val ASK = "ask"
private const val SYSTEM = "system"
private data class DialApp(val pkg: String, val name: String)
private fun dial(number: String) = Intent(Intent.ACTION_DIAL, Uri.fromParts("tel", number, null))
private fun dialApps(ctx: Context) = ctx.packageManager
    .queryIntentActivities(dial("0"), PackageManager.MATCH_DEFAULT_ONLY)
    .map { DialApp(it.activityInfo.packageName, it.loadLabel(ctx.packageManager).toString()) }
    .distinctBy { it.pkg }.sortedBy { it.name }

internal fun dialChoice(saved: String?, packages: List<String>): String = when {
    saved == ASK || saved == SYSTEM || saved in packages -> saved!!
    MTT_PACKAGE in packages -> MTT_PACKAGE
    else -> SYSTEM
}

/** ACTION_DIAL presents a number. Only the operator of the phone can initiate the call. */
internal fun openDialApp(ctx: Context, number: String): Boolean {
    val settings = ctx.getSharedPreferences("driver.dialer", Context.MODE_PRIVATE)
    val choice = dialChoice(settings.getString("package", null), dialApps(ctx).map { it.pkg })
    val intent = when (choice) {
        ASK -> Intent.createChooser(dial(number), "Позвонить через")
        SYSTEM -> dial(number)
        else -> dial(number).setPackage(choice)
    }
    return runCatching { ctx.startActivity(intent) }.isSuccess ||
        (choice != SYSTEM && runCatching { ctx.startActivity(dial(number)) }.isSuccess)
}

@Composable
internal fun DialAppSetting() {
    val ctx = LocalContext.current
    val settings = remember(ctx) { ctx.getSharedPreferences("driver.dialer", Context.MODE_PRIVATE) }
    var apps by remember { mutableStateOf(dialApps(ctx)) }
    var saved by remember { mutableStateOf(settings.getString("package", null)) }
    var show by remember { mutableStateOf(false) }
    LifecycleResumeEffect(ctx) {
        apps = dialApps(ctx)
        saved = settings.getString("package", null)
        onPauseOrDispose {}
    }
    val options = apps.map { it.pkg to it.name } +
        listOf(SYSTEM to "Системное приложение", ASK to "Спрашивать при звонке")
    val selected = dialChoice(saved, apps.map { it.pkg })
    Box {
        Setting(Mark.Phone, "Приложение для звонков", options.first { it.first == selected }.second) { show = true }
        DropdownMenu(expanded = show, onDismissRequest = { show = false }) {
            options.forEach { (id, name) ->
                DropdownMenuItem(text = { Text(name) },
                    trailingIcon = { if (selected == id) Symbol(Mark.Check) },
                    onClick = {
                        settings.edit().putString("package", id).apply()
                        saved = id
                        show = false
                    })
            }
        }
    }
}
