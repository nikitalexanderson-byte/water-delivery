import test from 'node:test';
import assert from 'node:assert/strict';
import { planOrders, retimeShift } from '../src/routing.js';

const settings = { legMinutes: 10, stopBase: 5, stopPerBottle: 0, reloadMinutes: 20 };
const order = (id, fields = {}) => ({
  id, water: 5, window_start: 8 * 60, window_end: 22 * 60,
  height_limit_mm: null, address_verified: true, floor: 1, lift: true, ...fields,
});
const shift = (id, fields = {}) => ({
  id, status: 'confirmed', start_min: 8 * 60, end_min: 18 * 60,
  capacity_kg: 2600, extra_kg: 0, total_height_mm: null, has_loader: false, ...fields,
});
const run = options => planOrders({ shifts: [shift(1)], trips: [], orders: [], settings, ...options });
const reason = result => result.unassigned[0].reason;
const ids = trip => trip.stops.map(s => s.order_id);

test('Заказ после 18:00 получает водитель, успевающий обслужить точку и вернуться', () => {
  const shifts = [shift(1), shift(2, { capacity_kg: 3200, end_min: 22 * 60 })];
  const result = run({ shifts, orders: [order(1, { window_start: 18 * 60 })] });
  assert.deepEqual(result, {
    trips: [{ shift_id: 2, number: 1, stops: [{ order_id: 1, position: 1, eta: 18 * 60 }] }],
    unassigned: [],
  });
});

test('При ручном выборе проверяются время, груз и статус водителя', () => {
  const shifts = [shift(1), shift(2, { capacity_kg: 3200, end_min: 1320 })];
  assert.match(reason(run({ shifts, targetShiftId: 1, orders: [order(1, { window_start: 1080 })] })), /вернуться/);
  assert.match(reason(run({ shifts, targetShiftId: 1, orders: [order(1, { water: 145 })] })), /грузоподъёмность/);
  assert.match(reason(run({ shifts, targetShiftId: 3, orders: [order(1)] })), /Выбранная смена/);
});

test('Без подтверждений и после закрытия смены заказы остаются в очереди с причиной', () => {
  const result = run({ shifts: [shift(1, { status: 'pending' }), shift(2, { status: 'closed' })], orders: [order(7)] });
  assert.equal(result.trips.length, 0);
  assert.match(reason(result), /Нет подтверждённых/);
});

test('Ограничение въезда требует известную полную высоту, равенство допустимо', () => {
  const orders = [order(1, { height_limit_mm: 2800 })];
  assert.match(reason(run({ orders })), /полная высота/);
  const shifts = [shift(1, { total_height_mm: 2801 }), shift(2, { total_height_mm: 2800 })];
  assert.match(reason(run({ shifts, orders, targetShiftId: 1 })), /выше/);
  assert.equal(run({ shifts, orders }).trips[0].shift_id, 2);
});

test('Непроверенный адрес остается оператору, координаты или адрес базы не требуются', () => {
  assert.match(reason(run({ orders: [order(1, { address_verified: false })] })), /проверка адреса/);
});

test('ГАЗели вмещают 130 и 160 полных бутылей с учётом дополнительного веса', () => {
  const shifts = [shift(1), shift(2, { capacity_kg: 3200 })];
  assert.deepEqual(run({ shifts, orders: [order(1, { water: 130 }), order(2, { water: 160 })] })
    .trips.map(t => [t.shift_id, ...ids(t)]), [[1, 1], [2, 2]]);
  assert.match(reason(run({ shifts, orders: [order(2, { water: 161 })] })), /грузоподъёмность/);
  assert.match(reason(run({ shifts: [shift(2, { capacity_kg: 3200, extra_kg: 1 })],
    orders: [order(1, { water: 160 })] })), /грузоподъёмность/);
});

test('Второй рейс учитывает погрузку на базе, третий рейс не выделяется', () => {
  const result = run({ orders: [order(1, { water: 130 }), order(2, { water: 130 }), order(3, { water: 1 })] });
  assert.deepEqual(result.trips.map(t => [t.number, t.stops[0].eta]), [[1, 490], [2, 535]]);
  assert.equal(result.unassigned[0].order_id, 3);
  assert.match(reason(result), /недостаточно/);
});

