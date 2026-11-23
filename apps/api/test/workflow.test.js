import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { after, before, test } from 'node:test';
import { createApp } from '../src/app.js';
import { calendar, configuration } from '../src/config.js';
import { database } from '../src/db.js';
import { seed } from '../src/seed.js';

const config = { ...configuration(), timezone: 'Europe/Moscow', address: '', lat: null, lon: null };
const password = 'fixture-password-19';
const accounts = {};
let db, server, origin, today, tomorrow, now, seededCounts;

// Фактическая дата тестового сида привязана к дню инициализации. Часы API управляемы.
function localTime(time) {
  return new Date(`${today}T${time}:00+03:00`);
}

async function http(method, path, user, body, key) {
  const headers = {};
  if (user) headers.Authorization = 'Bearer ' + accounts[user].token;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (key) headers['Idempotency-Key'] = key;
  return fetch(origin + '/api' + path, { method, headers, body: JSON.stringify(body) });
}

async function success(response) {
  const res = await response;
  const body = await res.json();
  assert.ok(res.ok, `HTTP ${res.status} (${res.url}): ${JSON.stringify(body)}`);
  return body;
}

const day = (user, date = today) => success(http('GET', '/day?date=' + date, user));
const post = (user, path, body, key = randomUUID()) => success(http('POST', path, user, body, key));
const execute = (query, params) => db.transaction(async tx => (await tx.query(query, params)).rows);

const inspectSeed = () => execute(`SELECT
  (SELECT count(*)::int FROM accounts) AS accounts,
  (SELECT count(*)::int FROM vehicles) AS vehicles,
  (SELECT count(*)::int FROM shifts) AS shifts,
  (SELECT count(*)::int FROM customers) AS customers,
  (SELECT count(*)::int FROM orders) AS orders`);

before(async () => {
  db = await database(process.env.TEST_DATABASE_URL ? { url: process.env.TEST_DATABASE_URL } : { memory: true });
  await seed(db, config, password);
  seededCounts = await inspectSeed();
  ({ today, tomorrow } = calendar(config));
  now = localTime('12:00');
  server = createApp({ db, config, clock: () => now }).listen(0, '127.0.0.1');
  await once(server, 'listening');
  origin = 'http://127.0.0.1:' + server.address().port;
  for (const login of ['operator', 'dispatcher', 'driver1', 'driver2', 'manager']) {
    accounts[login] = await success(http('POST', '/login', null,
      { email: login + '@farvater.test', password }));
  }
});

after(async () => {
  if (server) await new Promise(resolve => server.close(resolve));
  if (db) await db.close();
});

function details(date = today) {
  return {
    name: 'Тестовая точка', phone: '+70000000009', address: 'Учебный проезд, 19', address_verified: true,
    date, window_start: 600, window_end: 1080, water: 3, new_shells: 1, water_price: 19999,
    payment_method: 'cash', category: 'retail',
  };
}

test('Миграции и сид создают две машины; повторный сид сохраняет существующие данные', async () => {
  assert.equal((await execute('SELECT name FROM migrations')).filter(x => x.name === '001_core.sql').length, 1);
  const initial = await inspectSeed();
  await seed(db, config, password);
  assert.deepEqual(await inspectSeed(), initial);
  assert.deepEqual(seededCounts, [{ accounts: 5, vehicles: 2, shifts: 4, customers: 3, orders: 3 }]);
  const vehicles = await execute('SELECT capacity_kg,length_mm,body_height_mm,total_height_mm FROM vehicles ORDER BY capacity_kg');
  assert.deepEqual(vehicles, [
    { capacity_kg: 2600, length_mm: 4200, body_height_mm: 2400, total_height_mm: null },
    { capacity_kg: 3200, length_mm: 4200, body_height_mm: 2200, total_height_mm: null },
  ]);
  const publicConfig = await success(http('GET', '/config'));
  assert.equal(publicConfig.today, today);
  assert.equal(publicConfig.tomorrow, tomorrow);
  assert.equal(publicConfig.base_lat, null);
  assert.equal(publicConfig.base_lon, null);
});

