package com.tbtechs.focusflow.services

import android.app.*
import android.app.usage.UsageStatsManager
import android.content.Context
import android.content.Intent
import android.content.SharedPreferences
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.os.SystemClock
import android.provider.Settings
import android.view.accessibility.AccessibilityManager
import androidx.core.app.NotificationCompat
import com.tbtechs.focusflow.R
import com.tbtechs.focusflow.MainActivity
import com.tbtechs.focusflow.services.NetworkBlockerVpnService
import com.tbtechs.focusflow.services.WakeLockManager
import com.tbtechs.focusflow.widget.FocusFlowWidget
import org.json.JSONArray
import java.util.Calendar

/**
 * ForegroundTaskService
 *
 * Runs persistently at all times — not only during focus sessions.
 * This keeps the process alive so the AccessibilityService is never killed.
 *
 * Two modes:
 *   IDLE   — No active task. Shows a quiet "FocusFlow is monitoring" notification.
 *   ACTIVE — Focus session running. Shows task name + live chronometer countdown
 *            + progress bar + action buttons.
 *
 * Notification action buttons (ACTIVE mode only):
 *   ✓ Done   → NotificationActionReceiver → JS completeTask()
 *   +15m     → NotificationActionReceiver → JS extendTaskTime(15)
 *   +30m     → NotificationActionReceiver → JS extendTaskTime(30)
 *   Skip     → NotificationActionReceiver → JS skipTask()
 *
 * Intent extras for ACTIVE mode:
 *   "taskId"   String  — DB id of the active task (for action buttons)
 *   "taskName" String  — display name of the active task
 *   "endTimeMs" Long   — absolute epoch ms when the task ends
 *   "nextName"  String? — name of the next task (shown as sub-text)
 */
class ForegroundTaskService : Service() {

    companion object {
        const val CHANNEL_ID        = "focusday_foreground"
        const val CHANNEL_NAME      = "FocusFlow Active Task"
        const val NOTIFICATION_ID   = 1001
        const val ACTION_STOP       = "com.tbtechs.focusflow.STOP_SERVICE"
        const val ACTION_SET_IDLE   = "com.tbtechs.focusflow.SET_IDLE"
        const val ACTION_TASK_ENDED = "com.tbtechs.focusflow.TASK_ENDED"

        const val EXTRA_TASK_ID     = "taskId"
        const val EXTRA_TASK_NAME   = "taskName"
        const val EXTRA_END_MS      = "endTimeMs"
        const val EXTRA_NEXT_NAME   = "nextName"

        private const val PREFS_NAME = "focusday_prefs"

        // PendingIntent request codes (must be unique per action)
        private const val PI_TAP      = 0
        private const val PI_COMPLETE = 2
        private const val PI_EXTEND15 = 3
        private const val PI_EXTEND30 = 4
        private const val PI_SKIP     = 5

        /** How often the fallback poller checks the foreground app (ms). */
        private const val FALLBACK_POLL_MS = 1_000L

        /** Cooldown: don't re-block the same package within this window (ms). */
        private const val FALLBACK_COOLDOWN_MS = 2_000L
    }

    private var taskId: String    = ""
    private var taskName: String  = ""
    private var endTimeMs: Long   = 0L
    private var startTimeMs: Long = 0L
    private var nextName: String? = null
    private var isActiveMode: Boolean = false

    // ── Fallback blocker state (used only when accessibility is not granted) ──
    private lateinit var blockPrefs: SharedPreferences
    private var fallbackLastBlockedPkg: String? = null
    private var fallbackLastBlockedAtMs: Long   = 0L

    private val handler = Handler(Looper.getMainLooper())
    private val tickRunnable = object : Runnable {
        override fun run() {
            val remaining = endTimeMs - System.currentTimeMillis()
            if (remaining <= 0) {
                clearFocusActive()
                sendBroadcast(Intent(ACTION_TASK_ENDED).apply {
                    `package` = applicationContext.packageName
                })
                goIdle()
                return
            }
            // Update the progress bar portion of the notification
            updateNotification(remaining)
            // Push fresh data to any home screen widgets
            FocusFlowWidget.pushWidgetUpdate(applicationContext)
            // Tick every 30 s — smooth enough for the progress bar, easy on battery
            handler.postDelayed(this, 30_000)
        }
    }

