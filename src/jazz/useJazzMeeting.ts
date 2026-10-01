import {useCallback, useRef, useState} from 'react';
import {Alert} from 'react-native';

import Jazz, {isJazzSupported, type JazzRoom} from './JazzSdk';
import {exchangeTransportToken} from './jazzAuth';

export type JazzMeetingErrorStage =
  /** Не удалось инициализировать SDK, разобрать ссылку или открыть встречу. */
  | 'join'
  /** Не удалось получить токен (Jazz запросил его, например, по Start). */
  | 'token';

export type UseJazzMeetingOptions = {
  /**
   * Транспортный JWT от вашего бэкенда (подписан ключом SDK). Хук сам
   * обменяет его на токен доступа через `POST /v1/auth/login`.
   */
  getTransportToken: () => Promise<string>;
  /** Хост Jazz. По умолчанию https://salutejazz.ru */
  hostUrl?: string;
  /** Обработка ошибок. По умолчанию — Alert с текстом ошибки. */
  onError?: (error: Error, stage: JazzMeetingErrorStage) => void;
};

export type UseJazzMeetingResult = {
  /**
   * Присоединяется к встрече по ссылке вида https://salutejazz.ru/abc?psw=...
   * При первом вызове инициализирует SDK. Экран входа и саму встречу
   * показывает Jazz.
   */
  joinMeeting: (meetingUrl: string) => Promise<void>;
  /** true, пока идёт инициализация / открытие встречи. */
  busy: boolean;
  /** false на Android и когда нативный модуль не слинкован. */
  isSupported: boolean;
};

const ALERT_TITLES: Record<JazzMeetingErrorStage, string> = {
  join: 'Не удалось подключиться к встрече',
  token: 'Не удалось получить токен Jazz',
};

function defaultOnError(error: Error, stage: JazzMeetingErrorStage) {
  Alert.alert(ALERT_TITLES[stage], error.message);
}

function toError(e: unknown): Error {
  return e instanceof Error ? e : new Error(String(e));
}

/** Достаёт из ссылки-приглашения комнату, к которой можно присоединиться. */
async function roomFromLink(meetingUrl: string): Promise<JazzRoom> {
  const target = await Jazz.handleUrl(meetingUrl.trim(), 'applink');
  if (
    target.target === 'joinConferenceRoom' ||
    target.target === 'joinWebinar'
  ) {
    return target.room;
  }
  throw new Error(
    `Ссылка не ведёт на встречу (${target.target}): ${meetingUrl}`,
  );
}

/**
 * Кнопка «Online Встреча»: присоединение к уже созданной встрече по ссылке.
 *
 *   const {joinMeeting, busy} = useJazzMeeting({
 *     getTransportToken: () => api.getJazzTransportToken(),
 *   });
 *   <Button title="Online Встреча" onPress={() => joinMeeting(url)} disabled={busy} />
 *
 * Весь UI после нажатия рисует Jazz SDK.
 */
export function useJazzMeeting(
  options: UseJazzMeetingOptions,
): UseJazzMeetingResult {
  // Jazz может запросить токен намного позже открытия экрана — читаем
  // актуальные опции через ref, чтобы не пересоздавать колбэки.
  const optionsRef = useRef(options);
  optionsRef.current = options;

  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);

  const reportError = useCallback(
    (e: unknown, stage: JazzMeetingErrorStage) => {
      const onError = optionsRef.current.onError ?? defaultOnError;
      onError(toError(e), stage);
    },
    [],
  );

  const getToken = useCallback(async () => {
    try {
      const transportToken = await optionsRef.current.getTransportToken();
      return await exchangeTransportToken(transportToken);
    } catch (e) {
      reportError(e, 'token');
      throw e;
    }
  }, [reportError]);

  const joinMeeting = useCallback(
    async (meetingUrl: string) => {
      // Защита от двойного нажатия, пока Jazz открывает экран.
      if (busyRef.current) {
        return;
      }
      busyRef.current = true;
      setBusy(true);
      try {
        if (!(await Jazz.isInitialized())) {
          await Jazz.initialize({
            getToken,
            hostUrl: optionsRef.current.hostUrl,
          });
        }
        const room = await roomFromLink(meetingUrl);
        await Jazz.joinConference({
          roomId: room.id,
          roomPassword: room.password,
          roomHost: room.host ?? undefined,
        });
      } catch (e) {
        reportError(e, 'join');
      } finally {
        busyRef.current = false;
        setBusy(false);
      }
    },
    [getToken, reportError],
  );

  return {joinMeeting, busy, isSupported: isJazzSupported};
}
