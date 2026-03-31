package com.tbtechs.focusflow.services

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import com.tbtechs.focusflow.modules.FocusDayBridgeModule

/**
 * NotificationActionReceiver
 *
 * Handles taps on action buttons in the foreground task notification:
 *   ✓ Done  — completes the current task
 *   +15m    — extends the task by 15 minutes
 *   +30m    — extends the task by 30 minutes
 *   Skip    — skips the current task
 *
 * Flow:
 *   User taps action → PendingIntent fires this receiver → receiver sends
 *   a local broadcast to FocusDayBridgeModule → bridge emits "FocusDayEvent"
 *   of type "NOTIF_ACTION" to JS → AppContext handles it like a normal
 *   completeTask / extendTaskTime / skipTask call.
 *
 * No activity needs to be launched — everything happens headlessly.
 */
class NotificationActionReceiver : BroadcastReceiver() {

    companion object {
        const val ACTION_COMPLETE  = "com.tbtechs.focusflow.notif.COMPLETE"
        const val ACTION_EXTEND    = "com.tbtechs.focusflow.notif.EXTEND"
        const val ACTION_SKIP      = "com.tbtechs.focusflow.notif.SKIP"

        const val EXTRA_TASK_ID    = "taskId"
        const val EXTRA_MINUTES    = "minutes"
    }

    override fun onReceive(context: Context, intent: Intent) {
        val taskId = intent.getStringExtra(EXTRA_TASK_ID) ?: return
        val action = intent.action ?: return

        val bridgeIntent = Intent(FocusDayBridgeModule.ACTION_NOTIF_ACTION).apply {
            `package` = context.packageName
            putExtra(FocusDayBridgeModule.EXTRA_NOTIF_ACTION_TYPE, action)
            putExtra(EXTRA_TASK_ID, taskId)
            if (action == ACTION_EXTEND) {
                putExtra(EXTRA_MINUTES, intent.getIntExtra(EXTRA_MINUTES, 15))
            }
        }

        context.sendBroadcast(bridgeIntent)
    }
}
