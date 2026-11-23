import React,{ useCallback,useEffect,useRef,useState } from 'react';
import {createRoot} from 'react-dom/client';
import {isAndroidOffice,request} from './api';
import {Brand,Icon} from './ui';
import {Journal,NewOrder,OrderDetail} from './Orders';
import {Dispatch} from './Dispatch';
import {Reports} from './Reports';
import {Resources} from './Resources';
import {PasswordDialog} from './PasswordDialog';
import {Catalog,ProductDialog} from './Catalog';
import {Registration} from './Registration';
import {Sidebar,DayToolbar,MobileWorkspaceMenu,titles} from './WorkspaceShell';
import {Customers} from './Customers';
import {OrderCalendar} from './OrderCalendar';
import {TeamDialog} from './Teams';
import {Login,TeamOnboarding} from './Access';
import './styles.css';
import './workspace.css';
import './teams.css';

const RouteAtlas=React.lazy(()=>import('./RouteAtlas').then(module=>({default:module.RouteAtlas})));

function loadSession() {
  try { return JSON.parse(sessionStorage.getItem('farvater.session')); } catch { return null; }
}

function workspaceLocation(role){
  const params=new URLSearchParams(location.search);
  const view=params.get('view');
  const valid=Object.hasOwn(titles,view)&&!(view==='report'&&role==='operator')&&
    (role!=='driver'||view==='orders'||view==='atlas');
  return {tab:valid?view:'orders',demo:view==='atlas'&&params.get('example')==='1'};
}

