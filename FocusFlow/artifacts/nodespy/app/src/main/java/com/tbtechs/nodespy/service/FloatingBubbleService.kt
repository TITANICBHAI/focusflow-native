package com.tbtechs.nodespy.service

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.DashPathEffect
import android.graphics.Paint
import android.graphics.PixelFormat
import android.graphics.PointF
import android.graphics.Rect
import android.graphics.RectF
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.os.Build
import android.os.IBinder
import android.text.TextUtils
import android.view.Gravity
import android.view.MotionEvent
import android.view.View
import android.view.ViewGroup
import android.view.WindowManager
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.TextView
import android.widget.Toast
import com.tbtechs.nodespy.MainActivity
import com.tbtechs.nodespy.data.CaptureStore
import com.tbtechs.nodespy.data.NodeEntry
import com.tbtechs.nodespy.data.PrefsStore
import com.tbtechs.nodespy.export.ExportBuilder
import com.tbtechs.nodespy.export.RuleQualitySummary
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.launch

enum class BubbleSelectMode { NONE, TAP, REGION }

class FloatingBubbleService : Service() {

    companion object {
        var instance: FloatingBubbleService? = null
        const val ACTION_STOP          = "com.tbtechs.nodespy.STOP_BUBBLE"
        const val ACTION_TAP_SELECT    = "com.tbtechs.nodespy.TAP_SELECT"
        const val ACTION_REGION_SELECT = "com.tbtechs.nodespy.REGION_SELECT"
        const val ACTION_EXPORT        = "com.tbtechs.nodespy.EXPORT"
        const val ACTION_CLEAR_PINS    = "com.tbtechs.nodespy.CLEAR_PINS"
        const val ACTION_LOG_TOGGLE    = "com.tbtechs.nodespy.LOG_TOGGLE"
        const val ACTION_SNAP_TOGGLE   = "com.tbtechs.nodespy.SNAP_TOGGLE"

        private const val NOTIF_CHANNEL = "nodespy_bubble"
        private const val NOTIF_ID = 42

        val C_BG      = Color.parseColor("#0D1117")
        val C_SURFACE = Color.parseColor("#161B22")
        val C_OUTLINE = Color.parseColor("#30363D")
        val C_TEXT    = Color.parseColor("#E6EDF3")
        val C_GREEN   = Color.parseColor("#3FB950")
        val C_BLUE    = Color.parseColor("#58A6FF")
        val C_ORANGE  = Color.parseColor("#F0883E")
        val C_RED     = Color.parseColor("#F85149")
        val C_MUTED   = Color.parseColor("#8B949E")
        val C_PURPLE  = Color.parseColor("#D2A8FF")
    }

