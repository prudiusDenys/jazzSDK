# Перенос интеграции Jazz SDK в другой проект

Инструкция «что скопировать и куда вставить», чтобы поднять Jazz SDK
в другом React Native приложении. Шаги 1–6 — iOS, Android — в
[отдельном разделе](#android) (он короче: обходов почти не нужно).

Порядок ниже выстроен так, чтобы после каждого шага можно было собраться и
убедиться, что ничего не сломалось. Не переставляйте шаги местами: шаг 4
(правки Podfile) — обязательный, без него проект **соберётся, но упадёт при
запуске**.

**Время:** ~30 минут, плюс один долгий `pod install` (SDK весит ~900 МБ).

---

## Что вообще происходит

Интеграция состоит из трёх слоёв. Первые два — обычный код, который просто
копируется. Третий — обход двух багов окружения, и именно он занимает
большую часть инструкции.

| Слой | Файлы | Переносится |
| --- | --- | --- |
| Нативный мост в SDK | `ios/SberJazz/Jazz/JazzSdkModule.{swift,m}` | копированием как есть |
| JS-обёртка | `src/jazz/JazzSdk.ts`, `src/jazz/jazzAuth.ts`, `src/jazz/useJazzMeeting.ts` | копированием как есть |
| Обходы багов окружения | `ios/Podfile`, `ios/SberJazz/Jazz/JazzShadowedClasses.swift`, 4 строки в `AppDelegate` | вставками в существующие файлы |
| Android | `android/app/src/main/java/com/sberjazz/jazz/*.kt`, Gradle, 2 строки в `MainApplication` | см. [раздел Android](#android) |

Почему нужен третий слой — коротко:

1. **`fmt` не собирается на Xcode 16.3+/26.** Это баг React Native 0.77, а не
   Jazz. Проявится, даже если Jazz не подключать.
2. **`JazzCore.xcframework` содержит вторую копию React Native** — свой
   JSC-based JSI, Yoga, glog, folly и все ~190 Objective-C классов `RCT*`.
   Они конфликтуют с настоящим RN в вашем приложении. Без обхода — SIGSEGV на
   старте.

Подробный разбор обеих проблем — в [README.md](README.md), раздел
«Что пришлось починить».

---

## Требования к принимающему проекту

Проверьте до начала — если что-то не сходится, см. «Если проект отличается».

| Требование | Почему |
| --- | --- |
| React Native 0.72+ | ниже не проверялось; мост — классический bridge-модуль, должен работать и раньше |
| В проекте есть хотя бы один Swift-файл | JazzSDK — Swift-only, мост тоже на Swift |
| iOS deployment target ≥ 15.1 | JazzSDK требует iOS 15.0+ |
| CocoaPods 1.13+ | |
| Локаль процесса в UTF-8 | иначе CocoaPods падает с `Unicode Normalization not appropriate for ASCII-8BIT`. Это про кодировку, а не про язык |

```bash
export LC_ALL=C.UTF-8
```

Архитектура RN значения не имеет: интеграция работает и на старой
(Paper + bridge), и на новой (Fabric + TurboModules). Ничего не нужно менять
при переключении.

---

## Шаг 1. Скопировать нативный мост

Скопируйте папку целиком, заменив `SberJazz` на имя вашего таргета:

```bash
cp -R ios/SberJazz/Jazz <ваш-проект>/ios/<ВашТаргет>/Jazz
```

Внутри три файла:

| Файл | Что делает |
| --- | --- |
| `JazzSdkModule.swift` | сам мост: `Jazz.initialize` (авторизация `.jazzToken`), провайдер токена, create / start / join / terminate, разбор ссылок, события фазы конференции |
| `JazzSdkModule.m` | регистрация модуля в RN (`RCT_EXTERN_MODULE`) |
| `JazzShadowedClasses.swift` | обход дубликатов классов из JazzCore (шаг 5) |

Правок внутри файлов не требуется — имя таргета в них не зашито.

**Добавьте файлы в таргет в Xcode**: перетащите папку `Jazz` в навигатор
проекта, в диалоге отметьте «Copy items if needed» и галочку вашего таргета.
Проверьте, что все три файла попали в **Build Phases → Compile Sources**.
Файлы, лежащие на диске, но не добавленные в таргет, — самая частая причина
«модуль не найден» дальше.

Если в проекте до этого не было ни одного Objective-C файла, Xcode предложит
создать **bridging header** — согласитесь. Содержимое может остаться пустым,
сам факт его наличия включает Swift↔ObjC мост.

## Шаг 2. Скопировать JS-обёртку

```bash
mkdir -p <ваш-проект>/src/jazz
```

```bash
cp src/jazz/JazzSdk.ts src/jazz/jazzAuth.ts src/jazz/useJazzMeeting.ts <ваш-проект>/src/jazz/
```

* `JazzSdk.ts` — обёртка над нативным модулем;
* `jazzAuth.ts` — обмен транспортного токена на токен доступа
  (`POST https://api.salutejazz.ru/v1/auth/login`);
* `useJazzMeeting.ts` — хук для кнопки: initialize при первом нажатии +
  вход во встречу по ссылке.

Все три зависят только от `react` / `react-native` и кладутся рядом в любое
удобное место (импорты между ними относительные).

Кнопка в вашем приложении:

```tsx
import {useJazzMeeting} from './src/jazz/useJazzMeeting';

function MeetingButton() {
  const {joinMeeting, busy} = useJazzMeeting({
    getTransportToken: () => api.getJazzTransportToken(),
  });
  return (
    <Button
      title="Online Встреча"
      onPress={() => joinMeeting(meetingUrl)} // https://salutejazz.ru/<код>?psw=...
      disabled={busy}
    />
  );
}
```

Остальные опции хука (`hostUrl`, `onError`) — в README, раздел
«Экран приложения».

`api.getJazzTransportToken()` — ваш запрос к своему бэкенду; бэкенд
подписывает транспортный JWT ключом SDK (схема — в README, раздел
«Авторизация по токену»). Ключ SDK в приложение не кладите.

`src/arch.ts` и `App.tsx` копировать не нужно: первый — диагностика активной
архитектуры, второй — демо-экран с одной кнопкой на этом хуке.

## Шаг 3. Разрешения в Info.plist

Добавьте в `ios/<ВашТаргет>/Info.plist`. Без этих ключей приложение падает при
первом обращении к камере или микрофону:

```xml
<key>NSMicrophoneUsageDescription</key>
<string>Доступ к микрофону нужен, чтобы общаться голосом во время видеовстреч</string>
<key>NSCameraUsageDescription</key>
<string>Доступ к камере нужен, чтобы общаться с видео во время видеовстреч</string>
<key>NSBluetoothAlwaysUsageDescription</key>
<string>Доступ к Bluetooth нужен для перевода звонка на Sber-устройства</string>
<key>NSBluetoothPeripheralUsageDescription</key>
<string>Доступ к Bluetooth нужен для перевода звонка на Sber-устройства</string>
<key>NSLocalNetworkUsageDescription</key>
<string>Доступ к локальной сети нужен для поиска Sber-устройств рядом с вами</string>
<key>NSBonjourServices</key>
<array>
  <string>_staros._tcp</string>
</array>
<key>UIBackgroundModes</key>
<array>
  <string>audio</string>
  <string>voip</string>
</array>
```

Тексты — ваши, их видит пользователь в системном диалоге. `UIBackgroundModes`
нужен, чтобы звонок не обрывался при сворачивании приложения.

## Шаг 4. Podfile — обязательная часть

Здесь живут оба обхода. **Не пропускайте**: без них проект либо не соберётся,
либо упадёт при запуске.

### 4.1. Сама зависимость

Внутрь блока `target '<ВашТаргет>' do`:

```ruby
pod 'JazzSDK', :git => 'https://github.com/salute-developers/jazz-ios-sdk.git', :branch => 'main'
```

### 4.2. Два хелпера

Скопируйте из [ios/Podfile](ios/Podfile) две функции целиком, вместе с
комментариями — они объясняют, зачем это нужно, будущему вам:

* `patch_fmt_consteval!` — чинит сборку `fmt` на Xcode 16.3+/26;
* `link_jazz_frameworks_last!` — переносит фреймворки Jazz в конец
  `OTHER_LDFLAGS`, чтобы `facebook::jsi::*` резолвился в `hermes.framework`,
  а не в JazzCore.

Кладите их на верхний уровень Podfile, **до** блока `target`.

### 4.3. Вызовы в post_install

В существующий `post_install`, после `react_native_post_install(...)`:

```ruby
installer.pods_project.targets.each do |t|
  t.build_configurations.each do |bc|
    # JazzSDK требует iOS 15.0+
    current = bc.build_settings['IPHONEOS_DEPLOYMENT_TARGET']
    if current.nil? || current.to_f < 15.1
      bc.build_settings['IPHONEOS_DEPLOYMENT_TARGET'] = '15.1'
    end

    # см. patch_fmt_consteval!
    defs = bc.build_settings['GCC_PREPROCESSOR_DEFINITIONS'] || ['$(inherited)']
    defs = [defs] if defs.is_a?(String)
    unless defs.include?('FMT_USE_CONSTEVAL=0')
      bc.build_settings['GCC_PREPROCESSOR_DEFINITIONS'] = defs + ['FMT_USE_CONSTEVAL=0']
    end
  end
end

# таргет приложения тоже компилирует заголовки Folly, которые тянут fmt
installer.aggregate_targets.each do |aggregate|
  aggregate.user_project.native_targets.each do |t|
    t.build_configurations.each do |bc|
      defs = bc.build_settings['GCC_PREPROCESSOR_DEFINITIONS'] || ['$(inherited)']
      defs = [defs] if defs.is_a?(String)
      unless defs.include?('FMT_USE_CONSTEVAL=0')
        bc.build_settings['GCC_PREPROCESSOR_DEFINITIONS'] = defs + ['FMT_USE_CONSTEVAL=0']
      end
    end
  end
  aggregate.user_project.save
end

patch_fmt_consteval!(installer)
link_jazz_frameworks_last!(installer)
```

Хуки написаны через `installer.aggregate_targets`, а не по имени таргета,
поэтому переносятся без правок.

### 4.4. Установка

```bash
npm run pods
```

Первый запуск скачивает ~900 МБ xcframework'ов — это долго. Дальше всё берётся
из кеша CocoaPods.

В выводе должно появиться:

```
Patched fmt/base.h to honour -DFMT_USE_CONSTEVAL (Xcode 16.3+ fix)
Moved Jazz frameworks to the end of OTHER_LDFLAGS in Pods-<ВашТаргет>.debug.xcconfig
```

Если этих строк нет — хуки не вызвались, вернитесь к 4.3.

## Шаг 5. Четыре строки в AppDelegate

`JazzShadowedClasses.swift` вы уже скопировали на шаге 1. Осталось дать ему
точку входа. В классе `AppDelegate` (наследник `RCTAppDelegate`):

```swift
@objc(getModuleClassFromName:)
func getModuleClass(fromName name: UnsafePointer<CChar>) -> AnyClass? {
  JazzShadowedClasses.moduleClass(forName: name, requestedBy: self)
}
```

Обратите внимание: **без `override`**. `RCTAppDelegate` объявляет этот метод в
class extension, поэтому Swift его не видит; переопределение происходит на
уровне Objective-C runtime по селектору.

Нужно это только на новой архитектуре — там React Native ищет модули по имени
и получает класс из JazzCore. На старой архитектуре метод не вызывается
вообще, но пусть будет: один и тот же код собирается в обеих.

**Если ваш AppDelegate на Objective-C**, понадобится чуть больше работы:
`JazzShadowedClasses` — это Swift `enum`, а enum из Objective-C не виден в
принципе. Превратите его в класс:

```swift
@objc final class JazzShadowedClasses: NSObject {
  @objc static func moduleClass(
    forName name: UnsafePointer<CChar>,
    requestedBy appDelegate: AnyObject
  ) -> AnyClass? {
    // тело без изменений
  }
  // остальные методы тоже переезжают сюда, private-часть можно не помечать @objc
}
```

После этого в `.mm`:

```objc
#import "<ВашТаргет>-Swift.h"

- (Class)getModuleClassFromName:(const char *)name {
  return [JazzShadowedClasses moduleClassForName:name requestedBy:self];
}
```

Проще, впрочем, оставить AppDelegate на Swift — весь остальной код Jazz всё
равно на Swift.

## Шаг 6. Проверка

Соберите и запустите. Затем проверьте по порядку — каждая команда отсекает
свой класс проблем:

**Символы не утекли в JazzCore** (должен быть `0`):

```bash
nm -m -arch arm64 <путь>/YourApp.app/YourApp.debug.dylib | grep -c "(from JazzCore)"
```

В Debug-сборках Xcode 16+ код лежит в `YourApp.debug.dylib`, а `YourApp` —
только тонкий загрузчик. Для Release проверяйте сам `YourApp.app/YourApp`.

Если число больше нуля — не сработал `link_jazz_frameworks_last!`, и
приложение упадёт на старте с SIGSEGV в JS-потоке.

**Фреймворки на месте:**

```bash
ls <путь>/YourApp.app/Frameworks | grep -i jazz
```

Ожидаются `JazzSDK.framework`, `JazzCore.framework`, `LibSberCast.framework`.
`SDSoup`, `JazzScreenShareImpl` и `JazzSDKScreenShare` — статические архивы,
их в `Frameworks` быть и не должно.

**Мост доступен из JS:**

```ts
import {NativeModules} from 'react-native';
console.log(NativeModules.JazzSdk != null); // true
```

**Сквозной вызов.** Инициализируйте SDK с заведомо неверным транспортным
токеном и начните встречу:

```ts
import {useJazzMeeting} from './src/jazz/useJazzMeeting';

const {joinMeeting} = useJazzMeeting({
  getTransportToken: async () => {
    console.log('Jazz запросил токен');
    return 'wrong';
  },
});

joinMeeting('https://salutejazz.ru/<код>?psw=<пароль>');
```

Откроется экран входа Jazz с подставленными кодом и паролем. Введите имя и
нажмите Join: в консоли появится `Jazz запросил токен`, а
обмен токена в хуке упадёт с
`POST /auth/login → 401: {"errorCode":"TOKEN_INVALID",...}`. Это **успех**:
весь путь SDK → мост → JS → API Jazz работает. Дальше нужен настоящий
транспортный токен от вашего бэкенда.

---

## Если проект отличается

**Проект на новой архитектуре.** Ничего дополнительно делать не нужно — шаг 5
как раз для неё. Именно там обход и обязателен.

**Проект на старой архитектуре.** Шаг 5 формально не нужен (RN не ищет модули
по имени), но оставьте его: код собирается в обеих и застрахует вас при
будущем переходе.

**Другой JS-движок (JSC вместо Hermes).** `link_jazz_frameworks_last!`
всё равно нужен, но проверять надо тем же `grep -c "(from JazzCore)"` — при JSC
конфликтовать могут другие символы. Ноль — значит порядок линковки верный.

**AppDelegate не наследует `RCTAppDelegate`** (кастомный bootstrap RN). Шаг 5
не применим как есть: подставьте вызов
`JazzShadowedClasses.moduleClass(forName:requestedBy:)` туда, где ваш код
отдаёт классы TurboModule-менеджеру. На старой архитектуре — просто пропустите.

**Нужна демонстрация экрана.** Потребуется отдельный таргет Broadcast Upload
Extension, App Groups и свой provisioning-профиль. В этом проекте не сделано;
порядок — в [README SDK](https://github.com/salute-developers/jazz-ios-sdk#подключение-функционала-демонстрации-экрана).
Со стороны JS достаточно передать bundleId расширения:

```ts
await Jazz.initialize({..., screenShareExtensionIdentifier: 'com.example.App.Broadcast'});
```

**Нужна только часть API.** `JazzSdkModule.swift` спокойно режется: удалите
лишние `@objc` методы, парные строки `RCT_EXTERN_METHOD` в `JazzSdkModule.m` и
соответствующие функции в `JazzSdk.ts`. Обязателен только `initialize` —
без него `JazzSession.shared` возвращает ошибку авторизации.

**Android.** См. раздел [«Android»](#android) ниже — там свой, гораздо более
короткий порядок.
---

## Android

Android SDK (`com.sdkit.jazz:jazz-public-sdk`) ставится из Maven-репозитория
Jazz. JS-часть общая с iOS: если шаг 2 уже сделан, на Android ничего
копировать в `src/` не нужно — `useJazzMeeting` сам выберет путь для платформы.

**Время:** ~15 минут, плюс первая сборка Gradle (скачивает ~120 AAR, ~50 МБ;
APK со всеми ABI — ~240 МБ).

### A1. Требования

| Требование | Почему |
| --- | --- |
| `minSdkVersion` ≥ 26 | Jazz SDK требует Android 8.0+ |
| `compileSdkVersion` ≥ 34 | так собран SDK |
| Kotlin в app-модуле | мост написан на Kotlin (в шаблоне RN 0.71+ он уже есть) |
| JDK 17+ (на Apple Silicon — arm64) | как и для самого RN 0.77; x86_64-JDK под Rosetta собирает в разы медленнее |

### A2. Репозиторий и зависимость

`android/build.gradle` — в `buildscript.ext` версия SDK и minSdk:

```groovy
minSdkVersion = 26
jazzSdkVersion = "25.07.1.3"
```

и после `apply plugin: "com.facebook.react.rootproject"`:

```groovy
allprojects {
    repositories {
        exclusiveContent {
            forRepository {
                maven {
                    name = "JazzMaven"
                    url = "https://public.repo.dp.s2b.tech/repo/public/repository/jazz-maven/"
                }
            }
            filter {
                includeGroup("com.sdkit.jazz")
                includeGroup("ru.sberdevices.core")
                includeGroup("ru.sberbank.mobile.qr")
                includeGroup("ru.sberbank.sdakit.sbercast")
                includeVersion("com.otaliastudios", "zoomlayout", "1.8.0")
                includeVersion("com.otaliastudios.opengl", "egloo", "0.4.0")
            }
        }
    }
}
```

Сам репозиторий обязателен: артефактов Jazz нет в Maven Central. Фильтр
`exclusiveContent` — защита источников, он работает в обе стороны:

* артефакты Jazz берутся **только** из репозитория Jazz — чужой пакет с тем
  же именем в Maven Central, google или jitpack их не подменит;
* из репозитория Jazz берутся **только** они — там лежат и чужие артефакты
  (например, свой React Native `0.61.5-jitsi` в группе `com.facebook.react`),
  и они не должны подменять ваши зависимости.

Группы перечислены **точно, без масок**: например, `ru.sberdevices.smartapp`
живёт в Maven Central, и маска `ru.sberdevices.*` его бы заблокировала.
`zoomlayout 1.8.0` и `egloo 0.4.0` нужны Jazz, но этих версий нет в Maven
Central (были только в закрытом jcenter) — поэтому закреплены именно версии,
а другие версии этих библиотек по-прежнему придут из Maven Central.

> Если в `gradle.properties` задан корпоративный прокси
> `exclusiveEnterpriseRepository`, плагин RN оставит только его, а этот блок
> всё равно пойдёт на внешний `public.repo.dp.s2b.tech`. Во внутренней сети,
> где внешние адреса закрыты, замените URL на зеркало репозитория Jazz в
> вашем Nexus.

> Если в `settings.gradle` стоит `dependencyResolutionManagement` с
> `RepositoriesMode.FAIL_ON_PROJECT_REPOS`, добавьте этот `maven { … }` туда,
> а не в `allprojects`.

`android/app/build.gradle`, в `dependencies`:

```groovy
implementation("com.sdkit.jazz:jazz-public-sdk:$jazzSdkVersion") {
    exclude(group: "com.sdkit.jazz", module: "hermes")
}
implementation(platform("com.sdkit.jazz:jazz-public-bom:$jazzSdkVersion"))
```

`exclude … hermes` — **обязательная** часть: Jazz тащит свой старый Hermes
(для встроенного в него RN 0.61), который дублирует `hermes-android` из
React Native. Без `exclude` сборка падает на `checkDebugDuplicateClasses`.

### A3. Скопировать нативный мост

```bash
cp -R android/app/src/main/java/com/sberjazz/jazz <ваш-проект>/android/app/src/main/java/<ваш/пакет>/jazz
```

| Файл | Что делает |
| --- | --- |
| `JazzSdkModule.kt` | сам мост: initialize, create / start / join / terminate, события фазы и запроса токена |
| `JazzInstaller.kt` | установка SDK (`JazzConfig.Custom`) + провайдер токена, который спрашивает JS |
| `JazzSdkPackage.kt` | регистрация модуля в RN |

Замените первую строку каждого файла (`package com.sberjazz.jazz`) на свой
пакет, например `package com.myapp.jazz`. Больше правок не нужно.

### A4. MainApplication — две строки

```kotlin
import <ваш.пакет>.jazz.JazzSdkModule
import <ваш.пакет>.jazz.JazzSdkPackage

// в getPackages():
PackageList(this).packages.apply {
  add(JazzSdkPackage())
}

// в onCreate(), после SoLoader.init(...):
JazzSdkModule.install(this)
```

SDK устанавливается при старте процесса, а не из JS, — так требует Jazz:
система может восстановить экран встречи раньше, чем загрузится JS.

**Если вы переопределяли WorkManager** (`Configuration.Provider`) — добавьте
фабрику Jazz в свою `DelegatingWorkerFactory`:
`addFactory(JazzSdk.getIntegrationClientApi().jazzWorkerFactory)`.
Иначе ничего делать не нужно.

### A5. Разрешения

Ничего добавлять в `AndroidManifest.xml` не нужно: камера, микрофон,
foreground service и прочее приходят из манифестов SDK при мерже. Runtime-запрос
разрешений Jazz делает сам на своём экране входа.

### A6. Проверка

```bash
npx react-native run-android
```

Та же проверка, что в шаге 6 для iOS, — `joinMeeting(url)` с заведомо неверным
транспортным токеном. Порядок на Android другой: токен запрашивается
**сразу** по нажатию, ещё до экрана Jazz. В логах появятся
`Jazz запросил токен` и `POST /auth/login → 401 TOKEN_INVALID`, затем
откроется экран входа Jazz «Are you ready to join?».

```bash
adb logcat | grep -E "JazzSdk|ReactNativeJS"
```

`W/JazzSdk: Jazz: токен не получен — …` значит, что ответ JS дошёл до SDK.
Приложение при этом **не падает** — это и проверяем.

> Если в комнате разрешены гости, после Join Android SDK войдёт во встречу
> и без токена — как гость (iOS в той же ситуации не подключается). Для
> встреч «только для сотрудников» создавайте комнаты с выключенными гостями.

### Android: что может пойти не так

| Симптом | Причина | Что делать |
| --- | --- | --- |
| `Could not find com.sdkit.jazz:…` | нет репозитория Jazz | A2; при `FAIL_ON_PROJECT_REPOS` — репозиторий в `settings.gradle` |
| `Manifest merger failed : uses-sdk:minSdkVersion 24 cannot be smaller than version 26` | minSdk проекта ниже 26 | A2: `minSdkVersion = 26` |
| `Duplicate class com.facebook.hermes.BuildConfig found in modules hermes-25.07…` | подтянулся Hermes из Jazz | A2: `exclude(group: "com.sdkit.jazz", module: "hermes")` |
| Gradle тянет `com.facebook.react:react-native:0.61.5-jitsi…` из репозитория Jazz | репозиторий подключён без `exclusiveContent` | A2 |
| `Could not find com.otaliastudios:zoomlayout:1.8.0` / `egloo:0.4.0` | в фильтре нет `includeVersion` для них | A2 |
| `Could not find <группа Jazz>:…` после обновления Jazz | новая версия SDK добавила группу | допишите её в `filter { includeGroup(…) }` (A2) |
| `Could not find com.otaliastudios:zoomlayout:<не 1.8.0>` | вместо `includeVersion` стоит `includeModule` — все версии ищутся только у Jazz | A2: `includeVersion(…, "1.8.0")` |
| `Нативный модуль 'JazzSdk' недоступен` | не добавлен `JazzSdkPackage()` или не пересобрано приложение | A4; перезапуск Metro не поможет |
| `Jazz SDK не инициализирован` | `joinConference` до `initialize` | используйте `useJazzMeeting` — он инициализирует сам |
| Первая сборка Gradle идёт десятки минут | JDK x86_64 под Rosetta на Mac с Apple Silicon | поставьте arm64-JDK 17+; `file $(/usr/libexec/java_home)/bin/java` → `arm64` |
| Без токена Android входит во встречу | в комнате разрешены гости | создавайте комнаты с `isGuestsOn: false` |

---

## Что может пойти не так (iOS)

| Симптом | Причина | Что делать |
| --- | --- | --- |
| `call to consteval function ... is not a constant expression` в `fmt` | не сработал `patch_fmt_consteval!` | шаг 4.2 + 4.3; проверьте строку `Patched fmt/base.h` в выводе `pod install` |
| SIGSEGV на старте, в стеке `jsi::Object::getPropertyAsObject` и JazzCore | фреймворки Jazz линкуются раньше `hermes` | шаг 4.2; проверьте `grep -c "(from JazzCore)"` из шага 6 |
| `TurboModuleRegistry.getEnforcing('ImageLoader'): could not be found` | RN получил класс-дубликат из JazzCore | шаг 5; убедитесь, что `JazzShadowedClasses.swift` в Compile Sources |
| `Нативный модуль 'JazzSdk' недоступен` | файлы не в таргете, или не сделан `pod install`, или не пересобрана нативная часть | шаг 1; пересоберите, перезапуск Metro не поможет |
| `Unicode Normalization not appropriate for ASCII-8BIT` при `pod install` | локаль не UTF-8 | `export LC_ALL=C.UTF-8` |
| `POST /auth/login → 401 TOKEN_INVALID` | транспортный токен неверный, просрочен или подписан не тем ключом | проверьте claims и подпись на бэкенде; с тестовым токеном — это ожидаемо, см. шаг 6 |
| Jazz закрывает экран встречи сразу после Join | `getToken` бросил ошибку или не ответил за 30 с | смотрите ошибку в консоли JS и строку `Jazz: не удалось получить токен` в логе Xcode |
| `ServerTrust evaluation for jazz.sber.ru failed` | старый хост | `hostUrl` по умолчанию теперь `https://salutejazz.ru` — не передавайте `jazz.sber.ru` |
| `objc: Class RCT… is implemented in both …` в консоли | те самые дубликаты RN внутри JazzCore | **не ошибка**, убрать может только Sber, собрав JazzCore без встроенного RN |
| `Connection refused` на порт 8097 | React DevTools не запущен | **не ошибка**, штатное поведение dev-сборки RN |

---

## Чек-лист

iOS:

- [ ] Папка `Jazz/` скопирована и **все три файла добавлены в таргет**
- [ ] `JazzSdk.ts`, `jazzAuth.ts` и `useJazzMeeting.ts` скопированы
- [ ] Ключи разрешений в `Info.plist`
- [ ] `pod 'JazzSDK'` в Podfile
- [ ] `patch_fmt_consteval!` и `link_jazz_frameworks_last!` скопированы и **вызываются** в `post_install`
- [ ] Deployment target ≥ 15.1
- [ ] 4 строки в `AppDelegate`
- [ ] `pod install` напечатал обе строки про patch и Moved
- [ ] `grep -c "(from JazzCore)"` возвращает `0`
- [ ] `NativeModules.JazzSdk != null`
- [ ] С неверным транспортным токеном Join в Jazz приводит к `401 TOKEN_INVALID` от `/auth/login`
- [ ] Бэкенд выдаёт транспортный токен, ключ SDK в приложении не хранится

Android:

- [ ] `minSdkVersion = 26`, репозиторий Jazz через `exclusiveContent` с точным списком групп
- [ ] Зависимость `jazz-public-sdk` **с `exclude … hermes`** + `jazz-public-bom`
- [ ] Папка `jazz/` скопирована, `package` в трёх файлах заменён на ваш
- [ ] `add(JazzSdkPackage())` и `JazzSdkModule.install(this)` в `MainApplication`
- [ ] С неверным транспортным токеном Join в Jazz приводит к `401 TOKEN_INVALID`
