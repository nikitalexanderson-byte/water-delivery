import {test,expect} from '@playwright/test';

async function operator(page,path='/'){
  await page.goto(path);
  await page.getByLabel('Электронная почта').fill('operator@farvater.test');
  await page.getByLabel('Пароль',{exact:true}).fill('e2e-farvater-local');
  await page.getByRole('button',{name:'Войти',exact:true}).click();
}

test('оператор находит адрес, уточняет отметку и сохраняет координаты заказа',async({page})=>{
  let lookups=0;
  await page.route('**/api/places?*',async route=>{
    expect(new URL(route.request().url()).searchParams.get('q')).toBe('Москва Красная площадь');
    lookups++;
    await route.fulfill({json:{places:[{label:'Красная площадь, Москва',lat:55.753,lon:37.621}]}});
  });
  await operator(page);
  await page.getByRole('button',{name:'Новый заказ'}).click();
  const dialog=page.getByRole('dialog');
  await dialog.getByLabel('Имя или организация').fill('Учебная доставка с отметкой');
  await dialog.getByLabel('Телефон',{exact:true}).fill('+70000000067');
  await dialog.getByLabel('Автоопределение адреса').uncheck();
  await dialog.getByRole('button',{name:'Выбрать точку на карте'}).click();
  await expect(dialog.getByRole('button',{name:'Найти на карте'})).toHaveCount(0);
  await dialog.getByRole('button',{name:'Отмена выбора'}).click();
  await dialog.getByLabel('Автоопределение адреса').check();
  await dialog.getByRole('button',{name:'Выбрать точку на карте'}).click();
  const map=page.frameLocator('iframe[title="Выбор точки доставки на карте"]');
  await expect(map.locator('#canvas')).toBeVisible();
  await dialog.getByLabel('Населённый пункт, улица и дом').fill('Москва Красная площадь');
  expect(lookups).toBe(0);
  await dialog.getByRole('button',{name:'Найти на карте'}).click();
  await dialog.getByRole('button',{name:'Красная площадь, Москва'}).click();
  await expect(map.locator('.picked-pin')).toBeVisible();
  await dialog.getByRole('button',{name:'Использовать точку'}).click();
  await expect(dialog.getByLabel('Адрес доставки')).toHaveValue('Красная площадь, Москва');
  await dialog.getByRole('button',{name:'Уточнить точку на карте'}).click();
  await map.locator('#canvas').click({position:{x:60,y:110}});
  await expect(dialog.locator('.address-map p[role=status]').last()).not.toContainText('55.753000, 37.621000');
  await dialog.getByRole('button',{name:'Использовать точку'}).click();
  await dialog.getByText('Координаты для карты',{exact:true}).click();
  const lat=Number(await dialog.getByLabel('Широта').inputValue());
  const lon=Number(await dialog.getByLabel('Долгота').inputValue());
  expect(Math.abs(lat-55.753)).toBeLessThan(.025);
  expect(Math.abs(lon-37.621)).toBeLessThan(.025);
  const response=page.waitForResponse(r=>r.url().endsWith('/api/orders')&&r.request().method()==='POST');
  await dialog.getByRole('button',{name:'Создать заказ'}).click();
  const stored=await response;
  expect(stored.ok()).toBeTruthy();
  expect(stored.request().postDataJSON()).toMatchObject({latitude:lat,longitude:lon});
  await expect(dialog).toHaveCount(0);
  expect(lookups).toBe(1);
});

test('ссылка на учебную карту сохраняется после входа и перезагрузки, суммы различимы в обеих темах',async({page})=>{
  await operator(page,'/?view=atlas&example=1');
  await expect(page.getByRole('heading',{name:'Карта рейсов',exact:true})).toBeVisible();
  await page.reload();
  await expect(page.getByText(/девять районов Москвы/)).toBeVisible();
  await page.getByRole('button',{name:'Заказы',exact:true}).click();
  const quantity=page.locator('.volume-stat strong');
  await expect(quantity).toHaveCSS('color','rgb(104, 65, 139)');
  await page.getByRole('button',{name:'Тёмная тема'}).click();
  await expect(quantity).toHaveCSS('color','rgb(215, 184, 245)');
  await page.goBack();
  await expect(page.getByRole('heading',{name:'Карта рейсов',exact:true})).toBeVisible();
  await expect(page.getByRole('button',{name:'Вернуться к рабочим рейсам'})).toBeVisible();
});
