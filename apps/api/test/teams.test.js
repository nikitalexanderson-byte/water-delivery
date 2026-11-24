import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {once} from 'node:events';
import {test} from 'node:test';
import {createApp} from '../src/app.js';
import {calendar,configuration} from '../src/config.js';
import {database} from '../src/db.js';
import {passwordHash} from '../src/auth.js';
import {exportOne} from '../src/sheets.js';

test('три роли, одноразовые приглашения и изолированный журнал работы команды',async t=>{
  const db=await database({memory:true});
  t.after(()=>db.close());
  const config={...configuration(),timezone:'Europe/Moscow',registrationEnabled:true,address:'База основной команды',lat:55.44,lon:37.52,
    sheets:{enabled:true,teamId:2}};
  const date=calendar(config).today;
  const server=createApp({db,config,clock:()=>new Date(date+'T07:00:00+03:00')}).listen(0,'127.0.0.1');
  await once(server,'listening');t.after(()=>new Promise(resolve=>server.close(resolve)));
  const base='http://127.0.0.1:'+server.address().port+'/api';
  function request(path,{method='GET',token,body}={}){
    return fetch(base+path,{method,headers:{'Idempotency-Key':randomUUID(),...(token?{Authorization:'Bearer '+token}:{}),
      ...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});
  }
  async function ok(path,options){
    const response=await request(path,options);const data=await response.json();
    assert.ok(response.ok,JSON.stringify(data));return data;
  }
  const post=(path,token,body)=>ok(path,{method:'POST',token,body});
  const password='team-fixture-password';
  const fields=name=>({name,email:name+'@example.test',password});
  const hash=await passwordHash(password);
  await db.transaction(async tx=>{
    await tx.query("INSERT INTO teams(name) VALUES ('Альфа'),('Бета')");
    await tx.query(`INSERT INTO accounts(email,name,role,password_hash,team_id) VALUES
      ('alpha@example.test','alpha','manager',$1,2),('beta@example.test','beta','manager',$1,3),
      ('legacy@example.test','legacy','driver',$1,NULL)`,[hash]);
  });
  const a=await post('/login',null,fields('alpha')),b=await post('/login',null,fields('beta'));
  const legacy=await post('/login',null,fields('legacy'));
  assert.equal(legacy.user.team_id,null);
  assert.equal((await request('/day?date=2026-11-23',{token:legacy.token})).status,403);
  assert.equal((await request('/teams/create',{method:'POST',token:legacy.token,body:{name:'Запрещённая команда'}})).status,403);
  assert.equal((await request('/team/invitations',{method:'POST',token:a.token,body:{role:'manager'}})).status,400);
  const alpha=a.user;
  assert.equal(alpha.role,'manager');
  assert.equal((await ok('/me',{token:a.token})).team_name,'Альфа');
  const invite=await post('/team/invitations',a.token,{role:'driver'});
  const reg=(name,role,code)=>request('/register',{method:'POST',body:{...fields(name),role,code}});
  for(const role of ['manager','administrator','dispatcher']) assert.equal((await reg('invalid',role,invite.code)).status,400);
  assert.equal((await reg('driver','operator',invite.code)).status,409);
  assert.equal((await reg('driver','driver',undefined)).status,400);
  const driver=await post('/register',null,{...fields('driver'),role:'driver',code:' '+invite.code.toUpperCase()+' '});
  const joined=driver;
  assert.equal(joined.user.team_id,alpha.team_id);
  assert.equal(joined.user.role,'driver');
  assert.equal((await reg('outsider','driver',invite.code)).status,409);
  assert.equal((await request('/login',{method:'POST',body:fields('outsider')})).status,401);
  assert.equal((await request('/teams/join',{method:'POST',token:b.token,body:{code:invite.code}})).status,409);
  assert.equal((await request('/team/invitations',{method:'POST',token:driver.token,body:{role:'driver'}})).status,403);
  const operatorInvite=await post('/team/invitations',a.token,{role:'operator'});
  const operator=await post('/register',null,{...fields('operator'),role:'operator',code:operatorInvite.code});
  assert.equal(operator.user.role,'operator');
  const legacyInvite=await post('/team/invitations',b.token,{role:'driver'});
  assert.equal((await post('/teams/join',legacy.token,{code:legacyInvite.code})).user.team_id,b.user.team_id);
  assert.equal((await request('/accounts',{method:'POST',token:a.token,body:{...fields('invalid'),role:'manager'}})).status,400);
  assert.equal((await request('/team/activity',{token:operator.token})).status,403);
  assert.equal((await request('/team/activity',{token:driver.token})).status,403);
  assert.equal((await request('/reports.csv?date='+date,{token:operator.token})).status,403);
  const teamA=await ok('/team',{token:a.token}),teamB=await ok('/team',{token:b.token});
  assert.deepEqual(teamA.members.map(x=>x.name),['alpha','driver','operator']);
  assert.deepEqual(teamB.members.map(x=>x.name),['beta','legacy']);
  await ok('/team/base',{method:'PATCH',token:a.token,body:{address:'Подъезд к складу Альфа',lat:55.71,lon:37.6}});
  assert.equal((await ok('/config',{token:a.token})).base_lat,55.71);
  assert.equal((await ok('/config',{token:b.token})).base_lat,null);
  assert.equal((await ok('/config')).base_lat,null);
  const {today}=await ok('/config');
  const product=await post('/products',a.token,{name:'Вода 19 л',water_price:35000});
  await post('/products',b.token,{name:'Вода 19 л',water_price:36000});
  const body={date:today,name:'Учебный клиент Альфы',phone:'+70000000001',address:'Учебный проезд, 7',
    address_verified:true,window_start:480,window_end:1080,water:2,water_price:35000,product_id:product.id,
    category:'retail',payment_method:'cash'};
  const order=await post('/orders',operator.token,body);
  assert.equal((await request('/orders',{method:'POST',token:b.token,body})).status,400);
  for(const [token,count] of [[a.token,1],[b.token,0],[driver.token,0]]){
    const data=await ok('/day?date='+today,{token});
    assert.equal(data.orders.length,count);
  }
  assert.equal((await request('/orders/'+order.id+'/cancel',{method:'POST',token:b.token,body:{version:1}})).status,404);
  assert.equal((await ok('/customers',{token:b.token})).customers.length,0);
  assert.equal((await ok('/resources',{token:b.token})).drivers.length,1);

  const vehicle=await post('/vehicles',a.token,{name:'Учебная машина',capacity_kg:2600,extra_kg:0,length_mm:4200,
    body_height_mm:2200,total_height_mm:2600});
  const shift=await post('/shifts',a.token,{date:today,driver_id:joined.user.id,vehicle_id:vehicle.id,start_min:480,end_min:1080});
  const result=await post('/shifts/'+shift.id+'/confirm',driver.token,{has_loader:true});
  assert.equal(result.loader_changed,true);
  assert.equal((await post('/plan',operator.token,{date:today})).assigned,1);
  const trip=(await ok('/day?date='+today,{token:driver.token})).trips[0];
  await post('/trips/'+trip.id+'/start',driver.token,{actual_start:480,water:2});
  const before=(await ok('/day?date='+today,{token:a.token})).orders[0];
  assert.equal(before.status,'assigned');
  await post('/orders/'+order.id+'/cancel',operator.token,{version:before.version});
  const sale=await post('/trips/'+trip.id+'/sale',driver.token,{product_id:product.id,water:2,water_price:35000,
    new_shells:0,payment_method:'cash',paid:true,empty:2,
    new_customer:{name:'Клиент на месте',phone:'+70000000002',address:'Учебный проспект, 2',category:'retail'}});
  assert.ok(sale.id);
  const {activity}=await ok('/team/activity',{token:a.token});
  assert.deepEqual(activity.map(x=>[x.event,x.order_id,x.actor_role,x.actor_name,x.driver_name]),[
    ['order.on_site',sale.id,'driver','driver',null],['order.cancel',order.id,'operator','operator',null],
    ['order.assigned',order.id,'operator','operator','driver'],['order.created',order.id,'operator','operator',null],
  ]);
  assert.deepEqual((await ok('/team/activity',{token:b.token})).activity,[]);
  await post('/trips/'+trip.id+'/return',driver.token,{actual_return:600});
  const report=await post('/shifts/'+shift.id+'/settle',driver.token,{water:0,empty:2,cash:70000,bank:0,loader_minutes:60});
  assert.equal(report.matched,true);
  assert.equal(report.delivered_stops,1);
  assert.equal(Number(report.earnings),27000);
  assert.equal((await ok('/day?date='+today,{token:a.token})).reports[0].export_status,'pending');
  const writes=[];
  assert.equal(await exportOne(db,async row=>writes.push(row)),true);
  assert.equal(await exportOne(db,async row=>writes.push(row)),false);
  assert.equal(writes[0][19],270);
  assert.equal(writes[0][20],1);
  assert.equal((await ok('/day?date='+today,{token:a.token})).reports[0].export_status,'sent');
  assert.deepEqual((await ok('/day?date='+today,{token:b.token})).reports,[]);
});
