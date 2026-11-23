import React, { useState } from 'react';
import {Empty, Icon} from './ui';
import {minuteText, shiftStates, tripStates} from './api';

function PendingOrder({order,shifts,onAssign,onOpen,canPlan,working}) {
  const [shiftId,setShiftId]=useState('');
  const eligible=shifts.filter(s=>s.status==='confirmed'||s.status==='active');
  return <div className="queue-row"><div><button className="link-button" onClick={()=>onOpen(order.id)}>№ {order.id} · {order.name}</button>
    <small>{order.address} · {minuteText(order.window_start)}–{minuteText(order.window_end)} · <span className="measure">{order.water} бут.</span></small>
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
  const problems=queue.filter(o=>o.reason||!o.address_verified).length;
  return <>{error&&<p className="error" role="alert">{error}</p>}{message&&<p role="status" className="success">{message}</p>}
    <section className="fleet-selector" aria-label="Выбор смены"><header><h2>Смены <span>{shifts.length}</span></h2><a href="#dispatch-queue">К очереди <Icon name="arrow" size={15}/></a></header>
    <div className="fleet-strip">{shifts.map(s=><button className="crew" aria-pressed={s.id===shift?.id} key={s.id} onClick={()=>select(s.id)}>
      <span className="crew-avatar" aria-hidden="true">{s.driver_name.split(' ').slice(0,2).map(word=>word[0]).join('')}</span>
      <span className="crew-info"><strong>{s.driver_name}</strong><small>{s.vehicle_name} · <span className="measure">{s.capacity_kg} кг</span></small><small>{minuteText(s.start_min)}–{minuteText(s.end_min)} · {shiftStates[s.status]}</small></span>
      {s.id===shift?.id&&<Icon name="check" size={15}/>}
    </button>)}{!shifts.length&&<Empty title="Смен на эту дату пока нет"/>}</div></section>
    <div className="dispatch-grid"><section className="panel route-pane"><div className="route-pane-head"><div><Icon name="routes"/><h2>{shift?'Маршрут · '+shift.driver_name:'Маршрут смены'}</h2></div><small>Рейсов · {shiftTrips.length}{shift?.has_loader?' · с грузчиком':''}</small></div>
      {shiftTrips.length?<div className="trip-list">{shiftTrips.map(t=>{
        const visits=orders.filter(o=>o.trip_id===t.id&&o.status!=='cancelled');
        const stops=visits.filter(o=>o.origin!=='on_site').sort((a,b)=>a.position-b.position);
        const extraSales=visits.filter(o=>o.origin==='on_site');
        return <article className="trip" key={t.id}><div className="trip-head"><div><h3>Рейс {t.number}</h3><small>{stops.length} точек · <span className="measure">{t.planned_water} бут.</span> по плану{t.status==='active'&&<> · на борту <span className="measure">{t.water_left} бут.</span></>}</small></div><span className={'pill '+(t.status==='returned'?'good':'assigned')}>{tripStates[t.status]}</span></div>
        {t.stock_items?.length>0&&<details><summary>Загрузка по брендам</summary><dl className="detail-list">{t.stock_items.map(item=><React.Fragment key={item.product_id}><dt>{item.name}</dt><dd>План <span className="measure">{item.planned_water} бут.</span>{t.status!=='planned'&&<> · остаток <span className="measure">{item.water_left} бут.</span></>}</dd></React.Fragment>)}</dl></details>}
        <ol className="track"><li className="base-stop"><span className="stop-time">{minuteText(t.actual_start)}</span><span className="point-marker"><Icon name="truck" size={15}/></span><div><strong>{base}</strong><small>Загрузка и выезд</small></div></li>
        {stops.map((o,i)=><li key={o.id}><span className="stop-time">{minuteText(o.eta)}</span><span className="point-marker">{i+1}</span><div><button className="link-button" onClick={()=>onOpen(o.id)} aria-label={(i+1)+'. '+o.address}>{o.address}</button>
          <small>{o.name} · <span className="measure">{o.water} бут.</span>{o.status==='delivered'?' · доставлено':o.status==='failed'?' · срыв доставки':''}</small>
          <small>Окно {minuteText(o.window_start)}–{minuteText(o.window_end)}</small>
          {extraSales.filter(s=>s.source_order_id===o.id).map(s=><div key={s.id}><button className="link-button" onClick={()=>onOpen(s.id)}>Продажа на месте №{s.id} · <span className="measure">{s.water} бут.</span></button></div>)}
        </div></li>)}
        <li className="base-stop"><span className="stop-time">{minuteText(t.actual_return)}</span><span className="point-marker"><Icon name="pin" size={15}/></span><div><strong>Возврат на базу</strong><small>{base}</small></div></li></ol>
        </article>;
      })}<p className="model-note"><Icon name="time" size={14}/>Время прибытия рассчитано тестовой моделью.</p></div>:<Empty title="Рейсы ещё не сформированы" detail="После распределения здесь появятся остановки и время прибытия."/>}
    </section>
    <section className="panel queue-panel" id="dispatch-queue"><div className="panel-head"><div><h2>Очередь распределения <span>{queue.length}</span></h2>{problems>0&&<small>Требуют проверки · {problems}</small>}</div></div>
    {canPlan&&<div className="plan-action"><button className="primary" disabled={!queue.length||busy} onClick={()=>plan()}><Icon name="routes"/>{busy?'Идёт подбор…':'Распределить заказы'}</button></div>}
    {queue.length?<div className="queue">{queue.map(o=><PendingOrder key={o.id} order={o} shifts={shifts} onAssign={plan} onOpen={onOpen} canPlan={canPlan} working={busy}/>)}</div>:<Empty title="Все заказы обработаны"/>}
    </section></div></>;
}
