import React, { useRef, useState } from 'react';
import { Dialog, Empty, Field, Icon, money } from './ui';
import { minuteText, orderStates, toMinutes } from './api';

function fieldChange(update, key, checkbox = false) {
  return e => update(key, checkbox ? e.target.checked : e.target.value);
}

export function NewOrder({ date, customers, config, send, close, saved, previous }) {
  const [form, setForm] = useState(()=>({
    customer:'new', name:'', phone:'', address:'', date, start:'09:00', end:'18:00',
    water:'1', shells:'1', price:String(config.water_price / 100), category:'retail',
    method:'cash', company:'', verified:false, shellSale:false, floor:'', lift:true, checkpoint:false, height:'', note:'',
    ...(previous ? {
      customer:String(previous.customer_id), address:previous.address, start:minuteText(previous.window_start), end:minuteText(previous.window_end),
      water:String(previous.water), shells:String(previous.new_shells||1), shellSale:previous.new_shells>0, price:String(previous.water_price/100),
      category:previous.category, method:previous.payment_method, company:previous.company||'', floor:previous.floor??'',
      lift:previous.lift, checkpoint:previous.checkpoint, height:previous.height_limit_mm?String(previous.height_limit_mm/1000):'', note:previous.note||'',
    }:{})
  }));
  const [error,setError]=useState('');
  const [busy,setBusy]=useState(false);
  const lastAttempt=useRef(null);
  const update=(key,v)=>setForm(f=>({...f,[key]:v}));
  const bind=(key, checkbox=false)=>({[checkbox?'checked':'value']:form[key],onChange:fieldChange(update,key,checkbox)});
  const shells = form.shellSale ? Number(form.shells) : 0;
  const total = Number(form.water) * Math.round(Number(form.price) * 100) + shells * config.shell_price;
  function chooseCustomer(e) {
    const customer = customers.find(c=>String(c.id)===e.target.value);
    setForm(f=>({...f,customer:e.target.value,name:customer?.name||'',phone:customer?.phone||'',address:customer?.address||'',verified:false}));
  }
  async function submit(e) {
    e.preventDefault();
    setError('');
    if (form.start >= form.end) { setError('Конец окна должен быть позже начала.'); return; }
    setBusy(true);
    try {
      const payload={
        ...(form.customer==='new'?{name:form.name.trim(),phone:form.phone.trim()}:{customer_id:Number(form.customer)}),
        address:form.address.trim(), date:form.date, window_start:toMinutes(form.start), window_end:toMinutes(form.end),
        water:Number(form.water),new_shells:shells,water_price:Math.round(Number(form.price)*100),
        category:form.category,payment_method:form.method,company:form.method==='bank'?form.company.trim():'',
        address_verified:form.verified,lift:form.lift,checkpoint:form.checkpoint,note:form.note.trim(),
        ...(form.floor!==''?{floor:Number(form.floor)}:{}), ...(form.height!==''?{height_limit_mm:Math.round(Number(form.height)*1000)}:{}),
      };
      const signature=JSON.stringify(payload);
      if(lastAttempt.current?.signature!==signature)lastAttempt.current={signature,key:crypto.randomUUID()};
      const order=await send('/orders',payload,'POST',lastAttempt.current.key);
      saved(form.date,'Заказ №' + order.id + ' добавлен в очередь.');
    } catch(err) { setError(err.message); } finally {setBusy(false);}
  }
  return <Dialog title="Новый заказ" close={()=>{if(!busy) close();}}>
    <form onSubmit={submit}><div className="form-body">
      <fieldset><legend>Клиент и адрес</legend><div className="form-grid">
        <Field label="Карточка клиента" wide><select value={form.customer} onChange={chooseCustomer} autoFocus><option value="new">Новый клиент</option>{customers.map(c=><option key={c.id} value={c.id}>{c.name} · {c.phone}</option>)}</select></Field>
        {form.customer==='new' && <><Field label="Имя или организация"><input {...bind('name')} required maxLength={120}/></Field><Field label="Телефон"><input {...bind('phone')} required type="tel" minLength={6} maxLength={24}/></Field></>}
        <Field label="Адрес доставки" wide><input value={form.address} onChange={e=>setForm(f=>({...f,address:e.target.value,verified:false}))} required maxLength={300}/></Field>
        <label className="check wide"><input type="checkbox" {...bind('verified',true)}/>Адрес проверен для тестового маршрута</label>
      </div><details><summary>Этаж, въезд и инструкции</summary><div className="form-grid">
        <Field label="Этаж"><input type="number" {...bind('floor')} min="-5" max="150" step="1"/></Field>
        <Field label="Ограничение въезда, м"><input type="number" {...bind('height')} step="0.001" min="0.001" max="15"/></Field>
        <label className="check"><input type="checkbox" {...bind('lift',true)}/>Есть лифт</label>
        <label className="check"><input type="checkbox" {...bind('checkpoint',true)}/>Нужен пропуск на КПП</label>
        <Field label="Инструкции экспедитору" wide><textarea {...bind('note')} rows="2" maxLength={500}/></Field>
      </div></details></fieldset>
      <fieldset><legend>Время доставки</legend><div className="form-grid">
        <Field label="Дата доставки" wide><input type="date" {...bind('date')} required/></Field>
        <Field label="Принимают с"><input type="time" {...bind('start')} required/></Field><Field label="Принимают до"><input type="time" {...bind('end')} required/></Field>
      </div></fieldset>
      <fieldset><legend>Вода и оплата</legend><div className="form-grid">
        <Field label="Бутыли 19 л, шт."><input type="number" {...bind('water')} required min="1" max="10000" step="1"/></Field>
        <Field label="За бутыль воды, ₽"><input type="number" {...bind('price')} required min="0.01" max="100000" step="0.01"/></Field>
        <label className="check wide"><input type="checkbox" {...bind('shellSale',true)}/>Добавить новую тару</label>
        {form.shellSale && <Field label={'Новая тара по '+money(config.shell_price)+', шт.'} wide><input type="number" {...bind('shells')} required min="1" max={form.water} step="1"/></Field>}
        <Field label="Категория"><select {...bind('category')}><option value="retail">Розница</option><option value="wholesale">Опт</option></select></Field>
        <Field label="Способ оплаты"><select {...bind('method')}><option value="cash">Наличные</option><option value="bank">Безналичный расчёт</option></select></Field>
        {form.method==='bank'&&<Field label="Название компании" wide><input {...bind('company')} required maxLength="160"/></Field>}
      </div></fieldset>
    </div>{error&&<p className="error" role="alert">{error}</p>}
    <div className="dialog-footer"><div><small>Итого к оплате</small><strong aria-live="polite">{money(total)}</strong></div><button type="submit" className="primary" disabled={busy}>{busy?'Сохраняем…':'Создать заказ'}</button></div>
    </form></Dialog>;
}

