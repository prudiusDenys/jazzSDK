package com.sberjazz.jazz

import android.app.Application
import android.util.Log
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.ReadableMap
import com.facebook.react.bridge.UiThreadUtil
import com.facebook.react.bridge.WritableMap
import com.facebook.react.modules.core.DeviceEventManagerModule
import com.sdkit.jazz.client.integration.api.domain.JazzIntegrationClient
import com.sdkit.jazz.client.integration.api.model.AudioDevice
import com.sdkit.jazz.client.integration.api.model.ConferenceConnectionArguments
import com.sdkit.jazz.client.integration.api.model.ConferenceResult
import com.sdkit.jazz.client.integration.api.model.CreateVideoCallArguments
import com.sdkit.jazz.client.integration.api.model.JoinVideoCallArguments
import com.sdkit.jazz.client.integration.api.model.RoomLifecycle
import com.sdkit.jazz.sdk.di.JazzSdk
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch
import java.lang.ref.WeakReference

/**
 * React Native-обёртка над Sber Jazz Android SDK
 * (https://github.com/salute-developers/jazz-android-sdk).
 *
 * JS-интерфейс тот же, что у iOS-модуля (ios/SberJazz/Jazz/JazzSdkModule.swift),
 * типы — в src/jazz/JazzSdk.ts. Обычный bridge-модуль: в старой архитектуре
 * работает напрямую, в новой — через interop-слой.
 *
 * SDK устанавливается один раз в `MainApplication.onCreate` через [install]
 * (так требует Jazz). `initialize` из JS только задаёт хост и подключает
 * провайдер токена: токен запрашивается у JS событием `JazzTokenRequested`,
 * JS отвечает через `resolveTokenRequest` / `rejectTokenRequest`.
 *
 * Состояние «инициализирован» — у экземпляра модуля, как и на iOS: после
 * перезагрузки JS модуль создаётся заново, и JS снова вызывает `initialize`,
 * а с ним — подписывается на запросы токена.
 */
