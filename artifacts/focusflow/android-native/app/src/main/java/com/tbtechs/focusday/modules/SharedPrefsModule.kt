package com.tbtechs.focusday.modules

import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.ReadableArray
import com.tbtechs.focusday.services.AppBlockerAccessibilityService

/**
 * SharedPrefsModule
 *
 * JS name: NativeModules.SharedPrefs
 *
 * Lets JS write focus-mode state into Android SharedPreferences so the
 * AppBlockerAccessibilityService can read it even when the JS bundle is not running
 * (e.g. app killed, phone rebooted).
 *
 * Methods:
 *   - setFocusActive(active: boolean)          → Promise<null>
 *   - setAllowedPackages(packages: string[])   → Promise<null>
 *   - setActiveTask(name, endMs, nextName?)     → Promise<null>
 */
class SharedPrefsModule(private val reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    override fun getName(): String = "SharedPrefs"

    private fun prefs() = reactContext.getSharedPreferences(
        AppBlockerAccessibilityService.PREFS_NAME, android.content.Context.MODE_PRIVATE
    )

    /**
     * Tells the AccessibilityService and BootReceiver whether focus mode is active.
     */
    @ReactMethod
    fun setFocusActive(active: Boolean, promise: Promise) {
        prefs().edit().putString("focus_active", if (active) "true" else "false").apply()
        promise.resolve(null)
    }

    /**
     * Writes the list of ALLOWED package names as a JSON array string.
     * The AccessibilityService blocks any foreground app NOT in this list.
     *
     * Pass the full allow-list every time — the service replaces the previous value.
     * The app's own package is always exempted inside the service regardless.
     *
     * @param packages  ReadableArray of package name strings
     *                  e.g. ["com.android.dialer", "com.whatsapp"]
     */
    @ReactMethod
    fun setAllowedPackages(packages: ReadableArray, promise: Promise) {
        val list = (0 until packages.size()).map { "\"${packages.getString(it)}\"" }
        val json = "[${list.joinToString(",")}]"
        prefs().edit().putString("allowed_packages", json).apply()
        promise.resolve(null)
    }

    /**
     * Stores the active task details so BootReceiver can restart the service after reboot.
     *
     * @param name     Task display name
     * @param endMs    Task end time as epoch milliseconds
     * @param nextName Name of the next task (pass null or empty string if none)
     */
    @ReactMethod
    fun setActiveTask(name: String, endMs: Double, nextName: String?, promise: Promise) {
        prefs().edit()
            .putString("task_name", name)
            .putLong("task_end_ms", endMs.toLong())
            .putString("next_task_name", nextName?.takeIf { it.isNotBlank() })
            .apply()
        promise.resolve(null)
    }
}
