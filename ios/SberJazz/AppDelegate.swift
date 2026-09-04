import UIKit
import React
import React_RCTAppDelegate
import ReactAppDependencyProvider

@main
class AppDelegate: RCTAppDelegate {
  override func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey : Any]? = nil) -> Bool {
    self.moduleName = "SberJazz"
    self.dependencyProvider = RCTAppDependencyProvider()

    // You can add your custom initial props in the dictionary below.
    // They will be passed down to the ViewController used by React Native.
    self.initialProps = [:]

    return super.application(application, didFinishLaunchingWithOptions: launchOptions)
  }

  /// JazzCore.xcframework embeds a second, older copy of React Native and
  /// exports all ~190 of its `RCT*` Objective-C classes, which shadow the real
  /// ones. Everything needed to undo that lives in
  /// `Jazz/JazzShadowedClasses.swift`; this is the only hook the app delegate
  /// itself has to provide.
  ///
  /// Only the new architecture calls this (it is the
  /// `RCTTurboModuleManagerDelegate` hook); on the old architecture it is
  /// simply never invoked, so the same source builds under both.
  @objc(getModuleClassFromName:)
  func getModuleClass(fromName name: UnsafePointer<CChar>) -> AnyClass? {
    JazzShadowedClasses.moduleClass(forName: name, requestedBy: self)
  }

  override func sourceURL(for bridge: RCTBridge) -> URL? {
    self.bundleURL()
  }

  override func bundleURL() -> URL? {
#if DEBUG
    RCTBundleURLProvider.sharedSettings().jsBundleURL(forBundleRoot: "index")
#else
    Bundle.main.url(forResource: "main", withExtension: "jsbundle")
#endif
  }
}