function Workspace({session,exit,theme,toggle}) {
  const {token,user}=session;
  const [{tab,demo},setView]=useState(()=>workspaceLocation(user.role));
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
  const editable=['operator','dispatcher','manager'].includes(user.role);
  const canPlan=['dispatcher','manager'].includes(user.role);
  const canReport=canPlan;
  const latestDate=useRef(date);latestDate.current=date;
  useEffect(()=>{
    const controller=new AbortController();
    get('/config',controller.signal).then(c=>{setConfig(c);setDate(d=>d||c.today);setError('');}).catch(err=>{if(!controller.signal.aborted)setError(err.message);});
    return ()=>controller.abort();
  },[get,version]);
  useEffect(()=>{
    if(!date)return;
    const controller=new AbortController();
    let pending=false;
    async function load(){
      if(pending||controller.signal.aborted)return;
      pending=true;
      try{
        const data=await get('/day?date='+date+'&include_customers=false',controller.signal);
        if(!controller.signal.aborted&&latestDate.current===date){setSnapshot({date,data,updatedAt:new Date()});setError('');}
      }catch(err){if(!controller.signal.aborted)setError(err.message);}finally{pending=false;}
    }
    load();
    const timer=setInterval(()=>{if(document.visibilityState==='visible')load();},20000);
    const visible=()=>{if(document.visibilityState==='visible')load();};
    document.addEventListener('visibilitychange',visible);
    return ()=>{controller.abort();clearInterval(timer);document.removeEventListener('visibilitychange',visible);};
  },[date,version,get]);
  function saved(targetDate,note){setDialog(null);setMessage(note);setDate(targetDate);refresh();}
  function navigate(id,example=false){
    if(tab===id&&demo===example)return;
    const url=new URL(location.href);
    if(id==='orders')url.searchParams.delete('view');else url.searchParams.set('view',id);
    if(example&&id==='atlas')url.searchParams.set('example','1');else url.searchParams.delete('example');
    history.pushState(null,'',url);setView({tab:id,demo:example});setMessage('');setDialog(null);
  }
  useEffect(()=>{
    const back=()=>{setView(workspaceLocation(user.role));setDialog(null);setMessage('');};
    window.addEventListener('popstate',back);
    return ()=>window.removeEventListener('popstate',back);
  },[user.role]);
  async function logout(){
    setDialog(null);
    try{await send('/logout',{});exit('');}catch(err){setError(err.message);}
  }
  function mobileNavigate(id){
    navigate(id);setDialog(null);
    window.scrollTo(0,0);
    requestAnimationFrame(()=>document.getElementById('workspace')?.focus({preventScroll:true}));
  }
  const order=dialog?.id!=null&&day?.orders.find(o=>o.id===dialog.id);
  const global=tab==='catalog'||tab==='customers';
  const mobileMenu=['sections','profile'].includes(dialog?.kind)?dialog.kind:null;
  const changePassword=()=>setDialog({kind:'password'});
  return <div className="app-shell"><a className="skip" href="#workspace">К рабочей области</a>
    <Sidebar user={user} tab={tab} navigate={navigate} mobileNavigate={mobileNavigate} openMenu={kind=>setDialog({kind})} menu={mobileMenu}
      theme={theme} toggle={toggle} password={changePassword} logout={logout}/>
    <div className="work-area"><DayToolbar config={config} date={date} choose={d=>{setDate(d);setMessage('');}} global={global} refresh={refresh} updatedAt={snapshot?.updatedAt}/>
    <main id="workspace" tabIndex="-1"><header className="page-head"><div><h1>{tab==='orders'&&user.role==='driver'?'Мои заказы':titles[tab]}</h1>
      {date&&!global&&<p className="sub long-date">{new Intl.DateTimeFormat('ru-RU',{weekday:'long',day:'numeric',month:'long',year:'numeric'}).format(new Date(date+'T12:00:00'))}</p>}</div>
      <div className="actions page-actions">
    {editable&&tab==='orders'&&<button className="primary" disabled={!day} onClick={()=>setDialog({kind:'new'})}><Icon name="plus"/>Новый заказ</button>}
    {tab==='orders'&&<button disabled={!day} onClick={()=>setDialog({kind:'calendar'})}><Icon name="calendar"/>Календарь заказов</button>}
    {tab==='orders'&&user.role!=='driver'&&<button disabled={!config} onClick={()=>setDialog({kind:'team'})}><Icon name="customers"/>Команда</button>}
    {tab==='routes'&&user.role==='manager'&&<button className="primary" disabled={!day} onClick={()=>setDialog({kind:'employee'})}><Icon name="plus"/>Добавить сотрудника</button>}
    {canPlan&&tab==='routes'&&<button disabled={!day} onClick={()=>setDialog({kind:'resources'})}><Icon name="truck"/>Смены и машины</button>}
    {tab==='routes'&&canPlan&&<button disabled={!day} onClick={()=>setDialog({kind:'vehicle'})}><Icon name="plus"/>Добавить машину</button>}
    {canReport&&tab==='catalog'&&<button className="primary" disabled={!day} onClick={()=>setDialog({kind:'product'})}><Icon name="plus"/>Новый бренд</button>}
  </div></header>
  {error&&<p className="error" role="alert">{error}{day?' Показаны последние полученные данные.':''}</p>}
  {message&&<p className="success" role="status">{message}</p>}
  {day&&tab==='orders'&&user.role==='manager'&&!day.products.some(p=>p.active)&&
    <p className="notice">Чтобы принять первый заказ, <button className="link-button" onClick={()=>navigate('catalog')}>добавьте бренд воды в каталог</button>.</p>}
  {!day&&!error&&<p role="status">Загружаем данные дня…</p>}
  {day&&tab==='orders'&&<Journal day={day} onOpen={id=>setDialog({kind:'order',id})} onRoutes={()=>navigate(user.role==='driver'?'atlas':'routes')}/>}
  {day&&tab==='customers'&&editable&&<Customers get={get} onRepeat={previous=>setDialog({kind:'new',previous})}/>}
  {day&&tab==='routes'&&<Dispatch key={date} day={day} date={date} config={config} canPlan={canPlan} send={send} refresh={refresh} onOpen={id=>setDialog({kind:'order',id})}/>}
  {day&&tab==='atlas'&&<React.Suspense fallback={<p role="status">Открываем карту рейсов…</p>}><RouteAtlas key={date+':'+demo} day={day} config={config} get={get} demo={demo} setDemo={next=>navigate('atlas',next)} onOpen={id=>setDialog({kind:'order',id})}/></React.Suspense>}
  {day&&tab==='report'&&<Reports key={date} reports={day.reports} date={date} send={send} download={path=>response(path,{csv:true})} refresh={refresh}/>}
  {day&&tab==='catalog'&&<Catalog products={day.products||[]} canEdit={canReport} edit={product=>setDialog({kind:'product',product})}/>}
  </main></div>
  {mobileMenu&&<MobileWorkspaceMenu kind={mobileMenu} user={user} tab={tab} navigate={mobileNavigate} theme={theme}
    toggle={toggle} password={changePassword} logout={logout} close={()=>setDialog(null)}/>}
  {dialog?.kind==='password'&&<PasswordDialog send={send} close={()=>setDialog(null)} exit={exit}/>}
  {dialog?.kind==='team'&&<TeamDialog user={user} get={get} send={send} config={config} close={()=>setDialog(null)}
    onBase={async()=>{setConfig(await get('/config'));setDialog(null);setMessage('Координаты базы сохранены.');}}/>}
  {dialog?.kind==='calendar'&&<OrderCalendar get={get} date={date} today={config.today} close={()=>setDialog(null)}
    choose={chosen=>{setDialog(null);setDate(chosen);setMessage('');}}
    open={order=>{setDate(order.date);setDialog({kind:'order',id:order.id});setMessage('');}}/>}
  {day&&(dialog?.kind==='new'||dialog?.kind==='edit')&&<NewOrder date={dialog.kind==='edit'?dialog.previous.date:date} editing={dialog.kind==='edit'} previous={dialog.previous} get={get} products={day.products||[]} config={config} send={send} close={()=>setDialog(null)} saved={saved}/>}
  {day&&dialog?.kind==='product'&&<ProductDialog product={dialog.product} send={send} close={()=>setDialog(null)} saved={note=>saved(date,note)}/>}
  {day&&dialog?.kind==='resources'&&<Resources date={date} get={get} send={send} close={()=>setDialog(null)} refresh={saved}/>}
  {day&&['employee','vehicle'].includes(dialog?.kind)&&<Registration kind={dialog.kind} send={send} close={()=>setDialog(null)} saved={note=>saved(date,note)}/>}
  {order&&dialog?.kind==='order'&&<OrderDetail key={order.id} order={order} trip={day.trips.find(t=>t.id===order.trip_id)} shift={day.shifts.find(s=>s.id===order.shift_id)} shifts={day.shifts} canPlan={canPlan} editable={editable} send={send} close={()=>setDialog(null)} saved={saved} repeat={previous=>setDialog({kind:'new',previous})} edit={previous=>setDialog({kind:'edit',previous})}/>}
  </div>;
}

