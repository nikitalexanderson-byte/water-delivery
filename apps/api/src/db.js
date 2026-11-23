import {readdir, readFile, mkdir} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {homedir} from 'node:os';
import {createHash} from 'node:crypto';
import lockfile from 'proper-lockfile';
import {Pool, types} from 'pg';
import {PGlite} from '@electric-sql/pglite';

types.setTypeParser(1082, value => value);
types.setTypeParser(20, value => Number(value));
const migrations = new URL('../migrations/',import.meta.url);
function localDirectory(){
  const state=process.env.LOCALAPPDATA || process.env.XDG_STATE_HOME || join(homedir(),'.local','state');
  const instance=createHash('sha256').update(resolve('.')).digest('hex').slice(0,12);
  return join(state,'Farvater',instance,'postgres');
}

export async function database({url=process.env.DATABASE_URL, host=process.env.PGHOST,
  dir=process.env.LOCAL_DB_DIR||localDirectory(), memory=false}={}) {
  let transaction, close;
  if ((url || host) && !memory) {
    const pool = new Pool(url ? {connectionString:url} : {});
    transaction = async work => {
      const connection = await pool.connect();
      try {
        await connection.query('BEGIN');
        const value = await work({query:(sql,args)=>connection.query(sql,args),exec:sql=>connection.query(sql)});
        await connection.query('COMMIT');
        return value;
      } catch (error) { await connection.query('ROLLBACK'); throw error; }
      finally { connection.release(); }
    };
    close = () => pool.end();
  } else {
    let release=async()=>{};
    if (!memory) {
      await mkdir(dir,{recursive:true});
      try { release=await lockfile.lock(dir,{stale:30000}); }
      catch(error){
        if(error.code==='ELOCKED') throw Error('Локальная база уже открыта. Используйте запущенный API или остановите его перед обслуживанием.');
        throw error;
      }
    }
    let local;
    try { local=await PGlite.create(memory ? undefined : dir); }
    catch(error){ await release();throw error; }
    transaction = work => local.transaction(work);
    close = async () => { try {await local.close();} finally {await release();} };
  }
  try { await transaction(async tx => {
    await tx.query('SELECT pg_advisory_xact_lock(1942001)');
    await tx.exec('CREATE TABLE IF NOT EXISTS migrations(name text primary key, applied_at timestamptz default now())');
    for (const name of (await readdir(migrations)).filter(f=>f.endsWith('.sql')).sort()) {
      if ((await tx.query('SELECT 1 FROM migrations WHERE name=$1',[name])).rows.length) continue;
      await tx.exec(await readFile(new URL(name,migrations),'utf8'));
      await tx.query('INSERT INTO migrations(name) VALUES($1)',[name]);
    }
  }); } catch(error){ await close();throw error; }
  return {transaction,close};
}

export const rows = async (tx,sql,args=[]) => (await tx.query(sql,args)).rows;
export const one = async (tx,sql,args=[]) => (await rows(tx,sql,args))[0];
export const writeLock = tx => tx.query('SELECT id FROM app_guard WHERE id=1 FOR UPDATE');
