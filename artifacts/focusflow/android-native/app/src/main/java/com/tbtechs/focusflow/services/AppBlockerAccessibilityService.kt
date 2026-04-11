package com.tbtechs.focusflow.services

import android.accessibilityservice.AccessibilityService
import android.animation.ValueAnimator
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.WallpaperManager
import android.content.Intent
import android.content.SharedPreferences
import android.graphics.BitmapFactory
import android.graphics.Color
import android.graphics.PixelFormat
import android.graphics.drawable.GradientDrawable
import android.net.VpnService
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.provider.Settings
import android.view.Gravity
import android.view.WindowManager
import android.view.accessibility.AccessibilityEvent
import android.view.accessibility.AccessibilityNodeInfo
import android.widget.FrameLayout
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.TextView
import com.tbtechs.focusflow.modules.BlockOverlayModule
import com.tbtechs.focusflow.modules.FocusDayBridgeModule
import com.tbtechs.focusflow.services.BlockOverlayActivity
import com.tbtechs.focusflow.services.NetworkBlockerVpnService
import org.json.JSONArray

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

        const val PREF_DAILY_ALLOWANCE_CONFIG = "daily_allowance_config"   // rich JSON config (new)
        const val PREF_DAILY_ALLOWANCE_PKGS  = "daily_allowance_packages"  // legacy — no longer written
        const val PREF_DAILY_ALLOWANCE_USED  = "daily_allowance_used"

        const val PREF_BLOCKED_WORDS = "blocked_words"

        /** Notification channel used to launch the block overlay via full-screen intent. */
        private const val BLOCK_ALERT_CHANNEL  = "focusday_block_alert"
        private const val BLOCK_ALERT_NOTIF_ID = 9001

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

        /**
         * Packages that can NEVER be blocked, regardless of any user setting.
         * These are safety-critical (emergency calls) or communication essentials
         * (WhatsApp). Users cannot add these to any blocked list — they are always
         * passed through unconditionally before any other check.
         */
        val NEVER_BLOCK: Set<String> = setOf(
            // ── Emergency / in-call UI ────────────────────────────────────────
            "com.android.phone",                       // AOSP telephony
            "com.android.dialer",                      // AOSP dialer
            "com.google.android.dialer",               // Pixel / Google dialer
            "com.android.emergencydialer",             // Emergency dialer (any OEM)
            "com.google.android.incallui",             // Google in-call UI
            // Samsung
            "com.samsung.android.app.telephonyui",
            "com.samsung.android.incallui",
            "com.sec.android.app.dialertab",
            // Xiaomi / MIUI
            "com.miui.dialer",
            "com.xiaomi.phone",
            // OnePlus / OxygenOS
            "com.oneplus.dialer",
            "com.oneplus.incallui",
            // Huawei / EMUI
            "com.huawei.phone",
            "com.huawei.incallui",
            // Oppo / ColorOS
            "com.coloros.dialer",
            "com.oppo.phone",
            "com.oppo.incallui",
            // Vivo / FuntouchOS
            "com.vivo.phone",
            "com.vivo.incallui",
            // Realme
            "com.realme.phone",
            // Motorola
            "com.motorola.phone",
            "com.motorola.incallui",
            // LG
            "com.lge.phone",
            "com.lge.incallui",
            // Sony
            "com.sonyericsson.android.phone",
            "com.sony.incallui",
            // Nokia
            "com.nokia.phone",
            // HTC
            "com.htc.phone",
            // ZTE / Blade
            "com.android.contacts",                    // default contacts (dialer link)
            // ── WhatsApp (messaging / calls) ─────────────────────────────────
            "com.whatsapp",
            "com.whatsapp.w4b",                        // WhatsApp Business
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

    /** Data class parsed from the daily_allowance_config JSON. */
    private data class AllowanceEntry(
        val pkg: String,
        val mode: String,         // "count" | "time_budget" | "interval"
        val countPerDay: Int,
        val budgetMs: Long,       // time_budget: total ms per day
        val intervalMs: Long,     // interval: ms allowed per window
        val windowMs: Long,       // interval: window size in ms
    )

    private lateinit var prefs: SharedPreferences
    private var lastBlockedPkg: String? = null
    private var lastBlockedAtMs: Long = 0L

    // Tracks the most recently seen foreground package so retries can verify
    // the blocked app is still in the foreground before pressing Home again.
    private var lastSeenPkg: String? = null

    // ── WindowManager overlay (TYPE_APPLICATION_OVERLAY path) ────────────────
    // Used when SYSTEM_ALERT_WINDOW is granted — draws directly over any app
    // without switching tasks, so the blocked app is never visually accessible.
    private var wOverlayView: FrameLayout? = null
    private var wOverlayXBtn: TextView? = null
    private var wOverlayNavRow: LinearLayout? = null
    private var wOverlayXRevealed = false

    // Handler for retry re-checks AND timed-allowance expiry — runs on main thread
    private val handler = Handler(Looper.getMainLooper())

    // ── Timed allowance tracking (time_budget / interval modes) ──────────────
    // Tracks the app currently open under a time-limited allowance so we can
    // accumulate usage time when the user switches away to another app.
    private var currentTimedPkg: String? = null
    private var currentTimedOpenAtMs: Long = 0L
    private var currentTimedSessionEndMs: Long = 0L
    private var timedExpireRunnable: Runnable? = null

    override fun onServiceConnected() {
        prefs = getSharedPreferences(PREFS_NAME, MODE_PRIVATE)
    }

    override fun onAccessibilityEvent(event: AccessibilityEvent?) {
        if (event == null) return

        // ── Multi-window / split-screen: scan ALL visible windows ────────────
        // TYPE_WINDOWS_CHANGED fires when a new window appears (split pane, overlay,
        // PiP frame, etc.). A blocked app may enter the foreground this way without
        // ever becoming the "primary" window that triggers STATE_CHANGED.
        if (event.eventType == AccessibilityEvent.TYPE_WINDOWS_CHANGED) {
            checkWindowsForBlockedApps()
            return
        }

        if (event.eventType != AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED) return

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

        // ── Cooldown reset: fired when user taps ✕ to dismiss the overlay ───
        // BlockOverlayActivity writes this flag on intentional dismiss so the
        // next open of the same blocked app is caught immediately (no 2 s gap).
        if (prefs.getBoolean("block_cooldown_reset", false)) {
            prefs.edit().putBoolean("block_cooldown_reset", false).apply()
            lastBlockedPkg = null
            lastBlockedAtMs = 0L
        }

        val pkg = event.packageName?.toString() ?: return

        // Update foreground package tracker so retries can guard against
        // pressing Home when the user has already switched to an allowed app.
        lastSeenPkg = pkg

        // Persist current foreground package so BlockOverlayActivity can check
        // whether the user navigated to our own app (settings) and skip re-raise.
        prefs.edit().putString("current_foreground_pkg", pkg).apply()

        // ── Timed allowance: accumulate usage when user switches away ─────────
        // If the user was in a time-limited allowed app and just switched to a
        // different app, record elapsed time before continuing with other checks.
        if (currentTimedPkg != null && currentTimedPkg != pkg) {
            val prevEntry = findAllowanceEntry(currentTimedPkg!!)
            if (prevEntry != null && (prevEntry.mode == "time_budget" || prevEntry.mode == "interval")) {
                accumulateTimedUsage(currentTimedPkg!!, prevEntry, currentTimedOpenAtMs)
            }
            timedExpireRunnable?.let { handler.removeCallbacks(it) }
            timedExpireRunnable = null
            currentTimedPkg = null
            currentTimedOpenAtMs = 0L
            currentTimedSessionEndMs = 0L
        }

        // Never block our own app.  This guard MUST come before the overlay
        // X-button signal below — if our own overlay activity fires a window
        // event (e.g. coming to the foreground after the HOME press) we must
        // not mistake it for "the blocked app has left" and reveal the X early.
        if (pkg == packageName) return

        // ── Overlay X-button: signal when the blocked app leaves foreground ──
        // When the AccessibilityService presses HOME after blocking, the next
        // window event from a different package means the user is back at the
        // launcher.  At that point we set overlay_x_ready = true so the
        // BlockOverlayActivity can fade in its dismiss button.
        //
        // This check intentionally lives AFTER the packageName guard above so
        // our own overlay activity never triggers the X-ready signal.
        // It also lives BEFORE the ALWAYS_ALLOWED early-return below so that
        // the launcher (which is ALWAYS_ALLOWED) correctly triggers it after
        // the user presses HOME.
        val awaitingPkg = prefs.getString("overlay_awaiting_pkg", "") ?: ""
        if (awaitingPkg.isNotEmpty() && !pkg.equals(awaitingPkg, ignoreCase = true)) {
            prefs.edit()
                .putBoolean(BlockOverlayActivity.PREF_OVERLAY_X_READY, true)
                .putString("overlay_awaiting_pkg", "")
                .apply()
            // Also reveal directly on the WindowManager overlay (no polling needed)
            revealWindowXButton()
        }

        // ── NEVER_BLOCK packages ──────────────────────────────────────────────
        // Phone dialers (all OEM variants) and WhatsApp are unconditionally
        // allowed. No user setting, standalone block, or focus session can
        // override this. This check runs before ALWAYS_ALLOWED so that even
        // if a user somehow adds one of these packages to a block list, the
        // block is silently ignored.
        if (NEVER_BLOCK.any { pkg.equals(it, ignoreCase = true) }) {
            return
        }

        // ── ALWAYS_ALLOWED packages ───────────────────────────────────────────
        // Settings is always allowed at the package level but we intercept dangerous
        // sub-pages (accessibility settings, clear data, date/time) during focus.
        if (ALWAYS_ALLOWED.any { pkg.equals(it, ignoreCase = true) }) {

            // ── User explicit override ────────────────────────────────────────
            // If the user deliberately added an ALWAYS_ALLOWED package (e.g. Settings)
            // to their standalone blocked list or excluded it from their focus allowed
            // list, honour that choice and bypass the protection entirely.
            if (saActive) {
                val saJson = prefs.getString(PREF_SA_PKGS, "[]") ?: "[]"
                if (parseJsonArray(saJson).any { it.equals(pkg, ignoreCase = true) }) {
                    val samePackage = pkg == lastBlockedPkg
                    val cooldownExpired = (now - lastBlockedAtMs) > 2_000L
                    if (!samePackage || cooldownExpired) {
                        lastBlockedPkg = pkg
                        lastBlockedAtMs = now
                        handleBlockedApp(pkg)
                        scheduleRetryCheck(pkg, 1, focusActive, saActive)
                    }
                    return
                }
            }
            if (focusActive) {
                val allowedJson = prefs.getString(PREF_ALLOWED_PKG, "[]") ?: "[]"
                val allowedList = parseJsonArray(allowedJson)
                if (allowedList.isNotEmpty() && !allowedList.any { it.equals(pkg, ignoreCase = true) }) {
                    val samePackage = pkg == lastBlockedPkg
                    val cooldownExpired = (now - lastBlockedAtMs) > 2_000L
                    if (!samePackage || cooldownExpired) {
                        lastBlockedPkg = pkg
                        lastBlockedAtMs = now
                        handleBlockedApp(pkg)
                        scheduleRetryCheck(pkg, 1, focusActive, saActive)
                    }
                    return
                }
            }

            if (focusActive || saActive) {
                // Block uninstall dialogs — show overlay so user sees why they're blocked.
                if (isUninstallDialog(event)) {
                    handleBlockedApp(pkg)
                    return
                }
                // Block accessibility settings to prevent disabling this service mid-session.
                if (isAccessibilitySettingsPage(event)) {
                    handleBlockedApp(pkg)
                    return
                }
                // Block "Clear data / Clear storage" dialogs in Settings during any block session.
                if (isClearDataDialog(event)) {
                    handleBlockedApp(pkg)
                    return
                }
                // Block date/time settings to prevent clock manipulation.
                if (isDateTimeSettingsPage(event)) {
                    handleBlockedApp(pkg)
                    return
                }
                // Block Usage Access settings to prevent revoking usage permission.
                if (isUsageAccessSettingsPage(event)) {
                    handleBlockedApp(pkg)
                    return
                }
                // Block Battery Optimization settings to prevent killing the blocking service.
                if (isBatteryOptimizationSettingsPage(event)) {
                    handleBlockedApp(pkg)
                    return
                }
                // Block Device Admin settings to prevent deactivating admin rights.
                if (isDeviceAdminSettingsPage(event)) {
                    handleBlockedApp(pkg)
                    return
                }
                // Block Developer Options to prevent ADB, "Don't keep activities", etc.
                if (isDeveloperOptionsPage(event)) {
                    handleBlockedApp(pkg)
                    return
                }
                // Block Reset settings pages — would disable accessibility service or wipe the phone.
                if (isResetSettingsPage(event)) {
                    handleBlockedApp(pkg)
                    return
                }
                // Block Special Access page — gateway to device admin, overlay, usage access, etc.
                if (isSpecialAccessPage(event)) {
                    handleBlockedApp(pkg)
                    return
                }
                // Block FocusFlow's own App Info page — prevents the user from pressing
                // "Force Stop" on FocusFlow itself, which would kill the blocking service.
                if (isFocusFlowAppInfoPage(event)) {
                    handleBlockedApp(pkg)
                    return
                }
                // Block the App Info page for any currently blocked app — prevents
                // uninstalling blocked apps as a workaround during a session.
                if (isBlockedAppInfoPage(event, focusActive, saActive)) {
                    handleBlockedApp(pkg)
                    return
                }
            }
            return
        }

        // Google Play Store — uninstall dialogs are always allowed through.
        if (pkg == "com.android.vending" && (focusActive || saActive) && isUninstallDialog(event)) {
            return
        }

        // ── Word blocking ─────────────────────────────────────────────────────
        // During any active blocking session, if the current window content contains
        // a user-defined blocked word, show the overlay and redirect immediately.
        if (focusActive || saActive) {
            val blockedWords = getBlockedWords()
            if (blockedWords.isNotEmpty() && containsBlockedWord(event, blockedWords)) {
                handleBlockedApp(pkg)
                return
            }
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

        // ── Greyout Schedule check (time-window blocking, session-independent) ─
        // Works even when no focus session or standalone block is active — the user
        // pre-committed to blocking certain apps during specific hours and days.
        if (isInGreyoutWindow(pkg)) {
            val samePackage  = pkg == lastBlockedPkg
            val cooldownDone = (now - lastBlockedAtMs) > 2_000L
            if (!samePackage || cooldownDone) {
                lastBlockedPkg  = pkg
                lastBlockedAtMs = now
                handleBlockedApp(pkg)
                scheduleGreyoutRetryCheck(pkg, 1)
            }
            return
        }

        // If neither session is active, nothing further to enforce.
        if (!focusActive && !saActive) {
            lastBlockedPkg = null
            return
        }

        // ── Daily allowance check (count / time_budget / interval modes) ──────
        // Each app can have its own allowance mode. If the allowance is available,
        // let the app through and start tracking for time-based modes.
        //
        // CRITICAL: Only call recordAllowanceOpen on the FIRST event per foreground
        // session (i.e. when currentTimedPkg != pkg). Android fires many accessibility
        // events per session — recording on every one would:
        //   • count mode: exhaust opens in seconds instead of per true open
        //   • timed modes: push sessionEndMs forward on each event so the timer
        //     never fires, and reset currentTimedOpenAtMs so elapsed time is lost
        val allowanceEntry = findAllowanceEntry(pkg)
        if (allowanceEntry != null) {
            if (isAllowanceAvailable(pkg, allowanceEntry)) {
                if (currentTimedPkg != pkg) {
                    // App is newly in foreground — record this open and start tracking.
                    val sessionEndMs = recordAllowanceOpen(pkg, allowanceEntry)
                    currentTimedPkg = pkg
                    currentTimedOpenAtMs = System.currentTimeMillis()
                    if (allowanceEntry.mode != "count" && sessionEndMs > 0L) {
                        currentTimedSessionEndMs = sessionEndMs
                        scheduleTimedExpiry(pkg, sessionEndMs)
                    } else {
                        currentTimedSessionEndMs = 0L
                        timedExpireRunnable?.let { handler.removeCallbacks(it) }
                        timedExpireRunnable = null
                    }
                } else if (allowanceEntry.mode != "count" && currentTimedSessionEndMs > 0L && now >= currentTimedSessionEndMs) {
                    // Fallback: same app still in foreground but session has expired.
                    // handler.postDelayed may not have fired on this device (Doze / Samsung
                    // battery optimization). Enforce expiry on the next window event instead.
                    accumulateTimedUsage(pkg, allowanceEntry, currentTimedOpenAtMs)
                    timedExpireRunnable?.let { handler.removeCallbacks(it) }
                    timedExpireRunnable = null
                    currentTimedPkg = null
                    currentTimedOpenAtMs = 0L
                    currentTimedSessionEndMs = 0L
                    lastBlockedPkg = pkg
                    lastBlockedAtMs = now
                    handleBlockedApp(pkg)
                    scheduleRetryCheck(pkg, 1, focusActive, saActive)
                    return
                }
                // else: same app still in foreground and session not yet expired — let it through
                lastBlockedPkg = null
                return // Allowed — within allowance
            }
            // Allowance exhausted — always block during any active session.
            // This makes daily allowance act as a true "N opens then blocked" limit
            // regardless of whether the app is also in the explicit standalone block list.
            val samePackage = pkg == lastBlockedPkg
            val cooldownExpired = (now - lastBlockedAtMs) > 2_000L
            if (!samePackage || cooldownExpired) {
                lastBlockedPkg = pkg
                lastBlockedAtMs = now
                handleBlockedApp(pkg)
                scheduleRetryCheck(pkg, 1, focusActive, saActive)
            }
            return
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
        dismissWindowOverlay()
    }

    // ─── Multi-window / split-screen scan ─────────────────────────────────────

    /**
     * Scans ALL currently visible windows (split-screen panes, overlays, PiP frames)
     * for blocked packages and dismisses the first offender found.
     *
     * Called on TYPE_WINDOWS_CHANGED — fires when a new window appears or disappears
     * without necessarily triggering TYPE_WINDOW_STATE_CHANGED on the primary window.
     * This is the main escape route for split-screen: the blocked app can be placed in
     * the secondary pane while the primary pane stays on the launcher.
     */
    private fun checkWindowsForBlockedApps() {
        val focusActive = prefs.getBoolean(PREF_FOCUS_ON, false)
        val saActive = prefs.getBoolean(PREF_SA_ACTIVE, false)
        if (!focusActive && !saActive) return

        val now = System.currentTimeMillis()
        try {
            val allWindows = windows ?: return
            for (window in allWindows) {
                val root = window.root ?: continue
                try {
                    val pkg = root.packageName?.toString() ?: continue
                    if (pkg == packageName) continue
                    if (NEVER_BLOCK.any { it.equals(pkg, ignoreCase = true) }) continue
                    if (ALWAYS_ALLOWED.any { it.equals(pkg, ignoreCase = true) }) continue
                    // If app still has allowance quota, permit it through
                    val allowanceEntry = findAllowanceEntry(pkg)
                    if (allowanceEntry != null && isAllowanceAvailable(pkg, allowanceEntry)) continue
                    if (isPackageBlocked(pkg, focusActive, saActive)) {
                        val samePackage = pkg == lastBlockedPkg
                        val cooldownExpired = (now - lastBlockedAtMs) > 2_000L
                        if (!samePackage || cooldownExpired) {
                            lastBlockedPkg = pkg
                            lastBlockedAtMs = now
                            handleBlockedApp(pkg)
                        }
                        break // Dismiss one offender per event; next event handles any remaining
                    }
                } finally {
                    root.recycle()
                }
            }
        } catch (_: Exception) {}
    }

    // ─── Retry mechanism ──────────────────────────────────────────────────────

    /**
     * Schedules up to [MAX_RETRY_ATTEMPTS] re-checks at [RETRY_INTERVAL_MS] ms intervals
     * to catch apps that relaunch themselves after the initial dismissal.
     */
    private fun scheduleRetryCheck(pkg: String, attempt: Int, focusWasActive: Boolean, saWasActive: Boolean) {
        if (attempt > MAX_RETRY_ATTEMPTS) return
        handler.postDelayed({
            val focusActive = prefs.getBoolean(PREF_FOCUS_ON, false)
            val saActive = prefs.getBoolean(PREF_SA_ACTIVE, false)
            if (!focusActive && !saActive) return@postDelayed
            // Guard: only dismiss if the blocked package is still in the foreground.
            // Without this check, retries would press Home even after the user has
            // already navigated to a legitimate allowed app, causing false kicks.
            if (lastSeenPkg != pkg) return@postDelayed
            val isBlocked = isPackageBlocked(pkg, focusActive, saActive)
            if (isBlocked && findAllowanceEntry(pkg) == null) {
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
     *
     * Detection uses three layers in order:
     *   1. FocusFlow carve-out — allow the per-service toggle page for our own service.
     *   2. Class name matching — catches AOSP and OEM variants whose class name is reported.
     *   3. Node-tree content scan — fallback for Samsung and other OEMs that send a generic
     *      class name (e.g. SubSettings) but whose page content is identifiable:
     *        • Main Accessibility page contains "talkback" in its service list.
     *        • "Installed apps" sub-page (Samsung calls it this, not "Downloaded apps")
     *          contains accessibility service names such as "live transcribe" or the
     *          combination of "installed apps" + "focusflow".
     */
    private fun isAccessibilitySettingsPage(event: AccessibilityEvent): Boolean {
        val className = event.className?.toString()?.lowercase() ?: ""

        // ── 1. FocusFlow carve-out ────────────────────────────────────────────
        // If this is specifically the per-service detail/toggle page for FocusFlow,
        // allow it through so the user can always enable or re-enable our service.
        if ("toggleaccessibilityservicepreferencefragment" in className ||
            "accessibilityservicesettings" in className) {
            val combined = buildString {
                event.text.forEach { append(it); append(' ') }
                event.contentDescription?.let { append(it); append(' ') }
            }.lowercase()
            if ("focusflow" in combined || "com.tbtechs.focusflow" in combined) return false
            val carveRoot = event.source
            if (carveRoot != null) {
                val carveNodeText = try {
                    collectNodeText(carveRoot).lowercase()
                } finally {
                    carveRoot.recycle()
                }
                if ("focusflow" in carveNodeText || "com.tbtechs.focusflow" in carveNodeText) return false
            }
        }

        // ── 2. Class name detection ───────────────────────────────────────────
        val classKeywords = listOf(
            // AOSP / Pixel
            "accessibilitysettings",
            "accessibilityservicesettings",
            "toggleaccessibilityservicepreferencefragment",
            "accessibilityinstalledapps",
            "installedaccessibilityservice",
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

        // Event-text check: AOSP says "Downloaded apps", Samsung says "Installed apps"
        val eventText = buildString {
            event.text.forEach { append(it); append(' ') }
        }.lowercase()
        if (("downloaded apps" in eventText || "installed apps" in eventText) &&
            "accessibility" in eventText) return true

        // ── 3. Node-tree content scan (Samsung / generic-class fallback) ──────
        // Samsung devices often fire a generic SubSettings class name. We identify
        // the page by its actual on-screen content instead.
        //
        // The heuristic requires TWO well-known accessibility service names to appear
        // together (e.g. "talkback" + "switch access", or "talkback" + "live transcribe").
        // A single keyword like "talkback" is not sufficient — it appears in help text,
        // search results, and settings descriptions, causing false positives.
        val root = event.source ?: return false
        return try {
            val nodeText = collectNodeText(root).lowercase()
            // Main Accessibility page: requires at least two known service names to
            // reliably identify the list-of-services page vs. a random mention.
            val knownServiceCount = listOf(
                "talkback", "switch access", "live transcribe",
                "sound notification", "brailleback", "select to speak"
            ).count { it in nodeText }
            val isMainAccessibilityPage = knownServiceCount >= 2
            // "Installed apps" sub-page: Samsung's dedicated accessibility service list.
            // Identified by its page title + multiple presence of known accessibility services.
            val isInstalledAppsPage =
                "installed apps" in nodeText && knownServiceCount >= 2
            isMainAccessibilityPage || isInstalledAppsPage
        } finally {
            root.recycle()
        }
    }

    /**
     * Returns true when the event represents a "Clear data" dialog in Android Settings —
     * prevents the user from clearing FocusFlow data mid-session.
     *
     * NOTE: "clear cache" is intentionally excluded. That button text appears on every
     * app's Storage settings page in Android (not just as a dialog), which was causing
     * false positives and blocking users from accessing any app's storage settings.
     * Only "clear data" / "clear storage" represent the destructive confirmation dialog.
     */
    private fun isClearDataDialog(event: AccessibilityEvent): Boolean {
        val keywords = listOf("clear data", "clear storage", "clear app data")
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
            "usage data access",       // Samsung One UI page title
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

    /**
     * Returns true when the user navigated to any Reset settings page.
     * Covers:
     *   • "Reset" page listing (contains "Reset accessibility settings" or "Factory data reset")
     *   • "Reset accessibility settings" confirmation page (would disable our service)
     *   • "Factory data reset" confirmation page
     *   • "Reset all settings" page
     */
    private fun isResetSettingsPage(event: AccessibilityEvent): Boolean {
        val eventText = buildString {
            event.text.forEach { append(it); append(' ') }
        }.lowercase()
        val keywords = listOf(
            "reset accessibility settings",
            "factory data reset",
            "reset all settings",
            "erase all data"                // "Factory data reset" confirmation button
        )
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
     * Returns true when the user navigated to the Special Access page in Settings.
     * This page is the gateway to many dangerous sub-pages (Device admin, Appear on top,
     * Install unknown apps, Usage data access, etc.) and should be blocked entirely
     * during a focus session so sub-pages can't be reached by scrolling past blocked ones.
     *
     * Uses two distinctive items that always appear on the page together to avoid
     * false positives — "special access" alone is too generic.
     */
    private fun isSpecialAccessPage(event: AccessibilityEvent): Boolean {
        val eventText = buildString {
            event.text.forEach { append(it); append(' ') }
        }.lowercase()
        if ("special access" in eventText &&
            ("appear on top" in eventText || "install unknown apps" in eventText ||
             "device admin apps" in eventText || "all files access" in eventText)) return true

        val root = event.source ?: return false
        return try {
            val nodeText = collectNodeText(root).lowercase()
            "special access" in nodeText &&
            ("appear on top" in nodeText || "install unknown apps" in nodeText ||
             "device admin apps" in nodeText || "all files access" in nodeText)
        } finally {
            root.recycle()
        }
    }

    /**
     * Returns true when the user has navigated to the App Info page for FocusFlow
     * itself (com.tbtechs.focusflow). This page exposes a "Force stop" button that
     * would kill the accessibility service and end all blocking.
     *
     * Detection strategy (layered for OEM robustness):
     *   1. Activity class name contains a known App Info class name AND page content
     *      references FocusFlow's package/display name.
     *   2. Content-based fallback: page has both "force stop" AND a reference to
     *      FocusFlow — works on Samsung and other OEMs with renamed activity classes.
     */
    private fun isFocusFlowAppInfoPage(event: AccessibilityEvent): Boolean {
        val className = event.className?.toString()?.lowercase() ?: ""
        val knownAppInfoClasses = listOf(
            "installedappdetails",
            "appdetailssettings",
            "appinfobase",
            "applicationdetailssettings",
            "appinfodashboardactivity",   // AOSP / Pixel
            "manageapplicationdetails",   // Samsung
        )
        val classMatchesAppInfo = knownAppInfoClasses.any { it in className }

        val root = event.source ?: run {
            // No root — fall back to event text
            val eventText = buildString {
                event.text.forEach { append(it); append(' ') }
            }.lowercase()
            return classMatchesAppInfo &&
                   ("focusflow" in eventText || packageName.lowercase() in eventText)
        }

        return try {
            val nodeText = collectNodeText(root).lowercase()
            val hasFocusFlowRef = "focusflow" in nodeText ||
                                  packageName.lowercase() in nodeText
            if (!hasFocusFlowRef) return false
            // Confirm we're on an App Info page — must have a "force stop" marker
            // or the class name already told us so.
            classMatchesAppInfo || "force stop" in nodeText || "force-stop" in nodeText
        } finally {
            root.recycle()
        }
    }

    /**
     * Returns true when the user has navigated to the App Info page for any package
     * that is currently blocked by the active session.
     *
     * Rationale: if the user can reach a blocked app's detail page they can clear
     * its data, storage, or "Open by default" links — effectively circumventing the
     * block's intent. They could also uninstall the app and reinstall a lookalike.
     *
     * Detection: page has "force stop" + matches a blocked package name in the content.
     */
    private fun isBlockedAppInfoPage(
        event: AccessibilityEvent,
        focusActive: Boolean,
        saActive: Boolean
    ): Boolean {
        // Quick exit: gather the blocked package list
        val saJson = if (saActive) prefs.getString(PREF_SA_PKGS, "[]") ?: "[]" else "[]"
        val saList = if (saActive) parseJsonArray(saJson) else emptyList()

        // Collect packages that ARE explicitly blocked in the standalone list.
        // Focus-mode blocks everything NOT in the allowed list — we can't enumerate
        // all blocked packages efficiently here, so we guard the standalone list only.
        val blockedCandidates = mutableSetOf<String>()
        if (saActive) blockedCandidates.addAll(saList)
        blockedCandidates.remove(packageName) // Never mis-block our own page here

        if (blockedCandidates.isEmpty()) return false

        val root = event.source ?: return false
        return try {
            val nodeText = collectNodeText(root).lowercase()
            // Must look like an App Info page
            if ("force stop" !in nodeText && "force-stop" !in nodeText) return false
            // Check if any blocked package name appears in the page text
            blockedCandidates.any { pkg ->
                pkg.lowercase() in nodeText
            }
        } finally {
            root.recycle()
        }
    }

    // ─── Daily allowance helpers ──────────────────────────────────────────────
    //
    // Three modes are supported per app:
    //   count       — N opens per day (resets at midnight).
    //   time_budget — N total minutes per day (resets at midnight). Time is
    //                 accumulated via timed-session tracking in onAccessibilityEvent.
    //   interval    — N minutes allowed per rolling Y-hour window. Window resets
    //                 automatically when it expires; usage is tracked per window.
    //
    // Usage state is stored in SharedPrefs key PREF_DAILY_ALLOWANCE_USED as a
    // JSON object keyed by package name:
    //   count:       { mode, date, count }
    //   time_budget: { mode, date, usedMs }
    //   interval:    { mode, windowStartMs, usedMs }

    /**
     * Returns the AllowanceEntry for [pkg] if it exists in the config, or null.
     * Checks PREF_DAILY_ALLOWANCE_CONFIG (new rich JSON) first, then falls back
     * to the legacy PREF_DAILY_ALLOWANCE_PKGS (count:1 for migrated entries).
     */
    private fun findAllowanceEntry(pkg: String): AllowanceEntry? {
        // Try new rich config first
        val configJson = prefs.getString(PREF_DAILY_ALLOWANCE_CONFIG, null)
        if (!configJson.isNullOrBlank() && configJson != "null") {
            try {
                val arr = org.json.JSONArray(configJson)
                for (i in 0 until arr.length()) {
                    val obj = arr.getJSONObject(i)
                    val entryPkg = obj.optString("packageName", "")
                    if (entryPkg.equals(pkg, ignoreCase = true)) {
                        return AllowanceEntry(
                            pkg          = entryPkg,
                            mode         = obj.optString("mode", "count"),
                            countPerDay  = obj.optInt("countPerDay", 1).coerceAtLeast(1),
                            budgetMs     = obj.optLong("budgetMinutes", 30L) * 60_000L,
                            intervalMs   = obj.optLong("intervalMinutes", 5L) * 60_000L,
                            windowMs     = obj.optLong("intervalHours", 1L) * 3_600_000L,
                        )
                    }
                }
            } catch (_: Exception) {}
            return null // Config exists but this pkg is not in it
        }
        // Legacy fallback: simple string array → count:1
        val legacyJson = prefs.getString(PREF_DAILY_ALLOWANCE_PKGS, "[]") ?: "[]"
        return try {
            val arr = org.json.JSONArray(legacyJson)
            val found = (0 until arr.length()).any { arr.getString(it).equals(pkg, ignoreCase = true) }
            if (found) AllowanceEntry(pkg, "count", 1, 0L, 0L, 0L) else null
        } catch (_: Exception) { null }
    }

    /**
     * Returns true if the app still has allowance quota for the current period.
     */
    private fun isAllowanceAvailable(pkg: String, entry: AllowanceEntry): Boolean {
        val now = System.currentTimeMillis()
        val allUsed = loadUsedObject()
        val pkgUsed = allUsed.optJSONObject(pkg)

        return when (entry.mode) {
            "count" -> {
                val today = todayDateString()
                val usedDate = pkgUsed?.optString("date", "") ?: ""
                val count = if (usedDate == today) pkgUsed?.optInt("count", 0) ?: 0 else 0
                count < entry.countPerDay
            }
            "time_budget" -> {
                val today = todayDateString()
                val usedDate = pkgUsed?.optString("date", "") ?: ""
                val usedMs = if (usedDate == today) pkgUsed?.optLong("usedMs", 0L) ?: 0L else 0L
                usedMs < entry.budgetMs
            }
            "interval" -> {
                val windowStartMs = pkgUsed?.optLong("windowStartMs", 0L) ?: 0L
                if (now > windowStartMs + entry.windowMs) return true // new window
                val usedMs = pkgUsed?.optLong("usedMs", 0L) ?: 0L
                usedMs < entry.intervalMs
            }
            else -> false
        }
    }

    /**
     * Records that the app was just opened within its allowance.
     * For count mode: increments the open counter.
     * For timed modes: stores openedAtMs and calculates sessionEndMs.
     *
     * @return sessionEndMs — the epoch ms when this session expires (0 for count mode).
     */
    private fun recordAllowanceOpen(pkg: String, entry: AllowanceEntry): Long {
        val now = System.currentTimeMillis()
        val allUsed = loadUsedObject()
        val pkgUsed = allUsed.optJSONObject(pkg) ?: org.json.JSONObject()

        val sessionEndMs: Long
        when (entry.mode) {
            "count" -> {
                val today = todayDateString()
                val usedDate = pkgUsed.optString("date", "")
                val prevCount = if (usedDate == today) pkgUsed.optInt("count", 0) else 0
                pkgUsed.put("mode", "count")
                pkgUsed.put("date", today)
                pkgUsed.put("count", prevCount + 1)
                sessionEndMs = 0L
            }
            "time_budget" -> {
                val today = todayDateString()
                val usedDate = pkgUsed.optString("date", "")
                val prevUsedMs = if (usedDate == today) pkgUsed.optLong("usedMs", 0L) else 0L
                val remainingMs = (entry.budgetMs - prevUsedMs).coerceAtLeast(0L)
                sessionEndMs = now + remainingMs
                pkgUsed.put("mode", "time_budget")
                pkgUsed.put("date", today)
                pkgUsed.put("usedMs", prevUsedMs) // updated when session ends via accumulateTimedUsage
            }
            "interval" -> {
                val windowStartMs = pkgUsed.optLong("windowStartMs", 0L)
                val windowExpired = now > windowStartMs + entry.windowMs
                val effectiveWindowStart = if (windowExpired) now else windowStartMs
                val prevUsedMs = if (windowExpired) 0L else pkgUsed.optLong("usedMs", 0L)
                val remainingMs = (entry.intervalMs - prevUsedMs).coerceAtLeast(0L)
                sessionEndMs = now + remainingMs
                pkgUsed.put("mode", "interval")
                pkgUsed.put("windowStartMs", effectiveWindowStart)
                pkgUsed.put("usedMs", prevUsedMs) // updated when session ends
            }
            else -> sessionEndMs = 0L
        }

        allUsed.put(pkg, pkgUsed)
        prefs.edit().putString(PREF_DAILY_ALLOWANCE_USED, allUsed.toString()).apply()
        return sessionEndMs
    }

    /**
     * Accumulates elapsed usage time for a timed-mode app session.
     * Called when the user switches away to a different app (or when the session timer fires).
     */
    private fun accumulateTimedUsage(pkg: String, entry: AllowanceEntry, openedAtMs: Long) {
        val now = System.currentTimeMillis()
        val elapsed = (now - openedAtMs).coerceAtLeast(0L)
        if (elapsed == 0L) return

        val allUsed = loadUsedObject()
        val pkgUsed = allUsed.optJSONObject(pkg) ?: org.json.JSONObject()

        when (entry.mode) {
            "time_budget" -> {
                val today = todayDateString()
                val usedDate = pkgUsed.optString("date", "")
                val prevUsedMs = if (usedDate == today) pkgUsed.optLong("usedMs", 0L) else 0L
                pkgUsed.put("date", today)
                pkgUsed.put("usedMs", (prevUsedMs + elapsed).coerceAtMost(entry.budgetMs))
            }
            "interval" -> {
                val prevUsedMs = pkgUsed.optLong("usedMs", 0L)
                pkgUsed.put("usedMs", (prevUsedMs + elapsed).coerceAtMost(entry.intervalMs))
            }
        }

        allUsed.put(pkg, pkgUsed)
        prefs.edit().putString(PREF_DAILY_ALLOWANCE_USED, allUsed.toString()).apply()
    }

    /**
     * Schedules a Handler callback to fire when [sessionEndMs] is reached.
     * When it fires, the timed session has expired and the user is sent home.
     */
    private fun scheduleTimedExpiry(pkg: String, sessionEndMs: Long) {
        timedExpireRunnable?.let { handler.removeCallbacks(it) }
        val delayMs = sessionEndMs - System.currentTimeMillis()
        if (delayMs <= 0L) {
            // Already expired — dismiss immediately
            if (currentTimedPkg == pkg) {
                val entry = findAllowanceEntry(pkg)
                if (entry != null) accumulateTimedUsage(pkg, entry, currentTimedOpenAtMs)
                currentTimedPkg = null
                currentTimedOpenAtMs = 0L
                currentTimedSessionEndMs = 0L
            }
            performGlobalAction(GLOBAL_ACTION_HOME)
            return
        }
        val runnable = Runnable {
            timedExpireRunnable = null
            val entry = findAllowanceEntry(pkg)
            if (entry != null && currentTimedPkg == pkg) {
                accumulateTimedUsage(pkg, entry, currentTimedOpenAtMs)
            }
            currentTimedPkg = null
            currentTimedOpenAtMs = 0L
            currentTimedSessionEndMs = 0L
            performGlobalAction(GLOBAL_ACTION_HOME)
        }
        timedExpireRunnable = runnable
        handler.postDelayed(runnable, delayMs)
    }

    private fun loadUsedObject(): org.json.JSONObject {
        val json = prefs.getString(PREF_DAILY_ALLOWANCE_USED, "{}") ?: "{}"
        return try { org.json.JSONObject(json) } catch (_: Exception) { org.json.JSONObject() }
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

        // 1. Kill the network first — before the overlay even appears, the blocked
        //    app's pending requests are already cut. On a slow phone the user may
        //    briefly see the app, but it will be loading a blank screen.
        triggerNetworkBlock(blockedPackage)

        // 2. Set the awaiting package BEFORE launching/dismissing so the very next
        //    window event (launcher coming to front) is guaranteed to trigger the
        //    X-button reveal without a race condition.
        prefs.edit().putString("overlay_awaiting_pkg", blockedPackage).apply()

        // 3. Launch the full-screen overlay. This takes the foreground before the
        //    blocked app finishes rendering on most devices. The overlay handles its
        //    own re-raise on slow phones via onPause(), so this service can back off.
        launchBlockOverlay(blockedPackage)

        // 4. Close the blocked app: BACK → HOME (150 ms) → BACK (160 ms).
        //    These key presses act on the blocked app itself and do not affect the
        //    overlay, which is a system window that stays on top regardless.
        dismissPackage(blockedPackage)

        // 5. Aversive deterrents — screen dim, vibration, alert sound (each gated
        //    by its own toggle; no-op if all are disabled).
        AversiveActionsManager.onBlockedApp(this)

        // 6. Temptation log — record every intercept for the weekly shame report.
        val displayName = resolveAppDisplayName(blockedPackage)
        TemptationLogManager.log(this, blockedPackage, displayName)
    }

    /**
     * Activates network blocking for [blockedPackage] if the user has enabled it.
     *
     * Only fires if:
     *   • net_block_enabled = true
     *   • net_block_vpn = true
     *   • VPN permission has already been granted by the user (prepare() == null)
     *   • VPN is not already running
     *
     * WiFi and mobile data direct-disable are intentionally NOT triggered here
     * because they require Context methods not available in an AccessibilityService.
     * Those supplementary actions are handled by NetworkBlockModule from the JS layer
     * when the user manually starts a session. The VPN tunnel covers both channels.
     */
    private fun triggerNetworkBlock(blockedPackage: String) {
        if (!prefs.getBoolean("net_block_enabled", false)) return
        if (!prefs.getBoolean("net_block_vpn", true)) return
        if (NetworkBlockerVpnService.isRunning) return   // already active

        // VPN permission check — prepare() returns null if permission is already held
        try {
            val permissionIntent = VpnService.prepare(applicationContext)
            if (permissionIntent != null) return  // not yet granted — skip, don't crash
        } catch (_: Exception) { return }

        val global = prefs.getBoolean("net_block_global", false)
        val mode   = if (global) NetworkBlockerVpnService.MODE_GLOBAL
                     else        NetworkBlockerVpnService.MODE_PER_APP
        val pkgs   = JSONArray().apply { put(blockedPackage) }.toString()

        try {
            val intent = Intent(this, NetworkBlockerVpnService::class.java).apply {
                action = NetworkBlockerVpnService.ACTION_START
                putExtra(NetworkBlockerVpnService.EXTRA_PACKAGES, pkgs)
                putExtra(NetworkBlockerVpnService.EXTRA_MODE, mode)
            }
            startService(intent)
        } catch (_: Exception) { /* service start failed — overlay + HOME are the fallback */ }
    }

    // ─── WindowManager overlay (TYPE_APPLICATION_OVERLAY) ────────────────────

    /** True when SYSTEM_ALERT_WINDOW ("Appear on top") is granted. */
    private fun canUseWindowOverlay(): Boolean =
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) Settings.canDrawOverlays(this)
        else true

    /**
     * Draws a full-screen block overlay directly over any foreground app using
     * WindowManager TYPE_APPLICATION_OVERLAY.  Requires SYSTEM_ALERT_WINDOW.
     * No task switch occurs — the blocked app stays behind our view, invisible.
     */
    @Suppress("DEPRECATION")
    private fun showWindowOverlay(blockedPackage: String, appName: String) {
        dismissWindowOverlay()   // clear any stale overlay first

        val wm = getSystemService(WindowManager::class.java) ?: return
        val density = resources.displayMetrics.density
        fun dp(v: Int): Int = (v * density + 0.5f).toInt()

        val type = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O)
            WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY
        else
            WindowManager.LayoutParams.TYPE_PHONE

        val params = WindowManager.LayoutParams(
            WindowManager.LayoutParams.MATCH_PARENT,
            WindowManager.LayoutParams.MATCH_PARENT,
            type,
            WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN or
                    WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS or
                    WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED or
                    WindowManager.LayoutParams.FLAG_DISMISS_KEYGUARD or
                    WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON,
            PixelFormat.TRANSLUCENT
        )

        // ── Root ──────────────────────────────────────────────────────────────
        val root = FrameLayout(this)
        root.layoutParams = FrameLayout.LayoutParams(
            FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT
        )
        root.background = GradientDrawable(
            GradientDrawable.Orientation.TL_BR,
            intArrayOf(Color.parseColor("#0C0C1A"), Color.parseColor("#1A1245"))
        )

        // ── Wallpaper / system wallpaper background ───────────────────────────
        val wallpaperPath = prefs.getString("block_overlay_wallpaper", "") ?: ""
        val customFile = java.io.File(wallpaperPath)
        if (wallpaperPath.isNotEmpty() && customFile.exists()) {
            try {
                val bmp = BitmapFactory.decodeFile(wallpaperPath)
                if (bmp != null) root.addView(ImageView(this).apply {
                    layoutParams = FrameLayout.LayoutParams(
                        FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT
                    )
                    setImageBitmap(bmp); scaleType = ImageView.ScaleType.CENTER_CROP; alpha = 0.82f
                })
            } catch (_: Exception) { }
        } else {
            try {
                val drawable = WallpaperManager.getInstance(this).drawable
                if (drawable != null) root.addView(ImageView(this).apply {
                    layoutParams = FrameLayout.LayoutParams(
                        FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT
                    )
                    setImageDrawable(drawable); scaleType = ImageView.ScaleType.CENTER_CROP; alpha = 0.82f
                })
            } catch (_: Exception) { }
        }

        // ── Dark scrim ────────────────────────────────────────────────────────
        root.addView(android.view.View(this).apply {
            layoutParams = FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT
            )
            setBackgroundColor(Color.parseColor("#AA0A0A1A"))
        })

        // ── Centre column ─────────────────────────────────────────────────────
        val col = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER
            layoutParams = FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT
            )
            setPadding(dp(32), dp(80), dp(32), dp(80))
        }

        col.addView(TextView(this).apply {            // lock emoji
            text = "\uD83D\uDD12"; textSize = 52f; gravity = Gravity.CENTER
            layoutParams = LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT
            ).apply { bottomMargin = dp(20) }
        })
        col.addView(TextView(this).apply {            // "[App] is blocked"
            text = if (appName.isNotEmpty()) "\u201C$appName\u201D is blocked" else "App Blocked"
            textSize = 15f; setTextColor(Color.parseColor("#FF6B6B"))
            gravity = Gravity.CENTER; letterSpacing = 0.12f
            layoutParams = LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT
            ).apply { bottomMargin = dp(36) }
        })
        col.addView(TextView(this).apply {            // random quote
            text = "\u201C${resolveOverlayQuote()}\u201D"
            textSize = 20f; setTextColor(Color.parseColor("#E8E8F0"))
            gravity = Gravity.CENTER; setLineSpacing(0f, 1.55f)
            layoutParams = LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT
            ).apply { bottomMargin = dp(48) }
        })
        col.addView(TextView(this).apply {            // sub-label
            text = "Stay focused. You\u2019ve got this."
            textSize = 13f; setTextColor(Color.parseColor("#55556A")); gravity = Gravity.CENTER
            layoutParams = LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT
            )
        })
        root.addView(col)

        // ── Bottom nav row: ↩ Back  ⌂ Home (revealed with X, minimal gap) ────
        val navRow = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER
            alpha = 0f
            layoutParams = FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.WRAP_CONTENT,
                FrameLayout.LayoutParams.WRAP_CONTENT
            ).apply {
                gravity = Gravity.BOTTOM or Gravity.CENTER_HORIZONTAL
                bottomMargin = dp(52)
            }
        }

        fun navBtn(label: String, onClick: () -> Unit): TextView =
            TextView(this).apply {
                text = label; textSize = 15f; gravity = Gravity.CENTER
                setTextColor(Color.parseColor("#AAAACC"))
                setPadding(dp(22), dp(12), dp(22), dp(12))
                background = GradientDrawable().apply {
                    cornerRadius = dp(24).toFloat()
                    setColor(Color.parseColor("#22222E"))
                    setStroke(dp(1), Color.parseColor("#44445A"))
                }
                layoutParams = LinearLayout.LayoutParams(
                    LinearLayout.LayoutParams.WRAP_CONTENT,
                    LinearLayout.LayoutParams.WRAP_CONTENT
                ).apply { marginEnd = dp(8) }
                setOnClickListener { onClick() }
            }

        navRow.addView(navBtn("\u21A9  Back") {
            prefs.edit()
                .putBoolean(BlockOverlayActivity.PREF_OVERLAY_X_READY, false)
                .putBoolean("block_cooldown_reset", true)
                .apply()
            dismissWindowOverlay()
            performGlobalAction(GLOBAL_ACTION_BACK)
        })
        navRow.addView(navBtn("\u2302  Home") {
            prefs.edit()
                .putBoolean(BlockOverlayActivity.PREF_OVERLAY_X_READY, false)
                .putBoolean("block_cooldown_reset", true)
                .apply()
            dismissWindowOverlay()
            performGlobalAction(GLOBAL_ACTION_HOME)
        })
        wOverlayNavRow = navRow
        root.addView(navRow)

        // ── X button (hidden until home confirmed) ────────────────────────────
        val xBtn = TextView(this).apply {
            text = "\u2715"; textSize = 20f
            setTextColor(Color.parseColor("#AAAACC")); gravity = Gravity.CENTER
            setPadding(dp(16), dp(16), dp(16), dp(16))
            background = GradientDrawable().apply {
                shape = GradientDrawable.OVAL
                setColor(Color.parseColor("#22222E"))
                setStroke(dp(1), Color.parseColor("#44445A"))
            }
            alpha = 0f; isClickable = false; isFocusable = false
            val size = dp(48)
            layoutParams = FrameLayout.LayoutParams(size, size).apply {
                gravity = Gravity.TOP or Gravity.END
                topMargin = dp(56); rightMargin = dp(24)
            }
            setOnClickListener {
                prefs.edit()
                    .putBoolean(BlockOverlayActivity.PREF_OVERLAY_X_READY, false)
                    .putBoolean("block_cooldown_reset", true)
                    .apply()
                dismissWindowOverlay()
            }
        }
        wOverlayXBtn = xBtn
        wOverlayXRevealed = false
        root.addView(xBtn)

        wOverlayView = root
        try {
            wm.addView(root, params)
        } catch (_: Exception) {
            wOverlayView = null; wOverlayXBtn = null
        }
    }

    /** Removes the WindowManager overlay view if one is currently showing. */
    private fun dismissWindowOverlay() {
        val view = wOverlayView ?: return
        try {
            getSystemService(WindowManager::class.java)?.removeView(view)
        } catch (_: Exception) { }
        wOverlayView = null
        wOverlayXBtn = null
        wOverlayNavRow = null
        wOverlayXRevealed = false
    }

    /** Fades in the ✕ button and the Back/Home nav row so the user can dismiss. */
    private fun revealWindowXButton() {
        if (wOverlayXRevealed) return
        wOverlayXRevealed = true
        handler.post {
            // ✕ close button
            wOverlayXBtn?.let { btn ->
                btn.isClickable = true
                btn.isFocusable = true
                ValueAnimator.ofFloat(0f, 1f).apply {
                    duration = 400L
                    addUpdateListener { btn.alpha = it.animatedValue as Float }
                    start()
                }
            }
            // ↩ Back  ⌂ Home row
            wOverlayNavRow?.let { row ->
                ValueAnimator.ofFloat(0f, 1f).apply {
                    duration = 400L
                    addUpdateListener { row.alpha = it.animatedValue as Float }
                    start()
                }
            }
        }
    }

    /** Picks a quote for the overlay (fixed → custom pool → defaults). */
    private fun resolveOverlayQuote(): String {
        val fixed = prefs.getString("block_overlay_quote", "") ?: ""
        if (fixed.isNotEmpty()) return fixed
        val customJson = prefs.getString("block_overlay_quotes", "") ?: ""
        val pool: List<String> = if (customJson.isNotEmpty()) {
            try {
                val arr = JSONArray(customJson)
                (0 until arr.length()).map { arr.getString(it) }.takeIf { it.isNotEmpty() }
                    ?: BlockOverlayModule.DEFAULT_QUOTES
            } catch (_: Exception) { BlockOverlayModule.DEFAULT_QUOTES }
        } else BlockOverlayModule.DEFAULT_QUOTES
        return pool.random()
    }

    /**
     * Launches [BlockOverlayActivity] via a full-screen notification PendingIntent.
     *
     * Using a full-screen intent rather than startActivity() bypasses Android 10+
     * background activity launch restrictions — the system (not the app) starts
     * the activity, so SYSTEM_ALERT_WINDOW is not required and OEM battery managers
     * cannot block it.  The notification is auto-cancelled after 2 s once the
     * activity is already showing.
     */
    private fun launchBlockOverlay(blockedPackage: String) {
        val appName = resolveAppDisplayName(blockedPackage)

        // Prefer WindowManager overlay (appears directly over any app, no task switch)
        if (canUseWindowOverlay()) {
            showWindowOverlay(blockedPackage, appName)
            return
        }

        // Fallback: full-screen notification PendingIntent (no SYSTEM_ALERT_WINDOW needed)
        try {
            val activityIntent = Intent(this, BlockOverlayActivity::class.java).apply {
                flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP
                putExtra(BlockOverlayActivity.EXTRA_BLOCKED_PKG, blockedPackage)
                putExtra(BlockOverlayActivity.EXTRA_BLOCKED_NAME, appName)
            }
            val pi = PendingIntent.getActivity(
                applicationContext, 0, activityIntent,
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
            )
            val nm = getSystemService(NotificationManager::class.java) ?: return
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                val ch = NotificationChannel(
                    BLOCK_ALERT_CHANNEL, "Block Alert", NotificationManager.IMPORTANCE_HIGH
                ).apply {
                    lockscreenVisibility = Notification.VISIBILITY_PUBLIC
                    setBypassDnd(true)
                }
                nm.createNotificationChannel(ch)
            }
            val notif = Notification.Builder(
                this,
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) BLOCK_ALERT_CHANNEL else "default"
            ).apply {
                setSmallIcon(android.R.drawable.ic_lock_lock)
                setContentTitle("App Blocked")
                setContentText("\u201C$appName\u201D is blocked during this session.")
                setFullScreenIntent(pi, true)
                setAutoCancel(true)
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
                    setVisibility(Notification.VISIBILITY_PUBLIC)
                }
            }.build()
            nm.notify(BLOCK_ALERT_NOTIF_ID, notif)
            // Auto-cancel after 2 s — the activity is already on screen by then
            handler.postDelayed({ nm.cancel(BLOCK_ALERT_NOTIF_ID) }, 2_000L)
        } catch (_: Exception) { }
    }

    /**
     * Kicks the user out of [blockedPackage] using both BACK and HOME.
     *
     * BACK first — collapses any in-app dialog or deeplink navigation so the
     * blocked app is fully dismissed from the task stack.
     * HOME 150 ms later — forces the launcher to the foreground, which also
     * triggers the overlay X-button / Back+Home nav row reveal signal.
     *
     * Installer packages (Play Store, MIUI installer, etc.) only get BACK
     * because sending HOME during an install confirmation hides the dialog
     * without cancelling, leaving a stale install in the background.
     */
    private fun dismissPackage(blockedPackage: String) {
        if (INSTALLER_PACKAGES.any { blockedPackage.equals(it, ignoreCase = true) }) {
            performGlobalAction(GLOBAL_ACTION_BACK)
        } else {
            performGlobalAction(GLOBAL_ACTION_BACK)
            handler.postDelayed({ performGlobalAction(GLOBAL_ACTION_HOME) }, 150L)
            handler.postDelayed({ performGlobalAction(GLOBAL_ACTION_BACK) }, 160L)
        }
    }

    /**
     * Returns the human-readable label for [packageName] via PackageManager.
     * Falls back to the package name itself on any error.
     */
    private fun resolveAppDisplayName(packageName: String): String {
        return try {
            val pm = applicationContext.packageManager
            val info = pm.getApplicationInfo(packageName, 0)
            pm.getApplicationLabel(info).toString()
        } catch (_: Exception) {
            packageName
        }
    }

    // ─── Word blocking helpers ────────────────────────────────────────────────

    private fun getBlockedWords(): List<String> {
        val json = prefs.getString(PREF_BLOCKED_WORDS, "[]") ?: "[]"
        return parseJsonArray(json).map { it.trim() }.filter { it.isNotBlank() }
    }

    /**
     * Returns true if any blocked word appears as a whole word in the event title text
     * or in the shallow node tree (max 3 levels deep).
     *
     * Matching is case-insensitive and whole-word only — prevents "short" from
     * matching "shortage", "shortage" in shopping apps, etc.
     *
     * Node traversal is deliberately depth-limited to avoid picking up deep content
     * like notification text, search suggestions, or background list items that the
     * user is not actively viewing, which was the primary source of false positives.
     */
    private fun containsBlockedWord(event: AccessibilityEvent, words: List<String>): Boolean {
        val corpus = buildString {
            event.text?.forEach { t -> t?.let { append(it); append(' ') } }
            event.contentDescription?.let { append(it); append(' ') }
            // Only scan the top 3 levels of the node tree to avoid deep content
            // (notifications, list item descriptions, background elements).
            event.source?.let { root ->
                try {
                    append(collectNodeTextShallow(root, maxDepth = 3))
                } finally {
                    root.recycle()
                }
            }
        }.lowercase()
        if (corpus.isBlank()) return false
        // Use whole-word matching: wrap the word in word boundaries via regex.
        return words.any { word ->
            val pattern = Regex("\\b${Regex.escape(word.lowercase())}\\b")
            pattern.containsMatchIn(corpus)
        }
    }

    // ─── Node text collectors ─────────────────────────────────────────────────

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

    /**
     * Depth-limited variant of [collectNodeText]. Only traverses [maxDepth] levels
     * below the root. Used by word blocking to avoid picking up deep content like
     * notification text, list items, or background elements that are not the active
     * page title or primary content — the main driver of false positives.
     */
    private fun collectNodeTextShallow(root: AccessibilityNodeInfo, maxDepth: Int): String {
        return buildString {
            fun walk(node: AccessibilityNodeInfo, depth: Int) {
                if (depth > maxDepth) return
                node.text?.let { append(it); append(' ') }
                node.contentDescription?.let { append(it); append(' ') }
                for (i in 0 until node.childCount) {
                    node.getChild(i)?.let { child ->
                        walk(child, depth + 1)
                        child.recycle()
                    }
                }
            }
            walk(root, 0)
        }
    }

    // ─── Greyout schedule helpers ─────────────────────────────────────────────

    /**
     * Returns true when [pkg] is inside an active greyout window right now.
     *
     * Window format (SharedPrefs key "greyout_schedule", JSON array):
     *   { pkg, startHour, startMin, endHour, endMin, days: [1..7] }
     * days values match Java Calendar.DAY_OF_WEEK: 1=Sun, 2=Mon, … 7=Sat.
     * Overnight windows are supported (startHour > endHour).
     */
    private fun isInGreyoutWindow(pkg: String): Boolean {
        val json = prefs.getString("greyout_schedule", "[]") ?: "[]"
        if (json == "[]" || json.isEmpty()) return false
        return try {
            val arr = org.json.JSONArray(json)
            val cal = java.util.Calendar.getInstance()
            val currentDay     = cal.get(java.util.Calendar.DAY_OF_WEEK)
            val currentMinutes = cal.get(java.util.Calendar.HOUR_OF_DAY) * 60 +
                                 cal.get(java.util.Calendar.MINUTE)
            for (i in 0 until arr.length()) {
                val entry = arr.optJSONObject(i) ?: continue
                if (!entry.optString("pkg").equals(pkg, ignoreCase = true)) continue
                val days = entry.optJSONArray("days") ?: continue
                val dayMatch = (0 until days.length()).any { days.optInt(it) == currentDay }
                if (!dayMatch) continue
                val startMins = entry.optInt("startHour") * 60 + entry.optInt("startMin")
                val endMins   = entry.optInt("endHour")   * 60 + entry.optInt("endMin")
                val inWindow = if (startMins <= endMins) {
                    currentMinutes in startMins until endMins   // normal: 09:00–18:00
                } else {
                    currentMinutes >= startMins || currentMinutes < endMins  // overnight
                }
                if (inWindow) return true
            }
            false
        } catch (_: Exception) { false }
    }

    /**
     * Retry checker for greyout-triggered blocks.  Unlike the session-based retry,
     * this one re-checks the greyout schedule (not focus/standalone flags) so it
     * continues working when no session is active.
     */
    private fun scheduleGreyoutRetryCheck(pkg: String, attempt: Int) {
        if (attempt > MAX_RETRY_ATTEMPTS) return
        handler.postDelayed({
            if (lastSeenPkg != pkg) return@postDelayed
            if (isInGreyoutWindow(pkg)) {
                dismissPackage(pkg)
                scheduleGreyoutRetryCheck(pkg, attempt + 1)
            }
        }, RETRY_INTERVAL_MS * attempt)
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
