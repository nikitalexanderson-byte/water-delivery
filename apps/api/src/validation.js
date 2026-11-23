import {z} from 'zod';
export const id=z.number().int().positive();
export const date=z.iso.date();
export const minute=z.number().int().min(0).max(1439);
const count=z.number().int().min(0).max(10000);
const money=z.number().int().min(0).max(2000000000);
const text=z.string().trim().min(1).max(300);
// В строку адреса иногда вставляют весь текст заявки вместе с контактами и кодом входа.
const privateContact=/(?:\+(?:[ ()-]*\d){7,15}|(?<!\d)[78](?:[ ()-]*\d){10}(?!\d)|(?:домофон(?:а)?|код\s+подъезда|телефон|тел\.)\s*[:№-]?\s*[+\d#*])/iu;
export const placeQuery=z.string().trim().min(3).max(200)
  .refine(q=>!privateContact.test(q),'Введите только адрес или название места. Телефон и домофон указываются отдельно.');
const price=money.max(10000000);
const counted=z.object({product_id:id,water:count});
const basket=z.array(counted.extend({water:count.min(1),water_price:price.optional()})).min(1).max(500);
export const windowFields={window_start:minute,window_end:minute};
export const goodWindow=x=>x.window_end>x.window_start;
export const version=z.object({version:id});
export const move=version.extend({date,...windowFields}).refine(goodWindow,'Проверьте окно доставки');
const altPhone=z.string().trim().max(24).refine(value=>{
  const digits=value.replace(/\D/g,'').length;
  return !value || (/^\+?[0-9 ()-]+$/.test(value) && digits>=6 && digits<=15);
},'Проверьте дополнительный телефон');
export const order=z.object({customer_id:id.optional(), name:text.optional(),phone:z.string().trim().regex(/^\+?[\d ()-]{6,24}$/).optional(),
  latitude:z.number().min(-90).max(90).nullish(),longitude:z.number().min(-180).max(180).nullish(),
  alt_phone:altPhone.optional(),entrance:z.string().trim().max(40).optional(),unit:z.string().trim().max(40).optional(),
  parking_minutes:z.number().int().min(0).max(120).optional(),has_cart:z.boolean().optional(),can_deliver_today:z.boolean().optional(),
  intercom:z.string().trim().max(80).optional(),access_instructions:z.string().trim().max(1000).optional(),paid_entry:z.boolean().optional(),
  address:text.optional(),date,water:count.min(1).optional(),new_shells:count.default(0),water_price:price.optional(),
  items:basket.optional(),product_id:id.optional(),
  category:z.enum(['retail','wholesale']),payment_method:z.enum(['cash','bank']),company:z.string().trim().max(200).default(''),
  ...windowFields,floor:z.number().int().min(-5).max(150).default(1),lift:z.boolean().default(true),
  checkpoint:z.boolean().default(false),height_limit_mm:id.max(15000).nullish(),note:z.string().trim().max(1000).default(''),
  address_verified:z.boolean().default(false)})
  .refine(goodWindow,'Окончание окна должно быть позже начала')
  .refine(x=>(x.latitude===undefined && x.longitude===undefined) || (x.latitude===null && x.longitude===null) ||
    (typeof x.latitude==='number' && typeof x.longitude==='number'),'Укажите широту и долготу вместе')
  .refine(x=>x.customer_id || (x.name && x.phone && x.address),'Укажите имя, телефон и адрес клиента')
  .refine(x=>x.payment_method!=='bank'||x.company,'Для безнала укажите компанию')
  .refine(x=>x.items || (x.water!=null && x.water_price!=null),'Укажите состав заказа и цену');
export const orderEdit=order.safeExtend({version:id,customer_id:id});
export const plan=z.object({date,order_id:id.optional(),shift_id:id.optional(),version:id.optional()})
  .refine(x=>Boolean(x.order_id)===Boolean(x.shift_id),'Для ручного назначения выберите заказ и смену');
export const shift=z.object({date,driver_id:id,vehicle_id:id,start_min:minute,end_min:minute,has_loader:z.boolean().default(false)})
  .refine(x=>x.end_min>x.start_min,'Окончание смены должно быть позже начала');
export const vehicle=z.object({total_height_mm:id.max(15000).nullable(),extra_kg:count});
export const newVehicle=vehicle.extend({name:text,capacity_kg:id.max(100000),length_mm:id.max(30000),body_height_mm:id.max(10000)})
  .refine(x=>x.extra_kg<=x.capacity_kg,'Масса оборудования превышает грузоподъёмность');
export const account=z.object({email:z.email().max(254).transform(s=>s.toLowerCase()),name:text,password:z.string().min(10).max(128),
  role:z.enum(['manager','operator','dispatcher','driver'])});
export const product=z.object({name:text,water_price:price,active:z.boolean().optional()});
export const start=z.object({actual_start:minute,water:count.min(1),items:z.array(counted).optional()});
export const complete=z.object({version:id,empty:count,paid:z.boolean()});
export const failure=version.extend({reason:z.string().trim().min(1).max(500)});
export const sale=z.object({customer_order_id:id.optional(),
  new_customer:z.object({name:text,phone:z.string().trim().regex(/^\+?[\d ()-]{6,24}$/),address:text,category:z.enum(['retail','wholesale'])}).optional(),
  product_id:id.optional(),water:count.min(1),new_shells:count,water_price:price,
  payment_method:z.enum(['cash','bank']),company:z.string().trim().max(200).default(''),paid:z.boolean(),empty:count})
  .refine(x=>Boolean(x.customer_order_id)!==Boolean(x.new_customer),'Укажите точку рейса или нового клиента')
  .refine(x=>x.new_shells<=x.water,'Новой тары больше, чем воды')
  .refine(x=>x.payment_method!=='bank'||x.company,'Для безнала укажите компанию');
export const returned=z.object({actual_return:minute});
export const settlement=z.object({water:count,empty:count,cash:money,bank:money,loader_minutes:minute,items:z.array(counted).optional()});
export const login=z.object({email:z.email().max(254).transform(v=>v.toLowerCase()),password:z.string().min(1).max(256)});
