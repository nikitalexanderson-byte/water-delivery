import {test,expect} from '@playwright/test';
import {randomUUID} from 'node:crypto';

async function register(page,name){
  await page.goto('/');
  await page.getByRole('button',{name:'Создать аккаунт',exact:true}).click();
  await page.getByLabel('Ваше имя').fill(name);
  await page.getByLabel('Электронная почта').fill(randomUUID()+'@example.test');
  await page.getByLabel('Пароль',{exact:true}).fill('farvater-test-only-19');
  await page.getByLabel('Повторите пароль').fill('farvater-test-only-19');
  await page.getByRole('button',{name:'Зарегистрироваться',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Ваша команда доставки'})).toBeVisible();
}

test('руководитель создаёт чистую команду, водитель присоединяется по коду с телефона',async({page,browser,baseURL})=>{
  await register(page,'Владелец учебной команды');
  await page.getByLabel('Название команды').fill('Учебный экипаж');
  await page.getByRole('button',{name:'Создать команду'}).click();
  await expect(page.getByRole('heading',{name:'Заказы на день'})).toBeVisible();
  await expect(page.getByRole('button',{name:'добавьте бренд воды в каталог'})).toBeVisible();
  await page.getByRole('button',{name:'Команда',exact:true}).click();
  const dialog=page.getByRole('dialog',{name:'Команда'});
  await expect(dialog).toContainText('Учебный экипаж');
  await expect(dialog).toContainText('Владелец учебной команды');
  await dialog.getByRole('button',{name:'Создать приглашение'}).click();
  const field=dialog.getByLabel('Одноразовый код');
  await expect(field).toHaveValue(/^[a-f0-9]{32}$/);
  const code=await field.inputValue();
  const mobile=await browser.newContext({baseURL,viewport:{width:390,height:844},isMobile:true});
  try{
    const worker=await mobile.newPage();
    await register(worker,'Экспедитор учебной команды');
    await worker.getByLabel('Код приглашения').fill(code);
    await worker.getByRole('button',{name:'Присоединиться'}).click();
    await expect(worker.getByRole('heading',{name:'Мои заказы'})).toBeVisible();
    await expect(worker.getByRole('button',{name:'Новый заказ'})).toHaveCount(0);
    await expect(worker.getByRole('button',{name:'Карта рейсов'})).toBeVisible();
  }finally{await mobile.close();}
  await dialog.getByRole('button',{name:'Закрыть окно'}).click();
  await page.getByRole('button',{name:'Команда',exact:true}).click();
  await expect(dialog).toContainText('Экспедитор учебной команды');
  await expect(dialog.getByLabel('Одноразовый код')).toHaveCount(0);
});
