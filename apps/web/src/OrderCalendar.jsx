import React,{useEffect,useState} from 'react';
import {Dialog,Empty} from './ui';
import {orderStates} from './api';
import './order-calendar.css';

const dayFormat=new Intl.DateTimeFormat('ru-RU',{day:'numeric',month:'long',year:'numeric',timeZone:'UTC'});
const plusDays=(date,offset)=>new Date(Date.parse(date+'T12:00:00Z')+offset*86400000).toISOString().slice(0,10);
const dateText=date=>dayFormat.format(new Date(date+'T12:00:00Z'));
const forms=new Intl.PluralRules('ru-RU');
const countText=n=>n+' '+({one:'заказ',few:'заказа',many:'заказов',other:'заказа'}[forms.select(n)]);

function DateGrid({get,start,selected,today,move,choose}){
  const [counts,setCounts]=useState(null);
  const [error,setError]=useState('');
  const [retry,setRetry]=useState(0);
  useEffect(()=>{
    const controller=new AbortController();
    get('/order-calendar?start='+start,controller.signal).then(({days})=>{
      if(!controller.signal.aborted)setCounts(new Map(days.map(d=>[d.date,d.count])));
    }).catch(err=>{if(!controller.signal.aborted)setError(err.message);});
    return ()=>controller.abort();
  },[get,start,retry]);
  const shift=(new Date(start+'T12:00:00Z').getUTCDay()+6)%7;
  return <><div className="calendar-navigation"><button type="button" onClick={()=>move(plusDays(start,-30))} aria-label="Предыдущие 30 дней">←</button>
    <strong>{dateText(start)} – {dateText(plusDays(start,29))}</strong>
    <button type="button" onClick={()=>move(plusDays(start,30))} aria-label="Следующие 30 дней">→</button></div>
    {error?<div role="alert">{error} <button onClick={()=>{setError('');setRetry(n=>n+1);}}>Повторить</button></div>:<>
      {!counts&&<p role="status">Загружаем количество заказов…</p>}
      <div className="order-date-grid">{['Пн','Вт','Ср','Чт','Пт','Сб','Вс'].map(label=><span key={label}>{label}</span>)}
        {Array.from({length:30},(_,i)=>{
          const date=plusDays(start,i),n=counts?.get(date)??0;
          return <button key={date} type="button" aria-label={dateText(date)+(counts?', '+countText(n):'')}
            aria-pressed={date===selected} aria-current={date===today?'date':undefined} style={i===0?{gridColumnStart:shift+1}:undefined} onClick={()=>choose(date)}>
            <strong>{Number(date.slice(-2))}</strong><small>{counts?n:'…'}</small></button>;
        })}</div>
      <p className="sub">Под датой указано количество заказов.</p>
    </>}
  </>;
}

function Archive({get,open}){
  const [items,setItems]=useState([]);
  const [next,setNext]=useState(null);
  const [after,setAfter]=useState(null);
  const [busy,setBusy]=useState(true);
  const [error,setError]=useState('');
  const [retry,setRetry]=useState(0);
  useEffect(()=>{
    const controller=new AbortController();
    get('/order-archive'+(after?'?after='+encodeURIComponent(after):''),controller.signal).then(page=>{
      if(controller.signal.aborted)return;
      setItems(previous=>after?[...previous,...page.orders]:page.orders);setNext(page.next);setBusy(false);
    }).catch(err=>{if(!controller.signal.aborted){setBusy(false);setError(err.message);}});
    return ()=>controller.abort();
  },[get,after,retry]);
  return <><ul className="order-archive">{items.map(o=><li key={o.id}><button type="button" onClick={()=>open(o)}>
    <span><strong>№ {o.id} · {o.name}</strong><small>{o.address}</small></span>
    <span>{dateText(o.date)}<small>{orderStates[o.status]||o.status}</small></span></button></li>)}</ul>
    {busy&&<p role="status">Загружаем заказы…</p>}
    {error&&<div role="alert">{error} <button onClick={()=>{setError('');setBusy(true);setRetry(n=>n+1);}}>Повторить загрузку</button></div>}
    {!busy&&!error&&!items.length&&<Empty title="Заказов пока нет"/>}
    {!busy&&!error&&next&&<button onClick={()=>{setBusy(true);setAfter(next);}}>Ещё заказы</button>}
  </>;
}

export function OrderCalendar({get,date,today,close,choose,open}){
  const [archive,setArchive]=useState(false);
  const [start,setStart]=useState(date);
  return <Dialog className="calendar-dialog" title="Календарь заказов" close={close}><div className="calendar-body">
    <div className="calendar-tabs" role="group" aria-label="Период заказов">
      <button aria-pressed={!archive} onClick={()=>setArchive(false)}>30 дней</button>
      <button aria-pressed={archive} onClick={()=>setArchive(true)}>Весь период</button>
    </div>
    {archive?<Archive get={get} open={open}/>:<DateGrid key={start} get={get} start={start} selected={date} today={today} move={setStart} choose={choose}/>}
  </div></Dialog>;
}
