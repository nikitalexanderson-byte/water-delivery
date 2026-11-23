import {test,expect} from '@playwright/test';

const password='e2e-farvater-local';
async function signIn(page,role='dispatcher',url='/'){
  await page.goto(url);
  await page.getByLabel('Электронная почта').fill(role+'@farvater.test');
  await page.getByLabel('Пароль',{exact:true}).fill(password);
  await page.getByRole('button',{name:'Войти',exact:true}).click();
  await expect(page.getByRole('heading',{name:url==='/'?'Заказы на день':'Карта рейсов',exact:true})).toBeVisible();
}
async function auth(request,role){
  const response=await request.post('/api/login',{data:{email:role+'@farvater.test',password}});
  expect(response.ok()).toBeTruthy();
  return {Authorization:'Bearer '+(await response.json()).token};
}
const iframe=page=>page.frameLocator('iframe[title="Карта с остановками рейсов"]');
async function totals(page,values){
  const stats=page.locator('.atlas-stats strong');
  await expect(stats).toHaveCount(4);
  for(const [index,value] of values.entries())await expect(stats.nth(index)).toHaveText(value);
}

test('учебные рейсы: итоги, выбор карты и списка, схема и полностью локальная загрузка',async({page,baseURL})=>{
  const requestedTiles=[];
  await page.context().route('**/*',async route=>{
    const url=new URL(route.request().url());
    if(/^https?:$/.test(url.protocol)&&url.origin!==new URL(baseURL).origin){
      if(url.hostname==='tile.openstreetmap.org')requestedTiles.push(url.pathname);
      await route.abort();
    }
    else await route.continue();
  });
  await signIn(page,'dispatcher','/?view=atlas&example=1');
  await totals(page,['2','9','219 бут.',/4\s?380 кг/]);
  const map=iframe(page);
  await expect(map.locator('.stop-icon')).toHaveCount(9);
  await expect(map.getByRole('button',{name:'География'})).toHaveAttribute('aria-pressed','true');
  await map.getByTitle(/точка 1, Таганский район/).click();
  await expect(page.getByRole('combobox',{name:'Выбранный рейс'})).toHaveValue('demo-1');
  const list=page.getByRole('complementary',{name:'Остановки выбранного рейса'});
  await expect(list.getByRole('button',{name:/Таганский район/})).toHaveAttribute('aria-pressed','true');
  await expect(map.locator('.leaflet-popup')).toHaveCount(1);
  await expect(map.locator('.leaflet-popup')).toContainText('Таганский район');
  await page.getByRole('button',{name:'Только этот рейс'}).click();
  await totals(page,['1','4','89 бут.',/1\s?780 кг/]);
  await expect(map.locator('.stop-icon')).toHaveCount(4);
  const basmanny=list.getByRole('button',{name:/Басманный район/});
  await basmanny.click();
  await expect(map.locator('.leaflet-popup')).toHaveCount(1);
  await expect(map.locator('.leaflet-popup')).toContainText('Басманный район');
  await map.locator('.leaflet-popup-close-button').click();
  await expect(map.locator('.leaflet-popup')).toHaveCount(0);
  await basmanny.click();
  await expect(map.locator('.leaflet-popup')).toContainText('Басманный район');
  const yandex=new URL(await list.getByRole('link',{name:/Яндекс Картах/}).getAttribute('href'));
  expect(yandex.host).toBe('yandex.ru');
  expect(yandex.searchParams.get('rtt')).toBe('auto');
  expect(yandex.searchParams.get('rtext').split('~')).toHaveLength(4);
  await map.getByRole('button',{name:'Схема',exact:true}).click();
  await expect(map.locator('#caption')).toContainText(/без масштаба/i);
  await page.getByRole('button',{name:'Показать все рейсы'}).click();
  await totals(page,['2','9','219 бут.',/4\s?380 кг/]);
  await expect(map.locator('.stop-icon')).toHaveCount(9);
  await page.getByRole('button',{name:'Скрыть список'}).click();
  await expect(list).toHaveCount(0);
  await page.getByRole('button',{name:'Показать список'}).click();
  await expect(list).toBeVisible();
  // All external requests were blocked throughout, including browser-injected scripts.
  expect(requestedTiles).toEqual([]);
});

