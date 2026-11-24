package ru.farvater.driver

import org.junit.Assert.*
import org.junit.Test

class HelpGuideTest {
    @Test fun dismissingOneRolePreservesFirstRunForEveryOtherRole() {
        val seen = mutableSetOf<String>()
        for (role in listOf("driver", "operator", "manager")) {
            assertNotNull(firstRunGuide(role, seen::contains))
            seen.add(role)
            assertNull(firstRunGuide(role, seen::contains))
        }
        assertNull(firstRunGuide("guest") { error("An unknown role has no preferences") })
    }

    @Test fun eachRoleGetsItsOwnStartAndFinishActions() {
        val actions = mapOf(
            "driver" to listOf("Подтвердить выход", "Подтвердить доставку", "Сдать тару и деньги"),
            "operator" to listOf("Новый заказ", "Распределить заказы", "История заказов"),
            "manager" to listOf("Создать приглашение", "Журнал работы", "Скачать CSV"),
        )
        for ((role, expected) in actions) {
            val guide = requireNotNull(firstRunGuide(role) { false })
            assertEquals(expected.size, guide.steps.size)
            for ((step, action) in guide.steps.zip(expected))
                assertTrue("$role should explain $action", "«$action»" in step.instruction)
        }
    }
}
