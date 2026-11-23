import React,{useCallback,useEffect,useMemo,useRef,useState} from 'react';

const automaticLimit=10;
const parallelLimit=2;
const cacheLimit=30;
const km=new Intl.NumberFormat('ru-RU',{maximumFractionDigits:1});

function kilometers(meters){
  return meters>0&&meters<100?'менее 0,1 км':km.format(meters/1000)+' км';
}

function drivingTime(seconds){
  const minutes=Math.max(seconds>0?1:0,Math.round(seconds/60));
  const hours=Math.floor(minutes/60),rest=minutes%60;
  if(!hours)return rest+' мин';
  return hours+' ч'+(rest?' '+rest+' мин':'');
}

export function useRoadRoutes({get,visible,active,base,demo}){
  const [entries,setEntries]=useState(()=>new Map());
  const pending=useRef(new Map());
  const targets=useMemo(()=>{
    if(!active)return [];
    const chosen=visible.length>automaticLimit?[active]:[active,...visible.filter(t=>t.id!==active.id)];
    return chosen.map(trip=>{
      const path='/road-routes/'+(demo?'example/':'trip/')+encodeURIComponent(trip.id);
      const key=JSON.stringify([path,base.lat,base.lon,trip.stops.map(s=>[s.id,s.lat,s.lon])]);
      return {id:trip.id,path,key};
    });
  },[visible,active,base,demo]);
  useEffect(()=>{
    const requests=pending.current;
    return ()=>{for(const controller of requests.values())controller.abort();requests.clear();};
  },[]);
  useEffect(()=>{
    const requests=pending.current;
    const wanted=new Set(targets.map(t=>t.key));
    for(const [key,controller] of requests){
      if(!wanted.has(key)){controller.abort();requests.delete(key);}
    }
    async function load(target,controller){
      let result;
      try{result=await get(target.path,controller.signal);}
      catch(error){result={status:'unavailable',message:error.message};}
      if(controller.signal.aborted)return;
      requests.delete(target.key);
      setEntries(previous=>{
        const next=new Map(previous);
        if(next.size>=cacheLimit)next.delete(next.keys().next().value);
        next.set(target.key,result);
        return next;
      });
    }
    for(const target of targets){
      if(requests.size>=parallelLimit)break;
      if(entries.has(target.key)||requests.has(target.key))continue;
      const controller=new AbortController();
      requests.set(target.key,controller);load(target,controller);
    }
  },[get,targets,entries]);
  const roads=useMemo(()=>Object.fromEntries(targets.filter(t=>entries.has(t.key)).map(t=>[t.id,entries.get(t.key)])),[targets,entries]);
  const activeKey=targets[0]?.key;
  const retry=useCallback(()=>setEntries(previous=>{
    const next=new Map(previous);next.delete(activeKey);return next;
  }),[activeKey]);
  return {roads,retry};
}

export function RoadSummary({road,retry}){
  const ready=road?.status==='ready';
  const messages={
    missing_points:'Для расчёта укажите координаты остановок маршрута.',
    disabled:'Расчёт дорожных маршрутов отключён.',
    unavailable:'Не удалось рассчитать маршрут по дорогам.'
  };
  return <section className="atlas-road" aria-label="Дорожный маршрут выбранного рейса">
    <div role="status">
      {ready?<><div className="road-numbers">
        <span>По дорогам <strong className="measure">{kilometers(road.distance_m)}</strong></span>
        <span>В движении <strong className="measure">{drivingTime(road.duration_s)}</strong></span>
      </div>
      <p>{road.has_base?'От базы с возвратом на базу.':'Между остановками.'} Время без учёта пробок, остановок и разгрузки.</p></>:
      <span>{road?(road.message||messages[road.status]||messages.unavailable):'Рассчитываем путь по дорогам…'}</span>}
    </div>
    {road?.status==='unavailable'&&<button type="button" onClick={retry}>Повторить расчёт</button>}
  </section>;
}

export function RoadLeg({leg,from}){
  return <small className="atlas-leg">{from} · <span className="measure">{kilometers(leg.distance_m)} · {drivingTime(leg.duration_s)}</span></small>;
}
