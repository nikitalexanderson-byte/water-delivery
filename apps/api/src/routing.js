// Временные нормативы для демоданных. Время в пределах рабочего дня — в минутах.
export const demoRoutingDefaults = Object.freeze({
  legMinutes: 15,
  stopBase: 8,
  stopPerBottle: 0.7,
  reloadMinutes: 20,
  floorMinutes: 2,
  checkpointMinutes: 5,
  loaderFactor: 0.75,
});

const BOTTLE_KG = 20;
const MAX_TRIPS = 2;
const BASE = null;

// Провайдер возвращает целые минуты между двумя точками заказа или базой (null).
// Другая реализация может читать предварительно полученную матрицу дорожных времён.
export function demoMapProvider(legMinutes) {
  return { travelMinutes: () => legMinutes };
}

function serviceTime(order, shift, rules) {
  const stairs = order.lift ? 0 : Math.max(0, (order.floor ?? 1) - 1) * rules.floorMinutes;
  const handling = order.water * rules.stopPerBottle + stairs;
  return Math.ceil(rules.stopBase + handling * (shift.has_loader ? rules.loaderFactor : 1)
    + (order.checkpoint ? rules.checkpointMinutes : 0));
}

function vehicleIssue(order, shift) {
  if (!order.address_verified) return 'Требуется проверка адреса';
  if (order.water * BOTTLE_KG > shift.capacity_kg - shift.extra_kg) {
    return 'Вес заказа превышает доступную грузоподъёмность';
  }
  if (order.height_limit_mm == null) return null;
  if (shift.total_height_mm == null) return 'Нужна полная высота автомобиля для проверки въезда';
  if (shift.total_height_mm > order.height_limit_mm) return 'Автомобиль выше допустимого въезда';
  return null;
}

// Пересчитывается вся смена: вставка в первый рейс может сорвать окно во втором.
// Фактический выезд и возвращение имеют приоритет над любым планом.
function schedule(shift, trips, rules, map, nowMin, checkLimits = true) {
  let available = shift.start_min;
  let driving = 0;
  let previousTripExists = false;
  let finish = shift.start_min;
  const timetable = [];

  for (const trip of trips) {
    if (previousTripExists) available += rules.reloadMinutes;
    previousTripExists = true;
    if (trip.status === 'returned' && trip.actual_return != null) {
      available = trip.actual_return;
      finish = available;
      continue;
    }
    const planned = trip.status === 'planned';
    let time = trip.actual_start ?? Math.max(available, planned ? nowMin : shift.start_min);
    let previous = BASE;
    let bottles = 0;
    const stops = [];
    for (const order of trip.stops) {
      if (planned && checkLimits) {
        const issue = vehicleIssue(order, shift);
        if (issue) return { issue };
      }
      bottles += order.water;
      if (trip.status === 'active' && order.status !== 'delivered') time = Math.max(time, nowMin);
      const leg = map.travelMinutes(previous, order);
      driving += leg;
      const eta = Math.max(time + leg, order.window_start);
      time = eta + serviceTime(order, shift, rules);
      if (planned && checkLimits && time > order.window_end) {
        return { issue: 'Не хватает времени на доставку внутри окна клиента' };
      }
      stops.push({ order_id: order.id, position: stops.length + 1, eta });
      previous = order;
    }
    if (planned && checkLimits && bottles * BOTTLE_KG > shift.capacity_kg - shift.extra_kg) {
      return { issue: 'В рейсе недостаточно свободной грузоподъёмности' };
    }
    const returnLeg = map.travelMinutes(previous, BASE);
    driving += returnLeg;
    if (trip.status === 'active') time = Math.max(time, nowMin);
    available = time + returnLeg;
    finish = available;
    if (planned && checkLimits && finish > shift.end_min) {
      return { issue: 'Водитель не успеет вернуться на базу до конца смены' };
    }
    if (planned) timetable.push({ shift_id: shift.id, number: trip.number, stops });
  }
  return { driving, finish, timetable };
}

// Пересчёт ETA уже закреплённых точек после удаления. Текущее опоздание не
// должно блокировать отмену или перенос. Порядок рейсов и точек поступает из БД.
export function retimeShift({ shift, trips, settings, nowMin }) {
  const rules = { ...demoRoutingDefaults, ...settings };
  return schedule(shift, trips, rules, demoMapProvider(rules.legMinutes), nowMin, false).timetable;
}

function betterScore(a, b) {
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return a[i] < b[i];
  }
  return false;
}

function insertAt(list, index, item) {
  return [...list.slice(0, index), item, ...list.slice(index)];
}

