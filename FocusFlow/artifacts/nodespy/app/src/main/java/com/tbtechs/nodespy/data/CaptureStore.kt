package com.tbtechs.nodespy.data

import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.flow.asStateFlow

object CaptureStore {

    private const val MAX_UNSTARRED = 28
    private const val MAX_STARRED = 20
    private const val MAX_EXPORT_HISTORY = 30
    private const val DEDUP_WINDOW_MS = 800L

    private val _captures = MutableStateFlow<List<NodeCapture>>(emptyList())
    val captures: StateFlow<List<NodeCapture>> = _captures.asStateFlow()

    private val _serviceRunning = MutableStateFlow(false)
    val serviceRunning: StateFlow<Boolean> = _serviceRunning.asStateFlow()

    private val _loggingEnabled = MutableStateFlow(true)
    val loggingEnabled: StateFlow<Boolean> = _loggingEnabled.asStateFlow()

    private val _screenshotEnabled = MutableStateFlow(false)
    val screenshotEnabled: StateFlow<Boolean> = _screenshotEnabled.asStateFlow()

    private val _bubblePinnedIds = MutableStateFlow<Set<String>>(emptySet())
    val bubblePinnedIds: StateFlow<Set<String>> = _bubblePinnedIds.asStateFlow()

    private val _bubbleActiveCaptureId = MutableStateFlow<String?>(null)
    val bubbleActiveCaptureId: StateFlow<String?> = _bubbleActiveCaptureId.asStateFlow()

    private val _packageAllowlist = MutableStateFlow<Set<String>>(emptySet())
    val packageAllowlist: StateFlow<Set<String>> = _packageAllowlist.asStateFlow()

    private val _autoPinRules = MutableStateFlow<List<AutoPinRule>>(emptyList())
    val autoPinRules: StateFlow<List<AutoPinRule>> = _autoPinRules.asStateFlow()

    private val _exportHistory = MutableStateFlow<List<ExportRecord>>(emptyList())
    val exportHistory: StateFlow<List<ExportRecord>> = _exportHistory.asStateFlow()

    private val _openCaptureEvent = MutableSharedFlow<String>(extraBufferCapacity = 1)
    val openCaptureEvent: SharedFlow<String> = _openCaptureEvent.asSharedFlow()

    private val _appMode = MutableStateFlow(AppMode.SIMPLE)
    val appMode: StateFlow<AppMode> = _appMode.asStateFlow()

    fun loadPersistedState() {
        _packageAllowlist.value = PrefsStore.loadAllowlist()
        _autoPinRules.value = PrefsStore.loadAutoPinRules()
        _exportHistory.value = PrefsStore.loadExportHistory()
        _appMode.value = PrefsStore.loadAppMode()
    }

    fun setAppMode(mode: AppMode) {
        _appMode.value = mode
        PrefsStore.saveAppMode(mode)
    }

    fun emitOpenCapture(id: String) {
        _openCaptureEvent.tryEmit(id)
    }

    fun setServiceRunning(running: Boolean) {
        _serviceRunning.value = running
    }

    fun setLoggingEnabled(enabled: Boolean) {
        _loggingEnabled.value = enabled
    }

    fun setScreenshotEnabled(enabled: Boolean) {
        _screenshotEnabled.value = enabled
    }

    fun addCapture(capture: NodeCapture) {
        if (!_loggingEnabled.value) return

        val allowlist = _packageAllowlist.value
        if (allowlist.isNotEmpty() && capture.pkg !in allowlist) return

        val current = _captures.value
        val last = current.firstOrNull()
        if (last != null &&
            last.pkg == capture.pkg &&
            last.activityClass == capture.activityClass &&
            last.nodes.size == capture.nodes.size &&
            capture.timestamp - last.timestamp < DEDUP_WINDOW_MS
        ) return

        val rules = _autoPinRules.value.filter { it.enabled }
        val autoPinned: Set<String> = if (rules.isEmpty()) emptySet() else {
            capture.nodes
                .filter { node -> rules.any { rule -> rule.matches(node) } }
                .map { it.id }
                .toSet()
        }
        val enriched = if (autoPinned.isEmpty()) capture else capture.copy(autoPinnedIds = autoPinned)

        val starred = current.filter { it.starred }.take(MAX_STARRED)
        val unstarred = (listOf(enriched) + current.filter { !it.starred }).take(MAX_UNSTARRED)

        _captures.value = (unstarred + starred).sortedByDescending { it.timestamp }

        if (_bubbleActiveCaptureId.value == null) {
            _bubbleActiveCaptureId.value = enriched.id
        }
    }

