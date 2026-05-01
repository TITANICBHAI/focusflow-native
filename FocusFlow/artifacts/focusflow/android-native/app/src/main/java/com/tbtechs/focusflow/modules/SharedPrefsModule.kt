package com.tbtechs.focusflow.modules

import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.ReadableArray
import com.tbtechs.focusflow.services.AppBlockerAccessibilityService
import com.tbtechs.focusflow.widget.FocusFlowWidget

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
 *   - setAlwaysBlockActive(active, packages)          → Promise<null>
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
        // Detect task identity change BEFORE we overwrite task_id — when the
        // task id changes we must invalidate task_start_ms so the next
        // setActiveTaskStartMs call writes the new task's real start time
        // (instead of inheriting the previous task's start, which would make
        // the widget progress bar jump to ~100% on back-to-back tasks).
        val prevId = prefs().getString("task_id", "") ?: ""
        val editor = prefs().edit()
            .putString("task_id", taskId)
            .putString("task_name", name)
            .putLong("task_end_ms", endEpoch)
            .putString("next_task_name", nextName?.takeIf { it.isNotBlank() })
        if (prevId != taskId) {
            editor.remove("task_start_ms")
        }
        editor
            // Extra fields used by BootReceiver for clock-tamper detection:
            // task_duration_ms: total session length from now
            // task_last_written_ms: wall clock at write time — lets BootReceiver
            //   check whether "elapsed since write" is credible vs claimed end time.
            .putLong("task_duration_ms", durationMs)
            .putLong("task_last_written_ms", now)
            .apply()
        // Push fresh data to any home-screen widgets so they reflect the new task immediately.
        FocusFlowWidget.pushWidgetUpdate(reactContext)
        promise.resolve(null)
    }

    /**
     * Writes the active task's accent color (hex string, e.g. "#6366f1") so the
     * widget can tint its header / sub-line to match the task. Pass an empty
     * string to clear (widget falls back to the default indigo accent).
     */
    @ReactMethod
    fun setActiveTaskColor(colorHex: String, promise: Promise) {
        val editor = prefs().edit()
        if (colorHex.isBlank()) {
            editor.remove("task_color")
        } else {
            editor.putString("task_color", colorHex)
        }
        editor.apply()
        FocusFlowWidget.pushWidgetUpdate(reactContext)
        promise.resolve(null)
    }

    /**
     * Persists the wall-clock start time of the active task so the widget can
     * compute progress without depending on ForegroundTaskService having been
     * the one to start the session (i.e. for time-active tasks running outside
     * focus mode). Pass 0 to clear.
     *
     * Idempotent: callers may invoke this on every state change — the value
     * will only be written when it differs from what's already stored, so
     * progress remains monotonic.
     */
    @ReactMethod
    fun setActiveTaskStartMs(taskId: String, startMs: Double, promise: Promise) {
        val current   = prefs().getString("task_id", "") ?: ""
        val currStart = prefs().getLong("task_start_ms", 0L)
        val newStart  = startMs.toLong()
        // Only write when the task identity changed OR no start time exists yet.
        // This prevents the widget's progress bar from jumping back to 0 when
        // setActiveTaskStartMs is called repeatedly for the same task.
        if (taskId != current || currStart <= 0L || newStart <= 0L) {
            val editor = prefs().edit()
            if (newStart <= 0L) {
                editor.remove("task_start_ms")
            } else {
                editor.putLong("task_start_ms", newStart)
            }
            editor.apply()
            FocusFlowWidget.pushWidgetUpdate(reactContext)
        }
        promise.resolve(null)
    }

    /**
     * Clears the active task fields so the widget falls back to the standalone
     * block / idle render. Does NOT touch focus_active or any block state.
     */
    @ReactMethod
    fun clearActiveTask(promise: Promise) {
        prefs().edit()
            .remove("task_id")
            .remove("task_name")
            .remove("task_end_ms")
            .remove("task_start_ms")
            .remove("task_color")
            .remove("next_task_name")
            .apply()
        FocusFlowWidget.pushWidgetUpdate(reactContext)
        promise.resolve(null)
    }

    /**
     * Forces a widget redraw using whatever is currently in SharedPreferences.
     * Called by the JS layer after standalone block changes, task add/edit/delete,
     * task completion, etc.
     */
    @ReactMethod
    fun pushWidgetUpdate(promise: Promise) {
        FocusFlowWidget.pushWidgetUpdate(reactContext)
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
        // Standalone block changes are independent of focus mode, so the widget
        // needs an explicit nudge to re-read prefs and switch render mode.
        FocusFlowWidget.pushWidgetUpdate(reactContext)
        promise.resolve(null)
    }

    /**
     * Enables or disables always-on block enforcement — independent of any timed session.
     *
     * When active = true, AppBlockerAccessibilityService will enforce the provided
     * package list even when no focus task or standalone block timer is running.
     * Daily allowance rules are also enforced in always-on mode.
     *
     * This is separate from setStandaloneBlock — it does not start or stop any timed
     * session, and the UI "locked" state is not affected (settings remain editable when
     * no timed session is running, regardless of this flag).
     *
     * @param active    Whether always-on enforcement is enabled
     * @param packages  ReadableArray of package names to always block
     */
    @ReactMethod
    fun setAlwaysBlockActive(active: Boolean, packages: ReadableArray, promise: Promise) {
        val list = (0 until packages.size()).map { "\"${packages.getString(it)}\"" }
        val json = "[${list.joinToString(",")}]"
        prefs().edit()
            .putBoolean(AppBlockerAccessibilityService.PREF_ALWAYS_BLOCK, active)
            .putString(AppBlockerAccessibilityService.PREF_ALWAYS_BLOCK_PKGS, json)
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

    @ReactMethod
    fun setBlockInstallActionsEnabled(enabled: Boolean, promise: Promise) {
        prefs().edit()
            .putBoolean(AppBlockerAccessibilityService.PREF_BLOCK_INSTALL_ACTIONS, enabled)
            .apply()
        promise.resolve(null)
    }

    @ReactMethod
    fun setBlockYoutubeShortsEnabled(enabled: Boolean, promise: Promise) {
        prefs().edit()
            .putBoolean(AppBlockerAccessibilityService.PREF_BLOCK_YT_SHORTS, enabled)
            .apply()
        promise.resolve(null)
    }

    @ReactMethod
    fun setBlockInstagramReelsEnabled(enabled: Boolean, promise: Promise) {
        prefs().edit()
            .putBoolean(AppBlockerAccessibilityService.PREF_BLOCK_IG_REELS, enabled)
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
    /**
     * Writes the custom node-rule JSON (derived from NodeSpy NodeSpyCaptureV1 exports)
     * to SharedPreferences so the AccessibilityService can enforce them without JS.
     *
     * Format: JSON array of objects with fields:
     *   id, label, pkg, matchResId?, matchText?, matchCls?, action ("overlay"|"home"), enabled
     *
     * Only enabled rules need to be sent — the TS wrapper filters them before calling here.
     *
     * @param rulesJson  Full JSON string of CustomNodeRule[]
     */
    @ReactMethod
    fun setCustomNodeRules(rulesJson: String, promise: Promise) {
        prefs().edit()
            .putString(AppBlockerAccessibilityService.PREF_CUSTOM_NODE_RULES, rulesJson)
            .apply()
        promise.resolve(null)
    }

    /**
     * Generic key/value string getter — lets JS read arbitrary config keys from
     * SharedPreferences. Used by AppContext to cross-check critical flags (e.g.
     * privacy_accepted) that are backed up here in case the SQLite DB is wiped.
     *
     * Returns null (resolves with JS null) when the key is absent.
     *
     * @param key  SharedPreferences key
     */
    @ReactMethod
    fun getString(key: String, promise: Promise) {
        promise.resolve(prefs().getString(key, null))
    }

    /**
     * Returns true when the installed APK was built with android:debuggable=true
     * (debug variant). Unlike JS `__DEV__`, which is only true while running
     * through the Metro bundler, this reflects the actual native build flavour —
     * so debug-built APKs that run their prebundled JS still report true and
     * the Diagnostics screen stays accessible.
     */
    @ReactMethod
    fun isDebuggable(promise: Promise) {
        val flags = reactContext.applicationInfo.flags
        val debuggable = (flags and android.content.pm.ApplicationInfo.FLAG_DEBUGGABLE) != 0
        promise.resolve(debuggable)
    }

    /**
     * Writes today's progress snapshot for the home-screen widget so it can
     * show motivational context (e.g. "3/5 tasks · 45m today" with a streak
     * chip) when no task is active. Triggers a widget redraw.
     *
     * @param tasksDone   Number of today's tasks completed
     * @param tasksTotal  Total number of today's tasks
     * @param focusMins   Total focus minutes today
     * @param streakDays  Current consecutive-day streak
     */
    @ReactMethod
    fun setDailyStats(
        tasksDone: Int,
        tasksTotal: Int,
        focusMins: Int,
        streakDays: Int,
        promise: Promise,
    ) {
        prefs().edit()
            .putInt("daily_tasks_done", tasksDone.coerceAtLeast(0))
            .putInt("daily_tasks_total", tasksTotal.coerceAtLeast(0))
            .putInt("daily_focus_mins", focusMins.coerceAtLeast(0))
            .putInt("streak_days", streakDays.coerceAtLeast(0))
            .apply()
        FocusFlowWidget.pushWidgetUpdate(reactContext)
        promise.resolve(null)
    }

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
