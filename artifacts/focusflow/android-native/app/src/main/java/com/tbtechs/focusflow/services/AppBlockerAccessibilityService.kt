package com.tbtechs.focusflow.services

import android.accessibilityservice.AccessibilityService
import android.content.Intent
import android.content.SharedPreferences
import android.os.Handler
import android.os.Looper
import android.view.accessibility.AccessibilityEvent
import android.view.accessibility.AccessibilityNodeInfo
import com.tbtechs.focusflow.modules.FocusDayBridgeModule

/**
 * AppBlockerAccessibilityService
 *
 * Listens for window-state-changed events and enforces two independent blocking systems:
 *
 *   1. TASK-BASED BLOCK (focus_active = true)
 *      - Blocks any app NOT in the "allowed_packages" list.
 *      - System UI, launchers, phone/dialer are ALWAYS allowed (see ALWAYS_ALLOWED).
 *      - Settings is ALWAYS_ALLOWED but specific sub-pages (accessibility settings,
 *        clear data dialogs, date/time) are intercepted and dismissed during focus.
 *      - Cleared automatically when task_end_ms is passed (native time authority).
 *
 *   2. STANDALONE BLOCK (standalone_block_active = true)
 *      - Blocks specific apps listed in "standalone_blocked_packages".
 *      - Independent of any task — stays active until standalone_block_until_ms.
 *      - Cleared automatically when the expiry timestamp is passed.
 *
 *   3. DAILY ALLOWANCE (daily_allowance_packages JSON array)
 *      - Apps listed here are allowed ONCE per calendar day during any blocking session.
 *      - After the first open each day, subsequent opens are blocked.
 *      - The usage counter resets at midnight automatically.
 *
 * When BOTH task + standalone are active, enforcement is additive (union).
 *
 * Retry mechanism: when a blocked app is detected, up to 5 re-checks are scheduled
 * at 300 ms intervals to catch apps that relaunch themselves after being dismissed.
 *
 * SharedPreferences file: "focusday_prefs"
 * Keys:
 *   focus_active                 Boolean  — task focus is running
 *   allowed_packages             String   — JSON array of packages allowed during task focus
 *   task_end_ms                  Long     — task session end epoch ms
 *   standalone_block_active      Boolean  — standalone block is enabled
 *   standalone_blocked_packages  String   — JSON array of packages to always block
 *   standalone_block_until_ms    Long     — standalone block expiry epoch ms
 *   daily_allowance_packages     String   — JSON array of packages with once-per-day allowance
 *   daily_allowance_used         String   — JSON object {pkg: "YYYY-MM-DD"} last-used dates
 */
class AppBlockerAccessibilityService : AccessibilityService() {

    companion object {
        const val PREFS_NAME       = "focusday_prefs"
        const val PREF_ALLOWED_PKG = "allowed_packages"
        const val PREF_FOCUS_ON    = "focus_active"

        const val PREF_SA_ACTIVE   = "standalone_block_active"
        const val PREF_SA_PKGS     = "standalone_blocked_packages"
        const val PREF_SA_UNTIL    = "standalone_block_until_ms"

        const val PREF_DAILY_ALLOWANCE_PKGS  = "daily_allowance_packages"
        const val PREF_DAILY_ALLOWANCE_USED  = "daily_allowance_used"

        /**
         * Packages that are NEVER blocked regardless of focus or standalone settings.
         *
         * This must include every launcher / home screen variant and system-critical
         * packages. Without this, pressing HOME sends the user to the launcher which
         * then fires a TYPE_WINDOW_STATE_CHANGED event — the service would immediately
         * block the launcher too, causing an infinite HOME-press loop.
         *
         * Settings is included here but specific sub-pages are intercepted separately.
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
            // Specific dangerous sub-pages are blocked via content inspection below.
            "com.android.settings",
            "com.samsung.android.app.settings",
            "com.samsung.android.settings"
        )

        val ALWAYS_BLOCKED: Set<String> = emptySet()

        /**
         * Package names for Android system package installers and uninstallers across OEMs.
         */
        val INSTALLER_PACKAGES: Set<String> = setOf(
            "com.android.packageinstaller",
            "com.google.android.packageinstaller",
            "com.samsung.android.packageinstaller",
            "com.miui.packageinstaller",
            "com.coloros.packageinstaller",
            "com.oppo.packageinstaller",
            "com.oneplus.packageinstaller",
            "com.huawei.appmarket",
            "com.huawei.packageinstaller",
            "com.bbk.packageinstaller",
            "com.vivo.packageinstaller",
            "com.android.uninstaller",
        )

        /** Max number of rapid re-check attempts after a block dismissal. */
        private const val MAX_RETRY_ATTEMPTS = 5
        /** Interval between retry checks in milliseconds. */
        private const val RETRY_INTERVAL_MS = 300L
    }

