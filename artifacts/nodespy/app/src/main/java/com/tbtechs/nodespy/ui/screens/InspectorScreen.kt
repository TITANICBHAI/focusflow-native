package com.tbtechs.nodespy.ui.screens

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import android.widget.Toast
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ArrowBack
import androidx.compose.material.icons.filled.IosShare
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
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
import com.tbtechs.nodespy.ui.theme.*

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
    var pinnedIds by remember { mutableStateOf(emptySet<String>()) }
    var showExport by remember { mutableStateOf(false) }

    fun togglePin(id: String) {
        pinnedIds = if (id in pinnedIds) pinnedIds - id else pinnedIds + id
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
                onExportPinned = { copyAndShare(context, ExportBuilder.build(capture, pinnedIds), capture.pkg) },
                onExportAll    = { copyAndShare(context, ExportBuilder.build(capture, emptySet()), capture.pkg) }
            )
        }
    ) { padding ->
        Column(Modifier.fillMaxSize().padding(padding).background(Background)) {
            TabRow(selectedTabIndex = selectedTab, containerColor = Surface, contentColor = AccentBlue) {
                Tab(selected = selectedTab == 0, onClick = { selectedTab = 0 },
                    text = { Text("Visual", fontFamily = FontFamily.Monospace) })
                Tab(selected = selectedTab == 1, onClick = { selectedTab = 1 },
                    text = { Text("Tree", fontFamily = FontFamily.Monospace) })
            }
            when (selectedTab) {
                0 -> VisualTab(capture, pinnedIds, onTogglePin = ::togglePin)
                1 -> TreeTab(capture, pinnedIds, onTogglePin = ::togglePin)
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
    onTogglePin: (String) -> Unit
) {
    val sw = capture.screenW.toFloat()
    val sh = capture.screenH.toFloat()
    var selectedId by remember { mutableStateOf<String?>(null) }
    val selectedNode = capture.nodes.firstOrNull { it.id == selectedId }

    Column(Modifier.fillMaxSize()) {
        Box(
            Modifier.fillMaxWidth().weight(1f).background(SurfaceVar)
        ) {
            Canvas(
                modifier = Modifier
                    .fillMaxSize()
                    .pointerInput(capture.nodes) {
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
            }
        }

        if (selectedNode != null) {
            NodeDetailStrip(selectedNode, pinned = selectedNode.id in pinnedIds)
        }
    }
}

@Composable
private fun NodeDetailStrip(node: NodeEntry, pinned: Boolean) {
    Column(
        Modifier.fillMaxWidth().background(Surface).padding(12.dp)
    ) {
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
        }
        Spacer(Modifier.height(6.dp))
        if (!node.text.isNullOrBlank()) DetailRow("text", node.text)
        if (!node.desc.isNullOrBlank()) DetailRow("desc", node.desc)
        if (!node.resId.isNullOrBlank()) DetailRow("id", node.resId)
        DetailRow("bounds", "${node.boundsL},${node.boundsT} → ${node.boundsR},${node.boundsB}")
        DetailRow("depth", node.depth.toString())
        DetailRow("id", node.id)
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
    onTogglePin: (String) -> Unit
) {
    LazyColumn(contentPadding = PaddingValues(8.dp), verticalArrangement = Arrangement.spacedBy(2.dp)) {
        items(capture.nodes, key = { it.id }) { node ->
            NodeTreeRow(node, pinned = node.id in pinnedIds, onToggle = { onTogglePin(node.id) })
        }
    }
}

@Composable
private fun NodeTreeRow(node: NodeEntry, pinned: Boolean, onToggle: () -> Unit) {
    val (_, borderColor) = nodeColors(node)
    val label = node.text ?: node.desc ?: node.resId?.substringAfterLast('/') ?: ""

    Row(
        Modifier
            .fillMaxWidth()
            .padding(start = (node.depth * 8).dp.coerceAtMost(80.dp))
            .clip(RoundedCornerShape(5.dp))
            .background(if (pinned) borderColor.copy(alpha = 0.12f) else Color.Transparent)
            .clickable(onClick = onToggle)
            .padding(horizontal = 6.dp, vertical = 4.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        Checkbox(
            checked = pinned, onCheckedChange = { onToggle() },
            colors = CheckboxDefaults.colors(checkedColor = AccentGreen, uncheckedColor = Muted),
            modifier = Modifier.size(20.dp)
        )
        Spacer(Modifier.width(6.dp))
        Column(Modifier.weight(1f)) {
            Text(node.cls.substringAfterLast('.'), color = borderColor, fontSize = 12.sp,
                fontFamily = FontFamily.Monospace, fontWeight = FontWeight.Medium)
            if (label.isNotBlank()) {
                Text("\"$label\"", color = Muted, fontSize = 11.sp,
                    fontFamily = FontFamily.Monospace, maxLines = 1, overflow = TextOverflow.Ellipsis)
            }
        }
        Text(node.id, color = Outline, fontSize = 10.sp, fontFamily = FontFamily.Monospace)
    }
}

@Composable
private fun ExportBar(
    pinnedCount: Int, totalCount: Int,
    onExportPinned: () -> Unit, onExportAll: () -> Unit
) {
    Surface(color = Surface, tonalElevation = 4.dp) {
        Row(
            Modifier.fillMaxWidth().navigationBarsPadding()
                .padding(horizontal = 12.dp, vertical = 10.dp),
            horizontalArrangement = Arrangement.spacedBy(8.dp)
        ) {
            OutlinedButton(onClick = onExportAll, modifier = Modifier.weight(1f),
                colors = ButtonDefaults.outlinedButtonColors(contentColor = Muted)) {
                Text("All ($totalCount)", fontSize = 13.sp)
            }
            Button(
                onClick = onExportPinned, enabled = pinnedCount > 0,
                modifier = Modifier.weight(1f),
                colors = ButtonDefaults.buttonColors(containerColor = AccentBlue)
            ) {
                Text("Pinned ($pinnedCount)", fontSize = 13.sp, color = Background)
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
                TextButton(onClick = { copyToClipboard(context, json); onDismiss() }) {
                    Text("Copy", color = AccentBlue)
                }
                TextButton(onClick = { shareJson(context, json, capture.pkg); onDismiss() }) {
                    Text("Share", color = AccentBlue)
                }
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
