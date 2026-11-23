package ru.farvater.driver

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class InputTest {
    @Test fun remindersUseTheBaseZoneAndCrossMidnight() {
        assertEquals(java.time.Instant.parse("2026-11-23T20:00:00Z").toEpochMilli(),
            callTime("2026-11-24", 30, "Europe/Moscow"))
    }

    @Test fun delayedArrivalUsesTheFollowingCalendarDay() {
        // 00:13 в новогоднюю ночь — звонок 31 декабря в 22:43 по Москве.
        assertEquals(java.time.Instant.parse("2026-12-31T19:43:00Z").toEpochMilli(),
            callTime("2026-12-31", 1453, "Europe/Moscow"))
        // При прогнозе 03:00 сам звонок тоже приходится на следующий день.
        val trigger = callTime("2026-12-31", 1620, "UTC")
        assertEquals(java.time.Instant.parse("2027-01-01T01:30:00Z").toEpochMilli(), trigger)
        val saved = "2026-12-31|$trigger|waiting"
        assertFalse(pastRouteAlarmExpired(saved, "2027-01-01",
            java.time.Instant.parse("2027-01-01T00:01:00Z").toEpochMilli()))
        assertTrue(pastRouteAlarmExpired(saved, "2027-01-01",
            java.time.Instant.parse("2027-01-01T03:00:00Z").toEpochMilli()))
    }

    @Test fun actualTimesRequireValidHoursAndMinutes() {
        assertEquals(573, readTime("9:33"))
        assertEquals(0, readTime("00:00"))
        assertNull(readTime("10:60"))
        assertNull(readTime("24:00"))
        assertNull(readTime(""))
    }

    @Test fun moneyIsParsedExactlyInKopecks() {
        assertEquals(1010L, readRubles("10,1"))
        assertEquals(1L, readRubles("0.01"))
        assertEquals(0L, readRubles("0"))
        assertNull(readRubles("-1"))
        assertNull(readRubles("1.234"))
        assertNull(readRubles("1e3"))
        assertNull(readRubles("999999999999999999999999"))
    }

    @Test fun inventoryIsANonNegativeWholeCount() {
        assertEquals(0, readCount("0"))
        assertEquals(12, readCount("12"))
        assertNull(readCount("-1"))
        assertNull(readCount("1.5"))
    }
}
