import React,{useRef,useState} from 'react';
import {Dialog,Field} from './ui';
import {roleNames} from './api';

function EmployeeFields(){
  return <>
    <Field label="Имя сотрудника" wide><input required name="name" maxLength={300} autoFocus autoComplete="off"/></Field>
    <Field label="Электронная почта для входа" wide><input type="email" required name="email" maxLength={254} autoComplete="off"/></Field>
    <Field label="Роль"><select name="role" defaultValue="driver"><option value="driver">Экспедитор</option>
      {Object.entries(roleNames).map(([role,name])=><option key={role} value={role}>{name}</option>)}</select></Field>
    <Field label="Пароль для входа (от 10 символов)" wide><input type="password" required minLength={10} maxLength={128} name="password" autoComplete="new-password"/></Field>
  </>;
}

function VehicleFields(){
  return <>
    <Field label="Название машины" wide><input name="name" required maxLength={300} autoFocus placeholder="Модель и обозначение в автопарке"/></Field>
    <Field label="Грузоподъёмность, кг"><input type="number" name="capacity" required min="1" max="100000" step="1"/></Field>
    <Field label="Дополнительный груз, кг"><input type="number" name="extra" required min="0" max="10000" step="1" defaultValue="0"/></Field>
    <Field label="Длина кузова, м"><input type="number" name="length" required min="0.001" max="30" step="0.001"/></Field>
    <Field label="Высота кузова, м"><input type="number" name="bodyHeight" required min="0.001" max="10" step="0.001"/></Field>
    <Field label="Полная высота от земли, м" wide><input type="number" name="totalHeight" min="0.001" max="15" step="0.001" aria-describedby="total-height-help"/></Field>
    <p className="sub wide" id="total-height-help">Если полная высота неизвестна, оставьте поле пустым. Для точек с ограничением въезда понадобится замер.</p>
  </>;
}

export function Registration({kind,send,close,saved}){
  const employee=kind==='employee';
  const title=employee?'Добавить сотрудника':'Добавить машину';
  const [error,setError]=useState('');
  const [busy,setBusy]=useState(false);
  const lastVehicle=useRef(null);
  async function submit(e){
    e.preventDefault();setError('');
    const fields=new FormData(e.currentTarget);
    const name=fields.get('name').trim();
    if(!name){setError('Укажите название машины или имя сотрудника.');return;}
    setBusy(true);
    try {
      if(employee){
        await send('/accounts',{name,email:fields.get('email').trim(),role:fields.get('role'),password:fields.get('password')});
      }else{
        const millimeters=field=>Math.round(Number(fields.get(field))*1000);
        const body={name,capacity_kg:Number(fields.get('capacity')),extra_kg:Number(fields.get('extra')),
          length_mm:millimeters('length'),body_height_mm:millimeters('bodyHeight'),
          total_height_mm:fields.get('totalHeight')?millimeters('totalHeight'):null};
        if(body.extra_kg>body.capacity_kg){setError('Дополнительный груз превышает грузоподъёмность.');return;}
        const signature=JSON.stringify(body);
        if(lastVehicle.current?.signature!==signature)lastVehicle.current={signature,key:crypto.randomUUID()};
        await send('/vehicles',body,'POST',lastVehicle.current.key);
      }
      saved(employee?'Кабинет сотрудника создан.':'Машина добавлена в автопарк и доступна для назначения.');
    }catch(err){setError(err.message);}finally{setBusy(false);}
  }
  return <Dialog title={title} close={()=>{if(!busy)close();}}><form onSubmit={submit}><div className="form-body"><fieldset>
    <legend>{employee?'Данные кабинета':'Характеристики автомобиля'}</legend><div className="form-grid">
      {employee?<EmployeeFields/>:<VehicleFields/>}
    </div></fieldset></div>{error&&<p className="error" role="alert">{error}</p>}
    <footer className="dialog-footer"><button disabled={busy} type="button" onClick={close}>Закрыть</button><button disabled={busy} className="primary">{title}</button></footer>
  </form></Dialog>;
}
