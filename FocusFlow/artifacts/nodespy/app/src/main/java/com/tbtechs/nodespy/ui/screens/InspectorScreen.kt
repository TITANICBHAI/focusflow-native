package com.tbtechs.nodespy.ui.screens

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import android.widget.Toast
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.detectDragGestures
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ArrowBack
import androidx.compose.material.icons.filled.IosShare
import androidx.compose.material.icons.filled.SelectAll
import androidx.compose.material.icons.filled.TouchApp
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.PathEffect
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.tbtechs.nodespy.data.CaptureStore
import com.tbtechs.nodespy.data.NodeCapture
import com.tbtechs.nodespy.data.NodeEntry
import com.tbtechs.nodespy.export.ExportBuilder
import com.tbtechs.nodespy.export.RuleAnalyzer
import com.tbtechs.nodespy.export.RuleRecommendation
import com.tbtechs.nodespy.export.RuleQualitySummary
import com.tbtechs.nodespy.ui.theme.*

private enum class SelectMode { TAP, REGION }

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun InspectorScreen(captureId: String, onBack: () -> Unit) {
    val capture = remember { CaptureStore.findById(captureId) }
    val context = LocalContext.current

    if (capture == null) {
        Box(Modifier.fillMaxSize().background(Background), contentAlignment = Alignment.Center) {
            Text("Capture not found", color = Muted)
        }
        return
    }

    var selectedTab by remember { mutableIntStateOf(0) }
    var pinnedIds by remember { mutableStateOf(capture.autoPinnedIds) }
    var showExport by remember { mutableStateOf(false) }
    val recentCaptures = remember(capture.id) { CaptureStore.recentForPackage(capture.pkg) }
    val recommendations = remember(pinnedIds, recentCaptures) {
        RuleAnalyzer.analyze(capture, pinnedIds, recentCaptures)
    }
    val qualitySummary = remember(recommendations) { RuleAnalyzer.summarize(recommendations) }
    val recommendationByNode = remember(recommendations) { recommendations.associateBy { it.nodeId } }
    val tabLabels = listOf("Pick Elements", "All Nodes", "Help")

    fun togglePin(id: String) {
        pinnedIds = if (id in pinnedIds) pinnedIds - id else pinnedIds + id
    }

    fun bulkPin(ids: Collection<String>) {
        val allPinned = ids.all { it in pinnedIds }
        pinnedIds = if (allPinned) pinnedIds - ids.toSet() else pinnedIds + ids
    }

    Scaffold(
        containerColor = Background,
        topBar = {
            TopAppBar(
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(Icons.Default.ArrowBack, "Back", tint = OnBackground)
                    }
                },
                title = {
                    Column {
                        Text(
                            capture.pkg.substringAfterLast('.'),
                            color = OnBackground, fontWeight = FontWeight.Bold, fontSize = 15.sp,
                            maxLines = 1, overflow = TextOverflow.Ellipsis
                        )
                        Text(
                            capture.pkg, color = Muted, fontSize = 11.sp,
                            fontFamily = FontFamily.Monospace, maxLines = 1,
                            overflow = TextOverflow.Ellipsis
                        )
                    }
                },
                colors = TopAppBarDefaults.topAppBarColors(containerColor = Surface),
                actions = {
                    IconButton(onClick = { showExport = true }) {
                        Icon(Icons.Default.IosShare, "Export", tint = AccentBlue)
                    }
                }
            )
        },
        bottomBar = {
            ExportBar(
                pinnedCount = pinnedIds.size,
                totalCount = capture.nodes.size,
                onExportPinned = {
                    copyAndShare(context, ExportBuilder.build(capture, pinnedIds), capture.pkg)
                    if (pinnedIds.isNotEmpty()) CaptureStore.recordExport(capture.id, capture.pkg, pinnedIds.size)
                },
                onExportAll = {
                    copyAndShare(context, ExportBuilder.build(capture, emptySet()), capture.pkg)
                    CaptureStore.recordExport(capture.id, capture.pkg, capture.nodes.size)
                }
            )
        }
    ) { padding ->
        Column(Modifier.fillMaxSize().padding(padding).background(Background)) {
            TabRow(selectedTabIndex = selectedTab, containerColor = Surface, contentColor = AccentBlue) {
                tabLabels.forEachIndexed { i, label ->
                    Tab(
                        selected = selectedTab == i,
                        onClick = { selectedTab = i },
                        text = { Text(label, fontFamily = FontFamily.Monospace, fontSize = 13.sp) }
                    )
                }
            }
            QualityStrip(qualitySummary, pinnedIds.size)
            when (selectedTab) {
                0 -> VisualTab(capture, pinnedIds, recommendationByNode, onTogglePin = ::togglePin, onBulkPin = ::bulkPin)
                1 -> TreeTab(capture, pinnedIds, recommendationByNode, onTogglePin = ::togglePin)
                2 -> GuideTab(qualitySummary, recommendations)
            }
        }
    }

    if (showExport) {
        ExportDialog(capture, pinnedIds, onDismiss = { showExport = false }, context)
    }
}

