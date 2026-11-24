# Android-сборка для Google Play

У приложения два канала распространения. Для Google Play собирается Android App Bundle с идентификатором `ru.farvater.driver`, минимальной версией Android 8.0 и целевым API 36. Вариант `play` компилируется с HTTPS-адресом API. Кнопка обновления открывает карточку приложения в магазине. В загружаемом со стенда APK вариантов `debug` и `release` доступно обновление подписанным APK с сервера. [Правила Google Play для установки пакетов](https://support.google.com/googleplay/android-developer/answer/12085295)

## Локальная сборка

Понадобятся JDK 21, Android SDK Platform 36.1 и Build Tools 36.1.0. Укажите HTTPS-адрес своего API без пути, параметров и учётных данных. В примере ниже используется зарезервированный тестовый домен. Для рабочего выпуска подставьте доступный сервер и следующий уникальный код версии. Команда подписи выполняется отдельно.

На Windows запустите скрипт из корня репозитория.

```powershell
$env:ANDROID_API_URL = 'https://farvater.example.invalid'
$env:ANDROID_VERSION_CODE = '42'
.\apps\android\build-local.ps1 -Play
```

Скрипт выполняет модульные тесты и сохраняет неподписанный файл в `.local/aab/farvater-play.aab`. На Linux или macOS используйте Gradle Wrapper из рабочего каталога.

```sh
cd apps/android
export ANDROID_API_URL=https://farvater.example.invalid
export ANDROID_VERSION_CODE=42
bash gradlew :app:testPlayUnitTest :app:bundlePlay
```

Результат Gradle находится в `app/build/outputs/bundle/play/app-play.aab`. Для проверки из `apps/android` выполните следующую команду. В `PATH` должны быть Python 3 и Java 21, а в `BUNDLETOOL_JAR` — путь к файлу `bundletool-all-1.18.3.jar`. SHA-256 опубликованного JAR закреплён в `.github/workflows/android.yml`. [bundletool от Google](https://developer.android.com/tools/bundletool)

```sh
python3 tools/verify_play.py --bundletool "$BUNDLETOOL_JAR" \
  --bundle app/build/outputs/bundle/play/app-play.aab --version-code "$ANDROID_VERSION_CODE"
```

CI проверяет структуру итогового AAB, пакет, код версии, целевой API, запрет незашифрованного трафика и отладочного режима. Дополнительно проверяются отсутствие разрешения на установку пакетов, провайдера файлов обновления и реализации прямого загрузчика в DEX. Для нативной библиотеки AndroidX проверяются настройки упаковки и выравнивание загрузочных ELF-сегментов под страницы 16 КиБ в вариантах arm64 и x86_64. [Страницы памяти 16 КиБ](https://developer.android.com/guide/practices/page-sizes)

Артефакт `farvater-play-ci-unsigned` собран для тестового адреса. Для Google Play владелец собирает AAB с рабочим адресом, подписывает его своим ключом загрузки и настраивает Play App Signing. Храните ключ отдельно от репозитория. [Подпись Android-приложений](https://developer.android.com/studio/publish/app-signing)

Пример подписи в каталоге `apps/android` на Linux или macOS. `jarsigner` из JDK запросит пароль. Параметр `-signedjar` сохраняет отдельный файл.

```sh
jarsigner -keystore "$PLAY_UPLOAD_KEYSTORE" -signedjar farvater-play-signed.aab \
  app/build/outputs/bundle/play/app-play.aab "$PLAY_UPLOAD_ALIAS"
jarsigner -verify -verbose -certs farvater-play-signed.aab
```

Прежде чем выбирать ключ приложения в Play App Signing, решите, должны ли действующие пользователи стенда получать обновления из Google Play. При том же имени пакета обновление поверх установленного APK требует совместимой подписи и большего кода версии. Сверьте SHA-256 сертификата установки с сертификатом **ключа подписи приложения** в Play Console. Ключ загрузки служит для передачи AAB в Google. [Ключи и каналы распространения](https://developer.android.com/studio/publish/app-signing)

## До отправки на проверку

- **Удаление аккаунта.** В приложении есть регистрация. Владелец должен обеспечить доступный из приложения способ запросить удаление аккаунта и связанных данных, а также публичную веб-страницу для такого запроса без установки приложения. Согласуйте подтверждение личности, обработку заявки и сведения, которые компания обязана сохранять, с обоснованием и сроками. Проверьте оба пути тестовым пользователем и укажите ссылку в Play Console. [Требования Google к удалению аккаунта](https://support.google.com/googleplay/android-developer/answer/13327111)
- **Политика конфиденциальности.** Разместите публичную страницу, укажите оператора данных, контакт для обращений, категории данных, цели обработки, получателей, сроки хранения и удаление. Добавьте ссылку в приложение и карточку магазина. [Политика Google в отношении пользовательских данных](https://support.google.com/googleplay/android-developer/answer/10144311)
- **Раздел «Безопасность данных».** Сверьте декларацию с конфигурацией рабочего сервера и движением данных. В частности, проверьте данные профилей и приглашений, адреса и телефоны клиентов, операции доставки и оплаты, локальное местоположение по нажатию пользователя, сетевые запросы карты, маршрутизацию и экспорт отчётов. Уточните отдельно, что обрабатывается на устройстве и какие сведения получают сервер, картографические сервисы и включённые интеграции. [Заполнение раздела Data safety](https://support.google.com/googleplay/android-developer/answer/10787469)
- **Геопозиция рейса.** Передача включается из открытого приложения экспедитором, работает через службу `location` с системным уведомлением, завершается кнопкой остановки или при возврате. Оператор и администратор команды видят последнюю точку, направление и время. Для Play Console внесите тип службы в декларацию и приложите видео пользовательского сценария. Отразите передачу местоположения на сервер и доступ команды в политике и Data Safety. [Требования к foreground services](https://support.google.com/googleplay/android-developer/answer/13392821)
- **Проверка магазина.** Владелец заполняет карточку, контакты, возрастной рейтинг и прочие применимые декларации, проверяет текущие требования к целевому API и тестированию для своего аккаунта. Подготовьте инструкции для проверяющего и действующие роли с учебными данными для входа. После подписи и настройки рабочего сервера проверьте сборку на внутреннем треке. [Подготовка к проверке](https://support.google.com/googleplay/android-developer/answer/9859455) · [Доступ проверяющих](https://support.google.com/googleplay/android-developer/answer/15748846) · [Требования к целевому API](https://support.google.com/googleplay/android-developer/answer/11926878)

Google Play Protect оценивает конкретную установку и поведение приложения. Его решение и результат модерации магазина остаются за Google. [Как работает Google Play Protect](https://support.google.com/googleplay/answer/2812853)
