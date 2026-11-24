package ru.farvater.driver

import android.content.ActivityNotFoundException
import android.content.Intent
import android.net.Uri
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.platform.LocalContext

@Composable
internal fun AppUpdateNotice() {
    // Google Play manages updates for this distribution.
}

@Composable
internal fun UpdateSettings() {
    val context = LocalContext.current
    var missingHandler by remember { mutableStateOf(false) }
    Setting(Mark.Refresh, "Открыть в Google Play", "Сборка ${BuildConfig.VERSION_CODE}") {
        val listing = Uri.parse("https://play.google.com/store/apps/details?id=${context.packageName}")
        try {
            context.startActivity(Intent(Intent.ACTION_VIEW, listing))
            missingHandler = false
        } catch (_: ActivityNotFoundException) {
            missingHandler = true
        }
    }
    if (missingHandler) Muted("Чтобы проверить обновление, откройте ФАРВАТЕР в Google Play.")
}
