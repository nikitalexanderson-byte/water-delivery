import {database} from './db.js';
import {configuration} from './config.js';
import {seed} from './seed.js';
import {createApp} from './app.js';
import {startSheetWorker} from './sheets.js';

const config=configuration();
const db=await database();
if(process.env.SEED_DEMO==='true') await seed(db,config,process.env.DEMO_PASSWORD);
const server=createApp({db,config}).listen(config.port,config.host,()=>console.log('WaySlate · '+config.host+':'+config.port));
const stopExports=startSheetWorker(db,config.sheets);
const shutdown=()=>server.close(async()=>{await stopExports();await db.close();process.exit(0);});
process.once('SIGTERM',shutdown);
process.once('SIGINT',shutdown);
