import React, { useEffect, useState } from 'react';
import {Empty, Icon} from './ui';
import {minuteText, shiftStates, tripStates} from './api';

function PendingOrder({order,shifts,onAssign,onOpen,canPlan,working,suggestion,reason}) {
  const [shiftId,setShiftId]=useState('');
  const eligible=shifts.filter(s=>s.status==='confirmed'||s.status==='active');
  const crew=eligible.find(shift=>shift.id===suggestion?.shift_id);
  const extra=suggestion?.extra_driving_minutes;
  return <div className="queue-row"><div><button className="link-button" onClick={()=>onOpen(order.id)}>№ {order.id} · {order.name}</button>
    <small>{order.address} · {minuteText(order.window_start)}–{minuteText(order.window_end)} · <span className="measure">{order.water} бут.</span></small>
    {order.reason && <small className="reason">{order.reason}</small>}
    {!order.address_verified && !order.reason && <small className="reason">Адрес ожидает подтверждения</small>}
  </div>{crew&&<div className="smart-suggestion">
    <div><strong>{crew.driver_name} · рейс {suggestion.trip_number}</strong>
      <small>Прибытие около <b>{minuteText(suggestion.eta)}</b> · {extra<0?'на '+Math.abs(extra)+' мин меньше в пути':extra>0?'+'+extra+' мин в пути':'без лишнего переезда'}</small>
      <small>{suggestion.uses_live_location?'С учётом геопозиции':'По плану смены'}</small></div>
    <button type="button" disabled={working} onClick={()=>onAssign(order.id,crew.id,order.version,suggestion.trip_number)}>Подтвердить</button>
  </div>}{reason&&!order.reason&&order.address_verified&&<small className="reason">{reason}</small>}
  {canPlan&&eligible.length>0&&<form className="actions" onSubmit={e=>{e.preventDefault();onAssign(order.id,Number(shiftId),order.version);}}>
    <label><span className="sr-only">{'Смена для заказа №'+order.id}</span><select value={shiftId} onChange={e=>setShiftId(e.target.value)} required><option value="">Выбрать смену</option>{eligible.map(s=><option value={s.id} key={s.id}>{s.driver_name}</option>)}</select></label>
    <button type="submit" disabled={!shiftId||working}>Назначить</button>
  </form>}</div>;
}

