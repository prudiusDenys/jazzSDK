//
//  JazzSdkModule.swift
//  SberJazz
//
//  React Native bridge for the Sber Jazz iOS SDK.
//  https://github.com/salute-developers/jazz-ios-sdk
//
//  The SDK is UIKit/SwiftUI based: every call presents Jazz's own screens on
//  top of the container view controller handed to `Jazz.initialize`. This
//  module therefore lives entirely on the main queue and exposes the session
//  API as promises, plus a `JazzConferencePhaseChanged` event mirroring
//  `JazzSession.shared.jazzConferencePhase`.
//
//  Architecture: this is a plain bridge module built on `RCTEventEmitter`, so
//  it works unchanged on the old architecture (Paper + bridge, the project
//  default) and on the new one through the native module interop layer.
//  See JazzSdkModule.m and ios/Podfile.
//

import Combine
import Foundation
import JazzSDK
import React
import UIKit

// MARK: - Token provider

/// Jazz asks this object for a token configuration whenever it needs to
/// authorize the user. In a production app the values would come from your
/// backend / session store — here they are handed over from JS at
/// `initialize()` time.
final class RNJazzTokenConfigurationProvider: JazzTokenConfigurationProvider {
  private let configuration: JazzTokenConfiguration

  init(configuration: JazzTokenConfiguration) {
    self.configuration = configuration
  }

  func provideTokenConfiguration() -> JazzTokenConfiguration {
    configuration
  }
}

// MARK: - Module

@objc(JazzSdk)
final class JazzSdkModule: RCTEventEmitter {

  private enum ErrorCode: String {
    case notInitialized = "E_JAZZ_NOT_INITIALIZED"
    case initFailed = "E_JAZZ_INIT_FAILED"
    case noContainer = "E_JAZZ_NO_CONTAINER"
    case badArguments = "E_JAZZ_BAD_ARGUMENTS"
    case badLink = "E_JAZZ_BAD_LINK"
  }

  private static let phaseEvent = "JazzConferencePhaseChanged"

  /// The SDK exposes no public "is initialized" flag, so track it here.
  private var initialized = false
  private var hasJsListeners = false
  private var phaseCancellable: AnyCancellable?

  // MARK: RCTEventEmitter plumbing

  override static func requiresMainQueueSetup() -> Bool { true }

  /// Everything below touches UIKit, so pin the module to the main queue.
  override var methodQueue: DispatchQueue { .main }

  override func supportedEvents() -> [String] { [Self.phaseEvent] }

  override func startObserving() {
    hasJsListeners = true
  }

  override func stopObserving() {
    hasJsListeners = false
  }

  // MARK: initialize

  @objc(initialize:resolver:rejecter:)
  func initialize(
    _ options: NSDictionary,
    resolver resolve: @escaping RCTPromiseResolveBlock,
    rejecter reject: @escaping RCTPromiseRejectBlock
  ) {
    guard let container = Self.rootViewController() else {
      reject(
        ErrorCode.noContainer.rawValue,
        "Не удалось найти rootViewController приложения, чтобы передать его в Jazz.",
        nil
      )
      return
    }

    let userId = (options["userId"] as? String) ?? ""
    guard !userId.isEmpty else {
      reject(
        ErrorCode.badArguments.rawValue,
        "`userId` обязателен для конфигурации токена Jazz.",
        nil
      )
      return
    }

    let hostString = (options["hostUrl"] as? String) ?? "https://jazz.sber.ru"
    guard let hostUrl = URL(string: hostString), hostUrl.scheme != nil else {
      reject(
        ErrorCode.badArguments.rawValue,
        "`hostUrl` не является корректным URL: \(hostString)",
        nil
      )
      return
    }

    let tokenProvider = RNJazzTokenConfigurationProvider(
      configuration: JazzTokenConfiguration(
        timeToLive: (options["timeToLive"] as? NSNumber)?.intValue ?? 120,
        issuer: (options["issuer"] as? String) ?? "SberJazzRNDemo",
        userId: userId,
        userName: options["userName"] as? String,
        userEmail: options["userEmail"] as? String
      )
    )

    let settings = JazzSettings(
      network: JazzNetwork(hostUrl: hostUrl),
      buttonsVisibility: .allVisible,
      inviteButton: nil,
      screenShareExtensionIdentifier: options["screenShareExtensionIdentifier"] as? String,
      userNameService: nil
    )

    do {
      try Jazz.initialize(
        conferenceAuthorizationType: .secretKey(
          secretKey: (options["sdkSecret"] as? String) ?? "",
          tokenConfigurationProvider: tokenProvider
        ),
        container: container,
        navigationType: .default,
        settings: settings
      )
      finishInitialization()
      resolve(true)
    } catch JazzSDKError.alreadyInitialized {
      // Re-initialising after a Fast Refresh / JS reload is not an error.
      finishInitialization()
      resolve(true)
    } catch {
      initialized = false
      reject(
        ErrorCode.initFailed.rawValue,
        Self.describe(initializationError: error),
        error
      )
    }
  }

