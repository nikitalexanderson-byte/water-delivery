import {z} from 'zod';
export const id=z.number().int().positive();
export const date=z.iso.date();
export const minute=z.number().int().min(0).max(1439);
const count=z.number().int().min(0).max(10000);
const money=z.number().int().min(0).max(2000000000);
const text=z.string().trim().min(1).max(300);
export const windowFields={window_start:minute,window_end:minute};
export const goodWindow=x=>x.window_end>x.window_start;
export const version=z.object({version:id});
export const move=version.extend({date,...windowFields}).refine(goodWindow,'Проверьте окно доставки');
export const order=z.object({customer_id:id.optional(), name:text.optional(),phone:z.string().trim().regex(/^\+?[\d ()-]{6,24}$/).optional(),
  address:text.optional(),date,water:count.min(1),new_shells:count.default(0),water_price:money.max(10000000),
  category:z.enum(['retail','wholesale']),payment_method:z.enum(['cash','bank']),company:z.string().trim().max(200).default(''),
  ...windowFields,floor:z.number().int().min(-5).max(150).default(1),lift:z.boolean().default(true),
  checkpoint:z.boolean().default(false),height_limit_mm:id.max(15000).nullish(),note:z.string().trim().max(1000).default(''),
  address_verified:z.boolean().default(false)})
  .refine(goodWindow,'Окончание окна должно быть позже начала')
  .refine(x=>x.customer_id || (x.name && x.phone && x.address),'Укажите имя, телефон и адрес клиента')
  .refine(x=>x.payment_method!=='bank'||x.company,'Для безнала укажите компанию')
  .refine(x=>x.new_shells<=x.water,'Количество новой тары превышает количество бутылей');
export const plan=z.object({date,order_id:id.optional(),shift_id:id.optional()})
  .refine(x=>Boolean(x.order_id)===Boolean(x.shift_id),'Для ручного назначения выберите заказ и смену');
export const shift=z.object({date,driver_id:id,vehicle_id:id,start_min:minute,end_min:minute,has_loader:z.boolean().default(false)})
  .refine(x=>x.end_min>x.start_min,'Окончание смены должно быть позже начала');
export const vehicle=z.object({total_height_mm:id.max(15000).nullable(),extra_kg:count});
export const start=z.object({actual_start:minute,water:count.min(1)});
export const complete=z.object({version:id,empty:count,paid:z.boolean()});
export const returned=z.object({actual_return:minute});
export const settlement=z.object({water:count,empty:count,cash:money,bank:money,loader_minutes:minute});
export const login=z.object({email:z.email().max(254).transform(v=>v.toLowerCase()),password:z.string().min(1).max(256)});