@Composable
private fun VisualTab(
    capture: NodeCapture,
    pinnedIds: Set<String>,
    recommendations: Map<String, RuleRecommendation>,
    onTogglePin: (String) -> Unit,
    onBulkPin: (Collection<String>) -> Unit
) {
    val sw = capture.screenW.toFloat()
    val sh = capture.screenH.toFloat()
    var selectedId by remember { mutableStateOf<String?>(null) }
    val selectedNode = capture.nodes.firstOrNull { it.id == selectedId }

    var selectMode by remember { mutableStateOf(SelectMode.TAP) }
    var dragStart  by remember { mutableStateOf<Offset?>(null) }
    var dragEnd    by remember { mutableStateOf<Offset?>(null) }

    Column(Modifier.fillMaxSize()) {
        ModeToggleBar(selectMode) { mode ->
            selectMode = mode
            dragStart = null
            dragEnd = null
        }

        Box(Modifier.fillMaxWidth().weight(1f).background(SurfaceVar)) {
            Canvas(
                modifier = Modifier
                    .fillMaxSize()
                    .pointerInput(capture.nodes, selectMode) {
                        if (selectMode == SelectMode.TAP) {
                            detectTapGestures { offset ->
                                val scaleX = size.width / sw
                                val scaleY = size.height / sh
                                val hit = capture.nodes
                                    .filter { it.flags.visible }
                                    .lastOrNull { n ->
                                        offset.x in (n.boundsL * scaleX)..(n.boundsR * scaleX) &&
                                        offset.y in (n.boundsT * scaleY)..(n.boundsB * scaleY)
                                    }
                                if (hit != null) {
                                    selectedId = hit.id
                                    onTogglePin(hit.id)
                                }
                            }
                        } else {
                            detectDragGestures(
                                onDragStart = { offset ->
                                    dragStart = offset
                                    dragEnd = offset
                                },
                                onDrag = { change, _ ->
                                    dragEnd = change.position
                                },
                                onDragEnd = {
                                    val start = dragStart
                                    val end = dragEnd
                                    if (start != null && end != null) {
                                        val cw = size.width.toFloat()
                                        val ch = size.height.toFloat()
                                        val scaleX = sw / cw
                                        val scaleY = sh / ch

                                        val selL = (minOf(start.x, end.x) * scaleX).toInt()
                                        val selT = (minOf(start.y, end.y) * scaleY).toInt()
                                        val selR = (maxOf(start.x, end.x) * scaleX).toInt()
                                        val selB = (maxOf(start.y, end.y) * scaleY).toInt()

                                        val intersecting = capture.nodes
                                            .filter { n ->
                                                n.flags.visible &&
                                                n.boundsR > selL && n.boundsL < selR &&
                                                n.boundsB > selT && n.boundsT < selB
                                            }
                                            .map { it.id }

                                        if (intersecting.isNotEmpty()) onBulkPin(intersecting)
                                    }
                                    dragStart = null
                                    dragEnd = null
                                },
                                onDragCancel = {
                                    dragStart = null
                                    dragEnd = null
                                }
                            )
                        }
                    }
            ) {
                val cw = size.width
                val ch = size.height
                val scaleX = cw / sw
                val scaleY = ch / sh

                capture.nodes.filter { it.flags.visible }.forEach { n ->
                    val l = n.boundsL * scaleX
                    val t = n.boundsT * scaleY
                    val r = (n.boundsR * scaleX).coerceAtLeast(l + 1f)
                    val b = (n.boundsB * scaleY).coerceAtLeast(t + 1f)
                    val (fill, stroke) = nodeColors(n)
                    val isPinned = n.id in pinnedIds
                    val isSelected = n.id == selectedId

                    drawRect(color = fill, topLeft = Offset(l, t), size = Size(r - l, b - t))
                    drawRect(
                        color = if (isSelected) NodeSelectedBorder else stroke,
                        topLeft = Offset(l, t),
                        size = Size(r - l, b - t),
                        style = Stroke(width = if (isPinned || isSelected) 3f else 1f)
                    )
                }

                // Draw selection rectangle in REGION mode
                val start = dragStart
                val end   = dragEnd
                if (start != null && end != null && selectMode == SelectMode.REGION) {
                    val l = minOf(start.x, end.x)
                    val t = minOf(start.y, end.y)
                    val r = maxOf(start.x, end.x)
                    val b = maxOf(start.y, end.y)
                    drawRect(
                        color = AccentBlue.copy(alpha = 0.15f),
                        topLeft = Offset(l, t),
                        size = Size(r - l, b - t)
                    )
                    drawRect(
                        color = AccentBlue,
                        topLeft = Offset(l, t),
                        size = Size(r - l, b - t),
                        style = Stroke(
                            width = 2f,
                            pathEffect = PathEffect.dashPathEffect(floatArrayOf(10f, 6f))
                        )
                    )
                }
            }
        }

        if (selectedNode != null && selectMode == SelectMode.TAP) {
            NodeDetailStrip(selectedNode, pinned = selectedNode.id in pinnedIds, recommendation = recommendations[selectedNode.id])
        }
    }
}

