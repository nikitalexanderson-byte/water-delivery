import React, {useState} from 'react';
import {Dialog,Field} from './ui';

export function PasswordDialog({send,close,exit}) {
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  async function submit(e) {
    e.preventDefault();
    const values=new FormData(e.currentTarget);
    if(values.get('new')!==values.get('again')){setError('Новые пароли не совпадают.');return;}
    setError('');setBusy(true);
    try{
      await send('/password',{current_password:values.get('current'),new_password:values.get('new')});
      exit('Пароль изменён. Войдите с новым паролем.');
    }catch(err){setError(err.message);}finally{setBusy(false);}
  }
  return <Dialog title="Изменить пароль" close={()=>{if(!busy)close();}}><form onSubmit={submit}><div className="form-body"><fieldset><legend>Данные для входа</legend><div className="form-grid">
    <Field label="Текущий пароль" wide><input type="password" name="current" autoComplete="current-password" required autoFocus/></Field>
    <Field label="Новый пароль (от 10 символов)" wide><input type="password" name="new" autoComplete="new-password" required minLength={10} maxLength={128}/></Field>
    <Field label="Повторите новый пароль" wide><input type="password" name="again" autoComplete="new-password" required minLength={10} maxLength={128}/></Field>
  </div></fieldset><p className="sub">После сохранения потребуется войти заново на всех устройствах.</p></div>
  {error&&<p className="error" role="alert">{error}</p>}<footer className="dialog-footer"><button type="button" onClick={close} disabled={busy}>Закрыть</button><button className="primary" disabled={busy}>Изменить пароль</button></footer></form></Dialog>;
}
