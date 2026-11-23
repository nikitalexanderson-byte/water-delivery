import {z} from 'zod';
import {database,one,writeLock} from './db.js';
import {passwordHash} from './auth.js';

// Bootstrap an individual account on a new database. Credentials never appear in CLI arguments.
const account=z.object({ACCOUNT_EMAIL:z.email().transform(s=>s.toLowerCase()),ACCOUNT_NAME:z.string().trim().min(1).max(120),
  ACCOUNT_ROLE:z.enum(['driver','manager','dispatcher','operator']),ACCOUNT_PASSWORD:z.string().min(10).max(128)}).parse(process.env);
const db=await database();
try{
  await db.transaction(async tx=>{
    await writeLock(tx);
    if(await one(tx,'SELECT id FROM accounts WHERE email=$1',[account.ACCOUNT_EMAIL])) throw Error('Этот email уже зарегистрирован');
    const row=await one(tx,'INSERT INTO accounts(email,name,role,password_hash) VALUES($1,$2,$3,$4) RETURNING id',
      [account.ACCOUNT_EMAIL,account.ACCOUNT_NAME,account.ACCOUNT_ROLE,await passwordHash(account.ACCOUNT_PASSWORD)]);
    await tx.query("INSERT INTO audit(event,entity_id) VALUES('account.provisioned',$1)",[row.id]);
  });
  console.log('Учётная запись создана');
}finally{await db.close();}
