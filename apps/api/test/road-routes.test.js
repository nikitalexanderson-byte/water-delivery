import assert from 'node:assert/strict';
import {setTimeout as wait} from 'node:timers/promises';
import test from 'node:test';
import {createRoadRouter} from '../src/road-routes.js';

const settings={enabled:true,url:'http://osrm.test/route/v1/driving/',timeoutMs:5000,minIntervalMs:1000,snapMeters:250};
const emptyBase={lat:null,lon:null};
const base={lat:10,lon:15};
const stops=n=>Array.from({length:n},(_,i)=>({id:String(i+1),lat:10,lon:20+i/100}));
test('Планировщик синхронно читает дорожные минуты только в известном направлении и до истечения срока',async()=>{
  let now=1000,calls=0;
  const route=createRoadRouter(settings,{now:()=>now,fetchImpl:async url=>{calls++;return Response.json(mockRoute(url));}});
  const [a,b]=stops(2);
  const order=stop=>({latitude:stop.lat,longitude:stop.lon});
  const map=route.planningMap(base,{legMinutes:19,estimatedRoadFactor:1.4,estimatedSpeedKmh:28});
  const initial=map.travelMinutes(order(a),order(b));
  assert.ok(initial>3 && initial<4);
  assert.equal(map.travelMinutes({},order(b)),19);
  assert.ok(map.travelMinutes(null,order(a))>initial);
  await route([a,b],emptyBase);
  assert.equal(map.travelMinutes(order(a),order(b)),61.5/60);
  assert.equal(map.travelMinutes(order(b),order(a)),initial);
  now+=30*60_000;
  assert.equal(map.travelMinutes(order(a),order(b)),initial);
  assert.equal(calls,1);
});
function mockRoute(url){
  const coordinates=decodeURIComponent(url.pathname.split('/').at(-1)).split(';').map(p=>p.split(',').map(Number));
  const legs=coordinates.slice(1).map(()=>({duration:61.5,distance:423}));
  return {code:'Ok',waypoints:coordinates.map(location=>({location})),routes:[{duration:61.5*legs.length,distance:423*legs.length,
    legs,geometry:{type:'LineString',coordinates}}]};
}

test('Длинный рейс склеивается с одной общей точкой, кэш переиспользует геометрию между разными id',async()=>{
  let now=1000;
  const starts=[],chunks=[];
  const route=createRoadRouter(settings,{now:()=>now,sleep:async(ms)=>{now+=ms;},fetchImpl:async(url,options)=>{
    starts.push(now);assert.ok(options.headers['User-Agent'].includes('Farvater'));
    assert.equal(url.origin,'http://osrm.test');
    const body=mockRoute(url);
    assert.equal(url.searchParams.get('continue_straight'),'false');
    assert.equal(url.searchParams.get('overview'),'full');
    assert.equal(url.searchParams.get('radiuses').split(';').length,body.waypoints.length);
    chunks.push(body.waypoints.map(p=>p.location));
    return Response.json(body);
  }});
  const points=stops(49);
  const renamed=points.map(p=>({...p,id:'other-'+p.id}));
  const [first,second]=await Promise.all([route(points,base),route(renamed,base)]);
  assert.equal(first.status,'ready');assert.equal(first.has_base,true);
  assert.deepEqual(starts,[1000,2000,3000]);assert.deepEqual(chunks.map(c=>c.length),[25,25,3]);
  assert.deepEqual(chunks[0].at(-1),chunks[1][0]);
  assert.deepEqual(first.geometry.coordinates.length,51);
  assert.equal(first.distance_m,50*423);assert.equal(first.duration_s,50*61.5);
  assert.equal(first.legs.length,50);
  assert.deepEqual(first.legs[0],{from_id:'base',to_id:'1',distance_m:423,duration_s:61.5});
  assert.equal(first.legs.at(-1).to_id,'base');assert.equal(second.legs[0].to_id,'other-1');
  assert.deepEqual(await route(points,base),first);assert.equal(chunks.length,3);
  const noBase=await route(points.slice(0,2),emptyBase);
  assert.equal(noBase.has_base,false);
  assert.deepEqual(noBase.legs,[{from_id:'1',to_id:'2',distance_m:423,duration_s:61.5}]);
});

test('Последние метры до сохранённой точки выделены отдельно от дороги и её времени',async()=>{
  const route=createRoadRouter(settings,{fetchImpl:async url=>{
    const data=mockRoute(url);
    data.waypoints[1].location=[20.0004,10];
    data.routes[0].geometry.coordinates[1]=data.waypoints[1].location;
    return Response.json(data);
  }});
  const result=await route(stops(1),base);
  assert.equal(result.status,'ready');
  assert.deepEqual(result.approaches,[[[20.0004,10],[20,10]]]);
  assert.equal(result.distance_m,846);
  assert.equal(result.duration_s,123);
});

test('Неполные координаты, пропущенная геометрия, неудачная и слишком далёкая привязка не создают дорожный путь',async()=>{
  const blocked=()=>assert.fail('network');
  const local=createRoadRouter(settings,{fetchImpl:blocked});
  assert.equal((await local(stops(1),emptyBase)).status,'missing_points');
  assert.equal((await local([stops(1)[0],{id:'2',lat:null,lon:30}],base)).status,'missing_points');
  assert.equal((await createRoadRouter({...settings,enabled:false},{fetchImpl:blocked})(stops(2),base)).status,'disabled');
  const far=createRoadRouter(settings,{fetchImpl:async(url)=>{
    const data=mockRoute(url);data.waypoints[1].location=[0,0];return Response.json(data);
  }});
  const invalid=await far(stops(2),base);
  assert.equal(invalid.status,'unavailable');assert.match(invalid.message,/далеко/);assert.equal(invalid.geometry,undefined);
  for(const bad of [Response.json({code:'NoSegment'},{status:400}),Response.json({code:'Ok',routes:[]})]){
    const route=createRoadRouter(settings,{fetchImpl:async()=>bad});
    assert.equal((await route(stops(2),base)).status,'unavailable');
  }
});

test('Пауза после 429 и таймаут прекращают повторный трафик, успешный запрос возможен после восстановления',async()=>{
  let now=0,calls=0;
  const route=createRoadRouter(settings,{now:()=>now,fetchImpl:async url=>{
    calls++;
    return calls===1?new Response('',{status:429,headers:{'retry-after':'5'}}):Response.json(mockRoute(url));
  }});
  assert.equal((await route(stops(2),base)).status,'unavailable');
  now=2000;assert.equal((await route(stops(3),base)).status,'unavailable');assert.equal(calls,1);
  now=6000;assert.equal((await route(stops(3),base)).status,'ready');assert.equal(calls,2);
  let slowCalls=0;
  const timeout=createRoadRouter({...settings,timeoutMs:10},{fetchImpl:async(_url,{signal})=>{
    slowCalls++;return wait(100,null,{signal});
  }});
  assert.equal((await timeout(stops(2),base)).status,'unavailable');
  assert.equal((await timeout(stops(2),base)).status,'unavailable');assert.equal(slowCalls,1);
});
