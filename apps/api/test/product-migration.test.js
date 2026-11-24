import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { Client } from 'pg';
import { PGlite } from '@electric-sql/pglite';
import { one, rows } from '../src/db.js';
import { catalog, createProduct, editProduct, orderLines } from '../src/products.js';
import { createOrder } from '../src/orders.js';
import { rescheduleFailed } from '../src/outcomes.js';

// Схема имитирует стенд, работавший на предыдущем релизе. В PostgreSQL
// транзакция с отдельным search_path изолирует её от параллельных HTTP-тестов.
async function isolatedSchema(t) {
  if (!process.env.TEST_DATABASE_URL) {
    const local = await PGlite.create();
    t.after(() => local.close());
    return local;
  }
  const client = new Client({ connectionString: process.env.TEST_DATABASE_URL });
  await client.connect();
  t.after(async () => {
    try { await client.query('ROLLBACK'); }
    finally { await client.end(); }
  });
  const schema = 'upgrade_' + randomUUID().replaceAll('-', '');
  await client.query('BEGIN');
  await client.query('CREATE SCHEMA ' + schema);
  await client.query('SET LOCAL search_path TO ' + schema);
  return { exec: sql => client.query(sql), query: (sql,args) => client.query(sql,args) };
}

async function migrate(tx, name) {
  await tx.exec(await readFile(new URL('../migrations/' + name, import.meta.url),'utf8'));
}

test('Миграция ролей сохраняет сессии и приглашения бывших диспетчеров',async t=>{
  const tx=await isolatedSchema(t);
  const migrations=new URL('../migrations/',import.meta.url);
  for(const name of (await readdir(migrations)).filter(name=>/^0(0[1-9]|1[01])_.*\.sql$/.test(name)).sort()) await migrate(tx,name);
  const {id}=await one(tx,`INSERT INTO accounts(email,name,role,password_hash)
    VALUES('desk@example.test','Офис','dispatcher','fixture') RETURNING id`);
  await tx.query("INSERT INTO sessions VALUES('existing',$1,now()+interval '1 day')",[id]);
  await tx.query("INSERT INTO invitations(digest,team_id,role,created_by,expires_at) VALUES('legacy',1,'dispatcher',$1,now()+interval '1 day')",[id]);
  await migrate(tx,'012_staff_roles.sql');
  assert.deepEqual(await one(tx,`SELECT a.id,a.role FROM accounts a JOIN sessions s ON s.account_id=a.id
    WHERE s.digest='existing'`),{id,role:'operator'});
  assert.equal((await one(tx,"SELECT role FROM invitations WHERE digest='legacy'")).role,'operator');
});

