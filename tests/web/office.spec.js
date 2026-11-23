import {test,expect} from '@playwright/test';
import {randomUUID} from 'node:crypto';

const password='e2e-farvater-local';
async function login(page,role) {
  await page.goto('/');
  await page.getByLabel('Электронная почта').fill(role+'@farvater.test');
  await page.getByLabel('Пароль',{exact:true}).fill(password);
  await page.getByRole('button',{name:'Войти',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Заказы на день'})).toBeVisible();
}

test('приём вечернего заказа, проверка адреса, ручное назначение и дневная выгрузка',async({page,request})=>{
  const config=await (await request.get('/api/config')).json();
  const driver=await (await request.post('/api/login',{data:{email:'driver2@farvater.test',password}})).json();
  const headers={Authorization:'Bearer '+driver.token};
  const day=await (await request.get('/api/day?date='+config.tomorrow,{headers})).json();
  expect((await request.post('/api/shifts/'+day.shifts[0].id+'/confirm',{headers,data:{}})).ok()).toBeTruthy();
  await login(page,'dispatcher');
  await page.getByRole('button',{name:'Новый заказ'}).click();
  const dialog=page.getByRole('dialog');
  await dialog.getByLabel('Имя или организация').fill('Учебная вечерняя точка');
  await dialog.getByLabel('Телефон',{exact:true}).fill('+70000000091');
  await dialog.getByLabel('Адрес доставки').fill('Учебный проезд, 19');
  await dialog.getByLabel('Дата доставки').fill(config.tomorrow);
  await dialog.getByLabel('Принимают с').fill('18:15');
  await dialog.getByLabel('Принимают до').fill('21:45');
  await dialog.getByLabel('Бутыли 19 л, шт.').fill('5');
  await dialog.getByLabel('За бутыль воды, ₽').fill('100');
  await dialog.getByLabel('Добавить новую тару').check();
  await dialog.getByLabel(/Новая тара по/).fill('2');
  await dialog.getByLabel('Способ оплаты').selectOption('bank');
  await dialog.getByLabel('Название компании').fill('ООО Учебный пример');
  await expect(dialog.locator('.dialog-footer strong')).toHaveText(/1\s000\s₽/);
  await dialog.getByRole('button',{name:'Создать заказ'}).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByText('Учебная вечерняя точка',{exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Маршруты',exact:true}).click();
  await page.getByRole('button',{name:'Распределить заказы'}).click();
  await expect(page.locator('.queue-row .reason')).toContainText(/адрес/i);
  await page.getByRole('button',{name:/№ .*Учебная вечерняя точка/}).click();
  await page.getByRole('button',{name:'Подтвердить адрес'}).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByLabel(/Смена для заказа/).selectOption(String(day.shifts[0].id));
  await page.getByRole('button',{name:'Назначить',exact:true}).click();
  await expect(page.getByText('Все заказы обработаны')).toBeVisible();
  await page.getByRole('button',{name:/Иван Соколов/}).click();
  await expect(page.getByRole('button',{name:'1. Учебный проезд, 19'})).toBeVisible();
  await page.getByRole('button',{name:'Отчёты',exact:true}).click();
  const downloadPromise=page.waitForEvent('download');
  await page.getByRole('button',{name:'Скачать CSV'}).click();
  expect((await downloadPromise).suggestedFilename()).toContain(config.tomorrow);
});

test('оператор ищет заказ с клавиатуры и возвращается из карточки на узком экране',async({page})=>{
  await page.setViewportSize({width:390,height:844});
  await login(page,'operator');
  await expect(page.getByRole('button',{name:'Отчёты',exact:true})).toHaveCount(0);
  await page.getByLabel('Поиск по заказам').fill('Маяк');
  const button=page.getByRole('button',{name:/Открыть заказ №/});
  await expect(button).toHaveCount(1);
  await button.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('dialog')).toContainText('Офис «Маяк»');
  await page.keyboard.press('Escape');
  await expect(button).toBeFocused();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBeTruthy();
  await page.getByRole('button',{name:'Маршруты',exact:true}).click();
  await expect(page.getByRole('button',{name:'Распределить заказы'})).toHaveCount(0);
});

test('диспетчер создаёт следующую рабочую смену',async({page,request})=>{
  const config=await (await request.get('/api/config')).json();
  const future=new Date(Date.parse(config.tomorrow+'T00:00:00Z')+86400000).toISOString().slice(0,10);
  await login(page,'dispatcher');
  await page.getByRole('button',{name:'Маршруты',exact:true}).click();
  await page.getByRole('button',{name:'Смены и машины'}).click();
  await page.getByRole('dialog').getByLabel('Рабочая дата').fill(future);
  await page.getByRole('button',{name:'Создать смену',exact:true}).click();
  await expect(page.getByText('Смена создана. Экспедитор может подтвердить выход.')).toBeVisible();
  await expect(page.getByRole('button',{name:/Алексей Морозов/})).toContainText('Ожидает выхода');
});

test('руководитель проверяет расхождение по безналу после сдачи рейса',async({page,request})=>{
  async function tokenFor(role){
    const value=await request.post('/api/login',{data:{email:role+'@farvater.test',password}});
    return (await value.json()).token;
  }
  async function post(token,path,data){
    const response=await request.post('/api'+path,{data,headers:{Authorization:'Bearer '+token,'Idempotency-Key':randomUUID()}});
    expect(response.ok(),await response.text()).toBeTruthy();
  }
  const {today}=await (await request.get('/api/config')).json();
  const driver=await tokenFor('driver1');
  const dispatcher=await tokenFor('dispatcher');
  const load=async(token)=>(await request.get('/api/day?date='+today,{headers:{Authorization:'Bearer '+token}})).json();
  const {shifts}=await load(driver);
  const shift=shifts[0];
  await post(driver,'/shifts/'+shift.id+'/confirm',{});
  const officeDay=await load(dispatcher);
  const order=officeDay.orders.find(o=>o.name==='Офис «Маяк»');
  await post(dispatcher,'/plan',{date:today,order_id:order.id,shift_id:shift.id});
  const route=await load(driver);
  const assigned=route.orders.find(o=>o.id===order.id);
  await post(driver,'/trips/'+assigned.trip_id+'/start',{actual_start:shift.start_min,water:assigned.water+1});
  await post(driver,'/orders/'+assigned.id+'/deliver',{version:assigned.version,empty:2,paid:true});
  await post(driver,'/trips/'+assigned.trip_id+'/sale',{customer_order_id:assigned.id,water:1,new_shells:0,water_price:5000,payment_method:'cash',paid:true,empty:0});
  await post(driver,'/trips/'+assigned.trip_id+'/return',{actual_return:900});
  await post(driver,'/shifts/'+shift.id+'/settle',{water:0,empty:2,cash:5000,bank:assigned.total-15000,loader_minutes:0});
  await login(page,'manager');
  await page.getByRole('button',{name:'Маршруты',exact:true}).click();
  await expect(page.getByRole('button',{name:/Продажа на месте №/})).toBeVisible();
  await expect(page.locator('.track li')).toHaveCount(3);
  await page.getByRole('button',{name:'Отчёты',exact:true}).click();
  await expect(page.getByText('Отчёт не совпал',{exact:true})).toBeVisible();
  await expect(page.getByRole('row',{name:/Безналичные/})).toContainText(/[-−]150\s₽/);
  await page.getByRole('button',{name:'Подтвердить проверку расхождений'}).click();
  await expect(page.getByText('Проверено',{exact:true})).toBeVisible();
});

test('переназначение до выезда учитывает окно и сохраняет прежний рейс при отказе',async({page,request})=>{
  const {tomorrow}=await (await request.get('/api/config')).json();
  async function office(role) {
    const reply=await request.post('/api/login',{data:{email:role+'@farvater.test',password}});
    return {Authorization:'Bearer '+(await reply.json()).token};
  }
  const shifts=[];
  for(const role of ['driver1','driver2']){
    const headers=await office(role);
    const view=await (await request.get('/api/day?date='+tomorrow,{headers})).json();
    const shift=view.shifts[0];
    expect((await request.post('/api/shifts/'+shift.id+'/confirm',{headers,data:{}})).ok()).toBeTruthy();
    shifts.push(shift);
  }
  const headers=await office('dispatcher');
  const ids=[];
  for(const [window_start,window_end] of [[1085,1300],[645,1020]]){
    const order=await request.post('/api/orders',{headers,data:{name:'Смена экспедитора',phone:'+70000000011',address:'Учебная аллея, 7',
      address_verified:true,date:tomorrow,window_start,window_end,water:1,water_price:15000,category:'retail',payment_method:'cash'}});
    expect(order.ok(),await order.text()).toBeTruthy();
    const {id}=await order.json();
    ids.push(id);
    expect((await request.post('/api/plan',{headers,data:{date:tomorrow,order_id:id,shift_id:shifts[1].id}})).ok()).toBeTruthy();
  }
  await login(page,'dispatcher');
  await page.getByLabel('Дата рабочего дня').fill(tomorrow);
  const open=async id=>{
    await page.getByRole('button',{name:'Открыть заказ №'+id,exact:true}).click();
    await page.getByText('Сменить экспедитора',{exact:true}).click();
    await page.getByLabel('Другая подтверждённая смена').selectOption(String(shifts[0].id));
    await page.getByRole('button',{name:'Передать заказ'}).click();
  };
  await open(ids[0]);
  await expect(page.getByRole('dialog').getByRole('alert')).toBeVisible();
  await expect(page.getByRole('dialog').locator('dd').filter({hasText:shifts[1].driver_name})).toBeVisible();
  await page.getByRole('button',{name:'Закрыть окно'}).click();
  await open(ids[1]);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByRole('status')).toContainText(shifts[0].driver_name);
  await page.getByRole('button',{name:'Открыть заказ №'+ids[1],exact:true}).click();
  await expect(page.getByRole('dialog').locator('dd').filter({hasText:shifts[0].driver_name})).toBeVisible();
});

test('оператор повторяет заказ, переносит и отменяет его с подтверждением',async({page,request})=>{
  const config=await (await request.get('/api/config')).json();
  await login(page,'operator');
  await page.getByLabel('Поиск по заказам').fill('Тестовый переулок');
  await page.getByRole('button',{name:/Открыть заказ №/}).click();
  await page.getByRole('button',{name:'Повторить заказ'}).click();
  const modal=page.getByRole('dialog');
  await expect(modal.getByLabel('Бутыли 19 л, шт.')).toHaveValue('3');
  await expect(modal.getByLabel('Адрес проверен для тестового маршрута')).not.toBeChecked();
  await modal.getByLabel('Дата доставки').fill(config.tomorrow);
  await modal.getByRole('button',{name:'Создать заказ'}).click();
  await expect(modal).toHaveCount(0);
  await page.getByLabel('Поиск по заказам').fill('Тестовый переулок');
  const button=page.getByRole('button',{name:/Открыть заказ №/});
  await button.click();
  await modal.getByRole('button',{name:'Перенести заказ'}).click();
  await modal.getByLabel('Начало окна').fill('15:20');
  await modal.getByRole('button',{name:'Сохранить перенос'}).click();
  await expect(page.getByRole('row',{name:/Тестовый переулок/})).toContainText('15:20');
  await button.click();
  await modal.getByRole('button',{name:'Отменить заказ'}).click();
  await modal.getByRole('button',{name:'Подтвердить отмену'}).click();
  await expect(page.getByRole('row',{name:/Тестовый переулок/})).toContainText('Отменён');
});
