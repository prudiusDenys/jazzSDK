# Перенос интеграции Jazz SDK в другой проект

Инструкция «что скопировать и куда вставить», чтобы поднять Jazz iOS SDK
в другом React Native приложении.

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
| JS-обёртка | `src/jazz/JazzSdk.ts` | копированием как есть |
| Обходы багов окружения | `ios/Podfile`, `ios/SberJazz/Jazz/JazzShadowedClasses.swift`, 4 строки в `AppDelegate` | вставками в существующие файлы |

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
| Локаль в UTF-8 | иначе CocoaPods падает с `Unicode Normalization not appropriate for ASCII-8BIT` |

```bash
export LANG=en_US.UTF-8
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
| `JazzSdkModule.swift` | сам мост: `Jazz.initialize`, create / start / join / terminate, разбор ссылок, события фазы конференции |
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
cp src/jazz/JazzSdk.ts <ваш-проект>/src/jazz/JazzSdk.ts
```

Это единственный файл, который нужен приложению. Он ни от чего не зависит,
кроме `react-native`, и кладётся в любое удобное место.

`src/arch.ts` и `App.tsx` копировать не нужно — первый показывает активную
архитектуру (диагностика), второй демонстрирует API. `App.tsx` удобно держать
рядом как справочник по вызовам.

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
cd ios && LANG=en_US.UTF-8 pod install
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

**Сквозной вызов.** Вызовите `initialize` с заведомо неверным ключом:

```ts
import Jazz from './src/jazz/JazzSdk';

await Jazz.initialize({sdkSecret: 'wrong', userId: '123'});
```

Ожидаемый результат — reject с `E_JAZZ_INIT_FAILED` и текстом про неверный
ключ. Это **успех**: ошибка пришла из самого JazzSDK, значит весь путь
JS → мост → SDK работает. Дальше нужен настоящий ключ из
[кабинета разработчика Sber](https://developers.sber.ru/docs/ru/jazz/sdk/overview).

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

**Android.** Jazz iOS SDK — только для iOS. `Jazz.isJazzSupported` вернёт
`false`, вызовы бросят понятную ошибку линковки. Для Android нужен отдельный
Android SDK от Sber.

---

## Что может пойти не так

| Симптом | Причина | Что делать |
| --- | --- | --- |
| `call to consteval function ... is not a constant expression` в `fmt` | не сработал `patch_fmt_consteval!` | шаг 4.2 + 4.3; проверьте строку `Patched fmt/base.h` в выводе `pod install` |
| SIGSEGV на старте, в стеке `jsi::Object::getPropertyAsObject` и JazzCore | фреймворки Jazz линкуются раньше `hermes` | шаг 4.2; проверьте `grep -c "(from JazzCore)"` из шага 6 |
| `TurboModuleRegistry.getEnforcing('ImageLoader'): could not be found` | RN получил класс-дубликат из JazzCore | шаг 5; убедитесь, что `JazzShadowedClasses.swift` в Compile Sources |
| `Нативный модуль 'JazzSdk' недоступен` | файлы не в таргете, или не сделан `pod install`, или не пересобрана нативная часть | шаг 1; пересоберите, перезапуск Metro не поможет |
| `Unicode Normalization not appropriate for ASCII-8BIT` при `pod install` | локаль не UTF-8 | `export LANG=en_US.UTF-8` |
| `E_JAZZ_INIT_FAILED` / «Неверный секретный ключ SDK» | нет валидного ключа | это ожидаемо, см. шаг 6 |
| `objc: Class RCT… is implemented in both …` в консоли | те самые дубликаты RN внутри JazzCore | **не ошибка**, убрать может только Sber, собрав JazzCore без встроенного RN |
| `Connection refused` на порт 8097 | React DevTools не запущен | **не ошибка**, штатное поведение dev-сборки RN |

---

## Чек-лист

- [ ] Папка `Jazz/` скопирована и **все три файла добавлены в таргет**
- [ ] `JazzSdk.ts` скопирован
- [ ] Ключи разрешений в `Info.plist`
- [ ] `pod 'JazzSDK'` в Podfile
- [ ] `patch_fmt_consteval!` и `link_jazz_frameworks_last!` скопированы и **вызываются** в `post_install`
- [ ] Deployment target ≥ 15.1
- [ ] 4 строки в `AppDelegate`
- [ ] `pod install` напечатал обе строки про patch и Moved
- [ ] `grep -c "(from JazzCore)"` возвращает `0`
- [ ] `NativeModules.JazzSdk != null`
- [ ] `initialize` с неверным ключом возвращает ошибку из SDK
