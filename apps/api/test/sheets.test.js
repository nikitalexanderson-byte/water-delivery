import assert from 'node:assert/strict';
import {generateKeyPairSync} from 'node:crypto';
import {test} from 'node:test';
import {googleSheetWriter,sheetsConfiguration} from '../src/sheets.js';

test('Google Таблицы получают один и тот же адрес строки при повторе и значения в RAW',async()=>{
  const {privateKey}=generateKeyPairSync('rsa',{modulusLength:2048,
    privateKeyEncoding:{format:'pem',type:'pkcs8'},publicKeyEncoding:{format:'pem',type:'spki'}});
  const title="Рабочий лист 'Фарватер'";
  const config=sheetsConfiguration({SHEETS_EXPORT_ENABLED:'true',SHEETS_TEAM_ID:'2',SHEETS_SPREADSHEET_ID:'test-sheet-id',
    SHEETS_CLIENT_EMAIL:'sheet-test@example.test',SHEETS_PRIVATE_KEY:privateKey,SHEETS_TAB:title});
  assert.equal(config.teamId,2);
  const writes=[];
  let auth=0;
  const fake=async(raw,options)=>{
    const url=new URL(raw);
    if(url.hostname==='oauth2.googleapis.com'){
      auth++;assert.equal(options.body.get('assertion').split('.').length,3);
      return Response.json({access_token:'fake',expires_in:3600});
    }
    assert.equal(options.headers.Authorization,'Bearer fake');
    if(url.pathname.endsWith('/values:batchGet')){
      assert.deepEqual(url.searchParams.getAll('ranges'),["'Рабочий лист ''Фарватер'''!A1:V1","'Рабочий лист ''Фарватер'''!A11:V11"]);
      return Response.json({valueRanges:writes.length?writes.at(-1).data:[{},{}]});
    }
    if(url.pathname.endsWith('/values:batchUpdate')){
      writes.push(JSON.parse(options.body));
      return Response.json({});
    }
    return Response.json({sheets:[{properties:{sheetId:5,title,gridProperties:{rowCount:100,columnCount:26}}}]});
  };
  const row=[10,'2026-11-23',2,'=Имя из анкеты'];
  const exportReport=googleSheetWriter(config,fake);
  await exportReport(row);
  await exportReport(row);
  assert.equal(auth,1);
  assert.deepEqual(writes[0],writes[1]);
  assert.equal(writes[0].valueInputOption,'RAW');
  assert.deepEqual(writes[0].data[1].values,[row]);
});
