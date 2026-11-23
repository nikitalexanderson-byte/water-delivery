# Контракт API локального стенда

Префикс /api. JSON. Все id целые. Ответ ошибки {error: строка на русском}. Время окна, выезда, возврата и ETA в минутах от полуночи по BUSINESS_TZ. Дата YYYY-MM-DD. Цены, выручка и выплаты в целых копейках. День определяется на сервере. Имена полей JSON совпадают с указанными ниже.

- GET /api/config → {today, tomorrow, timezone, base_address, base_lat, base_lon, water_price, shell_price, map_provider, map_tiles_enabled, geocoder_enabled}. Пара координат базы может быть null. Флаг map_tiles_enabled отражает MAP_TILES_ENABLED и по умолчанию равен true. Значение false переключает карту на локальный обзор. Время пути рассчитывает map_provider=demo. geocoder_enabled сообщает, включён ли адресный поиск.
- POST /api/login {email,password} → {token,user:{id,name,email,role}}. Роли operator, dispatcher, driver, manager. Authorization: Bearer TOKEN. POST /api/logout отзывает текущий токен. Тестовые логины operator@farvater.test, dispatcher@farvater.test, manager@farvater.test, driver1@farvater.test, driver2@farvater.test. Общий пароль демопрофилей из DEMO_PASSWORD.
- GET /api/day?date=YYYY-MM-DD → {orders, customers, shifts, trips, reports, products}. Сотрудникам офиса отдаются данные дня. Водитель видит свою смену, рейсы, опубликованные заказы и свой отчёт. Для водителя customers всегда пуст. Значение include_customers=false позволяет офисному клиенту загрузить день без полного справочника и использовать поиск.
- customers[] {id,name,phone,address}. orders[] {id,customer_id,name,phone,address,date,water,new_shells,water_price,shell_price,total,payment_method:'cash'|'bank',company,category:'retail'|'wholesale', window_start,window_end,status:'pending'|'assigned'|'delivered'|'cancelled'|'failed',version,reason,shift_id,trip_id,position,eta,height_limit_mm,floor,lift,checkpoint,note,address_verified,paid}. shifts[] {id,driver_name,vehicle_name,capacity_kg,start_min,end_min,has_loader,status:'pending'|'confirmed'|'active'|'closed',published}. trips[] {id,shift_id,number,status:'planned'|'active'|'returned',actual_start,actual_return,water_left,empty_collected,planned_water}. reports[] {id,shift_id,driver_name,matched,expected,actual,difference,delivered_water,delivered_stops,sold_shells,earnings,unpaid,loader_minutes,reviewed}. expected/actual/difference каждая {water,empty,cash,bank}. difference = actual − expected.
- POST /api/orders (operator,dispatcher) {customer_id? ИЛИ name,phone, address,date, water,new_shells,water_price, category,payment_method,company?,window_start,window_end, floor?,lift?,checkpoint?,height_limit_mm?,note?,address_verified?}. Для существующего клиента address опционален, берётся адрес из карточки. Ответ {id,total}. Подтверждение адреса разрешает включение в демо-план. Только тестовая модель времени пути.
- POST /api/orders/:id/cancel {version}; /api/orders/:id/reschedule {version,date,window_start,window_end}. Плановый заказ можно отменить или перенести до выезда. Для статуса failed перенос создаёт связанную повторную доставку.
- POST /api/plan {date} все ожидающие или {date,order_id,shift_id} ручное назначение одного ожидающего заказа. Право dispatcher. Ответ {assigned,unassigned:[{order_id,reason}]}.
- POST /api/shifts/:id/confirm {} водитель. POST /api/trips/:id/start {actual_start,water} водитель. POST /api/orders/:id/deliver {version,empty,paid:boolean} водитель. POST /api/trips/:id/return {actual_return} водитель. Для этих и следующих операций изменения склада и денег клиент передаёт заголовок Idempotency-Key с UUID, сохранённым на время повтора. Успех {ok:true}.
- POST /api/shifts/:id/settle {water,empty,cash,bank,loader_minutes} водитель, возвращает отчёт (как reports[]). POST /api/reports/:id/review {} диспетчер/руководитель.
- GET /api/reports.csv?date=YYYY-MM-DD авторизация dispatcher/manager. UTF-8 CSV с BOM и разделителем точка с запятой.

