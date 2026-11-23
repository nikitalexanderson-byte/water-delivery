import express from 'express';
import {randomBytes} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {z} from 'zod';
import {rows,one,writeLock} from './db.js';
import {digest,passwordHash,passwordMatches,ensure} from './auth.js';
import {calendar} from './config.js';
import {dayView,audit} from './day.js';
import {orderArchive,orderCalendar} from './order-calendar.js';
import {findCustomers,readCustomerHistory} from './customers.js';
import {createPlaceSearch,PlaceSearchError} from './places.js';
import {createRoadRouter,exampleStops,tripStops} from './road-routes.js';
import {createOrder,allocate,changeOrder,bringForward,refreshShiftPlan} from './orders.js';
import {confirmShift,startTrip,deliver,returnTrip,settle} from './execution.js';
import {reportCsv} from './csv.js';
import {catalog,createProduct,editProduct} from './products.js';
import {failDelivery,onSiteSale} from './outcomes.js';
import {beginSession,createTeam,inviteMember,joinTeam,members,register,teamUserColumns} from './teams.js';
import * as v from './validation.js';

const office=['operator','dispatcher','manager'];
const oversight=['dispatcher','manager'];
const drivers=['driver'];
const uuid=z.uuid();
const idOf=req=>v.id.parse(Number(req.params.id));
const blank=z.object({});
const denied='Недостаточно прав для этого действия';
const noTeamPaths=new Set(['/me','/logout','/password','/teams/create','/teams/join']);
const registration=z.object({email:z.email().max(254).transform(v=>v.toLowerCase()),
  name:z.string().trim().min(1).max(120),password:z.string().min(10).max(128)});

const tokenDigest=req=>{
  const token=req.get('authorization')?.match(/^Bearer ([a-f0-9]{64})$/)?.[1];
  return token?digest(token):null;
};

