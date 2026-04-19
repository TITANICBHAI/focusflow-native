package com.tbtechs.nodespy.data

import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

object CaptureStore {

    private const val MAX_CAPTURES = 30
    private const val DEDUP_WINDOW_MS = 800L

    private val _captures = MutableStateFlow<List<NodeCapture>>(emptyList())
    val captures: StateFlow<List<NodeCapture>> = _captures.asStateFlow()

    private val _serviceRunning = MutableStateFlow(false)
    val serviceRunning: StateFlow<Boolean> = _serviceRunning.asStateFlow()

    fun setServiceRunning(running: Boolean) {
        _serviceRunning.value = running
    }

    fun addCapture(capture: NodeCapture) {
        val current = _captures.value
        val last = current.firstOrNull()
        if (last != null &&
            last.pkg == capture.pkg &&
            last.activityClass == capture.activityClass &&
            last.nodes.size == capture.nodes.size &&
            capture.timestamp - last.timestamp < DEDUP_WINDOW_MS) {
            return
        }

        val updated = (listOf(capture) + current).take(MAX_CAPTURES)
        _captures.value = updated
    }

    fun remove(id: String) {
        _captures.value = _captures.value.filter { it.id != id }
    }

    fun clearAll() {
        _captures.value = emptyList()
    }

    fun findById(id: String): NodeCapture? =
        _captures.value.firstOrNull { it.id == id }
}