const emptyDay={orders:[],trips:[],shifts:[]};
const publicGet=(path,signal)=>request(path,{signal});

function App() {
  const [session,setSession]=useState(loadSession);
  const [initialError,setInitialError]=useState('');
  const [publicConfig,setPublicConfig]=useState(null);
  const showMap=new URLSearchParams(location.search).has('public-map');
  const [theme,setTheme]=useState(()=>localStorage.getItem('farvater.theme') || (matchMedia('(prefers-color-scheme:dark)').matches?'dark':'light'));
  useEffect(()=>{document.documentElement.dataset.theme=theme;localStorage.setItem('farvater.theme',theme);},[theme]);
  const exit=useCallback(hint=>{
    sessionStorage.removeItem('farvater.session');
    if(isAndroidOffice()){
      window.location.replace('/__farvater_android/signed-out');
      return;
    }
    setSession(null);setInitialError(hint);
  },[]);
  const login=value=>{sessionStorage.setItem('farvater.session',JSON.stringify(value));setSession(value);};
  useEffect(()=>{
    if(session&&!showMap)return;
    const controller=new AbortController();
    publicGet('/config',controller.signal).then(setPublicConfig).catch(err=>{if(!controller.signal.aborted)setInitialError(err.message);});
    return ()=>controller.abort();
  },[session,showMap]);
  if(showMap)return <div className="team-shell"><header className="team-bar"><Brand/><a href="/">К рабочему кабинету</a></header>
    <main className="public-atlas"><h1>Учебная карта рейсов</h1>{!publicConfig?(initialError?<p role="alert">{initialError}</p>:<p role="status">Загружаем карту…</p>):
      <React.Suspense fallback={<p role="status">Открываем карту…</p>}>
        <RouteAtlas day={emptyDay} config={publicConfig} get={publicGet} demo setDemo={()=>{location.href='/';}}/>
      </React.Suspense>}</main></div>;
  if(session?.user.team_id===null)return <TeamOnboarding session={session} updated={login} exit={exit}/>;
  return session?<Workspace session={session} theme={theme} toggle={()=>setTheme(t=>t==='dark'?'light':'dark')} exit={exit}/>:<Login onLogin={login} initialError={initialError} registration={publicConfig?.registration_enabled}/>;
}
createRoot(document.getElementById('root')).render(<App/>);
