import {database} from '../../apps/api/src/db.js';
import {calendar,configuration} from '../../apps/api/src/config.js';
import {seed} from '../../apps/api/src/seed.js';
import {createApp} from '../../apps/api/src/app.js';

const db=await database({memory:true});
const config={...configuration(),timezone:'Europe/Moscow',price:35000,mapTilesEnabled:process.env.MAP_TILES_ENABLED==='true'};
await seed(db,config,'e2e-farvater-local');
const {today}=calendar(config);
// Freeze the dispatch clock before the early shift; seed dates match the real calendar day.
const morning=new Date(today+'T07:00:00+03:00');
const app=createApp({db,config,clock:()=>morning});
const server=app.listen(Number(process.env.E2E_PORT),'127.0.0.1');
process.once('SIGTERM',()=>server.close(async()=>{await db.close();process.exit(0);}));
