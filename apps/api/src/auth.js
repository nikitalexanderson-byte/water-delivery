import {randomBytes,scrypt,timingSafeEqual,createHash} from 'node:crypto';
import {promisify} from 'node:util';
const derive = promisify(scrypt);
export const digest = text => createHash('sha256').update(text).digest('hex');
export async function passwordHash(password){
  const salt=randomBytes(16).toString('hex');
  return salt+'.'+(await derive(password,salt,64)).toString('hex');
}
export async function passwordMatches(password,hash){
  const [salt,hex]=hash.split('.');
  return timingSafeEqual(await derive(password,salt,64),Buffer.from(hex,'hex'));
}
export function ensure(condition,message,status=409){
  if(!condition) throw Object.assign(new Error(message),{status});
}
