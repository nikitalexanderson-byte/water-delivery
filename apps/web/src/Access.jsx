import React,{useEffect,useRef,useState} from 'react';
import {request,roleNames,staffRoles} from './api';
import {Brand,Field,Icon} from './ui';
import './access.css';

const registrationRoles={
  driver:{description:'Доставляю заказы и сдаю смену.',icon:'truck'},
  operator:{description:'Принимаю заказы и распределяю рейсы.',icon:'orders'},
};

const androidApk='/downloads/farvater-driver.apk';

function AccessLinks(){
  const [apkAvailable,setApkAvailable]=useState(false);
  useEffect(()=>{
    const controller=new AbortController();
    fetch(androidApk,{method:'HEAD',signal:controller.signal}).then(response=>{
      if(!controller.signal.aborted)setApkAvailable(response.ok&&response.headers.get('content-type')==='application/vnd.android.package-archive');
    }).catch(()=>{});
    return ()=>controller.abort();
  },[]);
  return <footer className="access-links">
    {apkAvailable&&<a className="access-map" href={androidApk}><Icon name="download"/>Скачать приложение Android</a>}
    <a className="access-map" href="/?public-map=1"><Icon name="atlas"/>Учебная карта · 2 рейса</a>
  </footer>;
}

function AccessPanel({title,description,children,showMap=false,account}) {
  const heading=useRef(null);
  const previousTitle=useRef(title);
  useEffect(()=>{
    if(previousTitle.current!==title)heading.current?.focus();
    previousTitle.current=title;
  },[title]);
  return <div className="access-shell"><div className="access-wrap">
    <header className="access-brand"><Brand/></header>
    <main className="access-card" aria-labelledby="access-title">
      <div className="access-heading">
        <h1 id="access-title" ref={heading} tabIndex="-1">{title}</h1>
        <p>{description}</p>
      </div>
      {children}
    </main>
    {account}
    {showMap&&<AccessLinks/>}
  </div></div>;
}

function RoleChoices({choose}) {
  return <div className="access-choices">
    {staffRoles.map(id=><button type="button" className="access-choice" key={id} onClick={()=>choose(id)}
      aria-labelledby={'role-'+id} aria-describedby={'role-description-'+id}>
      <span className="access-symbol"><Icon name={registrationRoles[id].icon} size={22}/></span>
      <span className="access-choice-text">
        <strong id={'role-'+id}>{roleNames[id]}</strong>
        <span id={'role-description-'+id}>{registrationRoles[id].description}</span>
      </span>
      <Icon name="arrow"/>
    </button>)}
  </div>;
}

export function Login({onLogin,initialError,registration}) {
  const [step,setStep]=useState('login');
  const [error,setError]=useState('');
  const [busy,setBusy]=useState(false);
  const signup=staffRoles.includes(step);
  function show(next){setStep(next);setError('');}
  async function enter(event){
    event.preventDefault();setError('');
    const form=new FormData(event.currentTarget);
    const password=form.get('password');
    if(signup&&password!==form.get('confirmation')){
      setError('Пароли различаются. Проверьте оба поля.');
      return;
    }
    setBusy(true);
    try{
      const value=await request(signup?'/register':'/login',{method:'POST',body:{
        email:form.get('email').trim(),password,...(signup?{name:form.get('name').trim(),role:step,code:form.get('code').trim()}:{})}});
      onLogin(value);
    }catch(err){setError(err.message);}finally{setBusy(false);}
  }
  if(step==='choice')return <AccessPanel title="Как вы будете работать?"
    description="Выберите роль, которую администратор указал в приглашении.">
    <RoleChoices choose={show}/>
    <button type="button" className="link-button access-back" onClick={()=>show('login')}>Вернуться ко входу</button>
  </AccessPanel>;
  return <AccessPanel title={signup?`Регистрация · ${roleNames[step]}`:'Вход в ФАРВАТЕР'}
    description={signup?'Введите код приглашения от администратора команды.':'Управляйте доставками и рейсами своей команды.'}
    showMap={!signup}>
    <form key={step} className="access-form" onSubmit={enter} aria-busy={busy}>
      {signup&&<Field label="Код приглашения"><input name="code" autoComplete="off" autoCapitalize="off" spellCheck={false} required/></Field>}
      {signup&&<Field label="Ваше имя"><input name="name" autoComplete="name" required maxLength={120}/></Field>}
      <Field label="Электронная почта"><input type="email" name="email" autoComplete="username" autoCapitalize="off" required maxLength={254}/></Field>
      <Field label="Пароль"><input type="password" name="password" autoComplete={signup?'new-password':'current-password'}
        minLength={signup?10:undefined} maxLength={128} aria-describedby={signup?'password-length':undefined} required/></Field>
      {signup&&<small id="password-length" className="access-hint">Минимум 10 символов.</small>}
      {signup&&<Field label="Повторите пароль"><input type="password" name="confirmation" autoComplete="new-password" required maxLength={128}/></Field>}
      {(error||(!signup&&initialError))&&<p role="alert" className="error">{error||initialError}</p>}
      <button className="primary" disabled={busy}>{busy?'Подождите…':signup?'Зарегистрироваться':'Войти'}</button>
    </form>
    {(signup||registration)&&<button type="button" className={signup?'link-button access-back':'access-secondary'} disabled={busy}
      onClick={()=>show('choice')}>{signup?'Выбрать другую роль':'Создать аккаунт'}</button>}
  </AccessPanel>;
}

export function TeamOnboarding({session,updated,exit}) {
  const [busy,setBusy]=useState('');
  const [error,setError]=useState('');
  async function submit(event){
    event.preventDefault();
    const code=new FormData(event.currentTarget).get('code').trim();
    if(!/^[a-f0-9]{32}$/i.test(code)){
      setError('Скопируйте код целиком. В нём должно быть 32 символа.');
      return;
    }
    setBusy('join');setError('');
    try{
      const {user}=await request('/teams/join',{method:'POST',token:session.token,body:{code}});
      updated({token:session.token,user});
    }catch(err){if(err.status===401)exit(err.message);else setError(err.message);}
    finally{setBusy('');}
  }
  async function logout(){
    setBusy('logout');setError('');
    try{await request('/logout',{method:'POST',token:session.token});exit('');}
    catch(err){if(err.status===401)exit('');else setError(err.message);}
    finally{setBusy('');}
  }
  return <AccessPanel title="Вступить в команду"
    description="Введите код от администратора. Роль уже указана в приглашении."
    account={<div className="access-account"><span>{session.user.name}</span><button type="button" disabled={!!busy} onClick={logout}>Выйти</button></div>}>
    <form className="access-form" onSubmit={submit} aria-busy={busy==='join'}>
      <Field label="Код приглашения"><input name="code" autoComplete="off" autoCapitalize="off" spellCheck={false} required/></Field>
      {error&&<p role="alert" className="error">{error}</p>}
      <button className="primary" disabled={!!busy}>{busy==='join'?'Подождите…':'Присоединиться'}</button>
    </form>
  </AccessPanel>;
}
