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

        /**
         * Package names for Android system package installers and uninstallers across OEMs.
         *
         * When any blocking session is active (task focus OR standalone block), opening any
         * of these packages is intercepted and dismissed with BACK (not just HOME) so that
         * the install/uninstall confirmation dialog is dismissed rather than left pending.
         *
         * Why BACK and not HOME?
         *   HOME sends the user to the launcher but leaves the installer dialog in the back
         *   stack. On some devices the user can resume it. BACK dismisses the dialog
         *   cleanly, ensuring the install/uninstall action never completes.
         *
         * Note: Silent Play Store background installs cannot be blocked via Accessibility —
         * they produce no visible window event. The user should also block com.android.vending
         * in their allowed-apps / block schedule list if they want to prevent manual triggers.
         */
        val INSTALLER_PACKAGES: Set<String> = setOf(
            // AOSP package installer (sideload APKs)
            "com.android.packageinstaller",
            // Google's variant (Pixel, stock Android 8+)
            "com.google.android.packageinstaller",
            // Samsung One UI
            "com.samsung.android.packageinstaller",
            // MIUI (Xiaomi)
            "com.miui.packageinstaller",
            // ColorOS (OPPO / Realme)
            "com.coloros.packageinstaller",
            "com.oppo.packageinstaller",
            // OnePlus OxygenOS
            "com.oneplus.packageinstaller",
            // Huawei EMUI / HarmonyOS
            "com.huawei.appmarket",
            "com.huawei.packageinstaller",
            // Vivo FuntouchOS
            "com.bbk.packageinstaller",
            "com.vivo.packageinstaller",
            // System uninstall dialog (Android 10+ routes uninstalls through this)
            "com.android.uninstaller",
        )
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

        // Never block our own app.
        if (pkg == packageName) return

        // ALWAYS_ALLOWED packages (launchers, settings) are normally passed through,
        // BUT they can host system uninstall confirmation dialogs.
        // On Samsung One UI, long-pressing an app icon → Uninstall fires a
        // TYPE_WINDOW_STATE_CHANGED event with packageName = com.sec.android.app.launcher.
        // On stock Android, Settings → App Info → Uninstall fires with
        // packageName = com.android.settings.
        // Both are ALWAYS_ALLOWED, so we must intercept them here based on dialog
        // content rather than package name.
        if (ALWAYS_ALLOWED.any { pkg.equals(it, ignoreCase = true) }) {
            if ((focusActive || saActive) && isUninstallDialog(event)) {
                performGlobalAction(GLOBAL_ACTION_BACK)
            }
            return
        }

        // ALWAYS_BLOCKED is now empty — this block is a no-op but kept for safety.
        // Previously used to permanently block package installers; user now controls this.
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
        // 1. ALWAYS_BLOCKED is empty — no-op, kept for API stability.
        if (ALWAYS_BLOCKED.any { pkg.equals(it, ignoreCase = true) }) {
            return true
        }

        // 2. Installer/uninstaller packages — blocked whenever ANY session is active.
        //    DISALLOW_INSTALL_APPS / DISALLOW_UNINSTALL_APPS via Device Admin requires
        //    Device Owner (unachievable for a sideloaded app), so Accessibility is the
        //    only reliable enforcement layer. We intercept the installer window before
        //    the user can tap "Install" or "Uninstall" and dismiss it with BACK.
        if (focusActive || saActive) {
            if (INSTALLER_PACKAGES.any { pkg.equals(it, ignoreCase = true) }) {
                return true
            }
        }

        // 3. Task-based block: block any app NOT in the allowed list
        if (focusActive) {
            val allowedJson = prefs.getString(PREF_ALLOWED_PKG, "[]") ?: "[]"
            val allowedList = parseJsonArray(allowedJson)
            val isAllowed = allowedList.any { a -> pkg.equals(a, ignoreCase = true) }
            if (!isAllowed) return true
        }

        // 4. Standalone block: block any app explicitly listed
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

        // 2. Choose the dismissal action based on the blocked package.
        //
        //    Installer/uninstaller packages show a confirmation dialog (a new Activity
        //    on the back stack). If we press HOME the dialog stays in the back stack
        //    and the user can resume it from Recents. Pressing BACK dismisses the dialog
        //    cleanly so the install/uninstall never completes.
        //
        //    For all other blocked apps HOME is correct — pressing BACK could close
        //    FocusFlow's own task if it was previously in the back stack.
        //
        //    Note: Do NOT call startActivity() here. Android 10+ blocks background
        //    activity starts from Accessibility Services.
        if (INSTALLER_PACKAGES.any { blockedPackage.equals(it, ignoreCase = true) }) {
            performGlobalAction(GLOBAL_ACTION_BACK)
        } else {
            performGlobalAction(GLOBAL_ACTION_HOME)
        }
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
