import React from 'react';
import {Field,Icon,money} from './ui';

function newLine(product) {
  return {key:crypto.randomUUID(),product_id:product?.id||'',water:'1',price:product?String(product.water_price/100):''};
}

export function initialBasket(products,previous,defaultPrice) {
  const first=products.find(p=>p.active);
  if(previous?.items?.length) return previous.items.map(item=>({
    key:crypto.randomUUID(),product_id:item.product_id,name:item.name,water:String(item.water),price:String(item.water_price/100),
  }));
  const line=newLine(first);
  if(previous) {line.water=String(previous.water); line.price=String((previous.water_price??defaultPrice)/100);}
  return [line];
}

export function Basket({lines,setLines,products}) {
  const active=products.filter(p=>p.active);
  const chosen=new Set(lines.map(line=>line.product_id));
  const next=active.find(p=>!chosen.has(p.id));
  function change(key,fields){setLines(old=>old.map(line=>line.key===key?{...line,...fields}:line));}
  return <><div className="basket-lines">{lines.map((line,i)=>{
    const current=products.find(p=>p.id===line.product_id);
    return <div className="basket-line" key={line.key} role="group" aria-label={'Позиция '+(i+1)}>
      <Field label="Бренд воды" wide><select required value={line.product_id} onChange={e=>{
        const selected=active.find(p=>p.id===Number(e.target.value));
        if(selected)change(line.key,{product_id:selected.id,price:String(selected.water_price/100),name:selected.name});
      }}>
        {!current?.active&&<option value={line.product_id} disabled>{line.product_id?(line.name||current?.name||'Бренд')+' · в архиве':'Выберите бренд'}</option>}
        {active.filter(p=>p.id===line.product_id||!chosen.has(p.id)).map(p=><option value={p.id} key={p.id}>{p.name}</option>)}
      </select></Field>
      <Field label="Бутыли 19 л, шт."><input type="number" value={line.water} onChange={e=>change(line.key,{water:e.target.value})} required min="1" max="10000" step="1"/></Field>
      <Field label="За бутыль воды, ₽"><input type="number" value={line.price} onChange={e=>change(line.key,{price:e.target.value})} required min="0.01" max="100000" step="0.01"/></Field>
      <div className="basket-subtotal wide"><span>За позицию <strong>{money(Number(line.water)*Math.round(Number(line.price)*100))}</strong></span>
        {lines.length>1&&<button type="button" className="link-button" onClick={()=>setLines(old=>old.filter(x=>x.key!==line.key))} aria-label={'Убрать позицию '+(i+1)}>Убрать</button>}</div>
    </div>;
  })}</div>{!active.length&&<p className="notice">В каталоге нет доступных брендов. Обратитесь к диспетчеру.</p>}
  {next&&<button className="add-line" type="button" onClick={()=>setLines(old=>[...old,newLine(next)])}><Icon name="plus"/>Добавить позицию</button>}</>;
}
