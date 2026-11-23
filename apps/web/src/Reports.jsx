import React, {useState} from 'react';
import {money, Empty, Icon} from './ui';

const categories=[['water','Полные бутыли','шт.'],['empty','Пустая тара','шт.'],['cash','Наличные','₽'],['bank','Безналичные','₽']];
const display=(n,unit)=>unit==='₽'?money(n):n+' '+unit;

export function Reports({reports,date,send,download,refresh}) {
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  async function exportDay() {
    setError('');setBusy(true);
    try {
      const blob=await download('/reports.csv?date='+date);
      const href=URL.createObjectURL(blob);
      const link=document.createElement('a');
      link.href=href;link.download='ФАРВАТЕР-'+date+'.csv';link.click();setTimeout(()=>URL.revokeObjectURL(href),3000);
    } catch(err){setError(err.message);} finally{setBusy(false);}
  }
  async function review(id) {
    setBusy(true);setError('');
    try{await send('/reports/'+id+'/review',{});refresh();}catch(err){setError(err.message);}finally{setBusy(false);}
  }
  return <><div className="summary">{[
    ['Сдано смен','report',reports.length],['Доставлено воды','water',reports.reduce((a,r)=>a+r.delivered_water,0)],
    ['Подтверждено денег','check',money(reports.reduce((a,r)=>a+r.expected.cash+r.expected.bank,0))],['С расхождениями','warn',reports.filter(r=>!r.matched).length]
  ].map(([label,icon,value])=><div className="metric" key={label}><span>{label}</span><Icon name={icon}/><strong>{value}</strong></div>)}</div>
    <section className="panel"><div className="panel-head"><h2>Сданные смены</h2><button onClick={exportDay} disabled={busy}><Icon name="download"/>Скачать CSV</button></div>
    {error&&<p className="error" role="alert">{error}</p>}
    {reports.length?<div className="queue">{reports.map(r=><article key={r.id} className="report-card"><div className="row"><h3>{r.driver_name}</h3><span className={'pill '+(r.matched?'good':'bad')}>{r.matched?'Отчёт совпал':'Отчёт не совпал'}</span>{r.reviewed&&<span className="pill">Проверено</span>}</div>
    <p className="sub">{r.delivered_stops} точек · {r.delivered_water} бут. · {r.sold_shells} ед. новой тары</p>
    <div className="table-scroll"><table><caption className="sr-only">{'Сверка смены '+r.driver_name}</caption><thead><tr>{['Показатель','Ожидалось','Сдано','Разница'].map(x=><th key={x} scope="col">{x}</th>)}</tr></thead><tbody>
    {categories.map(([key,label,unit])=><tr key={key}><th scope="row">{label}</th><td>{display(r.expected[key],unit)}</td><td>{display(r.actual[key],unit)}</td><td className={r.difference[key]?'mismatch':''}>{display(r.difference[key],unit)}</td></tr>)}</tbody></table></div>
    {r.stock_items?.length>0&&<div className="table-scroll"><table><caption className="stock-caption">Полные бутыли по брендам</caption><thead><tr>{['Бренд','Ожидалось','Сдано','Разница'].map(label=><th scope="col" key={label}>{label}</th>)}</tr></thead><tbody>{r.stock_items.map(item=><tr key={item.product_id}><th scope="row">{item.name}</th><td>{item.expected} шт.</td><td>{item.actual} шт.</td><td className={item.difference?'mismatch':''}>{item.difference} шт.</td></tr>)}</tbody></table></div>}
    <p className="sub">Вознаграждение {money(r.earnings)} · Не оплачено {money(r.unpaid)} · Грузчик {Number((r.loader_minutes/60).toFixed(2)).toLocaleString('ru-RU')} ч</p>
    {!r.matched&&!r.reviewed&&<button disabled={busy} onClick={()=>review(r.id)}>Подтвердить проверку расхождений</button>}</article>)}</div>:<Empty title="Отчётов за день пока нет" detail="Сверка появится после сдачи тары и денег экспедитором."/>}</section></>;
}
