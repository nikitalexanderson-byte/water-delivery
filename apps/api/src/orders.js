import {one,rows} from './db.js';
import {rescheduleFailed} from './outcomes.js';
import {ensure} from './auth.js';
import {dayView,audit} from './day.js';
import {calendar} from './config.js';
import {planOrders,retimeShift} from './routing.js';
import {orderLines,saveLines} from './products.js';

export async function createOrder(tx,user,data,config){
  const basket=await orderLines(tx,data);
  let customer;
  if(data.customer_id){
    customer=await one(tx,'SELECT * FROM customers WHERE id=$1',[data.customer_id]);
    ensure(customer,'Клиент не найден',404);
  }else{
    customer=await one(tx,'INSERT INTO customers(name,phone,address) VALUES($1,$2,$3) RETURNING *',
      [data.name,data.phone,data.address]);
  }
  const result=await one(tx,`INSERT INTO orders(customer_id,name,phone,address,address_verified,date,window_start,window_end,
    water,new_shells,water_price,shell_price,category,payment_method,company,floor,lift,checkpoint,height_limit_mm,note,water_subtotal,
    alt_phone,entrance,unit,intercom,access_instructions,paid_entry,latitude,longitude)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29) RETURNING id,total`,
    [customer.id,data.name??customer.name,data.phone??customer.phone,data.address??customer.address,data.address_verified,data.date,data.window_start,
    data.window_end,basket.water,data.new_shells,basket.water_price,config.shellPrice,data.category,data.payment_method,data.company,
    data.floor,data.lift,data.checkpoint,data.height_limit_mm??null,data.note,basket.water_subtotal,
    data.alt_phone??'',data.entrance??'',data.unit??'',data.intercom??'',data.access_instructions??'',data.paid_entry??false,
    data.latitude??null,data.longitude??null]);
  await saveLines(tx,result.id,basket.lines);
  await audit(tx,user,'order.created',result.id);
  return result;
}

function routeTrips(trips,orders){
  return trips.map(trip=>({...trip,stops:orders.filter(o=>o.trip_id===trip.id && o.origin==='office' && o.status!=='failed')}));
}

async function persistPlans(tx,existing,plans){
  for(const trip of plans){
    let entity=existing.find(t=>t.shift_id===trip.shift_id && t.number===trip.number);
    if(!entity) entity=await one(tx,'INSERT INTO trips(shift_id,number) VALUES($1,$2) RETURNING id',[trip.shift_id,trip.number]);
    for(const stop of trip.stops){
      await tx.query(`UPDATE orders SET status='assigned',trip_id=$1,position=$2,eta=$3,version=version+1,reason=NULL
        WHERE id=$4 AND (trip_id IS DISTINCT FROM $1 OR position IS DISTINCT FROM $2 OR eta IS DISTINCT FROM $3)`,
        [entity.id,stop.position,stop.eta,stop.order_id]);
    }
  }
}

async function rebuildAfterRemoval(tx,shiftId,tripId,config,now){
  const empty=await one(tx,`DELETE FROM trips WHERE id=$1 AND status='planned'
    AND NOT EXISTS(SELECT 1 FROM orders WHERE trip_id=$1) RETURNING number`,[tripId]);
  if(empty){
    await tx.query("UPDATE trips SET number=number-1 WHERE shift_id=$1 AND number>$2 AND status='planned'",[shiftId,empty.number]);
  }
  const trips=await rows(tx,'SELECT * FROM trips WHERE shift_id=$1 ORDER BY number',[shiftId]);
  if(!trips.some(trip=>trip.status==='planned')) return;
  const shift=await one(tx,'SELECT s.*,s.date::text AS date FROM shifts s WHERE id=$1',[shiftId]);
  const orders=await rows(tx,`SELECT o.* FROM orders o JOIN trips t ON o.trip_id=t.id
    WHERE t.shift_id=$1 ORDER BY t.number,o.position,o.id`,[shiftId]);
  const {today,minute}=calendar(config,now);
  const plans=retimeShift({shift,trips:routeTrips(trips,orders),settings:config.routing,nowMin:shift.date===today?minute:0});
  await persistPlans(tx,trips,plans);
}

export async function allocate(tx,user,input,config,now){
  const {today,minute}=calendar(config,now);
  ensure(input.date>=today,'Нельзя распределить заказы на прошедший день');
  const day=await dayView(tx,user,input.date,config,now,{includeCustomers:false});
  let queue=day.orders.filter(o=>o.status==='pending');
  let source;
  if(input.order_id){
    const order=day.orders.find(o=>o.id===input.order_id);
    ensure(order,'Заказ не найден на выбранную дату',404);
    ensure(['pending','assigned'].includes(order.status),'Этот заказ нельзя назначить на рейс');
    if(order.status==='assigned' || input.version!==undefined){
      ensure(order.version===input.version,'Версия заказа изменилась. Обновите список и повторите назначение');
    }
    if(order.status==='assigned'){
      source=day.trips.find(t=>t.id===order.trip_id);
      ensure(source?.status==='planned','Переназначение возможно только до выезда');
      ensure(source.shift_id!==input.shift_id,'Заказ уже в выбранной смене');
    }
    queue=[order];
  }
  // Исключаем исходную смену из подбора. До получения допустимого плана
  // назначения, версии и ETA исходного маршрута остаются прежними.
  const shifts=input.shift_id?day.shifts.filter(s=>s.id===input.shift_id):day.shifts;
  const trips=input.shift_id?day.trips.filter(t=>t.shift_id===input.shift_id):day.trips;
  const result=planOrders({orders:queue,shifts,trips:routeTrips(trips,day.orders),
    settings:config.routing,targetShiftId:input.shift_id,nowMin:input.date===today?minute:0});
  if(source && result.unassigned.length){
    ensure(false,'Переназначение невозможно. '+result.unassigned[0].reason);
  }
  await persistPlans(tx,trips,result.trips);
  if(source){
    await rebuildAfterRemoval(tx,source.shift_id,source.id,config,now);
    await audit(tx,user,'order.reassigned',input.order_id,{from_shift:source.shift_id,to_shift:input.shift_id,version:input.version});
  }
  for(const issue of result.unassigned) await tx.query('UPDATE orders SET reason=$1 WHERE id=$2',[issue.reason,issue.order_id]);
  const assigned=queue.length-result.unassigned.length;
  await audit(tx,user,'routes.planned',null,{date:input.date,assigned,unassigned:result.unassigned});
  return {assigned,unassigned:result.unassigned};
}

