import {test,expect} from '@playwright/test';
import {randomUUID} from 'node:crypto';

test('экран входа показывает ссылку на APK, когда сервер раздаёт файл',async({page})=>{
  await page.route('**/downloads/farvater-driver.apk',route=>route.fulfill({status:200,
    contentType:'application/vnd.android.package-archive',body:''}));
  await page.goto('/');
  await expect(page.getByRole('link',{name:'Скачать приложение Android'})).toHaveAttribute('href','/downloads/farvater-driver.apk');
});

async function registrationForm(page,name,role){
  await page.goto('/');
  await page.getByRole('button',{name:'Создать аккаунт',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Как вы будете работать?'})).toBeFocused();
  await expect(page.getByLabel('Ваше имя')).toHaveCount(0);
  await expect(page.getByRole('button',{name:'Администратор',exact:true})).toHaveCount(0);
  await page.getByRole('button',{name:role,exact:true}).click();
  await page.getByLabel('Ваше имя').fill(name);
  await page.getByLabel('Электронная почта').fill(randomUUID()+'@example.test');
  await page.getByLabel('Пароль',{exact:true}).fill('farvater-test-only-19');
  await page.getByLabel('Повторите пароль').fill('farvater-test-only-19');
}

test('администратор выдаёт коды на обе роли и видит журнал, сотрудники регистрируются на телефоне',async({page,browser,baseURL,request})=>{
  await page.goto('/');
  await page.getByLabel('Электронная почта').fill('manager@farvater.test');
  await page.getByLabel('Пароль',{exact:true}).fill('e2e-farvater-local');
  await page.getByRole('button',{name:'Войти',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Заказы на день'})).toBeVisible();
  await page.getByRole('button',{name:'Команда',exact:true}).click();
  const dialog=page.getByRole('dialog',{name:'Команда'});
  await expect(dialog).toContainText('Администратор');
  await expect(dialog.getByLabel('Роль нового сотрудника').locator('option')).toHaveText(['Экспедитор','Оператор']);
  await dialog.getByRole('button',{name:'Создать приглашение'}).click();
  const field=dialog.getByLabel('Одноразовый код');
  await expect(field).toHaveValue(/^[a-f0-9]{32}$/);
  const code=await field.inputValue();
  const mobile=await browser.newContext({baseURL,viewport:{width:390,height:844},isMobile:true});
  try{
    const worker=await mobile.newPage();
    await registrationForm(worker,'Экспедитор учебной команды','Экспедитор');
    await expect(worker.getByRole('heading',{name:'Регистрация · Экспедитор'})).toBeVisible();
    const input=worker.getByLabel('Код приглашения');
    await input.fill('00000000000000000000000000000000');
    await worker.getByRole('button',{name:'Зарегистрироваться'}).click();
    await expect(worker.getByRole('alert')).toContainText('Код недействителен');
    await input.fill(' '+code.toUpperCase()+' ');
    await worker.getByRole('button',{name:'Зарегистрироваться'}).click();
    await expect(worker.getByRole('heading',{name:'Мои заказы'})).toBeVisible();
    await expect(worker.getByRole('button',{name:'Новый заказ'})).toHaveCount(0);
    await expect(worker.getByRole('button',{name:'Карта рейсов'})).toBeVisible();
    const another=await mobile.newPage();
    await registrationForm(another,'Другой экспедитор','Экспедитор');
    await another.getByLabel('Код приглашения').fill(code);
    await another.getByRole('button',{name:'Зарегистрироваться'}).click();
    await expect(another.getByRole('alert')).toContainText('Код недействителен');

    await dialog.getByLabel('Роль нового сотрудника').selectOption('operator');
    await dialog.getByRole('button',{name:'Создать приглашение'}).click();
    await expect(field).toHaveValue(/^[a-f0-9]{32}$/);
    const operator=await mobile.newPage();
    await registrationForm(operator,'Оператор учебной команды','Оператор');
    await operator.getByLabel('Код приглашения').fill(await field.inputValue());
    await operator.getByRole('button',{name:'Зарегистрироваться'}).click();
    await expect(operator.getByRole('heading',{name:'Заказы на день'})).toBeVisible();
    await expect(operator.getByRole('button',{name:'Новый заказ'})).toBeVisible();
    await expect(operator.getByRole('button',{name:'Маршруты',exact:true})).toBeVisible();
    await operator.getByRole('button',{name:'Команда',exact:true}).click();
    await expect(operator.getByRole('button',{name:'Журнал работы'})).toHaveCount(0);
  }finally{await mobile.close();}
  await dialog.getByRole('button',{name:'Закрыть окно'}).click();
  await page.getByRole('button',{name:'Команда',exact:true}).click();
  await expect(dialog).toContainText('Экспедитор учебной команды');
  await expect(dialog).toContainText('Оператор учебной команды');
  await expect(dialog.getByLabel('Одноразовый код')).toHaveCount(0);
  const config=await (await request.get('/api/config')).json();
  const {token}=await (await request.post('/api/login',{data:{email:'operator@farvater.test',password:'e2e-farvater-local'}})).json();
  const created=await request.post('/api/orders',{headers:{Authorization:'Bearer '+token},data:{date:config.tomorrow,
    name:'Для журнала работы',phone:'+70000000172',address:'Учебная улица, 42',window_start:600,window_end:1080,
    water:2,water_price:35000,category:'retail',payment_method:'cash'}});
  expect(created.ok()).toBeTruthy();
  const {id}=await created.json();
  await dialog.getByRole('button',{name:'Журнал работы'}).click();
  const entry=dialog.getByRole('listitem').filter({hasText:`Заказ создан · №${id}`});
  await expect(entry).toContainText('Оператор');
});
