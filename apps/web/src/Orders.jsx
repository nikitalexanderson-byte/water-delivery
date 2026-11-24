import React, { useRef, useState } from 'react';
import { Dialog, Empty, Field, Icon, money, SearchField } from './ui';
import { minuteText, orderStates, toMinutes } from './api';
import {Basket,initialBasket} from './Basket';
import {CustomerPicker} from './CustomerPicker';
import {AddressMap} from './AddressMap';

function fieldChange(update, key, checkbox = false) {
  return e => update(key, checkbox ? e.target.checked : e.target.value);
}

export function NewOrder({ date, get, products, config, send, close, saved, previous, editing=false }) {
  const [lines,setLines]=useState(()=>initialBasket(products,previous,config.water_price));
  const [form, setForm] = useState(()=>({
    customer:'new', name:'', phone:'', address:'', date, start:'09:00', end:'18:00',
    shells:'1', category:'retail',
    method:'cash', company:'', verified:false, shellSale:false, floor:'', lift:true, checkpoint:false, height:'', note:'',
    alt_phone:'',extraPhone:false,automatic:config.geocoder_enabled!==false,parking_minutes:0,has_cart:false,can_deliver_today:false,consentChanged:false,
    entrance:'',unit:'',intercom:'',access_instructions:'',paid_entry:false,
    latitude:'',longitude:'',
    ...(previous ? {
      customer:String(previous.customer_id),name:previous.name,phone:previous.phone,address:previous.address,verified:editing&&previous.address_verified, start:minuteText(previous.window_start), end:minuteText(previous.window_end),
      shells:String(previous.new_shells||1), shellSale:previous.new_shells>0,
      category:previous.category, method:previous.payment_method, company:previous.company||'', floor:previous.floor??'',
      lift:previous.lift, checkpoint:previous.checkpoint, height:previous.height_limit_mm?String(previous.height_limit_mm/1000):'', note:previous.note||'',
      alt_phone:previous.alt_phone||'',extraPhone:Boolean(previous.alt_phone),parking_minutes:previous.parking_minutes??0,
      has_cart:previous.has_cart??false,can_deliver_today:Boolean(previous.can_deliver_today&&previous.early_delivery_date===config.today&&date>config.today),
      entrance:previous.entrance||'',unit:previous.unit||'',intercom:previous.intercom||'',
      access_instructions:previous.access_instructions||'',paid_entry:previous.paid_entry||false,
      latitude:previous.latitude??'',longitude:previous.longitude??'',
    }:{})
  }));
  const [error,setError]=useState('');
  const [mapOpen,setMapOpen]=useState(false);
  const [busy,setBusy]=useState(false);
  const lastAttempt=useRef(null);
  const update=(key,v)=>setForm(f=>({...f,[key]:v}));
  const bind=(key, checkbox=false)=>({[checkbox?'checked':'value']:form[key],onChange:fieldChange(update,key,checkbox)});
  const shells = form.shellSale ? Number(form.shells) : 0;
  const waterCount=lines.reduce((sum,item)=>sum+Number(item.water),0);
  const total=lines.reduce((sum,item)=>sum+Number(item.water)*Math.round(Number(item.price)*100),shells*config.shell_price);
  function chooseCustomer(customer) {
    setMapOpen(false);
    setForm(f=>({...f,customer:String(customer?.id??'new'),name:customer?.name||'',phone:customer?.phone||'',address:customer?.address||'',verified:false,
      alt_phone:'',extraPhone:false,parking_minutes:0,has_cart:false,can_deliver_today:false,consentChanged:true,entrance:'',unit:'',intercom:'',access_instructions:'',paid_entry:false,lift:true,floor:'',checkpoint:false,height:'',note:'',latitude:'',longitude:''}));
  }
  async function submit(e) {
    e.preventDefault();
    setError('');
    if (form.start >= form.end) { setError('Конец окна должен быть позже начала.'); return; }
    if((form.latitude==='')!==(form.longitude==='')){setError('Укажите широту и долготу вместе или очистите оба поля.');return;}
    const allowed=line=>products.some(p=>p.id===line.product_id&&p.active)||(editing&&previous.items.some(i=>i.product_id===line.product_id&&i.water===Number(line.water)&&i.water_price===Math.round(Number(line.price)*100)));
    if(lines.some(line=>!allowed(line))){
      setError('Выберите доступный бренд для каждой позиции.');return;
    }
    setBusy(true);
    try {
      const payload={
        name:form.name.trim(),phone:form.phone.trim(),
        ...(form.customer!=='new'?{customer_id:Number(form.customer)}:{}),
        address:form.address.trim(), date:form.date, window_start:toMinutes(form.start), window_end:toMinutes(form.end),
        items:lines.map(line=>({product_id:line.product_id,water:Number(line.water),water_price:Math.round(Number(line.price)*100)})),
        new_shells:shells,
        category:form.category,payment_method:form.method,company:form.method==='bank'?form.company.trim():'',
        address_verified:form.verified,lift:form.lift,checkpoint:form.checkpoint,note:form.note.trim(),
        alt_phone:form.extraPhone?form.alt_phone.trim():'',parking_minutes:Number(form.parking_minutes),has_cart:form.has_cart,
        ...(!editing||form.consentChanged||form.date!==previous.date?{can_deliver_today:form.date>config.today&&form.can_deliver_today}:{}),
        entrance:form.entrance.trim(),unit:form.unit.trim(),intercom:form.intercom.trim(),
        access_instructions:form.access_instructions.trim(),paid_entry:form.paid_entry,
        latitude:form.latitude===''?null:Number(form.latitude),longitude:form.longitude===''?null:Number(form.longitude),
        ...(form.floor!==''?{floor:Number(form.floor)}:{}), height_limit_mm:form.height!==''?Math.round(Number(form.height)*1000):null,
        ...(editing?{version:previous.version}:{}),
      };
      const signature=JSON.stringify(payload);
      if(lastAttempt.current?.signature!==signature)lastAttempt.current={signature,key:crypto.randomUUID()};
      const order=await send(editing?'/orders/'+previous.id:'/orders',payload,editing?'PATCH':'POST',lastAttempt.current.key);
      let note='Заказ №' + order.id + ' добавлен в очередь.';
      if(editing)note=order.released_assignment?'Заказ изменён и снят с рейса. Распределите его заново.':order.changed?'Изменения заказа сохранены.':'Данные заказа не изменились.';
      saved(form.date,note);
    } catch(err) { setError(err.message); } finally {setBusy(false);}
  }
  return <Dialog className="order-editor" title={editing?'Редактирование заказа №'+previous.id:'Новый заказ'} close={()=>{if(!busy) close();}}>
    <form onSubmit={submit}>{editing&&previous.status==='assigned'&&<p className="notice editor-warning">После изменения заказ вернётся в очередь. Назначьте его на рейс заново.</p>}
    <div className="form-body editor-grid"><div>
      <fieldset><legend>Клиент и адрес</legend><div className="form-grid">
        <CustomerPicker get={get} selected={form.customer==='new'?null:{name:form.name,phone:form.phone}} onChoose={chooseCustomer} allowNew={!editing}/>
        {(form.customer==='new'||editing) && <><Field label="Имя или организация"><input {...bind('name')} required maxLength={120}/></Field><Field label="Телефон"><input {...bind('phone')} required type="tel" minLength={6} maxLength={24}/></Field></>}
        <label className="check wide"><input type="checkbox" {...bind('extraPhone',true)}/>Дополнительный номер</label>
        {form.extraPhone&&<Field label="Дополнительный телефон" wide><input {...bind('alt_phone')} type="tel" required minLength={6} maxLength={24}/></Field>}
        <Field label="Адрес доставки" wide><input value={form.address} onChange={e=>{setMapOpen(false);setForm(f=>({...f,address:e.target.value,verified:false,latitude:'',longitude:''}));}} required maxLength={300}/></Field>
        {config.geocoder_enabled!==false&&<label className="check wide"><input type="checkbox" checked={form.automatic} onChange={e=>{update('automatic',e.target.checked);setMapOpen(false);}}/>Автоопределение адреса</label>}
        <div className="wide"><button type="button" aria-expanded={mapOpen} onClick={()=>setMapOpen(v=>!v)}><Icon name="pin"/>{form.latitude!==''?'Уточнить точку на карте':'Выбрать точку на карте'}</button>
          {mapOpen&&<AddressMap config={config} automatic={form.automatic} address={form.address} get={get} latitude={form.latitude} longitude={form.longitude} close={()=>setMapOpen(false)} save={p=>{
            setForm(f=>({...f,latitude:Number(p.lat.toFixed(6)),longitude:Number(p.lon.toFixed(6)),address:p.label||f.address.trim(),verified:false}));setMapOpen(false);
          }}/>}</div>
        <label className="check wide"><input type="checkbox" {...bind('verified',true)}/>Адрес проверен для тестового маршрута</label>
      </div><details><summary>Этаж, въезд и инструкции</summary><div className="form-grid">
        <Field label="Парковка, мин"><input type="number" {...bind('parking_minutes')} min="0" max="120" step="1" required/></Field>
        <label className="check"><input type="checkbox" {...bind('has_cart',true)}/>Есть тележка</label>
        <Field label="Подъезд"><input {...bind('entrance')} maxLength={40}/></Field>
        <Field label="Квартира или офис"><input {...bind('unit')} maxLength={40}/></Field>
        <Field label="Домофон и код" wide><input {...bind('intercom')} maxLength={80}/></Field>
        <Field label="Этаж"><input type="number" {...bind('floor')} min="-5" max="150" step="1"/></Field>
        <Field label="Ограничение въезда, м"><input type="number" {...bind('height')} step="0.001" min="0.001" max="15"/></Field>
        <label className="check"><input type="checkbox" {...bind('lift',true)}/>Есть лифт</label>
        <label className="check"><input type="checkbox" {...bind('checkpoint',true)}/>Нужен пропуск на КПП</label>
        <label className="check wide"><input type="checkbox" {...bind('paid_entry',true)}/>Платный въезд</label>
        <Field label="Как войти или подъехать" wide><textarea {...bind('access_instructions')} rows="2" maxLength={1000}/></Field>
        <Field label="Инструкции экспедитору" wide><textarea {...bind('note')} rows="2" maxLength={500}/></Field>
      </div></details><details><summary>Координаты для карты</summary><div className="form-grid">
        <Field label="Широта"><input type="number" {...bind('latitude')} min="-90" max="90" step="any"/></Field>
        <Field label="Долгота"><input type="number" {...bind('longitude')} min="-180" max="180" step="any"/></Field>
      </div></details></fieldset>
      <fieldset><legend>Время доставки</legend><div className="form-grid">
        <Field label="Дата доставки" wide><input type="date" value={form.date} onChange={e=>{const next=e.target.value;setForm(f=>({...f,date:next,can_deliver_today:next>config.today&&f.can_deliver_today}));}} required/></Field>
        {form.date>config.today&&<label className="check wide"><input type="checkbox" checked={form.can_deliver_today}
          onChange={e=>{const checked=e.target.checked;setForm(f=>({...f,can_deliver_today:checked,consentChanged:true}));}}/>Можно доставить сегодня</label>}
        <Field label="Принимают с"><input type="time" {...bind('start')} required/></Field><Field label="Принимают до"><input type="time" {...bind('end')} required/></Field>
      </div></fieldset>
      </div><div><fieldset><legend>Состав заказа</legend><Basket lines={lines} setLines={setLines} products={products}/>
      <div className="form-grid">
        <label className="check wide"><input type="checkbox" {...bind('shellSale',true)}/>Тары у клиента нет · добавить новую тару</label>
        {form.shellSale && <Field label={'Новая тара по '+money(config.shell_price)+', шт.'} wide><input type="number" {...bind('shells')} required min="1" max={waterCount} step="1"/></Field>}
        <Field label="Категория"><select {...bind('category')}><option value="retail">Розница</option><option value="wholesale">Опт</option></select></Field>
        <Field label="Способ оплаты"><select {...bind('method')}><option value="cash">Наличные</option><option value="bank">Безналичный расчёт</option></select></Field>
        {form.method==='bank'&&<Field label="Название компании" wide><input {...bind('company')} required maxLength="160"/></Field>}
      </div></fieldset>
    </div></div>{error&&<p className="error" role="alert">{error}</p>}
    <div className="dialog-footer"><div><small>Итого к оплате · <span className="measure">{waterCount} бут.</span></small><strong className="measure" aria-live="polite">{money(total)}</strong></div><button type="submit" className="primary" disabled={busy||(!editing&&!products.some(p=>p.active))}>{busy?'Сохраняем…':editing?'Сохранить изменения':'Создать заказ'}</button></div>
    </form></Dialog>;
}