function* candidates(shift, trips, order, rules, map, nowMin, reasons) {
  const issue = vehicleIssue(order, shift);
  if (issue) {
    reasons.add(issue);
    return;
  }
  const baseline = schedule(shift, trips, rules, map, nowMin);
  if (baseline.issue) {
    reasons.add(baseline.issue);
    return;
  }
  const priorEtas = new Map(baseline.timetable.flatMap(trip =>
    trip.stops.map(stop => [stop.order_id, stop.eta])));
  const lastNumber = trips.at(-1)?.number ?? 0;
  const addTrip = lastNumber < MAX_TRIPS;
  const templates = addTrip
    ? [...trips, { shift_id: shift.id, number: lastNumber + 1, status: 'planned', stops: [] }]
    : trips;

  for (const [index, trip] of templates.entries()) {
    if (trip.status !== 'planned') continue;
    for (let position = 0; position <= trip.stops.length; position++) {
      const revisedTrip = { ...trip, stops: insertAt(trip.stops, position, order) };
      const revised = [...trips];
      revised[index] = revisedTrip;
      const result = schedule(shift, revised, rules, map, nowMin);
      if (result.issue) {
        reasons.add(result.issue);
        continue;
      }
      const eta = result.timetable.find(row => row.number === trip.number).stops[position].eta;
      let scheduleChange = 0;
      for (const route of result.timetable) {
        for (const stop of route.stops) {
          if (priorEtas.has(stop.order_id)) scheduleChange += Math.abs(stop.eta - priorEtas.get(stop.order_id));
        }
      }
      const extraReload = index === trips.length && index > 0 ? rules.reloadMinutes : 0;
      // Сначала минимизируем дополнительные переезды и погрузку. Затем выбираем
      // меньшую задержку конца смены, меньшую занятость водителя и более ранний ETA.
      const score = [result.driving - baseline.driving + extraReload, result.finish - baseline.finish,
        (result.finish - shift.start_min) / Math.max(1, shift.end_min - shift.start_min),
        scheduleChange, eta, shift.id, trip.number, position];
      yield { shiftId: shift.id, revised, timetable: result.timetable, score };
    }
  }
  if (!addTrip && !trips.some(trip => trip.status === 'planned')) {
    reasons.add('Оба рейса уже выполняются или завершены');
  }
}

/**
 * Все передаваемые объекты относятся к одному дню работы. В orders лежат заявки
 * очереди, в trips[].stops — уже закреплённые. Результат содержит полные планы
 * открытых рейсов, в том числе прежние точки. Исходные объекты не изменяются.
 */
export function planOrders({ orders, shifts, trips, settings = {}, targetShiftId, nowMin = 0, mapProvider }) {
  const rules = { ...demoRoutingDefaults, ...settings };
  const map = mapProvider ?? demoMapProvider(rules.legMinutes);
  const byShift = new Map();
  const timetable = new Map();
  const seen = new Set();
  for (const shift of shifts) {
    const existing = trips.filter(trip => trip.shift_id === shift.id)
      .sort((a, b) => a.number - b.number)
      .map(trip => ({ ...trip, stops: [...trip.stops].sort((a, b) => a.position - b.position) }));
    byShift.set(shift.id, existing);
    const original = existing.filter(t => t.status === 'planned').map(trip => ({
      shift_id: shift.id, number: trip.number,
      stops: trip.stops.map(({ id: order_id, eta, position }) => ({ order_id, eta, position })),
    }));
    timetable.set(shift.id, original);
    existing.forEach(trip => trip.stops.forEach(stop => seen.add(stop.id)));
  }
  const eligible = shifts.filter(shift => ['confirmed', 'active'].includes(shift.status)
    && (targetShiftId == null || shift.id === targetShiftId));
  const unassigned = [];
  const queue = [...orders].sort((a, b) =>
    a.window_end - b.window_end || a.window_start - b.window_start || a.id - b.id);
  for (const order of queue) {
    if (seen.has(order.id)) continue;
    seen.add(order.id);
    const reasons = new Set();
    let best;
    for (const shift of eligible) {
      for (const option of candidates(shift, byShift.get(shift.id), order, rules, map, nowMin, reasons)) {
        if (!best || betterScore(option.score, best.score)) best = option;
      }
    }
    if (best) {
      byShift.set(best.shiftId, best.revised);
      timetable.set(best.shiftId, best.timetable);
    } else {
      if (!eligible.length) reasons.add(targetShiftId == null
        ? 'Нет подтверждённых смен' : 'Выбранная смена недоступна для планирования');
      unassigned.push({ order_id: order.id, reason: [...reasons].join('. ') });
    }
  }
  return { trips: [...timetable.values()].flat(), unassigned };
}
