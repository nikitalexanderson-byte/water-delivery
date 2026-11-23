import {rows} from './db.js';
import {calendar} from './config.js';

// Apply the same team and driver publication scope to counts and archive rows.
const visibleOrders=`FROM orders o JOIN customers c ON c.id=o.customer_id
  LEFT JOIN trips t ON t.id=o.trip_id LEFT JOIN shifts s ON s.id=t.shift_id
  WHERE c.team_id=$1 AND ($2::int IS NULL OR (s.driver_id=$2 AND o.date<=$3::date))`;

function scope(user,config,now){
  const {today,tomorrow,minute}=calendar(config,now);
  return [user.team_id,user.role==='driver'?user.id:null,minute>=1080?tomorrow:today];
}

export async function orderCalendar(tx,user,config,now,start){
  const days=await rows(tx,`SELECT o.date::text AS date,count(*)::int AS count ${visibleOrders}
    AND o.date >= $4::date AND o.date < $4::date+30 GROUP BY o.date ORDER BY o.date`,[...scope(user,config,now),start]);
  return {days};
}

export async function orderArchive(tx,user,config,now,date,id){
  const orders=await rows(tx,`SELECT o.id,o.date::text AS date,o.name,o.address,o.status ${visibleOrders}
    AND ($4::date IS NULL OR (o.date,o.id)<($4::date,$5::int)) ORDER BY o.date DESC,o.id DESC LIMIT 26`,
    [...scope(user,config,now),date,id]);
  const page=orders.slice(0,25),last=page.at(-1);
  return {orders:page,next:orders.length>25?last.date+'.'+last.id:null};
}