@Composable
private fun QualityStrip(summary: RuleQualitySummary, pinnedCount: Int) {
    Surface(color = SurfaceVar) {
        Column(Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 8.dp)) {
            if (pinnedCount == 0) {
                Text(
                    "Tap an element on the map (or switch to All Nodes) to mark what you want to block.",
                    color = Muted,
                    fontSize = 12.sp,
                    lineHeight = 17.sp
                )
            } else {
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
                    QualityPill("strong", summary.strongRules, AccentGreen)
                    QualityPill("medium", summary.mediumRules, AccentYellow)
                    QualityPill("weak", summary.weakRules, AccentOrange)
                    Spacer(Modifier.weight(1f))
                    Text(
                        "${summary.exportableRules}/${summary.totalPinned} exportable",
                        color = if (summary.exportableRules == summary.totalPinned && summary.totalPinned > 0) AccentGreen else Muted,
                        fontSize = 11.sp,
                        fontFamily = FontFamily.Monospace
                    )
                }
                summary.warnings.firstOrNull()?.let {
                    Spacer(Modifier.height(4.dp))
                    Text(it, color = AccentOrange, fontSize = 11.sp, fontFamily = FontFamily.Monospace)
                }
            }
        }
    }
}

@Composable
private fun QualityPill(label: String, count: Int, color: Color) {
    Row(
        Modifier
            .clip(RoundedCornerShape(999.dp))
            .background(color.copy(alpha = 0.12f))
            .padding(horizontal = 8.dp, vertical = 3.dp),
        horizontalArrangement = Arrangement.spacedBy(4.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        Text(count.toString(), color = color, fontSize = 11.sp, fontWeight = FontWeight.Bold)
        Text(label, color = color, fontSize = 10.sp, fontFamily = FontFamily.Monospace)
    }
}

@Composable
private fun ModeToggleBar(current: SelectMode, onChange: (SelectMode) -> Unit) {
    Row(
        Modifier
            .fillMaxWidth()
            .background(Surface)
            .padding(horizontal = 12.dp, vertical = 6.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(8.dp)
    ) {
        Text("Select:", color = Muted, fontSize = 12.sp, fontFamily = FontFamily.Monospace)
        ModeButton(
            label = "Tap",
            icon = { Icon(Icons.Default.TouchApp, null, Modifier.size(16.dp)) },
            active = current == SelectMode.TAP,
            onClick = { onChange(SelectMode.TAP) }
        )
        ModeButton(
            label = "Region",
            icon = { Icon(Icons.Default.SelectAll, null, Modifier.size(16.dp)) },
            active = current == SelectMode.REGION,
            onClick = { onChange(SelectMode.REGION) }
        )
        Spacer(Modifier.weight(1f))
        if (current == SelectMode.REGION) {
            Text(
                "Drag a rectangle to pin all nodes inside",
                color = AccentBlue, fontSize = 11.sp, fontFamily = FontFamily.Monospace
            )
        }
    }
}

@Composable
private fun ModeButton(label: String, icon: @Composable () -> Unit, active: Boolean, onClick: () -> Unit) {
    val bg = if (active) AccentBlue.copy(alpha = 0.2f) else SurfaceVar
    val fg = if (active) AccentBlue else Muted
    Row(
        Modifier
            .clip(RoundedCornerShape(6.dp))
            .background(bg)
            .clickable(onClick = onClick)
            .padding(horizontal = 10.dp, vertical = 5.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(4.dp)
    ) {
        CompositionLocalProvider(LocalContentColor provides fg) { icon() }
        Text(label, color = fg, fontSize = 12.sp, fontFamily = FontFamily.Monospace, fontWeight = FontWeight.Medium)
    }
}

@Composable
private fun NodeDetailStrip(node: NodeEntry, pinned: Boolean, recommendation: RuleRecommendation?) {
    Column(Modifier.fillMaxWidth().background(Surface).padding(12.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Box(
                Modifier.clip(RoundedCornerShape(4.dp))
                    .background(if (pinned) AccentGreen.copy(alpha = 0.2f) else SurfaceVar)
                    .padding(horizontal = 6.dp, vertical = 2.dp)
            ) {
                Text(
                    if (pinned) "PINNED" else "SELECTED",
                    color = if (pinned) AccentGreen else Muted, fontSize = 10.sp,
                    fontFamily = FontFamily.Monospace, fontWeight = FontWeight.Bold
                )
            }
            Spacer(Modifier.width(8.dp))
            Text(node.cls.substringAfterLast('.'), color = AccentBlue, fontSize = 13.sp,
                fontFamily = FontFamily.Monospace, fontWeight = FontWeight.Bold)
            Spacer(Modifier.weight(1f))
            recommendation?.let { ConfidenceBadge(it) }
        }
        Spacer(Modifier.height(6.dp))
        recommendation?.let { rec ->
            DetailRow("selector", rec.selector.entries.joinToString(" + ") { it.key.removePrefix("match") })
            DetailRow("confidence", "${rec.confidence}/100 · ${rec.tier} · ${(rec.stability * 100).toInt()}% stable")
            rec.warnings.firstOrNull()?.let { DetailRow("warning", it) }
        }
        if (!node.text.isNullOrBlank()) DetailRow("text", node.text)
        if (!node.desc.isNullOrBlank()) DetailRow("desc", node.desc)
        if (!node.hint.isNullOrBlank()) DetailRow("hint", node.hint)
        if (!node.resId.isNullOrBlank()) DetailRow("id", node.resId)
        DetailRow("bounds", "${node.boundsL},${node.boundsT} → ${node.boundsR},${node.boundsB}")
        DetailRow("node-id", node.id)
        DetailRow("depth", node.depth.toString())
    }
}

@Composable
private fun DetailRow(key: String, value: String?) {
    if (value == null) return
    Row(Modifier.padding(vertical = 1.dp)) {
        Text("$key: ", color = Muted, fontSize = 12.sp, fontFamily = FontFamily.Monospace)
        Text(value, color = OnBackground, fontSize = 12.sp, fontFamily = FontFamily.Monospace,
            maxLines = 1, overflow = TextOverflow.Ellipsis)
    }
}

@Composable
private fun TreeTab(
    capture: NodeCapture,
    pinnedIds: Set<String>,
    recommendations: Map<String, RuleRecommendation>,
    onTogglePin: (String) -> Unit
) {
    Column {
        Surface(color = SurfaceVar) {
            Text(
                "Tick the checkbox next to anything you want to block, then tap Export below.",
                color = Muted,
                fontSize = 12.sp,
                lineHeight = 17.sp,
                modifier = Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 8.dp)
            )
        }
        LazyColumn(contentPadding = PaddingValues(8.dp), verticalArrangement = Arrangement.spacedBy(2.dp)) {
            items(capture.nodes, key = { it.id }) { node ->
                NodeTreeRow(
                    node,
                    pinned = node.id in pinnedIds,
                    recommendation = recommendations[node.id],
                    onToggle = { onTogglePin(node.id) }
                )
            }
        }
    }
}

private fun friendlyNodeKind(node: NodeEntry): String = when {
    node.flags.clickable && node.cls.contains("Button", ignoreCase = true) -> "Button"
    node.flags.clickable -> "Tappable"
    node.cls.contains("EditText", ignoreCase = true) || node.flags.editable -> "Text Input"
    node.cls.contains("Image", ignoreCase = true) || node.cls.contains("Icon", ignoreCase = true) -> "Image"
    node.cls.contains("Text", ignoreCase = true) -> "Text"
    node.cls.contains("List", ignoreCase = true) || node.cls.contains("Recycler", ignoreCase = true) -> "List"
    node.cls.contains("Layout", ignoreCase = true) || node.cls.contains("Frame", ignoreCase = true) ||
        node.cls.contains("Constraint", ignoreCase = true) -> "Container"
    node.cls.contains("Tab", ignoreCase = true) -> "Tab"
    node.cls.contains("Bar", ignoreCase = true) -> "Bar"
    else -> node.cls.substringAfterLast('.')
}

@Composable
private fun NodeTreeRow(node: NodeEntry, pinned: Boolean, recommendation: RuleRecommendation?, onToggle: () -> Unit) {
    val (_, borderColor) = nodeColors(node)
    val primaryLabel = node.text ?: node.desc ?: node.hint
        ?: node.resId?.substringAfterLast('/')?.replace('_', ' ')
        ?: ""
    val kind = friendlyNodeKind(node)

    Row(
        Modifier
            .fillMaxWidth()
            .padding(start = (node.depth * 8).dp.coerceAtMost(64.dp))
            .clip(RoundedCornerShape(5.dp))
            .background(if (pinned) borderColor.copy(alpha = 0.12f) else Color.Transparent)
            .clickable(onClick = onToggle)
            .padding(horizontal = 6.dp, vertical = 5.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        Checkbox(
            checked = pinned, onCheckedChange = { onToggle() },
            colors = CheckboxDefaults.colors(checkedColor = AccentGreen, uncheckedColor = Muted),
            modifier = Modifier.size(20.dp)
        )
        Spacer(Modifier.width(8.dp))
        Column(Modifier.weight(1f)) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                Text(
                    kind,
                    color = borderColor,
                    fontSize = 13.sp,
                    fontWeight = FontWeight.SemiBold
                )
                if (primaryLabel.isNotBlank()) {
                    Text(
                        "\"${primaryLabel.take(30)}\"",
                        color = OnBackground,
                        fontSize = 13.sp,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                        modifier = Modifier.weight(1f, fill = false)
                    )
                }
                recommendation?.let { ConfidenceBadge(it) }
            }
            if (node.resId != null && primaryLabel != node.resId.substringAfterLast('/')) {
                Text(
                    node.resId.substringAfterLast('/'),
                    color = Muted,
                    fontSize = 11.sp,
                    fontFamily = FontFamily.Monospace,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis
                )
            }
        }
    }
}

@Composable
private fun ConfidenceBadge(recommendation: RuleRecommendation) {
    val color = when (recommendation.tier) {
        "strong" -> AccentGreen
        "medium" -> AccentYellow
        else -> AccentOrange
    }
    Text(
        "${recommendation.confidence} ${recommendation.tier.uppercase()}",
        color = color,
        fontSize = 9.sp,
        fontFamily = FontFamily.Monospace,
        fontWeight = FontWeight.Bold,
        modifier = Modifier
            .clip(RoundedCornerShape(4.dp))
            .background(color.copy(alpha = 0.12f))
            .padding(horizontal = 5.dp, vertical = 2.dp)
    )
}

@Composable
private fun GuideTab(summary: RuleQualitySummary, recommendations: List<RuleRecommendation>) {
    LazyColumn(contentPadding = PaddingValues(12.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {

        item {
            Column(
                Modifier
                    .fillMaxWidth()
                    .clip(RoundedCornerShape(10.dp))
                    .background(Surface)
                    .padding(12.dp)
            ) {
                Text("How to use NodeSpy", color = OnBackground, fontWeight = FontWeight.Bold, fontSize = 15.sp)
                Spacer(Modifier.height(10.dp))
                val steps = listOf(
                    "Open the app you want to clean up (Instagram, TikTok, etc.).",
                    "Come back to NodeSpy — a fresh snapshot is captured automatically.",
                    "Go to Pick Elements and tap (or drag a box around) the distracting part.",
                    "Tap Export selected at the bottom and share to FocusFlow.",
                    "FocusFlow will hide that element every time the app opens."
                )
                steps.forEachIndexed { i, step ->
                    Row(verticalAlignment = Alignment.Top, modifier = Modifier.padding(vertical = 3.dp)) {
                        Box(
                            Modifier
                                .size(22.dp)
                                .clip(RoundedCornerShape(999.dp))
                                .background(AccentBlue.copy(alpha = 0.15f)),
                            contentAlignment = Alignment.Center
                        ) {
                            Text("${i + 1}", color = AccentBlue, fontSize = 11.sp, fontWeight = FontWeight.Bold)
                        }
                        Spacer(Modifier.width(10.dp))
                        Text(step, color = Muted, fontSize = 13.sp, lineHeight = 19.sp, modifier = Modifier.weight(1f))
                    }
                }
            }
        }

        if (summary.guidance.isNotEmpty()) {
            item {
                Column(
                    Modifier
                        .fillMaxWidth()
                        .clip(RoundedCornerShape(10.dp))
                        .background(Surface)
                        .padding(12.dp)
                ) {
                    Text("Suggestions for this capture", color = OnBackground, fontWeight = FontWeight.Bold, fontSize = 15.sp)
                    Spacer(Modifier.height(8.dp))
                    summary.guidance.forEachIndexed { index, step ->
                        Text("${index + 1}. $step", color = Muted, fontSize = 12.sp, lineHeight = 18.sp)
                        Spacer(Modifier.height(4.dp))
                    }
                }
            }
        }

        if (recommendations.isNotEmpty()) {
            item {
                Column(
                    Modifier
                        .fillMaxWidth()
                        .clip(RoundedCornerShape(10.dp))
                        .background(Surface)
                        .padding(12.dp)
                ) {
                    Text("How reliable are these rules?", color = OnBackground, fontWeight = FontWeight.Bold, fontSize = 15.sp)
                    Spacer(Modifier.height(6.dp))
                    Text(
                        "${summary.exportableRules} rule${if (summary.exportableRules == 1) "" else "s"} ready · avg confidence ${summary.averageConfidence}/100",
                        color = AccentBlue,
                        fontSize = 12.sp,
                        fontFamily = FontFamily.Monospace
                    )
                    summary.warnings.forEach { warning ->
                        Spacer(Modifier.height(4.dp))
                        Text("• $warning", color = AccentOrange, fontSize = 12.sp, lineHeight = 18.sp)
                    }
                }
            }
            items(recommendations, key = { it.nodeId }) { rec ->
                RecommendationCard(rec)
            }
        }
    }
}

@Composable
private fun RecommendationCard(rec: RuleRecommendation) {
    Column(
        Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(10.dp))
            .background(Surface)
            .padding(12.dp)
    ) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            ConfidenceBadge(rec)
            Text(rec.label, color = OnBackground, fontWeight = FontWeight.Bold, maxLines = 1, overflow = TextOverflow.Ellipsis)
        }
        Spacer(Modifier.height(6.dp))
        DetailRow("selector", rec.selector.entries.joinToString(" + ") { "${it.key}=${it.value.take(36)}" })
        DetailRow("stability", "${rec.matchedInRecentCaptures}/${rec.comparedCaptures} recent captures")
        rec.reasons.take(2).forEach { DetailRow("why", it) }
        rec.warnings.take(2).forEach { DetailRow("warn", it) }
    }
}

