import express from 'express';
import {randomBytes} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {z} from 'zod';
import {rows,one,writeLock} from './db.js';
import {digest,passwordHash,passwordMatches,ensure} from './auth.js';
import {calendar} from './config.js';
import {dayView,audit} from './day.js';
import {createOrder,allocate,changeOrder} from './orders.js';
import {confirmShift,startTrip,deliver,returnTrip,settle} from './execution.js';
import {reportCsv} from './csv.js';
import {failDelivery,onSiteSale} from './outcomes.js';
import * as v from './validation.js';

const office=['operator','dispatcher'];
const oversight=['dispatcher','manager'];
const drivers=['driver'];
const uuid=z.uuid();
const idOf=req=>v.id.parse(Number(req.params.id));
const blank=z.object({});
const denied='Недостаточно прав для этого действия';
const userColumns='a.id,a.email,a.name,a.role';

export function createApp({db,config,clock=()=>new Date()}){
  const app=express();
  app.disable('x-powered-by');
  app.use(express.json({limit:'32kb'}));
  app.use((req,res,next)=>{
    res.set('X-Content-Type-Options','nosniff');
    res.set('Referrer-Policy','no-referrer');
    if(req.path.startsWith('/api/')) res.set('Cache-Control','no-store');
    next();
  });
  app.get('/health/ready',async(req,res)=>{
    await db.transaction(tx=>tx.query('SELECT 1 FROM migrations LIMIT 1'));
    res.json({ok:true});
  });
  app.get('/api/config',(req,res)=>{
    const {today,tomorrow}=calendar(config,clock());
    res.json({today,tomorrow,timezone:config.timezone,base_address:config.address,base_lat:config.lat,
      base_lon:config.lon,water_price:config.price,shell_price:config.shellPrice,map_provider:'demo'});
  });

  const attempts=new Map();
  const dummyHash=passwordHash(randomBytes(32).toString('hex'));
  app.post('/api/login',async(req,res)=>{
    const {email,password}=v.login.parse(req.body);
    const key=req.socket.remoteAddress;
    const now=Date.now();
    for(const [ip,bucket] of attempts) if(bucket.until<=now) attempts.delete(ip);
    const bucket=attempts.get(key)||{n:0,until:now+60000};
    ensure(bucket.n<24,'Слишком много попыток входа. Повторите через минуту',429);
    bucket.n++;
    attempts.set(key,bucket);
    const value=await db.transaction(async tx=>{
      const user=await one(tx,'SELECT id,email,name,role,password_hash FROM accounts WHERE email=$1 FOR SHARE',[email]);
      const ok=await passwordMatches(password,user?.password_hash??await dummyHash);
      ensure(user && ok,'Проверьте email и пароль',401);
      const token=randomBytes(32).toString('hex');
      await tx.query('DELETE FROM sessions WHERE expires_at<=now()');
      await tx.query("INSERT INTO sessions VALUES($1,$2,now()+$3*interval '1 hour')",[digest(token),user.id,config.sessionHours]);
      delete user.password_hash;
      return {token,user};
    });
    bucket.n--;
    res.json(value);
  });
  app.use('/api',async(req,res,next)=>{
    const token=req.get('authorization')?.match(/^Bearer ([a-f0-9]{64})$/)?.[1];
    ensure(token,'Войдите в кабинет',401);
    req.session=digest(token);
    req.user=await db.transaction(tx=>one(tx,`SELECT ${userColumns} FROM sessions s JOIN accounts a ON a.id=s.account_id
      WHERE s.digest=$1 AND s.expires_at>now()`,[req.session]));
    ensure(req.user,'Сессия завершена. Войдите снова',401);
    next();
  });
  // Serialize operational writes for the small fleet. PostgreSQL row locks also cover multiple API processes.
  function action(path,roles,schema,handler,{repeat=false,method='post'}={}){
    app[method]('/api'+path,async(req,res)=>{
      ensure(!roles||roles.includes(req.user.role),denied,403);
      const input=schema.parse(req.body??{});
      const key=req.get('Idempotency-Key');
      if(repeat) ensure(key && uuid.safeParse(key).success,'Нужен Idempotency-Key в формате UUID',400);
      // Optional keys allow office clients to safely retry creation as well.
      if(key) ensure(uuid.safeParse(key).success,'Некорректный Idempotency-Key',400);
      const result=await db.transaction(async tx=>{
        await writeLock(tx);
        ensure(await one(tx,'SELECT 1 FROM sessions WHERE digest=$1 AND expires_at>now()',[req.session]),'Сессия завершена',401);
        let signature;
        if(key){
          signature=digest(req.method+' '+req.path+' '+JSON.stringify(input));
          const prior=await one(tx,'SELECT signature,result FROM requests WHERE actor=$1 AND key=$2',[req.user.id,key]);
          if(prior){ ensure(prior.signature===signature,'Ключ запроса уже использован для других данных');return prior.result; }
        }
        const result=await handler(tx,req.user,input,req);
        if(key) await tx.query('INSERT INTO requests VALUES($1,$2,$3,$4)',[req.user.id,key,signature,JSON.stringify(result)]);
        return result;
      });
      res.json(result);
    });
  }
  app.get('/api/me',(req,res)=>res.json(req.user));
  action('/logout',null,blank,async(tx,user,input,req)=>{
    await tx.query('DELETE FROM sessions WHERE digest=$1',[req.session]);return {ok:true};
  });
  action('/password',null,z.object({current_password:z.string().min(1).max(256),new_password:z.string().min(10).max(128)}),
    async(tx,user,input)=>{
      const account=await one(tx,'SELECT password_hash FROM accounts WHERE id=$1 FOR UPDATE',[user.id]);
      ensure(await passwordMatches(input.current_password,account.password_hash),'Текущий пароль указан неверно',400);
      await tx.query('UPDATE accounts SET password_hash=$1 WHERE id=$2',[await passwordHash(input.new_password),user.id]);
      await tx.query('DELETE FROM sessions WHERE account_id=$1',[user.id]);
      await audit(tx,user,'account.password_changed',user.id);
      return {ok:true};
    });
  app.get('/api/day',async(req,res)=>{
    const date=v.date.parse(req.query.date);
    res.json(await db.transaction(async tx=>{
      await tx.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ');
      return dayView(tx,req.user,date,config,clock());
    }));
  });
  app.get('/api/reports.csv',async(req,res)=>{
    ensure(oversight.includes(req.user.role),denied,403);
    const date=v.date.parse(req.query.date);
    const {reports}=await db.transaction(tx=>dayView(tx,req.user,date,config,clock()));
    res.attachment('farvater-'+date+'.csv').type('text/csv; charset=utf-8').send(reportCsv(reports));
  });
  app.get('/api/resources',async(req,res)=>{
    ensure(oversight.includes(req.user.role),denied,403);
    res.json(await db.transaction(async tx=>({drivers:await rows(tx,"SELECT id,name FROM accounts WHERE role='driver' ORDER BY name"),
      vehicles:await rows(tx,'SELECT * FROM vehicles ORDER BY id')})));
  });
  action('/shifts',['dispatcher'],v.shift,async(tx,user,input)=>{
    ensure(await one(tx,"SELECT 1 FROM accounts WHERE id=$1 AND role='driver'",[input.driver_id]),'Экспедитор не найден',404);
    ensure(await one(tx,'SELECT 1 FROM vehicles WHERE id=$1',[input.vehicle_id]),'Автомобиль не найден',404);
    const result=await one(tx,`INSERT INTO shifts(date,driver_id,vehicle_id,start_min,end_min,has_loader)
      VALUES($1,$2,$3,$4,$5,$6) RETURNING id`,[input.date,input.driver_id,input.vehicle_id,input.start_min,input.end_min,input.has_loader]);
    await audit(tx,user,'shift.created',result.id);return result;
  });
  action('/vehicles/:id',['dispatcher'],v.vehicle,async(tx,user,input,req)=>{
    const id=idOf(req);
    const vehicle=await one(tx,'SELECT capacity_kg FROM vehicles WHERE id=$1',[id]);
    ensure(vehicle,'Автомобиль не найден',404);
    ensure(input.extra_kg<=vehicle.capacity_kg,'Масса оборудования превышает грузоподъёмность');
    ensure(!await one(tx,`SELECT 1 FROM trips t JOIN shifts s ON t.shift_id=s.id
      WHERE s.vehicle_id=$1 AND t.status IN ('planned','active')`,[id]),'Характеристики можно изменить до планирования или после возврата');
    await tx.query('UPDATE vehicles SET total_height_mm=$1,extra_kg=$2 WHERE id=$3',[input.total_height_mm,input.extra_kg,id]);
    await audit(tx,user,'vehicle.changed',id,input);return {ok:true};
  },{method:'patch'});
  action('/orders',office,v.order,(tx,u,b)=>createOrder(tx,u,b,config));
  action('/accounts',['manager'],v.account,async(tx,u,b)=>{
    const result=await one(tx,'INSERT INTO accounts(email,name,role,password_hash) VALUES($1,$2,$3,$4) RETURNING id',
      [b.email,b.name,b.role,await passwordHash(b.password)]);
    await audit(tx,u,'account.created',result.id,{role:b.role});
    return result;
  });
  action('/vehicles',['dispatcher'],v.newVehicle,async(tx,u,b)=>{
    const result=await one(tx,`INSERT INTO vehicles(name,capacity_kg,extra_kg,length_mm,body_height_mm,total_height_mm)
      VALUES($1,$2,$3,$4,$5,$6) RETURNING id`,[b.name,b.capacity_kg,b.extra_kg,b.length_mm,b.body_height_mm,b.total_height_mm]);
    await audit(tx,u,'vehicle.created',result.id);return result;
  });
  for(const op of ['cancel','reschedule','verify-address']){
    action('/orders/:id/'+op,office,op==='reschedule'?v.move:v.version,(tx,u,b,r)=>changeOrder(tx,u,idOf(r),b,op,config,clock()));
  }
  action('/plan',['dispatcher'],v.plan,(tx,u,b)=>allocate(tx,u,b,config,clock()));
  action('/shifts/:id/confirm',drivers,blank,(tx,u,b,r)=>confirmShift(tx,u,idOf(r),config,clock()));
  action('/trips/:id/start',drivers,v.start,(tx,u,b,r)=>startTrip(tx,u,idOf(r),b,config,clock()),{repeat:true});
  action('/orders/:id/deliver',drivers,v.complete,(tx,u,b,r)=>deliver(tx,u,idOf(r),b),{repeat:true});
  action('/orders/:id/fail',drivers,v.failure,(tx,u,b,r)=>failDelivery(tx,u,idOf(r),b),{repeat:true});
  action('/trips/:id/sale',drivers,v.sale,(tx,u,b,r)=>onSiteSale(tx,u,idOf(r),b,config),{repeat:true});
  action('/trips/:id/return',drivers,v.returned,(tx,u,b,r)=>returnTrip(tx,u,idOf(r),b),{repeat:true});
  action('/shifts/:id/settle',drivers,v.settlement,(tx,u,b,r)=>settle(tx,u,idOf(r),b),{repeat:true});
  action('/reports/:id/review',oversight,blank,async(tx,u,b,r)=>{
    const id=idOf(r);
    const item=await one(tx,'UPDATE settlements SET reviewed=true,reviewed_by=$1 WHERE id=$2 RETURNING id',[u.id,id]);
    ensure(item,'Отчёт не найден',404);
    await audit(tx,u,'settlement.reviewed',id);return {ok:true};
  });
  app.use('/api',(req,res)=>res.status(404).json({error:'Метод API не найден'}));
  app.use(express.static(fileURLToPath(new URL('../../web/dist/',import.meta.url))));
  app.use((err,req,res,next)=>{
    if(err instanceof z.ZodError){
      const issue=err.issues[0],key=issue.path.join('.');
      return res.status(400).json({error:issue.code==='custom'?issue.message:'Проверьте значение поля '+(key||'запроса')});
    }
    if(err.code==='23505')return res.status(409).json({error:'Такая запись уже существует. Проверьте дату и назначение'});
    const status=err.status||500;
    if(status>=500) console.error(err);
    res.status(status).json({error:status>=500?'Ошибка сервера':err.type==='entity.parse.failed'?'Некорректный JSON':err.message});
  });
  return app;
}