class JazzSdkModule(reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)

    /** JS подписан на `JazzTokenRequested` — выставляется в `initialize`. */
    @Volatile
    private var initialized = false

    /** Сборщик roomLifecycle; трогается только на main-потоке. */
    private var phaseJob: Job? = null

    init {
        current = WeakReference(this)
    }

    override fun getName(): String = NAME

    override fun invalidate() {
        scope.cancel()
        super.invalidate()
    }

    private val client: JazzIntegrationClient
        get() = JazzSdk.getIntegrationClientApi().jazzIntegrationClient

    // MARK: события

    /**
     * Нужен NativeEventEmitter. По имени события видно, что JS подписался на
     * фазу конференции, — тогда и начинаем собирать roomLifecycle. Счётчик
     * подписчиков не ведём: removeListeners не говорит, от какого события
     * отписались, а событие без подписчиков RN просто отбрасывает.
     */
    @ReactMethod
    fun addListener(eventName: String) {
        if (eventName == PHASE_EVENT) scope.launch { observeConferencePhase() }
    }

    @ReactMethod
    fun removeListeners(@Suppress("UNUSED_PARAMETER") count: Double) = Unit

    private fun emit(event: String, body: WritableMap): Boolean {
        val context = reactApplicationContext
        if (!context.hasActiveReactInstance()) return false
        context.getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
            .emit(event, body)
        return true
    }

    /** Вызывается на main-потоке; повторный вызов ничего не делает. */
    private fun observeConferencePhase() {
        if (phaseJob != null || installError != null || !installed) return
        phaseJob = scope.launch {
            client.roomLifecycle.collect { lifecycle ->
                emit(PHASE_EVENT, Arguments.createMap().apply { putString("phase", lifecycle.toPhase()) })
            }
        }
    }

    // MARK: токен

    /** Просит JS выдать токен. false — некому ответить (JS не вызвал initialize). */
    internal fun requestToken(requestId: String): Boolean {
        if (!initialized) return false
        return emit(TOKEN_REQUESTED_EVENT, Arguments.createMap().apply { putString("requestId", requestId) })
    }

    @ReactMethod
    fun resolveTokenRequest(requestId: String, token: String) {
        RNJazzTokenProvider.complete(
            requestId,
            if (token.isEmpty()) Result.failure(IllegalArgumentException("Пустой токен")) else Result.success(token),
        )
    }

    @ReactMethod
    fun rejectTokenRequest(requestId: String, message: String) {
        Log.w(TAG, "Jazz: не удалось получить токен — $message")
        RNJazzTokenProvider.complete(requestId, Result.failure(IllegalStateException(message)))
    }

    // MARK: API

    /**
     * Можно вызывать повторно (например, с другим `hostUrl`): SDK ставится
     * один раз, хост читается Jazz при каждом запросе.
     */
    @ReactMethod
    fun initialize(options: ReadableMap, promise: Promise) {
        val host = options.string("hostUrl")?.trimEnd('/') ?: DEFAULT_HOST_URL
        // install — на main-потоке, как в Application.onCreate: @ReactMethod
        // приходят на поток нативных модулей, а инициализация Jazz трогает
        // lifecycle-API, которым нужен main.
        UiThreadUtil.runOnUiThread {
            // Если MainApplication не вызвал install — ставим SDK сейчас.
            install(reactApplicationContext.applicationContext as Application)
            val error = installError
            if (error != null) {
                promise.reject("E_JAZZ_INIT", "Не удалось инициализировать Jazz SDK: ${error.message}", error)
                return@runOnUiThread
            }
            hostUrl = host
            initialized = true
            promise.resolve(true)
        }
    }

    @ReactMethod
    fun isInitialized(promise: Promise) {
        promise.resolve(initialized)
    }

    /** Создаёт встречу без входа в неё и возвращает ссылку на неё. */
    @ReactMethod
    fun createConference(options: ReadableMap, promise: Promise) {
        runConference(promise, "E_JAZZ_CREATE") {
            when (val result = client.scheduleConference(createArguments(options))) {
                is ConferenceResult.Success.Scheduled -> promise.resolve(result.conference.url)
                is ConferenceResult.Error -> promise.reject("E_JAZZ_CREATE", result.describe())
                else -> promise.resolve(null)
            }
        }
    }

    /** Создаёт встречу и сразу входит в неё — весь UI рисует Jazz. */
    @ReactMethod
    fun startConference(options: ReadableMap, promise: Promise) {
        runConference(promise, "E_JAZZ_START") {
            resolveConference(client.createConference(createArguments(options)), promise, "E_JAZZ_START")
        }
    }

    /**
     * Вход во встречу: по ссылке-приглашению (`meetingUrl`) или по коду и
     * паролю (`roomId` / `roomPassword`). Экран входа и встречу рисует Jazz.
     */
    @ReactMethod
    fun joinConference(options: ReadableMap, promise: Promise) {
        val connection = options.string("meetingUrl")?.let { ConferenceConnectionArguments.Url(it) }
            ?: options.string("roomId")?.let {
                ConferenceConnectionArguments.RoomCode(roomCode = it, password = options.string("roomPassword") ?: "")
            }
        if (connection == null) {
            promise.reject("E_JAZZ_JOIN", "На Android нужен meetingUrl или roomId")
            return
        }
        runConference(promise, "E_JAZZ_JOIN") {
            val arguments = JoinVideoCallArguments(
                userName = options.string("userName") ?: "",
                conferenceConnectionArguments = connection,
                micEnabled = options.bool("isMicrophoneOn") ?: false,
                cameraEnabled = options.bool("isCameraOn") ?: false,
                audioDevice = options.audioDevice(),
            )
            resolveConference(client.joinConference(arguments), promise, "E_JAZZ_JOIN")
        }
    }

    @ReactMethod
    fun terminateActiveConference(promise: Promise) {
        runConference(promise, "E_JAZZ_TERMINATE") {
            client.closeConference()
            promise.resolve(true)
        }
    }

    /**
     * Разбор ссылок есть только в iOS SDK. На Android ссылку не нужно
     * разбирать — передайте её целиком: `joinConference({meetingUrl})`.
     */
    @ReactMethod
    fun handleUrl(@Suppress("UNUSED_PARAMETER") url: String, @Suppress("UNUSED_PARAMETER") type: String, promise: Promise) {
        promise.reject(
            "E_JAZZ_UNSUPPORTED",
            "handleUrl на Android не поддерживается — используйте joinConference({meetingUrl})",
        )
    }

    // MARK: helpers

    private fun runConference(promise: Promise, code: String, block: suspend () -> Unit) {
        if (!initialized) {
            promise.reject(code, "Jazz SDK не инициализирован — сначала вызовите initialize()")
            return
        }
        scope.launch {
            try {
                block()
            } catch (e: CancellationException) {
                throw e // модуль уничтожен (перезагрузка JS) — отвечать некому
            } catch (e: Throwable) {
                promise.reject(code, e.message ?: e.toString(), e)
            }
        }
    }

    /**
     * true — пользователь во встрече, false — сам закрыл экран Jazz
     * (это не ошибка), reject — встреча не открылась.
     */
    private fun resolveConference(result: ConferenceResult, promise: Promise, code: String) {
        when {
            result.isLeftByUser() -> promise.resolve(false)
            result is ConferenceResult.Error -> promise.reject(code, result.describe())
            else -> promise.resolve(true)
        }
    }

    private fun createArguments(options: ReadableMap) = CreateVideoCallArguments(
        roomType = options.string("type")?.uppercase() ?: "MEETING",
        roomName = options.string("title") ?: "Видеовстреча",
        userName = options.string("userName") ?: "",
        cameraEnabled = options.bool("isCameraOn") ?: false,
        micEnabled = options.bool("isMicrophoneOn") ?: false,
        withGuests = options.bool("isGuestsOn") ?: false,
        lobbyEnabled = options.bool("isLobbyOn") ?: false,
        autoRecord = options.bool("isAutoRecordEnabled"),
        summarizationEnabled = null,
        audioDevice = options.audioDevice(),
        isRoom3dEnabled = false,
        sipEnabled = false,
    )

    companion object {
        const val NAME = "JazzSdk"
        private const val TAG = "JazzSdk"
        private const val PHASE_EVENT = "JazzConferencePhaseChanged"
        private const val TOKEN_REQUESTED_EVENT = "JazzTokenRequested"
        const val DEFAULT_HOST_URL = "https://salutejazz.ru"

        /** Модуль текущего JS-контекста: провайдер токена переживает перезагрузку JS. */
        @Volatile
        internal var current: WeakReference<JazzSdkModule>? = null

        /** Хост Jazz; читается SDK при каждом запросе. */
        @Volatile
        internal var hostUrl: String = DEFAULT_HOST_URL

        @Volatile
        private var installed = false

        /** Почему не удалось поставить SDK; `initialize` вернёт эту ошибку. */
        @Volatile
        private var installError: Throwable? = null

        /**
         * Устанавливает Jazz SDK. Вызывается один раз в `Application.onCreate`
         * на main-потоке (повторные вызовы игнорируются). Ошибка установки не
         * роняет приложение: встречи будут недоступны, `initialize` её вернёт.
         */
        @JvmStatic
        @Synchronized
        fun install(application: Application) {
            if (installed || installError != null) return
            try {
                installJazz(application)
                installed = true
            } catch (e: Throwable) {
                installError = e
                Log.e(TAG, "Jazz: не удалось установить SDK", e)
            }
        }
    }
}