test('Срочный заказ вставляется перед закреплёнными точками с сохранением их порядка', () => {
  const late = order(20, { window_start: 930, window_end: 1000, position: 1, eta: 930 });
  const last = order(30, { window_start: 970, window_end: 1020, position: 2, eta: 970 });
  const trips = [{ shift_id: 1, number: 1, status: 'planned', stops: [late, last] }];
  const frozen = structuredClone(trips);
  const result = run({ trips, orders: [order(10, { window_start: 901, window_end: 920 })] });
  assert.deepEqual(result.trips[0].stops.map(s => [s.order_id, s.position, s.eta]),
    [[10, 1, 901], [20, 2, 930], [30, 3, 970]]);
  assert.deepEqual(trips, frozen);
});

test('Вставка в первый рейс не срывает ранее назначенное окно второго', () => {
  const trips = [
    { shift_id: 1, number: 1, status: 'planned', stops: [order(1, { eta: 490, position: 1 })] },
    { shift_id: 1, number: 2, status: 'planned', stops: [
      order(2, { water: 130, window_start: 535, window_end: 540, eta: 535, position: 1 }),
    ] },
  ];
  const result = run({ trips, orders: [order(3)] });
  assert.deepEqual(result.trips.map(ids), [[1], [2]]);
  assert.equal(result.unassigned[0].order_id, 3);
});

test('Начатый рейс зафиксирован, время второго учитывает выезд, возврат и погрузку', () => {
  const trips = [{ shift_id: 1, number: 1, status: 'active', actual_start: 600, stops: [
    order(8, { position: 1, eta: 495 }),
  ] }];
  const result = run({ trips, orders: [order(9)] });
  assert.deepEqual(result.trips, [{ shift_id: 1, number: 2, stops: [{ order_id: 9, position: 1, eta: 655 }] }]);
  const afterReturn = run({ trips: [{ ...trips[0], status: 'returned', actual_return: 710 }], orders: [order(10)] });
  assert.equal(afterReturn.trips[0].stops[0].eta, 740);
});

test('Планирование от текущего времени не назначает доставку в прошедшее окно', () => {
  const result = run({ nowMin: 750, orders: [order(3, { window_end: 760 })] });
  assert.match(reason(result), /внутри окна/);
});

test('Этаж, лифт, КПП и присутствие грузчика меняют длительность обслуживания', () => {
  const options = {
    settings: { ...settings, stopBase: 4, stopPerBottle: 1, floorMinutes: 2, checkpointMinutes: 3, loaderFactor: 0.5 },
    orders: [order(1, { water: 4, floor: 5, lift: false, checkpoint: true, window_end: 503 })],
  };
  assert.match(reason(run(options)), /внутри окна/);
  assert.equal(run({ ...options, shifts: [shift(1, { has_loader: true })] }).unassigned.length, 0);
  assert.equal(run({ ...options, orders: [{ ...options.orders[0], lift: true }] }).unassigned.length, 0);
});

test('Сменный провайдер задаёт время между конкретными остановками, включая возвращение', () => {
  const travelMinutes = (from, to) => {
    if (!from || !to) return 10;
    return from.id === 1 && to.id === 2 ? 2 : 25;
  };
  const result = run({ orders: [order(1), order(2)], mapProvider: { travelMinutes } });
  assert.deepEqual(result.trips[0].stops.map(s => [s.order_id, s.eta]), [[1, 490], [2, 497]]);
});

test('Повторный подбор сохраняет точки и не добавляет повторно тот же заказ', () => {
  const trip = { shift_id: 1, number: 1, status: 'planned', stops: [order(1, { eta: 490, position: 1 })] };
  const result = run({ trips: [trip], orders: [order(1), order(2), order(2)] });
  assert.deepEqual(ids(result.trips[0]), [1, 2]);
  assert.deepEqual(result.unassigned, []);
});

test('После удаления точки прогноз показывает новое ETA даже при уже пропущенном окне', () => {
  const trips = [
    { number: 1, status: 'returned', actual_return: 800, stops: [] },
    { number: 2, status: 'planned', stops: [order(5, { window_end: 790, eta: 775, position: 2 })] },
  ];
  assert.deepEqual(retimeShift({ shift: shift(1), trips, settings, nowMin: 810 }), [
    { shift_id: 1, number: 2, stops: [{ order_id: 5, position: 1, eta: 830 }] },
  ]);
});