async function editOrder(tx,user,order,data,config,now){
  // Контакты и адрес в заказе — снимок на момент звонка. При выборе другого
  // клиента его карточка задаёт значения по умолчанию для нового снимка.
  const contact=data.customer_id===order.customer_id?order:
    await one(tx,'SELECT name,phone,address FROM customers WHERE id=$1',[data.customer_id]);
  ensure(contact,'Клиент не найден',404);
  const address=data.address??contact.address;
  // Сохранённая отметка относится только к тому адресу, с которым она введена.
  const retainPoint=data.latitude===undefined && address===order.address;
  const fields={
    customer_id:data.customer_id,name:data.name??contact.name,phone:data.phone??contact.phone,
    address,address_verified:data.address_verified,date:data.date,
    latitude:retainPoint?order.latitude:data.latitude??null,longitude:retainPoint?order.longitude:data.longitude??null,
    window_start:data.window_start,window_end:data.window_end,new_shells:data.new_shells,category:data.category,
    payment_method:data.payment_method,company:data.company,floor:data.floor,lift:data.lift,checkpoint:data.checkpoint,
    height_limit_mm:data.height_limit_mm??null,note:data.note,
    alt_phone:data.alt_phone??order.alt_phone,entrance:data.entrance??order.entrance,unit:data.unit??order.unit,
    intercom:data.intercom??order.intercom,access_instructions:data.access_instructions??order.access_instructions,
    paid_entry:data.paid_entry??order.paid_entry
  };
  const previous=await rows(tx,'SELECT product_id,name,water,water_price FROM order_items WHERE order_id=$1',[order.id]);
  const basket=await orderLines(tx,data,previous);
  const oldLines=new Map(previous.map(line=>[line.product_id,line]));
  const basketChanged=previous.length!==basket.lines.length || basket.lines.some(line=>{
    const old=oldLines.get(line.product_id);
    return !old || old.water!==line.water || old.water_price!==line.water_price;
  });
  const changed=Object.keys(fields).filter(key=>fields[key]!==order[key]);
  if(!changed.length && !basketChanged){
    return {id:order.id,total:order.total,version:order.version,status:order.status,released_assignment:false,changed:false};
  }
  if(basketChanged){
    Object.assign(fields,{water:basket.water,water_subtotal:basket.water_subtotal,water_price:basket.water_price});
    await tx.query('DELETE FROM order_items WHERE order_id=$1',[order.id]);
    await saveLines(tx,order.id,basket.lines);
    changed.push('items');
  }
  // Ключи fields заданы выше. Значения из формы всегда передаются параметрами.
  const assignments=Object.keys(fields).map((field,i)=>field+'=$'+(i+2));
  const updated=await one(tx,`UPDATE orders SET ${assignments.join(',')},version=version+1,status='pending',
    reason=NULL,trip_id=NULL,position=NULL,eta=NULL WHERE id=$1 RETURNING id,total,version,status`,[order.id,...Object.values(fields)]);
  if(order.trip_id) await rebuildAfterRemoval(tx,order.shift_id,order.trip_id,config,now);
  await audit(tx,user,'order.edited',order.id,{changed,previous_version:order.version,previous_trip_id:order.trip_id,
    previous_total:order.total,total:updated.total});
  return {...updated,released_assignment:order.trip_id!==null,changed:true};
}

export async function changeOrder(tx,user,id,input,action,config,now){
  const order=await one(tx,`SELECT o.*,o.date::text AS date,t.shift_id,t.status AS trip_status
    FROM orders o LEFT JOIN trips t ON t.id=o.trip_id WHERE o.id=$1`,[id]);
  ensure(order,'Заказ не найден',404);
  ensure(order.version===input.version,'Заказ уже изменился. Обновите список');
  if(order.status==='failed' && action==='reschedule') return rescheduleFailed(tx,user,order,input);
  ensure(['assigned','pending'].includes(order.status)&&(!order.trip_status||order.trip_status==='planned'),'Изменение невозможно после выезда или завершения');
  if(action==='edit') return editOrder(tx,user,order,input,config,now);
  if(action==='verify-address'){
    await tx.query('UPDATE orders SET address_verified=true,reason=NULL,version=version+1 WHERE id=$1',[id]);
  }else{
    const moved=action==='reschedule';
    await tx.query(`UPDATE orders SET date=$1,window_start=$2,window_end=$3,status=$4,trip_id=NULL,position=NULL,
      eta=NULL,reason=NULL,version=version+1 WHERE id=$5`,
      [moved?input.date:order.date,moved?input.window_start:order.window_start,moved?input.window_end:order.window_end,
      moved?'pending':'cancelled',id]);
    if(order.trip_id) await rebuildAfterRemoval(tx,order.shift_id,order.trip_id,config,now);
  }
  await audit(tx,user,'order.'+action,id,{version:input.version});
  return {ok:true};
}
