import {readFile} from 'node:fs/promises';
import {setTimeout as wait} from 'node:timers/promises';
import {ensure} from './auth.js';
import {one,rows} from './db.js';
import {routePublished} from './day.js';

const examples=JSON.parse(await readFile(new URL('../../../packages/route-map/static/route-map/example.json',import.meta.url),'utf8'));
const maxWaypoints=25;
const maxEntries=64;
const maxCachedPoints=200000;
const ttl=30*60_000;
const maxCachedLegs=4096;
const unavailable='Сервис дорожных маршрутов временно недоступен.';
const finite=n=>Number.isFinite(n) && n>=0;
const coord=([lon,lat])=>Number.isFinite(lon) && Math.abs(lon)<=180 && Number.isFinite(lat) && Math.abs(lat)<=90;

export function exampleStops(id){
  const trip=examples.find(trip=>trip.id===id);
  ensure(trip,'Учебный рейс не найден',404);
  return trip.stops.map(stop=>({id:stop.id,lat:stop.lat,lon:stop.lon}));
}

export async function tripStops(tx,user,id,config,now){
  const shift=await one(tx,`SELECT s.driver_id,s.date::text AS date,t.base_address,t.base_lat,t.base_lon FROM trips t JOIN shifts s ON s.id=t.shift_id
    JOIN accounts a ON a.id=s.driver_id WHERE t.id=$1 AND ($2::int IS NULL OR s.driver_id=$2)
      AND a.team_id=$3`,[id,user.role==='driver'?user.id:null,user.team_id]);
  ensure(shift,'Рейс не найден',404);
  ensure(user.role!=='driver'||routePublished(shift.date,config,now),'Рейс ещё не опубликован',403);
  const stops=await rows(tx,`SELECT o.id::text AS id,o.latitude AS lat,o.longitude AS lon FROM orders o
    JOIN customers c ON c.id=o.customer_id WHERE o.trip_id=$1 AND o.origin='office' AND o.status<>'cancelled'
      AND c.team_id=$2 ORDER BY o.position,o.id`,[id,user.team_id]);
  return {stops,base:shift.base_address===null?null:{address:shift.base_address,lat:shift.base_lat,lon:shift.base_lon}};
}

class RouteFailure extends Error {}

function distanceMeters(a,b){
  const rad=Math.PI/180;
  const h=Math.sin((a[1]-b[1])*rad/2)**2+Math.cos(a[1]*rad)*Math.cos(b[1]*rad)*Math.sin((a[0]-b[0])*rad/2)**2;
  return 12742000*Math.asin(Math.sqrt(Math.min(1,h)));
}

function readChunk(data,points,snapMeters){
  if(data?.code==='NoRoute'||data?.code==='NoSegment') throw new RouteFailure('Для этих точек не найден автомобильный путь. Проверьте подъезд к дороге.');
  const route=data?.routes?.[0];
  const line=route?.geometry;
  if(data?.code!=='Ok'||line?.type!=='LineString'||!Array.isArray(line.coordinates)||line.coordinates.length<2||
    !line.coordinates.every(p=>Array.isArray(p)&&coord(p))||!finite(route.distance)||!finite(route.duration)||
    !Array.isArray(route.legs)||route.legs.length!==points.length-1||!route.legs.every(leg=>leg && finite(leg.duration)&&finite(leg.distance))||
    !Array.isArray(data.waypoints)||data.waypoints.length!==points.length||
    !data.waypoints.every(p=>Array.isArray(p?.location)&&coord(p.location))){
    throw Error('Invalid provider response');
  }
  if(data.waypoints.some((p,i)=>distanceMeters(points[i],p.location)>snapMeters)){
    throw new RouteFailure('Дорога находится далеко от указанной точки. Уточните место подъезда.');
  }
  return {geometry:line,distance_m:route.distance,duration_s:route.duration,
    legs:route.legs.map(leg=>({duration_s:leg.duration,distance_m:leg.distance}))};
}