### Дополнительные операции рабочего кабинета

- GET /api/me возвращает профиль. POST /api/password {current_password,new_password} меняет пароль и отзывает все сессии. POST /api/accounts {email,name,role,password} доступен руководителю для создания персонального кабинета. Новый пароль 10–128 символов.
- GET /api/resources возвращает {drivers,vehicles,products} диспетчеру и руководителю. POST /api/shifts {date,driver_id,vehicle_id,start_min,end_min,has_loader} создаёт смену. POST /api/vehicles {name,capacity_kg,extra_kg,length_mm,body_height_mm,total_height_mm} добавляет машину. PATCH /api/vehicles/:id {total_height_mm,extra_kg} доступен диспетчеру до назначения рейсов. Неизвестная полная высота хранится как null.
- POST /api/orders/:id/verify-address {version} подтверждает проверку адреса. Для переназначения уже закреплённой точки POST /api/plan принимает {date,order_id,shift_id,version}. Отказ сохраняет весь исходный план.
- POST /api/orders/:id/fail {version,reason} сохраняет причину недоставки. Статус failed завершает попытку. Запас и деньги сохраняются. Перенос такой доставки создаёт новый связанный заказ, историческая точка сохраняется в исходном рейсе.
- POST /api/trips/:id/sale {customer_order_id,water,new_shells,water_price,payment_method,company,paid,empty} оформляет допродажу у клиента этого рейса. Вода для оставшихся заказов зарезервирована. Оплата и движения проводятся в одной транзакции. Повторный выезд или дополнительная ставка за точку при такой продаже не возникают. У дочернего заказа origin=on_site и source_order_id указывает на исходную точку.
- Для fail и sale обязателен Idempotency-Key. Успешное действие с тем же UUID и содержимым возвращает прежний результат. Если тело изменилось, API возвращает 409. Клиент заново загружает день после ошибки версии. GET /api/config также отдаёт timezone для локальных Android-напоминаний.

### Каталог и состав заказа

- GET /api/day и GET /api/resources содержат products с полями id, name, water_price, active. Диспетчер и руководитель добавляют товар через POST /api/products и изменяют его через PATCH /api/products/:id. Цена в копейках, наименование уникально. Для прекращения продаж задают active=false.
- POST /api/orders принимает items из строк {product_id,water,water_price}. Цена по умолчанию берётся из каталога. Одно наименование занимает одну строку. Сервер суммирует объём и стоимость строк, прибавляет стоимость новой тары. В старом формате water и water_price относятся к базовому товару. В ответе /day строки items содержат исторические названия и цены.
- trips[].stock_items содержит product_id, name, planned_water, reserved_water, water_left. При выезде в /start передают items из {product_id,water} и общий water. Нельзя заменить один заказанный бренд другим. /sale принимает product_id и проверяет свободный запас именно этого наименования.
- Водитель передаёт в /settle фактические полные бутыли по брендам через items. Отсутствующая в явно переданном списке позиция означает ноль. При единственном наименовании поддерживается прежний запрос с общим water. Для смешанных загрузок требуется разбивка. В reports[].stock_items возвращаются expected, actual, difference каждого наименования. CSV включает ту же разбивку.

### Клиенты и история

Оба запроса доступны оператору и диспетчеру.

| Запрос | Параметры | Результат |
| --- | --- | --- |
| `GET /api/customers` | Необязательные `q` до 200 символов и `after` | `{customers,next}`. До 25 клиентов в порядке убывания id. Поиск учитывает имя, адрес и телефон карточки, а также получателя, адрес и оба телефона сохранённых заказов |
| `GET /api/customers/:id/history` | Необязательный `after` | `{customer,orders,next}`. До 15 заказов, сначала более поздняя дата доставки и больший id. В каждой записи есть контакты, условия доступа, координаты и историческая корзина |

