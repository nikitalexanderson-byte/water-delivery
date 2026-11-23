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
  await dialog.getByLabel(/Тары у клиента нет/).check();
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
  await page.getByText('Загрузка по брендам',{exact:true}).click();
  await expect(page.locator('.trip .detail-list')).toContainText(assigned.items[0].name);
  await page.getByRole('button',{name:'Отчёты',exact:true}).click();
  await expect(page.getByText('Отчёт не совпал',{exact:true})).toBeVisible();
  await expect(page.getByRole('table',{name:'Полные бутыли по брендам'})).toContainText(assigned.items[0].name);
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

test('каталог и смешанный заказ сохраняют бренды, цены и количество при повторе',async({page})=>{
  await login(page,'manager');
  await page.getByRole('button',{name:'Каталог',exact:true}).click();
  await page.getByRole('button',{name:'Новый бренд'}).click();
  const modal=page.getByRole('dialog');
  await modal.getByLabel('Название бренда').fill('Вода из тестовой скважины');
  await modal.getByLabel('Цена за бутыль, ₽').fill('100');
  await modal.getByRole('button',{name:'Добавить бренд'}).click();
  const edit=page.getByRole('button',{name:'Изменить бренд Вода из тестовой скважины'});
  await edit.click();
  await modal.getByLabel('Цена за бутыль, ₽').fill('97.10');
  await modal.getByRole('button',{name:'Сохранить бренд'}).click();
  await expect(page.getByRole('row',{name:/Вода из тестовой скважины/})).toContainText(/97,1/);
  await page.getByRole('button',{name:'Выйти',exact:true}).click();
  await login(page,'operator');
  await page.getByRole('button',{name:'Каталог',exact:true}).click();
  await expect(page.getByRole('button',{name:'Новый бренд'})).toHaveCount(0);
  await expect(page.getByRole('row',{name:/Вода из тестовой скважины/})).toBeVisible();
  await page.getByRole('button',{name:'Заказы',exact:true}).click();
  await page.getByRole('button',{name:'Новый заказ'}).click();
  await modal.getByLabel('Имя или организация').fill('Корзина из двух брендов');
  await modal.getByLabel('Телефон',{exact:true}).fill('+70000000017');
  await modal.getByLabel('Адрес доставки').fill('Учебная улица, 170');
  const line1=modal.getByRole('group',{name:'Позиция 1',exact:true});
  const line2=modal.getByRole('group',{name:'Позиция 2',exact:true});
  const firstBrand=await line1.getByLabel('Бренд воды').locator('option:checked').textContent();
  await line1.getByLabel('Бутыли 19 л, шт.').fill('3');
  await line1.getByLabel('За бутыль воды, ₽').fill('123.45');
  await modal.getByRole('button',{name:'Добавить позицию'}).click();
  await line2.getByLabel('Бренд воды').selectOption({label:'Вода из тестовой скважины'});
  await expect(line2.getByLabel('За бутыль воды, ₽')).toHaveValue('97.1');
  await line2.getByLabel('Бутыли 19 л, шт.').fill('2');
  await modal.getByLabel(/Тары у клиента нет/).check();
  await expect(modal.locator('.dialog-footer strong')).toHaveText(/814,55\s₽/);
  await modal.getByRole('button',{name:'Создать заказ'}).click();
  const row=page.getByRole('row',{name:/Корзина из двух брендов/});
  await expect(row).toContainText(/814,55\s₽/);
  await row.getByRole('button').click();
  await expect(modal).toContainText(firstBrand);
  await expect(modal).toContainText('Вода из тестовой скважины');
  await modal.getByRole('button',{name:'Повторить заказ'}).click();
  await expect(line1.getByLabel('Бренд воды').locator('option:checked')).toHaveText(firstBrand);
  await expect(line1.getByLabel('За бутыль воды, ₽')).toHaveValue('123.45');
  await expect(line2.getByLabel('Бренд воды').locator('option:checked')).toHaveText('Вода из тестовой скважины');
  await expect(line2.getByLabel('Бутыли 19 л, шт.')).toHaveValue('2');
  await expect(modal.locator('.dialog-footer strong')).toHaveText(/814,55\s₽/);
});