// Очередь и кэш общие для всех рейсов одного API-процесса. Ключ — только
// координаты в порядке обхода. Идентификаторы заказов подставляются после чтения.
export function createRoadRouter(settings,{fetchImpl=fetch,now=Date.now,sleep=wait}={}){
  const cache=new Map(),pending=new Map(),legTimes=new Map();
  let tail=Promise.resolve(),queued=0,nextRequest=0,recoverAt=0,cachedPoints=0;
  function forget(key){
    const old=cache.get(key);
    if(old){cachedPoints-=old.points;cache.delete(key);}
  }
  async function request(points){
    const path=points.map(p=>p.join(',')).join(';');
    const url=new URL(path,settings.url);
    url.search=new URLSearchParams({overview:'full',geometries:'geojson',steps:'false',alternatives:'false',generate_hints:'false',
      radiuses:points.map(()=>settings.snapMeters).join(';')}).toString();
    try{
      const response=await fetchImpl(url,{headers:{Accept:'application/json',
        'User-Agent':'Farvater-MVP/0.1 (+https://github.com/nikitalexanderson-byte/water-delivery)'},signal:AbortSignal.timeout(settings.timeoutMs)});
      if(response.status===429){
        const raw=response.headers.get('retry-after');
        const seconds=Number(raw) || ((Date.parse(raw)-now())/1000) || 30;
        recoverAt=now()+Math.min(3600,Math.max(1,seconds))*1000;
        throw new RouteFailure('Сервис ограничил частоту расчётов. Повторите позже.');
      }
      if(!response.ok && response.status!==400)throw Error('Provider unavailable');
      return readChunk(await response.json(),points,settings.snapMeters);
    }catch(error){
      if(error instanceof RouteFailure)throw error;
      recoverAt=now()+30_000;
      throw new RouteFailure(unavailable);
    }
  }
  function enqueue(points){
    if(now()<recoverAt)throw new RouteFailure(unavailable);
    if(queued>=16)throw new RouteFailure('Очередь расчёта занята. Повторите позже.');
    const deadline=now()+20_000;
    queued++;
    const job=tail.then(async()=>{
      if(now()<recoverAt)throw new RouteFailure(unavailable);
      if(Math.max(now(),nextRequest)>deadline)throw new RouteFailure('Расчёт в очереди занял слишком много времени.');
      const delay=nextRequest-now();
      if(delay>0)await sleep(delay);
      nextRequest=now()+settings.minIntervalMs;
      return request(points);
    }).finally(()=>queued--);
    tail=job.catch(()=>{});
    return job;
  }
  async function build(points){
    const geometry={type:'LineString',coordinates:[]};
    const legs=[];
    let distance_m=0,duration_s=0;
    for(let i=0;i<points.length-1;i+=maxWaypoints-1){
      const chunk=await enqueue(points.slice(i,i+maxWaypoints));
      const last=geometry.coordinates.at(-1),first=chunk.geometry.coordinates[0];
      const start=last && last[0]===first[0] && last[1]===first[1]?1:0;
      for(let j=start;j<chunk.geometry.coordinates.length;j++)geometry.coordinates.push(chunk.geometry.coordinates[j]);
      legs.push(...chunk.legs);
      distance_m+=chunk.distance_m;
      duration_s+=chunk.duration_s;
    }
    return {geometry,legs,distance_m,duration_s};
  }
  async function load(points){
    const key=JSON.stringify(points),entry=cache.get(key);
    if(entry && entry.until>now())return entry.result;
    forget(key);
    if(pending.has(key))return pending.get(key);
    const promise=build(points).then(result=>{
      result.legs.forEach((leg,i)=>{
        const key=JSON.stringify([points[i],points[i+1]]);
        legTimes.delete(key);
        if(legTimes.size>=maxCachedLegs)legTimes.delete(legTimes.keys().next().value);
        legTimes.set(key,{minutes:leg.duration_s/60,until:now()+ttl});
      });
      const count=result.geometry.coordinates.length;
      if(count<=maxCachedPoints){
        while(cache.size>=maxEntries || cachedPoints+count>maxCachedPoints)forget(cache.keys().next().value);
        cache.set(key,{result,points:count,until:now()+ttl});
        cachedPoints+=count;
      }
      return result;
    }).finally(()=>pending.delete(key));
    pending.set(key,promise);
    return promise;
  }
  async function route(stops,base){
    const has_base=coord([base.lon,base.lat]);
    if(!settings.enabled)return {status:'disabled',has_base,message:'Дорожная маршрутизация отключена.'};
    if(stops.some(s=>!coord([s.lon,s.lat])))return {status:'missing_points',has_base,message:'Для части остановок не указаны координаты.'};
    if(!stops.length||(!has_base && stops.length<2))return {status:'missing_points',has_base,message:'Недостаточно точек с координатами для автомобильного пути.'};
    const depot={id:'base',lat:base.lat,lon:base.lon};
    const points=has_base?[depot,...stops,depot]:stops;
    try{
      const result=await load(points.map(p=>[p.lon,p.lat]));
      return {status:'ready',has_base,...result,legs:result.legs.map((leg,i)=>({...leg,from_id:String(points[i].id),to_id:String(points[i+1].id)}))};
    }catch(error){
      if(!(error instanceof RouteFailure))throw error;
      return {status:'unavailable',has_base,message:error.message};
    }
  }
  // Используется синхронно внутри транзакции распределения. Время OSRM только
  // для того же направления. При отсутствии замера используем местную оценку.
  route.planningMap=(base,rules)=>{
    const location=order=>order?[order.longitude,order.latitude]:[base.lon,base.lat];
    return {travelMinutes(from,to){
      const a=location(from),b=location(to);
      if(!coord(a)||!coord(b))return rules.legMinutes;
      const key=JSON.stringify([a,b]),entry=legTimes.get(key);
      if(entry && entry.until>now())return entry.minutes;
      if(entry)legTimes.delete(key);
      return distanceMeters(a,b)/1000*rules.estimatedRoadFactor/rules.estimatedSpeedKmh*60;
    }};
  };
  return route;
}
