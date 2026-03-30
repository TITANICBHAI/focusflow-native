package com.tbtechs.focusflow.modules

import com.facebook.react.TurboReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.module.model.ReactModuleInfo
import com.facebook.react.module.model.ReactModuleInfoProvider
import com.facebook.react.uimanager.ViewManager

/**
 * FocusDayPackage
 *
 * Registers all FocusDay native modules with the React Native bridge.
 *
 * Extends TurboReactPackage (instead of ReactPackage) to provide
 * getReactModuleInfoProvider() for lazy module instantiation. Compatible with
 * Old Architecture (newArchEnabled=false) via the bridge interop layer.
 * All six modules use the standard ReactContextBaseJavaModule + @ReactMethod pattern.
 *
 * How to wire into MainApplication.kt (after expo prebuild generates it):
 *
 *   override fun getPackages(): List<ReactPackage> {
 *     val packages = PackageList(this).packages
 *     packages.add(FocusDayPackage())   ← add this line
 *     return packages
 *   }
 */
class FocusDayPackage : TurboReactPackage() {

    override fun getModule(name: String, reactContext: ReactApplicationContext): NativeModule? =
        when (name) {
            UsageStatsModule.NAME         -> UsageStatsModule(reactContext)
            ForegroundServiceModule.NAME  -> ForegroundServiceModule(reactContext)
            ForegroundLaunchModule.NAME   -> ForegroundLaunchModule(reactContext)
            FocusDayBridgeModule.NAME     -> FocusDayBridgeModule(reactContext)
            SharedPrefsModule.NAME        -> SharedPrefsModule(reactContext)
            InstalledAppsModule.NAME      -> InstalledAppsModule(reactContext)
            else                          -> null
        }

    override fun getReactModuleInfoProvider(): ReactModuleInfoProvider = ReactModuleInfoProvider {
        mapOf(
            UsageStatsModule.NAME        to ReactModuleInfo(UsageStatsModule.NAME,        UsageStatsModule::class.java.name,        false, false, false, true),
            ForegroundServiceModule.NAME to ReactModuleInfo(ForegroundServiceModule.NAME, ForegroundServiceModule::class.java.name, false, false, false, true),
            ForegroundLaunchModule.NAME  to ReactModuleInfo(ForegroundLaunchModule.NAME,  ForegroundLaunchModule::class.java.name,  false, false, false, true),
            FocusDayBridgeModule.NAME    to ReactModuleInfo(FocusDayBridgeModule.NAME,    FocusDayBridgeModule::class.java.name,    false, false, false, true),
            SharedPrefsModule.NAME       to ReactModuleInfo(SharedPrefsModule.NAME,       SharedPrefsModule::class.java.name,       false, false, false, true),
            InstalledAppsModule.NAME     to ReactModuleInfo(InstalledAppsModule.NAME,     InstalledAppsModule::class.java.name,     false, false, false, true),
        )
    }

    override fun createViewManagers(reactContext: ReactApplicationContext): List<ViewManager<*, *>> =
        emptyList()
}
