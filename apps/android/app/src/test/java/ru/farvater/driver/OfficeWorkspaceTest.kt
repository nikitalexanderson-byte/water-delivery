package ru.farvater.driver

import java.net.URI
import java.util.Base64
import org.junit.Assert.*
import org.junit.Test

class OfficeWorkspaceTest {
    private val origin = OfficeOrigin("https://cabinet.example")

    @Test fun officeAndDriverRolesRouteToTheirOwnWorkspaces() {
        for (role in listOf("manager", "operator", "dispatcher")) assertTrue(isOfficeRole(role))
        for (role in listOf("driver", "", "unknown")) assertFalse(isOfficeRole(role))
    }

    @Test fun originMatchesSchemeHostAndPortAndRejectsCredentials() {
        assertTrue(origin.accepts(URI("https://CABINET.example:443/assets/main.js")))
        val usb = OfficeOrigin("http://127.0.0.1:18019")
        assertTrue(usb.accepts(URI("http://127.0.0.1:18019/api/day")))
        assertFalse(usb.accepts(URI("http://127.0.0.1:8080/api/day")))
        for (url in listOf("http://cabinet.example/", "https://cabinet.example:444/",
                "https://cabinet.example.other/", "https://user@cabinet.example/",
                "file:///tmp/login", "content://cabinet.example/login", "//cabinet.example")) {
            assertFalse(url, origin.accepts(URI(url)))
        }
    }

    @Test fun officeSessionUsesOneLocalDocumentAndPreservesUnicode() {
        val session = """{"token":"fixture-only","user":{"name":"Тест </script>","role":"manager"}}"""
        val entry = officeEntryHtml(session)
        val data = Regex("atob\\('([A-Za-z0-9+/=]+)'\\)").find(entry)!!.groupValues[1]
        assertEquals(session, String(Base64.getDecoder().decode(data), Charsets.UTF_8))
        assertFalse(entry.contains("fixture-only"))
        assertFalse(entry.contains("localStorage"))
        assertTrue(entry.contains("sessionStorage.setItem('farvater.session'"))
        assertTrue(entry.contains("location.replace('/')"))
    }

    @Test fun csvPickerOnlyAcceptsARealDateAtItsOwnOrigin() {
        val path = "/__farvater_android/report?date="
        assertEquals("2028-02-29", origin.reportDate(URI(origin.url + path + "2028-02-29")))
        for (url in listOf(origin.url + path + "2027-02-29", origin.url + path + "2026-11-23&token=t",
            "https://other.example" + path + "2026-11-23", origin.url + "/api/reports.csv?date=2026-11-23"))
            assertNull(origin.reportDate(URI(url)))
    }

    @Test fun externalLinksOnlySupportTheDiallerAndKnownMapDestinations() {
        for (url in listOf("tel:+70000000000", "https://yandex.ru/maps/?rtt=auto", "https://www.openstreetmap.org/copyright"))
            assertTrue(officeExternalAllowed(URI(url)))
        for (url in listOf("tel:*123%23", "javascript:void(0)", "https://someone@yandex.ru/maps/",
            "https://yandex.ru:8443/maps/", "https://other.example/maps/", "https://www.openstreetmap.org/user/example"))
            assertFalse(officeExternalAllowed(URI(url)))
    }
}