    private lateinit var wm: WindowManager
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main)
    private var stateJob: Job? = null

    private var bubbleView: View? = null
    private var panelView: View? = null
    private var overlayView: NodeSelectOverlay? = null

    private var bubbleParams: WindowManager.LayoutParams? = null
    private var panelParams: WindowManager.LayoutParams? = null

    private var panelVisible = false
    private var selectMode = BubbleSelectMode.NONE

    private var loggingOn = true
    private var snapOn = false
    private var pinnedCount = 0
    private var lastPkg = ""

    private var tvPanelPkg: TextView? = null
    private var tvPanelPinCount: TextView? = null
    private var tvLogToggle: TextView? = null
    private var tvSnapToggle: TextView? = null

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate()
        instance = this
        wm = getSystemService(WindowManager::class.java)
        createNotifChannel()
        startForeground(NOTIF_ID, buildNotif())
        showBubble()
        observeStore()
        if (!PrefsStore.isBubbleIntroShown()) {
            Toast.makeText(
                this,
                "Tap this bubble · then tap anything you want to block · tap Export when done",
                Toast.LENGTH_LONG
            ).show()
            PrefsStore.markBubbleIntroShown()
        }
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            ACTION_STOP          -> stopSelf()
            ACTION_TAP_SELECT    -> { removePanel(); enterSelectMode(BubbleSelectMode.TAP) }
            ACTION_REGION_SELECT -> { removePanel(); enterSelectMode(BubbleSelectMode.REGION) }
            ACTION_EXPORT        -> exportPinned()
            ACTION_CLEAR_PINS    -> { CaptureStore.clearBubblePins(); toast("Pins cleared") }
            ACTION_LOG_TOGGLE    -> {
                val next = !CaptureStore.loggingEnabled.value
                CaptureStore.setLoggingEnabled(next)
                toast(if (next) "Logging ON" else "Logging OFF")
            }
            ACTION_SNAP_TOGGLE   -> {
                if (!CaptureStore.screenshotEnabled.value && Build.VERSION.SDK_INT < Build.VERSION_CODES.R) {
                    toast("Screenshot requires Android 11+")
                } else {
                    val next = !CaptureStore.screenshotEnabled.value
                    CaptureStore.setScreenshotEnabled(next)
                    toast(if (next) "SNAP ON" else "SNAP OFF")
                }
            }
        }
        return START_STICKY
    }

    override fun onDestroy() {
        instance = null
        stateJob?.cancel()
        removeBubble()
        removePanel()
        removeOverlay()
        super.onDestroy()
    }

    private fun observeStore() {
        stateJob = scope.launch {
            combine(
                CaptureStore.loggingEnabled,
                CaptureStore.screenshotEnabled,
                CaptureStore.bubblePinnedIds,
                CaptureStore.captures
            ) { log, snap, pins, caps ->
                listOf<Any>(log, snap, pins.size, caps.firstOrNull()?.pkg ?: "")
            }.collect { values ->
                val log  = values[0] as Boolean
                val snap = values[1] as Boolean
                val pins = values[2] as Int
                val pkg  = values[3] as String
                loggingOn    = log
                snapOn       = snap
                pinnedCount  = pins
                lastPkg      = pkg
                tvLogToggle?.let { updateToggleChip(it, log, "LOG") }
                tvSnapToggle?.let { updateToggleChip(it, snap, "SNAP") }
                tvPanelPinCount?.text = "Pinned: $pins node${if (pins == 1) "" else "s"}"
                tvPanelPkg?.text      = if (pkg.isNotEmpty()) pkg else "—"
                updateNotif(pins, pkg)
            }
        }
    }

    // ── Notification ─────────────────────────────────────────────────────────

    private fun notifPi(action: String, reqCode: Int): PendingIntent =
        PendingIntent.getService(
            this, reqCode,
            Intent(this, FloatingBubbleService::class.java).apply { this.action = action },
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
        )

    private fun updateNotif(pins: Int, pkg: String) {
        val nm = getSystemService(NotificationManager::class.java)
        nm.notify(NOTIF_ID, buildNotif(pins, pkg))
    }

    private fun buildNotif(pins: Int = pinnedCount, pkg: String = lastPkg): Notification {
        val shortPkg = if (pkg.isNotEmpty()) pkg.substringAfterLast('.') else "no app captured yet"
        val pinText  = if (pins > 0) "$pins pinned" else "0 pinned"

        val logLabel  = if (loggingOn) "LOG: ON"  else "LOG: OFF"
        val snapLabel = if (snapOn)    "SNAP: ON" else "SNAP: OFF"

        val openPi = PendingIntent.getActivity(
            this, 99,
            Intent(this, MainActivity::class.java).apply {
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)
            },
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
        )

        // Android shows first 3 actions compactly, rest in expanded view.
        // Priority order: LOG toggle · SNAP toggle · Export · Clear · Stop
        val builder = Notification.Builder(this, NOTIF_CHANNEL)
            .setSmallIcon(android.R.drawable.ic_menu_view)
            .setContentTitle("NodeSpy  ·  $shortPkg  ·  $pinText")
            .setContentText("$logLabel  |  $snapLabel  —  tap actions to toggle or export")
            .setContentIntent(openPi)
            .setOngoing(true)
            .setStyle(Notification.BigTextStyle()
                .bigText("$logLabel  |  $snapLabel\nPinned: $pinText  ·  App: $shortPkg\nUse LOG/SNAP to toggle capture · Export to share"))
            .addAction(Notification.Action.Builder(null, logLabel,
                notifPi(ACTION_LOG_TOGGLE, 10)).build())
            .addAction(Notification.Action.Builder(null, snapLabel,
                notifPi(ACTION_SNAP_TOGGLE, 11)).build())
            .addAction(Notification.Action.Builder(null, "Export",
                notifPi(ACTION_EXPORT, 3)).build())
            .addAction(Notification.Action.Builder(null, "Clear",
                notifPi(ACTION_CLEAR_PINS, 4)).build())
            .addAction(Notification.Action.Builder(null, "Stop",
                notifPi(ACTION_STOP, 5)).build())

        return builder.build()
    }

    // ── Bubble ──────────────────────────────────────────────────────────────

    private fun showBubble() {
        if (bubbleView != null) return
        val dm   = resources.displayMetrics
        val dp   = dm.density
        val size = (60 * dp).toInt()

        val view = object : FrameLayout(this) {
            private var initX = 0f; private var initY = 0f
            private var startRawX = 0f; private var startRawY = 0f
            private var moved = false
            override fun onTouchEvent(e: MotionEvent): Boolean {
                when (e.action) {
                    MotionEvent.ACTION_DOWN -> {
                        initX = bubbleParams!!.x.toFloat()
                        initY = bubbleParams!!.y.toFloat()
                        startRawX = e.rawX; startRawY = e.rawY
                        moved = false
                    }
                    MotionEvent.ACTION_MOVE -> {
                        val dx = e.rawX - startRawX; val dy = e.rawY - startRawY
                        if (!moved && (Math.abs(dx) > 8 || Math.abs(dy) > 8)) moved = true
                        if (moved) {
                            bubbleParams!!.x = (initX + dx).toInt()
                            bubbleParams!!.y = (initY + dy).toInt()
                            wm.updateViewLayout(this, bubbleParams)
                        }
                    }
                    MotionEvent.ACTION_UP -> if (!moved) togglePanel()
                }
                return true
            }
        }

        val circle = TextView(this).apply {
            text = "NS"
            setTextColor(C_BG)
            textSize = 13f
            gravity = Gravity.CENTER
            typeface = Typeface.MONOSPACE
            background = GradientDrawable().apply {
                shape = GradientDrawable.OVAL
                setColor(C_GREEN)
            }
        }
        view.addView(circle, FrameLayout.LayoutParams(size, size))

        bubbleParams = baseWmParams().apply {
            width = size; height = size
            gravity = Gravity.TOP or Gravity.START
            x = dm.widthPixels - size - (8 * dp).toInt()
            y = (300 * dp).toInt()
        }
        wm.addView(view, bubbleParams)
        bubbleView = view
    }

    private fun removeBubble() {
        bubbleView?.let { runCatching { wm.removeView(it) } }
        bubbleView = null
    }

    // ── Panel ───────────────────────────────────────────────────────────────

    private fun togglePanel() {
        if (panelVisible) removePanel() else showPanel()
    }

    private fun showPanel() {
        if (panelVisible) return
        panelVisible = true
        val dp = resources.displayMetrics.density
        fun px(v: Float) = (v * dp).toInt()

        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            background = GradientDrawable().apply {
                setColor(C_SURFACE)
                cornerRadius = px(14f).toFloat()
                setStroke(px(1f), C_OUTLINE)
            }
            setPadding(px(14f), px(10f), px(14f), px(14f))
        }

        root.addView(headerRow(::px))
        root.addView(divider(dp))
        root.addView(toggleRow(::px))
        root.addView(spacer(px(8f)))
        root.addView(selectRow(::px))
        root.addView(divider(dp))
        root.addView(pinRow(::px))
        root.addView(spacer(px(6f)))
        root.addView(pkgLine())

        val container = FrameLayout(this)
        container.addView(root, FrameLayout.LayoutParams(px(300f), ViewGroup.LayoutParams.WRAP_CONTENT))

        panelParams = baseWmParams().apply {
            width  = ViewGroup.LayoutParams.WRAP_CONTENT
            height = ViewGroup.LayoutParams.WRAP_CONTENT
            gravity = Gravity.TOP or Gravity.END
            x = px(8f); y = px(60f)
        }
        wm.addView(container, panelParams)
        panelView = container
    }

    private fun headerRow(px: (Float) -> Int): View {
        val row = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            setPadding(0, 0, 0, px(8f))
        }
        val title = TextView(this).apply {
            text = "NodeSpy Bubble"
            setTextColor(C_TEXT)
            textSize = 14f
            typeface = Typeface.MONOSPACE
            layoutParams = LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f)
        }
        row.addView(title)
        row.addView(chip("✕", C_RED) { removePanel() })
        row.addView(spacer((6 * resources.displayMetrics.density).toInt()))
        row.addView(chip("■ Stop", C_RED) {
            toast("NodeSpy stopped — thanks for using it!")
            stopSelf()
        })
        return row
    }

    private fun toggleRow(px: (Float) -> Int): View {
        val row = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
        }
        tvLogToggle = chip(if (loggingOn) "● LOG" else "○ LOG", if (loggingOn) C_GREEN else C_MUTED) {
            CaptureStore.setLoggingEnabled(!CaptureStore.loggingEnabled.value)
        }
        tvSnapToggle = chip(if (snapOn) "● SNAP" else "○ SNAP", if (snapOn) C_BLUE else C_MUTED) {
            if (!snapOn && Build.VERSION.SDK_INT < Build.VERSION_CODES.R) {
                toast("Screenshot requires Android 11+")
            } else {
                CaptureStore.setScreenshotEnabled(!CaptureStore.screenshotEnabled.value)
            }
        }
        row.addView(tvLogToggle)
        row.addView(spacer(px(8f)))
        row.addView(tvSnapToggle)
        return row
    }

    private fun selectRow(px: (Float) -> Int): View {
        val row = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL }
        row.addView(chip("👆 Tap Select", C_ORANGE) {
            removePanel()
            enterSelectMode(BubbleSelectMode.TAP)
        })
        row.addView(spacer(px(8f)))
        row.addView(chip("⬜ Region", C_PURPLE) {
            removePanel()
            enterSelectMode(BubbleSelectMode.REGION)
        })
        return row
    }

    private fun pinRow(px: (Float) -> Int): LinearLayout {
        val row = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            setPadding(0, px(10f), 0, 0)
        }
        val countTv = TextView(this).apply {
            text = "Pinned: $pinnedCount node${if (pinnedCount == 1) "" else "s"}"
            setTextColor(C_TEXT)
            textSize = 12f
            layoutParams = LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f)
        }
        tvPanelPinCount = countTv
        row.addView(countTv)
        row.addView(chip("Export", C_GREEN) { exportPinned() })
        row.addView(spacer(px(6f)))
        row.addView(chip("Clear", C_RED) { CaptureStore.clearBubblePins(); toast("Pins cleared") })
        return row
    }

    private fun pkgLine(): View {
        return TextView(this).apply {
            text = if (lastPkg.isNotEmpty()) lastPkg else "—"
            setTextColor(C_MUTED)
            textSize = 10f
            typeface = Typeface.MONOSPACE
            maxLines = 1
            ellipsize = TextUtils.TruncateAt.MIDDLE
        }.also { tvPanelPkg = it }
    }

    private fun removePanel() {
        panelView?.let { runCatching { wm.removeView(it) } }
        panelView = null
        tvPanelPkg = null; tvPanelPinCount = null; tvLogToggle = null; tvSnapToggle = null
        panelVisible = false
    }

    // ── Select Overlay ───────────────────────────────────────────────────────

    private fun enterSelectMode(mode: BubbleSelectMode) {
        // Always remove any existing overlay first — prevents WindowManager double-add crash
        // (e.g. notification action tapped while overlay is already showing).
        removeOverlay()

        selectMode = mode
        val capture = CaptureStore.latest() ?: run {
            toast("No capture yet — open any app first"); return
        }
        CaptureStore.setBubbleActiveCaptureId(capture.id)

        val overlay = NodeSelectOverlay(
            context = this,
            mode = mode,
            nodes = capture.nodes,
            onPinNode = { node ->
                CaptureStore.addBubblePinnedId(node.id)
                toast("Pinned: ${node.resId?.substringAfterLast('/') ?: node.text ?: node.cls.substringAfterLast('.')}")
            },
            onDone  = { exitSelectMode() },
            onStop  = {
                toast("NodeSpy stopped — thanks for using it!")
                stopSelf()
            }
        )

        // FLAG_LAYOUT_NO_LIMITS ensures the overlay truly starts at screen (0,0)
        // so touch coordinates align with accessibility node bounds (absolute screen coords).
        val params = WindowManager.LayoutParams(
            WindowManager.LayoutParams.MATCH_PARENT,
            WindowManager.LayoutParams.MATCH_PARENT,
            WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY,
            WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or
                    WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN or
                    WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS,
            PixelFormat.TRANSLUCENT
        ).apply { gravity = Gravity.TOP or Gravity.START }
        runCatching { wm.addView(overlay, params) }.onSuccess { overlayView = overlay }
    }

    private fun exitSelectMode() {
        selectMode = BubbleSelectMode.NONE
        removeOverlay()
        showPanel()
    }

    private fun removeOverlay() {
        overlayView?.let { runCatching { wm.removeView(it) } }
        overlayView = null
    }

    // ── Export ───────────────────────────────────────────────────────────────

    private fun exportPinned() {
        val captureId = CaptureStore.bubbleActiveCaptureId.value
        val capture = (captureId?.let { CaptureStore.findById(it) }) ?: CaptureStore.latest()
        if (capture == null) { toast("Nothing to export"); return }
        val pinned = CaptureStore.bubblePinnedIds.value
        val payload = ExportBuilder.buildMinimal(capture, pinned)
        val summary = payload["ruleQuality"] as? RuleQualitySummary
        if (summary != null) {
            when {
                summary.exportableRules == 0 ->
                    toast("No exportable rules — pin nodes with IDs or stable text first")
                summary.weakRules > 0 ->
                    toast("${summary.exportableRules} recommended · ${summary.weakRules} weak rules excluded")
                else ->
                    toast("${summary.exportableRules} strong rule${if (summary.exportableRules == 1) "" else "s"} ready to export")
            }
        }
        val json = ExportBuilder.build(capture, pinned)
        val intent = Intent(Intent.ACTION_SEND).apply {
            type = "text/plain"
            putExtra(Intent.EXTRA_TEXT, json)
            putExtra(Intent.EXTRA_SUBJECT, "NodeSpy — ${capture.pkg}")
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        }
        startActivity(Intent.createChooser(intent, "Export JSON").also {
            it.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        })
    }

    // ── View Helpers ─────────────────────────────────────────────────────────

    private fun chip(label: String, color: Int, onClick: () -> Unit): TextView {
        val dp = resources.displayMetrics.density
        return TextView(this).apply {
            text = label
            setTextColor(color)
            textSize = 12f
            typeface = Typeface.MONOSPACE
            setPadding((8 * dp).toInt(), (4 * dp).toInt(), (8 * dp).toInt(), (4 * dp).toInt())
            background = GradientDrawable().apply {
                cornerRadius = 6 * dp
                setColor(Color.argb(40, Color.red(color), Color.green(color), Color.blue(color)))
                setStroke((1 * dp).toInt(), Color.argb(80, Color.red(color), Color.green(color), Color.blue(color)))
            }
            setOnClickListener { onClick() }
        }
    }

    private fun updateToggleChip(tv: TextView, on: Boolean, label: String) {
        val onColor = if (label == "LOG") C_GREEN else C_BLUE
        tv.text = if (on) "● $label" else "○ $label"
        tv.setTextColor(if (on) onColor else C_MUTED)
        (tv.background as? GradientDrawable)?.setColor(
            if (on) Color.argb(40, Color.red(onColor), Color.green(onColor), Color.blue(onColor))
            else Color.argb(30, 139, 148, 158)
        )
    }

    private fun divider(dp: Float): View {
        return View(this).apply {
            setBackgroundColor(C_OUTLINE)
            layoutParams = LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, (1 * dp).toInt()
            ).also { it.setMargins(0, (8 * dp).toInt(), 0, (8 * dp).toInt()) }
        }
    }

    private fun spacer(size: Int): View =
        View(this).apply { layoutParams = ViewGroup.LayoutParams(size, size) }

    private fun baseWmParams() = WindowManager.LayoutParams(
        WindowManager.LayoutParams.WRAP_CONTENT,
        WindowManager.LayoutParams.WRAP_CONTENT,
        WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY,
        WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or
                WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN,
        PixelFormat.TRANSLUCENT
    )

    private fun toast(msg: String) =
        Toast.makeText(applicationContext, msg, Toast.LENGTH_SHORT).show()

    private fun createNotifChannel() {
        val ch = NotificationChannel(NOTIF_CHANNEL, "NodeSpy Bubble", NotificationManager.IMPORTANCE_LOW)
        ch.description = "NodeSpy floating overlay controls"
        getSystemService(NotificationManager::class.java).createNotificationChannel(ch)
    }
}