const line = (product_id, water) => ({ product_id, water, name: 'Вода ' + product_id });
const activeTrips = (fields = {}) => [
  { shift_id: 1, number: 1, status: 'returned', actual_return: 600, stops: [] },
  { shift_id: 1, number: 2, status: 'active', actual_start: 630,
    stock_items: [{ product_id: 1, water_left: 11, reserved_water: 9 }, { product_id: 2, water_left: 10, reserved_water: 10 }],
    stops: [], ...fields },
];

test('На ходу резервируется каждая марка, включая предыдущие вставки той же партии', () => {
  const queue = [order(1, { water: 2, items: [line(1, 1), line(2, 1)] }),
    order(2, { water: 2, items: [line(1, 2)] }), order(3, { water: 1, items: [line(1, 1)] })];
  const result = run({ allowActive: true, nowMin: 650, trips: activeTrips(), orders: queue });
  assert.deepEqual(result.trips.map(ids), [[2]]);
  assert.deepEqual(result.unassigned.map(x => x.order_id), [1, 3]);
  assert.match(result.unassigned[0].reason, /Вода 2/);
  assert.match(result.unassigned[1].reason, /Вода 1/);
});

test('Срочная точка учитывает последний подтверждённый адрес, окно, въезд и возврат', () => {
  const done = order(4, { position: 1, status: 'delivered' });
  const middle = order(5, { position: 2, status: 'assigned' });
  const failed = order(6, { position: 3, status: 'failed' });
  const late = order(7, { position: 4, status: 'assigned', window_start: 755 });
  const options = { allowActive: true, nowMin: 650, trips: activeTrips({ stops: [done, middle, failed, late], last_visit: done }),
    orders: [order(1, { items: [line(1, 1)], window_end: 730 })],
    mapProvider: { travelMinutes: (from, to) => (from?.id === 4 && to?.id === 5) ? 12 : 10 } };
  const result = run(options);
  assert.deepEqual(result.trips[0].stops,
    [{ order_id: 5, position: 2, eta: 662 }, { order_id: 1, position: 4, eta: 677 }, { order_id: 7, position: 5, eta: 755 }]);
  assert.match(reason(run({ ...options, shifts: [shift(1, { end_min: 768 })] })), /вернуться/);
  assert.match(reason(run({ ...options, orders: [{ ...options.orders[0], height_limit_mm: 2600 }] })), /высота/);
  assert.match(reason(run({ ...options, orders: [{ ...options.orders[0], window_end: 679 }] })), /окна/);
  assert.deepEqual(run({ ...options, allowActive: false }).trips, []);
});

test('Для одной заявки сравниваются попутный активный и ещё стоящий на базе водитель', () => {
  const last = order(20, { position: 1, status: 'delivered' });
  const options = { allowActive: true, nowMin: 650, shifts: [shift(1), shift(2)], trips: activeTrips({ stops: [last] }),
    orders: [order(1, { water: 1, items: [line(1, 1)] })] };
  const choose = detour => run({ ...options, mapProvider: { travelMinutes: (from, to) =>
    from?.id === 20 && to?.id === 1 ? detour : 10 } }).trips[0].shift_id;
  assert.equal(choose(1), 1);
  assert.equal(choose(50), 2);
});

test('Парковка и КПП добавляются полностью, тележка и грузчик влияют на работу, пробки на оба плеча', () => {
  const options = { shifts: [shift(1, { has_loader: true, end_min: 529 })],
    settings: { ...settings, stopBase: 4, stopPerBottle: 1, floorMinutes: 2, checkpointMinutes: 3,
      loaderFactor: 0.75, cartFactor: 0.5, trafficFactor: 1.5 },
    orders: [order(1, { water: 4, floor: 5, lift: false, checkpoint: true, has_cart: true, parking_minutes: 7, window_end: 514 })] };
  assert.equal(run(options).trips[0].stops[0].eta, 495);
  assert.match(reason(run({ ...options, orders: [{ ...options.orders[0], has_cart: false }] })), /окна/);
  assert.match(reason(run({ ...options, shifts: [shift(1, { has_loader: true, end_min: 528 })] })), /вернуться/);
});
