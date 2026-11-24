import React, {useEffect, useState} from 'react';
import {Field,Dialog} from './ui';
import {toMinutes} from './api';

export function Resources({date,get,send,close,refresh,canEditVehicles}) {
  const [data,setData]=useState(null);
  const [error,setError]=useState('');
  const [busy,setBusy]=useState(false);
  const [mode,setMode]=useState('shift');
  const [driver,setDriver]=useState('');
  const [vehicle,setVehicle]=useState('');
  const [start,setStart]=useState('09:00');
  const [end,setEnd]=useState('18:00');
  const [loader,setLoader]=useState(false);
  const [height,setHeight]=useState('');
  const [extra,setExtra]=useState('');
  const [workDate,setWorkDate]=useState(date);
  useEffect(()=>{
    const controller=new AbortController();
    get('/resources',controller.signal).then(result=>{
      setData(result);setDriver(String(result.drivers[0]?.id||''));selectVehicle(result.vehicles[0]);
    }).catch(err=>{if(err.name!=='AbortError')setError(err.message);});
    return ()=>controller.abort();
  },[get]);
  function selectVehicle(v) {
    setVehicle(String(v?.id||''));setHeight(v?.total_height_mm?String(v.total_height_mm/1000):'');
    setExtra(v?.extra_kg==null?'':String(v.extra_kg));
  }
  async function save(e) {
    e.preventDefault();setError('');
    if(mode==='shift'&&start>=end){setError('Окончание смены должно быть позже начала.');return;}
    setBusy(true);
    try{
      if(mode==='shift')await send('/shifts',{date:workDate,driver_id:Number(driver),vehicle_id:Number(vehicle),start_min:toMinutes(start),end_min:toMinutes(end),has_loader:loader});
      else await send('/vehicles/'+vehicle,{total_height_mm:Math.round(Number(height)*1000),extra_kg:Number(extra)},'PATCH');
      refresh(mode==='shift'?workDate:date,mode==='shift'?'Смена создана. Экспедитор может подтвердить выход.':'Параметры автомобиля обновлены.');
    }catch(err){setError(err.message);}finally{setBusy(false);}
  }
  return <Dialog title="Смены и машины" close={()=>{if(!busy)close();}}><form onSubmit={save}><div className="form-body">
    {error&&<p className="error" role="alert">{error}</p>}
    {data?<fieldset><legend>Параметры работы</legend><div className="form-grid">
      {canEditVehicles&&<Field label="Действие" wide><select value={mode} onChange={e=>{setMode(e.target.value);setError('');}}><option value="shift">Создать смену</option><option value="vehicle">Уточнить параметры машины</option></select></Field>}
      <Field label="Автомобиль" wide><select required value={vehicle} onChange={e=>selectVehicle(data.vehicles.find(v=>v.id===Number(e.target.value)))}>{data.vehicles.map(v=><option key={v.id} value={v.id}>{v.name} · {v.capacity_kg} кг</option>)}</select></Field>
      {mode==='shift'?<><Field label="Экспедитор" wide><select required value={driver} onChange={e=>setDriver(e.target.value)}>{data.drivers.map(d=><option key={d.id} value={d.id}>{d.name}</option>)}</select></Field>
      <Field label="Рабочая дата" wide><input value={workDate} onChange={e=>setWorkDate(e.target.value)} required type="date"/></Field>
      <Field label="Смена с"><input value={start} type="time" onChange={e=>setStart(e.target.value)} required/></Field><Field label="Смена до"><input value={end} type="time" onChange={e=>setEnd(e.target.value)} required/></Field>
      <label className="check wide"><input type="checkbox" checked={loader} onChange={e=>setLoader(e.target.checked)}/>С грузчиком</label></>:<>
      <Field label="Полная высота от земли, м" wide><input type="number" step="0.001" min="0.1" max="10" value={height} onChange={e=>setHeight(e.target.value)} required/></Field>
      <Field label="Дополнительный груз, кг" wide><input type="number" step="1" min="0" value={extra} onChange={e=>setExtra(e.target.value)} required/></Field></>}
    </div></fieldset>:!error&&<p>Загружаем справочники…</p>}</div><footer className="dialog-footer"><button type="button" disabled={busy} onClick={close}>Закрыть</button><button className="primary" disabled={!data||busy}>{mode==='shift'?'Создать смену':'Сохранить параметры'}</button></footer></form></Dialog>;
}