@Composable
private fun ExportBar(
    pinnedCount: Int, totalCount: Int,
    onExportPinned: () -> Unit, onExportAll: () -> Unit
) {
    Surface(color = Surface, tonalElevation = 4.dp) {
        Column(
            Modifier.fillMaxWidth().navigationBarsPadding()
                .padding(horizontal = 12.dp, vertical = 10.dp)
        ) {
            if (pinnedCount == 0) {
                Text(
                    "Mark elements above, then tap Export selected to send them to FocusFlow.",
                    color = Muted,
                    fontSize = 12.sp,
                    lineHeight = 17.sp,
                    modifier = Modifier.padding(bottom = 8.dp)
                )
            }
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                OutlinedButton(
                    onClick = onExportAll, modifier = Modifier.weight(1f),
                    colors = ButtonDefaults.outlinedButtonColors(contentColor = Muted)
                ) {
                    Text("Export all ($totalCount)", fontSize = 13.sp)
                }
                Button(
                    onClick = onExportPinned, enabled = pinnedCount > 0,
                    modifier = Modifier.weight(1f),
                    colors = ButtonDefaults.buttonColors(containerColor = AccentBlue)
                ) {
                    Text(
                        if (pinnedCount > 0) "Export selected ($pinnedCount)" else "Nothing selected",
                        fontSize = 13.sp,
                        color = Background
                    )
                }
            }
        }
    }
}