test('настроенная база видна на карте и замыкает оба учебных маршрута',async({page})=>{
  const base={base_lat:55.75,base_lon:37.6,base_address:'Учебная производственная база'};
  await page.route('**/api/config',async route=>{
    const response=await route.fetch();
    await route.fulfill({response,json:{...await response.json(),...base}});
  });
  await signIn(page,'dispatcher','/?view=atlas&example=1');
  const map=iframe(page);
  await expect(map.locator('.base-icon')).toHaveCount(1);
  await map.getByTitle(base.base_address,{exact:true}).click();
  await expect(map.locator('.leaflet-popup')).toContainText(base.base_address);
  for(const [index,count] of [[0,5],[1,4]]){
    await page.getByLabel('Выбранный рейс').selectOption('demo-'+index);
    const link=page.getByRole('link',{name:/Открыть в Яндекс Картах/});
    const path=new URL(await link.getAttribute('href')).searchParams.get('rtext').split('~');
    expect(path).toHaveLength(count+2);
    expect(path[0]).toBe('55.75,37.6');
    expect(path.at(-1)).toBe(path[0]);
  }
});

test('рабочие точки с координатами и без них открывают нужную схему и карточку заказа',async({page,request})=>{
  const office=await auth(request,'dispatcher'),driver=await auth(request,'driver1');
  const {today}=await (await request.get('/api/config')).json();
  const date=new Date(Date.parse(today+'T00:00:00Z')+14*86400000).toISOString().slice(0,10);
  const resource=await (await request.get('/api/resources',{headers:office})).json();
  const owner=resource.drivers.find(d=>d.name==='Алексей Морозов');
  async function post(path,data,headers=office){
    const response=await request.post('/api'+path,{headers,data});
    expect(response.ok(),await response.text()).toBeTruthy();
    return response.json();
  }
  const shift=await post('/shifts',{date,driver_id:owner.id,vehicle_id:resource.vehicles[0].id,start_min:480,end_min:1080,has_loader:false});
  await post('/shifts/'+shift.id+'/confirm',{},driver);
  const items=[];
  for(const [address,point] of [['Учебная геоточка',{latitude:55.7,longitude:37.6}],['Остановка без GPS',{}]]){
    items.push(await post('/orders',{name:'Проверка рабочей карты',phone:'+70000000711',address,address_verified:true,
      date,window_start:600,window_end:960,water:2,water_price:13500,category:'retail',payment_method:'cash',...point}));
  }
  expect((await post('/plan',{date})).assigned).toBe(2);
  await signIn(page);
  await page.getByLabel('Дата рабочего дня').fill(date);
  await page.getByRole('button',{name:'Карта рейсов'}).click();
  await totals(page,['1','2','4 бут.','80 кг']);
  const map=iframe(page);
  await expect(map.getByRole('button',{name:'География'})).toHaveAttribute('aria-pressed','true');
  await expect(map.locator('.stop-icon')).toHaveCount(1);
  await expect(map.locator('#caption')).toContainText(/без координат/i);
  const list=page.getByRole('complementary',{name:'Остановки выбранного рейса'});
  await expect(list.getByRole('link',{name:/Яндекс/})).toHaveCount(0);
  await list.getByRole('button',{name:/Остановка без GPS/}).click();
  await expect(map.getByRole('button',{name:'Схема',exact:true})).toHaveAttribute('aria-pressed','true');
  await expect(map.locator('.stop-icon')).toHaveCount(2);
  await expect(map.locator('.leaflet-popup')).toContainText('Остановка без GPS');
  await list.getByRole('button',{name:'Заказ № '+items[1].id,exact:true}).click();
  await expect(page.getByRole('dialog')).toContainText('Остановка без GPS');
  await page.keyboard.press('Escape');
  await list.getByRole('button',{name:/Учебная геоточка/}).click();
  await expect(map.locator('.leaflet-popup')).toHaveCount(1);
  await expect(map.locator('.leaflet-popup')).toContainText('Учебная геоточка');
});