    /**
     * Fallback blocker poll runnable — runs every [FALLBACK_POLL_MS] ms.
     *
     * Immediately bails out if the accessibility service is enabled (that path
     * is faster and more reliable — no need to duplicate work).  When
     * accessibility is absent this is the only enforcement mechanism, so it
     * uses UsageStatsManager to detect the foreground package, mirrors the
     * same SharedPreferences block-check logic, and if a blocked app is found
     * it launches the overlay (which pushes the app to the background) then
     * fires killBackgroundProcesses 400 ms later.
     */
    private val fallbackPollRunnable = object : Runnable {
        override fun run() {
            // ── 1. Defer to accessibility if it is active ─────────────────
            if (isAccessibilityServiceEnabled()) {
                handler.postDelayed(this, FALLBACK_POLL_MS)
                return
            }

            // ── 2. Only act when at least one blocking mode is active ──────
            val now = System.currentTimeMillis()
            val focusActive = blockPrefs.getBoolean("focus_active", false).let { on ->
                if (on) {
                    val endMs = blockPrefs.getLong("task_end_ms", 0L)
                    if (endMs > 0L && now > endMs) {
                        blockPrefs.edit().putBoolean("focus_active", false).apply()
                        false
                    } else on
                } else false
            }
            val saActive = blockPrefs.getBoolean("standalone_block_active", false).let { on ->
                if (on) {
                    val untilMs = blockPrefs.getLong("standalone_block_until_ms", 0L)
                    if (untilMs > 0L && now > untilMs) {
                        blockPrefs.edit().putBoolean("standalone_block_active", false).apply()
                        false
                    } else on
                } else false
            }
            val greyoutJson = blockPrefs.getString("greyout_schedule", "[]") ?: "[]"
            val hasGreyout = greyoutJson != "[]" && greyoutJson.isNotEmpty()

            if (!focusActive && !saActive && !hasGreyout) {
                // Nothing to enforce — reset cooldown and poll lightly
                fallbackLastBlockedPkg = null
                handler.postDelayed(this, FALLBACK_POLL_MS)
                return
            }

            // ── 3. Detect foreground package ──────────────────────────────
            val pkg = getFallbackForegroundPackage()
            if (pkg.isNullOrEmpty() || pkg == packageName) {
                handler.postDelayed(this, FALLBACK_POLL_MS)
                return
            }

            // ── 4. Skip always-allowed packages ───────────────────────────
            if (AppBlockerAccessibilityService.ALWAYS_ALLOWED.any {
                    pkg.equals(it, ignoreCase = true)
                }) {
                handler.postDelayed(this, FALLBACK_POLL_MS)
                return
            }

            // ── 5. Check if the package should be blocked ─────────────────
            if (!isFallbackBlocked(pkg, focusActive, saActive, greyoutJson)) {
                fallbackLastBlockedPkg = null
                handler.postDelayed(this, FALLBACK_POLL_MS)
                return
            }

            // ── 6. Cooldown guard — don't hammer the same package ─────────
            val samePackage     = pkg == fallbackLastBlockedPkg
            val cooldownExpired = (now - fallbackLastBlockedAtMs) > FALLBACK_COOLDOWN_MS
            if (!samePackage || cooldownExpired) {
                fallbackLastBlockedPkg = pkg
                fallbackLastBlockedAtMs = now
                handleFallbackBlock(pkg)
            }

            handler.postDelayed(this, FALLBACK_POLL_MS)
        }
    }

