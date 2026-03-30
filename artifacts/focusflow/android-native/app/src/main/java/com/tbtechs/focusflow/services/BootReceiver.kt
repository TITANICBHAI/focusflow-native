package com.tbtechs.focusflow.services

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.SharedPreferences
import android.os.Build

/**
 * BootReceiver
 *
 * Listens for BOOT_COMPLETED and QUICKBOOT_POWERON (some OEMs) broadcasts.
 *
 * Behaviour:
 *   1. If a focus session was active when the phone shut down → restart service in ACTIVE mode
 *      (restores countdown notification and app blocking).
 *   2. If no focus session was active → start service in IDLE mode so the persistent
 *      notification is always present and the process is kept alive by Android.
 *
 * SharedPreferences keys:
 *   "focus_active"          Boolean — true if a task focus was running at shutdown
 *   "task_name"             String  — last task name
 *   "task_end_ms"           Long    — last task end epoch ms
 *   "next_task_name"        String? — next task name (may be null)
 *   "standalone_block_active" Boolean — standalone (no-task) blocking active
 */
class BootReceiver : BroadcastReceiver() {

    override fun onReceive(context: Context, intent: Intent) {
        val action = intent.action ?: return
        if (action != Intent.ACTION_BOOT_COMPLETED &&
            action != "android.intent.action.QUICKBOOT_POWERON") return

        val prefs: SharedPreferences = context.getSharedPreferences(
            AppBlockerAccessibilityService.PREFS_NAME, Context.MODE_PRIVATE
        )

        val focusActive = prefs.getBoolean("focus_active", false)
        val endTimeMs   = prefs.getLong("task_end_ms", 0L)

        if (focusActive && endTimeMs > 0L && endTimeMs > System.currentTimeMillis()) {
            // ── Restart in ACTIVE focus mode ──────────────────────────────────
            val taskName = prefs.getString("task_name", "Focus Task") ?: "Focus Task"
            val nextName = prefs.getString("next_task_name", null)

            val serviceIntent = Intent(context, ForegroundTaskService::class.java).apply {
                putExtra(ForegroundTaskService.EXTRA_TASK_NAME, taskName)
                putExtra(ForegroundTaskService.EXTRA_END_MS, endTimeMs)
                nextName?.let { putExtra(ForegroundTaskService.EXTRA_NEXT_NAME, it) }
            }
            startService(context, serviceIntent)
        } else {
            // ── Clear any stale focus flag, then start IDLE to keep process alive ──
            if (focusActive) {
                prefs.edit().putBoolean("focus_active", false).apply()
            }
            val idleIntent = Intent(context, ForegroundTaskService::class.java).apply {
                this.action = ForegroundTaskService.ACTION_SET_IDLE
            }
            startService(context, idleIntent)
        }
    }

    private fun startService(context: Context, intent: Intent) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            context.startForegroundService(intent)
        } else {
            context.startService(intent)
        }
    }
}