Передайте полученный `next` без изменений как `after` того же запроса. Конец списка обозначен `null`. В справочнике курсор — id клиента, в истории — строка вида `2026-11-23.42`. Чтобы повторить доставку, отправьте новый `POST /api/orders` с выбранным клиентом, днём, окном и подтверждённым составом. При наличии `customer_id` явно переданные `name` и `phone` сохраняют получателя конкретного заказа. Если эти поля пропущены, берутся реквизиты карточки клиента.

### Снимок адреса и контактов

В `POST /api/orders` и `PATCH /api/orders/:id` можно передать дополнительные поля. Они возвращаются в заказах дня и истории. Допродажа у клиента и повторная попытка после недоставки наследуют сведения исходной точки.

| Поле | Тип и предел | Значение |
| --- | --- | --- |
| `alt_phone` | Строка до 24 символов | Дополнительный телефон, 6–15 цифр. Разрешены пробелы, скобки, дефисы и ведущий плюс |
| `entrance`, `unit` | Строки до 40 символов | Подъезд и квартира или офис |
| `intercom` | Строка до 80 символов | Код или указание для домофона |
| `access_instructions` | Строка до 1000 символов | Как пройти к точке, связаться с охраной или оформить въезд |
| `paid_entry` | Boolean | Признак платного въезда |
| `latitude`, `longitude` | Два числа или два null | Широта от −90 до 90, долгота от −180 до 180 включительно |

При создании дополнительные строки пусты, платный въезд выключен, координаты отсутствуют. При редактировании пропущенные поля доступа сохраняются. Пустая строка и false очищают соответствующее значение. Координаты принимаются парой. При прежнем адресе пропуск пары сохраняет отметку. При новом адресе пропуск снимает прежнюю отметку. Для явной очистки отправьте два null. Адрес можно проверить для учебного планирования и без координат.

Координаты, которые оператор закрепил за адресом в форме заказа, передаются в этом же запросе. «Моё местоположение» показывает позицию устройства внутри карты. Для этого действия клиент использует системную геолокацию по запросу пользователя. Серверные записи о движении сотрудников не создаются.

### Поиск точки по адресу

Оператор и диспетчер могут выполнить `GET /api/places?q=…`. Параметр `q` — отдельная строка поиска места длиной от 3 до 200 символов. После нажатия кнопки сервер передаёт Photon только значение этой строки и лимит результатов. Вводите населённый пункт, адрес или название объекта. Телефон, домофон и инструкции по доступу принадлежат отдельным полям заказа.

Ответ — `{places:[{label,lat,lon}]}`, до пяти вариантов. Пустой массив означает отсутствие совпадений. Оператор сверяет подпись с адресом клиента и проверяет точку на карте. В заказ координаты передаются после выбора результата. Одинаковые запросы используют общий кэш API на 30 минут. По умолчанию новый запрос к Photon может начаться раз в секунду. HTTP 429 содержит `Retry-After`. При выключенном или недоступном сервисе API вернёт 503, при превышении времени ожидания — 504. Ручной выбор точки остаётся доступным.

Публичный Photon — демонстрационный сервис без гарантированной доступности. Для собственного экземпляра задайте `GEOCODER_URL`, сохранив путь `/api/`. Полностью отключить обращения можно через `GEOCODER_ENABLED=false`. [Photon · эксплуатация и условия публичного сервера](https://github.com/komoot/photon)

### Редактирование до выезда

`PATCH /api/orders/:id` принимает полный снимок формы создания, обязательные `customer_id` и `version`. Доступ имеют оператор и диспетчер. Если переданы имя, телефон или адрес, они меняются в самом заказе. Неизменённую строку архивного бренда можно оставить с прежней ценой и количеством. Её также можно убрать.

Ответ содержит `{id,total,version,status,changed,released_assignment}`. После изменения назначенного заказа `status=pending`, `released_assignment=true`. Номер сохраняется, заказ возвращается в очередь, сервер пересчитывает исходный рейс. Отправка неизменённых данных возвращает `changed=false` и сохраняет назначение и версию. При устаревшей версии или начатом рейсе сервер возвращает HTTP 409. Клиент обновляет данные перед следующей попыткой.
