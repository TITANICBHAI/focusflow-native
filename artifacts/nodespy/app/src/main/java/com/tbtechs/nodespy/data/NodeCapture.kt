package com.tbtechs.nodespy.data

import java.util.UUID

data class NodeCapture(
    val id: String = UUID.randomUUID().toString(),
    val timestamp: Long,
    val pkg: String,
    val activityClass: String,
    val screenW: Int,
    val screenH: Int,
    val nodes: List<NodeEntry>,
    val screenshotPath: String? = null,
    val starred: Boolean = false,
    val autoPinnedIds: Set<String> = emptySet()
)

data class NodeEntry(
    val id: String,
    val parentId: String?,
    val cls: String,
    val resId: String?,
    val text: String?,
    val desc: String?,
    val hint: String?,
    val boundsL: Int,
    val boundsT: Int,
    val boundsR: Int,
    val boundsB: Int,
    val flags: NodeFlags,
    val depth: Int,
    val childIds: MutableList<String> = mutableListOf()
)

data class NodeFlags(
    val enabled: Boolean,
    val clickable: Boolean,
    val longClickable: Boolean,
    val scrollable: Boolean,
    val checkable: Boolean,
    val checked: Boolean,
    val focused: Boolean,
    val selected: Boolean,
    val visible: Boolean,
    val password: Boolean,
    val editable: Boolean
)
