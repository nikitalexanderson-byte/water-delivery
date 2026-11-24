package ru.farvater.driver

import android.Manifest
import android.annotation.SuppressLint
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.webkit.*
import android.widget.Toast
import androidx.activity.compose.BackHandler
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch

@SuppressLint("SetJavaScriptEnabled")
@Composable
internal fun OfficeWorkspace(session: String, model: DriverModel) {
    val context = LocalContext.current
    val origin = remember { OfficeOrigin(BuildConfig.API_URL) }
    val scope = rememberCoroutineScope()
    var web by remember { mutableStateOf<WebView?>(null) }
    var canBack by remember { mutableStateOf(false) }
    var failed by remember { mutableStateOf(false) }
    var reportDate by rememberSaveable { mutableStateOf<String?>(null) }
    var locationPrompt by remember { mutableStateOf<Pair<String, GeolocationPermissions.Callback>?>(null) }
    val locationAccess = rememberLauncherForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) { permissions ->
        locationPrompt?.let { (origin, callback) -> callback.invoke(origin, permissions.values.any { it }, false) }
        locationPrompt = null
    }
    val save = rememberLauncherForActivityResult(ActivityResultContracts.CreateDocument("text/csv")) { uri ->
        val date = reportDate
        reportDate = null
        if (date != null && uri != null) scope.launch {
            val message = try {
                model.saveOfficeReport(session, date, uri)
                "Отчёт сохранён"
            } catch (e: CancellationException) {
                throw e
            } catch (e: ApiError) {
                if (e.status == 401) model.officeSignedOut(session, true)
                "Не удалось получить отчёт"
            } catch (_: Exception) {
                "Не удалось сохранить отчёт"
            }
            Toast.makeText(context, message, Toast.LENGTH_LONG).show()
        }
    }
    BackHandler(enabled = canBack && !failed) { web?.goBack() }
    if (failed) {
        Column(Modifier.fillMaxSize().padding(24.dp), verticalArrangement = Arrangement.Center,
            horizontalAlignment = Alignment.CenterHorizontally) {
            Heading("Не удалось открыть кабинет")
            Spacer(Modifier.height(8.dp))
            Muted("Проверьте подключение к серверу и попробуйте ещё раз.")
            Spacer(Modifier.height(16.dp))
            Action("Попробовать снова", click = { failed = false })
            TextButton(onClick = model::logout, enabled = !model.busy) { Text("Выйти из кабинета") }
        }
        return
    }
    AndroidView(modifier = Modifier.fillMaxSize().imePadding(), factory = { ctx ->
        WebView(ctx).apply {
            settings.javaScriptEnabled = true
            settings.domStorageEnabled = true
            settings.allowFileAccess = false
            settings.allowContentAccess = false
            settings.javaScriptCanOpenWindowsAutomatically = false
            settings.setSupportMultipleWindows(false)
            settings.mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
            settings.userAgentString += " FarvaterAndroidOffice/1"
            CookieManager.getInstance().setAcceptThirdPartyCookies(this, false)
            val client = OfficeWebClient(origin, session, { model.officeSignedOut(session, it) },
                { date ->
                    if (reportDate == null) {
                        reportDate = date
                        save.launch("WaySlate-$date.csv")
                    }
                }, { link ->
                    val opened = if (link.scheme == "tel") openDialApp(ctx, link.schemeSpecificPart)
                    else runCatching { ctx.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(link.toString()))) }.isSuccess
                    if (!opened) Toast.makeText(ctx, "Подходящее приложение не найдено", Toast.LENGTH_SHORT).show()
                }, { failed = true }, { canBack = it })
            webViewClient = client
            tag = client
            webChromeClient = object : WebChromeClient() {
                override fun onGeolocationPermissionsShowPrompt(site: String, callback: GeolocationPermissions.Callback) {
                    val sameSite = origin.parse(site)?.let(origin::accepts) == true
                    if (!sameSite || locationPrompt != null) { callback.invoke(site, false, false); return }
                    if (ctx.checkSelfPermission(Manifest.permission.ACCESS_COARSE_LOCATION) == PackageManager.PERMISSION_GRANTED)
                        callback.invoke(site, true, false)
                    else {
                        locationPrompt = site to callback
                        locationAccess.launch(arrayOf(Manifest.permission.ACCESS_COARSE_LOCATION, Manifest.permission.ACCESS_FINE_LOCATION))
                    }
                }
                override fun onGeolocationPermissionsHidePrompt() { locationPrompt = null }
            }
            web = this
            loadUrl(origin.url + OFFICE_ENTRY)
        }
    }, onRelease = { view ->
        (view.tag as OfficeWebClient).released = true
        locationPrompt = null
        canBack = false
        web = null
        view.stopLoading()
        view.webViewClient = WebViewClient()
        view.webChromeClient = null
        view.clearHistory()
        view.destroy()
    })
}
