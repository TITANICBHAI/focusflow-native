package com.tbtechs.focusday.services

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.SharedPreferences
import android.os.Build

/**
 * BootReceiver
 *
 * Listens for BOOT_COMPLETED and QUICKBOOT_POWERON (some OEMs) broadcasts.
 * If focus mode was active when the phone shut down, restarts the foreground service
 * so the countdown and notification survive a reboot.
 *
 * SharedPreferences key used:
 *   "focus_active"   → "true" to restart, "false" to skip
 *   "task_name"      → last task name
 *   "task_end_ms"    → last task end epoch ms (as a long stored as string)
 *   "next_task_name" → next task name (may be empty)
 *
 * Requires AndroidManifest permission: RECEIVE_BOOT_COMPLETED
 */
class BootReceiver : BroadcastReceiver() {

    override fun onReceive(context: Context, intent: Intent) {
        val action = intent.action ?: return
        if (action != Intent.ACTION_BOOT_COMPLETED &&
            action != "android.intent.action.QUICKBOOT_POWERON") return

        val prefs: SharedPreferences = context.getSharedPreferences(
            AppBlockerAccessibilityService.PREFS_NAME, Context.MODE_PRIVATE
        )

        val focusActive = prefs.getString("focus_active", "false") == "true"
        if (!focusActive) return

        val taskName  = prefs.getString("task_name", "Focus Task") ?: "Focus Task"
        val endTimeMs = prefs.getLong("task_end_ms", 0L)
        val nextName  = prefs.getString("next_task_name", null)

        // Don't bother restarting if the task already ended while the phone was off
        if (endTimeMs > 0L && endTimeMs < System.currentTimeMillis()) {
            prefs.edit().putString("focus_active", "false").apply()
            return
        }

        val serviceIntent = Intent(context, ForegroundTaskService::class.java).apply {
            putExtra(ForegroundTaskService.EXTRA_TASK_NAME, taskName)
            putExtra(ForegroundTaskService.EXTRA_END_MS, endTimeMs)
            nextName?.let { putExtra(ForegroundTaskService.EXTRA_NEXT_NAME, it) }
        }

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            context.startForegroundService(serviceIntent)
        } else {
            context.startService(serviceIntent)
        }
    }
}
