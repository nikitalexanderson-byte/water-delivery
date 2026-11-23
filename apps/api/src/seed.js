import {one,writeLock} from './db.js';
import {calendar} from './config.js';
import {passwordHash,ensure} from './auth.js';

export async function seed(db,config,password){
  ensure(password && password.length>=10,'Для демоданных задайте DEMO_PASSWORD длиной от 10 символов',400);
  await db.transaction(async tx=>{
    await writeLock(tx);
    if(await one(tx,"SELECT 1 FROM seed_history WHERE name='demo-v1'")) return;
    const drivers=[];
    for(const [login,role,name] of [
      ['operator','operator','Мария · оператор'],['dispatcher','dispatcher','Анна · диспетчер'],
      ['manager','manager','Руководитель'],['driver1','driver','Алексей Морозов'],['driver2','driver','Иван Соколов']]){
      const account=await one(tx,'INSERT INTO accounts(email,name,role,password_hash) VALUES($1,$2,$3,$4) RETURNING id',
        [login+'@farvater.test',name,role,await passwordHash(password)]);
      if(role==='driver') drivers.push(account.id);
    }
    const {today,tomorrow}=calendar(config);
    for(const [i,kg,height] of [[0,2600,2400],[1,3200,2200]]){
      const vehicle=await one(tx,'INSERT INTO vehicles(name,capacity_kg,length_mm,body_height_mm) VALUES($1,$2,4200,$3) RETURNING id',
        ['ГАЗель NEXT · 0'+(i+1),kg,height]);
      for(const date of [today,tomorrow]) await tx.query(
        'INSERT INTO shifts(driver_id,vehicle_id,date,start_min,end_min,has_loader) VALUES($1,$2,$3,$4,$5,$6)',
        [drivers[i],vehicle.id,date,i?600:480,i?1320:1080,Boolean(i)]);
    }
    for(const [i,name,address,quantity,begin,end] of [
      [1,'Офис «Маяк»','Учебная улица, 12',12,600,795],
      [2,'Анна Смирнова','Тестовый переулок, 4',3,1080,1320],
      [3,'Склад «Берег»','Демонстрационный проезд, 8',6,720,1020]]){
      const phone='+7000000000'+i;
      const customer=await one(tx,'INSERT INTO customers(name,phone,address) VALUES($1,$2,$3) RETURNING id',[name,phone,address]);
      await tx.query(`INSERT INTO orders(customer_id,name,phone,address,date,water,new_shells,water_price,shell_price,
        category,payment_method,company,window_start,window_end,address_verified,height_limit_mm)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,true,$15)`,
        [customer.id,name,phone,address,today,quantity,i===2?1:0,config.price,config.shellPrice,
         i===1?'wholesale':'retail',i===1?'bank':'cash',i===1?name:'',begin,end,i===3?2800:null]);
    }
    await tx.query("INSERT INTO seed_history VALUES('demo-v1')");
  });
}