    override fun onCreate() {
        super.onCreate()
        blockPrefs = getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        createNotificationChannel()
        startForeground(NOTIFICATION_ID, buildIdleNotification())
        // Start the fallback blocker poll — it self-disables instantly when
        // accessibility is active, so there is zero overhead in the normal path.
        handler.postDelayed(fallbackPollRunnable, FALLBACK_POLL_MS)
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            ACTION_STOP -> {
                handler.removeCallbacks(tickRunnable)
                clearFocusActive()
                stopForeground(STOP_FOREGROUND_REMOVE)
                stopSelf()
                return START_NOT_STICKY
            }
            ACTION_SET_IDLE -> {
                handler.removeCallbacks(tickRunnable)
                clearFocusActive()
                goIdle()
                return START_STICKY
            }
            else -> {
                val id    = intent?.getStringExtra(EXTRA_TASK_ID)
                val name  = intent?.getStringExtra(EXTRA_TASK_NAME)
                val endMs = intent?.getLongExtra(EXTRA_END_MS, 0L) ?: 0L
                val next  = intent?.getStringExtra(EXTRA_NEXT_NAME)

                if (name != null && endMs > 0L) {
                    taskId    = id ?: ""
                    taskName  = name
                    endTimeMs = endMs
                    nextName  = next

                    // Only reset the start time on the first launch of a session.
                    // If isActiveMode is already true this is an update call (e.g. after
                    // a +15m / +30m extend) — preserve the original startTimeMs so the
                    // notification progress bar continues from where it was, not from 0%.
                    if (!isActiveMode) {
                        startTimeMs  = System.currentTimeMillis()
                        isActiveMode = true
                        // Persist start time so the widget can compute progress correctly
                        getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
                            .edit()
                            .putLong("task_start_ms", startTimeMs)
                            .apply()
                    } else {
                        // Update persisted end time so the widget reflects the extension
                        isActiveMode = true
                    }

                    val notification = buildActiveNotification(endMs - System.currentTimeMillis())
                    startForeground(NOTIFICATION_ID, notification)

                    // Acquire wake lock so the CPU stays alive during the session even
                    // when the screen turns off — prevents OEM schedulers from throttling
                    // the AccessibilityService on MIUI, ColorOS, and Samsung One UI.
                    WakeLockManager.acquire(this)

                    handler.removeCallbacks(tickRunnable)
                    handler.post(tickRunnable)

                    // Push widget update immediately — don't wait for the 30s tick
                    FocusFlowWidget.pushWidgetUpdate(applicationContext)
                } else if (intent == null) {
                    // Android OS restarted this service after it was killed (START_STICKY).
                    // All member variables are reset — restore session state from SharedPreferences.
                    val prefs        = getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
                    val focusActive  = prefs.getBoolean("focus_active", false)
                    if (focusActive) {
                        val restoredName  = prefs.getString("task_name", null)
                        val restoredEndMs = prefs.getLong("task_end_ms", 0L)
                        if (restoredName != null && restoredEndMs > System.currentTimeMillis()) {
                            // Session still running — restore it fully
                            taskId      = prefs.getString("task_id", "") ?: ""
                            taskName    = restoredName
                            endTimeMs   = restoredEndMs
                            nextName    = prefs.getString("next_task_name", null)
                            startTimeMs = prefs.getLong("task_start_ms", System.currentTimeMillis())
                            isActiveMode = true

                            val notification = buildActiveNotification(restoredEndMs - System.currentTimeMillis())
                            startForeground(NOTIFICATION_ID, notification)
                            WakeLockManager.acquire(this)
                            handler.removeCallbacks(tickRunnable)
                            handler.post(tickRunnable)
                            FocusFlowWidget.pushWidgetUpdate(applicationContext)
                        } else {
                            // Session expired while the service was dead — clean up
                            clearFocusActive()
                            goIdle()
                        }
                    }
                    // If focus_active == false, onCreate already started idle notification — nothing to do.
                } else {
                    // Intent with no task data — normal idle start from JS layer.
                    // Only go idle if we are not already running an active focus session.
                    // Without this guard, calling startIdleService() while focus is active
                    // (e.g. on app open) would destroy the active notification and block state.
                    if (!isActiveMode) {
                        goIdle()
                    }
                }
            }
        }
        return START_STICKY
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onDestroy() {
        handler.removeCallbacks(tickRunnable)
        handler.removeCallbacks(fallbackPollRunnable)
        WakeLockManager.release()
        super.onDestroy()
    }

    // ─── Mode helpers ──────────────────────────────────────────────────────────

