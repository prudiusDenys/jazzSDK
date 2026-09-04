//
//  JazzShadowedClasses.swift
//  SberJazz
//
//  Workaround for JazzCore.xcframework shipping a second, older copy of React
//  Native. See ios/Podfile and PORTING.md for the full story.
//

import MachO
import ObjectiveC
import React_RCTAppDelegate
import UIKit

/// Resolves Objective-C classes by name while ignoring the duplicates that
/// JazzCore.xcframework brings into the process.
/// See `AppDelegate.getModuleClass(fromName:)`.
///
/// `objc_getClass` (and Swift's `objc_copyClassList`) cannot be used here: the
/// first resolves to Jazz's copy, and the second bridges every class in the
/// process into Swift, which trips over classes that do not descend from
/// NSObject. Reading `__objc_classlist` out of the loaded images instead lets
/// us pick a class by name *and* by the image it came from, touching nothing
/// but the Objective-C C API.
enum JazzShadowedClasses {
  private static let jazzImageMarker = "JazzCore.framework"

  private static var cache: [String: AnyClass] = [:]
  private static let lock = NSLock()

  static func isFromJazz(_ cls: AnyClass) -> Bool {
    guard let image = class_getImageName(cls) else { return false }
    return String(cString: image).contains(jazzImageMarker)
  }

  static func reactNativeClass(named name: String) -> AnyClass? {
    lock.lock()
    defer { lock.unlock() }

    if let cached = cache[name] { return cached }
    guard let found = search(for: name) else { return nil }
    cache[name] = found
    return found
  }

  private static func search(for name: String) -> AnyClass? {
    for index in 0..<_dyld_image_count() {
      guard let namePointer = _dyld_get_image_name(index) else { continue }
      let imagePath = String(cString: namePointer)
      // Only the app's own binary and its embedded frameworks — minus Jazz.
      guard imagePath.contains(".app/"), !imagePath.contains(jazzImageMarker) else {
        continue
      }
      guard let header = _dyld_get_image_header(index) else { continue }
      if let match = classNamed(name, in: header) { return match }
    }
    return nil
  }

  private static func classNamed(
    _ name: String,
    in header: UnsafePointer<mach_header>
  ) -> AnyClass? {
    header.withMemoryRebound(to: mach_header_64.self, capacity: 1) { header64 in
      for segment in ["__DATA_CONST", "__DATA", "__DATA_DIRTY"] {
        var size: UInt = 0
        guard let section = getsectiondata(header64, segment, "__objc_classlist", &size),
              size > 0
        else {
          continue
        }

        let stride = MemoryLayout<UnsafeRawPointer>.size
        let pointers = UnsafeRawPointer(section).assumingMemoryBound(to: UnsafeRawPointer.self)
        for offset in 0..<(Int(size) / stride) {
          // unsafeBitCast keeps this a plain pointer cast: no retain, no
          // message send, so exotic root classes cannot blow up here.
          let cls = unsafeBitCast(pointers[offset], to: AnyClass.self)
          if String(cString: class_getName(cls)) == name { return cls }
        }
      }
      return nil
    }
  }
}

extension JazzShadowedClasses {
  /// Drop-in body for `RCTAppDelegate`'s `getModuleClassFromName:`.
  ///
  /// Asks React Native's own implementation first and only steps in when the
  /// answer came out of JazzCore — then resolves the name against the real
  /// React Native images.
  ///
  /// `RCTAppDelegate` declares that method in a class extension, so Swift
  /// cannot see it: it can neither be `override`n nor reached through
  /// `super`. Hence the explicit `@objc` selector at the call site and the
  /// manual super dispatch here.
  static func moduleClass(
    forName name: UnsafePointer<CChar>,
    requestedBy appDelegate: AnyObject
  ) -> AnyClass? {
    if let moduleClass = superModuleClass(for: name, on: appDelegate),
       !isFromJazz(moduleClass) {
      return moduleClass
    }

    let moduleName = String(cString: name)
    return reactNativeClass(named: moduleName)
      ?? reactNativeClass(named: "RCT" + moduleName)
  }

  private static func superModuleClass(
    for name: UnsafePointer<CChar>,
    on receiver: AnyObject
  ) -> AnyClass? {
    let selector = NSSelectorFromString("getModuleClassFromName:")
    // class_getInstanceMethod returns nil when the superclass genuinely does
    // not implement the selector; class_getMethodImplementation would hand
    // back the message-forwarding trampoline and crash when called.
    guard let method = class_getInstanceMethod(RCTAppDelegate.self, selector) else {
      return nil
    }
    let imp = method_getImplementation(method)
    typealias Implementation =
      @convention(c) (AnyObject, Selector, UnsafePointer<CChar>) -> AnyClass?
    return unsafeBitCast(imp, to: Implementation.self)(receiver, selector, name)
  }
}
