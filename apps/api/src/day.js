import {rows,one} from './db.js';
import {calendar} from './config.js';
import {catalog} from './products.js';
import {tripStock} from './stock-items.js';

function grouped(entries,key){
  const groups=new Map();
  for(const entry of entries){
    if(!groups.has(entry[key])) groups.set(entry[key],[]);
    groups.get(entry[key]).push(entry);
  }
  return groups;
}

export function routePublished(date,config,now){
  const {today,tomorrow,minute}=calendar(config,now);
  return date<=today || (date===tomorrow && minute>=1080);
}

export async function dayView(tx,user,date,config,now,{includeCustomers=true}={}){
  const published=routePublished(date,config,now);
  const own=user.role==='driver'?user.id:null;
  const scope=[date,own,user.team_id];
  const shifts=await rows(tx,`SELECT s.*,s.date::text AS date,a.name AS driver_name,v.name AS vehicle_name,
    v.capacity_kg,v.extra_kg,v.total_height_mm FROM shifts s JOIN accounts a ON s.driver_id=a.id
    JOIN vehicles v ON s.vehicle_id=v.id WHERE s.date=$1 AND ($2::int IS NULL OR s.driver_id=$2)
    AND a.team_id=$3 AND v.team_id=$3 ORDER BY s.id`,scope);
  const visible=!own||published;
  const trips=visible?await rows(tx,`SELECT t.*,
    COALESCE((SELECT sum(water) FROM orders WHERE trip_id=t.id AND origin='office'),0)::int AS planned_water,
    COALESCE((SELECT sum(full_delta) FROM inventory WHERE trip_id=t.id),0)::int AS water_left,
    COALESCE((SELECT sum(empty_delta) FROM inventory WHERE trip_id=t.id),0)::int AS empty_collected
    FROM trips t JOIN shifts s ON s.id=t.shift_id JOIN accounts a ON a.id=s.driver_id
    WHERE s.date=$1 AND ($2::int IS NULL OR s.driver_id=$2) AND a.team_id=$3
    ORDER BY t.shift_id,t.number`,scope):[];
  const orders=visible?await rows(tx,`SELECT o.*,o.date::text AS date,o.early_delivery_date::text AS early_delivery_date,t.shift_id FROM orders o
    JOIN customers c ON c.id=o.customer_id LEFT JOIN trips t ON o.trip_id=t.id LEFT JOIN shifts s ON t.shift_id=s.id
    WHERE o.date=$1 AND ($2::int IS NULL OR s.driver_id=$2) AND c.team_id=$3 ORDER BY o.window_start,o.id`,scope):[];
  const customers=own||!includeCustomers?[]:await rows(tx,'SELECT * FROM customers WHERE team_id=$1 ORDER BY name,id',[user.team_id]);
  const reports=user.role==='operator'?[]:await rows(tx,`SELECT r.*,a.name AS driver_name,v.name AS vehicle_name,s.date::text AS date,
    CASE WHEN ex.sent_at IS NOT NULL THEN 'sent' WHEN ex.last_error IS NOT NULL THEN 'retry'
      WHEN ex.settlement_id IS NOT NULL THEN 'pending' END AS export_status,
    (SELECT count(*)::int FROM trips WHERE shift_id=s.id) AS trip_count,
    (SELECT count(DISTINCT CASE WHEN o.origin='on_site' THEN COALESCE(o.source_order_id,o.id) ELSE o.id END)::int FROM orders o JOIN trips t ON t.id=o.trip_id WHERE t.shift_id=s.id AND o.status='delivered' AND o.category='retail') AS retail_count,
    (SELECT count(DISTINCT CASE WHEN o.origin='on_site' THEN COALESCE(o.source_order_id,o.id) ELSE o.id END)::int FROM orders o JOIN trips t ON t.id=o.trip_id WHERE t.shift_id=s.id AND o.status='delivered' AND o.category='wholesale') AS wholesale_count
    FROM settlements r LEFT JOIN sheet_exports ex ON ex.settlement_id=r.id
    JOIN shifts s ON s.id=r.shift_id JOIN accounts a ON a.id=s.driver_id JOIN vehicles v ON v.id=s.vehicle_id
    WHERE s.date=$1 AND ($2::int IS NULL OR s.driver_id=$2) AND a.team_id=$3 ORDER BY r.id`,scope);
  const lines=orders.length?await rows(tx,'SELECT * FROM order_items WHERE order_id=ANY($1::int[]) ORDER BY order_id,product_id',
    [orders.map(o=>o.id)]):[];
  const byOrder=grouped(lines,'order_id');
  const byTrip=grouped(await tripStock(tx,trips.map(t=>t.id)),'trip_id');
  const products=await catalog(tx,{activeOnly:!['dispatcher','manager'].includes(user.role),teamId:user.team_id});
  const {today,minute}=calendar(config,now);
  const earlyOrders=['dispatcher','manager'].includes(user.role)&&date===today?await rows(tx,`SELECT o.id,o.name,o.address,o.date::text,o.version,
    o.window_start,o.window_end,o.water FROM orders o JOIN customers c ON c.id=o.customer_id
    WHERE c.team_id=$3 AND o.date>$1 AND o.early_delivery_date=$1 AND o.can_deliver_today
    AND o.status='pending' AND o.origin='office' AND o.address_verified AND o.window_end>$2
    ORDER BY o.date,o.window_end,o.id`,[today,minute,user.team_id]):[];
  return {shifts:shifts.map(s=>({...s,published})),orders:orders.map(o=>({...o,items:byOrder.get(o.id)??[]})),
    trips:trips.map(t=>({...t,stock_items:byTrip.get(t.id)??[]})),reports,customers,products,early_orders:earlyOrders};
}

export async function audit(tx,user,event,id,details={}){
  await tx.query('INSERT INTO audit(actor,event,entity_id,details) VALUES($1,$2,$3,$4)',
    [user.id,event,id,JSON.stringify(details)]);
}

export async function stock(tx,tripId){
  return one(tx,`SELECT COALESCE(sum(full_delta),0)::int AS water,COALESCE(sum(empty_delta),0)::int AS empty
    FROM inventory WHERE trip_id=$1`,[tripId]);
}