export function Status({status}) {
  const style={pending:'wait',assigned:'',delivered:'good',failed:'bad',cancelled:''}[status];
  return <span className={'pill '+style}>{orderStates[status]||status}</span>;
}

export function Journal({ orders, onOpen }) {
  const [query,setQuery]=useState('');
  const [filter,setFilter]=useState('');
  const search=query.trim().toLocaleLowerCase('ru');
  const visible=orders.filter(o=>(!filter||o.status===filter)&&(!search||[o.name,o.address,o.phone,String(o.id)].some(v=>String(v||'').toLocaleLowerCase('ru').includes(search))));
  const delivered=orders.filter(o=>o.status==='delivered').length;
  const metrics=[['Заказы','orders',orders.length],['В очереди','time',orders.filter(o=>o.status==='pending').length],['Доставлено','check',delivered],['Бутылей в заказах','water',orders.reduce((s,o)=>s+(o.status==='cancelled'?0:o.water),0)]];
  return <><div className="summary">{metrics.map(([label,icon,value])=><div className="metric" key={label}><span>{label}</span><Icon name={icon}/><strong>{value}</strong></div>)}</div>
    <section className="panel"><header className="panel-head"><h2>Журнал заказов <span>{visible.length}</span></h2><div className="actions">
      <label className="search"><Icon name="search"/><span className="sr-only">Поиск по заказам</span><input type="search" placeholder="Имя, адрес или номер" value={query} onChange={e=>setQuery(e.target.value)}/></label>
      <label><span className="sr-only">Статус заказа</span><select value={filter} onChange={e=>setFilter(e.target.value)}><option value="">Все статусы</option>{Object.entries(orderStates).map(([key,name])=><option key={key} value={key}>{name}</option>)}</select></label>
    </div></header>
    {visible.length ? <div className="table-scroll"><table className="journal-table"><caption className="sr-only">Заказы за выбранный день</caption><thead><tr>{['Заказ','Клиент и адрес','Окно доставки','Бутыли','Стоимость','Статус'].map(s=><th key={s} scope="col">{s}</th>)}</tr></thead>
    <tbody>{visible.map(o=><tr key={o.id}>
      <td><button className="link-button" onClick={()=>onOpen(o.id)} aria-label={'Открыть заказ №'+o.id}>№ {o.id}</button>{o.origin==='on_site'&&<small>Продажа на месте</small>}</td>
      <td><strong>{o.name}</strong><small>{o.address}</small></td>
      <td className="nowrap" data-label="Окно">{minuteText(o.window_start)}–{minuteText(o.window_end)}</td>
      <td data-label="Вода">{o.water} шт.</td><td className="nowrap" data-label="Стоимость">{money(o.total)}</td><td><Status status={o.status}/></td>
    </tr>)}</tbody></table></div>:<Empty title={orders.length?'Заказы не найдены':'Заказов на этот день пока нет'} detail={orders.length?'Измените поиск или выберите другой статус.':null}/>}
    </section></>;
}

