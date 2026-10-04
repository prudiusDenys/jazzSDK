import {
  NativeEventEmitter,
  NativeModules,
  Platform,
  type EmitterSubscription,
  type NativeModule,
} from 'react-native';

/**
 * Typed wrapper around the native `JazzSdk` module, which drives the Sber Jazz SDK:
 *   iOS     — ios/SberJazz/Jazz/JazzSdkModule.swift
 *             (https://github.com/salute-developers/jazz-ios-sdk)
 *   Android — android/app/src/main/java/com/sberjazz/jazz/JazzSdkModule.kt
 *             (https://github.com/salute-developers/jazz-android-sdk)
 */

const LINKING_ERROR =
  "Нативный модуль 'JazzSdk' недоступен.\n\n" +
  '- iOS: выполнен ли `pod install` в папке ios/ ?\n' +
  '- Android: добавлен ли JazzSdkPackage() в MainApplication.getPackages()?\n' +
  '- Пересобрано ли приложение после добавления нативного модуля?';

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
export const isJazzSupported =
  (Platform.OS === 'ios' || Platform.OS === 'android') && NativeJazz != null;

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
  /** iOS: bundleId Broadcast Upload Extension для демонстрации экрана. */
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
  /** Android: имя участника во встрече (iOS берёт его из своего экрана входа). */
  userName?: string;
};

export type JazzStartOptions = JazzConferenceOptions &
  JazzMediaSettings & {
    /** Пропустить промежуточный экран настройки перед входом. */
    skipIntermediateScreen?: boolean;
  };

export type JazzJoinOptions = JazzMediaSettings & {
  /**
   * Android: ссылка-приглашение целиком (https://salutejazz.ru/abc?psw=...).
   * Разбирать её не нужно — Jazz сделает это сам. На iOS не используется:
   * там ссылку разбирает `handleUrl`, а сюда передаются roomId / roomPassword.
   */
  meetingUrl?: string;
  /**
   * Код встречи. Если не передан, на iOS Jazz покажет свой экран ввода кода;
   * на Android нужен либо он, либо `meetingUrl`.
   */
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
  /** `room` присылает только iOS. */
  | {phase: 'activeConference' | 'activeWebinar'; room?: JazzRoom}
  | {phase: 'waitingStream'}
  | {phase: 'activeStream'; streamId: string}
  | {phase: 'unknown'};

// MARK: API

/**
 * Инициализация SDK. Должна выполняться до любого другого вызова —
 * иначе `JazzSession.shared` выдаёт ошибку авторизации.
 */
export async function initialize({
  getToken,
  ...options
}: JazzInitOptions): Promise<boolean> {
  const native = requireNative();
  listenForTokenRequests(native, getToken);
  const ok = await native.initialize(options);
  initializedHostUrl = options.hostUrl ?? DEFAULT_HOST_URL;
  return ok;
}

export const DEFAULT_HOST_URL = 'https://salutejazz.ru';

/** Хост последнего успешного initialize в этом JS-контексте. */
let initializedHostUrl: string | undefined;

/**
 * С каким хостом SDK инициализирован из текущего JS-контекста
 * (`undefined` — ещё не инициализирован, в том числе после перезагрузки JS).
 */
export function currentHostUrl(): string | undefined {
  return initializedHostUrl;
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

/**
 * Создаёт конференцию, резолвится ссылкой на встречу. iOS показывает свой
 * экран создания, Android создаёт встречу без UI.
 */
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

/**
 * Присоединяется к конференции (по коду встречи или через экран Jazz).
 * Android: `false` — пользователь сам закрыл экран входа Jazz (не ошибка).
 */
export function joinConference(
  options: JazzJoinOptions = {},
): Promise<boolean> {
  return requireNative().joinConference(options);
}

/** Завершает активную конференцию. */
export function terminateActiveConference(): Promise<boolean> {
  return requireNative().terminateActiveConference();
}

/**
 * Разбирает app-link / deep-link Jazz и сообщает, куда он ведёт.
 * Только iOS: на Android передайте ссылку в `joinConference({meetingUrl})`.
 */
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
  currentHostUrl,
  createConference,
  startConference,
  joinConference,
  terminateActiveConference,
  handleUrl,
  addConferencePhaseListener,
};
