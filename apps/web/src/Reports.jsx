import React, {useState} from 'react';
import {money, Empty, Icon} from './ui';
import {isAndroidOffice} from './api';

const categories=[['water','Полные бутыли','шт.'],['empty','Пустая тара','шт.'],['cash','Наличные','₽'],['bank','Безналичные','₽']];
const display=(n,unit)=>unit==='₽'?money(n):n+' '+unit;

export function Reports({reports,date,send,download,refresh}) {
  const [busy,setBusy]=useState(false);
  const [selectedId,setSelectedId]=useState(()=>reports.find(r=>!r.reviewed&&!r.matched)?.id??reports[0]?.id);
  const [error,setError]=useState('');
  async function exportDay() {
    if(isAndroidOffice()){
      window.location.assign('/__farvater_android/report?date='+encodeURIComponent(date));
      return;
    }
    setError('');setBusy(true);
    try {
      const blob=await download('/reports.csv?date='+date);
      const href=URL.createObjectURL(blob);
      const link=document.createElement('a');
      link.href=href;link.download='WaySlate-'+date+'.csv';link.click();setTimeout(()=>URL.revokeObjectURL(href),3000);
    } catch(err){setError(err.message);} finally{setBusy(false);}
  }
  async function review(id) {
    setBusy(true);setError('');setSelectedId(id);
    try{await send('/reports/'+id+'/review',{});refresh();}catch(err){setError(err.message);}finally{setBusy(false);}
  }
  const selected=reports.find(r=>r.id===selectedId)||reports.find(r=>!r.reviewed&&!r.matched)||reports[0];
  return <><section className="reports-head panel"><div><h2>Сверка смен</h2><small>Итоги сдачи воды, тары и денег</small></div><button onClick={exportDay} disabled={busy}><Icon name="download"/>Скачать CSV</button></section>
    {error&&<p className="error" role="alert">{error}</p>}
    {reports.length?<><dl className="report-totals">
      <div><dt>Сдано смен</dt><dd>{reports.length}</dd></div><div><dt>Доставлено воды</dt><dd className="measure">{reports.reduce((a,r)=>a+r.delivered_water,0)} бут.</dd></div>
      <div><dt>Подтверждено денег</dt><dd className="measure">{money(reports.reduce((a,r)=>a+r.expected.cash+r.expected.bank,0))}</dd></div><div><dt>Ожидают проверки</dt><dd>{reports.filter(r=>!r.matched&&!r.reviewed).length}</dd></div></dl>
    <div className="report-layout"><section className="panel report-shifts"><header className="panel-head"><h2>Сданные смены</h2></header>
    {reports.map(r=><button key={r.id} aria-pressed={selected?.id===r.id} onClick={()=>setSelectedId(r.id)}><strong>{r.driver_name}</strong>
      <small>{r.matched?'Совпало':r.reviewed?'Проверено ответственным':'Расхождение'} · {r.delivered_stops} точек</small></button>)}</section>
    <article className="report-card panel"><header className="trip-head"><div><h2>{selected.driver_name}</h2><small>{selected.delivered_stops} точек · <span className="measure">{selected.delivered_water} бут.</span> · <span className="measure">{selected.sold_shells} ед.</span> новой тары</small></div>
      <span className={'pill '+(selected.matched?'good':'bad')}>{selected.matched?'Отчёт совпал':'Отчёт не совпал'}</span></header>
    <div className="table-scroll"><table><caption className="sr-only">{'Сверка смены '+selected.driver_name}</caption><thead><tr>{['Показатель','Ожидалось','Сдано','Разница'].map(x=><th key={x} scope="col">{x}</th>)}</tr></thead><tbody>
    {categories.map(([key,label,unit])=><tr key={key}><th scope="row">{label}</th><td className="measure">{display(selected.expected[key],unit)}</td><td className="measure">{display(selected.actual[key],unit)}</td><td className={selected.difference[key]?'mismatch':'measure'}>{display(selected.difference[key],unit)}</td></tr>)}</tbody></table></div>
    {selected.stock_items?.length>0&&<div className="table-scroll"><table><caption className="stock-caption">Полные бутыли по брендам</caption><thead><tr>{['Бренд','Ожидалось','Сдано','Разница'].map(label=><th scope="col" key={label}>{label}</th>)}</tr></thead><tbody>{selected.stock_items.map(item=><tr key={item.product_id}><th scope="row">{item.name}</th><td className="measure">{item.expected} шт.</td><td className="measure">{item.actual} шт.</td><td className={item.difference?'mismatch':'measure'}>{item.difference} шт.</td></tr>)}</tbody></table></div>}
    <p className="sub">Вознаграждение <span className="measure">{money(selected.earnings)}</span> · Не оплачено <span className="measure">{money(selected.unpaid)}</span> · Грузчик {Number((selected.loader_minutes/60).toFixed(2)).toLocaleString('ru-RU')} ч</p>
    {selected.reviewed&&<span className="pill good">Проверено</span>}
    {selected.export_status&&<p role="status">Google Таблицы · {{pending:'в очереди',sent:'отчёт передан',retry:'отправка будет повторена'}[selected.export_status]}</p>}
    {!selected.matched&&!selected.reviewed&&<button className="primary" disabled={busy} onClick={()=>review(selected.id)}>Подтвердить проверку расхождений</button>}
    </article></div></>:<section className="panel"><Empty title="Отчётов за день пока нет" detail="Сверка появится после сдачи тары и денег экспедитором."/></section>}</>;
}
