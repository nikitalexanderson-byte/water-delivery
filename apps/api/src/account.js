import {z} from 'zod';
import {database,one,writeLock} from './db.js';
import {passwordHash} from './auth.js';

// Bootstrap an individual account on a new database. Credentials never appear in CLI arguments.
const account=z.object({ACCOUNT_EMAIL:z.email().transform(s=>s.toLowerCase()),ACCOUNT_NAME:z.string().trim().min(1).max(120),
  ACCOUNT_ROLE:z.enum(['driver','manager','operator']),ACCOUNT_PASSWORD:z.string().min(10).max(128),
  ACCOUNT_TEAM_ID:z.coerce.number().int().positive().default(1),
  ACCOUNT_TEAM_NAME:z.string().trim().min(1).max(120).optional()}).parse(process.env);
if(account.ACCOUNT_TEAM_NAME&&account.ACCOUNT_ROLE!=='manager') throw Error('Создать команду можно при настройке администратора');
const db=await database();
try{
  await db.transaction(async tx=>{
    await writeLock(tx);
    if(await one(tx,'SELECT id FROM accounts WHERE email=$1',[account.ACCOUNT_EMAIL])) throw Error('Этот email уже зарегистрирован');
    const teamId=account.ACCOUNT_TEAM_NAME
      ?(await one(tx,'INSERT INTO teams(name) VALUES($1) RETURNING id',[account.ACCOUNT_TEAM_NAME])).id
      :account.ACCOUNT_TEAM_ID;
    if(!await one(tx,'SELECT id FROM teams WHERE id=$1',[teamId])) throw Error('Команда не найдена');
    const row=await one(tx,'INSERT INTO accounts(email,name,role,password_hash,team_id) VALUES($1,$2,$3,$4,$5) RETURNING id',
      [account.ACCOUNT_EMAIL,account.ACCOUNT_NAME,account.ACCOUNT_ROLE,await passwordHash(account.ACCOUNT_PASSWORD),teamId]);
    await tx.query("INSERT INTO audit(event,entity_id) VALUES('account.provisioned',$1)",[row.id]);
  });
  console.log('Учётная запись создана');
}finally{await db.close();}
