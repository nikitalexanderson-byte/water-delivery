import assert from 'node:assert/strict';
import {test} from 'node:test';
import {planOrders} from '../src/routing.js';

for(const size of [10,1000]){
  test('Распределение по списку из '+size+' машин учитывает и последнюю смену',()=>{
    const shifts=Array.from({length:size},(_,i)=>({id:i+1,start_min:480,end_min:i+1===size?1320:1080,
      status:'confirmed',capacity_kg:i%2?2600:3200,extra_kg:0,has_loader:i%2===0}));
    const orders=Array.from({length:100},(_,i)=>({id:i+1,water:3+i%4,address_verified:true,height_limit_mm:null,
      floor:1,checkpoint:false,lift:true,window_start:i===99?1200:480+(i%6)*60,window_end:i===99?1310:1040+(i%6)*5}));
    const plan=planOrders({orders,shifts,trips:[]});
    assert.deepEqual(plan.unassigned,[]);
    const stops=plan.trips.flatMap(trip=>trip.stops.map(stop=>({id:stop.order_id,shift:trip.shift_id})));
    assert.equal(stops.length,100);
    assert.equal(new Set(stops.map(s=>s.id)).size,100);
    assert.equal(stops.find(s=>s.id===100).shift,size);
  });
}
