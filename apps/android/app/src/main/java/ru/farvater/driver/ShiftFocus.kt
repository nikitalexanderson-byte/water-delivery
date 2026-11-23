package ru.farvater.driver

internal data class ShiftFocus(val kind: String, val id: Int = 0)

internal fun Day.canEditCrew() = shift?.status in setOf("pending", "confirmed") &&
    trips.all { it.status == "planned" && it.startedAt == null }

internal fun Day.focus(today: Boolean): ShiftFocus {
    val shift = shift ?: return ShiftFocus("absent")
    if (shift.status == "closed") return ShiftFocus("report")
    if (shift.status == "pending") return ShiftFocus("confirm", shift.id)
    if (!shift.published) return ShiftFocus("unpublished")
    val current = trips.firstOrNull { it.status != "returned" }
    if (current == null)
        return if (trips.isNotEmpty() && shift.status == "active" && today)
            ShiftFocus("settle", shift.id)
        else ShiftFocus("waiting")
    if (!today) return ShiftFocus("preview", current.id)
    if (current.status == "planned") return ShiftFocus("start", current.id)
    val next =
        stops.firstOrNull { it.tripId == current.id && it.status == "assigned" && !it.onSite }
    return next?.let { ShiftFocus("point", it.id) } ?: ShiftFocus("return", current.id)
}

internal fun stopStatus(stop: Stop): String =
    when (stop.status) {
        "delivered" -> if (stop.paid) "Доставлено · оплачено" else "Доставлено · без оплаты"
        "failed" -> "Не доставлено"
        "cancelled" -> "Отменено"
        else -> "Запланировано"
    }
