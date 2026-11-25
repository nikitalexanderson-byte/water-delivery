import {one,rows} from './db.js';
import {rescheduleFailed} from './outcomes.js';
import {ensure} from './auth.js';
import {dayView,audit} from './day.js';
import {calendar} from './config.js';
import {planOrders,shiftSchedule} from './routing.js';
import {orderLines,saveLines} from './products.js';
import {currentLocations} from './tracking.js';

function consentDate(data,config,now){
  if(!data.can_deliver_today)return null;
  const {today}=calendar(config,now);
  ensure(data.date>today,'Согласие на доставку сегодня указывается при заказе на будущую дату');
  return today;
}

export async function createOrder(tx,user,data,config,now){
  const basket=await orderLines(tx,data,user.team_id);
  let customer;
  if(data.customer_id){
    customer=await one(tx,'SELECT * FROM customers WHERE id=$1 AND team_id=$2',[data.customer_id,user.team_id]);
    ensure(customer,'Клиент не найден',404);
  }else{
    customer=await one(tx,'INSERT INTO customers(name,phone,address,team_id) VALUES($1,$2,$3,$4) RETURNING *',
      [data.name,data.phone,data.address,user.team_id]);
  }
  const result=await one(tx,`INSERT INTO orders(customer_id,name,phone,address,address_verified,date,window_start,window_end,
    water,new_shells,water_price,shell_price,category,payment_method,company,floor,lift,checkpoint,height_limit_mm,note,water_subtotal,
    alt_phone,entrance,unit,intercom,access_instructions,paid_entry,latitude,longitude,parking_minutes,has_cart,can_deliver_today,early_delivery_date)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31,$32,$33) RETURNING id,total`,
    [customer.id,data.name??customer.name,data.phone??customer.phone,data.address??customer.address,data.address_verified,data.date,data.window_start,
    data.window_end,basket.water,data.new_shells,basket.water_price,config.shellPrice,data.category,data.payment_method,data.company,
    data.floor,data.lift,data.checkpoint,data.height_limit_mm??null,data.note,basket.water_subtotal,
    data.alt_phone??'',data.entrance??'',data.unit??'',data.intercom??'',data.access_instructions??'',data.paid_entry??false,
    data.latitude??null,data.longitude??null,data.parking_minutes??0,data.has_cart??false,data.can_deliver_today??false,consentDate(data,config,now)]);
  await saveLines(tx,result.id,basket.lines);
  await audit(tx,user,'order.created',result.id);
  return result;
}

async function routeTrips(tx,trips,orders,locations=[]){
  const active=trips.filter(trip=>trip.status==='active').map(trip=>trip.id);
  const last=active.length?await rows(tx,`SELECT DISTINCT ON (o.trip_id) o.trip_id,o.longitude,o.latitude
    FROM orders o JOIN audit a ON a.entity_id=o.id AND a.event IN ('order.delivered','order.failed')
    WHERE o.trip_id=ANY($1::int[]) ORDER BY o.trip_id,a.id DESC`,[active]):[];
  const origins=new Map(locations.filter(point=>!point.stale&&point.accuracy<=100)
    .map(point=>[point.trip_id,{latitude:point.lat,longitude:point.lon}]));
  return trips.map(trip=>({...trip,last_visit:last.find(visit=>visit.trip_id===trip.id),live_origin:origins.get(trip.id),
    stops:orders.filter(o=>o.trip_id===trip.id && o.origin==='office')}));
}

async function persistPlans(tx,existing,plans,config){
  for(const trip of plans){
    let entity=existing.find(t=>t.shift_id===trip.shift_id && t.number===trip.number);
    if(!entity) entity=await one(tx,'INSERT INTO trips(shift_id,number,base_address,base_lat,base_lon) VALUES($1,$2,$3,$4,$5) RETURNING id',
      [trip.shift_id,trip.number,config.address,config.lat,config.lon]);
    for(const stop of trip.stops){
      await tx.query(`UPDATE orders SET status='assigned',trip_id=$1,position=$2,eta=$3,version=version+1,reason=NULL
        WHERE id=$4 AND status IN ('pending','assigned') AND
          (trip_id IS DISTINCT FROM $1 OR position IS DISTINCT FROM $2 OR eta IS DISTINCT FROM $3)`,
        [entity.id,stop.position,stop.eta,stop.order_id]);
    }
  }
}

