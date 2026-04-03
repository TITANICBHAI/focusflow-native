package com.tbtechs.focusflow.services

import android.app.*
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.os.SystemClock
import androidx.core.app.NotificationCompat
import com.tbtechs.focusflow.R
import com.tbtechs.focusflow.MainActivity
import com.tbtechs.focusflow.widget.FocusFlowWidget
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
    }

    private var taskId: String    = ""
    private var taskName: String  = ""
    private var endTimeMs: Long   = 0L
    private var startTimeMs: Long = 0L
    private var nextName: String? = null
    private var isActiveMode: Boolean = false

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

    override fun onCreate() {
        super.onCreate()
        createNotificationChannel()
        startForeground(NOTIFICATION_ID, buildIdleNotification())
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
                    taskId       = id ?: ""
                    taskName     = name
                    endTimeMs    = endMs
                    startTimeMs  = System.currentTimeMillis()
                    nextName     = next
                    isActiveMode = true

                    // Persist start time so the widget can compute progress correctly
                    getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
                        .edit()
                        .putLong("task_start_ms", startTimeMs)
                        .apply()

                    val notification = buildActiveNotification(endMs - System.currentTimeMillis())
                    startForeground(NOTIFICATION_ID, notification)

                    handler.removeCallbacks(tickRunnable)
                    handler.post(tickRunnable)

                    // Push widget update immediately — don't wait for the 30s tick
                    FocusFlowWidget.pushWidgetUpdate(applicationContext)
                } else {
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
        val nm = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        nm.notify(NOTIFICATION_ID, buildIdleNotification())
        // Update widget to idle state
        FocusFlowWidget.pushWidgetUpdate(applicationContext)
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
}
