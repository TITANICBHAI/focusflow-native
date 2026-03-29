package com.tbtechs.focusday.modules

import com.facebook.react.ReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.uimanager.ViewManager

/**
 * FocusDayPackage
 *
 * Registers all FocusDay native modules with the React Native bridge.
 *
 * How to wire into MainApplication.kt (after expo prebuild generates it):
 *
 *   override fun getPackages(): List<ReactPackage> {
 *     val packages = PackageList(this).packages
 *     packages.add(FocusDayPackage())   ← add this line
 *     return packages
 *   }
 */
class FocusDayPackage : ReactPackage {

    override fun createNativeModules(reactContext: ReactApplicationContext): List<NativeModule> =
        listOf(
            UsageStatsModule(reactContext),
            ForegroundServiceModule(reactContext),
            ForegroundLaunchModule(reactContext),
            FocusDayBridgeModule(reactContext),
            SharedPrefsModule(reactContext),
        )

    override fun createViewManagers(reactContext: ReactApplicationContext): List<ViewManager<*, *>> =
        emptyList()
}
