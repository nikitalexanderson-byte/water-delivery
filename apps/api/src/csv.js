const columns=[
  ['Дата',r=>r.date],['Экспедитор',r=>r.driver_name],['Автомобиль',r=>r.vehicle_name],['Смена',r=>r.shift_id],
  ['Рейсы',r=>r.trip_count],['Точки',r=>r.delivered_stops],['Розница',r=>r.retail_count],['Опт',r=>r.wholesale_count],
  ['Выдано бутылей',r=>r.delivered_water],['Продано тары',r=>r.sold_shells],['Собрано тары',r=>r.expected.empty],
  ['Возврат воды, факт',r=>r.actual.water],['Наличные, коп.',r=>r.expected.cash],['Безнал, коп.',r=>r.expected.bank],
  ['Не оплачено, коп.',r=>r.unpaid],['Разница наличных, коп.',r=>r.difference.cash],['Разница безнала, коп.',r=>r.difference.bank],
  ['Разница воды',r=>r.difference.water],['Разница тары',r=>r.difference.empty],['Начислено, коп.',r=>r.earnings],
  ['Часы грузчика',r=>(r.loader_minutes/60).toFixed(2).replace('.',',')],['Сверка',r=>r.matched?'Совпало':'Расхождение'],
  ['Проверено',r=>r.reviewed?'Да':'Нет']
];
const quote=value=>{
  let s=String(value);
  if(typeof value==='string' && /^[\s]*[=+@-]/.test(s)) s="'"+s;
  return '"'+s.replaceAll('"','""')+'"';
};
export function reportCsv(reports){
  const lines=[columns.map(([title])=>title),...reports.map(r=>columns.map(([,get])=>get(r)))];
  return '\uFEFF'+lines.map(line=>line.map(quote).join(';')).join('\r\n');
}
