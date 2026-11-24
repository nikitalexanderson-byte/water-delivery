import {randomBytes} from 'node:crypto';
import {digest,ensure,passwordHash} from './auth.js';
import {one,rows} from './db.js';
import {audit} from './day.js';

export const teamUserColumns='a.id,a.email,a.name,a.role,a.team_id,t.name AS team_name';

export function accountById(tx,id){
  return one(tx,`SELECT ${teamUserColumns} FROM accounts a LEFT JOIN teams t ON t.id=a.team_id WHERE a.id=$1`,[id]);
}

export async function register(tx,values,sessionHours){
  const invitation=await one(tx,`SELECT role FROM invitations WHERE digest=$1 AND used_by IS NULL AND expires_at>now()`,[digest(values.code)]);
  checkInvitation(invitation,values.role);
  const account=await one(tx,`INSERT INTO accounts(email,name,role,password_hash,team_id)
    VALUES($1,$2,$3,$4,NULL) ON CONFLICT(email) DO NOTHING RETURNING id`,
    [values.email,values.name,values.role,await passwordHash(values.password)]);
  ensure(account,'Этот email уже зарегистрирован. Войдите в кабинет.',409);
  const {user}=await joinTeam(tx,account,values);
  return beginSession(tx,user,sessionHours);
}

export async function beginSession(tx,user,sessionHours){
  const token=randomBytes(32).toString('hex');
  await tx.query('DELETE FROM sessions WHERE expires_at<=now()');
  await tx.query("INSERT INTO sessions VALUES($1,$2,now()+$3*interval '1 hour')",[digest(token),user.id,sessionHours]);
  return {token,user};
}

async function requireNewAccount(tx,user){
  const account=await one(tx,'SELECT team_id FROM accounts WHERE id=$1 FOR UPDATE',[user.id]);
  ensure(account&&account.team_id===null,'Вы уже состоите в команде.');
}

function checkInvitation(invite,role){
  ensure(invite,'Код недействителен. Попросите администратора выдать новое приглашение.',409);
  ensure(!role||invite.role===role,'Код выдан для другой роли. Проверьте приглашение.',409);
}

export async function joinTeam(tx,user,{code}){
  await requireNewAccount(tx,user);
  const invite=await one(tx,`UPDATE invitations SET used_by=$2,used_at=now()
    WHERE digest=$1 AND used_by IS NULL AND expires_at>now() RETURNING team_id,role`,[digest(code),user.id]);
  checkInvitation(invite);
  await tx.query('UPDATE accounts SET team_id=$1,role=$2 WHERE id=$3',[invite.team_id,invite.role,user.id]);
  await audit(tx,user,'team.joined',invite.team_id,{role:invite.role});
  return {user:await accountById(tx,user.id)};
}

export async function inviteMember(tx,user,{role}){
  const code=randomBytes(16).toString('hex');
  const invite=await one(tx,`INSERT INTO invitations(digest,team_id,role,created_by,expires_at)
    VALUES($1,$2,$3,$4,now()+interval '48 hours') RETURNING expires_at`,[digest(code),user.team_id,role,user.id]);
  await audit(tx,user,'team.invited',user.team_id,{role});
  return {code,expires_at:invite.expires_at};
}

export function members(tx,teamId){
  return rows(tx,"SELECT id,name,role FROM accounts WHERE team_id=$1 ORDER BY CASE WHEN role='manager' THEN 0 ELSE 1 END,name,id",[teamId]);
}

export function staffActivity(tx,teamId){
  return rows(tx,`SELECT a.id,a.created_at,a.event,a.entity_id AS order_id,
    employee.name AS actor_name,employee.role AS actor_role,driver.name AS driver_name
    FROM accounts employee JOIN audit a ON a.actor=employee.id
    LEFT JOIN shifts target ON target.id=(a.details->>'to_shift')::integer
    LEFT JOIN accounts driver ON driver.id=target.driver_id AND driver.team_id=employee.team_id
    WHERE employee.team_id=$1 AND a.event IN ('order.created','order.edited','order.assigned',
      'order.reassigned','order.reschedule','order.rescheduled_after_failure','order.cancel','order.arrived',
      'order.delivered','order.failed','order.on_site')
    AND NOT (a.event='order.delivered' AND EXISTS (SELECT 1 FROM orders o WHERE o.id=a.entity_id AND o.origin='on_site'))
    ORDER BY a.id DESC LIMIT 30`,[teamId]);
}
