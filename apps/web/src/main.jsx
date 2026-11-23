import React,{ useCallback,useEffect,useRef,useState } from 'react';
import {createRoot} from 'react-dom/client';
import {request,roleNames} from './api';
import {Brand,Field,Icon} from './ui';
import {Journal,NewOrder,OrderDetail} from './Orders';
import {Dispatch} from './Dispatch';
import {Reports} from './Reports';
import {Resources} from './Resources';
import {PasswordDialog} from './PasswordDialog';
import './styles.css';

const screens=[['orders','Заказы'],['routes','Маршруты'],['report','Отчёты']];
function loadSession() {
  try { return JSON.parse(sessionStorage.getItem('farvater.session')); } catch { return null; }
}

function Login({onLogin,initialError}) {
  const [error,setError]=useState(initialError);
  const [busy,setBusy]=useState(false);
  async function enter(e) {
    e.preventDefault();setError('');setBusy(true);
    const form=new FormData(e.currentTarget);
    try {
      const value=await request('/login',{method:'POST',body:{email:form.get('email').trim(),password:form.get('password')}});
      if(!roleNames[value.user.role]) {
        await request('/logout',{method:'POST',token:value.token});
        throw new Error('Для работы экспедитора откройте приложение ФАРВАТЕР на Android.');
      }
      onLogin(value);
    }catch(err){setError(err.message);}finally{setBusy(false);}
  }
  return <div className="login-shell"><div className="login-card"><div className="brand-bar"><Brand/></div><form onSubmit={enter}><h1>Вход в диспетчерскую</h1>
    <Field label="Электронная почта"><input type="email" name="email" autoComplete="username" required autoFocus placeholder="name@farvater.test"/></Field>
    <Field label="Пароль"><input type="password" name="password" autoComplete="current-password" required/></Field>
    {error&&<p role="alert" className="error">{error}</p>}
    <button className="primary" disabled={busy}>{busy?'Входим…':'Войти'}<Icon name="arrow"/></button>
  </form></div></div>;
}