async function rebuildAfterRemoval(tx,shiftId,tripId,config,now,refreshActive=false){
  const empty=await one(tx,`DELETE FROM trips WHERE id=$1 AND status='planned'
    AND NOT EXISTS(SELECT 1 FROM orders WHERE trip_id=$1) RETURNING number`,[tripId]);
  if(empty){
    await tx.query("UPDATE trips SET number=number-1 WHERE shift_id=$1 AND number>$2 AND status='planned'",[shiftId,empty.number]);
  }
  await refreshShiftPlan(tx,shiftId,config,now,false,refreshActive);
}

export async function refreshShiftPlan(tx,shiftId,config,now,checkLimits=true,refreshActive=false){
  const trips=await rows(tx,'SELECT * FROM trips WHERE shift_id=$1 ORDER BY number',[shiftId]);
  if(!trips.some(trip=>trip.status==='planned'||(refreshActive&&trip.status==='active'))) return;
  const shift=await one(tx,`SELECT s.*,s.date::text AS date,v.capacity_kg,v.extra_kg,v.total_height_mm
    FROM shifts s JOIN vehicles v ON v.id=s.vehicle_id WHERE s.id=$1`,[shiftId]);
  const orders=await rows(tx,`SELECT o.* FROM orders o JOIN trips t ON o.trip_id=t.id
    WHERE t.shift_id=$1 ORDER BY t.number,o.position,o.id`,[shiftId]);
  const {today,minute}=calendar(config,now);
  const result=shiftSchedule({shift,trips:await routeTrips(tx,trips,orders),settings:config.routing,
    nowMin:shift.date===today?minute:0,checkLimits,refreshActive});
  ensure(!result.issue,'Изменение экипажа нарушает план смены. '+result.issue);
  await persistPlans(tx,trips,result.timetable,config);
}

export async function suggestAssignments(tx,user,date,config,now){
  const {today,minute}=calendar(config,now);
  ensure(date===today,'Подбор по геопозиции доступен на сегодня');
  const day=await dayView(tx,user,date,config,now,{includeCustomers:false});
  if(!day.smart_routing_enabled)return {suggestions:[],unassigned:[]};
  const orders=day.orders.filter(order=>order.status==='pending');
  if(!orders.length)return {suggestions:[],unassigned:[]};
  const locations=await currentLocations(tx,user,date,now);
  const trips=await routeTrips(tx,day.trips,day.orders,locations);
  const {suggestions,unassigned}=planOrders({orders,shifts:day.shifts,trips,settings:config.routing,
    nowMin:minute,allowActive:true,smart:true});
  return {suggestions,unassigned};
}

