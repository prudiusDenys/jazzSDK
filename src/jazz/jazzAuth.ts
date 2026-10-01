/**
 * Получение токена доступа SaluteJazz для `Jazz.initialize`.
 *
 * Схема (https://developers.sber.ru/docs/ru/jazz/api/authorization):
 *
 *   1. Ваш бэкенд выпускает транспортный токен — JWT, подписанный ключом SDK
 *      (claims: iat, exp, jti, sub, sdkProjectId, опционально userName/userEmail).
 *      Ключ SDK хранится только на бэкенде, в приложение он не попадает.
 *   2. Приложение меняет транспортный токен на токен доступа:
 *        POST https://api.salutejazz.ru/v1/auth/login
 *        Authorization: Bearer <транспортный токен>
 *      ответ: { "token": "<токен доступа>" }
 *   3. Токен доступа отдаётся в Jazz SDK (`.jazzToken` на стороне iOS).
 */

export const JAZZ_API_URL = 'https://api.salutejazz.ru/v1';

export class JazzAuthError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
    this.name = 'JazzAuthError';
  }
}

/** Шаг 2: меняет транспортный токен на токен доступа Jazz. */
export async function exchangeTransportToken(
  transportToken: string,
  apiUrl: string = JAZZ_API_URL,
): Promise<string> {
  const response = await fetch(`${apiUrl}/auth/login`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${transportToken}`,
      Accept: 'application/json',
    },
  });

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new JazzAuthError(
      `POST /auth/login → ${response.status}${body ? `: ${body}` : ''}`,
      response.status,
    );
  }

  const json: {token?: unknown} = await response.json();
  if (typeof json.token !== 'string' || json.token.length === 0) {
    throw new JazzAuthError('В ответе /auth/login нет поля "token"');
  }
  return json.token;
}

/**
 * Собирает `getToken` для `Jazz.initialize` из функции, которая достаёт
 * транспортный токен (обычно запрос к вашему бэкенду).
 *
 *   Jazz.initialize({
 *     getToken: createJazzTokenProvider(() => api.getJazzTransportToken()),
 *   });
 */
export function createJazzTokenProvider(
  getTransportToken: () => Promise<string>,
  apiUrl: string = JAZZ_API_URL,
): () => Promise<string> {
  return async () => exchangeTransportToken(await getTransportToken(), apiUrl);
}
