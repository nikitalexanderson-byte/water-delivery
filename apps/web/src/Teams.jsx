import React,{useEffect,useState} from 'react';
import {Brand,Dialog,Field,Icon} from './ui';
import {request,roleNames} from './api';

export function TeamOnboarding({session,updated,exit}){
  const [busy,setBusy]=useState('');
  const [error,setError]=useState(null);
  async function submit(event,action,field){
    event.preventDefault();
    const value=new FormData(event.currentTarget).get(field).trim();
    setBusy(action);setError(null);
    try{
      const {user}=await request('/teams/'+action,{method:'POST',token:session.token,body:{[field]:value}});
      updated({...session,user});
    }catch(err){if(err.status===401)exit(err.message);else setError({action,text:err.message});}
    finally{setBusy('');}
  }
  return <div className="team-shell">
    <header className="team-bar"><Brand/><div><span>{session.user.name}</span> <button onClick={async()=>{
      try{await request('/logout',{method:'POST',token:session.token});exit('');}
      catch(err){if(err.status===401)exit('');else setError({action:'logout',text:err.message});}
    }}>Выйти</button></div></header>
    <main className="team-onboarding"><h1>Ваша команда доставки</h1>
      <p className="sub">Создайте своё рабочее пространство или присоединитесь по коду от руководителя.</p>
      {error?.action==='logout'&&<p className="error" role="alert">{error.text}</p>}
      <div className="team-options">
        <form onSubmit={e=>submit(e,'create','name')}>
          <span className="team-symbol"><Icon name="customers" size={23}/></span>
          <h2>Я организую доставку</h2><p className="sub">Откройте кабинет руководителя и пригласите сотрудников.</p>
          <Field label="Название команды"><input name="name" autoComplete="organization" required maxLength={120}/></Field>
          {error?.action==='create'&&<p className="error" role="alert">{error.text}</p>}
          <button className="primary" disabled={!!busy}>Создать команду <Icon name="arrow"/></button>
        </form>
        <form onSubmit={e=>submit(e,'join','code')}>
          <span className="team-symbol"><Icon name="truck" size={23}/></span>
          <h2>Меня пригласили</h2><p className="sub">Вставьте одноразовый код. Роль уже указана в приглашении.</p>
          <Field label="Код приглашения"><input name="code" autoComplete="off" autoCapitalize="off" spellCheck={false} required maxLength={34}/></Field>
          {error?.action==='join'&&<p className="error" role="alert">{error.text}</p>}
          <button disabled={!!busy}>Присоединиться</button>
        </form>
      </div>
    </main>
  </div>;
}

export function TeamDialog({user,get,send,close,config,onBase}){
  const [people,setPeople]=useState(null);
  const [role,setRole]=useState('driver');
  const [invite,setInvite]=useState(null);
  const [copied,setCopied]=useState(false);
  const [error,setError]=useState('');
  const [busy,setBusy]=useState(false);
  useEffect(()=>{
    const controller=new AbortController();
    get('/team',controller.signal).then(x=>setPeople(x.members)).catch(err=>{if(!controller.signal.aborted)setError(err.message);});
    return ()=>controller.abort();
  },[get]);
  async function issue(event){
    event.preventDefault();setBusy(true);setInvite(null);setCopied(false);setError('');
    try{setInvite(await send('/team/invitations',{role}));}
    catch(err){setError(err.message);}finally{setBusy(false);}
  }
  async function saveBase(event){
    event.preventDefault();setBusy(true);setError('');
    const fields=new FormData(event.currentTarget);
    const coordinate=key=>fields.get(key)===''?null:Number(fields.get(key));
    try{
      await send('/team/base',{address:fields.get('address').trim(),lat:coordinate('lat'),lon:coordinate('lon')},'PATCH');
      await onBase();
    }catch(err){setError(err.message);}finally{setBusy(false);}
  }
  return <Dialog title="Команда" close={close}><div className="team-dialog form-body">
    <p className="sub">{user.team_name}</p>
    {people?<ul className="team-members">{people.map(p=><li key={p.id}><strong>{p.name}</strong><span>{roleNames[p.role]}</span></li>)}</ul>:<p role="status">Загружаем список сотрудников…</p>}
    {error&&<p role="alert" className="error">{error}</p>}
    {user.role==='manager'&&<>
      <form onSubmit={issue} className="team-form">
        <Field label="Роль нового сотрудника"><select value={role} onChange={e=>setRole(e.target.value)}>
          {['driver','operator','dispatcher'].map(r=><option key={r} value={r}>{roleNames[r]}</option>)}
        </select></Field>
        <button className="primary" disabled={busy}>Создать приглашение</button>
      </form>
      {invite&&<div className="invite-result">
        <p>Код действует 48 часов. Передайте его сотруднику, чтобы он ввёл код после регистрации.</p>
        <Field label="Одноразовый код"><input readOnly value={invite.code} onFocus={e=>e.target.select()}/></Field>
        <button onClick={async()=>{try{await navigator.clipboard.writeText(invite.code);setCopied(true);}catch{setCopied(false);}}}>Копировать код</button>
        {copied&&<span role="status">Код скопирован</span>}
      </div>}
      <details><summary>Адрес и координаты базы</summary><form className="team-form" onSubmit={saveBase}>
        <Field label="Адрес производства"><input maxLength={300} name="address" defaultValue={config.base_address}/></Field>
        <div className="form-grid">
          <Field label="Широта базы"><input name="lat" type="number" min="-90" max="90" step="any" defaultValue={config.base_lat??''}/></Field>
          <Field label="Долгота базы"><input name="lon" type="number" min="-180" max="180" step="any" defaultValue={config.base_lon??''}/></Field>
        </div>
        <button disabled={busy}>Сохранить базу</button>
      </form></details>
    </>}
  </div></Dialog>;
}
