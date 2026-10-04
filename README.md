# SberJazz — React Native 0.77.3 + Jazz SDK (iOS и Android)

Демонстрационное приложение на **React Native CLI 0.77.3** с подключённым
Sber Jazz SDK — видеовстречи Jazz внутри вашего приложения:

* iOS — **[jazz-ios-sdk](https://github.com/salute-developers/jazz-ios-sdk)**;
* Android — **[jazz-android-sdk](https://github.com/salute-developers/jazz-android-sdk)**
  (`com.sdkit.jazz:jazz-public-sdk:25.07.1.3`).

JS-часть (обёртка, авторизация, хук) общая для обеих платформ.

> Переносите интеграцию в другой проект? — [**PORTING.md**](PORTING.md):
> что скопировать, куда вставить и как проверить.

Собирается под **обе архитектуры React Native** на обеих платформах. По
умолчанию — **старая** (Paper + классический мост, без TurboModules и Fabric);
новая включается одной командой, менять код не нужно.

## Что внутри

| Слой | Файл | Назначение |
| --- | --- | --- |
| JS API | `src/jazz/JazzSdk.ts` | Типизированная обёртка над нативным модулем |
| Авторизация | `src/jazz/jazzAuth.ts` | Обмен транспортного токена на токен доступа (`POST /v1/auth/login`) |
| Хук | `src/jazz/useJazzMeeting.ts` | `joinMeeting(url)`: initialize при первом вызове + вход во встречу по ссылке |
| UI | `App.tsx` | Одна кнопка «Online Встреча» — открывает экран встречи Jazz |
| Нативный модуль (iOS) | `ios/SberJazz/Jazz/JazzSdkModule.swift` | Мост в `Jazz` / `JazzSession.shared` + провайдер токена |
| Регистрация модуля | `ios/SberJazz/Jazz/JazzSdkModule.m` | `RCT_EXTERN_MODULE(JazzSdk, RCTEventEmitter)` |
| Обход конфликта | `ios/SberJazz/Jazz/JazzShadowedClasses.swift` | Поиск классов RN в обход дубликатов из JazzCore |
| Зависимость | `ios/Podfile` | `pod 'JazzSDK', :git => 'https://github.com/salute-developers/jazz-ios-sdk.git', :branch => 'main'` |
| Нативный модуль (Android) | `android/app/src/main/java/com/sberjazz/jazz/JazzSdkModule.kt` | Мост в `JazzIntegrationClient` (тот же JS-интерфейс) |
| Установка SDK (Android) | `android/…/jazz/JazzInstaller.kt` | `installJazzSdk` с `JazzConfig.Custom` + провайдер токена |
| Регистрация модуля (Android) | `android/…/jazz/JazzSdkPackage.kt` + `MainApplication.kt` | `add(JazzSdkPackage())`, `JazzSdkModule.install(this)` |
| Зависимость (Android) | `android/build.gradle`, `android/app/build.gradle` | Maven-репозиторий Jazz, `jazz-public-sdk` + `jazz-public-bom`, `minSdk 26` |
| Архитектура | `src/arch.ts` | Определение активной архитектуры в рантайме |

## Требования

**iOS**

* macOS + Xcode 14.3.1 и выше (проект собирался на Xcode 26.5)
* iOS 15.1+ (deployment target проекта; сам SDK требует iOS 15.0+)
* Node 18+, CocoaPods 1.13+
* Локаль процесса в UTF-8 — иначе CocoaPods падает с
  `Unicode Normalization not appropriate for ASCII-8BIT`. Это про кодировку,
  а не про язык: системный Ruby 2.6 из macOS без UTF-8-локали стартует в
  US-ASCII и спотыкается на `unicode_normalize` для путей. npm-скрипты
  `pods` / `pods:newarch` уже проставляют `LC_ALL=C.UTF-8` сами.

  Вручную это нужно, только если запускаете `pod install` напрямую:

  ```bash
  export LC_ALL=C.UTF-8
  ```

**Android**

* Android SDK Platform 35, `minSdk 26` (Android 8.0+ — требование Jazz)
* JDK 17+. На Mac с Apple Silicon берите **arm64**-сборку JDK: x86_64-JDK
  работает через Rosetta, и первая сборка с Jazz (~120 AAR) идёт десятки
  минут вместо пары. Проверка: `file $(/usr/libexec/java_home)/bin/java` →
  должно быть `arm64`.

## Запуск

```bash
npm install
```

```bash
npm run pods
```

> Первый `pod install` скачивает ~900 МБ xcframework'ов Jazz — это долго,
> дальше всё берётся из кеша CocoaPods.

```bash
npm run ios
```

Или откройте `ios/SberJazz.xcworkspace` (именно **workspace**, не `.xcodeproj`)
и нажмите Run.

Android (эмулятор или устройство должны быть запущены):

```bash
npm run android
```

> Первая сборка скачивает из Maven-репозитория Jazz ~120 AAR (~50 МБ) и
> собирает APK около 240 МБ (все ABI). Для отладки на одном эмуляторе можно
> собрать только его ABI: `cd android && ./gradlew installDebug -PreactNativeArchitectures=arm64-v8a`.

## Архитектура React Native

**iOS.** Архитектура выбирается на этапе `pod install` через `RCT_NEW_ARCH_ENABLED`.
`ios/Podfile` выставляет ей значение `0` по умолчанию (у самого RN 0.77
по умолчанию `1`), поэтому «из коробки» проект собирается на старой
архитектуре.

```bash
npm run pods          # старая архитектура: Paper + bridge (по умолчанию)
```

```bash
npm run pods:newarch  # новая архитектура: Fabric + TurboModules
```

После переключения пересоберите нативную часть (`npm run ios` или Run в Xcode);
JS-код и нативный модуль не меняются.

**Android.** Флаг `newArchEnabled` в `android/gradle.properties` — по умолчанию
`false` (у шаблона RN 0.77 — `true`), чтобы платформы вели себя одинаково.

```bash
npm run android          # старая архитектура (по умолчанию)
```

```bash
npm run android:newarch  # новая: -PnewArchEnabled=true
```

Что делает совместимость возможной:

* **Нативный модуль — обычный bridge-модуль** (`RCT_EXTERN_MODULE` +
  `RCTEventEmitter` на iOS, `ReactContextBaseJavaModule` на Android), без
  codegen и без TurboModule-спеки. В старой архитектуре
  он регистрируется напрямую в реестре моста, в новой — подхватывается
  interop-слоем нативных модулей. Имя одно и то же: `NativeModules.JazzSdk`.
* **JS-слой** работает через `NativeModules` / `NativeEventEmitter` — API,
  доступный в обеих архитектурах.
* **Нигде нет `#if RCT_NEW_ARCH_ENABLED`** / `IS_NEW_ARCHITECTURE_ENABLED` —
  один и тот же исходник собирается в обоих режимах.
* `src/arch.ts` определяет активную архитектуру в рантайме (по
  `global.RN$Bridgeless`, `__turboModuleProxy`, `nativeFabricUIManager`);
  `console.log(architectureLabel)` покажет, что собралось то, что ожидалось.

Обе конфигурации проверены на симуляторе: приложение стартует и
`Jazz.initialize` доходит до SDK (см. скриншоты в `docs/`; они сделаны ещё
со старой инициализацией по ключу).

## Экран приложения

На экране одна кнопка **«Online Встреча»**. Комната создаётся вне
приложения — в приложение приходит только ссылка вида
`https://salutejazz.ru/<код>?psw=<пароль>`. По нажатию приложение
инициализирует SDK (только в первый раз) и входит во встречу:

* **iOS** — разбирает ссылку через `Jazz.handleUrl` и вызывает
  `Jazz.joinConference` с кодом и паролем встречи;
* **Android** — передаёт ссылку целиком: `Jazz.joinConference({meetingUrl})`
  (Android SDK разбирает её сам; `psw` в ссылке — это не пароль в открытом
  виде, поэтому вручную его не разобрать).

Дальше весь UI — экран входа (имя, микрофон, камера, кнопка Join), сама
встреча, выход — рисует Jazz.

В демо ссылка задана константой `MEETING_URL` в `App.tsx` — подставьте свою
(например, из вашего API).

Вся логика — в хуке `useJazzMeeting`, компоненту остаётся кнопка:

```tsx
import {useJazzMeeting} from './src/jazz/useJazzMeeting';

const {joinMeeting, busy} = useJazzMeeting({
  getTransportToken: () => api.getJazzTransportToken(),
});

<Button
  title="Online Встреча"
  onPress={() => joinMeeting(meetingUrl)}
  disabled={busy}
/>;
```

| Опция | По умолчанию | |
| --- | --- | --- |
| `getTransportToken` | — (обязательна) | транспортный JWT от вашего бэкенда; обмен на токен доступа хук делает сам |
| `hostUrl` | `https://salutejazz.ru` | хост Jazz |
| `onError(error, stage)` | `Alert` с текстом ошибки | `stage`: `'join'` — не удалось разобрать ссылку / открыть встречу, `'token'` — не получен токен |

Возвращает `joinMeeting(url)`, `busy` (идёт подключение — повторные нажатия
игнорируются) и `isSupported` (`false`, если нативный модуль не слинкован).
Ошибку токена хук показывает один раз за нажатие, даже если SDK запросил токен
несколько раз (Android делает 6–8 запросов за вход).
Ссылки на вебинар тоже подходят; ссылки на трансляцию или карточку встречи —
нет, `joinMeeting` сообщит об этом через `onError`.

Перед запуском реализуйте `getJazzTransportToken()` в `App.tsx` — запрос к
вашему бэкенду за транспортным токеном. Пока там заглушка: экран Jazz
откроется, а после Join приложение покажет «Не удалось получить токен Jazz».

## Авторизация по токену

iOS SDK инициализируется с `conferenceAuthorizationType: .jazzToken(...)`,
Android — с `JazzConfig.Custom`, где `jazzTokenProvider` — наш
`RNJazzTokenProvider` (`JazzConfig.Simple` из примеров Sber умеет только
ключ SDK). На обеих платформах ключ SDK в приложение не попадает, Jazz
получает готовый **токен доступа**.
Это рекомендованная схема из
[документации SaluteJazz](https://developers.sber.ru/docs/ru/jazz/sdk/authorization-patterns).

```
 ваш бэкенд                  приложение (JS)                 Jazz SDK (iOS / Android)
 ──────────                  ───────────────                     ──────────────
                                                    ◀── нужен токен (provideToken)
                             ◀── событие JazzTokenRequested {requestId}
 транспортный JWT ─────────▶ getTransportToken()
                             POST https://api.salutejazz.ru/v1/auth/login
                               Authorization: Bearer <транспортный JWT>
                             ◀── { "token": "<токен доступа>" }
                             resolveTokenRequest(requestId, token) ──▶ .success(token)
```

1. **Транспортный токен** выпускает ваш бэкенд: JWT, подписанный ключом SDK
   (ES256/ES384 по `kty`/`crv` ключа), с claims `iat`, `exp`, `jti` (uuid4),
   `sub` (uuid4 пользователя), `sdkProjectId` (uuid4 проекта из Studio) и
   опционально `userName`, `userEmail`, `iss`. Подробности —
   [API: авторизация](https://developers.sber.ru/docs/ru/jazz/api/authorization).
2. **Обмен на токен доступа** делает приложение — `exchangeTransportToken()`
   из `src/jazz/jazzAuth.ts`. Тело запроса пустое, транспортный токен идёт в
   заголовке `Authorization: Bearer`, ответ — `{ "token": "..." }`.
3. **Передача в SDK.** Токен — это не параметр `initialize`, а функция
   `getToken`: Jazz сам вызывает провайдер, когда токен нужен (например, при
   старте встречи), и может вызвать его снова, когда старый истёк.
   Нативный `RNJazzTokenProvider` пересылает запрос в JS событием
   `JazzTokenRequested`, обёртка в `JazzSdk.ts` вызывает `getToken` и
   возвращает результат через `resolveTokenRequest` / `rejectTokenRequest`.
   Если JS не ответил за 30 секунд или бросил ошибку, SDK получает
   `ConferenceTokenError.invalidToken` (iOS) или `null` (Android: исключение
   из провайдера Jazz не ловит, и оно роняет приложение — поэтому провайдер
   возвращает `null`, а ошибку пишет в logcat).

`Jazz.initialize` сам сеть не трогает и с любым `getToken` резолвится `true`;
неверный токен проявится позже — когда SDK его запросит. Проверено на
симуляторе: **вход во встречу по ссылке без токена невозможен** — после Join
SDK запрашивает токен и без него не подключается (то же для старта новой
встречи). Создание ссылки (`createConference`) токен не запрашивает, но в
этом приложении комнаты не создаются.

### Различия платформ, найденные при проверке

| | iOS | Android |
| --- | --- | --- |
| Когда SDK просит токен | после Join на экране входа | сразу при `joinConference`, ещё до экрана входа, и повторно после Join (6–8 раз за вход) |
| Нет токена / токен неверный | не подключается | **входит как гость**, если в комнате разрешены гости (проверено на комнате с гостями: встреча открылась, `OnMeetingJoined`) |
| Экран после выхода | — | свой экран оценки звонка Jazz, затем возврат в приложение |

Отсюда практический вывод для «только для сотрудников»: на Android ограничение
держится не на токене, а на настройках комнаты. Создавайте встречи с
**выключенными гостями** (`isGuestsOn: false`) — тогда без валидного токена
войти нельзя.

Хост Jazz по умолчанию — `https://salutejazz.ru` (`jazz.sber.ru` теперь
редиректит туда, а сертификат старого домена SDK отвергает).

## JS API

```ts
import Jazz from './src/jazz/JazzSdk';
import {createJazzTokenProvider} from './src/jazz/jazzAuth';

await Jazz.initialize({
  // getTransportToken — ваш запрос к своему бэкенду за транспортным JWT;
  // createJazzTokenProvider меняет его на токен доступа через /v1/auth/login
  getToken: createJazzTokenProvider(() => api.getJazzTransportToken()),
  hostUrl: 'https://salutejazz.ru', // необязательно, это значение по умолчанию
});

// создать встречу и получить ссылку
const url = await Jazz.createConference({title: 'Планёрка', type: 'meeting'});

// создать и сразу войти
await Jazz.startConference({title: 'Планёрка', isMicrophoneOn: true});

// войти по коду встречи (на iOS без кода Jazz покажет свой экран ввода)
await Jazz.joinConference({roomId: '123-456-789', roomPassword: 'secret'});

// Android: войти по ссылке целиком
await Jazz.joinConference({meetingUrl: 'https://salutejazz.ru/abc?psw=...'});

// iOS: разобрать ссылку-приглашение (на Android — ошибка E_JAZZ_UNSUPPORTED)
const target = await Jazz.handleUrl('https://salutejazz.ru/abc?psw=...', 'applink');

await Jazz.terminateActiveConference();

// фаза конференции: inactive | connecting | conferenceLobby |
// activeConference | webinarLobby | activeWebinar | waitingStream | activeStream
const sub = Jazz.addConferencePhaseListener(e => console.log(e.phase));
sub?.remove();
```

Событие фазы приходит из Combine-подписки на
`JazzSession.shared.$jazzConferencePhase` (iOS) или из
`JazzIntegrationClient.roomLifecycle` (Android). Android присылает только
`inactive | connecting | conferenceLobby | activeConference`, без `room`.

Отличия Android-модуля в остальном API:

* `createConference` создаёт встречу без UI (`scheduleConference`) и
  возвращает ссылку; `startConference` — `createConference` из Android SDK
  (создать и сразу войти).
* `userName` в опциях — имя участника (iOS берёт его со своего экрана входа).
* `skipIntermediateScreen`, `roomHost`, `screenShareExtensionIdentifier`
  на Android игнорируются.

## Разрешения

**Android:** ничего добавлять не нужно — камера, микрофон, Bluetooth,
foreground service и т. д. приходят из манифестов Jazz при мерже, а
runtime-запрос разрешений Jazz делает сам на экране входа.

**iOS:** `ios/SberJazz/Info.plist` уже содержит всё, что требует SDK:

* `NSMicrophoneUsageDescription`, `NSCameraUsageDescription`
* `NSBluetoothAlwaysUsageDescription`, `NSBluetoothPeripheralUsageDescription`
  (перевод звонка на Sber-устройства)
* `NSLocalNetworkUsageDescription` + `NSBonjourServices` → `_staros._tcp`
  (поиск Sber-устройств в локальной сети)
* `UIBackgroundModes` → `audio`, `voip`

## Демонстрация экрана (не подключено)

Для screen sharing нужен отдельный таргет **Broadcast Upload Extension**;
это требует App Groups и своего provisioning-профиля, поэтому в демо не
включено. Порядок подключения — в
[README SDK](https://github.com/salute-developers/jazz-ios-sdk#подключение-функционала-демонстрации-экрана);
со стороны этого проекта достаточно передать bundleId расширения:

```ts
await Jazz.initialize({..., screenShareExtensionIdentifier: 'com.example.SberJazz.Broadcast'});
```

## Android: что пришлось учесть

1. **Свой React Native внутри Jazz.** Android SDK зависит от
   `com.facebook.react:react-native:0.61.5-jitsi.6` (наследие Jitsi), и эта
   сборка лежит в Maven-репозитории Jazz; плагин RN подменяет её на
   `react-android` 0.77.3. Сам репозиторий подключён через `exclusiveContent`
   с точным списком: группы Jazz (`com.sdkit.jazz`, `ru.sberdevices.core`,
   `ru.sberbank.mobile.qr`, `ru.sberbank.sdakit.sbercast`) и две версии из
   закрытого jcenter (`zoomlayout 1.8.0`, `egloo 0.4.0`). Эти артефакты
   берутся только оттуда, а остальные библиотеки — только из официальных
   репозиториев. Сами встречи идут через JazzNext без RN — в логах
   `JazzNextSessionAdapterImpl … OnMeetingJoined`.
2. **Свой Hermes.** `com.sdkit.jazz:hermes` дублирует `hermes-android` из RN:
   без `exclude(group: "com.sdkit.jazz", module: "hermes")` сборка падает с
   `Duplicate class com.facebook.hermes.BuildConfig`.
3. **`minSdk 26`** — требование большинства AAR Jazz (в шаблоне RN — 24).
4. **Установка в `Application.onCreate`.** `JazzSdkModule.install(this)` в
   `MainApplication` — так требует SDK: система может пересоздать экран
   встречи раньше, чем загрузится JS. `initialize` из JS только задаёт хост и
   подключает токен.
5. **Провайдер токена не бросает исключений** — Jazz их не ловит (см.
   «Авторизация по токену»). Ошибка установки SDK в `Application.onCreate`
   тоже не роняет приложение: встречи становятся недоступны, а `initialize`
   возвращает эту ошибку.
6. **Отмена — не ошибка.** Если пользователь сам закрыл экран входа / зал
   ожидания Jazz, `joinConference` резолвится `false`, и хук не показывает
   Alert.
7. **Перезагрузка JS и смена хоста.** «Инициализирован» хранится у экземпляра
   модуля (как на iOS), поэтому после перезагрузки JS хук снова вызывает
   `initialize` и заново подписывается на запросы токена. При другом
   `hostUrl` хук тоже повторяет `initialize`.
8. Если в приложении переопределён WorkManager (`Configuration.Provider`), в
   `DelegatingWorkerFactory` нужно добавить
   `JazzSdk.getIntegrationClientApi().jazzWorkerFactory`. Здесь он не
   переопределён.

## Что пришлось починить на iOS, чтобы это собралось и запустилось

Обе правки живут в `ios/Podfile` / `ios/SberJazz/AppDelegate.swift` и подробно
закомментированы прямо в коде.

### 1. `fmt` не собирается на Xcode 16.3+/26

React Native 0.77 пинит `fmt` 11.0.2, чей `consteval`-конструктор строк
формата новый Clang отвергает: `call to consteval function ... is not a
constant expression` (исправлено в fmt 11.1).

`fmt/base.h` определяет `FMT_USE_CONSTEVAL` безусловно, поэтому флаг `-D`
перебивается заголовком. `post_install` в Podfile патчит эту проверку так,
чтобы внешнее определение имело приоритет, и выставляет
`FMT_USE_CONSTEVAL=0` — валидация строк формата уезжает из compile-time в
runtime, что для RN/Folly здесь достаточно.

### 2. JazzCore содержит вторую копию React Native

`JazzCore.xcframework` статически включает **целый второй React Native** — свой
JSC-based JSI, Yoga, glog, folly, double-conversion — и экспортирует ~1200 этих
символов, включая все ~190 Objective-C классов `RCT*`. В приложении на React
Native это даёт два конфликта:

**Символы.** CocoaPods перечисляет фреймворки по алфавиту, поэтому
`-framework "JazzCore"` оказывается раньше `-framework "hermes"`. React Native
берёт `facebook::jsi::*` из `hermes.framework`, но линковщик привязывал эти
ссылки к JazzCore — и приложение звало JSC-версию JSI поверх Hermes-рантайма.
Результат — SIGSEGV на JS-потоке ещё на старте.
→ `post_install` переносит фреймворки Jazz в конец `OTHER_LDFLAGS`.
Проверка: `nm -m SberJazz.debug.dylib | grep "(from JazzCore)"` должен быть пуст.

**Классы.** Дубли Objective-C классов резолвятся в копию Jazz, поэтому
`NSClassFromString("RCTImageLoader")` отдавал класс из JazzCore, который старше
TurboModules — и любой модуль, который RN ищет по имени, падал с
`TurboModuleRegistry.getEnforcing('ImageLoader'): could not be found`.
→ `Jazz/JazzShadowedClasses.swift` ищет класс в `__objc_classlist` загруженных
образов, пропуская `JazzCore.framework`; `AppDelegate` только пробрасывает в
него `getModuleClassFromName:` (4 строки).

Это касается только **новой** архитектуры: поиск по имени делает
`RCTTurboModuleManager`. В старой модули берутся из `RCTGetModuleClasses()` —
это прямые указатели на классы, зарегистрированные собственным `+load`
приложения, поэтому подмены не происходит. Переопределение оставлено
безусловным, чтобы один и тот же исходник собирался в обеих архитектурах;
в старой оно просто не вызывается.

При старте в консоли остаются предупреждения
`objc: Class RCT… is implemented in both …` — это те самые дубликаты. Убрать их
может только сам Jazz, собрав `JazzCore` без встроенного React Native.

## Проверки

```bash
npm run lint && npx tsc --noEmit && npm test
```

**iOS** — iPhone 17 Pro (iOS 26.5), Xcode 26.5, **в обеих архитектурах**:
приложение запускается, `NativeModules.JazzSdk` доступен, вызовы доходят до SDK.

| | Сборка | Запуск | `NativeModules.JazzSdk` | Вызов `Jazz.initialize` |
| --- | --- | --- | --- | --- |
| Старая (Paper + bridge) | ✅ | ✅ | ✅ | ✅ |
| Новая (Fabric + TurboModules) | ✅ | ✅ | ✅ | ✅ |

**Android** — эмулятор Pixel 6 Pro (Android 13, arm64), в обеих архитектурах:

| | Сборка | Запуск | `NativeModules.JazzSdk` | Join по ссылке → экран Jazz |
| --- | --- | --- | --- | --- |
| Старая (Paper + bridge) | ✅ | ✅ | ✅ | ✅ |
| Новая (Fabric + bridgeless) | ✅ | ✅ | ✅ | ✅ |

На старой архитектуре пройден полный цикл с заведомо неверным транспортным
токеном: «Online Встреча» → SDK запрашивает токен → JS шлёт
`POST /v1/auth/login` → `401 TOKEN_INVALID` → провайдер отдаёт SDK `null` →
экран входа Jazz → Join → встреча (как гость: в тестовой комнате разрешены
гости) → «Leave the meeting» → экран оценки → возврат в приложение, кнопка
снова активна. С настоящим токеном не проверялось — его выдаёт ваш бэкенд.

Авторизация по токену на iOS проверена на старой архитектуре с заведомо неверным
транспортным токеном: `initialize` → `ok`, «Начать конференцию» → SDK
запрашивает токен → JS шлёт `POST https://api.salutejazz.ru/v1/auth/login` →
сервер отвечает `401 {"errorCode":"TOKEN_INVALID"}` → SDK получает
`invalidToken` и закрывает экран встречи. С настоящим транспортным токеном
от вашего бэкенда на этом шаге вернётся токен доступа.