    private fun goIdle() {
        isActiveMode = false
        taskId       = ""
        taskName     = ""
        endTimeMs    = 0L
        startTimeMs  = 0L
        nextName     = null
        handler.removeCallbacks(tickRunnable)
        // Release the wake lock — CPU throttling is fine again when no session is active
        WakeLockManager.release()
        // Stop all aversive deterrents (dim overlay, vibration) if they were running
        AversiveActionsManager.stopAll(this)
        // Stop network blocking and restore connectivity if the restore flag is set
        stopNetworkBlock()
        val nm = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        nm.notify(NOTIFICATION_ID, buildIdleNotification())
        // Update widget to idle state
        FocusFlowWidget.pushWidgetUpdate(applicationContext)
    }

    /**
     * Stops the VPN network blocker when a session ends.
     * Only acts if net_block_enabled is true so sessions without network blocking
     * are not affected. The JS layer's net_block_restore flag is respected:
     * if false the VPN is stopped but WiFi/data are not explicitly re-enabled
     * (though they were never disabled by this service directly).
     */
    private fun stopNetworkBlock() {
        val prefs = getSharedPreferences(AppBlockerAccessibilityService.PREFS_NAME, Context.MODE_PRIVATE)
        if (!prefs.getBoolean("net_block_enabled", false)) return
        try {
            val intent = Intent(this, NetworkBlockerVpnService::class.java).apply {
                action = NetworkBlockerVpnService.ACTION_STOP
            }
            startService(intent)
        } catch (_: Exception) { /* service not running — nothing to stop */ }
    }

    // ─── Notification builders ─────────────────────────────────────────────────

