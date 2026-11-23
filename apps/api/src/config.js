import { z } from 'zod';

const number = (key, fallback, min = 0, max = 100000) =>
  z.coerce.number().min(min).max(max).parse(process.env[key] || fallback);

export function configuration() {
  const timezone = process.env.BUSINESS_TZ || 'Europe/Moscow';
  new Intl.DateTimeFormat('ru', {timeZone: timezone});
  const address = process.env.BASE_ADDRESS?.trim() || '';
  const coord = (key, limit) => process.env[key]?.trim() ? number(key, 0, -limit, limit) : null;
  const lat = coord('BASE_LAT', 90), lon = coord('BASE_LON', 180);
  if ((lat === null) !== (lon === null)) throw Error('Задайте обе координаты базы');
  if ((process.env.MAP_PROVIDER || 'demo') !== 'demo') throw Error('Доступен провайдер demo');
  return { timezone, address, lat, lon, price: number('DEMO_WATER_PRICE_KOP',35000),
    shellPrice: 25000, sessionHours: number('SESSION_HOURS',12,1,720),
    host: process.env.API_HOST || '127.0.0.1', port: number('API_PORT',8080,1,65535),
    routing: {legMinutes:number('DEMO_LEG_MINUTES',15,1),stopBase:number('STOP_BASE_MINUTES',8),
      stopPerBottle:number('STOP_PER_BOTTLE_MINUTES',0.7),reloadMinutes:number('RELOAD_MINUTES',20),
      floorMinutes:number('FLOOR_MINUTES',2),checkpointMinutes:number('CHECKPOINT_MINUTES',5),
      loaderFactor:number('LOADER_FACTOR',0.75,0.01,1)} };
}

export function calendar(config, now = new Date()) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {timeZone:config.timezone,
    year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'})
    .formatToParts(now).map(part => [part.type,part.value]));
  const today = [parts.year,parts.month,parts.day].join('-');
  const tomorrow = new Date(Date.parse(today+'T00:00:00Z')+86400000).toISOString().slice(0,10);
  return {today,tomorrow,minute:Number(parts.hour)*60+Number(parts.minute)};
}
