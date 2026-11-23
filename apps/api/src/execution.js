import {one,rows} from './db.js';
import {ensure} from './auth.js';
import {audit,stock} from './day.js';
import {calendar} from './config.js';
import {tripStock,countedItems,recordItems,reconcileStock} from './stock-items.js';

async function ownShift(tx,user,id){
  const shift=await one(tx,`SELECT s.*,s.date::text AS date,v.capacity_kg,v.extra_kg FROM shifts s
    JOIN vehicles v ON v.id=s.vehicle_id WHERE s.id=$1 AND s.driver_id=$2`,[id,user.id]);
  ensure(shift,'Смена не найдена',404);
  return shift;
}
async function ownTrip(tx,user,id){
  const trip=await one(tx,`SELECT t.* FROM trips t JOIN shifts s ON t.shift_id=s.id WHERE t.id=$1 AND s.driver_id=$2`,[id,user.id]);
  ensure(trip,'Рейс не найден',404);
  return trip;
}
export async function confirmShift(tx,user,id,config,now){
  const shift=await ownShift(tx,user,id);
  ensure(shift.date>=calendar(config,now).today,'Смена в прошлом');
  ensure(['pending','confirmed'].includes(shift.status),'Смена уже началась');
  await tx.query("UPDATE shifts SET status='confirmed' WHERE id=$1",[id]);
  await audit(tx,user,'shift.confirmed',id);
  return {ok:true};
}
export async function startTrip(tx,user,id,input,config,now){
  const trip=await ownTrip(tx,user,id);
  const shift=await ownShift(tx,user,trip.shift_id);
  ensure(shift.date===calendar(config,now).today,'Рейс доступен для выезда в день смены');
  ensure(['confirmed','active'].includes(shift.status)&&trip.status==='planned','Рейс уже начат или смена не подтверждена');
  const previous=await one(tx,'SELECT status,actual_return FROM trips WHERE shift_id=$1 AND number<$2 ORDER BY number DESC LIMIT 1',
    [shift.id,trip.number]);
  ensure(!previous || (previous.status==='returned' && input.actual_start>=previous.actual_return),'Сначала завершите предыдущий рейс');
  ensure(input.actual_start>=shift.start_min && input.actual_start<shift.end_min,'Выезд вне рабочего интервала');
  const plan=await one(tx,'SELECT COALESCE(sum(water),0)::int AS water FROM orders WHERE trip_id=$1',[id]);
  ensure(plan.water>0 && input.water>=plan.water,'Недостаточно воды для точек рейса');
  ensure(input.water*20+shift.extra_kg<=shift.capacity_kg,'Загрузка превышает грузоподъёмность автомобиля');
  const required=await tripStock(tx,[id]);
  const {counts}=await countedItems(tx,input,required,false);
  for(const item of required) ensure((counts.get(item.product_id)??0)>=item.reserved_water,'Недостаточно воды для рейса: '+item.name);
  await tx.query("UPDATE shifts SET status='active' WHERE id=$1",[shift.id]);
  await tx.query("UPDATE trips SET status='active',actual_start=$1 WHERE id=$2",[input.actual_start,id]);
  const load=await one(tx,"INSERT INTO inventory(trip_id,kind,full_delta,empty_delta) VALUES($1,'load',$2,0) RETURNING id",[id,input.water]);
  await recordItems(tx,load.id,counts,1);
  await audit(tx,user,'trip.started',id,input);
  return {ok:true};
}
export async function deliver(tx,user,id,input){
  const order=await one(tx,`SELECT o.*,t.status AS trip_status,s.has_loader FROM orders o JOIN trips t ON o.trip_id=t.id
    JOIN shifts s ON t.shift_id=s.id WHERE o.id=$1 AND s.driver_id=$2`,[id,user.id]);
  ensure(order,'Заказ не найден',404);
  ensure(order.version===input.version,'Заказ уже изменился. Обновите маршрут');
  ensure(order.status==='assigned' && order.trip_status==='active','Подтвердить доставку можно только в активном рейсе');
  const balance=await stock(tx,order.trip_id);
  ensure(balance.water>=order.water,'Недостаточно воды на борту');
  const goods=await rows(tx,'SELECT product_id,name,water FROM order_items WHERE order_id=$1',[id]);
  const onboard=new Map((await tripStock(tx,[order.trip_id])).map(p=>[p.product_id,p.water_left]));
  ensure(goods.length>0,'В заказе отсутствует состав воды');
  for(const item of goods) ensure((onboard.get(item.product_id)??0)>=item.water,'Недостаточно воды на борту: '+item.name);
  const rate=await one(tx,'SELECT * FROM rates WHERE category=$1 AND has_loader=$2',[order.category,order.has_loader]);
  ensure(rate,'Не настроена ставка экспедитора');
  const visit=order.origin==='on_site'?order.source_order_id:order.id;
  const previous=await one(tx,`SELECT 1 FROM receipts r JOIN orders o ON o.id=r.order_id
    WHERE o.id=$1 OR (o.origin='on_site' AND o.source_order_id=$1) LIMIT 1`,[visit]);
  const stopFee=previous?0:rate.per_stop;
  const movement=await one(tx,`INSERT INTO inventory(trip_id,order_id,kind,full_delta,empty_delta,sold_shells)
    VALUES($1,$2,'delivery',$3,$4,$5) RETURNING id`,[order.trip_id,id,-order.water,input.empty,order.new_shells]);
  await recordItems(tx,movement.id,goods.map(p=>[p.product_id,p.water]),-1);
  await tx.query(`INSERT INTO receipts(order_id,amount,method,confirmed,earnings,per_stop,per_bottle)
    VALUES($1,$2,$3,$4,$5,$6,$7)`,[id,order.total,order.payment_method,input.paid,
    stopFee+rate.per_bottle*order.water,stopFee,rate.per_bottle]);
  await tx.query("UPDATE orders SET status='delivered',paid=$1,version=version+1 WHERE id=$2",[input.paid,id]);
  await audit(tx,user,'order.delivered',id,input);
  return {ok:true};
}
export async function returnTrip(tx,user,id,input){
  const trip=await ownTrip(tx,user,id);
  ensure(trip.status==='active','Рейс не выполняется');
  ensure(input.actual_return>=trip.actual_start,'Время возврата раньше выезда');
  ensure(!await one(tx,"SELECT id FROM orders WHERE trip_id=$1 AND status='assigned' LIMIT 1",[id]),'Остались незавершённые точки');
  await tx.query("UPDATE trips SET status='returned',actual_return=$1 WHERE id=$2",[input.actual_return,id]);
  await audit(tx,user,'trip.returned',id,input);
  return {ok:true};
}
export async function settle(tx,user,id,input){
  const shift=await ownShift(tx,user,id);
  ensure(shift.status==='active','Для сдачи нужна активная смена');
  ensure(!await one(tx,"SELECT id FROM trips WHERE shift_id=$1 AND status<>'returned'",[id]),'Завершите все рейсы и отметьте возврат на базу');
  ensure(shift.has_loader || input.loader_minutes===0,'В смене отсутствует грузчик');
  const goods=await one(tx,`SELECT sum(i.full_delta)::int AS water,sum(i.empty_delta)::int AS empty,
    sum(CASE WHEN kind='delivery' THEN -full_delta ELSE 0 END)::int AS delivered_water,
    sum(sold_shells)::int AS sold_shells FROM inventory i JOIN trips t ON t.id=i.trip_id WHERE t.shift_id=$1`,[id]);
  const sales=await one(tx,`SELECT count(DISTINCT CASE WHEN o.origin='on_site' THEN o.source_order_id ELSE o.id END)::int AS delivered_stops,COALESCE(sum(r.earnings),0) AS earnings,
    COALESCE(sum(amount) FILTER(WHERE confirmed AND method='cash'),0) AS cash,
    COALESCE(sum(amount) FILTER(WHERE confirmed AND method='bank'),0) AS bank,
    COALESCE(sum(amount) FILTER(WHERE NOT confirmed),0) AS unpaid FROM receipts r JOIN orders o ON r.order_id=o.id
    JOIN trips t ON o.trip_id=t.id WHERE t.shift_id=$1`,[id]);
  const expected={water:goods.water,empty:goods.empty,cash:Number(sales.cash),bank:Number(sales.bank)};
  const stockItems=await reconcileStock(tx,id,input);
  const {loader_minutes,water,empty,cash,bank}=input;
  const actual={water,empty,cash,bank};
  const difference=Object.fromEntries(Object.keys(expected).map(key=>[key,actual[key]-expected[key]]));
  const matched=Object.values(difference).every(n=>n===0) && stockItems.every(p=>p.difference===0);
  const report=await one(tx,`INSERT INTO settlements(shift_id,expected,actual,difference,matched,delivered_water,delivered_stops,
    sold_shells,earnings,unpaid,loader_minutes,stock_items) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
    [id,JSON.stringify(expected),JSON.stringify(actual),JSON.stringify(difference),matched,goods.delivered_water,
    sales.delivered_stops,goods.sold_shells,sales.earnings,sales.unpaid,loader_minutes,JSON.stringify(stockItems)]);
  await tx.query("UPDATE shifts SET status='closed' WHERE id=$1",[id]);
  await audit(tx,user,'shift.settled',id,{matched,difference});
  return {...report,driver_name:user.name};
}
