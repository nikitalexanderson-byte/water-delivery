import React,{useEffect,useRef,useState} from 'react';
import {Dialog,Field} from './ui';
import {roleNames,staffRoles} from './api';

const activityLabels={
  'order.created':'Заказ создан','order.edited':'Заказ изменён','order.assigned':'Назначен рейс',
  'order.reassigned':'Рейс переназначен','order.reschedule':'Доставка перенесена',
  'order.rescheduled_after_failure':'Создана повторная доставка','order.cancel':'Заказ отменён',
  'order.arrived':'Экспедитор прибыл','order.delivered':'Доставка подтверждена',
  'order.failed':'Доставка не состоялась','order.on_site':'Продажа на месте',
};

function ActivityList({get,timezone}){
  const [activity,setActivity]=useState(null);
  const [error,setError]=useState('');
  const [attempt,setAttempt]=useState(0);
  useEffect(()=>{
    const controller=new AbortController();
    get('/team/activity',controller.signal).then(x=>setActivity(x.activity)).catch(err=>{
      if(!controller.signal.aborted)setError(err.message);
    });
    return ()=>controller.abort();
  },[get,attempt]);
  if(error)return <div className="team-form"><p role="alert" className="error">{error}</p><button type="button" onClick={()=>{
    setError('');setAttempt(n=>n+1);
  }}>Повторить</button></div>;
  if(!activity)return <p role="status">Загружаем журнал работы…</p>;
  if(!activity.length)return <p className="sub">Действия появятся после создания, назначения или доставки заказов.</p>;
  const date=new Intl.DateTimeFormat('ru-RU',{timeZone:timezone,dateStyle:'short',timeStyle:'short'});
  return <ol className="team-activity">{activity.map(event=><li key={event.id}>
    <div><strong>{activityLabels[event.event]} · №{event.order_id}</strong>
      <small>{event.actor_name} · {roleNames[event.actor_role]}{event.driver_name&&` → ${event.driver_name}`}</small></div>
    <time dateTime={event.created_at}>{date.format(new Date(event.created_at))}</time>
  </li>)}</ol>;
}

function DepotSettings({get,send,config,onBase}){
  const [data,setData]=useState(null);
  const [choice,setChoice]=useState('');
  const [loading,setLoading]=useState(false);
  const [message,setMessage]=useState('');
  const [error,setError]=useState('');
  function update(result){
    setData(result);
    setChoice(String(result.active_base_id??''));
  }
  useEffect(()=>{
    const controller=new AbortController();
    get('/team/bases',controller.signal).then(update).catch(err=>{if(!controller.signal.aborted)setError(err.message);});
    return ()=>controller.abort();
  },[get]);
  async function save(operation){
    setLoading(true);setError('');setMessage('');
    try{await operation();}catch(err){setError(err.message);}finally{setLoading(false);}
  }
  function add(event){
    event.preventDefault();
    const form=new FormData(event.currentTarget);
    save(async()=>{
      const {id}=await send('/team/bases',{address:form.get('address').trim(),lat:Number(form.get('lat')),lon:Number(form.get('lon'))});
      update(await get('/team/bases'));
      setChoice(String(id));
      setMessage('База добавлена. Чтобы использовать её для рейсов, нажмите «Выбрать базу».');
    });
  }
  function choose(event){
    event.preventDefault();
    save(async()=>{
      await send('/team/bases/active',{id:Number(choice)});
      update(await get('/team/bases'));
      await onBase();
      setMessage('Рабочая база обновлена. Учебный рейс начнётся и закончится на ней.');
    });
  }
  return <div className="team-base-settings">
    <p className="sub">Рабочие рейсы отправляются с выбранной базы и возвращаются на неё.</p>
    <p>Текущая база · {config.base_address||'не выбрана'}</p>
    {data?.bases.length>0&&<form className="team-form" onSubmit={choose}>
      <Field label="Рабочая база"><select value={choice} onChange={e=>setChoice(e.target.value)} required>
        <option value="" disabled>Выберите базу</option>
        {data.bases.map(base=><option key={base.id} value={base.id}>{base.address}</option>)}
      </select></Field>
      <button type="submit" disabled={loading||!choice||Number(choice)===data.active_base_id}>Выбрать базу</button>
    </form>}
    {data&&<details open={!data.bases.length}><summary>Добавить базу</summary><form className="team-form" onSubmit={add}>
      <Field label="Адрес производства"><input required maxLength={300} name="address" defaultValue={data.bases.length?'':config.base_address||config.example_base_address}/></Field>
      <div className="form-grid">
        <Field label="Широта базы"><input required name="lat" type="number" min="-90" max="90" step="any" defaultValue={data.bases.length?'':config.base_lat??config.example_base_lat}/></Field>
        <Field label="Долгота базы"><input required name="lon" type="number" min="-180" max="180" step="any" defaultValue={data.bases.length?'':config.base_lon??config.example_base_lon}/></Field>
      </div>
      <button type="submit" disabled={loading}>Сохранить базу</button>
    </form></details>}
    {message&&<p role="status" className="success">{message}</p>}
    {error&&<p role="alert" className="error">{error}</p>}
  </div>;
}

