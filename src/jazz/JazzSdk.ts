import {
  NativeEventEmitter,
  NativeModules,
  Platform,
  type EmitterSubscription,
  type NativeModule,
} from 'react-native';

/**
 * Typed wrapper around the native `JazzSdk` module
 * (ios/SberJazz/Jazz/JazzSdkModule.swift), which drives the Sber Jazz iOS SDK:
 * https://github.com/salute-developers/jazz-ios-sdk
 */

const LINKING_ERROR =
  "Нативный модуль 'JazzSdk' недоступен.\n\n" +
  '- Выполнен ли `pod install` в папке ios/ ?\n' +
  '- Пересобрано ли приложение после добавления нативного модуля?\n' +
  '- Jazz SDK подключён только для iOS.';

type NativeJazzSdk = {
  initialize(options: JazzInitOptions): Promise<boolean>;
  isInitialized(): Promise<boolean>;
  createConference(options: JazzConferenceOptions): Promise<string | null>;
  startConference(options: JazzStartOptions): Promise<boolean>;
  joinConference(options: JazzJoinOptions): Promise<boolean>;
  terminateActiveConference(): Promise<boolean>;
  handleUrl(url: string, type: JazzLinkType): Promise<JazzLinkTarget>;
};

const NativeJazz: NativeJazzSdk | undefined = NativeModules.JazzSdk;

/** True when the native Jazz module is linked into the running binary. */
export const isJazzSupported = Platform.OS === 'ios' && NativeJazz != null;

function requireNative(): NativeJazzSdk {
  if (!NativeJazz) {
    throw new Error(LINKING_ERROR);
  }
  return NativeJazz;
}

// MARK: types

export type JazzLinkType = 'applink' | 'deeplink';

export type JazzRoom = {
  id: string;
  password: string;
  host?: string | null;
};

export type JazzInitOptions = {
  /** Секретный ключ SDK, выданный при регистрации приложения в Jazz. */
  sdkSecret: string;
  /** Хост Jazz. По умолчанию https://jazz.sber.ru */
  hostUrl?: string;
  /** Идентификатор пользователя на вашей стороне. Обязателен. */
  userId: string;
  userName?: string;
  userEmail?: string;
  /** Издатель токена, обычно имя приложения. */
  issuer?: string;
  /** Время жизни токена в секундах (по умолчанию 120). */
  timeToLive?: number;
  /** bundleId Broadcast Upload Extension для демонстрации экрана. */
  screenShareExtensionIdentifier?: string;
};

export type JazzConferenceOptions = {
  title?: string;
  /** Тип конференции, например "meeting". */
  type?: string;
  isGuestsOn?: boolean;
  isLobbyOn?: boolean;
  isAutoRecordEnabled?: boolean;
};

export type JazzMediaSettings = {
  isCameraOn?: boolean;
  isMicrophoneOn?: boolean;
  /** 'receiver' — тихий динамик, 'speaker' — громкая связь. */
  preferredSpeaker?: 'receiver' | 'speaker';
  analyticsConferenceType?: string;
};

export type JazzStartOptions = JazzConferenceOptions &
  JazzMediaSettings & {
    /** Пропустить промежуточный экран настройки перед входом. */
    skipIntermediateScreen?: boolean;
  };

export type JazzJoinOptions = JazzMediaSettings & {
  /** Код встречи. Если не передан, Jazz покажет свой экран ввода кода. */
  roomId?: string;
  roomPassword?: string;
  roomHost?: string;
  skipIntermediateScreen?: boolean;
};

export type JazzLinkTarget =
  | {target: 'joinConferenceRoom'; room: JazzRoom}
  | {target: 'joinWebinar'; room: JazzRoom; userRole: string}
  | {target: 'joinStream'; streamId: string}
  | {target: 'openMeetingInfo'; meetingId: string; domain: string}
  | {target: 'unknown'};

export type JazzConferencePhaseEvent =
  | {phase: 'inactive' | 'connecting' | 'conferenceLobby' | 'webinarLobby'}
  | {phase: 'activeConference' | 'activeWebinar'; room: JazzRoom}
  | {phase: 'waitingStream'}
  | {phase: 'activeStream'; streamId: string}
  | {phase: 'unknown'};

// MARK: API

/**
 * Инициализация SDK. Должна выполняться до любого другого вызова —
 * иначе `JazzSession.shared` выдаёт ошибку авторизации.
 */
export function initialize(options: JazzInitOptions): Promise<boolean> {
  return requireNative().initialize(options);
}

export function isInitialized(): Promise<boolean> {
  return requireNative().isInitialized();
}

/** Открывает экран создания конференции, резолвится ссылкой на встречу. */
export function createConference(
  options: JazzConferenceOptions = {},
): Promise<string | null> {
  return requireNative().createConference(options);
}

/** Создаёт конференцию и сразу присоединяется к ней. */
export function startConference(
  options: JazzStartOptions = {},
): Promise<boolean> {
  return requireNative().startConference(options);
}

/** Присоединяется к конференции (по коду встречи или через экран Jazz). */
export function joinConference(
  options: JazzJoinOptions = {},
): Promise<boolean> {
  return requireNative().joinConference(options);
}

/** Завершает активную конференцию. */
export function terminateActiveConference(): Promise<boolean> {
  return requireNative().terminateActiveConference();
}

/** Разбирает app-link / deep-link Jazz и сообщает, куда он ведёт. */
export function handleUrl(
  url: string,
  type: JazzLinkType = 'applink',
): Promise<JazzLinkTarget> {
  return requireNative().handleUrl(url, type);
}

/**
 * Подписка на изменения фазы конференции
 * (`JazzSession.shared.jazzConferencePhase`).
 */
export function addConferencePhaseListener(
  listener: (event: JazzConferencePhaseEvent) => void,
): EmitterSubscription | undefined {
  if (!NativeJazz) {
    return undefined;
  }
  const emitter = new NativeEventEmitter(NativeJazz as unknown as NativeModule);
  return emitter.addListener('JazzConferencePhaseChanged', listener);
}

export default {
  isJazzSupported,
  initialize,
  isInitialized,
  createConference,
  startConference,
  joinConference,
  terminateActiveConference,
  handleUrl,
  addConferencePhaseListener,
};
