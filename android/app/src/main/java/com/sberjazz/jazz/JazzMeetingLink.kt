package com.sberjazz.jazz

import android.net.Uri
import android.util.Base64

/**
 * Ссылка-приглашение Jazz: `https://<хост>/<код встречи>?psw=<пароль>`.
 *
 * Нужна для встреч не на основном хосте (например, корпоративный
 * `jazz.sberbank.ru`): ссылку на такой хост Android SDK ведёт по своей
 * корпоративной ветке и гостю без токена сотрудника сразу отказывает
 * («Only authorized Sber employees…»), даже не спрашивая сервер. iOS SDK так
 * не делает — он входит по коду комнаты на хост из ссылки (`roomHost`). Здесь
 * то же самое: разбираем ссылку и входим по коду и паролю на её хост.
 */
internal data class JazzMeetingLink(
    /** `https://jazz.sberbank.ru` — без пути и `/` в конце. */
    val host: String,
    val roomId: String,
    /** Раскодированный пароль: в ссылке он закодирован, см. [decodePassword]. */
    val password: String,
) {
    companion object {
        fun parse(url: String): JazzMeetingLink? {
            val uri = Uri.parse(url.trim())
            val scheme = uri.scheme ?: return null
            val authority = uri.encodedAuthority ?: return null
            val roomId = uri.pathSegments.firstOrNull()?.takeIf { it.isNotBlank() } ?: return null
            val psw = uri.getQueryParameter("psw").orEmpty()
            return JazzMeetingLink(
                host = "$scheme://$authority",
                roomId = roomId,
                password = decodePassword(psw) ?: psw,
            )
        }

        private const val PASSWORD_KEY = "sberdevices-prefix"

        /**
         * Пароль из `psw` — так же, как его раскодирует Jazz SDK (PasswordHelper):
         * base64url, первый байт — длина пароля цифрой, дальше символы пароля,
         * сложенные XOR с [PASSWORD_KEY] (за его пределами — с `-`).
         * null — `psw` не в этом формате (например, пароль открытым текстом).
         */
        internal fun decodePassword(psw: String): String? {
            if (psw.isEmpty()) return null
            val bytes = try {
                Base64.decode(psw, Base64.URL_SAFE or Base64.NO_WRAP or Base64.NO_PADDING)
            } catch (e: IllegalArgumentException) {
                return null
            }
            if (bytes.isEmpty()) return null
            val length = (bytes[0].toInt().toChar()).digitToIntOrNull() ?: return null
            if (bytes.size - 1 < length) return null
            return buildString {
                for (i in 0 until length) {
                    val key = PASSWORD_KEY.getOrElse(i) { '-' }.code
                    append((bytes[i + 1].toInt() xor key).toChar())
                }
            }
        }
    }
}