test('Обновление до каталога сохраняет старую выручку, склад, сверку и снимки смешанной корзины', async t => {
  const tx = await isolatedSchema(t);
  await migrate(tx,'001_core.sql');
  await migrate(tx,'002_stop_outcomes.sql');
  await tx.exec(`
    INSERT INTO accounts(email,name,password_hash,role) VALUES ('qa@farvater.test','Тест','fixture','driver');
    INSERT INTO vehicles(name,capacity_kg,length_mm,body_height_mm) VALUES ('ГАЗель',2600,4200,2400);
    INSERT INTO customers(name,phone,address) VALUES ('Тест','+70000000000','Учебный адрес');
    INSERT INTO shifts(driver_id,vehicle_id,date,start_min,end_min,status) VALUES (1,1,'2026-01-10',480,1080,'closed');
    INSERT INTO trips(shift_id,number,status,actual_start,actual_return) VALUES (1,1,'returned',500,580);
    INSERT INTO orders(customer_id,name,phone,address,date,window_start,window_end,water,new_shells,
      water_price,shell_price,category,payment_method,status,trip_id,position,paid)
      VALUES (1,'Тест','+70000000000','Учебный адрес','2026-01-10',500,620,3,1,20301,25000,'retail','cash','delivered',1,1,true);
    INSERT INTO inventory(trip_id,order_id,kind,full_delta,empty_delta,sold_shells)
      VALUES(1,null,'load',5,0,0),(1,1,'delivery',-3,1,1);
    INSERT INTO receipts(order_id,amount,method,confirmed,earnings,per_stop,per_bottle)
      SELECT id,total,'cash',true,40000,25000,5000 FROM orders;
    INSERT INTO settlements(shift_id,expected,actual,difference,matched,delivered_water,delivered_stops,
      sold_shells,earnings,unpaid,loader_minutes)
      VALUES(1,'{"water":2,"empty":1,"cash":85903,"bank":0}','{"water":1,"empty":1,"cash":85903,"bank":0}',
      '{"water":-1,"empty":0,"cash":0,"bank":0}',false,3,1,1,40000,0,0);
  `);
  await migrate(tx,'003_products.sql');
  assert.equal(Number((await one(tx,'SELECT total FROM orders WHERE id=1')).total),85903);
  assert.equal(Number((await one(tx,'SELECT amount FROM receipts WHERE order_id=1')).amount),85903);
  assert.deepEqual(await rows(tx,'SELECT product_id,name,water,water_price FROM order_items'), [
    { product_id:1, name:'Вода 19 л', water:3, water_price:20301 },
  ]);
  assert.deepEqual(await rows(tx,'SELECT product_id,full_delta FROM inventory_items ORDER BY inventory_id'), [
    { product_id:1, full_delta:5 }, { product_id:1, full_delta:-3 },
  ]);
  assert.deepEqual((await one(tx,'SELECT stock_items FROM settlements')).stock_items, [
    { product_id:1, name:'Вода 19 л', expected:2, actual:1, difference:-1 },
  ]);
  // API ниже создаёт заказы в актуальной схеме поверх обновлённой истории.
  for(const name of (await readdir(new URL('../migrations/',import.meta.url))).filter(n=>n.endsWith('.sql') && n>'003_products.sql').sort()){
    await migrate(tx,name);
  }
  assert.deepEqual(await one(tx,'SELECT alt_phone,entrance,unit,intercom,access_instructions,paid_entry FROM orders WHERE id=1'),
    {alt_phone:'',entrance:'',unit:'',intercom:'',access_instructions:'',paid_entry:false});
  assert.deepEqual(await one(tx,'SELECT latitude,longitude FROM orders WHERE id=1'),{latitude:null,longitude:null});
  const actor = { id:1,team_id:1 };
  const special = await createProduct(tx,actor,{name:'Другая тестовая вода', water_price:37001});
  assert.equal(special.id,2);
  const details = { customer_id:1,date:'2026-01-11',window_start:500,window_end:620,category:'retail',
    payment_method:'cash',company:'',new_shells:1,floor:1,lift:true,checkpoint:false,address_verified:true,note:'' };
  const items = [{ product_id:1,water:3,water_price:21999 },{ product_id:2,water:2 }];
  const mixed = await createOrder(tx,actor,{...details,items},{shellPrice:25000});
  assert.equal(Number(mixed.total),164999);
  const summary = await one(tx,'SELECT water,water_price,water_subtotal FROM orders WHERE id=$1',[mixed.id]);
  assert.deepEqual([summary.water,summary.water_price,Number(summary.water_subtotal)], [5,21999,139999]);
  const snapshots = id => rows(tx,'SELECT product_id,name,water,water_price FROM order_items WHERE order_id=$1 ORDER BY product_id',[id]);
  assert.deepEqual(await snapshots(mixed.id), [
    {product_id:1,name:'Вода 19 л',water:3,water_price:21999},
    {product_id:2,name:'Другая тестовая вода',water:2,water_price:37001},
  ]);
  await assert.rejects(orderLines(tx,{items:[items[0],items[0]]},actor.team_id), error => error.status === 400);
  await assert.rejects(orderLines(tx,{items:[{product_id:500,water:1}]},actor.team_id), error => error.status === 400);
  await editProduct(tx,actor,2,{name:'Новое название',water_price:49999,active:false});
  assert.deepEqual((await catalog(tx,{activeOnly:true,teamId:actor.team_id})).map(p => p.id),[1]);
  await assert.rejects(orderLines(tx,{items:[items[1]]},actor.team_id), error => error.status === 409);
  const legacy = await createOrder(tx,actor,{...details,water:2,water_price:12503},{shellPrice:25000});
  assert.equal(Number(legacy.total),50006);
  assert.equal((await snapshots(legacy.id))[0].water_price,12503);

  await tx.query("UPDATE orders SET status='failed',trip_id=1 WHERE id=$1",[mixed.id]);
  const failed = await one(tx,'SELECT * FROM orders WHERE id=$1',[mixed.id]);
  const copy = await rescheduleFailed(tx,actor,failed,{date:'2026-01-12',window_start:700,window_end:900});
  assert.deepEqual(await snapshots(copy.id),await snapshots(mixed.id));
  assert.equal((await snapshots(copy.id))[1].name,'Другая тестовая вода');
  assert.equal(Number((await one(tx,'SELECT total FROM orders WHERE id=$1',[copy.id])).total),164999);
});