test('Для действий нужны действующий токен и нужная роль', async () => {
  assert.equal((await http('GET', '/day?date=' + today)).status, 401);
  assert.equal((await http('POST', '/login', null, { email: 'operator@farvater.test', password: 'wrong' })).status, 401);
  assert.equal(accounts.driver1.user.role, 'driver');
  assert.equal(accounts.operator.user.role, 'operator');
  assert.equal((await http('POST', '/plan', 'operator', { date: today })).status, 403);
  assert.equal((await http('POST', '/orders', 'driver1', details())).status, 403);
  assert.equal((await http('GET', '/reports.csv?date=' + today, 'driver2')).status, 403);
  accounts.extra = await success(http('POST', '/login', null, { email: 'MANAGER@FARVATER.TEST', password }));
  await post('extra', '/logout', {});
  assert.equal((await http('GET', '/day?date=' + today, 'extra')).status, 401);
});

test('Контроль окна, тары и компании; версию заказа может изменить только один запрос', async () => {
  for (const fields of [{ window_end: 550 }, { new_shells: 4 }, { payment_method: 'bank', company: ' ' }]) {
    assert.equal((await http('POST', '/orders', 'operator', { ...details(), ...fields })).status, 400);
  }
  const { id, total } = await post('operator', '/orders', details());
  assert.equal(Number(total), 84997);
  const { version } = (await day('operator')).orders.find(o => o.id === id);
  const results = await Promise.all([
    http('POST', `/orders/${id}/cancel`, 'operator', { version }, randomUUID()),
    http('POST', `/orders/${id}/reschedule`, 'operator',
      { version, date: tomorrow, window_start: 601, window_end: 1035 }, randomUUID()),
  ]);
  assert.deepEqual(results.map(r => r.status).sort(), [200, 409]);
});

test('Завтрашний маршрут скрыт до 18:00; чужие контакты и рейсы скрыты и после публикации', async () => {
  const { shifts } = await day('driver1', tomorrow);
  assert.equal(shifts.length, 1);
  const shiftId = shifts[0].id;
  await post('driver1', `/shifts/${shiftId}/confirm`, {});
  const { id } = await post('operator', '/orders', details(tomorrow));
  const result = await post('dispatcher', '/plan', { date: tomorrow, order_id: id, shift_id: shiftId });
  assert.equal(result.assigned, 1);
  try {
    now = localTime('17:59');
    const early = await day('driver1', tomorrow);
    assert.equal(early.shifts[0].published, false);
    assert.deepEqual([early.orders, early.trips, early.customers], [[], [], []]);
    now = localTime('18:00');
    const published = await day('driver1', tomorrow);
    assert.equal(published.shifts[0].published, true);
    assert.deepEqual(published.orders.map(o => o.id), [id]);
    assert.equal(published.trips.length, 1);
    const other = await day('driver2', tomorrow);
    assert.deepEqual([other.orders, other.trips, other.customers], [[], [], []]);
    assert.ok((await day('dispatcher', tomorrow)).customers.length >= 3);
    assert.ok([403, 404].includes((await http('POST', `/shifts/${shiftId}/confirm`, 'driver2', {}, randomUUID())).status));
  } finally {
    now = localTime('12:00');
  }
});

async function assignedTrip(user, inputs, loaded) {
  const { shifts } = await day(user);
  const shiftId = shifts[0].id;
  await post(user, `/shifts/${shiftId}/confirm`, {});
  for (const input of inputs) {
    const { id } = await post('operator', '/orders', { ...details(), ...input });
    const result = await post('dispatcher', '/plan', { date: today, order_id: id, shift_id: shiftId });
    assert.equal(result.assigned, 1, JSON.stringify(result));
  }
  const { trips, orders } = await day(user);
  assert.equal(trips.length, 1);
  const tripId = trips[0].id;
  const startPath = `/trips/${tripId}/start`;
  assert.equal((await http('POST', startPath, user, { actual_start: 720, water: 1 }, randomUUID())).status, 409);
  assert.equal((await http('POST', startPath, user, { actual_start: 720, water: 200 }, randomUUID())).status, 409);
  assert.equal((await day(user)).trips[0].water_left, 0);
  await post(user, startPath, { actual_start: 720, water: loaded });
  const earlyReturn = await http('POST', `/trips/${tripId}/return`, user, { actual_return: 750 }, randomUUID());
  assert.equal(earlyReturn.status, 409);
  return { shiftId, tripId, orders: orders.sort((a,b) => a.position - b.position) };
}

