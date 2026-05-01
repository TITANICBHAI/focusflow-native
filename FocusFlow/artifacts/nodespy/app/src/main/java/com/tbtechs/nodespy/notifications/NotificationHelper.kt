package com.tbtechs.nodespy.notifications

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import com.tbtechs.nodespy.MainActivity

object NotificationHelper {

    private const val CHANNEL_CAPTURES = "nodespy_captures"
    private const val NOTIF_ID_CAPTURE = 100

    fun createCaptureChannel(context: Context) {
        val ch = NotificationChannel(
            CHANNEL_CAPTURES,
            "Recent Captures",
            NotificationManager.IMPORTANCE_LOW
        ).apply {
            description = "Shows the most recent node capture from the active app"
            setShowBadge(false)
        }
        context.getSystemService(NotificationManager::class.java).createNotificationChannel(ch)
    }

    fun showCaptureNotification(
        context: Context,
        captureId: String,
        pkg: String,
        nodeCount: Int,
        activityClass: String
    ) {
        val nm = context.getSystemService(NotificationManager::class.java)

        val shortPkg = pkg.substringAfterLast('.')
        val shortCls = activityClass.substringAfterLast('.')

        val openIntent = Intent(context, MainActivity::class.java).apply {
            action = MainActivity.ACTION_OPEN_CAPTURE
            putExtra(MainActivity.EXTRA_CAPTURE_ID, captureId)
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP)
        }
        val openPi = PendingIntent.getActivity(
            context,
            captureId.hashCode() and 0xFFFF,
            openIntent,
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
        )

        val notification = Notification.Builder(context, CHANNEL_CAPTURES)
            .setSmallIcon(android.R.drawable.ic_menu_view)
            .setContentTitle("$shortPkg · $nodeCount nodes")
            .setContentText(shortCls)
            .setContentIntent(openPi)
            .setAutoCancel(true)
            .setOnlyAlertOnce(true)
            .setCategory(Notification.CATEGORY_STATUS)
            .build()

        nm.notify(NOTIF_ID_CAPTURE, notification)
    }

    fun cancelCaptureNotification(context: Context) {
        context.getSystemService(NotificationManager::class.java)
            .cancel(NOTIF_ID_CAPTURE)
    }
}
