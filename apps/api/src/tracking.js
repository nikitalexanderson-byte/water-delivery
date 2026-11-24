import {ensure} from './auth.js';
import {one,rows} from './db.js';

export function currentLocations(tx,user,date,now){
  const driver=user.role==='driver'?user.id:null;
  return rows(tx,`SELECT l.trip_id,l.lat,l.lon,l.accuracy,l.bearing,l.observed_at,
    l.observed_at < $4::timestamptz - interval '45 seconds' AS stale, a.name AS driver_name
    FROM trip_locations l JOIN trips t ON t.id=l.trip_id JOIN shifts s ON s.id=t.shift_id
    JOIN accounts a ON a.id=s.driver_id
    WHERE a.team_id=$1 AND s.date=$2 AND ($3::int IS NULL OR a.id=$3) AND t.status='active'
      AND l.observed_at >= $4::timestamptz - interval '5 minutes' ORDER BY l.trip_id`,[user.team_id,date,driver,now.toISOString()]);
}

export async function updateLocation(tx,user,id,input,now){
  const trip=await one(tx,`SELECT t.status FROM trips t JOIN shifts s ON s.id=t.shift_id
    JOIN accounts a ON a.id=s.driver_id WHERE t.id=$1 AND a.id=$2 AND a.team_id=$3 FOR SHARE OF t`,[id,user.id,user.team_id]);
  ensure(trip,'Рейс не найден',404);
  if(input===null){
    await tx.query('DELETE FROM trip_locations WHERE trip_id=$1',[id]);
    return {ok:true};
  }
  ensure(trip.status==='active','Передача геопозиции доступна во время рейса.',409);
  const observed=Date.parse(input.observed_at);
  ensure(observed>=+now-120000&&observed<=+now+30000,'Уточните время устройства и обновите геопозицию.',400);
  await tx.query(`INSERT INTO trip_locations (trip_id,lat,lon,accuracy,bearing,observed_at) VALUES($1,$2,$3,$4,$5,$6)
    ON CONFLICT(trip_id) DO UPDATE SET lat=EXCLUDED.lat,lon=EXCLUDED.lon,accuracy=EXCLUDED.accuracy,
      bearing=EXCLUDED.bearing,observed_at=EXCLUDED.observed_at
    WHERE trip_locations.observed_at<EXCLUDED.observed_at`,[id,input.lat,input.lon,input.accuracy,input.bearing,input.observed_at]);
  return {ok:true};
}