    private lateinit var prefs: SharedPreferences
    private var lastBlockedPkg: String? = null
    private var lastBlockedAtMs: Long = 0L

    // Handler for retry re-checks — runs on main thread (same thread as accessibility events)
    private val handler = Handler(Looper.getMainLooper())

    override fun onServiceConnected() {
        prefs = getSharedPreferences(PREFS_NAME, MODE_PRIVATE)
    }

    override fun onAccessibilityEvent(event: AccessibilityEvent?) {
        if (event?.eventType != AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED) return

        val now = System.currentTimeMillis()

        // ── Task-based focus state ────────────────────────────────────────────
        var focusActive = prefs.getBoolean(PREF_FOCUS_ON, false)
        if (focusActive) {
            val endMs = prefs.getLong("task_end_ms", 0L)
            if (endMs > 0L && now > endMs) {
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
                prefs.edit().putBoolean(PREF_SA_ACTIVE, false).apply()
                saActive = false
            }
        }

        val pkg = event.packageName?.toString() ?: return

        // Never block our own app.
        if (pkg == packageName) return

        // ── ALWAYS_ALLOWED packages ───────────────────────────────────────────
        // Settings is always allowed at the package level but we intercept dangerous
        // sub-pages (accessibility settings, clear data, date/time) during focus.
        if (ALWAYS_ALLOWED.any { pkg.equals(it, ignoreCase = true) }) {
            if (focusActive || saActive) {
                // Block uninstall dialogs
                if (isUninstallDialog(event)) {
                    performGlobalAction(GLOBAL_ACTION_BACK)
                    return
                }
                // Block accessibility settings to prevent disabling this service mid-session.
                if (isAccessibilitySettingsPage(event)) {
                    performGlobalAction(GLOBAL_ACTION_BACK)
                    return
                }
                // Block "Clear data / Clear storage" dialogs in Settings during any block session.
                if (isClearDataDialog(event)) {
                    performGlobalAction(GLOBAL_ACTION_BACK)
                    return
                }
                // Block date/time settings to prevent clock manipulation.
                if (isDateTimeSettingsPage(event)) {
                    performGlobalAction(GLOBAL_ACTION_BACK)
                    return
                }
                // Block Usage Access settings to prevent revoking usage permission.
                if (isUsageAccessSettingsPage(event)) {
                    performGlobalAction(GLOBAL_ACTION_BACK)
                    return
                }
                // Block Battery Optimization settings to prevent killing the blocking service.
                if (isBatteryOptimizationSettingsPage(event)) {
                    performGlobalAction(GLOBAL_ACTION_BACK)
                    return
                }
                // Block Device Admin settings to prevent deactivating admin rights.
                if (isDeviceAdminSettingsPage(event)) {
                    performGlobalAction(GLOBAL_ACTION_BACK)
                    return
                }
                // Block Developer Options to prevent ADB, "Don't keep activities", etc.
                if (isDeveloperOptionsPage(event)) {
                    performGlobalAction(GLOBAL_ACTION_BACK)
                    return
                }
            }
            return
        }

        // Google Play Store — uninstall dialogs are always allowed through.
        if (pkg == "com.android.vending" && (focusActive || saActive) && isUninstallDialog(event)) {
            return
        }

        // ALWAYS_BLOCKED is now empty — kept for safety.
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

        // ── Daily allowance check ─────────────────────────────────────────────
        // If the package is in the daily allowance list and hasn't been used today yet,
        // allow it through and mark it as used.
        if (isDailyAllowanceApp(pkg)) {
            if (!hasDailyAllowanceBeenUsed(pkg)) {
                markDailyAllowanceUsed(pkg)
                lastBlockedPkg = null
                return // Allowed — first use today
            }
            // Already used today — fall through to normal block logic
        }

        val isBlocked = isPackageBlocked(pkg, focusActive, saActive)

        if (isBlocked) {
            val samePackage = pkg == lastBlockedPkg
            val cooldownExpired = (now - lastBlockedAtMs) > 2_000L
            if (!samePackage || cooldownExpired) {
                lastBlockedPkg = pkg
                lastBlockedAtMs = now
                handleBlockedApp(pkg)
                scheduleRetryCheck(pkg, 1, focusActive, saActive)
            }
        } else {
            lastBlockedPkg = null
        }
    }

