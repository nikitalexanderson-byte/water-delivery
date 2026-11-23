import React,{useCallback,useEffect,useMemo,useRef,useState} from 'react';
import {Icon,Empty} from './ui';
import {minuteText} from './api';
import exampleTrips from '../../../packages/route-map/static/route-map/example.json';
import './route-atlas.css';

const palette=['#16766c','#3865ba','#a55423','#7754a9','#926719','#337f99'];
const number=new Intl.NumberFormat('ru-RU');
const locationTime=new Intl.DateTimeFormat('ru-RU',{hour:'2-digit',minute:'2-digit',second:'2-digit'});
const validPoint=p=>p && Number.isFinite(p.lat)&&Math.abs(p.lat)<=90&&Number.isFinite(p.lon)&&Math.abs(p.lon)<=180;
function routeLinks(trip,base){
  if(!trip.stops.length||trip.stops.some(s=>!validPoint(s)))return [];
  const waypoints=validPoint(base)?[base,...trip.stops,base]:trip.stops;
  if(waypoints.length===1){
    const p=waypoints[0];
    return [{url:'https://yandex.ru/maps/?'+new URLSearchParams({pt:p.lon+','+p.lat,z:'16'}),label:'Точка в Яндекс Картах'}];
  }
  const links=[];
  for(let i=0;i<waypoints.length-1;i+=9){
    const path=waypoints.slice(i,i+10).map(p=>p.lat+','+p.lon).join('~');
    links.push({url:'https://yandex.ru/maps/?'+new URLSearchParams({rtext:path,rtt:'auto'}),
      label:waypoints.length<=10?'Открыть в Яндекс Картах':'Яндекс Карты · участок '+(links.length+1)});
  }
  return links;
}

function MapFrame({payload,select}){
  const frame=useRef(null);
  const [loaded,setLoaded]=useState(false);
  useEffect(()=>{
    if(loaded)frame.current?.contentWindow?.FarvaterMap?.render(payload);
  },[payload,loaded]);
  useEffect(()=>{
    function onMessage(event){
      if(event.origin!==window.location.origin||event.source!==frame.current?.contentWindow||event.data?.type!=='farvater:stop')return;
      select(String(event.data.tripId),String(event.data.id));
    }
    window.addEventListener('message',onMessage);
    return ()=>window.removeEventListener('message',onMessage);
  },[select]);
  return <iframe className="atlas-frame" ref={frame} title="Карта с остановками рейсов" src="/route-map/index.html" onLoad={()=>setLoaded(true)}/>;
}

function liveRoutes(day){
  const shifts=new Map(day.shifts.map(s=>[s.id,s]));
  const stops=new Map();
  for(const order of day.orders){
    if(!order.trip_id||order.origin==='on_site'||order.status==='cancelled')continue;
    const point={id:String(order.id),position:order.position,address:order.address,name:order.name,phone:order.phone,
      water:order.water,eta:order.eta,lat:order.latitude,lon:order.longitude};
    if(!stops.has(order.trip_id))stops.set(order.trip_id,[]);
    stops.get(order.trip_id).push(point);
  }
  return day.trips.map((trip,index)=>{
    const crew=shifts.get(trip.shift_id);
    return {id:String(trip.id),label:'Рейс '+trip.number+' · '+(crew?.driver_name||'Смена '+trip.shift_id),
      crew:crew?.vehicle_name||'',capacity:crew?.capacity_kg,colorIndex:index%palette.length,
      stops:(stops.get(trip.id)??[]).sort((a,b)=>a.position-b.position)};
  });
}