export function OrderDetail({ order, trip, shift, shifts, canPlan, editable, send, close, saved, repeat }) {
  const [o]=useState(order);
  const [newShift,setNewShift]=useState('');
  const [mode,setMode]=useState('');
  const [date,setDate]=useState(o.date);
  const [start,setStart]=useState(minuteText(o.window_start));
  const [end,setEnd]=useState(minuteText(o.window_end));
  const [error,setError]=useState('');
  const [busy,setBusy]=useState(false);
  async function submit(e) {
    e.preventDefault(); setError('');
    if (mode==='reschedule' && start>=end) {setError('Укажите окно с окончанием после начала.');return;}
    setBusy(true);
    try{
      await send('/orders/'+o.id+'/'+mode,{version:o.version,...(mode==='reschedule'?{date,window_start:toMinutes(start),window_end:toMinutes(end)}:{})});
      saved(mode==='reschedule'?date:o.date,mode==='reschedule'?'Заказ перенесён.':'Заказ отменён.');
    }catch(err){setError(err.message);}finally{setBusy(false);}
  }
  const rows=[['Клиент',o.name],['Телефон',o.phone],['Адрес',o.address],['Принимают',minuteText(o.window_start)+'–'+minuteText(o.window_end)],['Вода',o.water+' × '+money(o.water_price)],['Новая тара',o.new_shells+' × '+money(o.shell_price)],['Итого',money(o.total)],['Оплата',o.payment_method==='bank'?'Безналичный расчёт · '+o.company:'Наличные'],['Адрес проверен',o.address_verified?'Да':'Требует проверки'],['Экспедитор',shift?.driver_name],['Рейс',trip?.number],['Этаж',o.floor],['КПП',o.checkpoint?'Нужен пропуск':null],['Высота въезда',o.height_limit_mm?o.height_limit_mm/1000+' м':null],['Инструкции',o.note],['Причина в очереди',o.reason]];
  rows.push(['Источник',o.origin==='on_site'?'Продажа у клиента':null],['Причина срыва',o.failure_reason]);
  const canChange=editable&&['pending','assigned'].includes(o.status)&&(!trip||trip.status==='planned');
  const canReschedule=canChange||(editable&&o.status==='failed'&&!o.rescheduled_to);
  const alternatives=shifts.filter(s=>s.id!==o.shift_id&&['confirmed','active'].includes(s.status));
  async function reassign(e) {
    e.preventDefault();setBusy(true);setError('');
    try {
      const shiftId=Number(newShift);
      await send('/plan',{date:o.date,order_id:o.id,shift_id:shiftId,version:o.version});
      const target=alternatives.find(s=>s.id===shiftId);
      saved(o.date,'Заказ №'+o.id+' передан в смену · '+target.driver_name+'.');
    }catch(err){setError(err.message);}finally{setBusy(false);}
  }
  async function verify() {
    setBusy(true);setError('');
    try {await send('/orders/'+o.id+'/verify-address',{version:o.version});saved(o.date,'Адрес подтверждён. Заказ готов к распределению.');}
    catch(err){setError(err.message);}finally{setBusy(false);}
  }
  return <Dialog title={'Заказ №'+o.id} close={()=>{if(!busy) close();}}><div className="detail-body"><p className="row" style={{marginBlock:'12px'}}><Status status={o.status}/></p>
    <dl className="detail-list">{rows.filter(([,v])=>v!==undefined&&v!==null&&v!=='').map(([k,v])=><React.Fragment key={k}><dt>{k}</dt><dd>{v}</dd></React.Fragment>)}</dl>
    {canPlan&&o.status==='assigned'&&trip?.status==='planned'&&!mode&&<details className="change-shift"><summary>Сменить экспедитора</summary>
      {alternatives.length?<form className="actions" onSubmit={reassign}><Field label="Другая подтверждённая смена"><select required value={newShift} onChange={e=>setNewShift(e.target.value)}><option value="">Выберите экспедитора</option>{alternatives.map(s=><option key={s.id} value={s.id}>{s.driver_name} · {minuteText(s.start_min)}–{minuteText(s.end_min)}</option>)}</select></Field>
      <button disabled={busy||!newShift}>Передать заказ</button></form>:<p className="sub">На эту дату пока нет другой подтверждённой смены.</p>}
    </details>}
    {canReschedule&&!mode&&<div className="actions">{o.status==='pending'&&!o.address_verified&&<button className="primary" disabled={busy} onClick={verify}>Подтвердить адрес</button>}<button disabled={busy} onClick={()=>setMode('reschedule')}>Перенести заказ</button>{canChange&&<button disabled={busy} onClick={()=>setMode('cancel')}>Отменить заказ</button>}</div>}
    {mode&&<form onSubmit={submit}><fieldset><legend>{mode==='reschedule'?'Новое время доставки':'Подтвердите отмену заказа'}</legend>{mode==='reschedule'?<div className="form-grid"><Field label="Новая дата" wide><input type="date" required value={date} onChange={e=>setDate(e.target.value)}/></Field><Field label="Начало окна"><input type="time" required value={start} onChange={e=>setStart(e.target.value)}/></Field><Field label="Конец окна"><input type="time" value={end} required onChange={e=>setEnd(e.target.value)}/></Field></div>:<p>Заказ исчезнет из очереди распределения, запись сохранится в журнале.</p>}</fieldset>
    <div className="actions"><button disabled={busy} className="primary">{mode==='reschedule'?'Сохранить перенос':'Подтвердить отмену'}</button><button disabled={busy} type="button" onClick={()=>{setMode('');setError('');}}>Назад</button></div></form>}
    {error&&<p role="alert" className="error">{error}</p>}
    {editable&&!mode&&<p style={{marginTop:12}}><button className="link-button" disabled={busy} onClick={()=>repeat(o)}>Повторить заказ</button></p>}
  </div></Dialog>;
}
