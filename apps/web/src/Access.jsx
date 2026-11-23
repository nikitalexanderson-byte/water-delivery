import React,{useEffect,useRef,useState} from 'react';
import {request} from './api';
import {Brand,Field,Icon} from './ui';
import './access.css';

const intents={
  create:{title:'Я организую доставку',description:'Создам свою команду и приглашу сотрудников.',icon:'customers'},
  join:{title:'Меня пригласили',description:'Вступлю в команду по коду от руководителя.',icon:'key'},
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

function IntentChoices({choose}) {
  return <div className="access-choices">
    {Object.entries(intents).map(([id,intent])=><button type="button" className="access-choice" key={id} onClick={()=>choose(id)}
      aria-labelledby={'intent-'+id} aria-describedby={'intent-description-'+id}>
      <span className="access-symbol"><Icon name={intent.icon} size={22}/></span>
      <span className="access-choice-text">
        <strong id={'intent-'+id}>{intent.title}</strong>
        <span id={'intent-description-'+id}>{intent.description}</span>
      </span>
      <Icon name="arrow"/>
    </button>)}
  </div>;
}

export function Login({onLogin,initialError,registration}) {
  const [step,setStep]=useState('login');
  const [error,setError]=useState('');
  const [busy,setBusy]=useState(false);
  const intent=intents[step];
  const signup=Boolean(intent);
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
        email:form.get('email').trim(),password,...(signup?{name:form.get('name').trim()}:{})}});
      onLogin(signup?{...value,teamIntent:step}:value);
    }catch(err){setError(err.message);}finally{setBusy(false);}
  }
  if(step==='choice')return <AccessPanel title="Как вы будете работать?"
    description="Выберите, что хотите сделать после регистрации.">
    <IntentChoices choose={show}/>
    <button type="button" className="link-button access-back" onClick={()=>show('login')}>Вернуться ко входу</button>
  </AccessPanel>;
  return <AccessPanel title={signup?'Создать аккаунт':'Вход в ФАРВАТЕР'}
    description={signup?(step==='create'?'Зарегистрируйтесь, чтобы создать свою команду.':'Зарегистрируйтесь, затем введите код от руководителя.'):'Управляйте доставками и рейсами своей команды.'}
    showMap={!signup}>
    <form key={step} className="access-form" onSubmit={enter} aria-busy={busy}>
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
      onClick={()=>show('choice')}>{signup?'Изменить способ регистрации':'Создать аккаунт'}</button>}
  </AccessPanel>;
}

export function TeamOnboarding({session,updated,exit}) {
  const [busy,setBusy]=useState('');
  const [error,setError]=useState('');
  const intent=session.teamIntent;
  const selected=Object.hasOwn(intents,intent);
  const joining=intent==='join';
  function choose(next){setError('');updated({...session,teamIntent:next});}
  async function submit(event){
    event.preventDefault();
    const field=joining?'code':'name';
    const value=new FormData(event.currentTarget).get(field).trim();
    if(joining&&!/^[a-f0-9]{32}$/i.test(value)){
      setError('Скопируйте код целиком. В нём должно быть 32 символа.');
      return;
    }
    setBusy(intent);setError('');
    try{
      const {user}=await request('/teams/'+intent,{method:'POST',token:session.token,body:{[field]:value}});
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
  return <AccessPanel title={selected?(joining?'Вступить в команду':'Создать команду'):'Ваша команда доставки'}
    description={selected?(joining?'Руководитель уже указал вашу роль в приглашении.':'Укажите название, которое будут видеть сотрудники.'):'Создайте свою команду или присоединитесь по приглашению.'}
    account={<div className="access-account"><span>{session.user.name}</span><button type="button" disabled={!!busy} onClick={logout}>Выйти</button></div>}>
    {selected?<>
      <form key={intent} className="access-form" onSubmit={submit} aria-busy={busy===intent}>
        {joining?<Field label="Код приглашения"><input name="code" autoComplete="off" autoCapitalize="off" spellCheck={false} required/></Field>
          :<Field label="Название команды"><input name="name" autoComplete="organization" required maxLength={120}/></Field>}
        {error&&<p role="alert" className="error">{error}</p>}
        <button className="primary" disabled={!!busy}>{busy===intent?'Подождите…':joining?'Присоединиться':'Создать команду'}</button>
      </form>
      <button type="button" className="link-button access-back" disabled={!!busy} onClick={()=>choose(null)}>Изменить выбор</button>
    </>:<>
      {error&&<p role="alert" className="error">{error}</p>}
      <IntentChoices choose={choose}/>
    </>}
  </AccessPanel>;
}