export function Status({status}) {
  const style={pending:'wait',assigned:'assigned',delivered:'good',failed:'bad',cancelled:''}[status];
  return <span className={'pill order-status '+style}><i aria-hidden="true"/>{orderStates[status]||status}</span>;
}

export function Journal({day,onOpen,onRoutes}) {
  const {orders,shifts}=day;
  const [query,setQuery]=useState('');
  const [filter,setFilter]=useState('');
  const search=query.trim().toLocaleLowerCase('ru');
  const visible=orders.filter(o=>(!filter||o.status===filter)&&(!search||[o.name,o.address,o.phone,String(o.id)].some(v=>String(v||'').toLocaleLowerCase('ru').includes(search))));
  const counts=Object.fromEntries(Object.keys(orderStates).map(s=>[s,orders.filter(o=>o.status===s).length]));
  const active=orders.filter(o=>o.status!=='cancelled');
  const issues=orders.filter(o=>o.status==='failed'||(o.status==='pending'&&(o.reason||!o.address_verified)));
  return <>
    <section className="order-overview" aria-label="Сводка заказа за день">
      <div className="progress-summary"><div className="stat-label">Выполнение заказов</div><strong>{counts.delivered}<small> / {active.length}</small></strong>
        <div className="completion-bar" role="img" aria-label={'Доставлено '+counts.delivered+' из '+active.length}>{['delivered','assigned','pending','failed'].filter(k=>counts[k]).map(k=><i key={k} className={'bar-'+k} style={{flex:counts[k]}}/>)}</div>
        <div className="bar-key"><span>Доставлено</span><span>Назначено</span><span>В очереди</span>{counts.failed>0&&<span>Срыв</span>}</div>
      </div>
      <div className="volume-stat"><span className="stat-label"><Icon name="water"/>Объём воды</span><strong className="measure">{active.reduce((s,o)=>s+o.water,0)} <small>бут.</small></strong><small>Бутыли по 19 л</small></div>
      <div className="value-stat"><span className="stat-label"><Icon name="orders"/>Сумма заказов</span><strong className="measure">{money(active.reduce((s,o)=>s+Number(o.total),0))}</strong><small>Вода и новая тара</small></div>
    </section>
    <div className="journal-layout"><section className="panel journal"><header className="panel-head"><h2>Журнал заказов <span>{orders.length}</span></h2>
      <SearchField label="Поиск по заказам" placeholder="Имя, адрес или номер" value={query} onChange={e=>setQuery(e.target.value)}/>
    </header><div className="filter-bar" role="group" aria-label="Статус заказа">
      {[['','Все'],['pending','В очереди'],['assigned','Назначены'],['delivered','Доставлены'],...['failed','cancelled'].filter(k=>counts[k]>0||filter===k).map(k=>[k,orderStates[k]])].map(([k,label])=><button key={k} aria-pressed={filter===k} onClick={()=>setFilter(k)}>{label}<span>{k?counts[k]:orders.length}</span></button>)}
    </div>
    {visible.length ? <div className="table-scroll"><table className="journal-table"><caption className="sr-only">Заказы за выбранный день</caption><thead><tr>{['Заказ','Клиент и адрес','Окно','Вода','Сумма','Статус'].map(s=><th key={s} scope="col">{s}</th>)}</tr></thead>
    <tbody>{visible.map(o=><tr key={o.id}>
      <td><button className="order-id" onClick={()=>onOpen(o.id)} aria-label={'Открыть заказ №'+o.id}>№ {o.id}</button>{o.origin==='on_site'&&<small>На месте</small>}</td>
      <td><strong>{o.name}</strong><small>{o.address}</small></td><td className="nowrap" data-label="Окно">{minuteText(o.window_start)}–{minuteText(o.window_end)}</td>
      <td data-label="Вода"><span className="measure">{o.water} шт.</span></td><td className="nowrap" data-label="Сумма"><span className="measure">{money(o.total)}</span></td><td><Status status={o.status}/></td>
    </tr>)}</tbody></table></div>:<Empty title={orders.length?'Заказы не найдены':'Заказов на этот день пока нет'} detail={orders.length?'Измените поиск или выберите другой статус.':null}/>}
    </section>
    <aside className="journal-rail"><section className="panel issues-box"><header className="panel-head"><h2><Icon name="warn"/>На контроле <span>{issues.length}</span></h2></header>
      {issues.length?<ul>{issues.slice(0,4).map(o=><li key={o.id}><button onClick={()=>onOpen(o.id)}><strong>№ {o.id} · {o.name}</strong><small>{o.failure_reason||o.reason||'Адрес ожидает подтверждения'}</small></button></li>)}</ul>:<p className="sub rail-empty">Заказов с отмеченными проблемами нет.</p>}
      {issues.length>4&&<button className="link-button" onClick={onRoutes}>Открыть очередь</button>}
    </section><section className="fleet-brief"><header><Icon name="truck"/><h2>Смены экспедиторов</h2></header><strong>{shifts.filter(s=>s.status!=='pending').length} <span>из {shifts.length}</span></strong><p>подтвердили выход</p>
      <button onClick={onRoutes}>Перейти к маршрутам <Icon name="arrow"/></button></section></aside>
    </div></>;
}
export function OrderDetail({ order, trip, shift, shifts, canPlan, editable, send, close, saved, repeat, edit }) {
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
  const items=o.items?.length?o.items:[{name:'Вода',water:o.water,water_price:o.water_price}];
  const rows=[['Клиент',o.name],['Телефон',o.phone],['Адрес',o.address],['Принимают',minuteText(o.window_start)+'–'+minuteText(o.window_end)],
    ...items.map(i=>[i.name,<span className="measure">{i.water} × {money(i.water_price)} = {money(i.water*i.water_price)}</span>]),
    ['Новая тара',<span className="measure">{o.new_shells} × {money(o.shell_price)}</span>],['Итого',<strong className="measure">{money(o.total)}</strong>],['Оплата',o.payment_method==='bank'?'Безналичный расчёт · '+o.company:'Наличные'],['Адрес проверен',o.address_verified?'Да':'Требует проверки'],['Экспедитор',shift?.driver_name],['Рейс',trip?.number],['Этаж',o.floor],['КПП',o.checkpoint?'Нужен пропуск':null],['Высота въезда',o.height_limit_mm?o.height_limit_mm/1000+' м':null],['Инструкции',o.note],['Причина в очереди',o.reason]];
  rows.push(['Источник',o.origin==='on_site'?'Продажа у клиента':null],['Причина срыва',o.failure_reason]);
  if(o.arrived_at)rows.push(['Прибытие','Экспедитор отметил прибытие']);
  rows.push(['Дополнительный телефон',o.alt_phone],['Парковка',o.parking_minutes?o.parking_minutes+' мин':null],['Тележка',o.has_cart?'Есть':null],
    ['Согласован досрочный приезд',o.can_deliver_today?o.early_delivery_date:null],['Подъезд',o.entrance],['Квартира или офис',o.unit],
    ['Домофон и код',o.intercom],['Как войти или подъехать',o.access_instructions],['Платный въезд',o.paid_entry?'Да':null]);
  if(o.latitude!=null&&o.longitude!=null)rows.push(['Координаты',[o.latitude,o.longitude].join(', ')]);
  const canChange=editable&&['pending','assigned'].includes(o.status)&&(!trip||trip.status==='planned');
  const canRemove=canChange||(canPlan&&o.status==='assigned'&&trip?.status==='active');
  const canReschedule=canRemove||(editable&&o.status==='failed'&&!o.rescheduled_to);
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
    {canChange&&!mode&&<p className="edit-action"><button className="primary" disabled={busy} onClick={()=>edit(o)}>Редактировать заказ</button></p>}
    {canPlan&&o.status==='assigned'&&trip?.status==='planned'&&!mode&&<details className="change-shift"><summary>Сменить экспедитора</summary>
      {alternatives.length?<form className="actions" onSubmit={reassign}><Field label="Другая подтверждённая смена"><select required value={newShift} onChange={e=>setNewShift(e.target.value)}><option value="">Выберите экспедитора</option>{alternatives.map(s=><option key={s.id} value={s.id}>{s.driver_name} · {minuteText(s.start_min)}–{minuteText(s.end_min)}</option>)}</select></Field>
      <button disabled={busy||!newShift}>Передать заказ</button></form>:<p className="sub">На эту дату пока нет другой подтверждённой смены.</p>}
    </details>}
    {canReschedule&&!mode&&<div className="actions">{o.status==='pending'&&!o.address_verified&&<button className="primary" disabled={busy} onClick={verify}>Подтвердить адрес</button>}<button disabled={busy} onClick={()=>setMode('reschedule')}>Перенести заказ</button>{canRemove&&<button disabled={busy} onClick={()=>setMode('cancel')}>Отменить заказ</button>}</div>}
    {mode&&<form onSubmit={submit}><fieldset><legend>{mode==='reschedule'?'Новое время доставки':'Подтвердите отмену заказа'}</legend>{mode==='reschedule'?<div className="form-grid"><Field label="Новая дата" wide><input type="date" required value={date} onChange={e=>setDate(e.target.value)}/></Field><Field label="Начало окна"><input type="time" required value={start} onChange={e=>setStart(e.target.value)}/></Field><Field label="Конец окна"><input type="time" value={end} required onChange={e=>setEnd(e.target.value)}/></Field></div>:<p>Заказ исчезнет из очереди распределения, запись сохранится в журнале.</p>}</fieldset>
    <div className="actions"><button disabled={busy} className="primary">{mode==='reschedule'?'Сохранить перенос':'Подтвердить отмену'}</button><button disabled={busy} type="button" onClick={()=>{setMode('');setError('');}}>Назад</button></div></form>}
    {error&&<p role="alert" className="error">{error}</p>}
    {editable&&!mode&&<p style={{marginTop:12}}><button className="link-button" disabled={busy} onClick={()=>repeat(o)}>Повторить заказ</button></p>}
  </div></Dialog>;
}