function Workspace({session,exit,theme,toggle}) {
  const {token,user}=session;
  const [tab,setTab]=useState('orders');
  const [date,setDate]=useState('');
  const [config,setConfig]=useState(null);
  const [snapshot,setSnapshot]=useState(null);
  const [error,setError]=useState('');
  const [message,setMessage]=useState('');
  const [dialog,setDialog]=useState(null);
  const [version,setVersion]=useState(0);
  const refresh=()=>setVersion(v=>v+1);
  const response=useCallback(async(path,options={})=>{
    try{return await request(path,{...options,token});}catch(err){if(err.status===401)exit('Сессия истекла. Войдите повторно.');throw err;}
  },[token,exit]);
  const get=useCallback((path,signal)=>response(path,{signal}),[response]);
  const send=(path,body,method='POST',key)=>response(path,{method,body,key});
  const day=snapshot?.date===date?snapshot.data:null;
  const editable=['operator','dispatcher'].includes(user.role);
  const canPlan=user.role==='dispatcher';
  const canReport=canPlan||user.role==='manager';
  const tabs=screens.filter(([id])=>id!=='report'||canReport);
  const latestDate=useRef(date);latestDate.current=date;
  useEffect(()=>{
    const controller=new AbortController();
    if(!config)get('/config',controller.signal).then(c=>{setConfig(c);setDate(c.today);setError('');}).catch(err=>{if(!controller.signal.aborted)setError(err.message);});
    return ()=>controller.abort();
  },[get,config,version]);
  useEffect(()=>{
    if(!date)return;
    const controller=new AbortController();
    let pending=false;
    async function load(){
      if(pending||controller.signal.aborted)return;
      pending=true;
      try{
        const data=await get('/day?date='+date,controller.signal);
        if(!controller.signal.aborted&&latestDate.current===date){setSnapshot({date,data});setError('');}
      }catch(err){if(!controller.signal.aborted)setError(err.message);}finally{pending=false;}
    }
    load();
    const timer=setInterval(()=>{if(document.visibilityState==='visible')load();},20000);
    const visible=()=>{if(document.visibilityState==='visible')load();};
    document.addEventListener('visibilitychange',visible);
    return ()=>{controller.abort();clearInterval(timer);document.removeEventListener('visibilitychange',visible);};
  },[date,version,get]);
  function saved(targetDate,note){setDialog(null);setMessage(note);setDate(targetDate);refresh();}
  function navigate(id){setTab(id);setMessage('');setDialog(null);}
  async function logout(){
    try{await send('/logout',{});exit('');}catch(err){setError(err.message);}
  }
  const order=dialog?.id!=null&&day?.orders.find(o=>o.id===dialog.id);
  return <><a className="skip" href="#workspace">К рабочей области</a><header className="top"><div className="top-inner"><Brand/><div className="top-actions">
    <span className="identity">{user.name}</span>
    <button className="icon-button" onClick={()=>setDialog({kind:'password'})} aria-label="Изменить пароль" title="Изменить пароль"><Icon name="key"/></button>
    <button className="icon-button" onClick={toggle} aria-label={theme==='dark'?'Светлая тема':'Тёмная тема'} title={theme==='dark'?'Светлая тема':'Тёмная тема'}><Icon name={theme==='dark'?'sun':'moon'}/></button>
    <button className="icon-button" onClick={logout} aria-label="Выйти" title="Выйти"><Icon name="logout"/></button>
  </div></div></header>
  <nav aria-label="Разделы"><div className="nav-inner">{tabs.map(([id,name])=><button key={id} className={tab===id?'active':''} aria-current={tab===id?'page':undefined} onClick={()=>navigate(id)}><Icon name={id}/>{name}</button>)}</div></nav>
  <main id="workspace" tabIndex="-1"><header className="page-head"><div><h1>{tab==='orders'?'Заказы на день':tab==='routes'?'Маршруты доставки':'Отчёт за день'}</h1>
    {date&&<p className="sub long-date">{new Intl.DateTimeFormat('ru-RU',{weekday:'long',day:'numeric',month:'long',year:'numeric'}).format(new Date(date+'T12:00:00'))}</p>}</div>
    <div className="actions"><label><span className="sr-only">Дата рабочего дня</span><input type="date" value={date} disabled={!config} onChange={e=>{if(e.target.value){setDate(e.target.value);setMessage('');}}}/></label>
    <button className="icon-button" onClick={refresh} aria-label="Обновить данные" title="Обновить данные"><Icon name="refresh"/></button>
    {editable&&tab==='orders'&&<button className="primary" disabled={!day} onClick={()=>setDialog({kind:'new'})}><Icon name="plus"/>Новый заказ</button>}
    {canPlan&&tab==='routes'&&<button disabled={!day} onClick={()=>setDialog({kind:'resources'})}><Icon name="truck"/>Смены и машины</button>}
  </div></header>
  {error&&<p className="error" role="alert">{error}{day?' Показаны последние полученные данные.':''}</p>}
  {message&&<p className="success" role="status">{message}</p>}
  {!day&&!error&&<p role="status">Загружаем данные дня…</p>}
  {day&&tab==='orders'&&<Journal orders={day.orders} onOpen={id=>setDialog({kind:'order',id})}/>}
  {day&&tab==='routes'&&<Dispatch key={date} day={day} date={date} config={config} canPlan={canPlan} send={send} refresh={refresh} onOpen={id=>setDialog({kind:'order',id})}/>}
  {day&&tab==='report'&&<Reports key={date} reports={day.reports} date={date} send={send} download={path=>response(path,{csv:true})} refresh={refresh}/>}
  </main>
  {dialog?.kind==='password'&&<PasswordDialog send={send} close={()=>setDialog(null)} exit={exit}/>}
  {day&&dialog?.kind==='new'&&<NewOrder date={dialog.previous?config.today:date} previous={dialog.previous} customers={day.customers} config={config} send={send} close={()=>setDialog(null)} saved={saved}/>}
  {day&&dialog?.kind==='resources'&&<Resources date={date} get={get} send={send} close={()=>setDialog(null)} refresh={saved}/>}
  {order&&dialog?.kind==='order'&&<OrderDetail key={order.id} order={order} trip={day.trips.find(t=>t.id===order.trip_id)} shift={day.shifts.find(s=>s.id===order.shift_id)} shifts={day.shifts} canPlan={canPlan} editable={editable} send={send} close={()=>setDialog(null)} saved={saved} repeat={previous=>setDialog({kind:'new',previous})}/>}
  </>;
}

function App() {
  const [session,setSession]=useState(loadSession);
  const [initialError,setInitialError]=useState('');
  const [theme,setTheme]=useState(()=>localStorage.getItem('farvater.theme') || (matchMedia('(prefers-color-scheme:dark)').matches?'dark':'light'));
  useEffect(()=>{document.documentElement.dataset.theme=theme;localStorage.setItem('farvater.theme',theme);},[theme]);
  const exit=useCallback(hint=>{sessionStorage.removeItem('farvater.session');setSession(null);setInitialError(hint);},[]);
  const login=value=>{sessionStorage.setItem('farvater.session',JSON.stringify(value));setSession(value);};
  return session?<Workspace session={session} theme={theme} toggle={()=>setTheme(t=>t==='dark'?'light':'dark')} exit={exit}/>:<Login onLogin={login} initialError={initialError}/>;
}
createRoot(document.getElementById('root')).render(<App/>);
