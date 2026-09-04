//
//  JazzSdkModule.m
//  SberJazz
//
//  Exposes the Swift `JazzSdkModule` to the React Native runtime.
//
//  This is a classic bridge NativeModule (no codegen, no TurboModule spec),
//  which is what makes it architecture-agnostic:
//
//    * old architecture — registered straight into the bridge's module
//      registry by `RCT_EXPORT_MODULE`'s `+load`, reachable as
//      `NativeModules.JazzSdk`;
//    * new architecture — the same class is picked up by React Native's
//      native module interop layer and exposed under the same name.
//
//  Nothing here needs `#if RCT_NEW_ARCH_ENABLED`; the project builds and runs
//  either way (see ios/Podfile for the switch).
//

#import <React/RCTBridgeModule.h>
#import <React/RCTEventEmitter.h>

@interface RCT_EXTERN_MODULE (JazzSdk, RCTEventEmitter)

RCT_EXTERN_METHOD(initialize
                  : (NSDictionary *)options resolver
                  : (RCTPromiseResolveBlock)resolve rejecter
                  : (RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(isInitialized
                  : (RCTPromiseResolveBlock)resolve rejecter
                  : (RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(createConference
                  : (NSDictionary *)options resolver
                  : (RCTPromiseResolveBlock)resolve rejecter
                  : (RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(startConference
                  : (NSDictionary *)options resolver
                  : (RCTPromiseResolveBlock)resolve rejecter
                  : (RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(joinConference
                  : (NSDictionary *)options resolver
                  : (RCTPromiseResolveBlock)resolve rejecter
                  : (RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(terminateActiveConference
                  : (RCTPromiseResolveBlock)resolve rejecter
                  : (RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(handleUrl
                  : (NSString *)url type
                  : (NSString *)type resolver
                  : (RCTPromiseResolveBlock)resolve rejecter
                  : (RCTPromiseRejectBlock)reject)

@end
