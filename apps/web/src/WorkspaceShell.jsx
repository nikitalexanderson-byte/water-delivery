import React from 'react';
import {Brand,Icon} from './ui';
import {roleNames} from './api';

const sections=[
  ['orders','Заказы'],['routes','Маршруты'],['atlas','Карта рейсов'],['customers','Клиенты'],['report','Отчёты'],['catalog','Каталог']
];
export const titles={orders:'Заказы на день',routes:'Маршруты доставки',atlas:'Карта рейсов',report:'Отчёт за день',catalog:'Каталог воды',customers:'Клиенты'};

export function Sidebar({user,tab,navigate,toggle,theme,password,logout}){
  const visible=sections.filter(([id])=>{
    if(id==='customers')return ['operator','dispatcher'].includes(user.role);
    if(id==='report')return ['dispatcher','manager'].includes(user.role);
    return true;
  });
  const identity=user.name.split(' · ')[0];
  const initials=identity.split(/\s+/).slice(0,2).map(n=>n[0]).join('');
  return <aside className="sidebar"><div className="sidebar-brand"><Brand/></div>
    <nav className="side-links" aria-label="Разделы">{visible.map(([id,label])=><button key={id} aria-label={label} aria-current={tab===id?'page':undefined} onClick={()=>navigate(id)}>
      <Icon name={id} size={20}/>{id==='atlas'?<><span className="atlas-full">Карта рейсов</span><span className="atlas-short" aria-hidden="true">Карта</span></>:<span>{label}</span>}{tab===id&&<i aria-hidden="true"/>}</button>)}</nav>
    <div className="side-bottom"><div className="profile"><span className="avatar" aria-hidden="true">{initials}</span><span><strong>{identity}</strong><small>{roleNames[user.role]}</small></span></div>
    <div className="side-tools"><button onClick={password} aria-label="Изменить пароль" title="Изменить пароль"><Icon name="key"/></button>
      <button onClick={toggle} aria-label={theme==='dark'?'Светлая тема':'Тёмная тема'} title={theme==='dark'?'Светлая тема':'Тёмная тема'}><Icon name={theme==='dark'?'sun':'moon'}/></button>
      <button onClick={logout} aria-label="Выйти" title="Выйти"><Icon name="logout"/></button></div></div>
  </aside>;
}

export function DayToolbar({config,date,choose,global,refresh,updatedAt}) {
  return <div className="day-toolbar">{global?<strong className="library-label"><Icon name="catalog"/>Справочники</strong>:<div className="day-switch">
    <span className="day-label">Рабочий день</span>
    <div className="toggle-days">{[['Сегодня',config?.today],['Завтра',config?.tomorrow]].map(([label,day])=><button key={label} disabled={!day} aria-pressed={date===day} onClick={()=>choose(day)}>{label}</button>)}</div>
    <label className="calendar-control"><span className="sr-only">Дата рабочего дня</span><input type="date" value={date} disabled={!config} onChange={e=>{if(e.target.value)choose(e.target.value);}}/></label>
    </div>}
    <div className="sync"><span>{updatedAt?'Обновлено '+new Intl.DateTimeFormat('ru-RU',{hour:'2-digit',minute:'2-digit'}).format(updatedAt):''}</span><button className="icon-button" onClick={refresh} aria-label="Обновить данные" title="Обновить данные"><Icon name="refresh" size={16}/></button></div>
  </div>;
}
