import {createHash} from 'node:crypto';
import {open} from 'node:fs/promises';
import {unzipSync} from 'fflate';

const filename='assets/farvater-release.json';
const maxApkBytes=128*1024*1024;

export function appRelease(path){
  let cache;
  return async()=>{
    if(!path)return null;
    const file=await open(path,'r').catch(error=>{
      if(error.code!=='ENOENT')throw error;
    });
    if(!file)return null;
    try{
      const {ino,mtimeMs,size}=await file.stat();
      if(!size||size>maxApkBytes)return null;
      const identity=`${ino}:${mtimeMs}:${size}`;
      if(cache?.identity===identity)return cache.release;
      const apk=await file.readFile();
      let release=null;
      try{
        const data=unzipSync(apk,{filter:entry=>entry.name===filename
          &&entry.size<=256&&entry.originalSize<=256})[filename];
        const version=JSON.parse(Buffer.from(data).toString('utf8')).version_code;
        if(Number.isSafeInteger(version)&&version>0&&version<=2100000000){
          release={version_code:version,size_bytes:apk.length,sha256:createHash('sha256').update(apk).digest('hex')};
        }
      }catch{
        // Builds published before update metadata is supported remain downloadable.
      }
      cache={identity,release};
      return release;
    }finally{
      await file.close();
    }
  };
}
