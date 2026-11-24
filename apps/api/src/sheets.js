import {randomUUID,sign} from 'node:crypto';
import {one} from './db.js';

const headings=['Отчёт №','Дата','Смена №','Экспедитор','Автомобиль','Рейсы','Точки розницы','Точки опта',
  'Выдано бутылей','Продано тары','Вода по учёту, шт.','Сдано воды, шт.','Тара по учёту, шт.','Сдано тары, шт.',
  'Наличные по учёту, ₽','Сдано наличных, ₽','Безнал по учёту, ₽','Сдано безнала, ₽','Не оплачено, ₽',
  'Вознаграждение экспедитора, ₽','Часы грузчика','Сверка'];

export function sheetsConfiguration(env=process.env){
  const enabled=(env.SHEETS_EXPORT_ENABLED||'false').toLowerCase();
  if(!['false','true'].includes(enabled))throw Error('SHEETS_EXPORT_ENABLED принимает true или false');
  if(enabled==='false')return {enabled:false};
  const {SHEETS_SPREADSHEET_ID:id,SHEETS_CLIENT_EMAIL:email,SHEETS_PRIVATE_KEY:pem}=env;
  const teamId=Number(env.SHEETS_TEAM_ID||1);
  const title=(env.SHEETS_TAB||'ФАРВАТЕР — смены').trim();
  if(!/^[\w-]{10,160}$/.test(id||'')||!email?.includes('@')||!pem?.includes('PRIVATE KEY')||
      !Number.isSafeInteger(teamId)||teamId<1||!title||title.length>90||/[\[\]*?:/\\]/.test(title))throw Error('Проверьте параметры выгрузки SHEETS_*');
  return {enabled:true,id,email,pem:pem.replace(/\\n/g,'\n'),title,teamId};
}

export async function queueSheetExport(tx,shift,user,report){
  const details=await one(tx,`SELECT v.name,
    (SELECT count(*)::int FROM trips WHERE shift_id=$1) AS trips,
    (SELECT count(DISTINCT CASE WHEN o.origin='on_site' THEN COALESCE(o.source_order_id,o.id) ELSE o.id END)::int
       FROM orders o JOIN trips t ON t.id=o.trip_id WHERE t.shift_id=$1 AND o.status='delivered' AND o.category='retail') AS retail
    FROM vehicles v WHERE v.id=$2`,[shift.id,shift.vehicle_id]);
  const e=report.expected,a=report.actual;
  const row=[report.id,shift.date,shift.id,user.name,details.name,details.trips,details.retail,report.delivered_stops-details.retail,
    report.delivered_water,report.sold_shells,e.water,a.water,e.empty,a.empty,e.cash/100,a.cash/100,e.bank/100,a.bank/100,
    Number(report.unpaid)/100,Number(report.earnings)/100,report.loader_minutes/60,report.matched?'Отчёт совпал':'Отчёт не совпал'];
  await tx.query('INSERT INTO sheet_exports(settlement_id,payload) VALUES($1,$2)',[report.id,JSON.stringify(row)]);
}