export function createApp({db,config:settings,clock=()=>new Date(),placeFetch=fetch,roadFetch=fetch}){
  const app=express();
  const searchPlaces=createPlaceSearch(settings.geocoder,{fetchImpl:placeFetch});
  const roadRoute=createRoadRouter(settings.roadRouter,{fetchImpl:roadFetch});
  const config={...settings,routing:{...settings.routing,mapProvider:roadRoute.planningMap(settings,settings.routing)}};
  app.disable('x-powered-by');
  if(config.trustProxyHops)app.set('trust proxy',config.trustProxyHops);
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
  async function sessionTeam(req){
    const session=tokenDigest(req);
    return session&&db.transaction(tx=>one(tx,`SELECT a.team_id,t.base_address,t.base_lat,t.base_lon
      FROM sessions s JOIN accounts a ON a.id=s.account_id LEFT JOIN teams t ON t.id=a.team_id
      WHERE s.digest=$1 AND s.expires_at>now()`,[session]));
  }
  app.get('/api/config',async(req,res)=>{
    const {today,tomorrow}=calendar(config,clock());
    const depot=teamConfig(await sessionTeam(req));
    res.json({today,tomorrow,timezone:config.timezone,base_address:depot.address,base_lat:depot.lat,
      base_lon:depot.lon,water_price:config.price,shell_price:config.shellPrice,map_provider:'demo',map_tiles_enabled:config.mapTilesEnabled??false,
      geocoder_enabled:config.geocoder.enabled,registration_enabled:config.registrationEnabled});
  });
  app.get('/api/road-routes/example/:id',async(req,res)=>{
    res.json(await roadRoute(exampleStops(req.params.id),teamConfig(await sessionTeam(req))));
  });

  const attempts=new Map();
  const dummyHash=passwordHash(randomBytes(32).toString('hex'));
  app.post('/api/login',async(req,res)=>{
    const {email,password}=v.login.parse(req.body);
    const key=req.ip;
    const now=Date.now();
    for(const [ip,bucket] of attempts) if(bucket.until<=now) attempts.delete(ip);
    const bucket=attempts.get(key)||{n:0,until:now+60000};
    ensure(bucket.n<24,'Слишком много попыток входа. Повторите через минуту',429);
    bucket.n++;
    attempts.set(key,bucket);
    const value=await db.transaction(async tx=>{
      const user=await one(tx,`SELECT ${teamUserColumns},a.password_hash FROM accounts a
        LEFT JOIN teams t ON t.id=a.team_id WHERE a.email=$1 FOR SHARE OF a`,[email]);
      const ok=await passwordMatches(password,user?.password_hash??await dummyHash);
      ensure(user && ok,'Проверьте email и пароль',401);
      delete user.password_hash;
      return beginSession(tx,user,config.sessionHours);
    });
    bucket.n--;
    res.json(value);
  });
  const signups=new Map();
  app.post('/api/register',async(req,res)=>{
    ensure(config.registrationEnabled,'Регистрация отключена администратором.',403);
    const input=registration.parse(req.body);
    const now=Date.now();
    for(const [ip,bucket] of signups)if(bucket.until<=now)signups.delete(ip);
    const key=req.ip;
    const bucket=signups.get(key)||{count:0,until:now+60000};
    ensure(bucket.count<12,'Слишком много регистраций. Повторите через минуту.',429);
    bucket.count++;
    signups.set(key,bucket);
    res.status(201).json(await db.transaction(tx=>register(tx,input,config.sessionHours)));
  });
  app.use('/api',async(req,res,next)=>{
    req.session=tokenDigest(req);
    ensure(req.session,'Войдите в кабинет',401);
    req.user=await db.transaction(tx=>one(tx,`SELECT ${teamUserColumns},t.base_address,t.base_lat,t.base_lon FROM sessions s JOIN accounts a ON a.id=s.account_id
      LEFT JOIN teams t ON t.id=a.team_id
      WHERE s.digest=$1 AND s.expires_at>now()`,[req.session]));
    ensure(req.user,'Сессия завершена. Войдите снова',401);
    ensure(req.user.team_id!==null||noTeamPaths.has(req.path),'Создайте команду или примите приглашение.',403);
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
  app.get('/api/team',async(req,res)=>{
    res.json({members:await db.transaction(tx=>members(tx,req.user.team_id))});
  });
  action('/teams/create',null,z.object({name:z.string().trim().min(1).max(120)}),createTeam);
  action('/teams/join',null,z.object({code:z.string().trim().toLowerCase().regex(/^[a-f0-9]{32}$/)}),joinTeam);
  action('/team/invitations',['manager'],z.object({role:z.enum(['driver','operator','dispatcher'])}),inviteMember);
  action('/team/base',['manager'],z.object({address:z.string().trim().max(300),
    lat:z.number().min(-90).max(90).nullable(),lon:z.number().min(-180).max(180).nullable()})
    .refine(p=>(p.lat===null)===(p.lon===null),'Укажите широту и долготу вместе.'),async(tx,user,b)=>{
      await tx.query('UPDATE teams SET base_address=$2,base_lat=$3,base_lon=$4 WHERE id=$1',[user.team_id,b.address,b.lat,b.lon]);
      await audit(tx,user,'team.base_changed',user.team_id);
      return {ok:true};
    },{method:'patch'});
  app.get('/api/road-routes/trip/:id',async(req,res)=>{
    const id=idOf(req);
    const stops=await db.transaction(async tx=>{
      await tx.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ');
      return tripStops(tx,req.user,id,config,clock());
    });
    res.json(await roadRoute(stops,teamConfig(req.user)));
  });
  function teamConfig(user){
    if(user?.team_id===1&&!user.base_address&&user.base_lat==null)return config;
    const settings={...config,address:user?.base_address??'',lat:user?.base_lat??null,lon:user?.base_lon??null};
    return {...settings,routing:{...settings.routing,mapProvider:roadRoute.planningMap(settings,settings.routing)}};
  }
  app.get('/api/places',async(req,res)=>{
    ensure(office.includes(req.user.role),denied,403);
    const q=v.placeQuery.parse(req.query.q);
    res.json({places:await searchPlaces(q)});
  });
  app.get('/api/customers',async(req,res)=>{
    ensure(office.includes(req.user.role),denied,403);
    const query=z.object({q:z.string().max(200).optional(),after:z.coerce.number().int().positive().max(2147483647).optional()}).parse(req.query);
    res.json(await db.transaction(tx=>findCustomers(tx,query,req.user.team_id)));
  });
  app.get('/api/customers/:id/history',async(req,res)=>{
    ensure(office.includes(req.user.role),denied,403);
    const id=idOf(req);
    const cursor=z.string().regex(/^\d{4}-\d{2}-\d{2}\.\d{1,10}$/).optional().parse(req.query.after);
    let after;
    if(cursor){
      const [date,value]=cursor.split('.');
      after={date:v.date.parse(date),id:v.id.max(2147483647).parse(Number(value))};
    }
    res.json(await db.transaction(async tx=>{
      await tx.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ');
      return readCustomerHistory(tx,id,after,req.user.team_id);
    }));
  });
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
      return dayView(tx,req.user,date,config,clock(),{includeCustomers:req.query.include_customers!=='false'});
    }));
  });
  app.get('/api/order-calendar',async(req,res)=>{
    const start=v.date.parse(req.query.start);
    res.json(await db.transaction(tx=>orderCalendar(tx,req.user,config,clock(),start)));
  });
  app.get('/api/order-archive',async(req,res)=>{
    const cursor=z.string().regex(/^\d{4}-\d{2}-\d{2}\.\d{1,10}$/).optional().parse(req.query.after);
    const [date,id]=cursor?.split('.')||[];
    res.json(await db.transaction(tx=>orderArchive(tx,req.user,config,clock(),date?v.date.parse(date):null,
      id?v.id.max(2147483647).parse(Number(id)):null)));
  });
  app.get('/api/reports.csv',async(req,res)=>{
    ensure(oversight.includes(req.user.role),denied,403);
    const date=v.date.parse(req.query.date);
    const {reports}=await db.transaction(tx=>dayView(tx,req.user,date,config,clock(),{includeCustomers:false}));
    res.attachment('farvater-'+date+'.csv').type('text/csv; charset=utf-8').send(reportCsv(reports));
  });
  app.get('/api/resources',async(req,res)=>{
    ensure(oversight.includes(req.user.role),denied,403);
    const team=req.user.team_id;
    res.json(await db.transaction(async tx=>({drivers:await rows(tx,"SELECT id,name FROM accounts WHERE role='driver' AND team_id=$1 ORDER BY name",[team]),
      vehicles:await rows(tx,'SELECT * FROM vehicles WHERE team_id=$1 ORDER BY id',[team]),products:await catalog(tx,{teamId:team})})));
  });
  action('/shifts',oversight,v.shift,async(tx,user,input)=>{
    ensure(await one(tx,"SELECT 1 FROM accounts WHERE id=$1 AND role='driver' AND team_id=$2",[input.driver_id,user.team_id]),'Экспедитор не найден',404);
    ensure(await one(tx,'SELECT 1 FROM vehicles WHERE id=$1 AND team_id=$2',[input.vehicle_id,user.team_id]),'Автомобиль не найден',404);
    const result=await one(tx,`INSERT INTO shifts(date,driver_id,vehicle_id,start_min,end_min,has_loader)
      VALUES($1,$2,$3,$4,$5,$6) RETURNING id`,[input.date,input.driver_id,input.vehicle_id,input.start_min,input.end_min,input.has_loader]);
    await audit(tx,user,'shift.created',result.id);return result;
  });
  action('/vehicles/:id',oversight,v.vehicle,async(tx,user,input,req)=>{
    const id=idOf(req);
    const vehicle=await one(tx,'SELECT capacity_kg FROM vehicles WHERE id=$1 AND team_id=$2',[id,user.team_id]);
    ensure(vehicle,'Автомобиль не найден',404);
    ensure(input.extra_kg<=vehicle.capacity_kg,'Масса оборудования превышает грузоподъёмность');
    ensure(!await one(tx,`SELECT 1 FROM trips t JOIN shifts s ON t.shift_id=s.id
      WHERE s.vehicle_id=$1 AND t.status IN ('planned','active')`,[id]),'Характеристики можно изменить до планирования или после возврата');
    await tx.query('UPDATE vehicles SET total_height_mm=$1,extra_kg=$2 WHERE id=$3',[input.total_height_mm,input.extra_kg,id]);
    await audit(tx,user,'vehicle.changed',id,input);return {ok:true};
  },{method:'patch'});
  action('/orders',office,v.order,(tx,u,b)=>createOrder(tx,u,b,config,clock()));
  action('/orders/:id/bring-forward',oversight,v.version,(tx,u,b,r)=>bringForward(tx,u,idOf(r),b,teamConfig(u),clock()));
  action('/orders/:id',office,v.orderEdit,(tx,u,b,r)=>changeOrder(tx,u,idOf(r),b,'edit',teamConfig(u),clock()),{method:'patch'});
  action('/products',oversight,v.product,createProduct);
  action('/products/:id',oversight,v.product.partial(),(tx,u,b,r)=>editProduct(tx,u,idOf(r),b),{method:'patch'});
  action('/accounts',['manager'],v.account,async(tx,u,b)=>{
    const result=await one(tx,'INSERT INTO accounts(email,name,role,password_hash,team_id) VALUES($1,$2,$3,$4,$5) RETURNING id',
      [b.email,b.name,b.role,await passwordHash(b.password),u.team_id]);
    await audit(tx,u,'account.created',result.id,{role:b.role});
    return result;
  });
  action('/vehicles',oversight,v.newVehicle,async(tx,u,b)=>{
    const result=await one(tx,`INSERT INTO vehicles(name,capacity_kg,extra_kg,length_mm,body_height_mm,total_height_mm,team_id)
      VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id`,[b.name,b.capacity_kg,b.extra_kg,b.length_mm,b.body_height_mm,b.total_height_mm,u.team_id]);
    await audit(tx,u,'vehicle.created',result.id);return result;
  });
  for(const op of ['cancel','reschedule','verify-address']){
    action('/orders/:id/'+op,office,op==='reschedule'?v.move:v.version,(tx,u,b,r)=>changeOrder(tx,u,idOf(r),b,op,teamConfig(u),clock()));
  }
  action('/plan',oversight,v.plan,(tx,u,b)=>allocate(tx,u,b,teamConfig(u),clock()));
  action('/shifts/:id/confirm',drivers,z.object({has_loader:z.boolean().optional()}),async(tx,u,b,r)=>{
    const settings=teamConfig(u),now=clock(),id=idOf(r);
    const value=await confirmShift(tx,u,id,settings,now,b);
    if(value.loader_changed)await refreshShiftPlan(tx,id,settings,now);
    return value;
  });
  action('/trips/:id/start',drivers,v.start,(tx,u,b,r)=>startTrip(tx,u,idOf(r),b,config,clock()),{repeat:true});
  action('/orders/:id/deliver',drivers,v.complete,(tx,u,b,r)=>deliver(tx,u,idOf(r),b),{repeat:true});
  action('/orders/:id/fail',drivers,v.failure,(tx,u,b,r)=>failDelivery(tx,u,idOf(r),b),{repeat:true});
  action('/trips/:id/sale',drivers,v.sale,(tx,u,b,r)=>onSiteSale(tx,u,idOf(r),b,config),{repeat:true});
  action('/trips/:id/return',drivers,v.returned,(tx,u,b,r)=>returnTrip(tx,u,idOf(r),b),{repeat:true});
  action('/shifts/:id/settle',drivers,v.settlement,(tx,u,b,r)=>settle(tx,u,idOf(r),b,config),{repeat:true});
  action('/reports/:id/review',oversight,blank,async(tx,u,b,r)=>{
    const id=idOf(r);
    const item=await one(tx,`UPDATE settlements r SET reviewed=true,reviewed_by=$1 FROM shifts s JOIN accounts a ON a.id=s.driver_id
      WHERE r.id=$2 AND r.shift_id=s.id AND a.team_id=$3 RETURNING r.id`,[u.id,id,u.team_id]);
    ensure(item,'Отчёт не найден',404);
    await audit(tx,u,'settlement.reviewed',id);return {ok:true};
  });
  app.use('/api',(req,res)=>res.status(404).json({error:'Метод API не найден'}));
  app.use(express.static(fileURLToPath(new URL('../../web/dist/',import.meta.url))));
  app.use((err,req,res,next)=>{
    if(err instanceof PlaceSearchError){
      if(err.retryAfter)res.set('Retry-After',String(err.retryAfter));
      return res.status(err.status).json({error:err.message});
    }
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
