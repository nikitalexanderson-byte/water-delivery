import React,{useEffect,useRef,useState} from 'react';
import {SearchField} from './ui';

const valid=(lat,lon)=>Number.isFinite(lat)&&Math.abs(lat)<=90&&Number.isFinite(lon)&&Math.abs(lon)<=180;
const display=point=>point.lat.toFixed(6)+', '+point.lon.toFixed(6);

export function AddressMap({config,get,latitude,longitude,save,close,automatic=true,address=''}){
  const [point,setPoint]=useState(()=>latitude!==''&&longitude!==''&&valid(Number(latitude),Number(longitude))?
    {lat:Number(latitude),lon:Number(longitude)}:null);
  const [query,setQuery]=useState(address);
  const [options,setOptions]=useState([]);
  const [status,setStatus]=useState('');
  const [busy,setBusy]=useState(false);
  const [ready,setReady]=useState(false);
  const [jump,setJump]=useState(0);
  const frame=useRef(null);
  const search=useRef(null);
  useEffect(()=>{
    function pick(event){
      if(event.origin!==window.location.origin||event.source!==frame.current?.contentWindow||event.data?.type!=='farvater:pick')return;
      const {lat,lon}=event.data;
      if(valid(lat,lon))setPoint({lat,lon});
    }
    window.addEventListener('message',pick);
    return ()=>{window.removeEventListener('message',pick);search.current?.abort();};
  },[]);
  useEffect(()=>{
    if(ready)frame.current?.contentWindow?.FarvaterMap?.render({picker:true,picked:point,pickRequest:jump,trips:[],
      base:{lat:config.base_lat,lon:config.base_lon,label:config.base_address},
      tilesEnabled:config.map_tiles_enabled,theme:document.documentElement.dataset.theme});
  },[config,ready,point,jump]);
  async function find(){
    const term=query.trim();
    if(term.length<3)return;
    search.current?.abort();
    const controller=new AbortController();
    search.current=controller;setBusy(true);setOptions([]);setStatus('');
    try{
      const {places}=await get('/places?q='+encodeURIComponent(term),controller.signal);
      if(!controller.signal.aborted){
        setOptions(places);
        setStatus(places.length?'Выберите подходящий адрес.':'Совпадений нет. Уточните населённый пункт и улицу или отметьте место на карте.');
      }
    }catch(err){if(!controller.signal.aborted)setStatus(err.message);}
    finally{if(!controller.signal.aborted)setBusy(false);}
  }
  function updateQuery(value){
    search.current?.abort();setBusy(false);setStatus('');setOptions([]);setQuery(value);
  }
  return <div className="address-map">
    {automatic&&config.geocoder_enabled!==false&&<>
      <SearchField label="Населённый пункт, улица и дом" showLabel value={query} maxLength={200} placeholder="Например, Тула, Советская, 1"
        onChange={e=>updateQuery(e.target.value)} onKeyDown={e=>{if(e.key==='Enter'){e.preventDefault();find();}}}/>
      <div className="address-search"><button type="button" onClick={find} disabled={busy||query.trim().length<3}>{busy?'Ищем…':'Найти на карте'}</button>
        <small>Поиск передаёт введённый адрес сервису Photon (OpenStreetMap).</small></div>
      {status&&<p role="status">{status}</p>}
      {options.length>0&&<ul aria-label="Найденные адреса">{options.map((place,i)=><li key={i}>
        <button type="button" onClick={()=>{setPoint(place);setJump(n=>n+1);setOptions([]);setStatus('Проверьте положение отметки.');}}>{place.label}</button>
      </li>)}</ul>}
    </>}
    <iframe title="Выбор точки доставки на карте" ref={frame} src="/route-map/index.html" onLoad={()=>setReady(true)}/>
    <p role="status">{point?'Отметка: '+display(point):'Выберите место доставки на карте.'}</p>
    <div className="actions">
      <button type="button" disabled={!point} className="primary" onClick={()=>save(point)}>Использовать точку</button>
      <button type="button" onClick={close}>Отмена выбора</button>
    </div>
  </div>;
}