    override fun onInterrupt() {
        lastBlockedPkg = null
    }

    // ─── Retry mechanism ──────────────────────────────────────────────────────

    /**
     * Schedules up to [MAX_RETRY_ATTEMPTS] re-checks at [RETRY_INTERVAL_MS] ms intervals
     * to catch apps that relaunch themselves after the initial dismissal.
     */
    private fun scheduleRetryCheck(pkg: String, attempt: Int, focusWasActive: Boolean, saWasActive: Boolean) {
        if (attempt > MAX_RETRY_ATTEMPTS) return
        handler.postDelayed({
            val now = System.currentTimeMillis()
            val focusActive = prefs.getBoolean(PREF_FOCUS_ON, false)
            val saActive = prefs.getBoolean(PREF_SA_ACTIVE, false)
            if (!focusActive && !saActive) return@postDelayed
            val isBlocked = isPackageBlocked(pkg, focusActive, saActive)
            if (isBlocked && !isDailyAllowanceApp(pkg)) {
                dismissPackage(pkg)
                scheduleRetryCheck(pkg, attempt + 1, focusActive, saActive)
            }
        }, RETRY_INTERVAL_MS * attempt)
    }

    // ─── Uninstall dialog detection ───────────────────────────────────────────

    private fun isUninstallDialog(event: AccessibilityEvent): Boolean {
        val keywords = listOf("uninstall", "remove app", "delete app")
        val eventText = buildString {
            event.text.forEach { append(it); append(' ') }
            event.contentDescription?.let { append(it) }
        }.lowercase()
        if (keywords.any { it in eventText }) return true
        val root = event.source ?: return false
        return try {
            val nodeText = collectNodeText(root).lowercase()
            keywords.any { it in nodeText }
        } finally {
            root.recycle()
        }
    }

    // ─── Settings sub-page detection ─────────────────────────────────────────

    /**
     * Returns true when the event represents Android's Accessibility Settings page.
     * Covers AOSP, Samsung One UI, MIUI, OPPO/ColorOS, and Vivo class name variants.
     */
    private fun isAccessibilitySettingsPage(event: AccessibilityEvent): Boolean {
        val className = event.className?.toString()?.lowercase() ?: ""
        val classKeywords = listOf(
            // AOSP / Pixel
            "accessibilitysettings",
            "accessibilityservicesettings",
            "toggleaccessibilityservicepreferencefragment",
            // Samsung One UI
            "com.samsung.android.settings.accessibility",
            "samsungaccessibility",
            // MIUI
            "miuiaccessibility",
            "com.miui.accessibility",
            // OPPO / ColorOS / Realme
            "oppoaccessibility",
            "coloros.settings.accessibility",
            // Vivo / FuntouchOS
            "vivoaccessibility"
        )
        if (classKeywords.any { it in className }) return true

        val eventText = buildString {
            event.text.forEach { append(it); append(' ') }
        }.lowercase()
        return "downloaded apps" in eventText && "accessibility" in eventText
    }

    /**
     * Returns true when the event represents a "Clear data" or "Clear storage" dialog
     * in Android Settings — prevents the user from clearing FocusFlow data mid-session.
     */
    private fun isClearDataDialog(event: AccessibilityEvent): Boolean {
        val keywords = listOf("clear data", "clear storage", "clear cache", "clear app data")
        val eventText = buildString {
            event.text.forEach { append(it); append(' ') }
            event.contentDescription?.let { append(it) }
        }.lowercase()
        if (keywords.any { it in eventText }) return true

        val root = event.source ?: return false
        return try {
            val nodeText = collectNodeText(root).lowercase()
            keywords.any { it in nodeText }
        } finally {
            root.recycle()
        }
    }

    /**
     * Returns true when the user navigated to the Date & Time settings page.
     * Detects by class name and page title text.
     */
    private fun isDateTimeSettingsPage(event: AccessibilityEvent): Boolean {
        val className = event.className?.toString()?.lowercase() ?: ""
        if ("datetime" in className || "timesettings" in className || "datesettings" in className) return true

        val eventText = buildString {
            event.text.forEach { append(it); append(' ') }
        }.lowercase()
        val keywords = listOf("set date", "set time", "date & time", "date and time", "automatic date")
        return keywords.any { it in eventText }
    }

