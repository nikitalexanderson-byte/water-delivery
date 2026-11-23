import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtemp,rename,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {test} from 'node:test';
import {strToU8,zipSync} from 'fflate';
import {appRelease} from '../src/app-release.js';

test('Метаданные соответствуют APK, в том числе после атомарной замены файла', async t=>{
  const directory=await mkdtemp(join(tmpdir(),'farvater-apk-'));
  t.after(()=>rm(directory,{recursive:true,force:true}));
  const path=join(directory,'farvater-driver.apk');
  const read=appRelease(path);
  assert.equal(await read(),null);
  await writeFile(path,zipSync({'AndroidManifest.xml':strToU8('old build')}));
  assert.equal(await read(),null);

  async function publish(version){
    const apk=zipSync({'assets/farvater-release.json':strToU8(JSON.stringify({version_code:version}))});
    await writeFile(path+'.tmp',apk);
    await rename(path+'.tmp',path);
    return {version_code:version,size_bytes:apk.length,sha256:createHash('sha256').update(apk).digest('hex')};
  }
  for(const version of [190,191]){
    const expected=await publish(version);
    assert.deepEqual(await read(),expected);
    assert.deepEqual(await read(),expected);
  }
  await publish(-1);
  assert.equal(await read(),null);
});