  private func finishInitialization() {
    initialized = true
    observeConferencePhase()
  }

  @objc(isInitialized:rejecter:)
  func isInitialized(
    _ resolve: @escaping RCTPromiseResolveBlock,
    rejecter _: @escaping RCTPromiseRejectBlock
  ) {
    resolve(initialized)
  }

  // MARK: conferences

  /// Opens the "create conference" screen and resolves with the resulting link.
  @objc(createConference:resolver:rejecter:)
  func createConference(
    _ options: NSDictionary,
    resolver resolve: @escaping RCTPromiseResolveBlock,
    rejecter reject: @escaping RCTPromiseRejectBlock
  ) {
    guard ensureInitialized(reject) else { return }

    var settled = false
    JazzSession.shared.createConference(
      configuration: Self.conferenceConfiguration(from: options),
      completion: { url in
        // A promise can only be settled once; the SDK callback is not
        // guaranteed to be one-shot.
        guard !settled else { return }
        settled = true
        resolve(url?.absoluteString)
      }
    )
  }

  /// Creates a conference and joins it right away.
  @objc(startConference:resolver:rejecter:)
  func startConference(
    _ options: NSDictionary,
    resolver resolve: @escaping RCTPromiseResolveBlock,
    rejecter reject: @escaping RCTPromiseRejectBlock
  ) {
    guard ensureInitialized(reject) else { return }

    JazzSession.shared.startConference(
      shouldSkipIntermidiateScreen: (options["skipIntermediateScreen"] as? Bool) ?? false,
      configuration: Self.conferenceConfiguration(from: options),
      mediaSettings: Self.mediaSettings(from: options),
      analyticsConferenceType: options["analyticsConferenceType"] as? String,
      preferredSpeaker: Self.preferredSpeaker(from: options)
    )
    resolve(true)
  }

  /// Joins a conference. With `roomId` the room is pre-filled, otherwise Jazz
  /// shows its own "enter the meeting code" screen.
  @objc(joinConference:resolver:rejecter:)
  func joinConference(
    _ options: NSDictionary,
    resolver resolve: @escaping RCTPromiseResolveBlock,
    rejecter reject: @escaping RCTPromiseRejectBlock
  ) {
    guard ensureInitialized(reject) else { return }

    let room = Self.room(from: options)
    let skipIntermediate = (options["skipIntermediateScreen"] as? Bool) ?? false

    let joinType: JazzJoinConferenceType
    if let room, skipIntermediate {
      joinType = .skipIntermidiateScreen(room: room)
    } else {
      joinType = .showIntermidiateScreen(room: room)
    }

    JazzSession.shared.joinConference(
      joinConferenceType: joinType,
      mediaSettings: Self.mediaSettings(from: options),
      analyticsConferenceType: options["analyticsConferenceType"] as? String,
      preferredSpeaker: Self.preferredSpeaker(from: options)
    )
    resolve(true)
  }

  @objc(terminateActiveConference:rejecter:)
  func terminateActiveConference(
    _ resolve: @escaping RCTPromiseResolveBlock,
    rejecter reject: @escaping RCTPromiseRejectBlock
  ) {
    guard ensureInitialized(reject) else { return }

    JazzSession.shared.terminateActiveConference()
    resolve(true)
  }

  /// Parses an app-link / deep-link and reports what it points at.
  @objc(handleUrl:type:resolver:rejecter:)
  func handleUrl(
    _ urlString: String,
    type: String,
    resolver resolve: @escaping RCTPromiseResolveBlock,
    rejecter reject: @escaping RCTPromiseRejectBlock
  ) {
    guard ensureInitialized(reject) else { return }

    guard let url = URL(string: urlString) else {
      reject(ErrorCode.badArguments.rawValue, "Некорректный URL: \(urlString)", nil)
      return
    }

    let result = JazzSession.shared.handle(
      url: url,
      type: type == "deeplink" ? .deeplink : .applink
    )

    switch result {
    case let .success(target):
      resolve(Self.serialize(linkTarget: target))
    case let .failure(error):
      reject(
        ErrorCode.badLink.rawValue,
        error.errorDescription ?? "Не удалось разобрать ссылку Jazz.",
        error
      )
    }
  }

  // MARK: - Conference phase

  private func observeConferencePhase() {
    guard phaseCancellable == nil else { return }

    phaseCancellable = JazzSession.shared.$jazzConferencePhase
      .receive(on: DispatchQueue.main)
      .sink { [weak self] phase in
        guard let self, self.hasJsListeners else { return }
        self.sendEvent(withName: Self.phaseEvent, body: Self.serialize(phase: phase))
      }
  }

  override func invalidate() {
    phaseCancellable?.cancel()
    phaseCancellable = nil
    super.invalidate()
  }

