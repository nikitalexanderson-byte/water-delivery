package ru.farvater.driver

import android.graphics.Bitmap
import android.webkit.RenderProcessGoneDetail
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import android.webkit.WebViewClient
import java.io.ByteArrayInputStream
import java.io.FilterInputStream
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URI

private const val PANEL_POLICY = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; " +
    "connect-src 'self'; img-src 'self' data: https://tile.openstreetmap.org; frame-src 'self'; " +
    "object-src 'none'; base-uri 'self'; form-action 'self'"

private fun emptyReply(code: Int = 403) = WebResourceResponse("text/plain", "UTF-8", code,
    if (code == 403) "Forbidden" else "Unavailable", mapOf("Cache-Control" to "no-store"), ByteArrayInputStream(byteArrayOf()))

internal class OfficeWebClient(
    private val origin: OfficeOrigin,
    session: String,
    private val signOut: (Boolean) -> Unit,
    private val saveReport: (String) -> Unit,
    private val external: (URI) -> Unit,
    private val loadError: () -> Unit,
    private val history: (Boolean) -> Unit,
) : WebViewClient() {
    private var entry: String? = officeEntryHtml(session)
    @Volatile var released = false

    private fun isPage(uri: URI) = uri.rawPath.orEmpty() in setOf("", "/", "/index.html")

    /** The server's static HTML is public. Fetch just this document without cookies or credentials
     *  to apply the office CSP before Chromium processes any of its subresources. */
    private fun panelPage(uri: URI): WebResourceResponse {
        val connection = uri.toURL().openConnection() as HttpURLConnection
        try {
            connection.instanceFollowRedirects = false
            connection.connectTimeout = 8000
            connection.readTimeout = 15000
            connection.setRequestProperty("Accept", "text/html")
            if (connection.responseCode != 200 || !connection.contentType.orEmpty().substringBefore(';').equals("text/html", true)) {
                connection.disconnect()
                return emptyReply(503)
            }
            val stream = object : FilterInputStream(connection.inputStream) {
                override fun close() { try { super.close() } finally { connection.disconnect() } }
            }
            return WebResourceResponse("text/html", "UTF-8", 200, "OK",
                mapOf("Content-Security-Policy" to PANEL_POLICY, "Cache-Control" to "no-store",
                    "Referrer-Policy" to "strict-origin", "X-Content-Type-Options" to "nosniff"), stream)
        } catch (_: IOException) {
            connection.disconnect()
            return emptyReply(503)
        }
    }

    override fun shouldInterceptRequest(view: WebView, req: WebResourceRequest): WebResourceResponse? {
        if (released) return emptyReply()
        val uri = origin.parse(req.url.toString()) ?: return emptyReply()
        if (!origin.accepts(uri)) {
            val credentials = req.requestHeaders.keys.any { it.equals("Authorization", true) || it.equals("Cookie", true) }
            return if (!req.isForMainFrame && req.method == "GET" && !credentials && osmTileAllowed(uri.toString(), true)) null else emptyReply()
        }
        if (uri.rawPath == OFFICE_ENTRY) {
            if (!req.isForMainFrame || req.method != "GET" || uri.rawQuery != null || uri.rawFragment != null) return emptyReply()
            val html = synchronized(this) { entry.also { entry = null } } ?: return emptyReply()
            return WebResourceResponse("text/html", "UTF-8", 200, "OK", mapOf(
                "Content-Security-Policy" to "default-src 'none'; script-src 'unsafe-inline'; base-uri 'none'; form-action 'none'",
                "Cache-Control" to "no-store", "Referrer-Policy" to "no-referrer"),
                html.byteInputStream(Charsets.UTF_8))
        }
        if (uri.rawPath.startsWith("/__farvater_android/")) return emptyReply()
        if (req.isForMainFrame) return if (req.method == "GET" && isPage(uri)) panelPage(uri) else emptyReply()
        return null
    }

    override fun shouldOverrideUrlLoading(view: WebView, req: WebResourceRequest): Boolean {
        if (released) return true
        val uri = origin.parse(req.url.toString()) ?: return true
        if (!origin.accepts(uri)) {
            if (req.hasGesture() && officeExternalAllowed(uri)) external(uri)
            return true
        }
        if (!req.isForMainFrame) return uri.rawPath.startsWith("/__farvater_android/")
        if (uri.rawPath == OFFICE_EXIT && uri.rawQuery == null) { signOut(false); return true }
        origin.reportDate(uri)?.let { saveReport(it); return true }
        return !isPage(uri)
    }

    override fun onPageStarted(view: WebView, url: String, favicon: Bitmap?) {
        val uri = origin.parse(url)
        if (uri == null || !origin.accepts(uri) || !(isPage(uri) || uri.rawPath == OFFICE_ENTRY)) {
            view.stopLoading()
            if (!released) loadError()
        }
    }

    override fun doUpdateVisitedHistory(view: WebView, url: String?, isReload: Boolean) {
        if (!released) history(view.canGoBack())
    }
    override fun onReceivedHttpError(view: WebView, req: WebResourceRequest, error: WebResourceResponse) {
        if (released) return
        val uri = origin.parse(req.url.toString()) ?: return
        if (origin.accepts(uri) && uri.rawPath.startsWith("/api/") && error.statusCode == 401) signOut(true)
        else if (req.isForMainFrame) loadError()
    }
    override fun onReceivedError(view: WebView, req: WebResourceRequest, error: WebResourceError) {
        if (!released && req.isForMainFrame) loadError()
    }
    override fun onRenderProcessGone(view: WebView, detail: RenderProcessGoneDetail): Boolean {
        if (!released) loadError()
        return true
    }
}
