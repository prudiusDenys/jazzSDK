# SberJazz — React Native 0.77.3 + Jazz iOS SDK

Демонстрационное приложение на **React Native CLI 0.77.3** с подключённым
**[Sber Jazz iOS SDK](https://github.com/salute-developers/jazz-ios-sdk)**
(видеовстречи Jazz внутри вашего приложения).

> Переносите интеграцию в другой проект? — [**PORTING.md**](PORTING.md):
> что скопировать, куда вставить и как проверить.

Собирается под **обе архитектуры React Native**. По умолчанию — **старая**
(Paper + классический мост, без TurboModules и Fabric); новая включается одной
командой, менять код не нужно.

## Что внутри

| Слой | Файл | Назначение |
| --- | --- | --- |
| JS API | `src/jazz/JazzSdk.ts` | Типизированная обёртка над нативным модулем |
| Авторизация | `src/jazz/jazzAuth.ts` | Обмен транспортного токена на токен доступа (`POST /v1/auth/login`) |
| Хук | `src/jazz/useJazzMeeting.ts` | `joinMeeting(url)`: initialize при первом вызове + вход во встречу по ссылке |
| UI | `App.tsx` | Одна кнопка «Online Встреча» — открывает экран встречи Jazz |
| Нативный модуль | `ios/SberJazz/Jazz/JazzSdkModule.swift` | Мост в `Jazz` / `JazzSession.shared` + провайдер токена |
| Регистрация модуля | `ios/SberJazz/Jazz/JazzSdkModule.m` | `RCT_EXTERN_MODULE(JazzSdk, RCTEventEmitter)` |
| Обход конфликта | `ios/SberJazz/Jazz/JazzShadowedClasses.swift` | Поиск классов RN в обход дубликатов из JazzCore |
| Зависимость | `ios/Podfile` | `pod 'JazzSDK', :git => 'https://github.com/salute-developers/jazz-ios-sdk.git', :branch => 'main'` |
| Архитектура | `src/arch.ts` | Определение активной архитектуры в рантайме |

## Требования

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

## Архитектура React Native

Архитектура выбирается на этапе `pod install` через `RCT_NEW_ARCH_ENABLED`.
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

Что делает совместимость возможной:

* **Нативный модуль — обычный bridge-модуль** (`RCT_EXTERN_MODULE` +
  `RCTEventEmitter`), без codegen и без TurboModule-спеки. В старой архитектуре
  он регистрируется напрямую в реестре моста, в новой — подхватывается
  interop-слоем нативных модулей. Имя одно и то же: `NativeModules.JazzSdk`.
* **JS-слой** работает через `NativeModules` / `NativeEventEmitter` — API,
  доступный в обеих архитектурах.
* **Нигде нет `#if RCT_NEW_ARCH_ENABLED`** — один и тот же исходник собирается
  в обоих режимах.
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
инициализирует SDK (только в первый раз), разбирает ссылку через
`Jazz.handleUrl` и вызывает `Jazz.joinConference` с кодом и паролем встречи.
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
игнорируются) и `isSupported` (`false` на Android / без нативного модуля).
Ссылки на вебинар тоже подходят; ссылки на трансляцию или карточку встречи —
нет, `joinMeeting` сообщит об этом через `onError`.

Перед запуском реализуйте `getJazzTransportToken()` в `App.tsx` — запрос к
вашему бэкенду за транспортным токеном. Пока там заглушка: экран Jazz
откроется, а после Join приложение покажет «Не удалось получить токен Jazz».

## Авторизация по токену

SDK инициализируется с `conferenceAuthorizationType: .jazzToken(...)`: ключ
SDK в приложение не попадает, Jazz получает готовый **токен доступа**.
Это рекомендованная схема из
[документации SaluteJazz](https://developers.sber.ru/docs/ru/jazz/sdk/authorization-patterns).

```
 ваш бэкенд                  приложение (JS)                     Jazz SDK (iOS)
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
   `ConferenceTokenError.invalidToken`.

`Jazz.initialize` сам сеть не трогает и с любым `getToken` резолвится `true`;
неверный токен проявится позже — когда SDK его запросит. Проверено на
симуляторе: **вход во встречу по ссылке без токена невозможен** — после Join
SDK запрашивает токен и без него не подключается (то же для старта новой
встречи). Создание ссылки (`createConference`) токен не запрашивает, но в
этом приложении комнаты не создаются.

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

// войти по коду встречи (без кода Jazz покажет свой экран ввода)
await Jazz.joinConference({roomId: '123-456-789', roomPassword: 'secret'});

// разобрать ссылку-приглашение
const target = await Jazz.handleUrl('https://salutejazz.ru/abc?psw=...', 'applink');

await Jazz.terminateActiveConference();

// фаза конференции: inactive | connecting | conferenceLobby |
// activeConference | webinarLobby | activeWebinar | waitingStream | activeStream
const sub = Jazz.addConferencePhaseListener(e => console.log(e.phase));
sub?.remove();
```

Событие фазы приходит из Combine-подписки на
`JazzSession.shared.$jazzConferencePhase` внутри нативного модуля.

## Разрешения

`ios/SberJazz/Info.plist` уже содержит всё, что требует SDK:

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

## Android

Jazz SDK подключён только для iOS (как и просили). На Android
`Jazz.isJazzSupported === false`, а вызовы бросают понятную ошибку линковки.

## Что пришлось починить, чтобы это собралось и запустилось

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

Проверено на iPhone 17 Pro (iOS 26.5), Xcode 26.5 — **в обеих архитектурах**:
приложение запускается, `NativeModules.JazzSdk` доступен, вызовы доходят до SDK.

| | Сборка | Запуск | `NativeModules.JazzSdk` | Вызов `Jazz.initialize` |
| --- | --- | --- | --- | --- |
| Старая (Paper + bridge) | ✅ | ✅ | ✅ | ✅ |
| Новая (Fabric + TurboModules) | ✅ | ✅ | ✅ | ✅ |

Авторизация по токену проверена на старой архитектуре с заведомо неверным
транспортным токеном: `initialize` → `ok`, «Начать конференцию» → SDK
запрашивает токен → JS шлёт `POST https://api.salutejazz.ru/v1/auth/login` →
сервер отвечает `401 {"errorCode":"TOKEN_INVALID"}` → SDK получает
`invalidToken` и закрывает экран встречи. С настоящим транспортным токеном
от вашего бэкенда на этом шаге вернётся токен доступа.
