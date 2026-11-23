package ru.farvater.driver

import java.net.URI
import java.time.LocalDate
import java.util.Base64

internal fun isOfficeRole(role: String) = role in setOf("manager", "dispatcher", "operator")

internal const val OFFICE_ENTRY = "/__farvater_android/session"
internal const val OFFICE_EXIT = "/__farvater_android/signed-out"
internal const val OFFICE_REPORT = "/__farvater_android/report"

/** BuildConfig contains an HTTP(S) origin. Compare parsed hosts and effective ports for every request. */
internal class OfficeOrigin(val url: String) {
    private val site = URI(url)
    private fun port(uri: URI) = if (uri.port >= 0) uri.port else if (uri.scheme.equals("https", true)) 443 else 80
    fun accepts(uri: URI) = uri.rawUserInfo == null && uri.host != null &&
        uri.scheme.equals(site.scheme, ignoreCase = true) && uri.host.equals(site.host, ignoreCase = true) &&
        port(uri) == port(site)
    fun parse(url: String): URI? = runCatching { URI(url) }.getOrNull()
    fun reportDate(uri: URI): String? {
        if (!accepts(uri) || uri.rawPath != OFFICE_REPORT || uri.rawFragment != null) return null
        val date = Regex("""date=(\d{4}-\d{2}-\d{2})""").matchEntire(uri.rawQuery.orEmpty())
            ?.groupValues?.get(1) ?: return null
        return runCatching { LocalDate.parse(date).toString() }.getOrNull()
    }
}

internal fun officeExternalAllowed(uri: URI): Boolean {
    if (uri.scheme == "tel") return Regex("""\+?[0-9 ()-]{3,25}""").matches(uri.schemeSpecificPart)
    if (uri.scheme != "https" || uri.userInfo != null || uri.port !in listOf(-1, 443)) return false
    return (uri.host == "yandex.ru" && uri.path in setOf("/maps", "/maps/")) ||
        (uri.host == "www.openstreetmap.org" && uri.path == "/copyright")
}

/** This document is returned in memory for one top-level request and never traverses the network. */
internal fun officeEntryHtml(session: String): String {
    val data = Base64.getEncoder().encodeToString(session.toByteArray(Charsets.UTF_8))
    return """<!doctype html><html lang="ru"><meta charset="utf-8"><title>ФАРВАТЕР</title>
        <script>const bytes=Uint8Array.from(atob('$data'),c=>c.charCodeAt(0));
        sessionStorage.setItem('farvater.session',new TextDecoder().decode(bytes));
        location.replace('/');</script></html>""".trimIndent()
}
