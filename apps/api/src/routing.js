// Временные нормативы для демоданных. Время в пределах рабочего дня — в минутах.
export const demoRoutingDefaults = Object.freeze({
  legMinutes: 15,
  stopBase: 8,
  stopPerBottle: 0.7,
  reloadMinutes: 20,
  floorMinutes: 2,
  checkpointMinutes: 5,
  loaderFactor: 0.75,
  cartFactor: 0.8,
  trafficFactor: 1,
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
  return Math.ceil(rules.stopBase + (order.parking_minutes ?? 0)
    + handling * (shift.has_loader ? rules.loaderFactor : 1) * (order.has_cart ? rules.cartFactor : 1)
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
const completed = order => order.status === 'delivered' || order.status === 'failed';

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
    const active = trip.status === 'active';
    // Для выехавшей машины отсчёт от последнего подтверждённого адреса.
    // До первой отметки последним известным местом считается база.
    let time = Math.max(trip.actual_start ?? available, nowMin);
    let previous = active ? trip.live_origin ?? trip.last_visit ?? trip.stops.findLast(completed) ?? BASE : BASE;
    const validate = checkLimits && (!active || trip.extended);
    let bottles = 0;
    const stops = [];
    const fixedPositions = active ? new Set(trip.stops.filter(completed).map(order => order.position)) : null;
    let position = 0;
    for (const order of trip.stops) {
      if (active && completed(order)) {
        // При отмене предыдущей точки номер фактического посещения сохраняется.
        position = Math.max(position, order.position);
        continue;
      }
      if (validate) {
        const issue = vehicleIssue(order, shift);
        if (issue) return { issue };
      }
      bottles += order.water;
      const leg = Math.ceil(map.travelMinutes(previous, order) * rules.trafficFactor);
      driving += leg;
      const eta = Math.max(time + leg, order.window_start);
      time = eta + serviceTime(order, shift, rules);
      if (validate && time > order.window_end) {
        return { issue: 'Не хватает времени на доставку внутри окна клиента' };
      }
      position++;
      while (fixedPositions?.has(position)) position++;
      stops.push({ order_id: order.id, position, eta });
      previous = order;
    }
    if (!active && validate && bottles * BOTTLE_KG > shift.capacity_kg - shift.extra_kg) {
      return { issue: 'В рейсе недостаточно свободной грузоподъёмности' };
    }
    const returnLeg = Math.ceil(map.travelMinutes(previous, BASE) * rules.trafficFactor);
    driving += returnLeg;
    available = time + returnLeg;
    finish = available;
    if (validate && finish > shift.end_min) {
      return { issue: 'Водитель не успеет вернуться на базу до конца смены' };
    }
    timetable.push({ shift_id: shift.id, number: trip.number, stops });
  }
  return { driving, finish, timetable };
}

// Пересчёт ETA уже закреплённых точек после удаления. Текущее опоздание не
// должно блокировать отмену или перенос. Порядок рейсов и точек поступает из БД.
export function shiftSchedule({ shift, trips, settings, nowMin, checkLimits = true, refreshActive = false }) {
  const rules = { ...demoRoutingDefaults, ...settings };
  const result = schedule(shift, trips, rules, rules.mapProvider ?? demoMapProvider(rules.legMinutes), nowMin, checkLimits);
  if (result.issue) return result;
  return { timetable: result.timetable.filter(row => trips.some(t => t.number === row.number &&
    (t.status === 'planned' || (refreshActive && t.status === 'active')))) };
}

export function retimeShift(options) {
  return shiftSchedule({ ...options, checkLimits: false }).timetable;
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

function reserveStock(trip, order) {
  if (!order.items?.length) return { issue: 'Неизвестен состав заказа для сверки остатка на борту' };
  const free = new Map(trip.freeStock ?? (trip.stock_items ?? []).map(item =>
    [item.product_id, item.water_left - item.reserved_water]));
  for (const item of order.items) {
    const remaining = (free.get(item.product_id) ?? 0) - item.water;
    if (remaining < 0) return { issue: 'Недостаточно свободного остатка на борту: ' + (item.name ?? 'вода №' + item.product_id) };
    free.set(item.product_id, remaining);
  }
  return { freeStock: free };
}

function* candidates(shift, trips, order, rules, map, nowMin, reasons, {allowActive,smart,targetTripNumber}) {
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
    if (targetTripNumber != null && trip.number !== targetTripNumber) continue;
    const active = trip.status === 'active' && allowActive;
    if (!active && trip.status !== 'planned') continue;
    const stock = active ? reserveStock(trip, order) : {};
    if (stock.issue) { reasons.add(stock.issue); continue; }
    const first = active ? trip.stops.findLastIndex(stop=>completed(stop)||(smart&&stop.arrived_at)) + 1 : 0;
    for (let position = first; position <= trip.stops.length; position++) {
      const revisedTrip = { ...trip, ...stock, extended: active, stops: insertAt(trip.stops, position, order) };
      const revised = [...trips];
      revised[index] = revisedTrip;
      const result = schedule(shift, revised, rules, map, nowMin);
      if (result.issue) {
        reasons.add(result.issue);
        continue;
      }
      const eta = result.timetable.find(row => row.number === trip.number).stops.find(stop => stop.order_id === order.id).eta;
      let scheduleChange = 0;
      for (const route of result.timetable) {
        for (const stop of route.stops) {
          if (priorEtas.has(stop.order_id)) {
            const change = stop.eta - priorEtas.get(stop.order_id);
            scheduleChange += smart ? Math.max(0, change) : Math.abs(change);
          }
        }
      }
      const extraReload = index === trips.length && index > 0 ? rules.reloadMinutes : 0;
      // Сначала минимизируем дополнительные переезды и погрузку. Затем выбираем
      // меньшую задержку конца смены, меньшую занятость водителя и более ранний ETA.
      const extraDriving = result.driving - baseline.driving;
      const utilization = (result.finish - shift.start_min) / Math.max(1, shift.end_min - shift.start_min);
      const score = smart
        ? [extraDriving + extraReload + scheduleChange * 0.25 + Math.max(0, eta - Math.max(nowMin, order.window_start)) * 0.35,
            scheduleChange, eta, utilization, shift.id, trip.number, position]
        : [extraDriving + extraReload, result.finish - baseline.finish, utilization,
            scheduleChange, eta, shift.id, trip.number, position];
      const timetable = result.timetable.filter(row =>
        revised.some(t => t.number === row.number && (t.status === 'planned' || t.extended)));
      yield { shiftId: shift.id, revised, timetable, score,
        suggestion: {order_id:order.id,version:order.version,shift_id:shift.id,trip_number:trip.number,eta,
          extra_driving_minutes:extraDriving,uses_live_location:active&&Boolean(trip.live_origin)} };
    }
  }
  if (!addTrip && !trips.some(trip => trip.status === 'planned' || (allowActive && trip.status === 'active'))) {
    reasons.add('Оба рейса уже выполняются или завершены');
  }
}

/**
 * Все передаваемые объекты относятся к одному дню работы. В orders лежат заявки
 * очереди, в trips[].stops — уже закреплённые. Результат содержит полные планы
 * открытых рейсов, в том числе прежние точки. Исходные объекты не изменяются.
 */
export function planOrders({ orders, shifts, trips, settings = {}, targetShiftId, nowMin = 0, mapProvider,
  allowActive = false, smart = false, targetTripNumber }) {
  const rules = { ...demoRoutingDefaults, ...settings };
  const map = mapProvider ?? rules.mapProvider ?? demoMapProvider(rules.legMinutes);
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
  const suggestions = [];
  const queue = [...orders].sort((a, b) =>
    a.window_end - b.window_end || a.window_start - b.window_start || a.id - b.id);
  for (const order of queue) {
    if (seen.has(order.id)) continue;
    seen.add(order.id);
    const reasons = new Set();
    let best;
    for (const shift of eligible) {
      for (const option of candidates(shift, byShift.get(shift.id), order, rules, map, nowMin, reasons,
        {allowActive,smart,targetTripNumber})) {
        if (!best || betterScore(option.score, best.score)) best = option;
      }
    }
    if (best) {
      byShift.set(best.shiftId, best.revised);
      timetable.set(best.shiftId, best.timetable);
      if (smart) suggestions.push(best.suggestion);
    } else {
      if (!eligible.length) reasons.add(targetShiftId == null
        ? 'Нет подтверждённых смен' : 'Выбранная смена недоступна для планирования');
      unassigned.push({ order_id: order.id, reason: [...reasons].join('. ') });
    }
  }
  const planned=[...timetable.values()].flat();
  if (!smart) return {trips:planned,unassigned};
  const etas=new Map(planned.flatMap(trip=>trip.stops.map(stop=>[stop.order_id,stop.eta])));
  return {trips:planned,unassigned,suggestions:suggestions.map(item=>({...item,eta:etas.get(item.order_id)}))};
}
