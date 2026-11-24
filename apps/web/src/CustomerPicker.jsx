import React,{useEffect,useRef,useState} from 'react';
import {Icon,SearchField} from './ui';

export function CustomerPicker({get,selected,onChoose,allowNew}){
  const [query,setQuery]=useState('');
  const [searching,setSearching]=useState(!selected);
  const [results,setResults]=useState({items:[],loading:false,error:''});
  const [retry,setRetry]=useState(0);
  const resultList=useRef(null);
  const term=query.trim();
  useEffect(()=>{
    if(!searching||!term){setResults({items:[],loading:false,error:''});return;}
    const controller=new AbortController();
    setResults({items:[],loading:true,error:''});
    const timer=setTimeout(async()=>{
      try {
        const page=await get('/customers?q='+encodeURIComponent(term),controller.signal);
        if(!controller.signal.aborted)setResults({items:page.customers,more:page.next!=null,loading:false,error:''});
      }catch(error){if(!controller.signal.aborted)setResults({items:[],loading:false,error:error.message});}
    },180);
    return ()=>{clearTimeout(timer);controller.abort();};
  },[get,searching,term,retry]);
  function choose(value){onChoose(value);setSearching(!value);setQuery('');}
  return <div className="wide customer-picker">{selected&&<div className="picked-client"><div><strong>{selected.name}</strong><small>{selected.phone}</small></div>
    <button className="link-button" type="button" onClick={()=>setSearching(s=>!s)}>{searching?'Свернуть поиск':'Выбрать другого'}</button></div>}
    {searching&&<><SearchField label="Поиск клиента по имени или телефону" showLabel value={query} onChange={e=>setQuery(e.target.value)} placeholder="Имя или телефон" autoComplete="off"
      onKeyDown={e=>{if(e.key==='ArrowDown'||e.key==='Enter'){e.preventDefault();if(results.items.length)resultList.current?.querySelector('button')?.focus();}}}/>
    {term&&<div className="pick-results" ref={resultList}>
      {results.loading&&<p role="status">Ищем клиентов…</p>}{results.error&&<p role="alert">{results.error} <button className="link-button" type="button" onClick={()=>setRetry(n=>n+1)}>Повторить</button></p>}
      {!results.loading&&!results.error&&!results.items.length&&<p>Клиенты не найдены.</p>}
      {results.items.length>0&&<span className="sr-only" role="status">Найдено клиентов · {results.items.length}</span>}
      {results.items.map(c=><button type="button" key={c.id} onClick={()=>choose(c)}><span><strong>{c.name}</strong><small>{c.phone} · {c.address}</small></span><Icon name="arrow" size={15}/></button>)}
      {results.more&&<p>Показаны первые {results.items.length}. Уточните имя или номер.</p>}
    </div>}{selected&&allowNew&&<button type="button" className="link-button" onClick={()=>choose(null)}>Оформить на нового клиента</button>}</>}
  </div>;
}