export async function allocate(tx,user,input,config,now){
  const {today,minute}=calendar(config,now);
  ensure(input.date>=today,'Нельзя распределить заказы на прошедший день');
  const day=await dayView(tx,user,input.date,config,now,{includeCustomers:false});
  const smart=input.suggested_trip!=null;
  if(smart)ensure(input.date===today&&day.smart_routing_enabled,'Обновите предложение. Умный подбор отключён или дата изменилась.');
  if(input.shift_id)ensure(day.shifts.some(s=>s.id===input.shift_id),'Смена не найдена на выбранную дату',404);
  let queue=day.orders.filter(o=>o.status==='pending');
  let source;
  if(input.order_id){
    const order=day.orders.find(o=>o.id===input.order_id);
    ensure(order,'Заказ не найден на выбранную дату',404);
    ensure(['pending','assigned'].includes(order.status),'Этот заказ нельзя назначить на рейс');
    if(smart)ensure(order.status==='pending','Заказ уже назначен. Обновите очередь.');
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
  const locations=smart?await currentLocations(tx,user,input.date,now):[];
  const result=planOrders({orders:queue,shifts,trips:await routeTrips(tx,trips,day.orders,locations),
    settings:config.routing,targetShiftId:input.shift_id,nowMin:input.date===today?minute:0,allowActive:input.date===today&&!source,
    smart,targetTripNumber:input.suggested_trip});
  if(smart)ensure(!result.unassigned.length,'Обновите предложение. '+(result.unassigned[0]?.reason||'Рейс больше недоступен.'));
  if(source && result.unassigned.length){
    ensure(false,'Переназначение невозможно. '+result.unassigned[0].reason);
  }
  await persistPlans(tx,trips,result.trips,config);
  if(source){
    await rebuildAfterRemoval(tx,source.shift_id,source.id,config,now);
    await audit(tx,user,'order.reassigned',input.order_id,{from_shift:source.shift_id,to_shift:input.shift_id,version:input.version});
  }else{
    const incoming=new Set(queue.map(order=>order.id));
    for(const trip of result.trips)for(const stop of trip.stops){
      if(incoming.has(stop.order_id))await audit(tx,user,'order.assigned',stop.order_id,{to_shift:trip.shift_id});
    }
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
    await one(tx,'SELECT name,phone,address FROM customers WHERE id=$1 AND team_id=$2',[data.customer_id,user.team_id]);
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
    paid_entry:data.paid_entry??order.paid_entry,parking_minutes:data.parking_minutes??order.parking_minutes,has_cart:data.has_cart??order.has_cart,
    can_deliver_today:data.can_deliver_today??order.can_deliver_today,
    early_delivery_date:data.can_deliver_today===undefined?order.early_delivery_date:consentDate(data,config,now)
  };
  const previous=await rows(tx,'SELECT product_id,name,water,water_price FROM order_items WHERE order_id=$1',[order.id]);
  const basket=await orderLines(tx,data,user.team_id,previous);
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
  const order=await one(tx,`SELECT o.*,o.date::text AS date,o.early_delivery_date::text AS early_delivery_date,t.shift_id,t.status AS trip_status
    FROM orders o JOIN customers c ON c.id=o.customer_id LEFT JOIN trips t ON t.id=o.trip_id
    WHERE o.id=$1 AND c.team_id=$2`,[id,user.team_id]);
  ensure(order,'Заказ не найден',404);
  ensure(order.version===input.version,'Заказ уже изменился. Обновите список');
  if(order.status==='failed' && action==='reschedule') return rescheduleFailed(tx,user,order,input);
  const inFlight=order.trip_status==='active'&&['manager','operator'].includes(user.role)&&['cancel','reschedule'].includes(action);
  ensure(['assigned','pending'].includes(order.status)&&(!order.trip_status||order.trip_status==='planned'||inFlight),
    'Изменение невозможно после выезда или завершения');
  if(action==='edit') return editOrder(tx,user,order,input,config,now);
  if(action==='verify-address'){
    await tx.query('UPDATE orders SET address_verified=true,reason=NULL,version=version+1 WHERE id=$1',[id]);
  }else{
    const moved=action==='reschedule';
    await tx.query(`UPDATE orders SET date=$1,window_start=$2,window_end=$3,status=$4,trip_id=NULL,position=NULL,
      eta=NULL,arrived_at=NULL,reason=NULL,version=version+1 WHERE id=$5`,
      [moved?input.date:order.date,moved?input.window_start:order.window_start,moved?input.window_end:order.window_end,
      moved?'pending':'cancelled',id]);
    if(order.trip_id) await rebuildAfterRemoval(tx,order.shift_id,order.trip_id,config,now,inFlight);
  }
  await audit(tx,user,'order.'+action,id,{version:input.version});
  return {ok:true};
}

export async function bringForward(tx,user,id,input,config,now){
  const {today,minute}=calendar(config,now);
  const order=await one(tx,`SELECT o.id,o.date::text,o.version,o.status,o.window_start,o.window_end,o.can_deliver_today,
    o.early_delivery_date::text FROM orders o JOIN customers c ON c.id=o.customer_id
    WHERE o.id=$1 AND o.origin='office' AND c.team_id=$2`,[id,user.team_id]);
  ensure(order,'Заказ не найден',404);
  ensure(order.version===input.version,'Заказ уже изменился. Обновите список');
  ensure(order.date>today&&order.status==='pending'&&order.can_deliver_today&&order.early_delivery_date===today,
    'У заказа нет действующего согласия на перенос на сегодня');
  ensure(order.window_end>minute,'Сегодня окно доставки уже закончилось');
  await changeOrder(tx,user,id,{...input,date:today,window_start:order.window_start,window_end:order.window_end},'reschedule',config,now);
  const plan=await allocate(tx,user,{date:today,order_id:id,version:input.version+1},config,now);
  ensure(plan.assigned===1,'Заказ остался на исходной дате. '+(plan.unassigned[0]?.reason||'Подходящей смены нет.'));
  await audit(tx,user,'order.brought_forward',id,{original_date:order.date,date:today});
  return {id,date:today,assigned:1};
}
