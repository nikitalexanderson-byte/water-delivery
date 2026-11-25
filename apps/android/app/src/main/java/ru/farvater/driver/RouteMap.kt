package ru.farvater.driver

import android.annotation.SuppressLint
import android.content.Context
import android.content.Intent
import android.view.MotionEvent
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import java.io.ByteArrayInputStream
import org.json.JSONObject

private fun blocked() =
    WebResourceResponse(
        "text/plain",
        "UTF-8",
        403,
        "Blocked",
        emptyMap(),
        ByteArrayInputStream(byteArrayOf()),
    )

private fun digits(value: String) = value.filter(Char::isDigit)

private class RouteMapClient(private val ctx: Context, private val failure: (String) -> Unit) :
    WebViewClient() {
    @Volatile var tiles = false
    var phones = emptySet<String>()
    var payload = ""
    private var rendered = ""
    private var renderedHeight = 0
    private var ready = false

    override fun shouldInterceptRequest(
        view: WebView,
        req: WebResourceRequest,
    ): WebResourceResponse? {
        if (req.method != "GET") return blocked()
        val url = req.url.toString()
        val asset = bundledMapAsset(url)
        if (asset == null)
            return if (!req.isForMainFrame && osmTileAllowed(url, tiles)) null else blocked()
        val type =
            when (asset.substringAfterLast('.').lowercase()) {
                "html" -> "text/html"
                "js" -> "application/javascript"
                "css" -> "text/css"
                "svg" -> "image/svg+xml"
                "png" -> "image/png"
                "webp" -> "image/webp"
                "gif" -> "image/gif"
                else -> return blocked()
            }
        val stream =
            try {
                ctx.assets.open(asset)
            } catch (e: java.io.IOException) {
                return blocked()
            }
        val headers =
            mapOf(
                "Content-Security-Policy" to
                    "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https://tile.openstreetmap.org; connect-src 'none'; frame-src 'none'; object-src 'none'; form-action 'none'; base-uri 'none'",
                "X-Content-Type-Options" to "nosniff",
            )
        return WebResourceResponse(
            type,
            if (type.startsWith("image/")) null else "UTF-8",
            200,
            "OK",
            headers,
            stream,
        )
    }

    override fun shouldOverrideUrlLoading(view: WebView, req: WebResourceRequest): Boolean {
        if (
            req.isForMainFrame &&
                req.hasGesture() &&
                req.url.toString() == "https://www.openstreetmap.org/copyright"
        ) {
            runCatching { ctx.startActivity(Intent(Intent.ACTION_VIEW, req.url)) }
                .onFailure { failure("Страница атрибуции OpenStreetMap недоступна на устройстве.") }
            return true
        }
        if (req.isForMainFrame && req.hasGesture() && req.url.scheme == "tel") {
            val requested = digits(req.url.schemeSpecificPart.orEmpty())
            val known = phones.firstOrNull { requested.isNotEmpty() && digits(it) == requested }
            if (known != null && !openDialApp(ctx, known)) failure("Откройте телефон и наберите $known.")
        }
        return true
    }

    override fun onPageFinished(view: WebView, url: String) {
        if (url != MAP_URL) return
        ready = true
        rendered = ""
        render(view)
    }

    fun render(view: WebView) {
        val height = (view.height / view.resources.displayMetrics.density).toInt()
        if (
            !ready ||
                height <= 0 ||
                payload.isEmpty() ||
                (rendered == payload && renderedHeight == height)
        )
            return
        rendered = payload
        renderedHeight = height
        val argument =
            JSONObject.quote(payload).replace("\u2028", "\\u2028").replace("\u2029", "\\u2029")
        view.evaluateJavascript(
            "(function(){if(!window.FarvaterMap)return false;document.documentElement.style.height='${height}px';document.body.style.height='${height}px';window.FarvaterMap.render(JSON.parse($argument));return true})()"
        ) {
            if (it != "true")
                failure("Не удалось открыть карту. Остановки доступны в режиме «Список».")
        }
    }
}

@Composable
internal fun RouteMap(payload: String, tiles: Boolean, phones: Set<String>) {
    var expanded by rememberSaveable { mutableStateOf(false) }
    val height = (LocalConfiguration.current.screenHeightDp * 0.52f).coerceIn(240f, 490f).dp
    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) {
        TextButton(onClick = { expanded = true }, modifier = Modifier.heightIn(min = 48.dp)) {
            Text("На весь экран")
        }
    }
    if (expanded) {
        Dialog(onDismissRequest = { expanded = false },
            properties = DialogProperties(usePlatformDefaultWidth = false)) {
            Surface(Modifier.fillMaxSize()) {
                Column {
                    Row(Modifier.fillMaxWidth().heightIn(min = 56.dp), verticalAlignment = Alignment.CenterVertically) {
                        IconButton(onClick = { expanded = false }) { Symbol(Mark.Back, "Свернуть карту") }
                        Heading("Карта рейсов")
                    }
                    RouteMapView(payload, tiles, phones, Modifier.fillMaxWidth().weight(1f))
                }
            }
        }
    } else {
        RouteMapView(payload, tiles, phones, Modifier.fillMaxWidth().height(height).clip(RoundedCornerShape(16.dp)))
    }
}

@SuppressLint("SetJavaScriptEnabled", "ClickableViewAccessibility")
@Composable
private fun RouteMapView(payload: String, tiles: Boolean, phones: Set<String>, modifier: Modifier) {
    var error by remember { mutableStateOf("") }
    Column(modifier) {
    AndroidView(
        modifier = Modifier.fillMaxWidth().weight(1f),
        factory = { ctx ->
            val client = RouteMapClient(ctx) { error = it }
            WebView(ctx).apply {
                settings.javaScriptEnabled = true
                settings.allowFileAccess = false
                settings.allowContentAccess = false
                settings.setGeolocationEnabled(false)
                settings.domStorageEnabled = false
                settings.javaScriptCanOpenWindowsAutomatically = false
                settings.setSupportMultipleWindows(false)
                settings.mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
                settings.userAgentString =
                    settings.userAgentString + " FarvaterDriver/" + BuildConfig.VERSION_NAME
                isVerticalScrollBarEnabled = false
                isHorizontalScrollBarEnabled = false
                webViewClient = client
                tag = client
                addOnLayoutChangeListener { _, _, _, _, _, _, _, _, _ -> client.render(this) }
                setOnTouchListener { view, event ->
                    when (event.actionMasked) {
                        MotionEvent.ACTION_DOWN,
                        MotionEvent.ACTION_MOVE ->
                            view.parent.requestDisallowInterceptTouchEvent(true)
                        MotionEvent.ACTION_UP,
                        MotionEvent.ACTION_CANCEL ->
                            view.parent.requestDisallowInterceptTouchEvent(false)
                    }
                    false
                }
                loadUrl(MAP_URL)
            }
        },
        update = { view ->
            val client = view.tag as RouteMapClient
            client.phones = phones
            client.tiles = tiles
            client.payload = payload
            client.render(view)
        },
        onRelease = { view ->
            view.stopLoading()
            view.webViewClient = WebViewClient()
            view.destroy()
        },
    )
    if (error.isNotEmpty()) Feedback(error, true)
    }
}
