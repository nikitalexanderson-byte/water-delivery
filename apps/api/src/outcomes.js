import {one} from './db.js';
import {ensure} from './auth.js';
import {audit,stock} from './day.js';
import {deliver} from './execution.js';
import {tripStock} from './stock-items.js';
import {orderLines,saveLines} from './products.js';

export async function failDelivery(tx,user,id,input){
  const order=await one(tx,`SELECT o.version,o.status,t.status AS trip_status FROM orders o JOIN trips t ON o.trip_id=t.id
    JOIN shifts s ON t.shift_id=s.id JOIN customers c ON c.id=o.customer_id
    WHERE o.id=$1 AND s.driver_id=$2 AND c.team_id=$3`,[id,user.id,user.team_id]);
  ensure(order,'Заказ не найден',404);
  ensure(order.status==='assigned' && order.trip_status==='active' && input.version===order.version,
    'Точка изменилась или рейс уже завершён');
  await tx.query("UPDATE orders SET status='failed',failure_reason=$1,version=version+1 WHERE id=$2",[input.reason,id]);
  await audit(tx,user,'order.failed',id,input);
  return {ok:true};
}

export async function onSiteSale(tx,user,id,input,config){
  const trip=await one(tx,`SELECT t.status,s.date::text AS date,s.start_min,s.end_min FROM trips t
    JOIN shifts s ON s.id=t.shift_id JOIN accounts a ON a.id=s.driver_id
    WHERE t.id=$1 AND s.driver_id=$2 AND a.team_id=$3`,[id,user.id,user.team_id]);
  ensure(trip,'Рейс не найден',404);
  ensure(trip.status==='active','Продажа доступна в активном рейсе');
  const point=input.customer_order_id&&await one(tx,`SELECT o.*,t.status AS trip_status FROM orders o JOIN trips t ON t.id=o.trip_id
    JOIN shifts s ON s.id=t.shift_id JOIN customers c ON c.id=o.customer_id
    WHERE t.id=$1 AND s.driver_id=$2 AND o.id=$3 AND o.origin='office' AND c.team_id=$4`,
    [id,user.id,input.customer_order_id,user.team_id]);
  if(input.customer_order_id){
    ensure(point,'Точка этого рейса не найдена',404);
    ensure(['assigned','delivered'].includes(point.status),'Продажа доступна при посещении клиента');
  }
  const reserved=await one(tx,"SELECT COALESCE(sum(water),0)::int AS water FROM orders WHERE trip_id=$1 AND status='assigned'",[id]);
  const balance=await stock(tx,id);
  ensure(input.water<=balance.water-reserved.water,'Запас воды зарезервирован для других доставок');
  const basket=await orderLines(tx,input,user.team_id);
  const product=basket.lines[0];
  const available=(await tripStock(tx,[id])).find(p=>p.product_id===product.product_id);
  ensure(available && available.water_left-available.reserved_water>=input.water,'Нет свободного остатка: '+product.name);
  let sale;
  if(input.new_customer){
    const {name,phone,address,category}=input.new_customer;
    const customer=await one(tx,'INSERT INTO customers(name,phone,address,team_id) VALUES($1,$2,$3,$4) RETURNING id',
      [name,phone,address,user.team_id]);
    sale=await one(tx,`INSERT INTO orders(customer_id,name,phone,address,address_verified,date,window_start,window_end,
      water,new_shells,water_price,shell_price,category,payment_method,company,note,trip_id,status,origin,water_subtotal)
      VALUES($1,$2,$3,$4,true,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,'Продажа на месте',$15,'assigned','on_site',$16)
      RETURNING id,version`,[customer.id,name,phone,address,trip.date,trip.start_min,trip.end_min,input.water,input.new_shells,
        input.water_price,config.shellPrice,category,input.payment_method,input.company,id,basket.water_subtotal]);
  }else sale=await one(tx,`INSERT INTO orders(customer_id,name,phone,address,address_verified,date,window_start,window_end,
    water,new_shells,water_price,shell_price,category,payment_method,company,floor,lift,checkpoint,height_limit_mm,
    note,trip_id,position,eta,status,origin,source_order_id,alt_phone,entrance,unit,intercom,access_instructions,paid_entry,latitude,longitude,
    parking_minutes,has_cart,can_deliver_today,early_delivery_date)
    SELECT customer_id,name,phone,address,address_verified,date,window_start,window_end,
    $2,$3,$4,$5,category,$6,$7,floor,lift,checkpoint,height_limit_mm,'Продажа на месте',trip_id,position,eta,'assigned','on_site',id,
    alt_phone,entrance,unit,intercom,access_instructions,paid_entry,latitude,longitude,parking_minutes,has_cart,can_deliver_today,early_delivery_date
    FROM orders WHERE id=$1 RETURNING id,version`,[point.id,input.water,input.new_shells,input.water_price,config.shellPrice,
      input.payment_method,input.company]);
  await saveLines(tx,sale.id,basket.lines);
  await deliver(tx,user,sale.id,{version:sale.version,empty:input.empty,paid:input.paid});
  await audit(tx,user,'order.on_site',sale.id,{source_order_id:point?.id??null});
  return {ok:true,id:sale.id};
}

export async function rescheduleFailed(tx,user,order,input){
  ensure(!order.rescheduled_to,'Повторный заказ уже создан');
  const copy=await one(tx,`INSERT INTO orders(customer_id,name,phone,address,address_verified,date,window_start,window_end,
    water,new_shells,water_price,shell_price,category,payment_method,company,floor,lift,checkpoint,height_limit_mm,note,source_order_id,water_subtotal,
    alt_phone,entrance,unit,intercom,access_instructions,paid_entry,latitude,longitude,parking_minutes,has_cart,can_deliver_today,early_delivery_date)
    SELECT customer_id,name,phone,address,address_verified,$2,$3,$4,water,new_shells,water_price,shell_price,category,payment_method,
    company,floor,lift,checkpoint,height_limit_mm,note,id,water_subtotal,alt_phone,entrance,unit,intercom,access_instructions,paid_entry,latitude,longitude,
    parking_minutes,has_cart,can_deliver_today,early_delivery_date
    FROM orders WHERE id=$1 AND EXISTS(SELECT 1 FROM customers c WHERE c.id=orders.customer_id AND c.team_id=$5) RETURNING id`,
    [order.id,input.date,input.window_start,input.window_end,user.team_id]);
  ensure(copy,'Заказ не найден',404);
  await tx.query(`INSERT INTO order_items(order_id,product_id,name,water,water_price)
    SELECT $1,product_id,name,water,water_price FROM order_items WHERE order_id=$2`,[copy.id,order.id]);
  await tx.query('UPDATE orders SET rescheduled_to=$1,version=version+1 WHERE id=$2',[copy.id,order.id]);
  await audit(tx,user,'order.rescheduled_after_failure',order.id,{new_order_id:copy.id,date:input.date});
  return {ok:true,id:copy.id};
}
