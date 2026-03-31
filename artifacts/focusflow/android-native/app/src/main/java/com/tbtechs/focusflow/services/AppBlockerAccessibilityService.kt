package com.tbtechs.focusflow.services

import android.accessibilityservice.AccessibilityService
import android.content.Intent
import android.content.SharedPreferences
import android.view.accessibility.AccessibilityEvent
import com.tbtechs.focusflow.modules.FocusDayBridgeModule

/**
 * AppBlockerAccessibilityService
 *
 * Listens for window-state-changed events and enforces two independent blocking systems:
 *
 *   1. TASK-BASED BLOCK (focus_active = true)
 *      - Blocks any app NOT in the "allowed_packages" list.
 *      - System UI, launchers, phone/dialer, and settings are ALWAYS allowed (see ALWAYS_ALLOWED).
 *      - Cleared automatically when task_end_ms is passed (native time authority).
 *
 *   2. STANDALONE BLOCK (standalone_block_active = true)
 *      - Blocks specific apps listed in "standalone_blocked_packages".
 *      - Independent of any task — stays active until standalone_block_until_ms.
 *      - Cleared automatically when the expiry timestamp is passed.
 *
 * When BOTH are active at the same time, enforcement is additive (union):
 *   - Task-blocked apps AND standalone-blocked apps are both enforced.
 *
 * SharedPreferences file: "focusday_prefs"
 * Keys:
 *   focus_active                 Boolean — task focus is running
 *   allowed_packages             String  — JSON array of packages allowed during task focus
 *   task_end_ms                  Long    — task session end epoch ms
 *   standalone_block_active      Boolean — standalone block is enabled
 *   standalone_blocked_packages  String  — JSON array of packages to always block
 *   standalone_block_until_ms    Long    — standalone block expiry epoch ms
 */
class AppBlockerAccessibilityService : AccessibilityService() {

    companion object {
        const val PREFS_NAME       = "focusday_prefs"
        const val PREF_ALLOWED_PKG = "allowed_packages"
        const val PREF_FOCUS_ON    = "focus_active"

        const val PREF_SA_ACTIVE   = "standalone_block_active"
        const val PREF_SA_PKGS     = "standalone_blocked_packages"
        const val PREF_SA_UNTIL    = "standalone_block_until_ms"

        /**
         * Packages that are NEVER blocked regardless of focus or standalone settings.
         *
         * This must include every launcher / home screen variant and system-critical
         * packages. Without this, pressing HOME sends the user to the launcher which
         * then fires a TYPE_WINDOW_STATE_CHANGED event — the service would immediately
         * block the launcher too, causing an infinite HOME-press loop.
         */
        val ALWAYS_ALLOWED: Set<String> = setOf(
            // Core Android OS
            "android",
            // System UI (status bar, nav bar, quick settings)
            "com.android.systemui",
            "com.sec.android.app.systemui",
            "com.samsung.android.systemui",
            // Launchers / home screens
            "com.sec.android.app.launcher",          // Samsung One UI
            "com.samsung.android.app.launcher",
            "com.samsung.android.incallui",          // Samsung call screen
            "com.google.android.apps.nexuslauncher", // Pixel
            "com.android.launcher3",                 // AOSP
            "com.android.launcher",
            "com.miui.home",                         // MIUI
            "com.oneplus.launcher",
            "com.huawei.android.launcher",
            "com.oppo.launcher",
            "com.bbk.launcher2",                     // Vivo
            // Phone / dialer (emergency access)
            "com.android.phone",
            "com.android.dialer",
            "com.google.android.dialer",
            "com.samsung.android.app.telephonyui",
            // Settings (user must be able to reach FocusFlow settings to stop the session)
            "com.android.settings",
            "com.samsung.android.app.settings",
            "com.samsung.android.settings"
        )

        /**
         * Previously used to permanently block package installers.
         * Removed — the user now has full control over whether to block the installer
         * via the Allowed Apps list (focus mode) or Block Schedule (standalone).
         * Kept as an empty set so callers don't need updating.
         */
        val ALWAYS_BLOCKED: Set<String> = emptySet()
    }

    private lateinit var prefs: SharedPreferences
    private var lastBlockedPkg: String? = null
    private var lastBlockedAtMs: Long = 0L

    override fun onServiceConnected() {
        prefs = getSharedPreferences(PREFS_NAME, MODE_PRIVATE)
        // Note: do NOT dynamically reassign serviceInfo here.
        // Event types, flags, and capabilities are declared in accessibility_service_config.xml.
        // Reassigning serviceInfo in onServiceConnected can silently break Samsung One UI
        // because Samsung's accessibility manager re-reads the XML config after connection
        // and may reject conflicting dynamic updates.
    }

