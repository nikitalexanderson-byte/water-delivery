import {one,rows} from './db.js';
import {ensure} from './auth.js';

// Explicit Cyrillic folding also works on a PostgreSQL database initialized with C collation.
const upper='АБВГДЕЁЖЗИЙКЛМНОПРСТУФХЦЧШЩЪЫЬЭЮЯё';
const lower='абвгдеежзийклмнопрстуфхцчшщъыьэюяе';
const directoryPage=25;
const historyPage=15;

export async function findCustomers(tx,{q='',after}){
  const term=q.trim().toLowerCase().replaceAll('ё','е');
  const digits=/^[\d\s()+-]+$/.test(q.trim())?q.replace(/\D/g,'').replace(/^[78](?=\d{10}$)/,''):'';
  const matches=await rows(tx,`SELECT c.id,c.name,c.address,c.phone FROM customers c
    WHERE ($1::int IS NULL OR c.id<$1) AND
      ($2='' OR strpos(translate(lower(c.name || ' ' || c.address),$3,$4),$2)>0
       OR ($5<>'' AND strpos(regexp_replace(c.phone,'[^0-9]','','g'),$5)>0)
       OR EXISTS (
         SELECT 1 FROM orders o WHERE o.customer_id=c.id AND (
            strpos(translate(lower(o.name || ' ' || o.address),$3,$4),$2)>0
            OR ($5<>'' AND strpos(regexp_replace(o.phone,'[^0-9]','','g'),$5)>0)
            OR ($5<>'' AND strpos(regexp_replace(o.alt_phone,'[^0-9]','','g'),$5)>0)
         )
       )
      )
    ORDER BY c.id DESC LIMIT $6`,[after??null,term,upper,lower,digits,directoryPage+1]);
  const customers=matches.slice(0,directoryPage);
  return {customers,next:matches.length>directoryPage?customers.at(-1).id:null};
}

export async function readCustomerHistory(tx,id,after){
  const customer=await one(tx,'SELECT id,name,phone,address FROM customers WHERE id=$1',[id]);
  ensure(customer,'Клиент не найден',404);
  const records=await rows(tx,`SELECT o.*,o.date::text AS date FROM orders o
    WHERE customer_id=$1 AND ($2::date IS NULL OR (date,id)<($2::date,$3::int))
    ORDER BY o.date DESC,id DESC LIMIT $4`,[id,after?.date??null,after?.id??null,historyPage+1]);
  const orders=records.slice(0,historyPage);
  const byId=new Map(orders.map(o=>[o.id,{...o,items:[]}]));
  if(orders.length){
    const items=await rows(tx,'SELECT * FROM order_items WHERE order_id=ANY($1::int[]) ORDER BY order_id,product_id',
      [orders.map(o=>o.id)]);
    for(const item of items) byId.get(item.order_id).items.push(item);
  }
  const last=orders.at(-1);
  return {customer,orders:[...byId.values()],next:records.length>historyPage?last.date+'.'+last.id:null};
}
