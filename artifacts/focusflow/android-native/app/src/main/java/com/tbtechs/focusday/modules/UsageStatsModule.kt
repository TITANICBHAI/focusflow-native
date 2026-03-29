package com.tbtechs.focusday.modules

import android.app.AppOpsManager
import android.app.usage.UsageStatsManager
import android.content.Context
import android.content.Intent
import android.os.Process
import android.provider.Settings
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod

/**
 * UsageStatsModule
 *
 * JS name: NativeModules.UsageStats
 * Methods:
 *   - getForegroundApp()  → Promise<String?>
 *   - hasPermission()     → Promise<Boolean>
 *   - openUsageAccessSettings() → Promise<null>
 *
 * Permission required: android.permission.PACKAGE_USAGE_STATS
 * Must be granted manually: Settings → Apps → Special app access → Usage access
 */
class UsageStatsModule(private val reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    override fun getName(): String = "UsageStats"

    /**
     * Returns the package name of the current foreground app.
     * Queries the last 10 seconds of usage data and picks the most-recently-used entry.
     */
    @ReactMethod
    fun getForegroundApp(promise: Promise) {
        try {
            val usm = reactContext.getSystemService(Context.USAGE_STATS_SERVICE) as UsageStatsManager
            val now = System.currentTimeMillis()
            // Query a 10-second window to catch the current foreground app
            val stats = usm.queryUsageStats(UsageStatsManager.INTERVAL_DAILY, now - 10_000, now)

            if (stats.isNullOrEmpty()) {
                promise.resolve(null)
                return
            }

            val foreground = stats.maxByOrNull { it.lastTimeUsed }?.packageName
            promise.resolve(foreground)
        } catch (e: Exception) {
            promise.reject("USAGE_STATS_ERROR", e.message, e)
        }
    }

    /**
     * Returns whether the PACKAGE_USAGE_STATS permission has been granted.
     */
    @ReactMethod
    fun hasPermission(promise: Promise) {
        try {
            val appOps = reactContext.getSystemService(Context.APP_OPS_SERVICE) as AppOpsManager
            val mode = appOps.checkOpNoThrow(
                AppOpsManager.OPSTR_GET_USAGE_STATS,
                Process.myUid(),
                reactContext.packageName
            )
            promise.resolve(mode == AppOpsManager.MODE_ALLOWED)
        } catch (e: Exception) {
            promise.resolve(false)
        }
    }

    /**
     * Opens the Usage Access settings screen so the user can grant permission.
     */
    @ReactMethod
    fun openUsageAccessSettings(promise: Promise) {
        try {
            val intent = Intent(Settings.ACTION_USAGE_ACCESS_SETTINGS).apply {
                flags = Intent.FLAG_ACTIVITY_NEW_TASK
            }
            reactContext.startActivity(intent)
            promise.resolve(null)
        } catch (e: Exception) {
            promise.reject("SETTINGS_ERROR", e.message, e)
        }
    }
}
