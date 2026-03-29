package com.tbtechs.focusday.modules

import android.content.Intent
import android.net.Uri
import android.os.Build
import android.provider.Settings
import android.view.WindowManager
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod

/**
 * ForegroundLaunchModule
 *
 * JS name: NativeModules.ForegroundLaunch
 * Methods:
 *   - bringToFront()            → Promise<null>  — re-launches FocusDay over the blocked app
 *   - showOverlay(message)      → Promise<null>  — brings to front (overlay requires SYSTEM_ALERT_WINDOW)
 *   - hasOverlayPermission()    → Promise<Boolean>
 *   - requestOverlayPermission() → Promise<null>
 */
class ForegroundLaunchModule(private val reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    override fun getName(): String = "ForegroundLaunch"

    /**
     * Brings FocusDay back to the foreground.
     * Uses FLAG_ACTIVITY_SINGLE_TOP so the existing Activity is reused rather than stacked.
     */
    @ReactMethod
    fun bringToFront(promise: Promise) {
        try {
            val pm = reactContext.packageManager
            val intent = pm.getLaunchIntentForPackage(reactContext.packageName)?.apply {
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_REORDER_TO_FRONT)
            }
            intent?.let { reactContext.startActivity(it) }
            promise.resolve(null)
        } catch (e: Exception) {
            promise.reject("LAUNCH_ERROR", e.message, e)
        }
    }

    /**
     * Shows a brief overlay message then brings FocusDay to front.
     * Full WindowManager overlay requires SYSTEM_ALERT_WINDOW; this simpler version
     * just re-launches the app. Replace with a custom Activity for a full-screen blocker.
     */
    @ReactMethod
    fun showOverlay(message: String, promise: Promise) {
        bringToFront(promise)
    }

    /**
     * Returns whether the SYSTEM_ALERT_WINDOW ("Draw over other apps") permission is granted.
     */
    @ReactMethod
    fun hasOverlayPermission(promise: Promise) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            promise.resolve(Settings.canDrawOverlays(reactContext))
        } else {
            promise.resolve(true)
        }
    }

    /**
     * Opens the system overlay permission screen for the user to grant SYSTEM_ALERT_WINDOW.
     */
    @ReactMethod
    fun requestOverlayPermission(promise: Promise) {
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M && !Settings.canDrawOverlays(reactContext)) {
                val intent = Intent(
                    Settings.ACTION_MANAGE_OVERLAY_PERMISSION,
                    Uri.parse("package:${reactContext.packageName}")
                ).apply {
                    flags = Intent.FLAG_ACTIVITY_NEW_TASK
                }
                reactContext.startActivity(intent)
            }
            promise.resolve(null)
        } catch (e: Exception) {
            promise.reject("OVERLAY_ERROR", e.message, e)
        }
    }
}