  // MARK: - Helpers

  private func ensureInitialized(_ reject: RCTPromiseRejectBlock) -> Bool {
    guard initialized else {
      reject(
        ErrorCode.notInitialized.rawValue,
        "Сначала вызовите Jazz.initialize() — иначе JazzSession.shared возвращает ошибку авторизации.",
        nil
      )
      return false
    }
    return true
  }

  private static func describe(initializationError error: Error) -> String {
    switch error {
    case JazzSDKError.invalidSDKSecret:
      return "Неверный секретный ключ SDK. Зарегистрируйте приложение в Jazz и укажите выданный ключ."
    case JazzSDKError.invalidNetworkConfiguration:
      return "Неверная сетевая конфигурация Jazz (проверьте hostUrl)."
    case JazzSDKError.alreadyInitialized:
      return "Jazz SDK уже инициализирован."
    default:
      return error.localizedDescription
    }
  }

  private static func conferenceConfiguration(
    from options: NSDictionary
  ) -> JazzConferenceConfiguration {
    JazzConferenceConfiguration(
      title: options["title"] as? String,
      type: options["type"] as? String,
      settings: JazzConferenceSettings(
        isGuestsOn: (options["isGuestsOn"] as? Bool) ?? true,
        isLobbyOn: (options["isLobbyOn"] as? Bool) ?? false,
        isAutoRecordEnabled: (options["isAutoRecordEnabled"] as? Bool) ?? false
      )
    )
  }

  private static func mediaSettings(
    from options: NSDictionary
  ) -> JazzConferenceMediaSettings {
    JazzConferenceMediaSettings(
      isCameraOn: (options["isCameraOn"] as? Bool) ?? false,
      isMicrophoneOn: (options["isMicrophoneOn"] as? Bool) ?? false
    )
  }

  private static func preferredSpeaker(
    from options: NSDictionary
  ) -> ConferencePreferredSpeaker? {
    guard let raw = options["preferredSpeaker"] as? String else { return nil }
    return ConferencePreferredSpeaker(rawValue: raw)
  }

  private static func room(from options: NSDictionary) -> JazzRoom? {
    guard
      let id = (options["roomId"] as? String)?.trimmingCharacters(in: .whitespacesAndNewlines),
      !id.isEmpty
    else {
      return nil
    }
    return JazzRoom(
      id: id,
      decodedPassword: (options["roomPassword"] as? String) ?? "",
      host: options["roomHost"] as? String
    )
  }

  private static func serialize(room: JazzRoom) -> [String: Any] {
    var payload: [String: Any] = ["id": room.id, "password": room.decodedPassword]
    payload["host"] = room.host
    return payload
  }

  private static func serialize(phase: JazzConferencePhase) -> [String: Any] {
    switch phase {
    case .inactive:
      return ["phase": "inactive"]
    case .connecting:
      return ["phase": "connecting"]
    case .conferenceLobby:
      return ["phase": "conferenceLobby"]
    case let .activeConference(room):
      return ["phase": "activeConference", "room": serialize(room: room)]
    case .webinarLobby:
      return ["phase": "webinarLobby"]
    case let .activeWebinar(room):
      return ["phase": "activeWebinar", "room": serialize(room: room)]
    case .waitingStream:
      return ["phase": "waitingStream"]
    case let .activeStream(streamId):
      return ["phase": "activeStream", "streamId": streamId]
    @unknown default:
      return ["phase": "unknown"]
    }
  }

  private static func serialize(linkTarget: JazzParseLinkTarget) -> [String: Any] {
    switch linkTarget {
    case let .joinConferenceRoom(room):
      return ["target": "joinConferenceRoom", "room": serialize(room: room)]
    case let .joinWebinar(room, userRole):
      return [
        "target": "joinWebinar",
        "room": serialize(room: room),
        "userRole": userRole.rawValue,
      ]
    case let .joinStream(streamId):
      return ["target": "joinStream", "streamId": streamId]
    case let .openMeetingInfo(meetingId, domain):
      return [
        "target": "openMeetingInfo",
        "meetingId": meetingId,
        "domain": domain.absoluteString,
      ]
    @unknown default:
      return ["target": "unknown"]
    }
  }

  /// Jazz presents its screens from a container view controller — use the
  /// React Native root VC so conference UI appears over the RN app.
  private static func rootViewController() -> UIViewController? {
    let scenes = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }

    let window =
      scenes
        .first(where: { $0.activationState == .foregroundActive })?
        .windows.first(where: \.isKeyWindow)
        ?? scenes.flatMap(\.windows).first(where: \.isKeyWindow)
        ?? scenes.flatMap(\.windows).first

    // Present from the topmost VC so Jazz is not covered by an RN modal.
    var controller = window?.rootViewController
    while let presented = controller?.presentedViewController {
      controller = presented
    }
    return controller
  }
}