    /**
     * Returns true when the user navigated to the Usage Access (Usage Stats) settings page.
     * Covers AOSP, Samsung One UI, MIUI, and OPPO/ColorOS class name variants.
     */
    private fun isUsageAccessSettingsPage(event: AccessibilityEvent): Boolean {
        val className = event.className?.toString()?.lowercase() ?: ""
        val classKeywords = listOf(
            // AOSP / Pixel
            "usageaccesssettings",
            "usagestatssettings",
            "appopsdetail",
            // Samsung One UI
            "com.samsung.android.settings.usage",
            "samsungusageaccess",
            // MIUI
            "com.miui.permcenter.permissions",
            "miuiusageaccess",
            // OPPO / ColorOS / Realme
            "coloros.settings.usagestats",
            "oppoappmanager",
            // Vivo
            "vivo.permission.usagestats"
        )
        if (classKeywords.any { it in className }) return true

        val eventText = buildString {
            event.text.forEach { append(it); append(' ') }
        }.lowercase()
        val keywords = listOf(
            "usage access",
            "usage stats",
            "permitted usage access",
            "apps with usage access"
        )
        return keywords.any { it in eventText }
    }

    /**
     * Returns true when the user navigated to Battery Optimization settings.
     * Only matches specific multi-word battery phrases to avoid false positives on generic
     * app-info pages that contain words like "unrestricted" or "background activity".
     * Covers AOSP, Samsung One UI, MIUI, OPPO/ColorOS, and Vivo class name variants.
     */
    private fun isBatteryOptimizationSettingsPage(event: AccessibilityEvent): Boolean {
        val className = event.className?.toString()?.lowercase() ?: ""
        val classKeywords = listOf(
            // AOSP / Pixel
            "batteryoptimization",
            "highpowerapps",
            "ignoreoptimizationsettings",
            // Samsung One UI
            "com.samsung.android.settings.battery",
            "samsungbatteryoptimization",
            "powersavingdetail",
            // MIUI
            "com.miui.powercenter",
            "miuibatteryoptimization",
            "miuipowersaver",
            // OPPO / ColorOS / Realme
            "coloros.settings.battery",
            "oppopowerconsumption",
            // Vivo / FuntouchOS
            "vivo.battery",
            "vivohighconsumption"
        )
        if (classKeywords.any { it in className }) return true

        val eventText = buildString {
            event.text.forEach { append(it); append(' ') }
        }.lowercase()
        // Only use specific multi-word phrases — avoids false positives on generic app-info pages
        val keywords = listOf(
            "battery optimization",
            "optimize battery usage",
            "optimizing battery",
            "battery optimiz"
        )
        return keywords.any { it in eventText }
    }

    /**
     * Returns true when the user navigated to Device Admin settings.
     * Covers AOSP, Samsung One UI, MIUI, and OPPO/ColorOS class name variants.
     */
    private fun isDeviceAdminSettingsPage(event: AccessibilityEvent): Boolean {
        val className = event.className?.toString()?.lowercase() ?: ""
        val classKeywords = listOf(
            // AOSP / Pixel
            "deviceadminsettings",
            "deviceadmininfo",
            "deviceadmin",
            "devicepolicysettings",
            // Samsung One UI
            "com.samsung.android.settings.deviceadmin",
            "samsungdeviceadmin",
            // MIUI
            "com.miui.deviceadmin",
            "miuideviceadmin",
            // OPPO / ColorOS
            "coloros.settings.deviceadmin"
        )
        if (classKeywords.any { it in className }) return true

        val eventText = buildString {
            event.text.forEach { append(it); append(' ') }
        }.lowercase()
        val keywords = listOf(
            "device admin",
            "device administrator",
            "deactivate device admin",
            "remove device admin",
            "active device admin"
        )
        return keywords.any { it in eventText }
    }

    /**
     * Returns true when the user navigated to Developer Options.
     * This page allows ADB debugging, "Don't keep activities", and other settings
     * that can be used to bypass or kill the blocking service mid-session.
     * Covers AOSP, Samsung One UI, MIUI, OPPO/ColorOS, and Vivo class name variants.
     */
    private fun isDeveloperOptionsPage(event: AccessibilityEvent): Boolean {
        val className = event.className?.toString()?.lowercase() ?: ""
        val classKeywords = listOf(
            // AOSP / Pixel
            "developmentsettings",
            "developmentsettingsdashboardfragment",
            "developeroptions",
            // Samsung One UI
            "com.samsung.android.settings.development",
            "samsungdeveloperoptions",
            // MIUI
            "com.android.settings.development",
            "miuideveloperoptions",
            // OPPO / ColorOS / Realme
            "coloros.settings.development",
            "oppodeveloperoptions",
            // Vivo / FuntouchOS
            "vivo.developeroptions"
        )
        if (classKeywords.any { it in className }) return true

        val eventText = buildString {
            event.text.forEach { append(it); append(' ') }
        }.lowercase()
        val keywords = listOf(
            "developer options",
            "usb debugging",
            "don't keep activities",
            "mock location",
            "running services",
            "background process limit"
        )
        return keywords.any { it in eventText }
    }