test('третий экипаж регистрируется, получает смену и подтверждает выход',async({page,request})=>{
  const email='driver3@farvater.test';
  const initialPassword=randomUUID();
  const {tomorrow}=await (await request.get('/api/config')).json();
  await login(page,'manager');
  await page.getByRole('button',{name:'Маршруты',exact:true}).click();
  await expect(page.getByRole('button',{name:'Добавить машину',exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Добавить сотрудника'}).click();
  const modal=page.getByRole('dialog');
  await modal.getByLabel('Имя сотрудника').fill('Кирилл Лебедев');
  await modal.getByLabel('Электронная почта для входа').fill(email);
  await modal.getByRole('combobox',{name:'Роль',exact:true}).selectOption('driver');
  await modal.getByLabel(/Пароль для входа/).fill(initialPassword);
  await modal.getByRole('button',{name:'Добавить сотрудника',exact:true}).click();
  await expect(page.getByRole('status')).toContainText('Кабинет сотрудника создан');
  await expect(page.locator('body')).not.toContainText(initialPassword);
  await page.getByRole('button',{name:'Выйти',exact:true}).click();
  await login(page,'dispatcher');
  await page.getByRole('button',{name:'Маршруты',exact:true}).click();
  await expect(page.getByRole('button',{name:'Добавить сотрудника'})).toHaveCount(0);
  await page.getByRole('button',{name:'Добавить машину'}).click();
  await modal.getByLabel('Название машины').fill('Резервная машина 03');
  await modal.getByLabel('Грузоподъёмность, кг').fill('2500');
  await modal.getByLabel('Дополнительный груз, кг').fill('80');
  await modal.getByLabel('Длина кузова, м').fill('4.1');
  await modal.getByLabel('Высота кузова, м',{exact:true}).fill('2.2');
  await modal.getByRole('button',{name:'Добавить машину'}).click();
  await expect(page.getByRole('status')).toContainText('Машина добавлена в автопарк');
  await page.getByRole('button',{name:'Смены и машины'}).click();
  await modal.getByLabel('Экспедитор').selectOption({label:'Кирилл Лебедев'});
  await modal.getByLabel('Автомобиль').selectOption({label:'Резервная машина 03 · 2500 кг'});
  await modal.getByLabel('Рабочая дата').fill(tomorrow);
  await modal.getByRole('button',{name:'Создать смену'}).click();
  const entry=page.getByRole('button',{name:/Кирилл Лебедев/});
  await expect(entry).toContainText('Ожидает выхода');
  const result=await request.post('/api/login',{data:{email,password:initialPassword}});
  expect(result.ok()).toBeTruthy();
  const {token}=await result.json();
  const headers={Authorization:'Bearer '+token};
  const view=await (await request.get('/api/day?date='+tomorrow,{headers})).json();
  expect(view.shifts).toHaveLength(1);
  expect(view.shifts[0].vehicle_name).toBe('Резервная машина 03');
  expect(view.shifts[0].total_height_mm).toBeNull();
  expect((await request.post('/api/shifts/'+view.shifts[0].id+'/confirm',{headers,data:{}})).ok()).toBeTruthy();
  await page.getByRole('button',{name:'Обновить данные'}).click();
  await expect(entry).toContainText('Выход подтверждён');
});

test('оператор находит клиента по телефону и правит снимок заказа после назначения',async({page,request})=>{
  const {tomorrow}=await (await request.get('/api/config')).json();
  async function auth(role) {
    const response=await request.post('/api/login',{data:{email:role+'@farvater.test',password}});
    return {Authorization:'Bearer '+(await response.json()).token};
  }
  const dispatcher=await auth('dispatcher');
  const driver=await auth('driver2');
  const day=await (await request.get('/api/day?date='+tomorrow,{headers:driver})).json();
  expect((await request.post('/api/shifts/'+day.shifts[0].id+'/confirm',{headers:driver,data:{}})).ok()).toBeTruthy();
  await login(page,'operator');
  await page.getByRole('button',{name:'Завтра',exact:true}).click();
  await page.getByRole('button',{name:'Новый заказ'}).click();
  const dialog=page.getByRole('dialog');
  await dialog.getByLabel('Поиск клиента по имени или телефону').fill('70000000002');
  await dialog.getByRole('button',{name:/Анна Смирнова/}).click();
  await expect(dialog.getByLabel('Адрес доставки')).toHaveValue('Тестовый переулок, 4');
  await dialog.getByLabel('Адрес проверен для тестового маршрута').check();
  await dialog.getByLabel('За бутыль воды, ₽').fill('141.25');
  await dialog.getByText('Этаж, въезд и инструкции',{exact:true}).click();
  await dialog.getByLabel('Дополнительный номер').check();
  await dialog.getByLabel('Дополнительный телефон').fill('+70000000098');
  await dialog.getByLabel('Парковка, мин').fill('7');
  await dialog.getByLabel('Есть тележка').check();
  await dialog.getByLabel('Можно доставить сегодня').check();
  await dialog.getByLabel('Подъезд',{exact:true}).fill('2');
  await dialog.getByLabel('Квартира или офис').fill('12А');
  await dialog.getByLabel('Домофон и код').fill('12#');
  await dialog.getByLabel('Как войти или подъехать').fill('Через второй вход');
  await dialog.getByLabel('Платный въезд').check();
  await dialog.getByText('Координаты для карты').click();
  await dialog.getByLabel('Широта',{exact:true}).fill('1.1');
  await dialog.getByRole('button',{name:'Создать заказ'}).click();
  await expect(dialog.getByRole('alert')).toContainText('широту и долготу вместе');
  await dialog.getByLabel('Долгота',{exact:true}).fill('2.2');
  const created=page.waitForResponse(r=>r.url().endsWith('/api/orders')&&r.request().method()==='POST');
  await dialog.getByRole('button',{name:'Создать заказ'}).click();
  const order=await (await created).json();
  const assigned=await request.post('/api/plan',{headers:dispatcher,data:{date:tomorrow,order_id:order.id,shift_id:day.shifts[0].id}});
  expect((await assigned.json()).assigned).toBe(1);
  const open=page.getByRole('button',{name:'Открыть заказ №'+order.id,exact:true});
  await page.getByRole('button',{name:'Обновить данные'}).click();
  await expect(page.getByRole('row').filter({has:open})).toContainText('Назначен');
  await open.click();
  await dialog.getByRole('button',{name:'Редактировать заказ'}).click();
  await expect(dialog.getByText(/вернётся в очередь/)).toBeVisible();
  await expect(dialog.getByLabel('За бутыль воды, ₽')).toHaveValue('141.25');
  await dialog.getByRole('button',{name:'Сохранить изменения'}).click();
  await expect(page.getByText('Данные заказа не изменились.')).toBeVisible();
  await open.click();
  await dialog.getByRole('button',{name:'Редактировать заказ'}).click();
  await dialog.getByLabel('Адрес доставки').fill('Учебная аллея, 99');
  await dialog.getByText('Координаты для карты').click();
  await expect(dialog.getByLabel('Широта',{exact:true})).toHaveValue('');
  await expect(dialog.getByLabel('Долгота',{exact:true})).toHaveValue('');
  await dialog.getByRole('button',{name:'Сохранить изменения'}).click();
  await expect(page.getByText('Заказ изменён и снят с рейса. Распределите его заново.')).toBeVisible();
  await expect(page.getByRole('row').filter({has:open})).toContainText('В очереди');
  await open.click();
  await expect(dialog).toContainText('Через второй вход');
  await dialog.getByRole('button',{name:'Повторить заказ'}).click();
  await expect(dialog.getByLabel('Дата доставки')).toHaveValue(tomorrow);
  await dialog.getByText('Этаж, въезд и инструкции',{exact:true}).click();
  await expect(dialog.getByLabel('Домофон и код')).toHaveValue('12#');
  await expect(dialog.getByLabel('Парковка, мин')).toHaveValue('7');
  await expect(dialog.getByLabel('Есть тележка')).toBeChecked();
  await expect(dialog.getByLabel('Можно доставить сегодня')).toBeChecked();
  await expect(dialog.getByLabel('Платный въезд')).toBeChecked();
});

test('узкий экран сохраняет доступ к разделам, смене дня и тёмной теме',async({page})=>{
  await page.setViewportSize({width:360,height:780});
  await login(page,'dispatcher');
  await page.getByRole('button',{name:'Тёмная тема',exact:true}).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme','dark');
  await page.getByRole('button',{name:'Завтра',exact:true}).click();
  await expect(page.getByRole('button',{name:'Завтра',exact:true})).toHaveAttribute('aria-pressed','true');
  for(const [section,title] of [['Маршруты','Маршруты доставки'],['Клиенты','Клиенты'],['Отчёты','Отчёт за день'],['Каталог','Каталог воды'],['Заказы','Заказы на день']]){
    const entry=page.getByRole('navigation').getByRole('button',{name:section,exact:true});
    await entry.focus();
    await page.keyboard.press('Enter');
    await expect(entry).toHaveAttribute('aria-current','page');
    await expect(page.getByRole('heading',{level:1,name:title})).toBeVisible();
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBeTruthy();
  }
});
test('календарь показывает 30 дней, открывает дату и карточку за весь период',async({page,request})=>{
  const {tomorrow}=await(await request.get('/api/config')).json();
  await page.setViewportSize({width:390,height:844});
  await login(page,'dispatcher');
  await page.getByRole('button',{name:'Календарь заказов'}).click();
  const calendar=page.getByRole('dialog',{name:'Календарь заказов'});
  const days=calendar.locator('.order-date-grid button');
  await expect(days).toHaveCount(30);
  await expect(days.first()).toHaveAttribute('aria-label',/заказ/);
  await calendar.getByRole('button',{name:'Следующие 30 дней'}).click();
  await expect(days.first()).not.toHaveAttribute('aria-current','date');
  await calendar.getByRole('button',{name:'Предыдущие 30 дней'}).click();
  await days.nth(1).click();
  await expect(page.getByLabel('Дата рабочего дня')).toHaveValue(tomorrow);
  await page.getByRole('button',{name:'Календарь заказов'}).click();
  await calendar.getByRole('button',{name:'Весь период'}).click();
  const record=calendar.locator('.order-archive button').first();
  const id=(await record.innerText()).match(/№ (\d+)/)[1];
  await record.click();
  await expect(page.getByRole('dialog',{name:'Заказ №'+id})).toBeVisible();
});

test('диспетчер видит согласованные будущие заказы и назначает один на сегодня',async({page,request})=>{
  const {today,tomorrow}=await(await request.get('/api/config')).json();
  const session=async(role)=>{
    const response=await request.post('/api/login',{data:{email:role+'@farvater.test',password}});
    return {Authorization:'Bearer '+(await response.json()).token};
  };
  const desk=await session('dispatcher');
  for(const name of ['driver1','driver2']){
    const driver=await session(name);
    const shiftView=await(await request.get('/api/day?date='+today,{headers:driver})).json();
    const shift=shiftView.shifts[0];
    if(shift.status==='pending')expect((await request.post('/api/shifts/'+shift.id+'/confirm',{headers:driver,data:{}})).ok()).toBeTruthy();
  }
  const created=await request.post('/api/orders',{headers:desk,data:{name:'Клиент досрочной доставки',phone:'+70000000666',
    address:'Учебный проезд, 3',date:tomorrow,window_start:510,window_end:1040,water:1,water_price:30000,
    category:'retail',payment_method:'cash',address_verified:true,can_deliver_today:true}});
  expect(created.ok()).toBeTruthy();
  const {id}=await created.json();
  await login(page,'dispatcher');
  await page.getByRole('button',{name:'Маршруты',exact:true}).click();
  const offers=page.getByRole('region',{name:'Можно доставить сегодня'});
  const entry=offers.locator('.queue-row').filter({hasText:'№ '+id+' ·'});
  await entry.getByRole('button',{name:'Подобрать рейс на сегодня'}).click();
  await expect(page.getByRole('status').filter({hasText:'Заказ №'+id+' перенесён на сегодня и назначен на рейс.'})).toBeVisible();
  await expect(entry).toHaveCount(0);
});
