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
import android.net.Uri
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
 *      - System UI, launchers, phone/dialer are bypassed by default unless the user
 *        explicitly opts to block them via a confirmation warning in the UI
 *        (see BLOCKABLE_AFTER_WARNING — formerly ALWAYS_ALLOWED).
 *      - Settings is in BLOCKABLE_AFTER_WARNING but specific sub-pages (accessibility
 *        settings, clear data dialogs, date/time) are intercepted and dismissed
 *        during focus regardless.
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
        const val PREF_SYSTEM_GUARD_ENABLED = "system_guard_enabled"

        // Content-specific guard flags (opt-in). Each follows the same enforcement
        // pattern as PREF_SYSTEM_GUARD_ENABLED: gated by (focusActive || saActive).
        const val PREF_BLOCK_INSTALL_ACTIONS = "block_install_actions"   // Play Store / packageinstaller install/update/uninstall confirmations
        const val PREF_BLOCK_YT_SHORTS       = "block_yt_shorts"          // YouTube Shorts player (YouTube otherwise allowed)
        const val PREF_BLOCK_IG_REELS        = "block_ig_reels"           // Instagram Reels / clips viewer (Instagram otherwise allowed)

        /**
         * JSON array of CustomNodeRule objects imported from NodeSpy NodeSpyCaptureV1 exports.
         * Each rule has: id, label, pkg, matchResId?, matchText?, matchCls?, action ("overlay"|"home")
         * The AccessibilityService scans the foreground window tree for matching nodes.
         */
        const val PREF_CUSTOM_NODE_RULES = "custom_node_rules"

        /**
         * Always-on block enforcement — independent of any timed session.
         *
         * PREF_ALWAYS_BLOCK: Boolean — when true the AccessibilityService enforces
         *   the PREF_ALWAYS_BLOCK_PKGS list and daily allowance rules at all times,
         *   without requiring focus_active or standalone_block_active.
         *
         * PREF_ALWAYS_BLOCK_PKGS: String — JSON array of package names to block
         *   whenever PREF_ALWAYS_BLOCK is true.  Stored separately from
         *   standalone_blocked_packages so timed-session expiry never clears it.
         *
         * The UI "locked" state is NOT affected by these flags — the user can
         * freely change their block list when no timed session is running.
         */
        const val PREF_ALWAYS_BLOCK      = "always_block_active"
        const val PREF_ALWAYS_BLOCK_PKGS = "always_block_packages"

        /** Notification channel used to launch the block overlay via full-screen intent. */
        private const val BLOCK_ALERT_CHANNEL  = "focusday_block_alert"
        private const val BLOCK_ALERT_NOTIF_ID = 9001

        /**
         * BLOCKABLE_AFTER_WARNING (formerly ALWAYS_ALLOWED).
         *
         * Packages in this set are bypassed by the accessibility service BY DEFAULT
         * — but the user can still choose to block them by explicitly adding them
         * to their standalone block list or removing them from their focus-allowed
         * list. The TS UI shows a "Sensitive" badge and a confirmation dialog
         * (see SENSITIVE_APPS in src/components/AppPickerSheet.tsx) before letting
         * the user opt in, so the rename of this constant emphasises that these
         * apps CAN be blocked AFTER a warning — they are not unconditionally
         * allowed. Contrast with NEVER_BLOCK below, which is hard-locked and
         * cannot be overridden by any setting.
         *
         * Why include them at all? Two reasons:
         *   1. Safety nets — launcher / dialer / SystemUI must keep working so
         *      the user is not trapped on a blank screen during a session.
         *   2. Loop prevention — pressing HOME sends the user to the launcher
         *      which fires TYPE_WINDOW_STATE_CHANGED; without this set the
         *      service would block the launcher too and create an infinite loop.
         *
         * Settings is included so the user can always reach FocusFlow's own
         * settings to stop a session. Specific dangerous Settings sub-pages
         * (accessibility, clear-data, date/time) are intercepted further down
         * by content inspection during a session, regardless of this set.
         */
        val BLOCKABLE_AFTER_WARNING: Set<String> = setOf(
            // Core Android OS
            "android",
            "com.android.systemui",
            "com.sec.android.app.systemui",
            "com.samsung.android.systemui",
            // Launchers / home screens
            "com.sec.android.app.launcher",          // Samsung One UI
            "com.samsung.android.app.launcher",
            "com.samsung.android.incallui",          // Samsung call screen
            "com.samsung.android.app.powerkey",
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
            "com.samsung.crane",
            "com.samsung.android.dialer",
            "com.android.providers.telephony",
            "com.android.server.telecom",
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
            // ── Home launchers ─────────────────────────────────────────────────
            // If a launcher is blocked the user has no way to reach the home
            // screen during a session — pressing HOME just lands back on the
            // block overlay. This protection cannot be overridden.
            "com.android.launcher", "com.android.launcher2", "com.android.launcher3",
            "com.sec.android.app.launcher",            // Samsung OneUI
            "com.samsung.android.app.launcher",
            "com.google.android.apps.nexuslauncher",   // Pixel / stock
            "com.miui.home", "com.miui.launcher",      // Xiaomi / MIUI
            "com.huawei.android.launcher",             // Huawei / EMUI
            "com.hihonor.launcher",                    // Honor
            "com.coloros.launcher",                    // Oppo / ColorOS
            "com.oppo.launcher",                       // Oppo legacy
            "com.oneplus.launcher",                    // OnePlus OxygenOS
            "com.bbk.launcher2", "com.vivo.launcher",  // Vivo
            "com.iqoo.launcher",                       // iQOO / Funtouch
            "com.realme.launcher",                     // Realme UI
            "com.motorola.launcher3",                  // Motorola
            "com.nothing.launcher",                    // Nothing OS
            "com.asus.launcher", "com.ZenUI.launcher", // Asus
            "com.lge.launcher3",                       // LG
            "com.htc.launcher",                        // HTC
            "com.sonyericsson.home",                   // Sony Xperia
            "com.tcl.launcher",                        // TCL
            "com.nokia.launcher",                      // Nokia
            "com.infinix.launcher",                    // Infinix
            "com.transsion.launcher",                  // Transsion / itel / Tecno
            // ── Emergency / in-call UI ────────────────────────────────────────
            "com.android.phone",                       // AOSP telephony
            "com.android.dialer",                      // AOSP dialer
            "com.google.android.dialer",               // Pixel / Google dialer
            "com.android.emergencydialer",             // Emergency dialer (any OEM)
            "com.google.android.incallui",             // Google in-call UI
            // Samsung
            "com.samsung.crane",
            "com.samsung.android.dialer",
            "com.samsung.android.app.telephonyui",
            "com.samsung.android.incallui",
            "com.sec.android.app.dialertab",
            "com.android.providers.telephony",
            "com.android.server.telecom",
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
            // ── Caller ID / spam-call protection ─────────────────────────────
            "com.truecaller",                          // Truecaller — caller ID + spam block
            "com.truecaller.pro",                      // Truecaller Premium variant
            // ── Media / education / clock (legacy never-block list) ──────────
            "org.videolan.vlc",
            "com.gurukripa.publicapp",                 // Gurukripa (GCI) public app
            "xyz.penpencil.physicswala",               // PhysicsWallah (PW)
            "digital.allen.study",                     // Allen Digital
            "com.sec.android.app.clockpackage",
            "com.samsung.android.clockpackage",
            "com.android.deskclock",
            "com.google.android.deskclock",
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
        private const val RETRY_INTERVAL_MS = 150L

        // ── Keyword blocker: URL / search field detection ─────────────────────

        /** Debounce for TYPE_VIEW_TEXT_CHANGED — avoids firing on every keystroke. */
        private const val TEXT_DEBOUNCE_MS = 400L

        /** Throttle for TYPE_WINDOW_CONTENT_CHANGED per package — very noisy event. */
        private const val CONTENT_SCAN_THROTTLE_MS = 2_000L

        /**
         * View ID substrings that identify URL bars and search input fields.
         * Checked case-insensitively against event.source.viewIdResourceName.
         */
        private val URL_BAR_VIEW_IDS = listOf(
            "url_bar", "url_edit", "url_field", "address_bar", "address_text",
            "location_bar", "location_edit", "omnibar_text", "omnibox_text",
            "search_src_text", "search_box", "search_bar", "search_edit",
            "query", "mozac_browser_toolbar_url_view", "toolbar_edit_text"
        )

        /**
         * Known browser and search-capable packages.
         * Used to trigger full deep-scan + URL substring matching in
         * TYPE_WINDOW_STATE_CHANGED events so that page URLs are caught.
         */
        val BROWSER_PACKAGES: Set<String> = setOf(
            "com.android.chrome",
            "com.chrome.beta",
            "com.chrome.dev",
            "com.chrome.canary",
            "com.google.android.googlequicksearchbox",   // Google Search / Discover
            "org.mozilla.firefox",
            "org.mozilla.fenix",
            "org.mozilla.firefox_beta",
            "com.sec.android.app.sbrowser",              // Samsung Internet
            "com.samsung.android.sbrowser",
            "com.brave.browser",
            "com.brave.browser_beta",
            "com.opera.browser",
            "com.opera.mini.native",
            "com.microsoft.emmx",                        // Edge
            "com.UCMobile.intl",                         // UC Browser
            "com.kiwibrowser.browser",
            "com.vivaldi.browser",
            "com.duckduckgo.mobile.android",
            "com.cloudmosa.puffinFree",
            "com.uc.browser.en"
        )
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

    // ── Keyword blocker: debounce + throttle state ────────────────────────────
    // Text-changed events fire on every keystroke — we debounce the keyword check
    // so it only runs 400 ms after the user stops typing.
    private var textDebounceRunnable: Runnable? = null
    // Content-changed events fire on every layout pass — throttled per package.
    private val lastContentScanMs = mutableMapOf<String, Long>()

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
        val ev = event ?: return

        // ── Route non-window-state events to specialised handlers ─────────────
        when (ev.eventType) {
            AccessibilityEvent.TYPE_VIEW_TEXT_CHANGED -> {
                handleTextChanged(ev)
                return
            }
            AccessibilityEvent.TYPE_WINDOW_CONTENT_CHANGED -> {
                handleContentChanged(ev)
                return
            }
            AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED -> { /* handled below */ }
            else -> return
        }

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
        // ── Always-on enforcement (session-independent) ───────────────────────
        // When true, standalone block list + daily allowance are enforced even
        // without an active focus task or timed standalone block session.
        // Does NOT affect the UI lock — settings can be changed when no timed
        // session is running (focusActive == false && saActive == false).
        val alwaysBlockActive = prefs.getBoolean(PREF_ALWAYS_BLOCK, false)
        val systemGuardEnabled = prefs.getBoolean(PREF_SYSTEM_GUARD_ENABLED, true)
        val blockInstallActions = prefs.getBoolean(PREF_BLOCK_INSTALL_ACTIONS, false)
        val blockYoutubeShorts  = prefs.getBoolean(PREF_BLOCK_YT_SHORTS, false)
        val blockInstagramReels = prefs.getBoolean(PREF_BLOCK_IG_REELS, false)

        // ── Cooldown reset: fired when user taps ✕ to dismiss the overlay ───
        // BlockOverlayActivity writes this flag on intentional dismiss so the
        // next open of the same blocked app is caught immediately (no 2 s gap).
        if (prefs.getBoolean("block_cooldown_reset", false)) {
            prefs.edit().putBoolean("block_cooldown_reset", false).apply()
            lastBlockedPkg = null
            lastBlockedAtMs = 0L
        }

        val pkg = ev.packageName?.toString() ?: return
        val cls = ev.className?.toString() ?: ""

        // Update foreground package tracker so retries can guard against
        // pressing Home when the user has already switched to an allowed app.
        lastSeenPkg = pkg

        // Persist current foreground package AND class name.
        // BlockOverlayActivity uses the class name to distinguish trusted FocusFlow
        // screens (MainActivity, SettingsActivity) from any deeplink/custom-tab
        // activity in the same package — which is the self-package loophole.
        prefs.edit()
            .putString("current_foreground_pkg", pkg)
            .putString("current_foreground_cls", cls)
            .apply()

        // ── Recents screen block ─────────────────────────────────────────────
        // During task-based focus only: the overview screen shows thumbnails of
        // recent tasks, so the user could read blocked-app content without opening
        // it.  We press HOME to prevent this.
        // During standalone block we leave recents alone — the user is not in a
        // timed focus session and being kicked out of the task switcher feels
        // unexpected.
        if (focusActive) {
            if (isRecentsScreen(pkg, cls, ev)) {
                handler.post { performGlobalAction(GLOBAL_ACTION_HOME) }
                return
            }
        }

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
        // It also lives BEFORE the BLOCKABLE_AFTER_WARNING early-return below
        // so that the launcher (which is in BLOCKABLE_AFTER_WARNING) correctly
        // triggers it after the user presses HOME.
        val awaitingPkg = prefs.getString("overlay_awaiting_pkg", "") ?: ""
        if (awaitingPkg.isNotEmpty() && !pkg.equals(awaitingPkg, ignoreCase = true)) {
            prefs.edit()
                .putBoolean(BlockOverlayActivity.PREF_OVERLAY_X_READY, true)
                .putString("overlay_awaiting_pkg", "")
                .apply()
            // Also reveal directly on the WindowManager overlay (no polling needed)
            revealWindowXButton()
            // Post a brief "session active" reminder on the home screen so the
            // user is not silently returned to a blank launcher with no context.
            postHomeScreenReminder()
        }

        // ── NEVER_BLOCK packages ──────────────────────────────────────────────
        // Phone dialers (all OEM variants) and WhatsApp are unconditionally
        // allowed. No user setting, standalone block, or focus session can
        // override this. This check runs before BLOCKABLE_AFTER_WARNING so
        // that even if a user somehow adds one of these packages to a block
        // list, the block is silently ignored.
        if (NEVER_BLOCK.any { pkg.equals(it, ignoreCase = true) }) {
            return
        }

        // ── BLOCKABLE_AFTER_WARNING packages ──────────────────────────────────
        // These are bypassed by default so the user is never trapped (launcher,
        // dialer, Settings, etc.) — but the user can opt to block any of them
        // via the picker after the "Sensitive" confirmation dialog. We intercept
        // dangerous Settings sub-pages (accessibility, clear data, date/time)
        // separately during a focus session.
        if (BLOCKABLE_AFTER_WARNING.any { pkg.equals(it, ignoreCase = true) }) {

            // ── User explicit opt-in ──────────────────────────────────────────
            // If the user deliberately added a BLOCKABLE_AFTER_WARNING package
            // (e.g. Settings) to their standalone blocked list or excluded it
            // from their focus allowed list, honour that choice — the warning
            // dialog already happened in the UI before they got here.
            if (saActive || alwaysBlockActive) {
                val saJson = prefs.getString(PREF_SA_PKGS, "[]") ?: "[]"
                val alwaysJson = prefs.getString(PREF_ALWAYS_BLOCK_PKGS, "[]") ?: "[]"
                val combinedList = parseJsonArray(saJson) + parseJsonArray(alwaysJson)
                if (combinedList.any { it.equals(pkg, ignoreCase = true) }) {
                    val samePackage = pkg == lastBlockedPkg
                    val cooldownExpired = (now - lastBlockedAtMs) > 2_000L
                    if (!samePackage || cooldownExpired) {
                        lastBlockedPkg = pkg
                        lastBlockedAtMs = now
                        handleBlockedApp(pkg)
                        scheduleRetryCheck(pkg, 1, focusActive, saActive, alwaysBlockActive)
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
                        scheduleRetryCheck(pkg, 1, focusActive, saActive, alwaysBlockActive)
                    }
                    return
                }
            }

            // System Protection runs continuously whenever the toggle is on.
            // It does NOT require an active focus session or standalone block —
            // the user explicitly opted in to lock these system controls all the
            // time (the toggle in Block Enforcement is off by default).
            if (systemGuardEnabled) {
                val isSamsungPowerKey = pkg == "com.samsung.android.app.powerkey"
                if (isSamsungPowerKey && isPowerMenu(ev)) {
                    handlePowerMenuIntercepted()
                    return
                }

                val isSystemUiPkg = pkg == "com.android.systemui" ||
                    pkg == "com.sec.android.app.systemui" ||
                    pkg == "com.samsung.android.systemui"
                if (isSystemUiPkg) {
                    // FIX: notification shade events from SystemUI were being
                    // misclassified as power-menu when notification text happened
                    // to contain words like "restart" / "reboot" / "shut down".
                    // Detect the notification panel FIRST and bail — only fall
                    // through to power-menu detection when the shade is closed.
                    if (isNotificationPanelExpanded(ev)) {
                        return
                    }
                    if (isPowerMenu(ev)) {
                        handlePowerMenuIntercepted()
                        return
                    }
                    return
                }

                // ── Launcher power-off dialog (e.g. One UI Home long-press power button) ──
                // Some OEMs (Samsung One UI) show the power-off confirmation from the launcher
                // package rather than from SystemUI or the powerkey package.
                val isLauncherPkg = pkg == "com.sec.android.app.launcher" ||
                    pkg == "com.samsung.android.app.launcher" ||
                    pkg == "com.google.android.apps.nexuslauncher" ||
                    pkg == "com.android.launcher3" ||
                    pkg == "com.android.launcher" ||
                    pkg == "com.miui.home" ||
                    pkg == "com.oneplus.launcher" ||
                    pkg == "com.huawei.android.launcher" ||
                    pkg == "com.oppo.launcher" ||
                    pkg == "com.bbk.launcher2"
                if (isLauncherPkg && isPowerMenu(ev)) {
                    handlePowerMenuIntercepted()
                    return
                }

                // Block uninstall dialogs — show overlay so user sees why they're blocked.
                if (isUninstallDialog(ev)) {
                    handleBlockedApp(pkg)
                    return
                }
                // Block accessibility settings to prevent disabling this service mid-session.
                if (isAccessibilitySettingsPage(ev)) {
                    handleBlockedApp(pkg)
                    return
                }
                // Block "Clear data / Clear storage" dialogs in Settings during any block session.
                if (isClearDataDialog(ev)) {
                    handleBlockedApp(pkg)
                    return
                }
                // Block date/time settings to prevent clock manipulation.
                if (isDateTimeSettingsPage(ev)) {
                    handleBlockedApp(pkg)
                    return
                }
                // Block Usage Access settings to prevent revoking usage permission.
                if (isUsageAccessSettingsPage(ev)) {
                    handleBlockedApp(pkg)
                    return
                }
                // Block Battery Optimization settings to prevent killing the blocking service.
                if (isBatteryOptimizationSettingsPage(ev)) {
                    handleBlockedApp(pkg)
                    return
                }
                // Block Device Admin settings to prevent deactivating admin rights.
                if (isDeviceAdminSettingsPage(ev)) {
                    handleBlockedApp(pkg)
                    return
                }
                // Block Developer Options to prevent ADB, "Don't keep activities", etc.
                if (isDeveloperOptionsPage(ev)) {
                    handleBlockedApp(pkg)
                    return
                }
                // Block Reset settings pages — would disable accessibility service or wipe the phone.
                if (isResetSettingsPage(ev)) {
                    handleBlockedApp(pkg)
                    return
                }
                // Block Special Access page — gateway to device admin, overlay, usage access, etc.
                if (isSpecialAccessPage(ev)) {
                    handleBlockedApp(pkg)
                    return
                }
            }
            return
        }

        // ── Content-specific guards ──────────────────────────────────────────
        // Each toggle is opt-in and runs continuously whenever it is on —
        // independent of any focus session or standalone block. The user
        // explicitly opted in by enabling the toggle in Block Enforcement.
        //
        //   • blockInstallActions  — Play Store / packageinstaller install,
        //                            update, and uninstall confirmation dialogs.
        //   • blockYoutubeShorts   — YouTube Shorts player (rest of YouTube OK).
        //   • blockInstagramReels  — Instagram Reels / clips viewer (rest of IG OK).
        if (blockInstallActions && isInstallActionContext(ev, pkg)) {
            handleBlockedApp(pkg)
            return
        }
        if (blockYoutubeShorts && pkg == "com.google.android.youtube" && isYoutubeShorts(ev)) {
            handleBlockedApp(pkg)
            return
        }
        if (blockInstagramReels && pkg == "com.instagram.android" && isInstagramReels(ev)) {
            handleBlockedApp(pkg)
            return
        }

        // ── Word blocking ─────────────────────────────────────────────────────
        // The Keyword Blocker runs continuously whenever any blocked words are
        // configured — the user explicitly added them, so enforcement is always
        // on. No focus session or standalone block is required.
        //
        // For browser packages: also extract the URL bar text and do a substring
        // (non-whole-word) match, so "gaming" catches "gaming.com/news" in the URL.
        run {
            val blockedWords = getBlockedWords()
            if (blockedWords.isNotEmpty()) {
                val isBrowser = BROWSER_PACKAGES.contains(pkg)
                if (isBrowser) {
                    // Deep full scan for browsers + also extract URL bar specifically
                    if (containsBlockedWordBrowser(ev, blockedWords)) {
                        handleBlockedApp(pkg)
                        return
                    }
                } else {
                    if (containsBlockedWord(ev, blockedWords)) {
                        handleBlockedApp(pkg)
                        return
                    }
                }
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

        // If neither session nor always-on enforcement is active, nothing to enforce.
        if (!focusActive && !saActive && !alwaysBlockActive) {
            lastBlockedPkg = null
            return
        }

        // ── Explicit block check: standalone list or focus-mode blocked ──────
        // If the app is explicitly in the standalone blocked list, or explicitly
        // blocked by focus mode (not in the allowed list), it must be blocked
        // immediately — daily allowance does NOT override an explicit block.
        // This must run BEFORE the daily allowance check so that an app in both
        // the block list and the allowance list is always blocked, never let through.
        val explicitlyBlocked = isPackageBlocked(pkg, focusActive, saActive, alwaysBlockActive)
        if (explicitlyBlocked) {
            val samePackage = pkg == lastBlockedPkg
            val cooldownExpired = (now - lastBlockedAtMs) > 2_000L
            if (!samePackage || cooldownExpired) {
                lastBlockedPkg = pkg
                lastBlockedAtMs = now
                handleBlockedApp(pkg)
                scheduleRetryCheck(pkg, 1, focusActive, saActive, alwaysBlockActive)
            }
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
                }
                // else: same app still in foreground — already recorded, just let it through
                lastBlockedPkg = null
                return // Allowed — within allowance
            }
            // Allowance exhausted — block during any active session or always-on mode.
            val samePackage = pkg == lastBlockedPkg
            val cooldownExpired = (now - lastBlockedAtMs) > 2_000L
            if (!samePackage || cooldownExpired) {
                lastBlockedPkg = pkg
                lastBlockedAtMs = now
                handleBlockedApp(pkg)
                scheduleRetryCheck(pkg, 1, focusActive, saActive, alwaysBlockActive)
            }
            return
        }

        val isBlocked = isPackageBlocked(pkg, focusActive, saActive, alwaysBlockActive)

        if (isBlocked) {
            val samePackage = pkg == lastBlockedPkg
            val cooldownExpired = (now - lastBlockedAtMs) > 2_000L
            if (!samePackage || cooldownExpired) {
                lastBlockedPkg = pkg
                lastBlockedAtMs = now
                handleBlockedApp(pkg)
                scheduleRetryCheck(pkg, 1, focusActive, saActive, alwaysBlockActive)
            }
        } else {
            lastBlockedPkg = null
        }
    }

    override fun onInterrupt() {
        lastBlockedPkg = null
        dismissWindowOverlay()
    }

    // ─── Retry mechanism ──────────────────────────────────────────────────────

    /**
     * Schedules up to [MAX_RETRY_ATTEMPTS] re-checks at [RETRY_INTERVAL_MS] ms intervals
     * to catch apps that relaunch themselves after the initial dismissal.
     *
     * Each retry re-shows the block overlay AND presses BACK+HOME so the blocked
     * app is forcefully removed from the foreground even on slow devices.
     */
    private fun scheduleRetryCheck(
        pkg: String,
        attempt: Int,
        focusWasActive: Boolean,
        saWasActive: Boolean,
        alwaysBlockWasActive: Boolean = false,
    ) {
        if (attempt > MAX_RETRY_ATTEMPTS) return
        handler.postDelayed({
            val focusActive  = prefs.getBoolean(PREF_FOCUS_ON, false)
            val saActive     = prefs.getBoolean(PREF_SA_ACTIVE, false)
            val alwaysBlock  = prefs.getBoolean(PREF_ALWAYS_BLOCK, false)
            if (!focusActive && !saActive && !alwaysBlock) return@postDelayed
            // Guard: only act if the blocked package is still in the foreground.
            // Without this check, retries would press Home even after the user has
            // already navigated to a legitimate allowed app, causing false kicks.
            if (lastSeenPkg != pkg) return@postDelayed
            val isBlocked = isPackageBlocked(pkg, focusActive, saActive, alwaysBlock)
            val allowanceExhausted = run {
                val entry = findAllowanceEntry(pkg)
                entry != null && !isAllowanceAvailable(pkg, entry)
            }
            if (isBlocked || allowanceExhausted) {
                // Re-raise the overlay in case it was dismissed or never rendered,
                // then kick the app out again.
                launchBlockOverlay(pkg)
                dismissPackage(pkg)
                scheduleRetryCheck(pkg, attempt + 1, focusActive, saActive, alwaysBlock)
            }
        }, RETRY_INTERVAL_MS * attempt)
    }

    // ─── System UI: notification panel + power menu detection ────────────────

    /**
     * Returns true when the SystemUI window event represents the power-off /
     * restart / emergency-mode dialog (GlobalActions).
     *
     * Covers AOSP GlobalActionsDialog, Samsung SecGlobalActions, and the generic
     * system dialog that appears on most OEMs when the power button is held.
     */
    private fun isPowerMenu(event: AccessibilityEvent): Boolean {
        val className = event.className?.toString() ?: ""
        val classLower = className.lowercase()
        val powerKeywords = listOf(
            // AOSP / stock Android
            "globalactions",
            "globalactionsdialog",
            "globalactionslayout",      // Android 14+ on some devices
            "globalpowermenulayout",
            // Samsung One UI
            "secglobalactions",
            "secglobalactionsdialog",
            // Generic OEM names
            "powermenudialog",
            "powermenu",
            "power_menu",
            "poweroffdialog",
            "rebootdialog",
            "shutdowndialog",
            "shutdown",
            // MIUI / HyperOS
            "miuiglobalactionsdialog",
            "miuipowermenudialog",
        )
        if (powerKeywords.any { classLower.contains(it) }) return true

        val textLower = getEventAndNodeText(event, maxDepth = 5).lowercase()
        // Pruned text-keyword fallback: removed single ambiguous words like
        // "restart", "reboot", "shut down", "side key settings" because they
        // appear inside common notifications (system updates, download prompts,
        // app names) and were causing the notification shade to be misread as
        // the power menu. Kept only high-signal full phrases.
        val powerTextKeywords = listOf(
            "power off",
            "power down",
            "tap again to turn off",         // Samsung One UI Home confirmation text
            "tap again to power off",
            "press again to power off",
            "emergency mode saves battery power",
            "providing only essential apps",
            "turning off mobile data when the screen is off",
            "emergency call",
        )
        return powerTextKeywords.any { it in textLower }
    }

    /**
     * Returns true when the SystemUI window event represents an expanded
     * notification panel or quick-settings panel.
     *
     * Covers notification shade / quick settings only. This intentionally has no
     * package-level fallback because alarms and other full-screen OS surfaces may
     * also arrive from SystemUI while the screen is off.
     */
    private fun isNotificationPanelExpanded(event: AccessibilityEvent): Boolean {
        val className = event.className?.toString() ?: ""
        val classLower = className.lowercase()

        val panelKeywords = listOf(
            // AOSP
            "notificationpanel",
            "notificationshade",
            "notificationshadedeprecatedview",
            "notificationshadewindowview",
            "expandedview",
            "qspanel",
            "quicksettings",
            "quicksettingscontroller",
            // Samsung One UI 4 / 5 / 6
            "samsungqspanel",
            "samsungshade",
            // MIUI
            "miuinotificationpanelviewcontroller",
            "miuiqspanel",
            // OnePlus / OxygenOS
            "oplusqspanel",
        )
        if (panelKeywords.any { classLower.contains(it) }) return true

        val visibleText = getEventAndNodeText(event).lowercase()
        val panelTextGroups = listOf(
            listOf("quick settings"),
            listOf("quick panel"),
            listOf("notification settings"),
            listOf("clear all", "notification"),
            listOf("silent notifications"),
            listOf("media output", "device control"),
            listOf("brightness", "wi-fi", "bluetooth"),
        )
        return panelTextGroups.any { group -> group.all { it in visibleText } }
    }

    /**
     * Sends ACTION_CLOSE_SYSTEM_DIALOGS broadcast as a best-effort first layer
     * to close any open system dialog (power menu, notification panel, etc.).
     *
     * Works on Android ≤ 11 (API 30). On Android 12+ (API 31) the system silently
     * ignores this broadcast from non-system apps — we eat the SecurityException and
     * fall back to GLOBAL_ACTION_BACK + GLOBAL_ACTION_HOME.
     */
    @Suppress("DEPRECATION")
    private fun closeSystemDialogsBroadcast() {
        if (Build.VERSION.SDK_INT <= Build.VERSION_CODES.R) {
            try {
                @Suppress("InlinedApi")
                sendBroadcast(Intent(Intent.ACTION_CLOSE_SYSTEM_DIALOGS))
            } catch (_: Exception) {
                // Silently ignored — broadcast disallowed on this ROM/API level
            }
        }
    }

    /**
     * Collapses the status bar / notification panel using StatusBarManager
     * reflection.  This is the same call used by BlockOverlayActivity.
     * Falls back silently on ROMs where reflection fails.
     */
    private fun collapseStatusBarPanel() {
        try {
            @Suppress("WrongConstant")
            val sbService = getSystemService("statusbar") ?: return
            val sbClass = Class.forName("android.app.StatusBarManager")
            sbClass.getMethod("collapsePanels").invoke(sbService)
        } catch (_: Exception) {
            // Silently ignore — not all ROMs expose this API
        }
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

    /**
     * Returns true if [event] represents the Android recents / overview screen.
     *
     * The recents screen shows task thumbnails — the user can read blocked-app
     * content (web pages, messages, etc.) without launching the app. We detect
     * it by a combination of:
     *   • Package name matching SystemUI variants across OEMs
     *   • Class name containing "recents", "overview", or "launcher3.recents"
     *   • Event text containing "recent apps" or "overview" titles
     *
     * When detected during an active session, the caller sends GLOBAL_ACTION_HOME
     * to close the recents drawer immediately.
     */
    private fun isRecentsScreen(pkg: String, cls: String, event: AccessibilityEvent): Boolean {
        val clsLower = cls.lowercase()

        val isSystemUiPkg = pkg == "com.android.systemui" ||
            pkg == "com.sec.android.app.systemui" ||
            pkg == "com.samsung.android.systemui"

        val isLauncherPkg = pkg == "com.android.launcher3" ||
            pkg == "com.google.android.apps.nexuslauncher" ||
            pkg == "com.miui.home" ||
            pkg == "com.sec.android.app.launcher" ||
            pkg == "com.samsung.android.app.launcher" ||
            pkg == "com.oneplus.launcher" ||
            pkg == "com.huawei.android.launcher" ||
            pkg == "com.oppo.launcher" ||
            pkg == "com.bbk.launcher2"

        val classIndicatesRecents = clsLower.contains("recents") ||
            clsLower.contains("overview") ||
            clsLower.contains("recentstaskview") ||
            clsLower.contains("fallbackrecentsactivity") ||
            clsLower.contains("quickstepfallback")

        if ((isSystemUiPkg || isLauncherPkg) && classIndicatesRecents) return true

        val eventText = buildString {
            event.text?.forEach { append(it); append(' ') }
        }.lowercase()
        if ((isSystemUiPkg || isLauncherPkg) &&
            ("recent apps" in eventText || "overview" in eventText)) return true

        return false
    }

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

    private fun isPackageBlocked(
        pkg: String,
        focusActive: Boolean,
        saActive: Boolean,
        alwaysBlockActive: Boolean = false,
    ): Boolean {
        if (ALWAYS_BLOCKED.any { pkg.equals(it, ignoreCase = true) }) return true

        if (focusActive || saActive || alwaysBlockActive) {
            if (INSTALLER_PACKAGES.any { pkg.equals(it, ignoreCase = true) }) return true
        }

        if (focusActive) {
            val allowedJson = prefs.getString(PREF_ALLOWED_PKG, "[]") ?: "[]"
            val allowedList = parseJsonArray(allowedJson)
            if (allowedList.isNotEmpty()) {
                // Explicit per-task allow-list: block anything not on it.
                val isAllowed = allowedList.any { a -> pkg.equals(a, ignoreCase = true) }
                if (!isAllowed) return true
            } else {
                // No explicit allow-list.
                // If daily allowance entries are configured, treat those packages
                // as the effective allow-list so everything else is blocked.
                // This enforces "only your budgeted apps can be opened in focus mode."
                val allowanceConfig = prefs.getString(PREF_DAILY_ALLOWANCE_CONFIG, null)
                if (!allowanceConfig.isNullOrBlank() && allowanceConfig != "null") {
                    try {
                        val arr = org.json.JSONArray(allowanceConfig)
                        if (arr.length() > 0) {
                            val inAllowance = (0 until arr.length()).any {
                                arr.getJSONObject(it).optString("packageName", "")
                                    .equals(pkg, ignoreCase = true)
                            }
                            if (!inAllowance) return true
                        }
                    } catch (_: Exception) {}
                }
            }
        }

        if (saActive) {
            val saJson = prefs.getString(PREF_SA_PKGS, "[]") ?: "[]"
            val saList = parseJsonArray(saJson)
            if (saList.any { b -> pkg.equals(b, ignoreCase = true) }) return true
        }

        // Always-on block — enforced even without a timed session.
        if (alwaysBlockActive) {
            val alwaysJson = prefs.getString(PREF_ALWAYS_BLOCK_PKGS, "[]") ?: "[]"
            val alwaysList = parseJsonArray(alwaysJson)
            if (alwaysList.any { b -> pkg.equals(b, ignoreCase = true) }) return true
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
        if (wallpaperPath.isNotEmpty()) {
            try {
                val bmp = if (wallpaperPath.startsWith("content://")) {
                    contentResolver.openInputStream(Uri.parse(wallpaperPath))?.use { BitmapFactory.decodeStream(it) }
                } else {
                    BitmapFactory.decodeFile(wallpaperPath.removePrefix("file://"))
                }
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
        AversiveActionsManager.stopAll(this)
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
        AversiveActionsManager.stopAll(this)
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
            handler.postDelayed({ performGlobalAction(GLOBAL_ACTION_HOME) }, 80L)
            handler.postDelayed({ performGlobalAction(GLOBAL_ACTION_BACK) }, 100L)
        }
    }

    /**
     * Posts a brief heads-up ("peek") notification when the user returns to the home
     * screen after being kicked from a blocked app.
     *
     * Without this, the home screen is silent — the user has no reminder that a
     * session is still running and the block is still enforced. This notification:
     *   • Has HIGH importance so it peeks from the top of the screen momentarily
     *   • Auto-cancels after the user sees it (does not clutter the shade)
     *   • Taps into FocusFlow (MainActivity) so the user can check their task
     *   • Only fires when at least one blocking mode is still active
     *
     * Uses the existing BLOCK_ALERT_CHANNEL (HIGH importance) to avoid creating
     * a new channel that the user would need to configure.
     */
    private fun postHomeScreenReminder() {
        val focusActive      = prefs.getBoolean(PREF_FOCUS_ON, false)
        val saActive         = prefs.getBoolean(PREF_SA_ACTIVE, false)
        val alwaysBlockActive = prefs.getBoolean(PREF_ALWAYS_BLOCK, false)
        if (!focusActive && !saActive && !alwaysBlockActive) return

        val taskName = prefs.getString("task_name", null)
        val title    = "Block enforcement active"
        val text     = when {
            !taskName.isNullOrBlank() -> "Working on: $taskName"
            focusActive               -> "Focus session is running"
            saActive                  -> "Standalone block is running"
            else                      -> "App blocking is always on"
        }

        try {
            val nm = getSystemService(android.app.NotificationManager::class.java) ?: return

            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                val existing = nm.getNotificationChannel(BLOCK_ALERT_CHANNEL)
                if (existing == null) {
                    val ch = android.app.NotificationChannel(
                        BLOCK_ALERT_CHANNEL, "Block Alert",
                        android.app.NotificationManager.IMPORTANCE_HIGH
                    ).apply {
                        setBypassDnd(true)
                        lockscreenVisibility = android.app.Notification.VISIBILITY_PUBLIC
                    }
                    nm.createNotificationChannel(ch)
                }
            }

            val tapIntent = android.content.Intent(
                this,
                Class.forName("${packageName}.MainActivity")
            ).apply { flags = android.content.Intent.FLAG_ACTIVITY_SINGLE_TOP }

            val tapPending = android.app.PendingIntent.getActivity(
                this, 8800, tapIntent,
                android.app.PendingIntent.FLAG_UPDATE_CURRENT or android.app.PendingIntent.FLAG_IMMUTABLE
            )

            val notif = androidx.core.app.NotificationCompat.Builder(this,
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) BLOCK_ALERT_CHANNEL else "default"
            )
                .setSmallIcon(com.tbtechs.focusflow.R.mipmap.ic_launcher)
                .setContentTitle(title)
                .setContentText(text)
                .setPriority(androidx.core.app.NotificationCompat.PRIORITY_HIGH)
                .setAutoCancel(true)
                .setContentIntent(tapPending)
                .build()

            nm.notify(8800, notif)

            // Auto-cancel after 4 s — enough time for the user to notice,
            // short enough that it doesn't clutter the notification shade.
            handler.postDelayed({ nm.cancel(8800) }, 4_000L)

        } catch (_: Exception) {
            // Best-effort — never crash the accessibility service
        }
    }

    /**
     * Called whenever any power-menu dialog is detected by the system guard.
     *
     * Shows the block overlay immediately (so the user sees WHY they were blocked),
     * then fires BACK + HOME to close the power menu.  A retry loop re-checks up
     * to 3 times at 200 ms intervals in case the power menu re-asserts itself on
     * slow devices or certain OEM configurations.
     */
    private fun handlePowerMenuIntercepted() {
        // Show the block overlay straight away — user sees "Power Menu" blocked label
        prefs.edit().putString("overlay_awaiting_pkg", "system.power_menu").apply()
        launchBlockOverlay("system.power_menu")

        // Dismiss immediately (no artificial delay for the first BACK)
        closeSystemDialogsBroadcast()
        performGlobalAction(GLOBAL_ACTION_BACK)
        handler.postDelayed({ performGlobalAction(GLOBAL_ACTION_HOME) }, 100L)
        handler.postDelayed({ performGlobalAction(GLOBAL_ACTION_BACK) }, 220L)

        // Schedule retries to catch slow / stubborn power menus
        schedulePowerMenuRetry(1)
    }

    /**
     * Retry loop for power menu dismissal.
     *
     * After the initial BACK+HOME, the power menu occasionally re-appears on
     * Samsung devices (especially One UI 6+).  This fires at 200 ms, 400 ms,
     * and 600 ms after the first interception and presses BACK+HOME again if a
     * known power-system package is still the foreground window.
     *
     * Retries stop as soon as the foreground moves away from power-related
     * packages (i.e. the user is back at the launcher or an allowed app).
     */
    private fun schedulePowerMenuRetry(attempt: Int) {
        if (attempt > 3) return
        handler.postDelayed({
            val focusActive  = prefs.getBoolean(PREF_FOCUS_ON, false)
            val saActive     = prefs.getBoolean(PREF_SA_ACTIVE, false)
            val sysGuard     = prefs.getBoolean(PREF_SYSTEM_GUARD_ENABLED, true)
            if ((!focusActive && !saActive) || !sysGuard) return@postDelayed

            // Only retry for true system-level power packages, not the launcher
            val lp = lastSeenPkg ?: return@postDelayed
            val isPowerSystemPkg =
                lp == "com.samsung.android.app.powerkey" ||
                lp == "com.android.systemui" ||
                lp == "com.sec.android.app.systemui" ||
                lp == "com.samsung.android.systemui"

            if (isPowerSystemPkg) {
                closeSystemDialogsBroadcast()
                performGlobalAction(GLOBAL_ACTION_BACK)
                handler.postDelayed({ performGlobalAction(GLOBAL_ACTION_HOME) }, 100L)
                schedulePowerMenuRetry(attempt + 1)
            }
        }, 200L * attempt)
    }

    /**
     * Returns the human-readable label for [packageName] via PackageManager.
     * Falls back to the package name itself on any error.
     */
    private fun resolveAppDisplayName(packageName: String): String {
        if (packageName == "system.power_menu") return "Power Menu"
        return try {
            val pm = applicationContext.packageManager
            val info = pm.getApplicationInfo(packageName, 0)
            pm.getApplicationLabel(info).toString()
        } catch (_: Exception) {
            packageName
        }
    }

    // ─── Keyword blocker: text-changed + content-changed handlers ────────────

    /**
     * Handles TYPE_VIEW_TEXT_CHANGED events.
     *
     * Fires when the user types in ANY EditText — URL bars, search boxes, comment
     * fields, etc.  We debounce the check by [TEXT_DEBOUNCE_MS] ms so the
     * keyword test only runs after the user pauses typing, not on every character.
     *
     * Matching uses substring (no word boundaries) for URL/search context — a
     * keyword like "gaming" will match "gaming.com" or "best+gaming+laptops".
     */
    private fun handleTextChanged(event: AccessibilityEvent) {
        val focusActive = prefs.getBoolean(PREF_FOCUS_ON, false)
        val saActive    = prefs.getBoolean(PREF_SA_ACTIVE, false)
        if (!focusActive && !saActive) return

        val words = getBlockedWords()
        if (words.isEmpty()) return

        val pkg = event.packageName?.toString() ?: return
        // Never intercept our own app or the always-allowed emergency set.
        if (pkg == packageName || NEVER_BLOCK.any { it.equals(pkg, ignoreCase = true) }) return

        // Collect the text being typed
        val text = buildString {
            event.text?.forEach { t -> t?.let { append(it) } }
            // Also pull from the source node for cases where event.text is empty
            event.source?.let { node ->
                try {
                    node.text?.let { append(it) }
                    // Also get the view ID so we know if this is a URL bar
                    val viewId = node.viewIdResourceName?.lowercase() ?: ""
                    // For URL bars in browsers: also collect placeholder (url hint text)
                    if (URL_BAR_VIEW_IDS.any { it in viewId } && node.hintText != null) {
                        append(' '); append(node.hintText)
                    }
                } finally {
                    node.recycle()
                }
            }
        }.trim()

        if (text.isBlank()) return

        // Debounce — cancel any pending check and schedule a new one
        textDebounceRunnable?.let { handler.removeCallbacks(it) }
        val captured = text
        val capturedPkg = pkg
        val runnable = Runnable {
            val stillFocusActive = prefs.getBoolean(PREF_FOCUS_ON, false)
            val stillSaActive    = prefs.getBoolean(PREF_SA_ACTIVE, false)
            if (!stillFocusActive && !stillSaActive) return@Runnable
            val currentWords = getBlockedWords()
            if (currentWords.isEmpty()) return@Runnable
            if (containsBlockedWordSubstring(captured, currentWords)) {
                handleBlockedApp(capturedPkg)
            }
        }
        textDebounceRunnable = runnable
        handler.postDelayed(runnable, TEXT_DEBOUNCE_MS)
    }

    /**
     * Handles TYPE_WINDOW_CONTENT_CHANGED events.
     *
     * This event fires on every layout pass — it is extremely noisy.  We only
     * process it for browser packages (to catch lazy-loaded page content and URL
     * bar updates that don't trigger WINDOW_STATE_CHANGED), and we throttle it to
     * at most once every [CONTENT_SCAN_THROTTLE_MS] ms per package.
     */
    private fun handleContentChanged(event: AccessibilityEvent) {
        val focusActive = prefs.getBoolean(PREF_FOCUS_ON, false)
        val saActive    = prefs.getBoolean(PREF_SA_ACTIVE, false)
        if (!focusActive && !saActive) return

        val pkg = event.packageName?.toString() ?: return
        if (pkg == packageName) return

        val now = System.currentTimeMillis()

        // ── Custom node rules — enforced for any foreground app ───────────────
        // NodeSpy-imported rules: each rule targets specific nodes by resId/text/cls
        // within a named package. Checked before the browser-only word scan so
        // rule matches short-circuit further processing.
        val rulesJson = prefs.getString(PREF_CUSTOM_NODE_RULES, "[]") ?: "[]"
        if (rulesJson.length > 2) { // non-empty JSON array (more than "[]")
            val throttleKey = "$pkg:cnr"
            val lastCnr = lastContentScanMs[throttleKey] ?: 0L
            if (now - lastCnr >= CONTENT_SCAN_THROTTLE_MS) {
                lastContentScanMs[throttleKey] = now
                event.source?.let { root ->
                    try {
                        if (checkCustomNodeRules(pkg, root, rulesJson)) return
                    } finally {
                        root.recycle()
                    }
                }
            }
        }

        // ── Blocked words — browser packages only (high-noise guard) ─────────
        val words = getBlockedWords()
        if (words.isEmpty()) return

        if (!BROWSER_PACKAGES.contains(pkg)) return

        val lastScan = lastContentScanMs[pkg] ?: 0L
        if (now - lastScan < CONTENT_SCAN_THROTTLE_MS) return
        lastContentScanMs[pkg] = now

        // Scan the URL bar specifically (fast path) then fall back to shallow scan
        val urlText = extractUrlBarText(event)
        if (urlText.isNotBlank() && containsBlockedWordSubstring(urlText, words)) {
            handleBlockedApp(pkg)
            return
        }
        // Also do a shallow node scan for visible page content
        val corpus = buildString {
            event.text?.forEach { t -> t?.let { append(it); append(' ') } }
            event.source?.let { root ->
                try { append(collectNodeTextShallow(root, maxDepth = 4)) }
                finally { root.recycle() }
            }
        }.lowercase()
        if (corpus.isNotBlank() && containsBlockedWordSubstring(corpus, words)) {
            handleBlockedApp(pkg)
        }
    }

    /**
     * Extracts text from the URL bar / address bar node for the given event.
     *
     * Walks the root node tree looking for a node whose view resource ID matches
     * one of the known URL bar patterns.  Returns an empty string if not found.
     */
    private fun extractUrlBarText(event: AccessibilityEvent): String {
        val root = event.source ?: return ""
        return try {
            findUrlBarText(root) ?: ""
        } finally {
            root.recycle()
        }
    }

    private fun findUrlBarText(node: AccessibilityNodeInfo): String? {
        val viewId = node.viewIdResourceName?.lowercase() ?: ""
        if (URL_BAR_VIEW_IDS.any { it in viewId }) {
            val text = node.text?.toString()
            if (!text.isNullOrBlank()) return text
        }
        for (i in 0 until node.childCount) {
            val child = node.getChild(i) ?: continue
            try {
                val found = findUrlBarText(child)
                if (found != null) return found
            } finally {
                child.recycle()
            }
        }
        return null
    }

    // ─── Keyword matching helpers ─────────────────────────────────────────────

    /**
     * Case-insensitive SUBSTRING match — no word boundaries.
     *
     * Used for URL bars and search fields where keywords are part of a continuous
     * string (e.g. "gaming" inside "gaming.com" or "search?q=gaming+news").
     */
    private fun containsBlockedWordSubstring(text: String, words: List<String>): Boolean {
        val lower = text.lowercase()
        return words.any { it.lowercase() in lower }
    }

    /**
     * Browser-specific word checker for TYPE_WINDOW_STATE_CHANGED events.
     *
     * 1. Extracts URL bar text and does a substring match (catches the full URL).
     * 2. Falls back to a full deep node-tree scan of the page content.
     * 3. Also does whole-word matching on the page title / visible text so that
     *    a legitimate word in an article title is still caught.
     */
    private fun containsBlockedWordBrowser(event: AccessibilityEvent, words: List<String>): Boolean {
        // ① Check URL bar first — substring match (no word boundaries needed)
        val urlText = extractUrlBarText(event)
        if (urlText.isNotBlank() && containsBlockedWordSubstring(urlText, words)) return true

        // ② Build a full corpus from the visible node tree (deep scan for browsers)
        val corpus = buildString {
            event.text?.forEach { t -> t?.let { append(it); append(' ') } }
            event.contentDescription?.let { append(it); append(' ') }
            event.source?.let { root ->
                try { append(collectNodeTextShallow(root, maxDepth = 8)) }
                finally { root.recycle() }
            }
        }.lowercase()
        if (corpus.isBlank()) return false

        // ③ Substring match on full corpus (catches query strings, path segments)
        if (containsBlockedWordSubstring(corpus, words)) return true

        // ④ Also whole-word match — catches article titles where partial substrings
        //    would cause false positives (e.g. "game" matching "games" in sports news)
        return words.any { word ->
            Regex("\\b${Regex.escape(word.lowercase())}\\b").containsMatchIn(corpus)
        }
    }

    private fun getBlockedWords(): List<String> {
        val json = prefs.getString(PREF_BLOCKED_WORDS, "[]") ?: "[]"
        return parseJsonArray(json).map { it.trim() }.filter { it.isNotBlank() }
    }

    /**
     * Returns true if any blocked word appears as a whole word in the event title text
     * or in the shallow node tree (max 5 levels deep).
     *
     * Matching is case-insensitive and whole-word only — prevents "short" from
     * matching "shortage" in shopping apps, etc.
     *
     * For browser packages, use [containsBlockedWordBrowser] instead which also
     * checks the URL bar with substring matching.
     */
    private fun containsBlockedWord(event: AccessibilityEvent, words: List<String>): Boolean {
        val corpus = buildString {
            event.text?.forEach { t -> t?.let { append(it); append(' ') } }
            event.contentDescription?.let { append(it); append(' ') }
            event.source?.let { root ->
                try {
                    append(collectNodeTextShallow(root, maxDepth = 5))
                } finally {
                    root.recycle()
                }
            }
        }.lowercase()
        if (corpus.isBlank()) return false
        return words.any { word ->
            val pattern = Regex("\\b${Regex.escape(word.lowercase())}\\b")
            pattern.containsMatchIn(corpus)
        }
    }

    // ─── Node text collectors ─────────────────────────────────────────────────

    private fun getEventAndNodeText(event: AccessibilityEvent, maxDepth: Int = 4): String {
        return buildString {
            event.text?.forEach { t -> t?.let { append(it); append(' ') } }
            event.contentDescription?.let { append(it); append(' ') }
            event.source?.let { root ->
                try {
                    append(collectNodeTextShallow(root, maxDepth))
                } finally {
                    root.recycle()
                }
            }
        }
    }

    /**
     * Returns true when the current window represents an install / update / uninstall
     * confirmation flow that originates from the Play Store, the system package
     * installer (any OEM), or an OEM "App ops" Settings page surfacing the same dialog.
     *
     * Detection is multi-signal to minimise false positives:
     *   1. Package must be Play Store, packageinstaller (any OEM), or Settings.
     *   2. Either the activity class name OR the visible text must contain a confirm
     *      keyword ("install", "update", "uninstall", "remove app", "delete app").
     *
     * Intentionally does NOT block ordinary Play Store browsing — only the actual
     * "Install" / "Update" / "Uninstall" prompt screens.
     */
    private fun isInstallActionContext(event: AccessibilityEvent, pkg: String): Boolean {
        val installerPkgs = setOf(
            "com.android.vending",                       // Google Play Store
            "com.android.packageinstaller",              // AOSP package installer
            "com.google.android.packageinstaller",       // Google package installer
            "com.samsung.android.packageinstaller",      // Samsung package installer
            "com.miui.packageinstaller",                 // MIUI package installer
            "com.coloros.packageinstaller",              // OPPO / ColorOS
            "com.oppo.packageinstaller",                 // OPPO legacy
            "com.huawei.packageinstaller",               // Huawei
            "com.android.settings",                      // OEM "App info" → Uninstall flows
            "com.samsung.android.app.settings",
            "com.samsung.android.settings"
        )
        if (pkg !in installerPkgs) return false

        val confirmKeywords = listOf("install", "update", "uninstall", "remove app", "delete app")
        val className = event.className?.toString()?.lowercase() ?: ""
        if (confirmKeywords.any { it in className }) return true

        val eventText = buildString {
            event.text.forEach { append(it); append(' ') }
            event.contentDescription?.let { append(it); append(' ') }
        }.lowercase()
        if (confirmKeywords.any { it in eventText }) return true

        val root = event.source ?: return false
        return try {
            val nodeText = collectNodeText(root).lowercase()
            confirmKeywords.any { it in nodeText }
        } finally {
            root.recycle()
        }
    }

    /**
     * Returns true when the YouTube app is currently showing the Shorts player.
     *
     * Multi-signal detection (any one is sufficient):
     *   • Activity / view className contains "shorts" or YouTube's internal "reel" id.
     *   • Window contains a node with viewIdResourceName matching one of the known
     *     Shorts player resource ids (reel_recycler / reel_player_page_container).
     *   • Visible text/contentDescription contains a Shorts-specific phrase.
     *
     * Returns false when the user is on the regular YouTube home / search / video
     * watch page, so blocking Shorts does not break ordinary YouTube usage.
     */
    private fun isYoutubeShorts(event: AccessibilityEvent): Boolean {
        val className = event.className?.toString()?.lowercase() ?: ""
        if ("shortsactivity" in className || "shorts.activity" in className) return true

        val eventText = buildString {
            event.text.forEach { append(it); append(' ') }
            event.contentDescription?.let { append(it); append(' ') }
        }.lowercase()
        // "shorts player" / "shorts video" only appear inside the Shorts player itself.
        if ("shorts player" in eventText || "shorts video" in eventText) return true

        val shortsResIds = listOf(
            "reel_player_page_container",
            "reel_recycler",
            "reel_watch_player",
            "shorts_video_container",
            "shorts_player"
        )
        val root = event.source ?: return false
        return try {
            if (containsAnyResId(root, shortsResIds)) {
                true
            } else {
                val nodeText = collectNodeText(root).lowercase()
                // "Remix" + "Subscribe" + "Shorts" together = Shorts player UI signature.
                ("shorts" in nodeText && ("remix" in nodeText || "shorts player" in nodeText))
            }
        } finally {
            root.recycle()
        }
    }

    /**
     * Returns true when the Instagram app is currently showing the Reels viewer
     * (full-screen Reels player or the Reels tab).
     *
     * Multi-signal detection (any one is sufficient):
     *   • Activity / view className contains "clips" or "reels" (Instagram's internal
     *     name for Reels is "clips").
     *   • Window contains a node with viewIdResourceName matching one of the known
     *     Reels viewer resource ids (clips_viewer_view_pager / reel_viewer_*).
     *   • Visible text contains the Reels playback header signature.
     *
     * Returns false on the Instagram home feed / DMs / profile / explore grid so
     * blocking Reels does not break ordinary Instagram usage.
     */
    private fun isInstagramReels(event: AccessibilityEvent): Boolean {
        val className = event.className?.toString()?.lowercase() ?: ""
        if ("clipsviewer" in className || "reelviewer" in className || "reelsviewer" in className) return true

        val eventText = buildString {
            event.text.forEach { append(it); append(' ') }
            event.contentDescription?.let { append(it); append(' ') }
        }.lowercase()
        if ("reels player" in eventText) return true

        val reelsResIds = listOf(
            "clips_viewer_view_pager",
            "clips_viewer",
            "reel_viewer_root",
            "reel_viewer_texture_view",
            "reels_viewer_root",
            "clips_video_player"
        )
        val root = event.source ?: return false
        return try {
            if (containsAnyResId(root, reelsResIds)) {
                true
            } else {
                // Final fallback: Reels-only tab/header text combined with a video-player
                // contentDescription — avoids matching "Reels" mentions on the home feed.
                val nodeText = collectNodeText(root).lowercase()
                ("clips" in nodeText && ("video player" in nodeText || "reel" in nodeText))
            }
        } finally {
            root.recycle()
        }
    }

    /**
     * Walks the node tree rooted at [root] and returns true if any node's
     * viewIdResourceName ends with any of the supplied lower-case suffixes.
     * Suffix match (rather than equality) ignores the package prefix
     * ("com.google.android.youtube:id/") so matches survive minor rename
     * variations across app versions.
     */
    private fun containsAnyResId(root: AccessibilityNodeInfo, suffixes: List<String>): Boolean {
        val match = booleanArrayOf(false)
        fun walk(node: AccessibilityNodeInfo?) {
            if (node == null || match[0]) return
            val resId = node.viewIdResourceName?.lowercase()
            if (resId != null && suffixes.any { resId.endsWith("/$it") || resId == it }) {
                match[0] = true
                return
            }
            for (i in 0 until node.childCount) {
                if (match[0]) break
                val child = node.getChild(i)
                if (child != null) {
                    walk(child)
                    child.recycle()
                }
            }
        }
        walk(root)
        return match[0]
    }

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
                // Support multi-app windows (pkgs array) and legacy single-pkg string
                val pkgsArr = entry.optJSONArray("pkgs")
                val matchesPkg = if (pkgsArr != null && pkgsArr.length() > 0) {
                    (0 until pkgsArr.length()).any { pkgsArr.optString(it).equals(pkg, ignoreCase = true) }
                } else {
                    entry.optString("pkg").equals(pkg, ignoreCase = true)
                }
                if (!matchesPkg) continue
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
                // Re-raise overlay + kick app on each retry, consistent with the
                // regular block retry behaviour.
                launchBlockOverlay(pkg)
                dismissPackage(pkg)
                scheduleGreyoutRetryCheck(pkg, attempt + 1)
            }
        }, RETRY_INTERVAL_MS * attempt)
    }

    // ─── Custom node rules (NodeSpy integration) ──────────────────────────────

    /**
     * Scans [rootNode] for any node matching the custom rules for [pkg].
     *
     * Rules are AND-ed: all non-empty selector fields must match.
     * Returns true if a rule fired (caller should return immediately to avoid
     * double-triggering the blocked-words path).
     *
     * Selector fields (case-insensitive substring match):
     *   matchResId  — viewIdResourceName
     *   matchText   — visible text or content description
     *   matchCls    — class name
     *
     * Action:
     *   "overlay" — show the FocusFlow block overlay (default)
     *   "home"    — silently press HOME (useful for subtle deterrence)
     */
    private fun checkCustomNodeRules(
        pkg: String,
        rootNode: AccessibilityNodeInfo,
        rulesJson: String
    ): Boolean {
        val rules = try { org.json.JSONArray(rulesJson) } catch (_: Exception) { return false }
        for (i in 0 until rules.length()) {
            val rule = rules.optJSONObject(i) ?: continue
            if (!rule.optBoolean("enabled", true)) continue
            if (rule.optString("pkg") != pkg) continue

            val matchResId = rule.optString("matchResId").takeIf { it.isNotBlank() }
            val matchText  = rule.optString("matchText").takeIf { it.isNotBlank() }
            val matchCls   = rule.optString("matchCls").takeIf { it.isNotBlank() }

            // Require at least one non-empty selector to avoid matching everything
            if (matchResId == null && matchText == null && matchCls == null) continue

            if (findNodeMatchForCustomRule(rootNode, matchResId, matchText, matchCls)) {
                val action = rule.optString("action", "overlay")
                if (action == "home") {
                    handler.post { performGlobalAction(GLOBAL_ACTION_HOME) }
                } else {
                    handleBlockedApp(pkg)
                }
                return true
            }
        }
        return false
    }

    /**
     * Recursive node-tree search for a node matching the given selectors.
     *
     * All non-null selectors must match (AND logic). Case-insensitive substring match.
     * Only visible nodes are considered for matching (invisible nodes are still traversed).
     */
    private fun findNodeMatchForCustomRule(
        node: AccessibilityNodeInfo,
        resId: String?,
        text: String?,
        cls: String?
    ): Boolean {
        if (node.isVisibleToUser) {
            val nodeResId  = node.viewIdResourceName ?: ""
            val nodeText   = buildString {
                node.text?.let { append(it) }
                node.contentDescription?.let { if (isNotEmpty()) append(' '); append(it) }
            }
            val nodeCls = node.className?.toString() ?: ""

            val resMatch  = resId == null || nodeResId.contains(resId, ignoreCase = true)
            val textMatch = text == null  || nodeText.contains(text, ignoreCase = true)
            val clsMatch  = cls == null   || nodeCls.contains(cls, ignoreCase = true)

            if (resMatch && textMatch && clsMatch) return true
        }

        for (i in 0 until node.childCount) {
            val child = node.getChild(i) ?: continue
            try {
                if (findNodeMatchForCustomRule(child, resId, text, cls)) return true
            } finally {
                child.recycle()
            }
        }
        return false
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
