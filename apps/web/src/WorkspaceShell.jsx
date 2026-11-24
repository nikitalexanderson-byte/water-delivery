import React from 'react';
import {Brand,Dialog,Icon} from './ui';
import {roleNames} from './api';

const sections=[
  ['orders','Заказы'],['routes','Маршруты'],['atlas','Карта рейсов'],['customers','Клиенты'],['report','Отчёты'],['catalog','Каталог']
];
export const titles={orders:'Заказы на день',routes:'Маршруты доставки',atlas:'Карта рейсов',report:'Отчёт за день',catalog:'Каталог воды',customers:'Клиенты'};

function workspaceSections(role){
  return sections.filter(([id])=>{
    if(role==='driver')return id==='orders'||id==='atlas';
    if(id==='report')return role==='manager';
    return true;
  });
}

function mobileSections(role){
  const main=['orders','routes','atlas'];
  const visible=workspaceSections(role);
  return {main:visible.filter(([id])=>main.includes(id)).sort((a,b)=>main.indexOf(a[0])-main.indexOf(b[0])),
    extra:visible.filter(([id])=>!main.includes(id))};
}

function profile(user){
  const identity=user.name.split(' · ')[0];
  const initials=identity.split(/\s+/).slice(0,2).map(n=>n[0]).join('');
  return {identity,initials,description:roleNames[user.role]+(user.team_name?' · '+user.team_name:'')};
}

export function Sidebar({user,tab,navigate,mobileNavigate,openMenu,menu,theme,toggle,password,logout}){
  const {identity,initials,description}=profile(user);
  const {main,extra}=mobileSections(user.role);
  return <><aside className="sidebar"><div className="sidebar-brand"><Brand/></div>
    <nav className="side-links" aria-label="Разделы">{workspaceSections(user.role).map(([id,label])=><button key={id} aria-current={tab===id?'page':undefined} onClick={()=>navigate(id)}>
      <Icon name={id} size={20}/><span>{label}</span>{tab===id&&<i aria-hidden="true"/>}</button>)}</nav>
    <div className="side-bottom"><div className="profile"><span className="avatar" aria-hidden="true">{initials}</span><span><strong>{identity}</strong><small>{description}</small></span></div>
    <div className="side-tools"><button onClick={password} aria-label="Изменить пароль" title="Изменить пароль"><Icon name="key"/></button>
      <button onClick={toggle} aria-label={theme==='dark'?'Светлая тема':'Тёмная тема'} title={theme==='dark'?'Светлая тема':'Тёмная тема'}><Icon name={theme==='dark'?'sun':'moon'}/></button>
      <button onClick={logout} aria-label="Выйти" title="Выйти"><Icon name="logout"/></button></div></div>
  </aside>
    <header className="mobile-work-header"><Brand/>
      <button type="button" className="mobile-profile-button" aria-label="Профиль" aria-haspopup="dialog" aria-expanded={menu==='profile'} onClick={()=>openMenu('profile')}>
        <span className="mobile-role">{roleNames[user.role]}</span><span className="avatar" aria-hidden="true">{initials}</span>
      </button>
    </header>
    <nav className="mobile-work-nav" aria-label="Основные разделы">
      {main.map(([id,label])=><button type="button" key={id} aria-label={label} aria-current={tab===id?'page':undefined} onClick={()=>mobileNavigate(id)}>
        <Icon name={id} size={22}/><span>{id==='atlas'?'Карта':label}</span>
      </button>)}
      {extra.length>0&&<button type="button" aria-haspopup="dialog" aria-expanded={menu==='sections'} aria-current={extra.some(([id])=>id===tab)?'true':undefined} onClick={()=>openMenu('sections')}>
        <Icon name="more" size={22}/><span>Ещё</span>
      </button>}
    </nav>
  </>;
}

export function MobileWorkspaceMenu({kind,user,tab,navigate,theme,toggle,password,logout,close}){
  const isProfile=kind==='profile';
  const {identity,initials,description}=profile(user);
  return <Dialog className="workspace-sheet" title={isProfile?'Профиль':'Другие разделы'} close={close}>
    <div className="workspace-sheet-body">
      {isProfile?<>
        <div className="workspace-sheet-identity"><span className="avatar" aria-hidden="true">{initials}</span><div><strong>{identity}</strong><small>{description}</small></div></div>
        <button type="button" onClick={password}><Icon name="key"/>Изменить пароль</button>
        <button type="button" onClick={toggle}><Icon name={theme==='dark'?'sun':'moon'}/>{theme==='dark'?'Светлая тема':'Тёмная тема'}</button>
        <button type="button" onClick={logout}><Icon name="logout"/>Выйти</button>
      </>:mobileSections(user.role).extra.map(([id,label])=><button type="button" key={id}
        aria-current={tab===id?'page':undefined} onClick={()=>navigate(id)}><Icon name={id}/>{label}</button>)}
    </div>
  </Dialog>;
}

export function DayToolbar({config,date,choose,global,refresh,updatedAt}) {
  return <div className="day-toolbar">{global?<strong className="library-label"><Icon name="catalog"/>Справочники</strong>:<div className="day-switch">
    <span className="day-label">Рабочий день</span>
    <div className="toggle-days">{[['Сегодня',config?.today],['Завтра',config?.tomorrow]].map(([label,day])=><button key={label} disabled={!day} aria-pressed={date===day} onClick={()=>choose(day)}>{label}</button>)}</div>
    <label className="calendar-control">
      <span className="sr-only">Дата рабочего дня</span>
      <span className="calendar-value" aria-hidden="true">{date?date.split('-').reverse().join('.'):'дд.мм.гггг'}<Icon name="calendar" size={16}/></span>
      <input type="date" value={date} disabled={!config} onChange={e=>{if(e.target.value)choose(e.target.value);}}/>
    </label>
    </div>}
    <div className="sync"><span>{updatedAt?'Обновлено '+new Intl.DateTimeFormat('ru-RU',{hour:'2-digit',minute:'2-digit'}).format(updatedAt):''}</span><button className="icon-button" onClick={refresh} aria-label="Обновить данные" title="Обновить данные"><Icon name="refresh" size={16}/></button></div>
  </div>;
}
