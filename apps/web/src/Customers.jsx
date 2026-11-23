import React,{useEffect,useRef,useState} from 'react';
import {Icon,Empty,money} from './ui';
import {minuteText,orderStates} from './api';
import './customers.css';

const dateLabel=new Intl.DateTimeFormat('ru-RU',{day:'numeric',month:'long',year:'numeric'});

function usePages(get,path,key){
  const [after,setAfter]=useState(null);
  const [attempt,setAttempt]=useState(0);
  const [state,setState]=useState({data:[],next:null,entry:null,busy:true,error:''});
  useEffect(()=>{
    const controller=new AbortController();
    setState(s=>({...s,busy:true,error:''}));
    const suffix=after===null?'':(path.includes('?')?'&':'?')+'after='+encodeURIComponent(after);
    get(path+suffix,controller.signal).then(page=>{
      if(controller.signal.aborted)return;
      setState(s=>({data:after===null?page[key]:[...s.data,...page[key]],next:page.next,
        entry:page.customer??null,busy:false,error:''}));
    }).catch(e=>{
      if(!controller.signal.aborted)setState(s=>({...s,busy:false,error:e.message}));
    });
    return ()=>controller.abort();
  },[get,path,key,after,attempt]);
  return {...state,more:()=>setAfter(state.next),retry:()=>setAttempt(n=>n+1)};
}

function PageControl({page,label}){
  if(page.error)return <div className="directory-feedback"><p role="alert">{page.error}</p><button onClick={page.retry}>Повторить загрузку</button></div>;
  if(page.busy)return <p className="directory-feedback" role="status">Загрузка…</p>;
  return page.next!==null?<button className="directory-more" onClick={page.more}>{label}</button>:null;
}

function History({get,customer,onRepeat,back}){
  const page=usePages(get,'/customers/'+customer.id+'/history','orders');
  return <section className="person-history" aria-label="Карточка клиента">
    <button className="directory-back" onClick={back}>К списку клиентов</button>
    <header className="person-header"><div><h2>{customer.name}</h2><p>{customer.phone}</p></div>
      <span className="person-address"><Icon name="pin"/>{customer.address}</span></header>
    <h3 className="history-title">История заказов</h3>
    {page.data.map(order=><article key={order.id} className="history-row">
      <div className="history-date"><strong>{dateLabel.format(new Date(order.date+'T12:00:00'))}</strong>
        <span>№ {order.id} · {minuteText(order.window_start)}–{minuteText(order.window_end)}</span></div>
      <div className="history-detail"><span className="history-status">{orderStates[order.status]||order.status}</span>
        <p>{order.address}</p>
        <ul>{order.items.map(item=><li key={item.product_id}>{item.name} · <span className="measure">{item.water} × {money(item.water_price)}</span></li>)}
          {order.new_shells>0&&<li>Новая тара · <span className="measure">{order.new_shells} × {money(order.shell_price)}</span></li>}</ul>
        <div className="history-bottom"><strong className="measure">{money(order.total)}</strong>
          <button onClick={()=>onRepeat(order)} aria-label={'Повторить заказ № '+order.id}>Повторить заказ</button></div>
      </div></article>)}
    {!page.busy&&!page.error&&!page.data.length&&<Empty title="У клиента пока нет заказов"/>}
    <PageControl page={page} label="Предыдущие заказы"/>
  </section>;
}

function Directory({get,query,onRepeat}){
  const page=usePages(get,'/customers?q='+encodeURIComponent(query),'customers');
  const [selected,setSelected]=useState(null);
  const current=page.data.find(c=>c.id===selected)??page.data[0];
  const choices=useRef(null);
  const details=useRef(null);
  function select(customer){
    setSelected(customer.id);
    if(window.matchMedia('(max-width: 760px)').matches)requestAnimationFrame(()=>details.current?.focus());
  }
  function back(){
    const button=choices.current?.querySelector('[aria-pressed="true"]');
    setSelected(null);
    requestAnimationFrame(()=>button?.focus());
  }
  return <div className={'customer-directory'+(selected!==null?' customer-picked':'')}>
    <section className="person-results" aria-label="Список клиентов" ref={choices}>
      {!page.busy&&!page.error&&!page.data.length&&<Empty title="Клиенты не найдены" detail="Проверьте имя или введите несколько цифр телефона."/>}
      {page.data.map(c=><button type="button" className="person-choice" key={c.id} aria-pressed={c.id===current?.id} onClick={()=>select(c)}>
        <strong>{c.name}</strong><span>{c.phone}</span><span>{c.address}</span></button>)}
      <PageControl page={page} label="Ещё клиенты"/>
    </section>
    <div className="person-content" ref={details} tabIndex={-1}>
      {current?<History key={current.id} get={get} customer={current} onRepeat={onRepeat} back={back}/>:null}
    </div>
  </div>;
}

export function Customers({get,onRepeat}){
  const [query,setQuery]=useState('');
  const [search,setSearch]=useState('');
  useEffect(()=>{
    const delay=setTimeout(()=>setSearch(query.trim()),160);return ()=>clearTimeout(delay);
  },[query]);
  return <div className="customers-area">
    <label className="directory-search"><Icon name="search"/><span className="sr-only">Найти клиента</span>
      <input type="search" maxLength={200} value={query} onChange={e=>setQuery(e.target.value)} placeholder="Имя, телефон или адрес"/></label>
    {query.trim()===search?<Directory key={search} query={search} get={get} onRepeat={onRepeat}/>:<p role="status">Ищем клиентов…</p>}
  </div>;
}
