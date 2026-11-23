import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import test from 'node:test';
import { createPlaceSearch } from '../src/places.js';

const settings = { enabled:true, url:'http://photon.test/api/', minIntervalMs:1000, timeoutMs:5000 };
const feature = (coordinates, properties) => ({geometry:{type:'Point',coordinates},properties});
const body = {features:[feature([37.62,55.75],{city:'Москва',street:'Учебная улица',housenumber:'19',country:'Россия'})]};
const checkError = status => error => error.status === status;

test('Поиск приводит GeoJSON к lat/lon, пропускает неполные точки, сохраняет кэш и объединяет одновременные запросы',async()=>{
  let calls=0,clock=1000;
  const search=createPlaceSearch(settings,{now:()=>clock,fetchImpl:async(url,options)=>{
    calls++;
    assert.deepEqual([...url.searchParams.keys()],['q','limit']);
    assert.equal(url.origin,'http://photon.test');
    assert.equal(url.searchParams.get('q'),'Учебная улица');
    assert.ok(options.signal);
    return Response.json({features:[feature([250,200],{}), null, feature([0,0],{}),...body.features,...body.features]});
  }});
  const [first,joined]=await Promise.all([search('Учебная улица'),search('учебная   УЛИЦА')]);
  const expected=[{label:'Москва, Учебная улица 19, Россия',lat:55.75,lon:37.62}];
  assert.deepEqual(first,expected);
  assert.deepEqual(joined,expected);
  assert.deepEqual(await search('учебная улица'),expected);
  assert.equal(calls,1);
  await assert.rejects(search('Другой адрес'),e=>e.status===429 && e.retryAfter===1);
  clock+=31*60_000;
  assert.deepEqual(await search('Учебная улица'),expected);
  assert.equal(calls,2);
});

test('Отключение, ошибки, таймаут и ограничение Photon дают понятный ответ без повторного сетевого запроса',async()=>{
  const disabled=createPlaceSearch({...settings,enabled:false},{fetchImpl:()=>assert.fail('network')});
  await assert.rejects(disabled('Улица'),checkError(503));
  const failure=createPlaceSearch(settings,{fetchImpl:async()=>Response.json({}, {status:500})});
  await assert.rejects(failure('Улица'),checkError(503));
  const malformed=createPlaceSearch(settings,{fetchImpl:async()=>Response.json({})});
  await assert.rejects(malformed('Улица'),checkError(503));
  const timeout=createPlaceSearch({...settings,timeoutMs:15},{fetchImpl:async(_url,{signal})=>delay(100,null,{signal})});
  await assert.rejects(timeout('Улица'),checkError(504));
  let clock=1000, calls=0;
  const limited=createPlaceSearch(settings,{now:()=>clock,fetchImpl:async()=>{
    calls++;
    return new Response('',{status:429,headers:{'retry-after':'12'}});
  }});
  await assert.rejects(limited('Первый'),e=>e.status===429 && e.retryAfter===12);
  clock+=2000;
  await assert.rejects(limited('Второй'),e=>e.status===429 && e.retryAfter===10);
  assert.equal(calls,1);
});
