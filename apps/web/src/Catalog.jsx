import React,{useRef,useState} from 'react';
import {Dialog,Empty,Field,Icon,money} from './ui';

export function Catalog({products,canEdit,edit}) {
  const [query,setQuery]=useState('');
  const visible=products.filter(p=>p.name.toLocaleLowerCase('ru').includes(query.trim().toLocaleLowerCase('ru')));
  return <section className="panel"><header className="panel-head"><h2>Бренды воды <span>{visible.length}</span></h2>
    <label className="search"><Icon name="search"/><span className="sr-only">Поиск по брендам</span><input value={query} onChange={e=>setQuery(e.target.value)} type="search" placeholder="Название бренда"/></label></header>
    {visible.length?<div className="table-scroll"><table><caption className="sr-only">Каталог воды в бутылях по 19 литров</caption>
      <thead><tr><th scope="col">Название</th><th scope="col">Цена за 19 л</th><th scope="col">Для заказа</th></tr></thead><tbody>
      {visible.map(p=><tr key={p.id}><td>{canEdit?<button className="link-button" onClick={()=>edit(p)} aria-label={'Изменить бренд '+p.name}>{p.name}</button>:<strong>{p.name}</strong>}</td>
        <td className="nowrap">{money(p.water_price)}</td><td><span className={'pill '+(p.active?'good':'')}>{p.active?'Доступен':'В архиве'}</span></td></tr>)}
      </tbody></table></div>:<Empty title={query?'Совпадений нет':'В каталоге пока нет брендов'}/>}
  </section>;
}

export function ProductDialog({product,send,close,saved}) {
  const [name,setName]=useState(product?.name||'');
  const [price,setPrice]=useState(product?String(product.water_price/100):'');
  const [active,setActive]=useState(product?.active??true);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  const attempt=useRef(null);
  async function save(e) {
    e.preventDefault();setError('');
    if(!name.trim()){setError('Введите название бренда.');return;}
    const data={name:name.trim(),water_price:Math.round(Number(price)*100),...(product?{active}:{})};
    const signature=JSON.stringify(data);
    if(attempt.current?.signature!==signature)attempt.current={signature,key:crypto.randomUUID()};
    setBusy(true);
    try{
      await send(product?'/products/'+product.id:'/products',data,product?'PATCH':'POST',attempt.current.key);
      saved(product?'Изменения бренда сохранены.':'Бренд добавлен в каталог.');
    }catch(err){setError(err.message);}finally{setBusy(false);}
  }
  return <Dialog title={product?'Карточка бренда':'Новый бренд воды'} close={()=>{if(!busy)close();}}>
    <form onSubmit={save}><div className="form-body"><fieldset><legend>Вода в бутылях 19 л</legend><div className="form-grid">
      <Field label="Название бренда" wide><input required autoFocus maxLength={120} value={name} onChange={e=>setName(e.target.value)}/></Field>
      <Field label="Цена за бутыль, ₽"><input type="number" required min="0.01" max="100000" step="0.01" value={price} onChange={e=>setPrice(e.target.value)}/></Field>
      {product&&<label className="check wide"><input type="checkbox" checked={active} onChange={e=>setActive(e.target.checked)}/>Доступен для новых заказов</label>}
    </div></fieldset></div>{error&&<p className="error" role="alert">{error}</p>}
    <footer className="dialog-footer"><button type="button" onClick={close} disabled={busy}>Закрыть</button><button className="primary" disabled={busy}>{product?'Сохранить бренд':'Добавить бренд'}</button></footer></form>
  </Dialog>;
}
