import {rows,one} from './db.js';
import {ensure} from './auth.js';
import {dayView,audit} from './day.js';
import {calendar} from './config.js';
import {planOrders} from './routing.js';

export async function createOrder(tx,user,data,config){
  let customer;
  if(data.customer_id){
    customer=await one(tx,'SELECT * FROM customers WHERE id=$1',[data.customer_id]);
    ensure(customer,'Клиент не найден',404);
  }else{
    customer=await one(tx,'INSERT INTO customers(name,phone,address) VALUES($1,$2,$3) RETURNING *',
      [data.name,data.phone,data.address]);
  }
  const result=await one(tx,`INSERT INTO orders(customer_id,name,phone,address,address_verified,date,window_start,window_end,
    water,new_shells,water_price,shell_price,category,payment_method,company,floor,lift,checkpoint,height_limit_mm,note)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20) RETURNING id,total`,
    [customer.id,customer.name,customer.phone,data.address||customer.address,data.address_verified,data.date,data.window_start,
    data.window_end,data.water,data.new_shells,data.water_price,config.shellPrice,data.category,data.payment_method,data.company,
    data.floor,data.lift,data.checkpoint,data.height_limit_mm??null,data.note]);
  await audit(tx,user,'order.created',result.id);
  return result;
}

export async function allocate(tx,user,input,config,now){
  const day=await dayView(tx,user,input.date,config,now);
  const queue=day.orders.filter(o=>o.status==='pending' && (!input.order_id||input.order_id===o.id));
  ensure(!input.order_id||queue.length,'Заказ уже назначен или относится к другой дате');
  const {today,minute}=calendar(config,now);
  ensure(input.date>=today,'Нельзя распределить заказы на прошедший день');
  const result=planOrders({orders:queue,shifts:day.shifts,
    trips:day.trips.map(t=>({...t,stops:day.orders.filter(o=>o.trip_id===t.id)})),
    settings:config.routing,targetShiftId:input.shift_id,nowMin:input.date===today?minute:0});
  for(const trip of result.trips){
    let entity=day.trips.find(t=>t.shift_id===trip.shift_id && t.number===trip.number);
    if(!entity) entity=await one(tx,'INSERT INTO trips(shift_id,number) VALUES($1,$2) RETURNING id',[trip.shift_id,trip.number]);
    for(const stop of trip.stops){
      await tx.query(`UPDATE orders SET status='assigned',trip_id=$1,position=$2,eta=$3,version=version+1,reason=NULL
        WHERE id=$4 AND (trip_id IS DISTINCT FROM $1 OR position IS DISTINCT FROM $2 OR eta IS DISTINCT FROM $3)`,
        [entity.id,stop.position,stop.eta,stop.order_id]);
    }
  }
  for(const issue of result.unassigned) await tx.query('UPDATE orders SET reason=$1 WHERE id=$2',[issue.reason,issue.order_id]);
  const assigned=queue.length-result.unassigned.length;
  await audit(tx,user,'routes.planned',null,{date:input.date,assigned,unassigned:result.unassigned});
  return {assigned,unassigned:result.unassigned};
}

export async function changeOrder(tx,user,id,input,action){
  const order=await one(tx,`SELECT o.*,t.status AS trip_status FROM orders o LEFT JOIN trips t ON t.id=o.trip_id WHERE o.id=$1`,[id]);
  ensure(order,'Заказ не найден',404);
  ensure(order.version===input.version,'Заказ уже изменился. Обновите список');
  ensure(['assigned','pending'].includes(order.status)&&(!order.trip_status||order.trip_status==='planned'),'Изменение невозможно после выезда или завершения');
  if(action==='verify-address'){
    await tx.query('UPDATE orders SET address_verified=true,reason=NULL,version=version+1 WHERE id=$1',[id]);
  }else{
    const moved=action==='reschedule';
    await tx.query(`UPDATE orders SET date=$1,window_start=$2,window_end=$3,status=$4,trip_id=NULL,position=NULL,
      eta=NULL,reason=NULL,version=version+1 WHERE id=$5`,
      [moved?input.date:order.date,moved?input.window_start:order.window_start,moved?input.window_end:order.window_end,
      moved?'pending':'cancelled',id]);
    if(order.trip_id){
      await tx.query('UPDATE orders SET position=position-1,version=version+1 WHERE trip_id=$1 AND position>$2',[order.trip_id,order.position]);
      await tx.query('DELETE FROM trips WHERE id=$1 AND NOT EXISTS(SELECT 1 FROM orders WHERE trip_id=$1)',[order.trip_id]);
      // Keep trip numbering compact when the first planned trip loses its last stop.
      await tx.query(`UPDATE trips t SET number=1 WHERE number=2 AND status='planned'
        AND NOT EXISTS(SELECT 1 FROM trips earlier WHERE earlier.shift_id=t.shift_id AND earlier.number=1)`);
    }
  }
  await audit(tx,user,'order.'+action,id,{version:input.version});
  return {ok:true};
}