    override fun onAccessibilityEvent(event: AccessibilityEvent?) {
        if (event?.eventType != AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED) return

        val now = System.currentTimeMillis()

        // ── Task-based focus state ────────────────────────────────────────────
        var focusActive = prefs.getBoolean(PREF_FOCUS_ON, false)
        if (focusActive) {
            val endMs = prefs.getLong("task_end_ms", 0L)
            if (endMs > 0L && now > endMs) {
                // Native authority: task expired but JS didn't clean up — self-correct.
                prefs.edit().putBoolean(PREF_FOCUS_ON, false).apply()
                focusActive = false
                lastBlockedPkg = null
            }
        }

        // ── Standalone block state ────────────────────────────────────────────
        var saActive = prefs.getBoolean(PREF_SA_ACTIVE, false)
        if (saActive) {
            val untilMs = prefs.getLong(PREF_SA_UNTIL, 0L)
            if (untilMs > 0L && now > untilMs) {
                // Standalone block expired — self-correct.
                prefs.edit().putBoolean(PREF_SA_ACTIVE, false).apply()
                saActive = false
            }
        }

        val pkg = event.packageName?.toString() ?: return

        // Never block our own app or any always-allowed system package.
        if (pkg == packageName) return
        if (ALWAYS_ALLOWED.any { pkg.equals(it, ignoreCase = true) }) return

        // Package installer is permanently blocked regardless of any session state.
        // Check this before the early-exit below so it is always enforced.
        if (ALWAYS_BLOCKED.any { pkg.equals(it, ignoreCase = true) }) {
            val samePackage = pkg == lastBlockedPkg
            val cooldownExpired = (now - lastBlockedAtMs) > 2_000L
            if (!samePackage || cooldownExpired) {
                lastBlockedPkg = pkg
                lastBlockedAtMs = now
                handleBlockedApp(pkg)
            }
            return
        }

        // If neither session is active, nothing further to enforce.
        if (!focusActive && !saActive) {
            lastBlockedPkg = null
            return
        }

        val isBlocked = isPackageBlocked(pkg, focusActive, saActive)

        if (isBlocked) {
            // Rate-limit: only re-block the same package if it's been at least 2s since
            // the last block action, or if it's a different package. This prevents the
            // enforcement from firing hundreds of times during a transition animation.
            val samePackage = pkg == lastBlockedPkg
            val cooldownExpired = (now - lastBlockedAtMs) > 2_000L
            if (!samePackage || cooldownExpired) {
                lastBlockedPkg = pkg
                lastBlockedAtMs = now
                handleBlockedApp(pkg)
            }
        } else {
            lastBlockedPkg = null
        }
    }

    override fun onInterrupt() {
        lastBlockedPkg = null
    }

    // ─── Block determination ──────────────────────────────────────────────────

    private fun isPackageBlocked(pkg: String, focusActive: Boolean, saActive: Boolean): Boolean {
        // 1. Always-blocked installers — permanently blocked regardless of focus/standalone state.
        // This prevents users from installing/uninstalling apps while any block is active,
        // and also permanently prevents bypassing the block by uninstalling the app.
        if (ALWAYS_BLOCKED.any { pkg.equals(it, ignoreCase = true) }) {
            return true
        }

        // 2. Task-based block: block any app NOT in the allowed list
        if (focusActive) {
            val allowedJson = prefs.getString(PREF_ALLOWED_PKG, "[]") ?: "[]"
            val allowedList = parseJsonArray(allowedJson)
            val isAllowed = allowedList.any { a -> pkg.equals(a, ignoreCase = true) }
            if (!isAllowed) return true
        }

        // 3. Standalone block: block any app explicitly listed
        if (saActive) {
            val saJson = prefs.getString(PREF_SA_PKGS, "[]") ?: "[]"
            val saList = parseJsonArray(saJson)
            if (saList.any { b -> pkg.equals(b, ignoreCase = true) }) return true
        }

        return false
    }

    // ─── Enforcement ─────────────────────────────────────────────────────────

    private fun handleBlockedApp(blockedPackage: String) {
        // 1. Notify JS via broadcast → FocusDayBridgeModule → "APP_BLOCKED" event
        //    JS uses this to show a "blocked" overlay/toast in the app UI.
        val broadcast = Intent(FocusDayBridgeModule.ACTION_APP_BLOCKED).apply {
            `package` = packageName
            putExtra(FocusDayBridgeModule.EXTRA_BLOCKED_PKG, blockedPackage)
        }
        sendBroadcast(broadcast)

        // 2. Press HOME to immediately exit the blocked app.
        //    performGlobalAction is the correct and reliable API for this — it works
        //    on all Android versions including Samsung One UI.
        //
        //    Note: Do NOT call startActivity() here to open FocusFlow after pressing home.
        //    Android 10+ blocks background activity starts from services (including
        //    Accessibility Services). The call would fail silently and on older Android
        //    it would confusingly pull FocusFlow over the home screen.
        performGlobalAction(GLOBAL_ACTION_HOME)
    }

    // ─── JSON helper ──────────────────────────────────────────────────────────

    private fun parseJsonArray(json: String): List<String> {
        return try {
            val arr = org.json.JSONArray(json)
            (0 until arr.length()).map { arr.getString(it) }
        } catch (_: Exception) {
            emptyList()
        }
    }
}
