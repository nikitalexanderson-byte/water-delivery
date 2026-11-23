package ru.farvater.driver

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class InputTest {
    @Test fun remindersUseTheBaseZoneAndCrossMidnight() {
        assertEquals(java.time.Instant.parse("2026-11-23T20:00:00Z").toEpochMilli(),
            callTime("2026-11-24", 30, "Europe/Moscow"))
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
