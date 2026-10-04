package com.sberjazz.jazz

import android.app.Application
import android.os.Handler
import android.os.Looper
import android.util.Log
import com.sdkit.jazz.sdk.di.DefaultJazzSdkPlatformDependencies
import com.sdkit.jazz.sdk.di.JazzSdk
import com.sdkit.jazz.sdk.di.installJazzSdk
import com.sdkit.jazz.sdk.domain.dependencies.JazzCoreLoggingDependencies
import com.sdkit.jazz.sdk.domain.dependencies.JazzLoggerFactory
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.TimeoutCancellationException
import kotlinx.coroutines.withTimeout
import ru.sberdevices.vc.platform.api.di.JazzPlatformDependencies
import ru.sberdevices.vc.platform.api.domain.DomainUrlProvider
import ru.sberdevices.vc.platform.api.domain.JazzTokenProvider
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap

/**
 * Установка Jazz SDK с авторизацией по токену доступа.
 *
 * `JazzConfig.Simple` умеет только secretKey (ключ SDK в приложении), поэтому
 * берём `JazzConfig.Custom`: зависимости по умолчанию, но свой провайдер
 * токена (спрашивает JS) и хост из `initialize({hostUrl})`.
 */
internal fun installJazz(application: Application) {
    val dependencies = object : JazzPlatformDependencies by DefaultJazzSdkPlatformDependencies() {
        override val jazzTokenProvider: JazzTokenProvider = RNJazzTokenProvider
        override val domainUrlProvider: DomainUrlProvider = object : DomainUrlProvider {
            override fun getUrl(): String = JazzSdkModule.hostUrl
        }
    }
    application.installJazzSdk(
        jazzConfig = JazzSdk.JazzConfig.Custom(dependencies),
        coreConfig = JazzSdk.CoreConfig(
            context = application,
            loggingDependencies = JazzCoreLoggingDependencies(JazzLoggerFactory.LogMode.LOG_DEBUG_ONLY),
        ),
    )
}

/**
 * Провайдер токена доступа Jazz (ответ `POST /v1/auth/login`).
 *
 * Jazz вызывает `getToken()`, когда ему нужен токен (вход, создание встречи,
 * истёкший токен). Шлём в JS `JazzTokenRequested {requestId}` и ждём
 * `resolveTokenRequest` / `rejectTokenRequest`, не дольше [TIMEOUT_MS].
 * Object, а не поле модуля, — переживает перезагрузку JS.
 */
internal object RNJazzTokenProvider : JazzTokenProvider {
    private const val TIMEOUT_MS = 30_000L
    private val pending = ConcurrentHashMap<String, CompletableDeferred<String>>()
    private val main = Handler(Looper.getMainLooper())

    override suspend fun getToken(): String? {
        val requestId = UUID.randomUUID().toString()
        val deferred = CompletableDeferred<String>()
        pending[requestId] = deferred
        main.post {
            val asked = JazzSdkModule.current?.get()?.requestToken(requestId) ?: false
            if (!asked) {
                complete(requestId, Result.failure(IllegalStateException("JS не подписан на JazzTokenRequested")))
            }
        }
        // Ошибку не бросаем: Jazz не ловит исключения провайдера, и оно роняет
        // приложение. null — штатный «токена нет», JS уже показал ошибку.
        return try {
            withTimeout(TIMEOUT_MS) { deferred.await() }
        } catch (e: TimeoutCancellationException) {
            Log.w("JazzSdk", "Jazz: JS не ответил на запрос токена за ${TIMEOUT_MS / 1000} с")
            null
        } catch (e: CancellationException) {
            throw e
        } catch (e: Throwable) {
            Log.w("JazzSdk", "Jazz: токен не получен — ${e.message}")
            null
        } finally {
            pending.remove(requestId)
        }
    }

    fun complete(requestId: String, result: Result<String>) {
        val deferred = pending.remove(requestId) ?: return
        result.fold(deferred::complete, deferred::completeExceptionally)
    }
}
