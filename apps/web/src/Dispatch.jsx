import React, { useState } from 'react';
import {Empty, Icon} from './ui';
import {minuteText, shiftStates, tripStates} from './api';

function PendingOrder({order,shifts,onAssign,onOpen,canPlan,working}) {
  const [shiftId,setShiftId]=useState('');
  const eligible=shifts.filter(s=>s.status==='confirmed'||s.status==='active');
  return <div className="queue-row"><div><button className="link-button" onClick={()=>onOpen(order.id)}>№ {order.id} · {order.name}</button>
    <small>{order.address} · {minuteText(order.window_start)}–{minuteText(order.window_end)} · {order.water} бут.</small>
    {order.reason && <small className="reason">{order.reason}</small>}
    {!order.address_verified && !order.reason && <small className="reason">Адрес ожидает подтверждения</small>}
  </div>{canPlan&&eligible.length>0&&<form className="actions" onSubmit={e=>{e.preventDefault();onAssign(order.id,Number(shiftId));}}>
    <label><span className="sr-only">{'Смена для заказа №'+order.id}</span><select value={shiftId} onChange={e=>setShiftId(e.target.value)} required><option value="">Выбрать смену</option>{eligible.map(s=><option value={s.id} key={s.id}>{s.driver_name}</option>)}</select></label>
    <button type="submit" disabled={!shiftId||working}>Назначить</button>
  </form>}</div>;
}

export function Dispatch({day,date,config,canPlan,send,refresh,onOpen}) {
  const [selectedId,select]=useState(null);
  const [message,setMessage]=useState('');
  const [error,setError]=useState('');
  const [busy,setBusy]=useState(false);
  const {orders,shifts,trips}=day;
  const queue=orders.filter(o=>o.status==='pending');
  const shift=shifts.find(s=>s.id===selectedId)||shifts[0];
  const shiftTrips=trips.filter(t=>t.shift_id===shift?.id).sort((a,b)=>a.number-b.number);
  async function plan(orderId,shiftId) {
    setError('');setMessage('');setBusy(true);
    try {
      const result=await send('/plan',{date,...(orderId?{order_id:orderId,shift_id:shiftId}:{})});
      const left=result.unassigned||[];
      const message='Назначено заказов: '+result.assigned+'. Осталось после подбора: '+left.length+'.';
      setMessage(message+(left.length===1?' '+left[0].reason:''));
      refresh();
    }catch(err){setError(err.message);refresh();}finally{setBusy(false);}
  }
  const base=config.base_address||'Производство в Сальково';
  return <>{error&&<p className="error" role="alert">{error}</p>}{message&&<p role="status" className="success">{message}</p>}
    <div className="dispatch"><section className="panel"><div className="panel-head"><h2>Смены <span>{shifts.length}</span></h2></div>
    <div className="shift-list">{shifts.map(s=><button className="shift" aria-pressed={s.id===shift?.id} key={s.id} onClick={()=>select(s.id)}>
      <strong>{s.driver_name}</strong><small>{s.vehicle_name} · {s.capacity_kg} кг</small><small>{minuteText(s.start_min)}–{minuteText(s.end_min)}{s.has_loader?' · с грузчиком':''}</small>
      <span className={'pill '+(s.status==='pending'?'wait':'good')}>{shiftStates[s.status]}</span>
    </button>)}{!shifts.length&&<Empty title="Смен на эту дату пока нет"/>}</div></section>
    <section className="panel"><div className="panel-head"><h2>{shift?'Рейсы · '+shift.driver_name:'Рейсы'}</h2><span className="sub">Расчёт по тестовой модели</span></div>
      {shiftTrips.length?<div className="trip-list">{shiftTrips.map(t=>{
        const visits=orders.filter(o=>o.trip_id===t.id&&o.status!=='cancelled');
        const stops=visits.filter(o=>o.origin!=='on_site').sort((a,b)=>a.position-b.position);
        const extraSales=visits.filter(o=>o.origin==='on_site');
        return <article className="trip" key={t.id}><div className="row"><h3>Рейс {t.number}</h3><span className={'pill '+(t.status==='returned'?'good':'')}>{tripStates[t.status]}</span></div>
        <small>{stops.length} точек · {t.planned_water} бут. по плану{t.status==='active'?' · на борту '+t.water_left+' бут.':''}</small>
        {t.stock_items?.length>0&&<details><summary>Загрузка по брендам</summary><dl className="detail-list">{t.stock_items.map(item=><React.Fragment key={item.product_id}><dt>{item.name}</dt><dd>План {item.planned_water} бут.{t.status!=='planned'?' · остаток '+item.water_left+' бут.':''}</dd></React.Fragment>)}</dl></details>}
        <ol className="track"><li><strong>{base}</strong><small>{t.actual_start!=null?'Выезд '+minuteText(t.actual_start):'Загрузка и выезд'}</small></li>
        {stops.map((o,i)=><li key={o.id}><button className="link-button" onClick={()=>onOpen(o.id)}>{i+1}. {o.address}</button><small>{o.name} · ETA {minuteText(o.eta)} · {o.water} бут.{o.status==='delivered'?' · доставлено':o.status==='failed'?' · срыв доставки':''}</small>
        {extraSales.filter(s=>s.source_order_id===o.id).map(s=><div key={s.id}><button className="link-button" onClick={()=>onOpen(s.id)}>Продажа на месте №{s.id} · {s.water} бут.</button></div>)}</li>)}
        <li><strong>Возврат на базу</strong><small>{t.actual_return!=null?minuteText(t.actual_return):base}</small></li></ol></article>;
      })}</div>:<Empty title="Рейсы ещё не сформированы" detail="После распределения здесь появятся остановки и время прибытия."/>}
    </section></div>
    <section className="panel queue-panel"><div className="panel-head"><h2>Очередь распределения <span>{queue.length}</span></h2>{canPlan&&<button className="primary" disabled={!queue.length||busy} onClick={()=>plan()}><Icon name="routes"/>{busy?'Идёт подбор…':'Распределить заказы'}</button>}</div>
    {queue.length?<div className="queue">{queue.map(o=><PendingOrder key={o.id} order={o} shifts={shifts} onAssign={plan} onOpen={onOpen} canPlan={canPlan} working={busy}/>)}</div>:<Empty title="Все заказы обработаны"/>}
    </section></>;
}