@Composable
private fun ExportDialog(
    capture: NodeCapture, pinnedIds: Set<String>,
    onDismiss: () -> Unit, context: Context
) {
    val json = remember(pinnedIds) { ExportBuilder.build(capture, pinnedIds) }

    AlertDialog(
        onDismissRequest = onDismiss, containerColor = Surface,
        title = { Text("Export JSON", color = OnBackground, fontWeight = FontWeight.Bold) },
        text = {
            Column {
                Text("${capture.nodes.size} nodes total · ${pinnedIds.size} pinned", color = Muted, fontSize = 12.sp)
                Spacer(Modifier.height(8.dp))
                Box(
                    Modifier.fillMaxWidth().height(200.dp)
                        .clip(RoundedCornerShape(6.dp)).background(Background).padding(8.dp)
                ) {
                    Text(
                        json.take(1400) + if (json.length > 1400) "\n…" else "",
                        color = AccentGreen, fontSize = 10.sp, fontFamily = FontFamily.Monospace
                    )
                }
            }
        },
        confirmButton = {
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                TextButton(onClick = {
                    copyToClipboard(context, json)
                    CaptureStore.recordExport(capture.id, capture.pkg, pinnedIds.size)
                    onDismiss()
                }) { Text("Copy", color = AccentBlue) }
                TextButton(onClick = {
                    shareJson(context, json, capture.pkg)
                    CaptureStore.recordExport(capture.id, capture.pkg, pinnedIds.size)
                    onDismiss()
                }) { Text("Share", color = AccentBlue) }
            }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text("Close", color = Muted) } }
    )
}

