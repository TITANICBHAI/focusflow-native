package com.tbtechs.focusflow.modules

import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.ReadableArray
import com.tbtechs.focusflow.services.AppBlockerAccessibilityService

/**
 * SharedPrefsModule
 *
 * JS name: NativeModules.SharedPrefs
 *
 * Lets JS write focus-mode and standalone-block state into Android SharedPreferences
 * so AppBlockerAccessibilityService and BootReceiver can read it even when the JS
 * bundle is not running (app killed, phone rebooted).
 *
 * Methods:
 *   - setFocusActive(active)                          → Promise<null>
 *   - setAllowedPackages(packages)                    → Promise<null>
 *   - setActiveTask(name, endMs, nextName?)            → Promise<null>
 *   - setStandaloneBlock(active, packages, untilMs)   → Promise<null>
 */
class SharedPrefsModule(private val reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    companion object {
        const val NAME = "SharedPrefs"
    }

    override fun getName(): String = NAME

    private fun prefs() = reactContext.getSharedPreferences(
        AppBlockerAccessibilityService.PREFS_NAME, android.content.Context.MODE_PRIVATE
    )

    /**
     * Tells the AccessibilityService and BootReceiver whether task focus mode is active.
     *
     * When deactivating (active = false) and a session PIN is set, [pinHash] must be
     * the correct SHA-256 hex digest of the PIN.  Activation (active = true) never
     * requires a PIN — only ending a session is gated.
     *
     * @param active  true = start tracking focus; false = clear focus
     * @param pinHash SHA-256 hex of the PIN, or null/empty if no PIN is configured
     */
    @ReactMethod
    fun setFocusActive(active: Boolean, pinHash: String?, promise: Promise) {
        if (!active) {
            val storedHash = prefs().getString(
                com.tbtechs.focusflow.modules.SessionPinModule.PREF_PIN_HASH, null
            )
            if (!storedHash.isNullOrBlank()) {
                if (pinHash.isNullOrBlank() ||
                    !storedHash.equals(pinHash.lowercase(), ignoreCase = true)) {
                    promise.reject("PIN_REQUIRED", "A session PIN is set — supply the correct PIN hash to end the session")
                    return
                }
            }
        }
        prefs().edit().putBoolean("focus_active", active).apply()
        promise.resolve(null)
    }

    /**
     * Writes the list of ALLOWED package names for task-based focus blocking.
     * The AccessibilityService blocks any app NOT in this list during a task focus.
     * Pass the full allow-list every call — the service replaces the previous value.
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
     * @param taskId   DB id of the task — passed to ForegroundTaskService so notification
     *                 action buttons (Done / +15m / +30m / Skip) carry the correct id after reboot.
     * @param name     Task display name
     * @param endMs    Task end time as epoch milliseconds
     * @param nextName Name of the next task (pass null or empty string if none)
     */
    @ReactMethod
    fun setActiveTask(taskId: String, name: String, endMs: Double, nextName: String?, promise: Promise) {
        val endEpoch   = endMs.toLong()
        val now        = System.currentTimeMillis()
        val durationMs = (endEpoch - now).coerceAtLeast(0L)
        prefs().edit()
            .putString("task_id", taskId)
            .putString("task_name", name)
            .putLong("task_end_ms", endEpoch)
            .putString("next_task_name", nextName?.takeIf { it.isNotBlank() })
            // Extra fields used by BootReceiver for clock-tamper detection:
            // task_duration_ms: total session length from now
            // task_last_written_ms: wall clock at write time — lets BootReceiver
            //   check whether "elapsed since write" is credible vs claimed end time.
            .putLong("task_duration_ms", durationMs)
            .putLong("task_last_written_ms", now)
            .apply()
        promise.resolve(null)
    }

    /**
     * Controls standalone app blocking — independent of any task.
     *
     * When active = true, the AccessibilityService will block every package in the
     * provided list until untilMs is reached, even if no task focus is running.
     *
     * Collision with task-based blocking: union (both block lists are enforced).
     *
     * @param active    Whether standalone blocking is currently enabled
     * @param packages  ReadableArray of package names to block
     * @param untilMs   Epoch milliseconds when standalone blocking expires (0 = no expiry)
     */
    @ReactMethod
    fun setStandaloneBlock(active: Boolean, packages: ReadableArray, untilMs: Double, promise: Promise) {
        val list = (0 until packages.size()).map { "\"${packages.getString(it)}\"" }
        val json = "[${list.joinToString(",")}]"
        prefs().edit()
            .putBoolean("standalone_block_active", active)
            .putString("standalone_blocked_packages", json)
            .putLong("standalone_block_until_ms", untilMs.toLong())
            .apply()
        promise.resolve(null)
    }

    /**
     * Sets the list of packages that have a "once per day" allowance during blocking sessions.
     *
     * When a package appears in this list and has not been opened today, the first open is
     * allowed through (and the usage is recorded). Subsequent opens on the same calendar day
     * are blocked as normal. The counter resets at midnight automatically (compared by date string).
     *
     * Pass an empty array to disable the daily allowance feature entirely.
     *
     * @param packages  ReadableArray of package names with daily allowance
     */
    @ReactMethod
    fun setDailyAllowancePackages(packages: ReadableArray, promise: Promise) {
        val list = (0 until packages.size()).map { "\"${packages.getString(it)}\"" }
        val json = "[${list.joinToString(",")}]"
        prefs().edit()
            .putString(AppBlockerAccessibilityService.PREF_DAILY_ALLOWANCE_PKGS, json)
            .apply()
        promise.resolve(null)
    }

    /**
     * Writes the list of blocked words to SharedPreferences.
     * During any active blocking session (task focus or standalone block),
     * if any of these words appear in the window content on screen,
     * AppBlockerAccessibilityService redirects the user to home.
     *
     * Pass an empty array to disable word blocking entirely.
     *
     * @param words  ReadableArray of plain-text words (case-insensitive substring match)
     */
    @ReactMethod
    fun setBlockedWords(words: ReadableArray, promise: Promise) {
        val list = (0 until words.size()).map { "\"${words.getString(it)}\"" }
        val json = "[${list.joinToString(",")}]"
        prefs().edit()
            .putString(AppBlockerAccessibilityService.PREF_BLOCKED_WORDS, json)
            .apply()
        promise.resolve(null)
    }

    @ReactMethod
    fun setSystemGuardEnabled(enabled: Boolean, promise: Promise) {
        prefs().edit()
            .putBoolean(AppBlockerAccessibilityService.PREF_SYSTEM_GUARD_ENABLED, enabled)
            .apply()
        promise.resolve(null)
    }

    /**
     * Writes the rich daily allowance config JSON to SharedPreferences.
     * Format: JSON array of DailyAllowanceEntry objects with fields:
     *   packageName, mode ("count"|"time_budget"|"interval"),
     *   countPerDay, budgetMinutes, intervalMinutes, intervalHours.
     *
     * The AccessibilityService reads this to enforce per-app allowance modes.
     * Replaces the old setDailyAllowancePackages (string-only) approach.
     *
     * @param configJson  Full JSON string of DailyAllowanceEntry[]
     */
    @ReactMethod
    fun setDailyAllowanceConfig(configJson: String, promise: Promise) {
        prefs().edit()
            .putString("daily_allowance_config", configJson)
            .apply()
        promise.resolve(null)
    }

    /**
     * Generic key/value string setter — lets JS write arbitrary overlay config keys
     * (e.g. block_overlay_wallpaper, block_overlay_quotes) directly to SharedPreferences
     * without needing a dedicated typed method for each one.
     *
     * @param key    SharedPreferences key
     * @param value  String value to store (pass empty string to clear)
     */
    @ReactMethod
    fun putString(key: String, value: String, promise: Promise) {
        if (value.isEmpty()) {
            prefs().edit().remove(key).apply()
        } else {
            prefs().edit().putString(key, value).apply()
        }
        promise.resolve(null)
    }

    /**
     * Resets the daily allowance usage tracking for all packages (or a specific one).
     * Call with null to reset all packages, or a specific package name to reset just that one.
     *
     * @param packageName  Specific package to reset, or null to reset all
     */
    @ReactMethod
    fun resetDailyAllowanceUsage(packageName: String?, promise: Promise) {
        val editor = prefs().edit()
        if (packageName == null) {
            editor.putString(AppBlockerAccessibilityService.PREF_DAILY_ALLOWANCE_USED, "{}")
        } else {
            val usedJson = prefs().getString(AppBlockerAccessibilityService.PREF_DAILY_ALLOWANCE_USED, "{}") ?: "{}"
            try {
                val obj = org.json.JSONObject(usedJson)
                obj.remove(packageName)
                editor.putString(AppBlockerAccessibilityService.PREF_DAILY_ALLOWANCE_USED, obj.toString())
            } catch (_: Exception) {
                editor.putString(AppBlockerAccessibilityService.PREF_DAILY_ALLOWANCE_USED, "{}")
            }
        }
        editor.apply()
        promise.resolve(null)
    }
}
