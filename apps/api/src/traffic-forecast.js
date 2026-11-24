import {rows,one} from './db.js';
import {calendar} from './config.js';

function coordinate(lat,lon){
  return Number.isFinite(lat)&&Math.abs(lat)<=90&&Number.isFinite(lon)&&Math.abs(lon)<=180
    ?lat+','+lon:null;
}

function departureTime(date,minute,timezone){
  const wall=Date.parse(date+'T00:00:00Z')+minute*60_000;
  const formatter=new Intl.DateTimeFormat('en',{timeZone:timezone,timeZoneName:'longOffset'});
  function offset(time){
    const zone=formatter.formatToParts(time).find(part=>part.type==='timeZoneName').value;
    const match=zone.match(/^GMT([+-])(\d{2}):(\d{2})$/);
    return match?(match[1]==='-'?-1:1)*(Number(match[2])*60+Number(match[3]))*60_000:0;
  }
  return Math.floor((wall-offset(wall-offset(wall)))/1000);
}

async function loadMatrix(points,departure,settings,fetchImpl){
  const blocks=[];
  for(let i=0;i<points.length;i+=10)blocks.push(points.slice(i,i+10));
  const durations=[];
  const controller=new AbortController();
  const signal=AbortSignal.any([controller.signal,AbortSignal.timeout(settings.timeoutMs)]);
  let cursor=0;
  async function worker(){
    while(cursor<blocks.length**2){
      signal.throwIfAborted();
      const index=cursor++;
      const from=Math.floor(index/blocks.length),to=index%blocks.length;
      const origins=blocks[from],destinations=blocks[to];
      const url=new URL('https://api.routing.yandex.net/v2/distancematrix');
      url.search=new URLSearchParams({apikey:settings.apiKey,mode:'driving',
        origins:origins.join('|'),destinations:destinations.join('|'),departure_time:String(departure)});
      if(settings.avoidPoorCondition)url.searchParams.set('avoid_poor_condition','true');
      const response=await fetchImpl(url,{signal,redirect:'error'});
      if(!response.ok)throw Error('Matrix rejected');
      const {rows}=await response.json();
      if(!Array.isArray(rows)||rows.length!==origins.length)throw Error('Invalid matrix');
      for(const [i,row] of rows.entries()){
        if(!Array.isArray(row.elements)||row.elements.length!==destinations.length)throw Error('Invalid matrix row');
        const values=durations[from*10+i]??=new Float64Array(points.length).fill(NaN);
        for(const [j,element] of row.elements.entries()){
          const seconds=element?.duration?.value;
          if(element?.status==='OK'&&Number.isFinite(seconds)&&seconds>=0){
            values[to*10+j]=seconds/60;
          }
        }
      }
    }
  }
  try{
    await Promise.all(Array.from({length:Math.min(4,blocks.length**2)},worker));
    return durations;
  }finally{
    controller.abort();
  }
}

export async function prepareTrafficForecast(db,user,input,config,now,fetchImpl){
  const settings=config.yandexMatrix;
  if(!settings?.apiKey||input.order_id||input.date<=calendar(config,now).today)return null;
  const {base,start,stops}=await db.transaction(async tx=>{
    await tx.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ');
    const scope=[user.team_id,input.date];
    const base=await one(tx,'SELECT base_lat,base_lon FROM teams WHERE id=$1',[user.team_id]);
    const start=await one(tx,`SELECT min(s.start_min) AS minute FROM shifts s JOIN accounts a ON a.id=s.driver_id
      WHERE a.team_id=$1 AND s.date=$2 AND s.status='confirmed'`,scope);
    const stops=await rows(tx,`SELECT o.latitude,o.longitude FROM orders o JOIN customers c ON c.id=o.customer_id
      WHERE c.team_id=$1 AND o.date=$2 AND o.origin='office' AND o.address_verified
      AND o.status IN ('pending','assigned') ORDER BY o.id`,scope);
    return {base,start:start.minute,stops};
  });
  if(!base||start===null)return null;
  const depot=coordinate(base.base_lat,base.base_lon)??(user.team_id===1?coordinate(config.lat,config.lon):null);
  const points=[...new Set([depot,...stops.map(s=>coordinate(s.latitude,s.longitude))].filter(Boolean))];
  if(points.length<2)return null;
  const departure=departureTime(input.date,start,config.timezone);
  try{
    const durations=await loadMatrix(points,departure,settings,fetchImpl);
    return {indices:new Map(points.map((p,i)=>[p,i])),durations,departure};
  }catch{
    // Keep the commercial API key and the provider's response out of logs and client errors.
    return null;
  }
}

export function forecastRouting(forecast,config){
  let forecastLeg=false,estimatedLeg=false;
  const point=order=>order?coordinate(order.latitude,order.longitude):coordinate(config.lat,config.lon);
  const {mapProvider,trafficFactor}=config.routing;
  return {
    settings:{...config,routing:{...config.routing,trafficFactor:1,mapProvider:{travelMinutes(from,to){
      const a=forecast.indices.get(point(from)),b=forecast.indices.get(point(to));
      if(a!==undefined&&a===b)return 0;
      const minutes=forecast.durations[a]?.[b];
      if(Number.isFinite(minutes)){
        forecastLeg=true;
        return minutes;
      }
      estimatedLeg=true;
      return mapProvider.travelMinutes(from,to)*trafficFactor;
    }}}},
    summary:()=>forecastLeg?{traffic_source:estimatedLeg?'mixed':'yandex',traffic_departure_at:new Date(forecast.departure*1000).toISOString()}
      :{traffic_source:'estimate'}
  };
}