export function googleSheetWriter(settings,http=fetch){
  let token='',expires=0;
  const root='https://sheets.googleapis.com/v4/spreadsheets/'+settings.id;
  const quoted="'"+settings.title.replaceAll("'","''")+"'";
  async function access(){
    if(token&&Date.now()<expires)return token;
    const now=Math.floor(Date.now()/1000);
    const encode=obj=>Buffer.from(JSON.stringify(obj)).toString('base64url');
    const endpoint='https://oauth2.googleapis.com/token';
    const claims=encode({alg:'RS256',typ:'JWT'})+'.'+encode({iss:settings.email,aud:endpoint,
      scope:'https://www.googleapis.com/auth/spreadsheets',iat:now,exp:now+3600});
    const assertion=claims+'.'+sign('RSA-SHA256',Buffer.from(claims),settings.pem).toString('base64url');
    const response=await http(endpoint,{method:'POST',signal:AbortSignal.timeout(12000),
      body:new URLSearchParams({grant_type:'urn:ietf:params:oauth:grant-type:jwt-bearer',assertion})});
    if(!response.ok)throw Error('Авторизация Google: HTTP '+response.status);
    const value=await response.json();
    if(!value.access_token)throw Error('Google не вернул токен');
    token=value.access_token;expires=Date.now()+(Number(value.expires_in||3600)-60)*1000;
    return token;
  }
  async function api(path,body){
    const response=await http(root+path,{method:body?'POST':'GET',signal:AbortSignal.timeout(12000),
      headers:{Authorization:'Bearer '+await access(),'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});
    if(response.status===401)expires=0;
    if(!response.ok)throw Error('Google Таблицы: HTTP '+response.status);
    return response.json();
  }
  return async row=>{
    const number=row[0]+1;
    const book=await api('?fields=sheets(properties(sheetId,title,gridProperties(rowCount,columnCount)))');
    const sheet=book.sheets?.find(s=>s.properties.title===settings.title)?.properties;
    if(!sheet){
      await api(':batchUpdate',{requests:[{addSheet:{properties:{title:settings.title,
        gridProperties:{rowCount:Math.max(number,1000),columnCount:Math.max(headings.length,26)}}}}]});
    }else{
      const resizes=[];
      for(const [dimension,have,need] of [['ROWS',sheet.gridProperties.rowCount,number],['COLUMNS',sheet.gridProperties.columnCount,headings.length]]){
        if(have<need)resizes.push({appendDimension:{sheetId:sheet.sheetId,dimension,length:need-have}});
      }
      if(resizes.length)await api(':batchUpdate',{requests:resizes});
    }
    const header=quoted+'!A1:V1',target=quoted+'!A'+number+':V'+number;
    const args=new URLSearchParams();args.append('ranges',header);args.append('ranges',target);
    const existing=await api('/values:batchGet?'+args);
    const [savedHeader,savedRow]=existing.valueRanges.map(range=>range.values?.[0]??[]);
    if(savedHeader.length&&JSON.stringify(savedHeader)!==JSON.stringify(headings))throw Error('Заголовки листа отличаются. Укажите отдельный лист для отчётов WaySlate.');
    if(savedRow.length&&String(savedRow[0])!==String(row[0]))throw Error('Строка листа занята. Проверьте выделенный лист.');
    await api('/values:batchUpdate',{valueInputOption:'RAW',data:[
      {range:header,values:[headings]},{range:target,values:[row]}]});
  };
}

export async function exportOne(db,write){
  const lease=randomUUID();
  const row=await db.transaction(tx=>one(tx,`UPDATE sheet_exports SET lease=$1,attempts=attempts+1,
    next_attempt=now()+interval '3 minutes' WHERE settlement_id=(SELECT settlement_id FROM sheet_exports
    WHERE sent_at IS NULL AND next_attempt<=now() ORDER BY next_attempt,settlement_id LIMIT 1 FOR UPDATE SKIP LOCKED)
    RETURNING settlement_id,payload,attempts`,[lease]));
  if(!row)return false;
  try{
    await write(row.payload);
    await db.transaction(tx=>tx.query('UPDATE sheet_exports SET sent_at=now(),lease=NULL,last_error=NULL WHERE settlement_id=$1 AND lease=$2',[row.settlement_id,lease]));
  }catch(err){
    const delay=Math.min(3600,15*2**Math.min(row.attempts-1,8));
    await db.transaction(tx=>tx.query(`UPDATE sheet_exports SET last_error=$3,lease=NULL,next_attempt=now()+$4*interval '1 second'
      WHERE settlement_id=$1 AND lease=$2`,[row.settlement_id,lease,String(err.message).slice(0,200),delay]));
  }
  return true;
}

export function startSheetWorker(db,settings){
  if(!settings.enabled)return async()=>{};
  const write=googleSheetWriter(settings);
  let running=null;
  const tick=()=>{if(!running)running=exportOne(db,write).catch(()=>console.error('Не удалось обработать очередь отчётов')).finally(()=>{running=null;});};
  const timer=setInterval(tick,5000);timer.unref();tick();
  return async()=>{clearInterval(timer);await running;};
}
