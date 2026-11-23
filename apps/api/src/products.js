import { ensure } from './auth.js';
import { audit } from './day.js';
import { one, rows } from './db.js';

export function catalog(tx, { activeOnly = false, teamId }) {
  return rows(tx, 'SELECT id,name,water_price,active FROM products WHERE team_id=$2 AND (NOT $1::boolean OR active) ORDER BY id',
    [activeOnly,teamId]);
}

export async function defaultProductId(tx,teamId) {
  const product=await one(tx,'SELECT id FROM products WHERE team_id=$1 AND active ORDER BY id LIMIT 1',[teamId]);
  ensure(product,'В команде ещё нет доступной воды в каталоге',400);
  return product.id;
}

export async function createProduct(tx, user, input) {
  const product = await one(tx,
    'INSERT INTO products(name,water_price,active,team_id) VALUES($1,$2,$3,$4) RETURNING id,name,water_price,active',
    [input.name.trim(), input.water_price, input.active ?? true,user.team_id]);
  await audit(tx, user, 'product.created', product.id, product);
  return product;
}

export async function editProduct(tx, user, id, input) {
  const product = await one(tx, `UPDATE products SET name=COALESCE($2,name),
    water_price=COALESCE($3,water_price),active=COALESCE($4,active)
    WHERE id=$1 AND team_id=$5 RETURNING id,name,water_price,active`,
    [id, input.name?.trim()??null, input.water_price??null, input.active??null,user.team_id]);
  ensure(product, 'Товар не найден', 404);
  await audit(tx, user, 'product.updated', id, product);
  return product;
}

export async function orderLines(tx, input, teamId, previousLines = []) {
  const previousId=previousLines.length===1?previousLines[0].product_id:null;
  const requested = input.items ?? [{ product_id: input.product_id ?? previousId ?? await defaultProductId(tx,teamId),
    water: input.water, water_price: input.water_price }];
  ensure(requested.length > 0, 'Добавьте воду в заказ', 400);
  const ids = requested.map(item => item.product_id);
  ensure(new Set(ids).size === ids.length, 'Укажите каждый вид воды одной строкой', 400);
  const available = await rows(tx, 'SELECT id,name,water_price,active FROM products WHERE id=ANY($1::int[]) AND team_id=$2', [ids,teamId]);
  const byId = new Map(available.map(p => [p.id,p]));
  const prior = new Map(previousLines.map(item => [item.product_id,item]));
  const lines = requested.map(item => {
    const product = byId.get(item.product_id);
    ensure(product, 'Выбранный товар не найден', 400);
    const previous = prior.get(item.product_id);
    const price = item.water_price ?? previous?.water_price ?? product.water_price;
    const unchanged = previous && item.water === previous.water && price === previous.water_price;
    ensure(product.active || unchanged, 'Товар снят с продажи: ' + product.name, 409);
    ensure(Number.isInteger(item.water) && item.water > 0, 'Количество бутылей должно быть положительным целым числом', 400);
    ensure(Number.isInteger(price) && price >= 0 && price <= 10000000, 'Проверьте цену воды', 400);
    return { product_id: product.id, name: previous?.name ?? product.name, water: item.water, water_price: price };
  });
  const water = lines.reduce((sum, item) => sum + item.water, 0);
  ensure(water <= 10000, 'Общее количество бутылей превышает 10 000', 400);
  ensure((input.new_shells ?? 0) <= water, 'Новой тары больше, чем заказано воды', 400);
  const water_subtotal = lines.reduce((sum, item) => sum + item.water * item.water_price, 0);
  return { lines, water, water_price: lines[0].water_price, water_subtotal };
}

export function saveLines(tx, orderId, lines) {
  return tx.query(`INSERT INTO order_items(order_id,product_id,name,water,water_price)
    SELECT $1,product_id,name,water,water_price FROM jsonb_to_recordset($2::jsonb)
    AS item(product_id integer,name text,water integer,water_price integer)`, [orderId, JSON.stringify(lines)]);
}
