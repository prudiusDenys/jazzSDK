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
  initialize(options: Omit<JazzInitOptions, 'getToken'>): Promise<boolean>;
  resolveTokenRequest(requestId: string, token: string): void;
  rejectTokenRequest(requestId: string, message: string): void;
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
  /**
   * Возвращает токен доступа Jazz — ответ `POST /v1/auth/login`
   * (см. `exchangeTransportToken` / `createJazzTokenProvider` в jazzAuth.ts).
   * SDK вызывает её сам, когда ему нужен токен, в том числе повторно,
   * когда старый истёк, — поэтому это функция, а не строка.
   */
  getToken: () => Promise<string>;
  /** Хост Jazz. По умолчанию https://salutejazz.ru */
  hostUrl?: string;
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
export function initialize({
  getToken,
  ...options
}: JazzInitOptions): Promise<boolean> {
  const native = requireNative();
  listenForTokenRequests(native, getToken);
  return native.initialize(options);
}

let tokenSubscription: EmitterSubscription | undefined;

/**
 * Нативный провайдер шлёт `JazzTokenRequested { requestId }`, когда Jazz
 * нужен токен; отвечаем через resolveTokenRequest / rejectTokenRequest.
 * Подписка одна на приложение: повторный initialize меняет только getToken.
 */
function listenForTokenRequests(
  native: NativeJazzSdk,
  getToken: () => Promise<string>,
) {
  tokenSubscription?.remove();
  tokenSubscription = emitter(native).addListener(
    'JazzTokenRequested',
    async ({requestId}: {requestId: string}) => {
      try {
        native.resolveTokenRequest(requestId, await getToken());
      } catch (e) {
        native.rejectTokenRequest(
          requestId,
          e instanceof Error ? e.message : String(e),
        );
      }
    },
  );
}

function emitter(native: NativeJazzSdk): NativeEventEmitter {
  return new NativeEventEmitter(native as unknown as NativeModule);
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
  return emitter(NativeJazz).addListener(
    'JazzConferencePhaseChanged',
    listener,
  );
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