export function Dispatch({day,date,config,canPlan,get,send,refresh,onOpen}) {
  const [selectedId,select]=useState(null);
  const [message,setMessage]=useState('');
  const [error,setError]=useState('');
  const [busy,setBusy]=useState(false);
  const [smart,setSmart]=useState(Boolean(day.smart_routing_enabled));
  const [desiredSmart,setDesiredSmart]=useState(null);
  const [preview,setPreview]=useState(null);
  const [previewError,setPreviewError]=useState('');
  const {orders,shifts,trips}=day;
  const queue=orders.filter(o=>o.status==='pending');
  const smartToday=canPlan&&date===config.today;
  useEffect(()=>{setSmart(Boolean(day.smart_routing_enabled));},[day.smart_routing_enabled]);
  useEffect(()=>{
    if(!smartToday||!smart||!day.orders.some(order=>order.status==='pending')){
      setPreview(null);setPreviewError('');
      return;
    }
    const request=new AbortController();
    get('/plan-suggestions?date='+date,request.signal).then(result=>{
      if(!request.signal.aborted){setPreview(result);setPreviewError('');}
    }).catch(err=>{
      if(!request.signal.aborted){setPreview(null);setPreviewError(err.message);}
    });
    return ()=>request.abort();
  },[date,day,get,smart,smartToday]);
  const suggestions=new Map((smartToday&&smart?preview?.suggestions??[]:[]).map(item=>[item.order_id,item]));
  const reasons=new Map((smartToday&&smart?preview?.unassigned??[]:[]).map(item=>[item.order_id,item.reason]));
  const shift=shifts.find(s=>s.id===selectedId)||shifts[0];
  const shiftTrips=trips.filter(t=>t.shift_id===shift?.id).sort((a,b)=>a.number-b.number);
  async function changeSmart(enabled) {
    setError('');setBusy(true);setDesiredSmart(enabled);
    try {
      await send('/routing-preferences',{enabled},'PATCH');
      setSmart(enabled);refresh();
    }catch(err){setError(err.message);}finally{setDesiredSmart(null);setBusy(false);}
  }
  async function plan(orderId,shiftId,version,suggestedTrip) {
    setError('');setMessage('');setBusy(true);
    try {
      const result=await send('/plan',{date,...(orderId?{order_id:orderId,shift_id:shiftId,version}:{}),
        ...(suggestedTrip?{suggested_trip:suggestedTrip}:{})});
      const left=result.unassigned||[];
      const message='Назначено заказов: '+result.assigned+'. Осталось после подбора: '+left.length+'.';
      const source={yandex:'Время в пути рассчитано по прогнозу пробок Яндекса.',
        mixed:'Прогноз Яндекса доступен для части пути. Остальное время рассчитано по оценке.',
        estimate:'Время в пути рассчитано без прогноза пробок Яндекса.'}[result.traffic_source];
      setMessage([message,left.length===1?left[0].reason:'',source].filter(Boolean).join(' '));
      refresh();
    }catch(err){setError(err.message);refresh();}finally{setBusy(false);}
  }
  async function bringForward(order){
    setBusy(true);setError('');setMessage('');
    try{
      await send('/orders/'+order.id+'/bring-forward',{version:order.version});
      setMessage('Заказ №'+order.id+' перенесён на сегодня и назначен на рейс.');
    }catch(err){setError(err.message);}finally{refresh();setBusy(false);}
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
        {extraSales.some(s=>s.source_order_id==null)&&<section aria-label="Продажи вне плановых остановок"><h4>Продажи вне плановых остановок</h4>
          {extraSales.filter(s=>s.source_order_id==null).map(s=><div key={s.id}><button className="link-button" onClick={()=>onOpen(s.id)}>№ {s.id} · {s.name} · <span className="measure">{s.water} бут.</span></button></div>)}</section>}
        </article>;
      })}<p className="model-note"><Icon name="time" size={14}/>Время прибытия включает дорогу, окно и обслуживание точки.</p></div>:<Empty title="Рейсы ещё не сформированы" detail="После распределения здесь появятся остановки и время прибытия."/>}
    </section>
    <section className="panel queue-panel" id="dispatch-queue"><div className="panel-head"><div><h2>Очередь распределения <span>{queue.length}</span></h2>{problems>0&&<small>Требуют проверки · {problems}</small>}</div></div>
    {smartToday&&<div className="smart-routing">
      <label><span>Умный подбор по геопозиции</span>
        <input type="checkbox" role="switch" checked={desiredSmart??smart} disabled={busy}
          onChange={event=>changeSmart(event.target.checked)}/></label>
      {smart&&<small>Предлагает экспедитора. Заказ назначается после подтверждения.</small>}
      {smart&&queue.length>0&&previewError&&<p role="status" className="reason">{previewError}</p>}
      {smart&&queue.length>0&&!preview&&!previewError&&<small role="status">Подбираем экспедиторов…</small>}
    </div>}
    {canPlan&&<div className="plan-action"><button className="primary" disabled={!queue.length||busy} onClick={()=>plan()}><Icon name="routes"/>{busy?'Идёт подбор…':'Распределить заказы'}</button></div>}
    {queue.length?<div className="queue">{queue.map(o=>{
      const suggestion=suggestions.get(o.id);
      return <PendingOrder key={o.id} order={o} shifts={shifts} onAssign={plan} onOpen={onOpen} canPlan={canPlan}
        working={busy} suggestion={suggestion?.version===o.version?suggestion:null} reason={reasons.get(o.id)}/>;
    })}</div>:<Empty title="Все заказы обработаны"/>}
    {canPlan&&date===config.today&&day.early_orders?.length>0&&<section className="early-orders" aria-label="Можно доставить сегодня">
      <h3>Можно доставить сегодня</h3><p>Клиенты согласны на доставку раньше. Заказ перейдёт на сегодня, если для него найдётся рейс.</p>
      {day.early_orders.map(o=><div className="queue-row" key={o.id}><div><strong>№ {o.id} · {o.name}</strong><small>{o.address}</small>
        <small>Заказ на {new Intl.DateTimeFormat('ru-RU',{day:'numeric',month:'long'}).format(new Date(o.date+'T12:00:00'))} · {minuteText(o.window_start)}–{minuteText(o.window_end)} · <span className="measure">{o.water} бут.</span></small></div>
        <button disabled={busy} onClick={()=>bringForward(o)}>Подобрать рейс на сегодня</button></div>)}
    </section>}
    </section></div></>;
}
