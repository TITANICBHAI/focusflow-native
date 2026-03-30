package com.tbtechs.focusflow.services

import android.app.*
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import androidx.core.app.NotificationCompat
import com.tbtechs.focusflow.R
import com.tbtechs.focusflow.MainActivity

/**
 * ForegroundTaskService
 *
 * A persistent foreground service that:
 *   1. Shows a sticky notification with the current task name and a live countdown.
 *   2. Ticks every second, updating the notification time-remaining string.
 *   3. Fires a "TASK_ENDED" broadcast when the countdown reaches zero.
 *
 * Started / stopped via ForegroundServiceModule (NativeModules.ForegroundService).
 * The broadcast is caught by FocusDayBridgeModule which forwards it to JS.
 *
 * Intent extras expected on start:
 *   "taskName"   String  — display name of the active task
 *   "endTimeMs"  Long    — absolute epoch ms when the task ends
 *   "nextName"   String? — name of the next task (shown as sub-text)
 */
class ForegroundTaskService : Service() {

    companion object {
        const val CHANNEL_ID       = "focusday_foreground"
        const val CHANNEL_NAME     = "FocusDay Active Task"
        const val NOTIFICATION_ID  = 1001
        const val ACTION_STOP      = "com.tbtechs.focusflow.STOP_SERVICE"
        const val ACTION_TASK_ENDED = "com.tbtechs.focusflow.TASK_ENDED"

        // Extras
        const val EXTRA_TASK_NAME  = "taskName"
        const val EXTRA_END_MS     = "endTimeMs"
        const val EXTRA_NEXT_NAME  = "nextName"
    }

    private var taskName: String  = "Focus Task"
    private var endTimeMs: Long   = 0L
    private var nextName: String? = null

    private val handler = Handler(Looper.getMainLooper())
    private val tickRunnable = object : Runnable {
        override fun run() {
            val remaining = endTimeMs - System.currentTimeMillis()
            if (remaining <= 0) {
                // Task ended — broadcast to JS bridge
                sendBroadcast(Intent(ACTION_TASK_ENDED).apply {
                    `package` = applicationContext.packageName
                })
                stopSelf()
                return
            }
            updateNotification(remaining)
            handler.postDelayed(this, 1_000)
        }
    }

    override fun onCreate() {
        super.onCreate()
        createNotificationChannel()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (intent?.action == ACTION_STOP) {
            handler.removeCallbacks(tickRunnable)
            // minSdkVersion = 26 (>= Android N/24), so STOP_FOREGROUND_REMOVE is always available.
            stopForeground(STOP_FOREGROUND_REMOVE)
            stopSelf()
            return START_NOT_STICKY
        }

        taskName  = intent?.getStringExtra(EXTRA_TASK_NAME) ?: "Focus Task"
        endTimeMs = intent?.getLongExtra(EXTRA_END_MS, 0L) ?: 0L
        nextName  = intent?.getStringExtra(EXTRA_NEXT_NAME)

        val notification = buildNotification(endTimeMs - System.currentTimeMillis())
        startForeground(NOTIFICATION_ID, notification)

        handler.removeCallbacks(tickRunnable)
        handler.post(tickRunnable)

        // If killed by the system, restart with the same intent
        return START_REDELIVER_INTENT
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onDestroy() {
        handler.removeCallbacks(tickRunnable)
        super.onDestroy()
    }

    // ─── Private helpers ─────────────────────────────────────────────────────

    private fun createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(
                CHANNEL_ID,
                CHANNEL_NAME,
                NotificationManager.IMPORTANCE_LOW  // Low = no sound, still always visible
            ).apply {
                description = "Keeps FocusDay running and shows your active task"
                setShowBadge(false)
            }
            val nm = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
            nm.createNotificationChannel(channel)
        }
    }

    private fun buildNotification(remainingMs: Long): Notification {
        val mins = (remainingMs / 60_000).coerceAtLeast(0)
        val secs = ((remainingMs % 60_000) / 1_000).coerceAtLeast(0)
        val timeStr = String.format("%d:%02d remaining", mins, secs)

        val tapIntent = Intent(this, MainActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_SINGLE_TOP
        }
        val tapPending = PendingIntent.getActivity(
            this, 0, tapIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        val stopIntent = Intent(this, ForegroundTaskService::class.java).apply {
            action = ACTION_STOP
        }
        val stopPending = PendingIntent.getService(
            this, 1, stopIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        return NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle("🎯 $taskName")
            .setContentText(timeStr)
            .setSubText(nextName?.let { "Next: $it" })
            .setSmallIcon(R.mipmap.ic_launcher)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setContentIntent(tapPending)
            // Icon 0 = no icon. Stock android.R.drawable icons should not appear in
            // published APKs; a custom monochrome drawable can be substituted later.
            .addAction(0, "Stop Focus", stopPending)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .build()
    }

    private fun updateNotification(remainingMs: Long) {
        val notification = buildNotification(remainingMs)
        val nm = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        nm.notify(NOTIFICATION_ID, notification)
    }
}