export function RouteAtlas({day,config,onOpen,demo,setDemo}){
  const [chosen,setChosen]=useState(null);
  const [point,setPoint]=useState(null);
  const [focusRequest,setFocusRequest]=useState(0);
  const [location,setLocation]=useState(null);
  const [locationRequest,setLocationRequest]=useState(0);
  const [locating,setLocating]=useState(false);
  const [locationError,setLocationError]=useState('');
  const [locatedAt,setLocatedAt]=useState(null);
  const [only,setOnly]=useState(false);
  const [listShown,setListShown]=useState(true);
  const [theme,setTheme]=useState(document.documentElement.dataset.theme||'light');
  useEffect(()=>{
    const observer=new MutationObserver(()=>setTheme(document.documentElement.dataset.theme||'light'));
    observer.observe(document.documentElement,{attributes:true,attributeFilter:['data-theme']});
    return ()=>observer.disconnect();
  },[]);
  const actual=useMemo(()=>liveRoutes(day),[day]);
  const trips=demo?exampleTrips:actual;
  const active=trips.find(t=>t.id===chosen)??trips[0];
  const selected=active?.stops.find(s=>s.id===point);
  const shown=useMemo(()=>only&&active?[active]:trips,[only,active,trips]);
  const base=useMemo(()=>({label:demo?'Учебная база':config.base_address||'Производственная база',
    lat:demo?null:config.base_lat,lon:demo?null:config.base_lon}),[demo,config]);
  const payload=useMemo(()=>({trips:shown,base,activeTripId:active?.id??null,focusedStopId:selected?.id??null,
    focusRequest,location,locationRequest,theme,tilesEnabled:config.map_tiles_enabled===true}),
    [shown,base,active,selected,focusRequest,location,locationRequest,theme,config.map_tiles_enabled]);
  const choosePoint=useCallback((trip,id)=>{
    if(!trips.find(t=>t.id===trip)?.stops.some(s=>s.id===id))return;
    setChosen(trip);setPoint(id);setFocusRequest(n=>n+1);
  },[trips]);
  function changeDemo(){setDemo(!demo);setChosen(null);setPoint(null);setOnly(false);setListShown(true);}
  function locate(){
    if(!window.isSecureContext){setLocationError('Для геолокации откройте ФАРВАТЕР через HTTPS или на localhost.');return;}
    if(!navigator.geolocation){setLocationError('Этот браузер не поддерживает геолокацию.');return;}
    setLocationError('');setLocating(true);
    navigator.geolocation.getCurrentPosition(position=>{
      const {latitude:lat,longitude:lon,accuracy}=position.coords;
      setLocation({lat,lon,accuracy});setLocatedAt(position.timestamp);
      setLocationRequest(n=>n+1);setLocating(false);
    },error=>{
      const messages={1:'Доступ к геолокации закрыт. Разрешите его в настройках сайта и повторите.',
        2:'Устройству не удалось определить местоположение. Проверьте службу геолокации и повторите.',
        3:'Устройство не ответило вовремя. Попробуйте определить местоположение ещё раз.'};
      setLocationError(messages[error.code]||'Не удалось определить местоположение. Попробуйте ещё раз.');
      setLocating(false);
    },{enableHighAccuracy:true,timeout:12000,maximumAge:0});
  }
  const stops=shown.flatMap(t=>t.stops);
  const water=stops.reduce((total,s)=>total+s.water,0);
  const tripWater=active?.stops.reduce((sum,s)=>sum+s.water,0)??0;
  const links=active?routeLinks(active,base):[];
  return <section className="atlas" aria-label="План рейсов на карте">
    <header className="atlas-summary">
      <div className="atlas-stats">{[['Рейсов',shown.length],['Точек',stops.length],['Вода',number.format(water)+' бут.'],['Вес воды',number.format(water*20)+' кг']].map(([label,value],i)=>
        <div key={label}><span>{label}</span><strong className={i>=2?'measure':undefined}>{value}</strong></div>)}</div>
      <button className="atlas-demo" onClick={changeDemo}>{demo?'Вернуться к рабочим рейсам':'Учебный пример'}</button>
    </header>
    {demo&&<p className="atlas-note" role="status">Учебный пример · девять районов Москвы. Для работы с заказами вернитесь к рабочим рейсам.</p>}
      <div className="atlas-control">
        {active&&<><label>Выбранный рейс<select value={active.id} onChange={e=>{setChosen(e.target.value);setPoint(null);}}>
          {trips.map(t=><option key={t.id} value={t.id}>{t.label}</option>)}</select></label>
          <button aria-pressed={only} onClick={()=>setOnly(v=>!v)}>{only?'Показать все рейсы':'Только этот рейс'}</button></>}
        <button disabled={locating} onClick={locate}><Icon name="pin"/>Моё местоположение</button>
        {active&&<button aria-expanded={listShown} className="atlas-list-toggle" onClick={()=>setListShown(v=>!v)}>{listShown?'Скрыть список':'Показать список'}</button>}
      </div>
      <div className="atlas-location" role="status" aria-live="polite">
        {locating?'Определяем местоположение…':locationError}
        {!locating&&location&&<span>{locationError?' Последняя отметка':'Местоположение определено'} в {locationTime.format(locatedAt)} · точность <b className="measure">{number.format(Math.ceil(location.accuracy))} м</b></span>}
      </div>
      {!active&&<Empty title="На этот день рейсов пока нет" detail="Распределите заказы в разделе «Маршруты» или откройте учебный пример."/>}
      <div className={'atlas-work'+(active&&listShown?'':' atlas-wide')}>
        {active&&listShown&&<aside className="atlas-list" aria-label="Остановки выбранного рейса">
          <div className="atlas-trip"><h2>{active.label}</h2><p>{active.crew}</p>
            <strong>{active.stops.length} точ. · <span className="measure">{number.format(tripWater)} бут. · {number.format(tripWater*20)} кг</span></strong></div>
          <ol>{active.stops.map(s=><li key={s.id}>
            <button aria-pressed={selected?.id===s.id} onClick={()=>choosePoint(active.id,s.id)}>
              <span className="atlas-number" style={{backgroundColor:palette[active.colorIndex]}}>{s.position}</span>
              <span><strong>{s.address}</strong><small>{s.name} · <b className="measure">{s.water} бут.</b>{s.eta!=null?' · '+minuteText(s.eta):''}</small></span>
            </button>
            {selected?.id===s.id&&<div className="atlas-stop-actions">{s.phone&&<a href={'tel:'+s.phone.replace(/[^+0-9]/g,'')}>{s.phone}</a>}
              {!demo&&<button onClick={()=>onOpen(Number(s.id))}>Заказ № {s.id}</button>}</div>}
          </li>)}</ol>
          <div className="atlas-external">{links.map(link=><a key={link.url} target="_blank" rel="noopener noreferrer" href={link.url}>{link.label} ↗</a>)}
            <small>{!links.length?'Для маршрута в Яндекс Картах укажите координаты остановок.':
              !validPoint(base)?'В ссылку входят только остановки. Координаты базы не заданы.':'Маршрут начинается и заканчивается на базе.'}</small></div>
        </aside>}
        <MapFrame payload={payload} select={choosePoint}/>
      </div>
  </section>;
}