// ── Node Select Overlay ───────────────────────────────────────────────────────

class NodeSelectOverlay(
    context: Context,
    private val mode: BubbleSelectMode,
    private val nodes: List<NodeEntry>,
    private val onPinNode: (NodeEntry) -> Unit,
    private val onDone: () -> Unit,
    private val onStop: () -> Unit = {}
) : View(context) {

    private val dp = resources.displayMetrics.density

    private val pHighlight = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        style = Paint.Style.STROKE; strokeWidth = 2f * dp
        color = FloatingBubbleService.C_GREEN
    }
    private val pHighlightFill = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        style = Paint.Style.FILL; color = Color.argb(50, 63, 185, 80)
    }
    private val pRegion = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        style = Paint.Style.STROKE; strokeWidth = 2f * dp
        color = FloatingBubbleService.C_BLUE
        pathEffect = DashPathEffect(floatArrayOf(12f, 6f), 0f)
    }
    private val pRegionFill = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        style = Paint.Style.FILL; color = Color.argb(25, 88, 166, 255)
    }
    private val pBar = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        style = Paint.Style.FILL; color = FloatingBubbleService.C_SURFACE
    }
    private val pText = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = FloatingBubbleService.C_TEXT; textSize = 13f * dp; typeface = Typeface.MONOSPACE
    }
    private val pAction = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = FloatingBubbleService.C_GREEN; textSize = 13f * dp
        typeface = Typeface.create(Typeface.MONOSPACE, Typeface.BOLD)
    }
    private val pStop = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = FloatingBubbleService.C_RED; textSize = 12f * dp
        typeface = Typeface.create(Typeface.MONOSPACE, Typeface.BOLD)
    }
    private val pMuted = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = FloatingBubbleService.C_MUTED; textSize = 11f * dp; typeface = Typeface.MONOSPACE
    }
    private val pPin = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = FloatingBubbleService.C_ORANGE; textSize = 13f * dp
        typeface = Typeface.create(Typeface.MONOSPACE, Typeface.BOLD)
    }

    private var hoveredNode: NodeEntry? = null
    private var regionStart: PointF? = null
    private var regionEnd: PointF? = null
    private var regionNodes: List<NodeEntry> = emptyList()
    private var regionFinalized = false

    // Status-bar height so touch y and node bounds stay in sync when the view
    // is not laid out with FLAG_LAYOUT_NO_LIMITS (kept as fallback reference).
    private val statusBarH: Int by lazy {
        val res = context.resources
        val id  = res.getIdentifier("status_bar_height", "dimen", "android")
        if (id > 0) res.getDimensionPixelSize(id) else (24 * dp).toInt()
    }

    private val barH = (52 * dp).toInt()

    init { setLayerType(LAYER_TYPE_SOFTWARE, null) }

    override fun onDraw(canvas: Canvas) {
        val w = width.toFloat()

        canvas.drawRect(0f, 0f, w, barH.toFloat(), pBar)

        val modeLabel = if (mode == BubbleSelectMode.TAP) "TAP MODE" else "REGION MODE"
        val instr     = if (mode == BubbleSelectMode.TAP) "Tap any element to pin it" else "Drag to select a region"
        canvas.drawText(modeLabel, 16f * dp, 20f * dp, pAction)
        canvas.drawText(instr, 16f * dp, 38f * dp, pMuted)

        val doneText = "✕ DONE"
        val stopText = "■ STOP NODE SPY"
        canvas.drawText(doneText, w - pAction.measureText(doneText) - 16f * dp, 20f * dp, pAction)
        canvas.drawText(stopText, w - pStop.measureText(stopText) - 16f * dp, 38f * dp, pStop)

        if (mode == BubbleSelectMode.TAP) {
            hoveredNode?.let { node ->
                val rect = nodeRect(node)
                canvas.drawRect(rect, pHighlightFill)
                canvas.drawRect(rect, pHighlight)

                val label  = nodeLabel(node).take(40)
                val infoW  = pText.measureText(label)
                val infoY  = (rect.bottom + 26f * dp).coerceAtMost(height - 60f * dp)
                val bgX    = rect.left.coerceAtMost(w - infoW - 80f * dp)
                canvas.drawRoundRect(
                    RectF(bgX, infoY - 18f * dp, bgX + infoW + 24f * dp, infoY + 8f * dp),
                    6 * dp, 6 * dp, pBar
                )
                canvas.drawText(label, bgX + 8f * dp, infoY, pText)

                val pinText = "[ PIN ]"
                canvas.drawText(pinText, bgX + infoW + 28f * dp, infoY, pPin)
            }
        }

        if (mode == BubbleSelectMode.REGION) {
            val start = regionStart; val end = regionEnd
            if (start != null && end != null) {
                val rect = RectF(
                    minOf(start.x, end.x), minOf(start.y, end.y),
                    maxOf(start.x, end.x), maxOf(start.y, end.y)
                )
                canvas.drawRect(rect, pRegionFill)
                canvas.drawRect(rect, pRegion)
            }
            if (regionFinalized && regionNodes.isNotEmpty()) {
                regionNodes.forEach { node ->
                    val r = nodeRect(node)
                    canvas.drawRect(r, pHighlightFill)
                    canvas.drawRect(r, pHighlight)
                }
                val confirmText = "PIN ${regionNodes.size} NODE${if (regionNodes.size == 1) "" else "S"}"
                val cancelText  = "CANCEL"
                val cy = height - 70f * dp
                val cw = pPin.measureText(confirmText)
                canvas.drawRoundRect(
                    RectF(w / 2 - cw / 2 - 14f * dp, cy - 22f * dp, w / 2 + cw / 2 + 14f * dp, cy + 8f * dp),
                    6 * dp, 6 * dp, pBar
                )
                canvas.drawText(confirmText, w / 2 - cw / 2, cy, pPin)
                canvas.drawText(cancelText, w / 2 - pMuted.measureText(cancelText) / 2, cy + 28f * dp, pMuted)
            }
        }
    }

    override fun onTouchEvent(e: MotionEvent): Boolean {
        val x = e.x; val y = e.y; val w = width.toFloat()
        if (y < barH && e.action == MotionEvent.ACTION_UP) {
            val doneText = "✕ DONE"
            val stopText = "■ STOP NODE SPY"
            val doneX = w - pAction.measureText(doneText) - 20f * dp
            val stopX = w - pStop.measureText(stopText) - 20f * dp
            val midBar = barH / 2f
            if (y < midBar && x >= doneX) { onDone(); return true }
            if (y >= midBar && x >= stopX) { onStop(); return true }
        }
        return if (mode == BubbleSelectMode.TAP) handleTap(e, x, y, w) else handleRegion(e, x, y, w)
    }

    private fun handleTap(e: MotionEvent, x: Float, y: Float, w: Float): Boolean {
        if (e.action != MotionEvent.ACTION_UP) return true
        if (y < barH) return true

        val prev = hoveredNode
        if (prev != null) {
            val label = nodeLabel(prev).take(40)
            val infoW = pText.measureText(label)
            val prevRect = nodeRect(prev)
            val infoY = (prevRect.bottom + 26f * dp).coerceAtMost(height - 60f * dp)
            val bgX   = prevRect.left.coerceAtMost(w - infoW - 80f * dp)
            val pinText = "[ PIN ]"
            val pinX  = bgX + infoW + 28f * dp
            val pinW  = pPin.measureText(pinText)
            if (x >= pinX && x <= pinX + pinW && y >= infoY - 20f * dp && y <= infoY + 10f * dp) {
                onPinNode(prev)
                hoveredNode = null; invalidate(); return true
            }
        }
        hoveredNode = nodeAt(x, y)
        invalidate()
        return true
    }

    private fun handleRegion(e: MotionEvent, x: Float, y: Float, w: Float): Boolean {
        if (y < barH) return true
        when (e.action) {
            MotionEvent.ACTION_DOWN -> {
                if (regionFinalized && regionNodes.isNotEmpty()) {
                    val cy = height - 70f * dp
                    val confirmText = "PIN ${regionNodes.size} NODE${if (regionNodes.size == 1) "" else "S"}"
                    val cw = pPin.measureText(confirmText)
                    if (y >= cy - 24f * dp && y <= cy + 10f * dp &&
                        x >= w / 2 - cw / 2 - 16f * dp && x <= w / 2 + cw / 2 + 16f * dp) {
                        regionNodes.forEach { onPinNode(it) }
                        resetRegion(); invalidate(); return true
                    }
                    if (y > cy + 18f * dp) { resetRegion(); invalidate(); return true }
                }
                regionStart = PointF(x, y); regionEnd = PointF(x, y)
                regionFinalized = false; regionNodes = emptyList()
            }
            MotionEvent.ACTION_MOVE -> { regionEnd = PointF(x, y); invalidate() }
            MotionEvent.ACTION_UP   -> {
                regionEnd = PointF(x, y)
                val start = regionStart ?: return true
                val end   = regionEnd   ?: return true

                // Convert touch rect back to absolute screen coords for hit-testing node bounds.
                // With FLAG_LAYOUT_NO_LIMITS + FLAG_LAYOUT_IN_SCREEN the overlay top == screen top,
                // so no additional offset is needed. If (as a fallback) the overlay starts below
                // the status bar, add statusBarH to compensate.
                val offsetY = if (top == 0) 0 else statusBarH
                val selL = minOf(start.x, end.x).toInt()
                val selT = minOf(start.y, end.y).toInt() + offsetY
                val selR = maxOf(start.x, end.x).toInt()
                val selB = maxOf(start.y, end.y).toInt() + offsetY

                regionNodes = nodes.filter { n ->
                    n.boundsR > selL && n.boundsL < selR &&
                    n.boundsB > selT && n.boundsT < selB
                }
                regionFinalized = true; invalidate()
            }
        }
        return true
    }

    // Convert node bounds (absolute screen coords) to view-local coords.
    // When FLAG_LAYOUT_NO_LIMITS is set the overlay top == 0 == screen top, so no offset.
    // Otherwise subtract the overlay's own top position.
    private fun nodeRect(n: NodeEntry): RectF {
        val offsetY = if (top == 0) 0f else statusBarH.toFloat()
        return RectF(n.boundsL.toFloat(), n.boundsT.toFloat() - offsetY,
                     n.boundsR.toFloat(), n.boundsB.toFloat() - offsetY)
    }

    private fun nodeAt(x: Float, y: Float): NodeEntry? {
        val offsetY = if (top == 0) 0f else statusBarH.toFloat()
        val screenY = y + offsetY
        var best: NodeEntry? = null; var bestArea = Long.MAX_VALUE
        nodes.forEach { n ->
            if (x >= n.boundsL && x <= n.boundsR && screenY >= n.boundsT && screenY <= n.boundsB) {
                val area = (n.boundsR - n.boundsL).toLong() * (n.boundsB - n.boundsT).toLong()
                if (area < bestArea) { bestArea = area; best = n }
            }
        }
        return best
    }

    private fun nodeLabel(n: NodeEntry) =
        n.resId?.substringAfterLast('/') ?: n.text ?: n.cls.substringAfterLast('.')

    private fun resetRegion() {
        regionStart = null; regionEnd = null; regionFinalized = false; regionNodes = emptyList()
    }
}
