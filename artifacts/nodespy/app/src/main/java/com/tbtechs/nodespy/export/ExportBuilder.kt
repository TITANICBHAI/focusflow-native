package com.tbtechs.nodespy.export

import com.google.gson.GsonBuilder
import com.tbtechs.nodespy.data.NodeCapture
import com.tbtechs.nodespy.data.NodeEntry

/**
 * Builds the structured JSON export that FocusFlow (and other consumers) can parse.
 *
 * Format: NodeSpyCaptureV1
 *   - version        : Int schema version (bump on breaking changes)
 *   - timestamp      : Unix ms
 *   - pkg            : foreground app package name
 *   - activityClass  : activity class name
 *   - screen         : { w, h } device screen dimensions in px
 *   - nodes          : flat array of all captured nodes
 *     - id           : stable within-capture ID ("n0", "n1", …)
 *     - parentId     : null for root
 *     - cls          : full View class name
 *     - resId        : resource ID string or null
 *     - text         : visible text or null
 *     - desc         : content description or null
 *     - hint         : hint text or null
 *     - bounds       : { l, t, r, b } absolute screen pixels
 *     - boundsNorm   : { l, t, r, b } normalized 0.0–1.0 relative to screen size
 *     - flags        : enabled/clickable/scrollable/etc.
 *     - depth        : tree depth (0 = root)
 *     - children     : ordered list of child node IDs
 *   - pinnedNodeIds  : IDs of nodes the user selected / pinned for FocusFlow
 */
object ExportBuilder {

    private val gson = GsonBuilder().setPrettyPrinting().create()

    fun build(capture: NodeCapture, pinnedIds: Set<String>): String {
        val payload = buildPayload(capture, pinnedIds)
        return gson.toJson(payload)
    }

    fun buildMinimal(capture: NodeCapture, pinnedIds: Set<String>): Map<String, Any?> =
        buildPayload(capture, pinnedIds)

    private fun buildPayload(capture: NodeCapture, pinnedIds: Set<String>): Map<String, Any?> {
        val sw = capture.screenW.toFloat()
        val sh = capture.screenH.toFloat()

        val nodeList = capture.nodes.map { n -> nodeToMap(n, sw, sh) }

        return mapOf(
            "format" to "NodeSpyCaptureV1",
            "version" to 1,
            "timestamp" to capture.timestamp,
            "pkg" to capture.pkg,
            "activityClass" to capture.activityClass,
            "screen" to mapOf("w" to capture.screenW, "h" to capture.screenH),
            "nodes" to nodeList,
            "pinnedNodeIds" to pinnedIds.toList()
        )
    }

    private fun nodeToMap(n: NodeEntry, sw: Float, sh: Float): Map<String, Any?> {
        val safeR = n.boundsR.coerceAtLeast(n.boundsL)
        val safeB = n.boundsB.coerceAtLeast(n.boundsT)
        return mapOf(
            "id" to n.id,
            "parentId" to n.parentId,
            "cls" to n.cls,
            "resId" to n.resId,
            "text" to n.text,
            "desc" to n.desc,
            "hint" to n.hint,
            "bounds" to mapOf("l" to n.boundsL, "t" to n.boundsT, "r" to safeR, "b" to safeB),
            "boundsNorm" to mapOf(
                "l" to (n.boundsL / sw).coerceIn(0f, 1f),
                "t" to (n.boundsT / sh).coerceIn(0f, 1f),
                "r" to (safeR / sw).coerceIn(0f, 1f),
                "b" to (safeB / sh).coerceIn(0f, 1f)
            ),
            "flags" to mapOf(
                "enabled" to n.flags.enabled,
                "clickable" to n.flags.clickable,
                "longClickable" to n.flags.longClickable,
                "scrollable" to n.flags.scrollable,
                "checkable" to n.flags.checkable,
                "checked" to n.flags.checked,
                "focused" to n.flags.focused,
                "selected" to n.flags.selected,
                "visible" to n.flags.visible,
                "password" to n.flags.password,
                "editable" to n.flags.editable
            ),
            "depth" to n.depth,
            "children" to n.childIds
        )
    }
}
