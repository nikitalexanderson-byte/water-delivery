import {test,expect} from '@playwright/test';
import {randomUUID} from 'node:crypto';

test('экран входа показывает ссылку на APK, когда сервер раздаёт файл',async({page})=>{
  await page.route('**/downloads/farvater-driver.apk',route=>route.fulfill({status:200,
    contentType:'application/vnd.android.package-archive',body:''}));
  await page.goto('/');
  await expect(page.getByRole('link',{name:'Скачать приложение Android'})).toHaveAttribute('href','/downloads/farvater-driver.apk');
});

async function register(page,name,intent){
  await page.goto('/');
  await page.getByRole('button',{name:'Создать аккаунт',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Как вы будете работать?'})).toBeFocused();
  await expect(page.getByLabel('Ваше имя')).toHaveCount(0);
  await page.getByRole('button',{name:intent,exact:true}).click();
  await page.getByLabel('Ваше имя').fill(name);
  await page.getByLabel('Электронная почта').fill(randomUUID()+'@example.test');
  await page.getByLabel('Пароль',{exact:true}).fill('farvater-test-only-19');
  await page.getByLabel('Повторите пароль').fill('farvater-test-only-19');
  await page.getByRole('button',{name:'Зарегистрироваться',exact:true}).click();
}

test('руководитель создаёт чистую команду, водитель присоединяется по коду с телефона',async({page,browser,baseURL})=>{
  await register(page,'Владелец учебной команды','Я организую доставку');
  await expect(page.getByRole('heading',{name:'Создать команду'})).toBeVisible();
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
    await register(worker,'Экспедитор учебной команды','Меня пригласили');
    await expect(worker.getByRole('heading',{name:'Вступить в команду'})).toBeVisible();
    await worker.reload();
    const input=worker.getByLabel('Код приглашения');
    await input.fill(code.slice(0,12));
    await worker.getByRole('button',{name:'Присоединиться'}).click();
    await expect(worker.getByRole('alert')).toContainText('32 символа');
    await input.fill('00000000000000000000000000000000');
    await worker.getByRole('button',{name:'Присоединиться'}).click();
    await expect(worker.getByRole('alert')).toContainText('Код недействителен');
    await input.fill(' '+code.toUpperCase()+' ');
    await worker.getByRole('button',{name:'Присоединиться'}).click();
    await expect(worker.getByRole('heading',{name:'Мои заказы'})).toBeVisible();
    await expect(worker.getByRole('button',{name:'Новый заказ'})).toHaveCount(0);
    await expect(worker.getByRole('button',{name:'Карта рейсов'})).toBeVisible();
    const another=await mobile.newPage();
    await register(another,'Другой экспедитор','Меня пригласили');
    await another.getByLabel('Код приглашения').fill(code);
    await another.getByRole('button',{name:'Присоединиться'}).click();
    await expect(another.getByRole('alert')).toContainText('Код недействителен');
  }finally{await mobile.close();}
  await dialog.getByRole('button',{name:'Закрыть окно'}).click();
  await page.getByRole('button',{name:'Команда',exact:true}).click();
  await expect(dialog).toContainText('Экспедитор учебной команды');
  await expect(dialog.getByLabel('Одноразовый код')).toHaveCount(0);
});
