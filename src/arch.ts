/**
 * Какая архитектура React Native сейчас активна.
 *
 * Проект собирается под **обе**: `RCT_NEW_ARCH_ENABLED` выбирается на этапе
 * `pod install` (см. ios/Podfile и npm-скрипты `pods` / `pods:newarch`).
 * По умолчанию — старая архитектура: Paper + классический мост, без
 * TurboModules и Fabric.
 *
 * Нативный модуль `JazzSdk` — обычный bridge-модуль
 * (`RCT_EXTERN_MODULE`), поэтому он одинаково доступен через
 * `NativeModules` в обеих архитектурах: напрямую в старой и через
 * interop-слой в новой.
 */

type ReactNativeGlobals = {
  /** Выставляется рантаймом при bridgeless-режиме новой архитектуры. */
  RN$Bridgeless?: boolean;
  /** Прокси TurboModule-реестра — есть только в новой архитектуре. */
  __turboModuleProxy?: unknown;
  /** UIManager Fabric — есть только при включённом Fabric. */
  nativeFabricUIManager?: unknown;
};

const rnGlobal = globalThis as unknown as ReactNativeGlobals;

/** Fabric-рендерер (новая архитектура). */
export const isFabricEnabled = rnGlobal.nativeFabricUIManager != null;

/** TurboModules (новая архитектура). */
export const isTurboModulesEnabled = rnGlobal.__turboModuleProxy != null;

/** Bridgeless-режим (новая архитектура, RN 0.74+). */
export const isBridgeless = rnGlobal.RN$Bridgeless === true;

export type ReactNativeArchitecture = 'old' | 'new';

export const reactNativeArchitecture: ReactNativeArchitecture =
  isFabricEnabled || isTurboModulesEnabled || isBridgeless ? 'new' : 'old';

/** Короткая подпись для UI. */
export const architectureLabel =
  reactNativeArchitecture === 'new'
    ? 'новая архитектура (Fabric + TurboModules)'
    : 'старая архитектура (Paper + bridge)';
