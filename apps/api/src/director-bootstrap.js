import {z} from 'zod';
import {digest,ensure,passwordHash} from './auth.js';
import {one,writeLock} from './db.js';

const host='81-177-166-235.sslip.io';
const proof='45ad6bb344d49cee7d4430173acdfc17f35858e13c9e5b68943add1347e3bbad';
const emailDomain='wayslate.test';
const teamName='WaySlate · Демо для директора';
const accounts=[
  ['manager','demo-admin','Демо-администратор'],
  ['operator','demo-operator','Демо-оператор'],
  ['driver','demo-driver','Демо-экспедитор']
];
const password=z.string().regex(/^[A-Za-z0-9_-]{20}$/);
const passwords=z.strictObject({manager:password,operator:password,driver:password});

export function installDirectorBootstrap(app,db,site){
  if(site!==host&&site!=='https://'+host) return;
  app.post('/api/ops/director-demo',async(req,res)=>{
    const key=req.get('authorization')?.match(/^Bearer ([a-f0-9]{64})$/)?.[1];
    ensure(req.hostname===host&&key&&digest(key)===proof,'Метод API не найден',404);
    const input=passwords.parse(req.body);
    const entries=await Promise.all(accounts.map(async ([role,login,name])=>({
      role,email:login+'@'+emailDomain,name,hash:await passwordHash(input[role])
    })));
    const team=await db.transaction(async tx=>{
      await writeLock(tx);
      const existing=await one(tx,'SELECT 1 FROM accounts WHERE email=ANY($1::text[])',[entries.map(a=>a.email)]);
      ensure(!existing,'Демонстрационные адреса уже заняты.',409);
      const {id}=await one(tx,'INSERT INTO teams(name) VALUES($1) RETURNING id',[teamName]);
      for(const {role,email,name,hash} of entries){
        const user=await one(tx,'INSERT INTO accounts(email,name,role,password_hash,team_id) VALUES($1,$2,$3,$4,$5) RETURNING id',
          [email,name,role,hash,id]);
        await tx.query("INSERT INTO audit(event,entity_id) VALUES('account.provisioned',$1)",[user.id]);
      }
      return id;
    });
    res.status(201).json({team_id:team});
  });
}