private fun nodeColors(node: NodeEntry): Pair<Color, Color> = when {
    node.cls.contains("Button", ignoreCase = true) || node.flags.clickable ->
        NodeButton to NodeButtonBorder
    node.cls.contains("Text", ignoreCase = true) || !node.text.isNullOrBlank() ->
        NodeText to NodeTextBorder
    node.cls.contains("Image", ignoreCase = true) || node.cls.contains("Icon", ignoreCase = true) ->
        NodeImage to NodeImageBorder
    node.cls.contains("Edit", ignoreCase = true) || node.flags.editable ->
        NodeInput to NodeInputBorder
    node.cls.contains("Layout", ignoreCase = true) || node.cls.contains("Frame", ignoreCase = true) ->
        NodeLayout to NodeLayoutBorder
    else -> NodeOther to NodeOtherBorder
}

private fun copyToClipboard(context: Context, text: String) {
    val cm = context.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
    cm.setPrimaryClip(ClipData.newPlainText("NodeSpy Export", text))
    Toast.makeText(context, "Copied to clipboard", Toast.LENGTH_SHORT).show()
}

private fun shareJson(context: Context, json: String, pkg: String) {
    context.startActivity(Intent.createChooser(
        Intent(Intent.ACTION_SEND).apply {
            type = "text/plain"
            putExtra(Intent.EXTRA_TEXT, json)
            putExtra(Intent.EXTRA_SUBJECT, "NodeSpy — $pkg")
        }, "Share capture"
    ))
}

private fun copyAndShare(context: Context, json: String, pkg: String) {
    copyToClipboard(context, json)
    shareJson(context, json, pkg)
}