    private fun createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(
                CHANNEL_ID,
                CHANNEL_NAME,
                NotificationManager.IMPORTANCE_LOW
            ).apply {
                description = "Keeps FocusFlow running and shows your active task"
                setShowBadge(false)
            }
            val nm = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
            nm.createNotificationChannel(channel)
        }
    }

    private fun buildIdleNotification(): Notification {
        val tapIntent = Intent(this, MainActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_SINGLE_TOP
        }
        val tapPending = PendingIntent.getActivity(
            this, PI_TAP, tapIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
        return NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle("FocusFlow")
            .setContentText("Monitoring active — tap to open")
            .setSmallIcon(R.mipmap.ic_launcher)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setContentIntent(tapPending)
            .setPriority(NotificationCompat.PRIORITY_MIN)
            .build()
    }

    private fun buildActiveNotification(remainingMs: Long): Notification {
        // ── End time label — "ends at 2:30 PM" ──
        val cal = Calendar.getInstance().apply { timeInMillis = endTimeMs }
        val hour = cal.get(Calendar.HOUR_OF_DAY)
        val min  = cal.get(Calendar.MINUTE)
        val amPm = if (hour < 12) "AM" else "PM"
        val hour12 = when {
            hour == 0  -> 12
            hour > 12  -> hour - 12
            else       -> hour
        }
        val endLabel = String.format("%d:%02d %s", hour12, min, amPm)

        // ── Progress bar: 0..100 based on elapsed vs total ──
        val totalMs   = if (startTimeMs > 0L) endTimeMs - startTimeMs else remainingMs
        val elapsedMs = (totalMs - remainingMs).coerceAtLeast(0L)
        val progressPct = if (totalMs > 0L) {
            ((elapsedMs * 100L) / totalMs).toInt().coerceIn(0, 100)
        } else 0

        // ── Chronometer base: counts down to endTimeMs ──
        // setWhen(endTimeMs) + setUsesChronometer(true) + setChronometerCountDown(true)
        // gives a native live ticking countdown in the notification — no polling needed.
        val chronometerBase = endTimeMs - System.currentTimeMillis() + SystemClock.elapsedRealtime()

        // ── Tap: open app ──
        val tapIntent = Intent(this, MainActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_SINGLE_TOP
        }
        val tapPending = PendingIntent.getActivity(
            this, PI_TAP, tapIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        // ── Action: ✓ Done ──
        val completeIntent = Intent(NotificationActionReceiver.ACTION_COMPLETE).apply {
            `package` = packageName
            putExtra(NotificationActionReceiver.EXTRA_TASK_ID, taskId)
        }
        val completePending = PendingIntent.getBroadcast(
            this, PI_COMPLETE, completeIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        // ── Action: +15m ──
        val extend15Intent = Intent(NotificationActionReceiver.ACTION_EXTEND).apply {
            `package` = packageName
            putExtra(NotificationActionReceiver.EXTRA_TASK_ID, taskId)
            putExtra(NotificationActionReceiver.EXTRA_MINUTES, 15)
        }
        val extend15Pending = PendingIntent.getBroadcast(
            this, PI_EXTEND15, extend15Intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        // ── Action: +30m ──
        val extend30Intent = Intent(NotificationActionReceiver.ACTION_EXTEND).apply {
            `package` = packageName
            putExtra(NotificationActionReceiver.EXTRA_TASK_ID, taskId)
            putExtra(NotificationActionReceiver.EXTRA_MINUTES, 30)
        }
        val extend30Pending = PendingIntent.getBroadcast(
            this, PI_EXTEND30, extend30Intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        // ── Action: Skip ──
        val skipIntent = Intent(NotificationActionReceiver.ACTION_SKIP).apply {
            `package` = packageName
            putExtra(NotificationActionReceiver.EXTRA_TASK_ID, taskId)
        }
        val skipPending = PendingIntent.getBroadcast(
            this, PI_SKIP, skipIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        return NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle("🎯 $taskName")
            .setContentText("ends $endLabel")
            .setSubText(nextName?.let { "Next: $it" })
            .setSmallIcon(R.mipmap.ic_launcher)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setContentIntent(tapPending)
            // Live ticking countdown — Android handles this natively, no polling for display
            .setWhen(chronometerBase)
            .setUsesChronometer(true)
            .setChronometerCountDown(true)
            .setShowWhen(true)
            // Progress bar showing session completion
            .setProgress(100, progressPct, false)
            .addAction(0, "✓ Done",  completePending)
            .addAction(0, "+15m",    extend15Pending)
            .addAction(0, "+30m",    extend30Pending)
            .addAction(0, "Skip",    skipPending)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .build()
    }

    private fun updateNotification(remainingMs: Long) {
        val notification = buildActiveNotification(remainingMs)
        val nm = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        nm.notify(NOTIFICATION_ID, notification)
    }

    private fun clearFocusActive() {
        getSharedPreferences(AppBlockerAccessibilityService.PREFS_NAME, Context.MODE_PRIVATE)
            .edit()
            .putBoolean("focus_active", false)
            .apply()
    }

    // ─── Fallback blocker helpers ───────────────────────────────────────────────

    /**
     * Returns true if our AppBlockerAccessibilityService is currently active.
     * When true the fallback poller defers entirely — accessibility is faster
     * and event-driven so there is no value in running the polling path too.
     */
    private fun isAccessibilityServiceEnabled(): Boolean {
        return try {
            val enabled = Settings.Secure.getString(
                contentResolver,
                Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES
            ) ?: return false
            enabled.contains(packageName, ignoreCase = true)
        } catch (_: Exception) { false }
    }

    /**
     * Returns the package name of the currently visible foreground app using
     * UsageStatsManager.  Returns null if the permission is not granted or the
     * query returns no results.
     *
     * A 5-second look-back window is used so the most-recently-used app is
     * reliably the one currently on screen.
     */
    private fun getFallbackForegroundPackage(): String? {
        return try {
            val usm = getSystemService(Context.USAGE_STATS_SERVICE) as UsageStatsManager
            val now = System.currentTimeMillis()
            val stats = usm.queryUsageStats(
                UsageStatsManager.INTERVAL_DAILY,
                now - 5_000L,
                now
            )
            stats?.maxByOrNull { it.lastTimeUsed }?.packageName
        } catch (_: Exception) { null }
    }

    /**
     * Mirrors the core blocking logic from AppBlockerAccessibilityService using
     * the same SharedPreferences.  Only covers the primary enforcement paths
     * (task focus, standalone block, greyout schedule) — advanced daily-
     * allowance time-budget tracking stays in the accessibility service.
     */
    private fun isFallbackBlocked(
        pkg: String,
        focusActive: Boolean,
        saActive: Boolean,
        greyoutJson: String
    ): Boolean {
        // ── Task focus: block anything NOT in the allowed list ────────────
        if (focusActive) {
            val allowedJson = blockPrefs.getString("allowed_packages", "[]") ?: "[]"
            val allowed = try {
                val arr = JSONArray(allowedJson)
                (0 until arr.length()).map { arr.getString(it) }.toSet()
            } catch (_: Exception) { emptySet() }
            if (!allowed.any { pkg.equals(it, ignoreCase = true) }) return true
        }

        // ── Standalone block: block anything IN the blocked list ──────────
        if (saActive) {
            val blockedJson = blockPrefs.getString("standalone_blocked_packages", "[]") ?: "[]"
            try {
                val arr = JSONArray(blockedJson)
                for (i in 0 until arr.length()) {
                    if (pkg.equals(arr.getString(i), ignoreCase = true)) return true
                }
            } catch (_: Exception) { }
        }

        // ── Greyout schedule ──────────────────────────────────────────────
        if (greyoutJson != "[]" && greyoutJson.isNotEmpty()) {
            try {
                val arr = org.json.JSONArray(greyoutJson)
                val cal = java.util.Calendar.getInstance()
                val currentDay  = cal.get(java.util.Calendar.DAY_OF_WEEK)
                val currentMins = cal.get(java.util.Calendar.HOUR_OF_DAY) * 60 +
                                  cal.get(java.util.Calendar.MINUTE)
                for (i in 0 until arr.length()) {
                    val entry = arr.optJSONObject(i) ?: continue
                    if (!entry.optString("pkg").equals(pkg, ignoreCase = true)) continue
                    val days = entry.optJSONArray("days") ?: continue
                    val dayMatch = (0 until days.length()).any { days.optInt(it) == currentDay }
                    if (!dayMatch) continue
                    val startMins = entry.optInt("startHour") * 60 + entry.optInt("startMin")
                    val endMins   = entry.optInt("endHour")   * 60 + entry.optInt("endMin")
                    val inWindow  = if (startMins <= endMins)
                        currentMins in startMins until endMins
                    else
                        currentMins >= startMins || currentMins < endMins
                    if (inWindow) return true
                }
            } catch (_: Exception) { }
        }

        return false
    }

    /**
     * Fallback enforcement action: launches the overlay (which immediately
     * pushes the blocked app to the background) then kills its process 400 ms
     * later once it is no longer in the foreground.
     *
     * The overlay's own re-raise logic keeps it on screen; the X button will
     * appear once the fallback poller detects a non-blocked package in the
     * foreground and sets overlay_x_ready.  Because there is no accessibility
     * service in this path, we write overlay_x_ready directly from this
     * service on the next poll tick where the blocked pkg is no longer seen.
     */
    private fun handleFallbackBlock(blockedPackage: String) {
        // Signal overlay to await the package leaving before showing X
        blockPrefs.edit().putString("overlay_awaiting_pkg", blockedPackage).apply()

        // Launch the full-screen overlay
        try {
            val pm      = applicationContext.packageManager
            val info    = pm.getApplicationInfo(blockedPackage, 0)
            val appName = pm.getApplicationLabel(info).toString()
            val intent  = Intent(applicationContext, BlockOverlayActivity::class.java).apply {
                flags = Intent.FLAG_ACTIVITY_NEW_TASK or
                        Intent.FLAG_ACTIVITY_CLEAR_TOP or
                        Intent.FLAG_ACTIVITY_SINGLE_TOP
                putExtra(BlockOverlayActivity.EXTRA_BLOCKED_PKG, blockedPackage)
                putExtra(BlockOverlayActivity.EXTRA_BLOCKED_NAME, appName)
            }
            startActivity(intent)
        } catch (_: Exception) { }

        // Kill the blocked app's process after the overlay has had time to
        // take the foreground (pushing the blocked app to background).
        handler.postDelayed({
            try {
                val am = getSystemService(ACTIVITY_SERVICE) as ActivityManager
                am.killBackgroundProcesses(blockedPackage)
            } catch (_: Exception) { }

            // Write overlay_x_ready so the overlay's X button appears now
            // (in the accessibility path this is done by the service on the
            // next window event; here we do it directly after the kill).
            blockPrefs.edit()
                .putBoolean(BlockOverlayActivity.PREF_OVERLAY_X_READY, true)
                .putString("overlay_awaiting_pkg", "")
                .apply()
        }, 400L)
    }
}
