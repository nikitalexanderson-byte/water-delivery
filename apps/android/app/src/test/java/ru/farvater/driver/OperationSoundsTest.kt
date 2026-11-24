package ru.farvater.driver

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Test

class OperationSoundsTest {
    @Test fun successfulOperationsUseAppropriateCues() {
        assertEquals(OperationCue.Acknowledged, operationCue("orders/3/arrive", JSONObject()))
        assertEquals(OperationCue.Completed, operationCue("orders/3/deliver", JSONObject()))
        assertEquals(OperationCue.Attention, operationCue("orders/4/fail", JSONObject()))
        assertEquals(OperationCue.Completed, operationCue("shifts/1/settle", JSONObject().put("matched", true)))
        assertEquals(OperationCue.Attention, operationCue("shifts/1/settle", JSONObject().put("matched", false)))
    }
}