test('карта пустого дня показывает географию и местоположение после обновления',async({page,context,baseURL,request})=>{
  await context.grantPermissions(['geolocation'],{origin:baseURL});
  await context.setGeolocation({latitude:55.73,longitude:37.61,accuracy:35});
  await signIn(page,'dispatcher','/?view=atlas');
  const {today}=await(await request.get('/api/config')).json();
  const date=new Date(Date.parse(today+'T00:00:00Z')+28*86400000).toISOString().slice(0,10);
  await page.getByLabel('Дата рабочего дня').fill(date);
  await expect(page.getByText('На этот день рейсов пока нет')).toBeVisible();
  const map=iframe(page);
  await expect(map.locator('#canvas')).toBeVisible();
  await expect(map.getByRole('button',{name:'География'})).toHaveAttribute('aria-pressed','true');
  await expect(map.locator('.leaflet-overview-pane path').first()).toBeAttached();
  const locate=page.getByRole('button',{name:'Моё местоположение'});
  await locate.click();
  const status=page.locator('.atlas-location');
  await expect(status).toHaveText(/Местоположение определено в \d{2}:\d{2}:\d{2} · точность 35 м/);
  const pin=map.getByTitle('Моё местоположение · точность 35 м');
  await expect(pin).toBeVisible();
  const reload=page.waitForResponse(response=>response.url().includes('/api/day?date='+date));
  await page.getByRole('button',{name:'Обновить данные'}).click();
  await reload;
  await expect(pin).toBeVisible();
  await context.setGeolocation({latitude:55.71,longitude:37.64,accuracy:8});
  await locate.click();
  await expect(status).toContainText('точность 8 м');
  const newPin=map.getByTitle('Моё местоположение · точность 8 м');
  await expect(newPin).toBeVisible();
  const marker=await newPin.boundingBox(),canvas=await map.locator('#canvas').boundingBox();
  expect(Math.abs(marker.x+marker.width/2-(canvas.x+canvas.width/2))).toBeLessThan(3);
  expect(Math.abs(marker.y+marker.height/2-(canvas.y+canvas.height/2))).toBeLessThan(3);
});

test('отказ в геолокации оставляет карту и возможность повторить запрос',async({page,context,baseURL})=>{
  await context.grantPermissions([],{origin:baseURL});
  await signIn(page,'dispatcher','/?view=atlas&example=1');
  const locate=page.getByRole('button',{name:'Моё местоположение'});
  await locate.click();
  await expect(page.locator('.atlas-location')).toContainText('Доступ к геолокации закрыт');
  await expect(locate).toBeEnabled();
  await expect(iframe(page).locator('.stop-icon')).toHaveCount(9);
});

test('на телефоне история клиента повторяется на выбранную дату с исходными позициями',async({page,request})=>{
  await page.setViewportSize({width:390,height:844});
  const {tomorrow}=await(await request.get('/api/config')).json();
  await signIn(page,'operator');
  await page.getByRole('button',{name:'Завтра',exact:true}).click();
  await page.getByRole('button',{name:'Клиенты',exact:true}).click();
  await page.getByLabel('Найти клиента').fill('70000000001');
  const customer=page.getByRole('button',{name:/Офис «Маяк»/});
  await customer.click();
  const history=page.getByRole('region',{name:'Карточка клиента'});
  await expect(history).toContainText('История заказов');
  await expect(history).toContainText(/12 × 350\s?₽/);
  await history.getByRole('button',{name:/Повторить заказ №/}).first().click();
  const modal=page.getByRole('dialog');
  await expect(modal.getByLabel('Дата доставки')).toHaveValue(tomorrow);
  await expect(modal.getByLabel('Адрес доставки')).toHaveValue('Учебная улица, 12');
  await expect(modal.getByLabel('Бутыли 19 л, шт.')).toHaveValue('12');
  await expect(modal.getByLabel('За бутыль воды, ₽')).toHaveValue('350');
  await expect(modal.getByLabel('Адрес проверен для тестового маршрута')).not.toBeChecked();
  await page.keyboard.press('Escape');
  await history.getByRole('button',{name:'К списку клиентов'}).click();
  await expect(customer).toBeFocused();
  await page.getByRole('button',{name:'Карта рейсов'}).click();
  await page.getByRole('button',{name:'Учебный пример'}).click();
  const map=iframe(page);
  await expect(map.locator('.stop-icon')).toHaveCount(9);
  await expect.poll(()=>map.locator('#canvas').evaluate(canvas=>{
    const bounds=canvas.getBoundingClientRect();
    return [...canvas.querySelectorAll('.stop-icon')].every(marker=>{
      const pin=marker.getBoundingClientRect();
      return pin.top>=bounds.top&&pin.bottom<=bounds.bottom&&pin.left>=bounds.left&&pin.right<=bounds.right;
    });
  }),{message:'Все маркеры должны помещаться после первой отрисовки карты'}).toBe(true);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBeTruthy();
  await page.getByRole('button',{name:'Скрыть список'}).click();
  await expect(iframe(page).locator('#canvas')).toBeVisible();
});
