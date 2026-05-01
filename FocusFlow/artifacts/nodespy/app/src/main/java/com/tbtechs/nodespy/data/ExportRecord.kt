package com.tbtechs.nodespy.data

data class ExportRecord(
    val timestamp: Long = System.currentTimeMillis(),
    val captureId: String,
    val pkg: String,
    val nodeCount: Int
)