    // Attach a screenshot to a specific capture by ID (avoids race condition where
    // a new capture arrives before the async screenshot callback fires).
    fun updateScreenshotForCapture(captureId: String, path: String) {
        val current = _captures.value
        val idx = current.indexOfFirst { it.id == captureId }
        if (idx == -1) return
        val updated = current.toMutableList()
        updated[idx] = updated[idx].copy(screenshotPath = path)
        _captures.value = updated
    }

    // Legacy helper kept for compatibility (e.g., manual trigger from bubble).
    fun updateLatestScreenshot(path: String) {
        val id = _captures.value.firstOrNull()?.id ?: return
        updateScreenshotForCapture(id, path)
    }

    fun toggleStar(id: String) {
        _captures.value = _captures.value.map { c ->
            if (c.id == id) c.copy(starred = !c.starred) else c
        }
    }

    fun setBubblePinnedIds(ids: Set<String>) {
        _bubblePinnedIds.value = ids
    }

    fun addBubblePinnedId(id: String) {
        _bubblePinnedIds.value = _bubblePinnedIds.value + id
    }

    fun removeBubblePinnedId(id: String) {
        _bubblePinnedIds.value = _bubblePinnedIds.value - id
    }

    fun clearBubblePins() {
        _bubblePinnedIds.value = emptySet()
        _bubbleActiveCaptureId.value = _captures.value.firstOrNull()?.id
    }

    fun setBubbleActiveCaptureId(id: String?) {
        _bubbleActiveCaptureId.value = id
        _bubblePinnedIds.value = emptySet()
    }

    fun remove(id: String) {
        val capture = _captures.value.firstOrNull { it.id == id }
        capture?.screenshotPath?.let { runCatching { java.io.File(it).delete() } }
        _captures.value = _captures.value.filter { it.id != id }
    }

    fun clearAll() {
        _captures.value.forEach { c ->
            c.screenshotPath?.let { runCatching { java.io.File(it).delete() } }
        }
        _captures.value = emptyList()
        _bubblePinnedIds.value = emptySet()
        _bubbleActiveCaptureId.value = null
    }

    fun findById(id: String): NodeCapture? =
        _captures.value.firstOrNull { it.id == id }

    fun latest(): NodeCapture? = _captures.value.firstOrNull()

    fun recentForPackage(pkg: String, limit: Int = 5): List<NodeCapture> =
        _captures.value.filter { it.pkg == pkg }.take(limit)

    fun addToAllowlist(pkg: String) {
        if (pkg.isNotBlank()) {
            val updated = _packageAllowlist.value + pkg.trim()
            _packageAllowlist.value = updated
            PrefsStore.saveAllowlist(updated)
        }
    }

    fun removeFromAllowlist(pkg: String) {
        val updated = _packageAllowlist.value - pkg
        _packageAllowlist.value = updated
        PrefsStore.saveAllowlist(updated)
    }

    fun clearAllowlist() {
        _packageAllowlist.value = emptySet()
        PrefsStore.saveAllowlist(emptySet())
    }

    fun addAutoPinRule(rule: AutoPinRule) {
        val updated = _autoPinRules.value + rule
        _autoPinRules.value = updated
        PrefsStore.saveAutoPinRules(updated)
    }

    fun removeAutoPinRule(id: String) {
        val updated = _autoPinRules.value.filter { it.id != id }
        _autoPinRules.value = updated
        PrefsStore.saveAutoPinRules(updated)
    }

    fun toggleAutoPinRule(id: String) {
        val updated = _autoPinRules.value.map { r ->
            if (r.id == id) r.copy(enabled = !r.enabled) else r
        }
        _autoPinRules.value = updated
        PrefsStore.saveAutoPinRules(updated)
    }

    fun updateAutoPinRule(updated: AutoPinRule) {
        val list = _autoPinRules.value.map { r ->
            if (r.id == updated.id) updated else r
        }
        _autoPinRules.value = list
        PrefsStore.saveAutoPinRules(list)
    }

    fun recordExport(captureId: String, pkg: String, nodeCount: Int) {
        val record = ExportRecord(captureId = captureId, pkg = pkg, nodeCount = nodeCount)
        val updated = (listOf(record) + _exportHistory.value).take(MAX_EXPORT_HISTORY)
        _exportHistory.value = updated
        PrefsStore.saveExportHistory(updated)
    }
}
