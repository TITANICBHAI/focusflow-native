package com.tbtechs.nodespy.service

import android.accessibilityservice.AccessibilityService
import android.accessibilityservice.AccessibilityServiceInfo
import android.graphics.Rect
import android.view.accessibility.AccessibilityEvent
import android.view.accessibility.AccessibilityNodeInfo
import com.tbtechs.nodespy.data.CaptureStore
import com.tbtechs.nodespy.data.NodeCapture
import com.tbtechs.nodespy.data.NodeEntry
import com.tbtechs.nodespy.data.NodeFlags

class NodeSpyAccessibilityService : AccessibilityService() {

    private val counter = intArrayOf(0)

    override fun onServiceConnected() {
        serviceInfo = AccessibilityServiceInfo().apply {
            eventTypes = AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED or
                    AccessibilityEvent.TYPE_WINDOW_CONTENT_CHANGED
            feedbackType = AccessibilityServiceInfo.FEEDBACK_GENERIC
            flags = AccessibilityServiceInfo.FLAG_REPORT_VIEW_IDS or
                    AccessibilityServiceInfo.FLAG_RETRIEVE_INTERACTIVE_WINDOWS or
                    AccessibilityServiceInfo.FLAG_INCLUDE_NOT_IMPORTANT_VIEWS
            notificationTimeout = 200
        }
        CaptureStore.setServiceRunning(true)
    }

    override fun onAccessibilityEvent(event: AccessibilityEvent) {
        val type = event.eventType
        if (type != AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED &&
            type != AccessibilityEvent.TYPE_WINDOW_CONTENT_CHANGED) return

        val pkg = event.packageName?.toString() ?: return
        if (pkg == applicationContext.packageName) return

        val root = rootInActiveWindow ?: return
        try {
            counter[0] = 0
            val nodes = mutableListOf<NodeEntry>()
            captureNode(root, null, 0, nodes)

            CaptureStore.addCapture(
                NodeCapture(
                    timestamp = System.currentTimeMillis(),
                    pkg = pkg,
                    activityClass = event.className?.toString() ?: "",
                    screenW = resources.displayMetrics.widthPixels,
                    screenH = resources.displayMetrics.heightPixels,
                    nodes = nodes
                )
            )
        } finally {
            root.recycle()
        }
    }

    private fun captureNode(
        node: AccessibilityNodeInfo,
        parentId: String?,
        depth: Int,
        list: MutableList<NodeEntry>
    ): String {
        val id = "n${counter[0]++}"
        val bounds = Rect()
        node.getBoundsInScreen(bounds)

        val entry = NodeEntry(
            id = id,
            parentId = parentId,
            cls = node.className?.toString() ?: "",
            resId = node.viewIdResourceName,
            text = node.text?.toString()?.takeIf { it.isNotBlank() },
            desc = node.contentDescription?.toString()?.takeIf { it.isNotBlank() },
            hint = if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.O)
                node.hintText?.toString()?.takeIf { it.isNotBlank() } else null,
            boundsL = bounds.left,
            boundsT = bounds.top,
            boundsR = bounds.right,
            boundsB = bounds.bottom,
            flags = NodeFlags(
                enabled = node.isEnabled,
                clickable = node.isClickable,
                longClickable = node.isLongClickable,
                scrollable = node.isScrollable,
                checkable = node.isCheckable,
                checked = node.isChecked,
                focused = node.isFocused,
                selected = node.isSelected,
                visible = node.isVisibleToUser,
                password = node.isPassword,
                editable = node.isEditable
            ),
            depth = depth
        )
        list.add(entry)

        for (i in 0 until node.childCount) {
            val child = node.getChild(i) ?: continue
            val childId = captureNode(child, id, depth + 1, list)
            entry.childIds.add(childId)
            child.recycle()
        }
        return id
    }

    override fun onInterrupt() {}

    override fun onDestroy() {
        super.onDestroy()
        CaptureStore.setServiceRunning(false)
    }
}