private fun ReadableMap.string(key: String): String? =
    if (hasKey(key) && !isNull(key)) getString(key)?.takeIf { it.isNotBlank() } else null

private fun ReadableMap.bool(key: String): Boolean? =
    if (hasKey(key) && !isNull(key)) getBoolean(key) else null

private fun ReadableMap.audioDevice(): AudioDevice = when (string("preferredSpeaker")) {
    "speaker" -> AudioDevice.SPEAKER
    "receiver" -> AudioDevice.EARPIECE
    else -> AudioDevice.DEFAULT
}

private fun RoomLifecycle.toPhase(): String = when (this) {
    RoomLifecycle.IDLE, RoomLifecycle.TERMINATED -> "inactive"
    RoomLifecycle.CONNECTING, RoomLifecycle.CONNECTED -> "connecting"
    RoomLifecycle.LOBBY -> "conferenceLobby"
    RoomLifecycle.ACTIVE_CONFERENCE -> "activeConference"
}

/** Пользователь сам ушёл с экрана входа / зала ожидания / «поделиться». */
private fun ConferenceResult.isLeftByUser(): Boolean =
    this is ConferenceResult.Error.DeeplinkScreenLeft ||
        this is ConferenceResult.Error.LobbyScreenLeft ||
        this is ConferenceResult.Error.ShareDeeplinkScreenLeft

private fun ConferenceResult.Error.describe(): String = when (this) {
    is ConferenceResult.Error.NoInternet -> "Нет подключения к интернету"
    is ConferenceResult.Error.NoGuestAllowed -> "Во встречу не пускают гостей"
    is ConferenceResult.Error.RoomLinkError -> "Неверная ссылка на встречу"
    is ConferenceResult.Error.RoomDetailsError -> "Не удалось получить данные встречи"
    is ConferenceResult.Error.AlreadyInConference -> "Уже идёт другая встреча"
    is ConferenceResult.Error.ConnectionFailed -> "Не удалось подключиться к серверу Jazz"
    is ConferenceResult.Error.ConferenceTerminated -> "Встреча завершена"
    is ConferenceResult.Error.ActiveConferenceFailed -> "Ошибка во время встречи"
    is ConferenceResult.Error.Scheduled -> listOfNotNull(title, description).joinToString(": ")
        .ifEmpty { "Не удалось создать встречу" }
    else -> "Ошибка Jazz (${javaClass.simpleName})"
}
