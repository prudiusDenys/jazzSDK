# SberJazz — React Native 0.77.3 + Jazz iOS SDK

Демонстрационное приложение на **React Native CLI 0.77.3** с подключённым
**[Sber Jazz iOS SDK](https://github.com/salute-developers/jazz-ios-sdk)**
(видеовстречи Jazz внутри вашего приложения).

> Переносите интеграцию в другой проект? — [**PORTING.md**](PORTING.md):
> что скопировать, куда вставить и как проверить.

Собирается под **обе архитектуры React Native**. По умолчанию — **старая**
(Paper + классический мост, без TurboModules и Fabric); новая включается одной
командой, менять код не нужно. Активная архитектура выводится прямо на экране.

## Что внутри

| Слой | Файл | Назначение |
| --- | --- | --- |
| JS API | `src/jazz/JazzSdk.ts` | Типизированная обёртка над нативным модулем |
| UI | `App.tsx` | Демо-экран: инициализация, создание / старт / вход в конференцию |
| Нативный модуль | `ios/SberJazz/Jazz/JazzSdkModule.swift` | Мост в `Jazz` / `JazzSession.shared` |
| Регистрация модуля | `ios/SberJazz/Jazz/JazzSdkModule.m` | `RCT_EXTERN_MODULE(JazzSdk, RCTEventEmitter)` |
| Обход конфликта | `ios/SberJazz/Jazz/JazzShadowedClasses.swift` | Поиск классов RN в обход дубликатов из JazzCore |
| Зависимость | `ios/Podfile` | `pod 'JazzSDK', :git => 'https://github.com/salute-developers/jazz-ios-sdk.git', :branch => 'main'` |
| Архитектура | `src/arch.ts` | Определение активной архитектуры в рантайме |

## Требования

* macOS + Xcode 14.3.1 и выше (проект собирался на Xcode 26.5)
* iOS 15.1+ (deployment target проекта; сам SDK требует iOS 15.0+)
* Node 18+, CocoaPods 1.13+
* Ruby-локаль в UTF-8 — иначе CocoaPods падает с
  `Unicode Normalization not appropriate for ASCII-8BIT`:

  ```bash
  export LANG=en_US.UTF-8
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
  `global.RN$Bridgeless`, `__turboModuleProxy`, `nativeFabricUIManager`) и
  показывает её на экране — удобно, чтобы убедиться, что собралось то, что
  ожидалось.

Обе конфигурации проверены на симуляторе: приложение стартует и
`Jazz.initialize` доходит до SDK (см. скриншоты в `docs/`).

## Ключ SDK

Jazz авторизует приложение по секретному ключу, который выдаётся при
регистрации приложения в [кабинете разработчика Sber](https://developers.sber.ru/docs/ru/jazz/sdk/overview).
Ключ вводится прямо на демо-экране и передаётся в
`Jazz.initialize(conferenceAuthorizationType: .secretKey(...))`.

Без валидного ключа инициализация вернёт ошибку
`E_JAZZ_INIT_FAILED` (`JazzSDKError.invalidSDKSecret`) — это ожидаемое
поведение, а не поломка интеграции.

## JS API

```ts
import Jazz from './src/jazz/JazzSdk';

await Jazz.initialize({
  sdkSecret: '<ваш ключ>',
  hostUrl: 'https://jazz.sber.ru',
  userId: '123456',
  userName: 'React Native User',
});

// создать встречу и получить ссылку
const url = await Jazz.createConference({title: 'Планёрка', type: 'meeting'});

// создать и сразу войти
await Jazz.startConference({title: 'Планёрка', isMicrophoneOn: true});

// войти по коду встречи (без кода Jazz покажет свой экран ввода)
await Jazz.joinConference({roomId: '123-456-789', roomPassword: 'secret'});

// разобрать ссылку-приглашение
const target = await Jazz.handleUrl('https://jazz.sber.ru/abc?psw=...', 'applink');

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
приложение запускается, `NativeModules.JazzSdk` доступен, а `Jazz.initialize`
с невалидным ключом корректно возвращает ошибку `JazzSDKError.invalidSDKSecret`
из самого SDK.

| | Сборка | Запуск | `NativeModules.JazzSdk` | Вызов `Jazz.initialize` |
| --- | --- | --- | --- | --- |
| Старая (Paper + bridge) | ✅ | ✅ | ✅ | ✅ |
| Новая (Fabric + TurboModules) | ✅ | ✅ | ✅ | ✅ |