export function TeamDialog({user,get,send,close,config,onBase}){
  const inviteField=useRef(null);
  const [people,setPeople]=useState(null);
  const [view,setView]=useState('members');
  const [role,setRole]=useState('driver');
  const [invite,setInvite]=useState(null);
  const [copyStatus,setCopyStatus]=useState('');
  const [error,setError]=useState('');
  const [busy,setBusy]=useState(false);
  useEffect(()=>{
    const controller=new AbortController();
    get('/team',controller.signal).then(x=>setPeople(x.members)).catch(err=>{if(!controller.signal.aborted)setError(err.message);});
    return ()=>controller.abort();
  },[get]);
  async function issue(event){
    event.preventDefault();setBusy(true);setInvite(null);setCopyStatus('');setError('');
    try{setInvite({...await send('/team/invitations',{role}),role});}
    catch(err){setError(err.message);}finally{setBusy(false);}
  }
  async function copyInvite(){
    try{
      await navigator.clipboard.writeText(invite.code);
      setCopyStatus('Код скопирован');
    }catch{
      inviteField.current?.focus();
      inviteField.current?.select();
      setCopyStatus('Код выделен. Скопируйте его вручную.');
    }
  }
  return <Dialog title="Команда" close={close}><div className="team-dialog form-body">
    <p className="sub">{user.team_name}</p>
    {user.role==='manager'&&<div role="group" aria-label="Разделы команды" className="team-views">
      <button type="button" aria-pressed={view==='members'} onClick={()=>setView('members')}>Сотрудники</button>
      <button type="button" aria-pressed={view==='activity'} onClick={()=>setView('activity')}>Журнал работы</button>
      <button type="button" aria-pressed={view==='bases'} onClick={()=>setView('bases')}>Базы</button>
    </div>}
    {view==='activity'?<ActivityList get={get} timezone={config.timezone}/>:view==='bases'?<DepotSettings get={get} send={send} config={config} onBase={onBase}/>:<>
    {people?<ul className="team-members">{people.map(p=><li key={p.id}><strong>{p.name}</strong><span>{roleNames[p.role]}</span></li>)}</ul>:<p role="status">Загружаем список сотрудников…</p>}
    {error&&<p role="alert" className="error">{error}</p>}
    {user.role==='manager'&&<>
      <form onSubmit={issue} className="team-form">
        <Field label="Роль нового сотрудника"><select value={role} onChange={e=>setRole(e.target.value)}>
          {staffRoles.map(r=><option key={r} value={r}>{roleNames[r]}</option>)}
        </select></Field>
        <button className="primary" disabled={busy}>Создать приглашение</button>
      </form>
      {invite&&<div className="invite-result">
        <p>Код действует 48 часов. Передайте его сотруднику вместе с ролью «{roleNames[invite.role]}».</p>
        <Field label="Одноразовый код"><input ref={inviteField} readOnly value={invite.code} onFocus={e=>e.target.select()}/></Field>
        <button type="button" onClick={copyInvite}>Копировать код</button>
        {copyStatus&&<span role="status">{copyStatus}</span>}
      </div>}
    </>}
    </>}
  </div></Dialog>;
}