    // ─── Daily allowance helpers ──────────────────────────────────────────────

    private fun isDailyAllowanceApp(pkg: String): Boolean {
        val json = prefs.getString(PREF_DAILY_ALLOWANCE_PKGS, "[]") ?: "[]"
        val list = parseJsonArray(json)
        return list.any { it.equals(pkg, ignoreCase = true) }
    }

    private fun hasDailyAllowanceBeenUsed(pkg: String): Boolean {
        val today = todayDateString()
        val usedJson = prefs.getString(PREF_DAILY_ALLOWANCE_USED, "{}") ?: "{}"
        return try {
            val obj = org.json.JSONObject(usedJson)
            obj.optString(pkg, "") == today
        } catch (_: Exception) {
            false
        }
    }

    private fun markDailyAllowanceUsed(pkg: String) {
        val today = todayDateString()
        val usedJson = prefs.getString(PREF_DAILY_ALLOWANCE_USED, "{}") ?: "{}"
        try {
            val obj = org.json.JSONObject(usedJson)
            obj.put(pkg, today)
            prefs.edit().putString(PREF_DAILY_ALLOWANCE_USED, obj.toString()).apply()
        } catch (_: Exception) {}
    }

    private fun todayDateString(): String {
        val cal = java.util.Calendar.getInstance()
        return "${cal.get(java.util.Calendar.YEAR)}-${cal.get(java.util.Calendar.MONTH) + 1}-${cal.get(java.util.Calendar.DAY_OF_MONTH)}"
    }

    // ─── Block determination ──────────────────────────────────────────────────

    private fun isPackageBlocked(pkg: String, focusActive: Boolean, saActive: Boolean): Boolean {
        if (ALWAYS_BLOCKED.any { pkg.equals(it, ignoreCase = true) }) return true

        if (focusActive || saActive) {
            if (INSTALLER_PACKAGES.any { pkg.equals(it, ignoreCase = true) }) return true
        }

        if (focusActive) {
            val allowedJson = prefs.getString(PREF_ALLOWED_PKG, "[]") ?: "[]"
            val allowedList = parseJsonArray(allowedJson)
            if (allowedList.isNotEmpty()) {
                val isAllowed = allowedList.any { a -> pkg.equals(a, ignoreCase = true) }
                if (!isAllowed) return true
            }
        }

        if (saActive) {
            val saJson = prefs.getString(PREF_SA_PKGS, "[]") ?: "[]"
            val saList = parseJsonArray(saJson)
            if (saList.any { b -> pkg.equals(b, ignoreCase = true) }) return true
        }

        return false
    }

    // ─── Enforcement ─────────────────────────────────────────────────────────

    private fun handleBlockedApp(blockedPackage: String) {
        val broadcast = Intent(FocusDayBridgeModule.ACTION_APP_BLOCKED).apply {
            `package` = packageName
            putExtra(FocusDayBridgeModule.EXTRA_BLOCKED_PKG, blockedPackage)
        }
        sendBroadcast(broadcast)
        dismissPackage(blockedPackage)
    }

    private fun dismissPackage(blockedPackage: String) {
        if (INSTALLER_PACKAGES.any { blockedPackage.equals(it, ignoreCase = true) }) {
            performGlobalAction(GLOBAL_ACTION_BACK)
        } else {
            performGlobalAction(GLOBAL_ACTION_HOME)
        }
    }

    // ─── Node text collector ──────────────────────────────────────────────────

    private fun collectNodeText(root: AccessibilityNodeInfo): String {
        return buildString {
            fun walk(node: AccessibilityNodeInfo) {
                node.text?.let { append(it); append(' ') }
                node.contentDescription?.let { append(it); append(' ') }
                for (i in 0 until node.childCount) {
                    node.getChild(i)?.let { child ->
                        walk(child)
                        child.recycle()
                    }
                }
            }
            walk(root)
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