test('Оплаченная и неоплаченная доставки, одновременный повтор, остатки и точная сдача', async () => {
  const { shiftId, tripId, orders } = await assignedTrip('driver1', [
    {}, { category: 'wholesale', company: 'Учебный офис', payment_method: 'bank', water: 2, new_shells: 0, water_price: 12500 },
  ], 8);
  assert.equal(orders.length, 2);
  const started = (await day('driver1')).trips[0];
  assert.equal(started.actual_start, 720);
  assert.equal(started.water_left, 8);
  assert.equal((await http('POST', `/orders/${orders[0].id}/cancel`, 'operator',
    { version: orders[0].version }, randomUUID())).status, 409);
  for (const order of orders) {
    const paid = order.payment_method === 'cash';
    const path = `/orders/${order.id}/deliver`;
    const body = { version: order.version, empty: paid ? 3 : 2, paid };
    assert.ok([403, 404].includes((await http('POST', path, 'driver2', body, randomUUID())).status));
    const key = randomUUID();
    const [first, replay] = await Promise.all([post('driver1', path, body, key), post('driver1', path, body, key)]);
    assert.deepEqual(first, replay);
    assert.equal((await http('POST', path, 'driver1', { ...body, empty: 0 }, key)).status, 409);
    assert.equal((await http('POST', path, 'driver1', body, randomUUID())).status, 409);
  }
  const completed = await day('driver1');
  assert.equal(completed.trips[0].water_left, 3);
  assert.equal(completed.trips[0].empty_collected, 5);
  assert.equal(completed.orders.filter(o => o.status === 'delivered').length, 2);
  const deliveries = await execute('SELECT order_id FROM inventory WHERE trip_id=$1 AND kind=\'delivery\' ORDER BY order_id', [tripId]);
  assert.deepEqual(deliveries.map(d => d.order_id), orders.map(o => o.id).sort((a,b) => a-b));
  await post('driver1', `/trips/${tripId}/return`, { actual_return: 800 });
  const expected = { water: 3, empty: 5, cash: 84997, bank: 0 };
  const report = await post('driver1', `/shifts/${shiftId}/settle`, { ...expected, loader_minutes: 0 });
  assert.equal(report.matched, true);
  assert.deepEqual(report.expected, expected);
  assert.deepEqual(report.actual, expected);
  assert.deepEqual(report.difference, { water: 0, empty: 0, cash: 0, bank: 0 });
  assert.equal(Number(report.unpaid), 25000);
  assert.equal(Number(report.earnings), 95000);
  assert.equal(report.delivered_stops, 2);
  assert.equal(report.delivered_water, 5);
  assert.equal(report.sold_shells, 1);
  assert.equal((await day('driver1')).shifts[0].status, 'closed');
  assert.ok((await day('manager')).reports.some(r => r.id === report.id && r.matched));
  assert.equal((await day('driver2')).reports.some(r => r.id === report.id), false);
});

test('Расхождения по деньгам, воде и таре сохраняются для проверки диспетчером и выгрузки', async () => {
  const { shiftId, tripId, orders: [order] } = await assignedTrip('driver2', [
    { water: 4, new_shells: 2, water_price: 25000, payment_method: 'bank', category: 'wholesale', company: 'Учебный банк' },
  ], 6);
  await post('driver2', `/orders/${order.id}/deliver`, { version: order.version, empty: 2, paid: true });
  await post('driver2', `/trips/${tripId}/return`, { actual_return: 820 });
  const actual = { water: 1, empty: 3, cash: 100, bank: 149990 };
  const report = await post('driver2', `/shifts/${shiftId}/settle`, { ...actual, loader_minutes: 60 });
  assert.equal(report.matched, false);
  assert.deepEqual(report.actual, actual);
  assert.deepEqual(report.expected, { water: 2, empty: 2, cash: 0, bank: 150000 });
  assert.deepEqual(report.difference, { water: -1, empty: 1, cash: 100, bank: -10 });
  assert.equal(Number(report.earnings), 42200);
  assert.equal(report.loader_minutes, 60);
  assert.equal(report.reviewed, false);
  assert.equal((await http('POST', `/reports/${report.id}/review`, 'driver2', {}, randomUUID())).status, 403);
  await post('dispatcher', `/reports/${report.id}/review`, {});
  const reviewed = (await day('manager')).reports.find(r => r.id === report.id);
  assert.equal(reviewed.reviewed, true);
  assert.equal(reviewed.matched, false);
  assert.deepEqual(reviewed.difference, report.difference);
  const csv = await http('GET', '/reports.csv?date=' + today, 'manager');
  assert.equal(csv.status, 200);
  assert.match(csv.headers.get('content-type'), /text\/csv/);
  const bytes = Buffer.from(await csv.arrayBuffer());
  assert.equal(bytes.subarray(0, 3).toString('hex'), 'efbbbf');
  assert.ok(bytes.toString().includes(reviewed.driver_name));
});
