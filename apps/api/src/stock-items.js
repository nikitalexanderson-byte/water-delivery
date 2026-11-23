import {rows} from './db.js';
import {ensure} from './auth.js';
import {defaultProductId} from './products.js';

// A driver gets only the IDs selected by the ownership check in dayView/ownTrip.
export async function tripStock(tx,tripIds){
  if(!tripIds.length) return [];
  return rows(tx,`WITH movements AS (
    SELECT o.trip_id,i.product_id,i.water AS planned,
      CASE WHEN o.status='assigned' THEN i.water ELSE 0 END AS reserved,0 AS on_board
    FROM order_items i JOIN orders o ON o.id=i.order_id WHERE o.trip_id=ANY($1::int[]) AND o.origin='office'
    UNION ALL
    SELECT e.trip_id,i.product_id,0,0,i.full_delta FROM inventory_items i JOIN inventory e ON e.id=i.inventory_id
    WHERE e.trip_id=ANY($1::int[])
  ) SELECT m.trip_id,p.id AS product_id,p.name,SUM(planned)::int AS planned_water,
    SUM(reserved)::int AS reserved_water,SUM(on_board)::int AS water_left
    FROM movements m JOIN trips t ON t.id=m.trip_id JOIN shifts s ON s.id=t.shift_id
    JOIN accounts a ON a.id=s.driver_id JOIN products p ON p.id=m.product_id AND p.team_id=a.team_id
    GROUP BY m.trip_id,p.id,p.name ORDER BY m.trip_id,p.id`,[tripIds]);
}

export async function countedItems(tx,input,known,allowArchived,teamId){
  let entries=input.items;
  if(!entries){
    // Legacy clients can safely count a single SKU. Never infer a brand split from an aggregate.
    ensure(known.length<=1,'Укажите количество отдельно по каждому наименованию',400);
    entries=input.water?[{product_id:known[0]?.product_id??await defaultProductId(tx,teamId),water:input.water}]:[];
  }
  const counts=new Map(entries.map(i=>[i.product_id,i.water]));
  ensure(counts.size===entries.length,'Наименование указано дважды',400);
  ensure(entries.reduce((sum,i)=>sum+i.water,0)===input.water,'Сумма позиций расходится с общим количеством воды',400);
  const products=await rows(tx,'SELECT id,name,active FROM products WHERE id=ANY($1::int[]) AND team_id=$2',[[...counts.keys()],teamId]);
  ensure(products.length===counts.size,'В списке есть неизвестное наименование воды',400);
  for(const p of products) ensure(allowArchived||p.active||known.some(row=>row.product_id===p.id),'Товар снят с продажи: '+p.name);
  return {counts,products};
}

export async function recordItems(tx,inventoryId,entries,sign){
  const values=[...entries].filter(([,water])=>water>0).map(([product_id,water])=>({product_id,delta:water*sign}));
  await tx.query(`INSERT INTO inventory_items(inventory_id,product_id,full_delta)
    SELECT $1,product_id,delta FROM jsonb_to_recordset($2::jsonb) AS item(product_id int,delta int)`,[inventoryId,JSON.stringify(values)]);
}

export async function reconcileStock(tx,shiftId,input,teamId){
  const balances=await rows(tx,`SELECT p.id AS product_id,p.name,sum(i.full_delta)::int AS expected
    FROM inventory_items i JOIN products p ON i.product_id=p.id JOIN inventory e ON i.inventory_id=e.id
    JOIN trips t ON t.id=e.trip_id WHERE t.shift_id=$1 AND p.team_id=$2 GROUP BY p.id,p.name ORDER BY p.id`,[shiftId,teamId]);
  const {counts,products}=await countedItems(tx,input,balances,true,teamId);
  const byId=new Map(balances.map(row=>[row.product_id,row]));
  for(const p of products){
    if(!byId.has(p.id)) byId.set(p.id,{product_id:p.id,name:p.name,expected:0});
  }
  return [...byId.values()].map(row=>{
    const actual=counts.get(row.product_id)??0;
    return {...row,actual,difference:actual-row.expected};
  });
}
