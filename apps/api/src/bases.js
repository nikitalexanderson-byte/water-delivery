import {readFile} from 'node:fs/promises';
import {one,rows} from './db.js';
import {ensure} from './auth.js';
import {audit} from './day.js';

const trainingBase=JSON.parse(await readFile(new URL('../../../packages/route-map/static/route-map/training-base.json',import.meta.url),'utf8'));

export function trainingDepot(settings){
  if(settings.lat!=null&&settings.lon!=null)return settings;
  return {...settings,...trainingBase};
}

export async function teamBases(tx,teamId){
  const {active_base_id}=await one(tx,'SELECT active_base_id FROM teams WHERE id=$1',[teamId]);
  const bases=await rows(tx,'SELECT id,address,lat,lon FROM team_bases WHERE team_id=$1 ORDER BY id',[teamId]);
  return {active_base_id,bases};
}

export async function addBase(tx,user,{address,lat,lon}){
  return one(tx,'INSERT INTO team_bases(team_id,address,lat,lon) VALUES($1,$2,$3,$4) RETURNING id',
    [user.team_id,address||'Производственная база',lat,lon]);
}

export async function chooseBase(tx,user,id,previous){
  const teamId=user.team_id;
  const base=await one(tx,'SELECT * FROM team_bases WHERE team_id=$1 AND id=$2',[teamId,id]);
  ensure(base,'База не найдена',404);
  if((await one(tx,'SELECT active_base_id FROM teams WHERE id=$1',[teamId])).active_base_id===id)return {ok:true};
  const hasOpen=await one(tx,`SELECT 1 FROM trips t JOIN shifts s ON s.id=t.shift_id JOIN accounts a ON a.id=s.driver_id
    WHERE a.team_id=$1 AND t.status IN ('planned','active') LIMIT 1`,[teamId]);
  ensure(!hasOpen,'Смените базу после завершения запланированных рейсов.');
  // Older completed routes keep the depot used before the first switch.
  await tx.query(`UPDATE trips t SET base_address=$2,base_lat=$3,base_lon=$4 FROM shifts s JOIN accounts a ON a.id=s.driver_id
    WHERE s.id=t.shift_id AND a.team_id=$1 AND t.base_address IS NULL`,[teamId,previous.address,previous.lat,previous.lon]);
  await tx.query('UPDATE teams SET active_base_id=$2,base_address=$3,base_lat=$4,base_lon=$5 WHERE id=$1',
    [teamId,id,base.address,base.lat,base.lon]);
  await audit(tx,user,'team.base_changed',teamId,{base_id:id});
  return {ok:true};
}
