import assert from 'node:assert/strict';
import {once} from 'node:events';
import test from 'node:test';
import {createApp} from '../src/app.js';
import {calendar,configuration} from '../src/config.js';
import {database} from '../src/db.js';
import {seed} from '../src/seed.js';
import {forecastRouting} from '../src/traffic-forecast.js';

test('Вечерний план выбирает порядок точек по направленным временам Яндекса на завтра',async t=>{
  const config={...configuration(),timezone:'Europe/Moscow',lat:55.439039,lon:37.524452,
    yandexMatrix:{apiKey:'test-key',timeoutMs:5000,avoidPoorCondition:true}};
  const password='forecast-test-password';
  const db=await database({memory:true});
  await seed(db,config,password);
  const {today,tomorrow}=calendar(config);
  const points=['55.439039,37.524452','55.45,37.53','55.46,37.54'];
  const seconds=[[0,1200,120],[180,0,1500],[300,240,0]];
  let requests=0;
  const server=createApp({db,config,clock:()=>new Date(today+'T19:30:00+03:00'),
    matrixFetch:async url=>{
      requests++;
      assert.equal(url.origin,'https://api.routing.yandex.net');
      assert.equal(url.searchParams.get('departure_time'),String(Date.parse(tomorrow+'T08:00:00+03:00')/1000));
      assert.equal(url.searchParams.get('avoid_poor_condition'),'true');
      assert.deepEqual(url.searchParams.get('origins').split('|'),points);
      assert.deepEqual(url.searchParams.get('destinations').split('|'),points);
      return Response.json({rows:seconds.map(row=>({elements:row.map(value=>({status:'OK',duration:{value}}))}))});
    }}).listen(0,'127.0.0.1');
  t.after(async()=>{
    await new Promise(resolve=>server.close(resolve));
    await db.close();
  });
  await once(server,'listening');
  const origin='http://127.0.0.1:'+server.address().port+'/api';
  async function call(path,body,token){
    const headers=token?{Authorization:'Bearer '+token}:{};
    const method=body?'POST':'GET';
    if(body)headers['content-type']='application/json';
    const response=await fetch(origin+path,{method,headers,body:body?JSON.stringify(body):undefined});
    const data=await response.json();
    assert.ok(response.ok,JSON.stringify(data));
    return data;
  }
  const {token:operator}=await call('/login',{email:'operator@farvater.test',password});
  const {token:driver}=await call('/login',{email:'driver1@farvater.test',password});
  const tomorrowPath='/day?date='+tomorrow;
  const {shifts:[shift]}=await call(tomorrowPath,null,driver);
  await call('/shifts/'+shift.id+'/confirm',{},driver);
  const deliveries=[];
  for(const [index,latitude,longitude] of [[1,55.45,37.53],[2,55.46,37.54]]){
    deliveries.push(await call('/orders',{date:tomorrow,name:'Тест '+index,phone:'+7000000000'+index,
      address:'Учебная улица, '+index,address_verified:true,latitude,longitude,window_start:480,window_end:1020,
      water:1,water_price:35000,payment_method:'cash',category:'retail'},operator));
  }
  const plan=await call('/plan',{date:tomorrow},operator);
  assert.equal(plan.traffic_source,'yandex');
  assert.equal(plan.assigned,2);
  assert.equal(requests,1);
  const {orders}=await call(tomorrowPath,null,driver);
  const ordered=orders.sort((a,b)=>a.position-b.position);
  assert.deepEqual(ordered.map(o=>o.id),[deliveries[1].id,deliveries[0].id]);
  assert.equal(ordered[0].eta,482);
});

test('Отсутствующий дорожный отрезок использует оценку с отдельным коэффициентом',()=>{
  const forecast={indices:new Map([['1,2',0],['3,4',1]]),durations:[[0,2],[NaN,0]],departure:0};
  const config={lat:1,lon:2,routing:{trafficFactor:2,mapProvider:{travelMinutes:()=>5}}};
  const {settings,summary}=forecastRouting(forecast,config);
  const stop={latitude:3,longitude:4};
  assert.equal(settings.routing.trafficFactor,1);
  assert.equal(settings.routing.mapProvider.travelMinutes(null,stop),2);
  assert.equal(settings.routing.mapProvider.travelMinutes(stop,null),10);
  assert.equal(summary().traffic_source,'mixed');
});
