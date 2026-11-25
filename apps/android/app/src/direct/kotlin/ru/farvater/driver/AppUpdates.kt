package ru.farvater.driver

import android.app.Application
import android.content.ClipData
import android.content.Context
import android.content.Intent
import android.content.pm.PackageInfo
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.provider.Settings
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.core.content.FileProvider
import androidx.core.content.pm.PackageInfoCompat
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import androidx.lifecycle.viewmodel.compose.viewModel
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONObject
import java.io.File
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL
import java.security.MessageDigest

private const val ApkType = "application/vnd.android.package-archive"
private const val ApkLimit = 128L * 1024 * 1024
private const val InstallerPermissionMessage = "Разрешите WaySlate открывать установщик обновлений в настройках Android."

internal data class UpdateRelease(val version: Long, val size: Long, val sha256: String) {
    companion object {
        fun parse(info: JSONObject): UpdateRelease {
            val version = info.getLong("version_code")
            val size = info.getLong("size_bytes")
            val sha256 = info.getString("sha256")
            require(version in 1..2_100_000_000 && size in 1..ApkLimit && sha256.matches(Regex("[0-9a-f]{64}")))
            return UpdateRelease(version, size, sha256)
        }
    }
}

internal class UpdateModel(private val app: Application) : AndroidViewModel(app) {
    var available by mutableStateOf<UpdateRelease?>(null)
        private set
    var busy by mutableStateOf(false)
        private set
    var message by mutableStateOf("")
        private set
    private var checked = false

    fun check(manual: Boolean = false) {
        if (busy || (!manual && checked)) return
        checked = true
        busy = true
        message = ""
        viewModelScope.launch {
            try {
                val info = DriverApi().call("app-release")
                available = UpdateRelease.parse(info).takeIf { it.version > BuildConfig.VERSION_CODE }
                if (manual && available == null) message = "Установлена актуальная версия."
            } catch (error: CancellationException) {
                throw error
            } catch (error: Exception) {
                if (manual) message = if (error is ApiError && error.status == 404)
                    "На сервере пока нет доступной сборки." else "Не удалось проверить обновления."
            } finally {
                busy = false
            }
        }
    }

    fun download(launch: (File) -> Unit) {
        val release = available ?: return
        if (busy) return
        busy = true
        message = ""
        viewModelScope.launch {
            try {
                launch(withContext(Dispatchers.IO) { downloadApk(app, release) })
            } catch (error: CancellationException) {
                throw error
            } catch (_: Exception) {
                message = "Не удалось получить проверенный APK. Проверьте наличие обновления ещё раз."
            } finally {
                busy = false
            }
        }
    }

    fun showMessage(value: String) { message = value }
}

private fun downloadApk(context: Context, release: UpdateRelease): File {
    val directory = File(context.cacheDir, "updates")
    if (!directory.isDirectory && !directory.mkdirs()) throw IOException("Update cache unavailable")
    val file = File.createTempFile("farvater-", ".apk", directory)
    try {
        val connection = URL("${BuildConfig.API_URL}/downloads/wayslate.apk").openConnection() as HttpURLConnection
        val hash = MessageDigest.getInstance("SHA-256")
        var received = 0L
        try {
            connection.instanceFollowRedirects = false
            connection.connectTimeout = 8000
            connection.readTimeout = 30000
            if (connection.responseCode != 200 || connection.contentType?.substringBefore(';') != ApkType)
                throw IOException("Unexpected APK response")
            connection.inputStream.use { source ->
                file.outputStream().use { output ->
                    val buffer = ByteArray(32 * 1024)
                    while (true) {
                        val count = source.read(buffer)
                        if (count < 0) break
                        received += count
                        if (received > release.size) throw IOException("APK exceeded published size")
                        hash.update(buffer, 0, count)
                        output.write(buffer, 0, count)
                    }
                }
            }
        } finally {
            connection.disconnect()
        }
        val expected = release.sha256.chunked(2).map { it.toInt(16).toByte() }.toByteArray()
        check(received == release.size && MessageDigest.isEqual(hash.digest(), expected))
        verifyPackage(context, file, release.version)
        directory.listFiles()?.filter { it != file && it.extension == "apk" }?.forEach { it.delete() }
        return file
    } catch (error: Exception) {
        file.delete()
        throw error
    }
}

@Suppress("DEPRECATION")
private fun verifyPackage(context: Context, file: File, version: Long) {
    val flags = if (Build.VERSION.SDK_INT >= 28) PackageManager.GET_SIGNING_CERTIFICATES else PackageManager.GET_SIGNATURES
    val current = context.packageManager.getPackageInfo(context.packageName, flags)
    val next = checkNotNull(context.packageManager.getPackageArchiveInfo(file.path, flags))
    fun signers(info: PackageInfo) = (if (Build.VERSION.SDK_INT >= 28) info.signingInfo?.apkContentsSigners
        else info.signatures).orEmpty().toSet()
    val expected = signers(current)
    check(next.packageName == current.packageName && PackageInfoCompat.getLongVersionCode(next) == version
        && version > PackageInfoCompat.getLongVersionCode(current) && expected.isNotEmpty() && expected == signers(next))
}

@Composable
internal fun AppUpdateNotice() {
    val model: UpdateModel = viewModel()
    val context = LocalContext.current
    var waitingPath by remember { mutableStateOf<String?>(null) }
    fun install(file: File) {
        runCatching {
            val uri = FileProvider.getUriForFile(context, "${context.packageName}.update", file)
            context.startActivity(Intent(Intent.ACTION_VIEW).apply {
                setDataAndType(uri, ApkType)
                clipData = ClipData.newRawUri(context.getString(R.string.app_name), uri)
                addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
            })
        }.onFailure { model.showMessage("Не удалось открыть установщик Android.") }
    }
    val permission = rememberLauncherForActivityResult(ActivityResultContracts.StartActivityForResult()) {
        waitingPath?.let {
            if (context.packageManager.canRequestPackageInstalls()) install(File(it))
            else model.showMessage(InstallerPermissionMessage)
        }
        waitingPath = null
    }
    LaunchedEffect(model) { model.check() }
    if (model.available != null) {
        Surface(color = MaterialTheme.colorScheme.secondaryContainer, modifier = Modifier.fillMaxWidth()) {
            Column(Modifier.padding(horizontal = 16.dp, vertical = 4.dp)) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text("Доступно обновление", Modifier.weight(1f), style = MaterialTheme.typography.labelLarge)
                    TextButton(enabled = !model.busy, onClick = {
                        model.download { file ->
                            if (context.packageManager.canRequestPackageInstalls()) install(file)
                            else {
                                waitingPath = file.path
                                runCatching {
                                    permission.launch(Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
                                        Uri.parse("package:${context.packageName}")))
                                }.onFailure {
                                    waitingPath = null
                                    model.showMessage(InstallerPermissionMessage)
                                }
                            }
                        }
                    }) { Text(if (model.busy) "Загрузка…" else "Скачать и установить") }
                }
                if (model.message.isNotBlank()) Muted(model.message)
            }
        }
    }
}

@Composable
internal fun UpdateSettings(model: UpdateModel = viewModel()) {
    Setting(Mark.Refresh, "Проверить обновления", "Сборка ${BuildConfig.VERSION_CODE}", enabled = !model.busy) {
        model.check(manual = true)
    }
    if (model.available == null && model.message.isNotBlank()) Muted(model.message)
}
