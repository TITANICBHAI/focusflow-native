package com.tbtechs.nodespy.ui.screens

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import android.graphics.BitmapFactory
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.detectDragGestures
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.PathEffect
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.IntSize
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.tbtechs.nodespy.data.*
import com.tbtechs.nodespy.export.ExportBuilder
import com.tbtechs.nodespy.ui.theme.*
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SimpleInspectorScreen(captureId: String, onBack: () -> Unit, onSwitchToDev: () -> Unit) {
    val capture = remember { CaptureStore.findById(captureId) }
    val context = LocalContext.current

    if (capture == null) {
        Box(Modifier.fillMaxSize().background(Background), contentAlignment = Alignment.Center) {
            Text("Snapshot not found", color = Muted)
        }
        return
    }

    val appProfile = remember { getAppProfile(capture.pkg) }
    var markedIds by remember { mutableStateOf(capture.autoPinnedIds) }
    var activeTab by remember { mutableIntStateOf(0) }
    var showTapMode by remember { mutableStateOf(false) }
    var showSuccess by remember { mutableStateOf(false) }

    fun toggleMark(id: String) {
        markedIds = if (id in markedIds) markedIds - id else markedIds + id
    }

    fun markSuggestion(suggestion: BlockSuggestion) {
        val matched = capture.nodes.filter { matchesSuggestion(suggestion, it) }.map { it.id }.toSet()
        markedIds = markedIds + matched
    }

    fun sendToFocusFlow() {
        val json = ExportBuilder.build(capture, markedIds)
        val clipboard = context.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
        clipboard.setPrimaryClip(ClipData.newPlainText("NodeSpy Rules", json))
        CaptureStore.recordExport(capture.id, capture.pkg, markedIds.size)
        showSuccess = true
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
                        val appName = getAppProfile(capture.pkg)?.displayName
                            ?: capture.pkg.substringAfterLast('.')
                                .replaceFirstChar { it.uppercase() }
                        Text(
                            appName,
                            color = OnBackground,
                            fontWeight = FontWeight.Bold,
                            fontSize = 16.sp,
                            maxLines = 1
                        )
                        Text(
                            "${capture.nodes.count { it.flags.visible }} elements found",
                            color = Muted,
                            fontSize = 12.sp
                        )
                    }
                },
                colors = TopAppBarDefaults.topAppBarColors(containerColor = Surface),
                actions = {
                    TextButton(onClick = onSwitchToDev) {
                        Text("Dev view", color = Muted, fontSize = 12.sp)
                    }
                }
            )
        },
        bottomBar = {
            SimpleExportBar(
                markedCount = markedIds.size,
                onSend = ::sendToFocusFlow,
                onShare = {
                    val json = ExportBuilder.build(capture, markedIds)
                    val intent = Intent(Intent.ACTION_SEND).apply {
                        type = "text/plain"
                        putExtra(Intent.EXTRA_TEXT, json)
                        putExtra(Intent.EXTRA_SUBJECT, "Block rules — ${capture.pkg}")
                        addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                    }
                    context.startActivity(Intent.createChooser(intent, "Share rules").also {
                        it.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                    })
                }
            )
        }
    ) { padding ->
        Column(Modifier.fillMaxSize().padding(padding).background(Background)) {
            ScrollableTabRow(
                selectedTabIndex = activeTab,
                containerColor = Surface,
                contentColor = AccentGreen,
                edgePadding = 0.dp
            ) {
                Tab(
                    selected = activeTab == 0,
                    onClick = { activeTab = 0 },
                    modifier = Modifier.height(44.dp),
                    text = { Text("Pick", fontSize = 14.sp, fontWeight = FontWeight.SemiBold) }
                )
                Tab(
                    selected = activeTab == 1,
                    onClick = { activeTab = 1 },
                    modifier = Modifier.height(44.dp),
                    text = {
                        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                            Text("Marked", fontSize = 14.sp, fontWeight = FontWeight.SemiBold)
                            if (markedIds.isNotEmpty()) {
                                Box(
                                    Modifier
                                        .size(18.dp)
                                        .clip(CircleShape)
                                        .background(AccentGreen),
                                    contentAlignment = Alignment.Center
                                ) {
                                    Text(
                                        markedIds.size.toString(),
                                        color = Background,
                                        fontSize = 10.sp,
                                        fontWeight = FontWeight.Bold
                                    )
                                }
                            }
                        }
                    }
                )
                if (appProfile != null) {
                    Tab(
                        selected = activeTab == 2,
                        onClick = { activeTab = 2 },
                        modifier = Modifier.height(44.dp),
                        text = { Text("Suggestions", fontSize = 14.sp, fontWeight = FontWeight.SemiBold) }
                    )
                }
            }

            when (activeTab) {
                0 -> PickElementsTab(
                    capture = capture,
                    markedIds = markedIds,
                    onToggle = ::toggleMark
                )
                1 -> MarkedListTab(
                    capture = capture,
                    markedIds = markedIds,
                    onUnmark = ::toggleMark,
                    onClearAll = { markedIds = emptySet() }
                )
                2 -> SuggestionsTab(
                    appProfile = appProfile!!,
                    capture = capture,
                    markedIds = markedIds,
                    onMarkSuggestion = ::markSuggestion
                )
            }
        }
    }

    if (showSuccess) {
        SendSuccessDialog(
            markedCount = markedIds.size,
            onDismiss = { showSuccess = false }
        )
    }
}

@Composable
private fun PickElementsTab(
    capture: NodeCapture,
    markedIds: Set<String>,
    onToggle: (String) -> Unit
) {
    val sw = capture.screenW.toFloat()
    val sh = capture.screenH.toFloat()
    var selectedId by remember { mutableStateOf<String?>(null) }
    var dragStart by remember { mutableStateOf<Offset?>(null) }
    var dragEnd by remember { mutableStateOf<Offset?>(null) }
    var tapMode by remember { mutableStateOf(true) }

    // Load bitmap on IO thread so we never block the composition thread
    val screenshotLoading = capture.screenshotPath != null
    val screenshot by produceState<ImageBitmap?>(initialValue = null, capture.screenshotPath) {
        value = withContext(Dispatchers.IO) {
            capture.screenshotPath?.let { path ->
                try { BitmapFactory.decodeFile(path)?.asImageBitmap() } catch (_: Exception) { null }
            }
        }
    }
    val hasScreenshot = screenshot != null

    Column(Modifier.fillMaxSize()) {
        Row(
            Modifier
                .fillMaxWidth()
                .background(Surface)
                .padding(horizontal = 10.dp, vertical = 6.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(6.dp)
        ) {
            Text(
                if (hasScreenshot) {
                    if (tapMode) "Tap anything on the screenshot to mark it"
                    else "Drag a box around what you want to block"
                } else {
                    if (tapMode) "Tap any colored area to mark it" else "Drag a box to select an area"
                },
                color = Muted,
                fontSize = 12.sp,
                modifier = Modifier.weight(1f)
            )
            FilterChip(
                selected = tapMode,
                onClick = { tapMode = true; dragStart = null; dragEnd = null },
                label = { Text("Tap", fontSize = 11.sp) },
                colors = FilterChipDefaults.filterChipColors(
                    selectedContainerColor = AccentGreen.copy(alpha = 0.15f),
                    selectedLabelColor = AccentGreen,
                    containerColor = SurfaceVar,
                    labelColor = Muted
                )
            )
            FilterChip(
                selected = !tapMode,
                onClick = { tapMode = false },
                label = { Text("Box", fontSize = 11.sp) },
                colors = FilterChipDefaults.filterChipColors(
                    selectedContainerColor = AccentBlue.copy(alpha = 0.15f),
                    selectedLabelColor = AccentBlue,
                    containerColor = SurfaceVar,
                    labelColor = Muted
                )
            )
        }

        Box(
            Modifier
                .fillMaxWidth()
                .weight(1f)
                .background(if (hasScreenshot) Background else SurfaceVar)
        ) {
            Canvas(
                Modifier
                    .fillMaxSize()
                    .pointerInput(capture.nodes, tapMode) {
                        if (tapMode) {
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
                                    onToggle(hit.id)
                                }
                            }
                        } else {
                            detectDragGestures(
                                onDragStart = { o -> dragStart = o; dragEnd = o },
                                onDrag = { change, _ -> dragEnd = change.position },
                                onDragEnd = {
                                    val start = dragStart; val end = dragEnd
                                    if (start != null && end != null) {
                                        val cw = size.width.toFloat(); val ch = size.height.toFloat()
                                        val scaleX = sw / cw; val scaleY = sh / ch
                                        val selL = (minOf(start.x, end.x) * scaleX).toInt()
                                        val selT = (minOf(start.y, end.y) * scaleY).toInt()
                                        val selR = (maxOf(start.x, end.x) * scaleX).toInt()
                                        val selB = (maxOf(start.y, end.y) * scaleY).toInt()
                                        capture.nodes.filter { n ->
                                            n.flags.visible &&
                                                    n.boundsR > selL && n.boundsL < selR &&
                                                    n.boundsB > selT && n.boundsT < selB
                                        }.forEach { onToggle(it.id) }
                                    }
                                    dragStart = null; dragEnd = null
                                },
                                onDragCancel = { dragStart = null; dragEnd = null }
                            )
                        }
                    }
            ) {
                val cw = size.width
                val ch = size.height
                val scaleX = cw / sw
                val scaleY = ch / sh
                val snap = screenshot   // local val — required for smart-cast on delegated property

                if (snap != null) {
                    drawImage(
                        image = snap,
                        srcOffset = IntOffset.Zero,
                        srcSize = IntSize(snap.width, snap.height),
                        dstOffset = IntOffset.Zero,
                        dstSize = IntSize(cw.toInt(), ch.toInt())
                    )
                    capture.nodes.filter { it.flags.visible }.forEach { n ->
                        val l = n.boundsL * scaleX
                        val t = n.boundsT * scaleY
                        val r = (n.boundsR * scaleX).coerceAtLeast(l + 1f)
                        val b = (n.boundsB * scaleY).coerceAtLeast(t + 1f)
                        val isMarked = n.id in markedIds
                        val isSelected = n.id == selectedId

                        when {
                            isMarked -> {
                                drawRect(
                                    color = AccentGreen.copy(alpha = 0.25f),
                                    topLeft = Offset(l, t), size = Size(r - l, b - t)
                                )
                                drawRect(
                                    color = AccentGreen,
                                    topLeft = Offset(l, t), size = Size(r - l, b - t),
                                    style = Stroke(width = 3f)
                                )
                            }
                            isSelected -> {
                                drawRect(
                                    color = Color.White.copy(alpha = 0.12f),
                                    topLeft = Offset(l, t), size = Size(r - l, b - t)
                                )
                                drawRect(
                                    color = Color.White,
                                    topLeft = Offset(l, t), size = Size(r - l, b - t),
                                    style = Stroke(
                                        width = 2.5f,
                                        pathEffect = PathEffect.dashPathEffect(floatArrayOf(8f, 4f))
                                    )
                                )
                            }
                        }
                    }
                } else {
                    capture.nodes.filter { it.flags.visible }.forEach { n ->
                        val l = n.boundsL * scaleX
                        val t = n.boundsT * scaleY
                        val r = (n.boundsR * scaleX).coerceAtLeast(l + 1f)
                        val b = (n.boundsB * scaleY).coerceAtLeast(t + 1f)
                        val isMarked = n.id in markedIds
                        val isSelected = n.id == selectedId
                        val (fill, stroke) = nodeColors(n)
                        drawRect(color = fill, topLeft = Offset(l, t), size = Size(r - l, b - t))
                        drawRect(
                            color = if (isMarked) AccentGreen else if (isSelected) Color.White else stroke,
                            topLeft = Offset(l, t), size = Size(r - l, b - t),
                            style = Stroke(width = if (isMarked || isSelected) 3f else 1f)
                        )
                    }
                }

                val start = dragStart; val end = dragEnd
                if (start != null && end != null && !tapMode) {
                    val l = minOf(start.x, end.x); val t = minOf(start.y, end.y)
                    val r = maxOf(start.x, end.x); val b = maxOf(start.y, end.y)
                    drawRect(color = AccentBlue.copy(alpha = 0.18f), topLeft = Offset(l, t), size = Size(r - l, b - t))
                    drawRect(
                        color = AccentBlue, topLeft = Offset(l, t), size = Size(r - l, b - t),
                        style = Stroke(width = 2f, pathEffect = PathEffect.dashPathEffect(floatArrayOf(10f, 6f)))
                    )
                }
            }

            // Screenshot loading spinner — path set but bitmap not decoded yet
            if (screenshotLoading && !hasScreenshot) {
                Box(
                    Modifier
                        .align(Alignment.Center)
                        .clip(RoundedCornerShape(12.dp))
                        .background(Surface.copy(alpha = 0.88f))
                        .padding(horizontal = 20.dp, vertical = 14.dp),
                    contentAlignment = Alignment.Center
                ) {
                    Row(
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(10.dp)
                    ) {
                        CircularProgressIndicator(
                            modifier = Modifier.size(18.dp),
                            color = AccentGreen,
                            strokeWidth = 2.dp
                        )
                        Text("Loading screenshot…", color = OnBackground, fontSize = 13.sp)
                    }
                }
            }

            // No screenshot at all — prompt user to enable SNAP
            if (!screenshotLoading && !hasScreenshot && markedIds.isEmpty() && dragStart == null) {
                Box(
                    Modifier
                        .align(Alignment.BottomCenter)
                        .padding(bottom = 12.dp)
                        .clip(RoundedCornerShape(8.dp))
                        .background(Surface.copy(alpha = 0.9f))
                        .padding(horizontal = 14.dp, vertical = 8.dp)
                ) {
                    Text(
                        "No screenshot for this snapshot.\nTap SNAP in the bubble or notification to enable it.",
                        color = Muted, fontSize = 11.sp, textAlign = TextAlign.Center
                    )
                }
            }
        }

        val sel = capture.nodes.firstOrNull { it.id == selectedId }
        if (sel != null && tapMode) {
            Row(
                Modifier
                    .fillMaxWidth()
                    .background(Surface)
                    .padding(horizontal = 14.dp, vertical = 10.dp),
                verticalAlignment = Alignment.CenterVertically
            ) {
                Column(Modifier.weight(1f)) {
                    val label = sel.text ?: sel.desc ?: sel.hint
                        ?: sel.resId?.substringAfterLast('/')
                        ?: sel.cls.substringAfterLast('.')
                    Text(
                        label,
                        color = if (sel.id in markedIds) AccentGreen else OnBackground,
                        fontSize = 14.sp, fontWeight = FontWeight.SemiBold,
                        maxLines = 1, overflow = TextOverflow.Ellipsis
                    )
                    Text(sel.cls.substringAfterLast('.'), color = Muted, fontSize = 11.sp)
                }
                Spacer(Modifier.width(10.dp))
                if (sel.id in markedIds) {
                    OutlinedButton(
                        onClick = { onToggle(sel.id) },
                        colors = ButtonDefaults.outlinedButtonColors(contentColor = AccentRed),
                        border = androidx.compose.foundation.BorderStroke(1.dp, AccentRed.copy(alpha = 0.5f)),
                        contentPadding = PaddingValues(horizontal = 14.dp, vertical = 6.dp)
                    ) { Text("Unmark", fontSize = 13.sp) }
                } else {
                    Button(
                        onClick = { onToggle(sel.id) },
                        colors = ButtonDefaults.buttonColors(containerColor = AccentGreen),
                        contentPadding = PaddingValues(horizontal = 14.dp, vertical = 6.dp)
                    ) { Text("Mark to block", color = Background, fontSize = 13.sp, fontWeight = FontWeight.Bold) }
                }
            }
        }
    }
}

@Composable
private fun MarkedListTab(
    capture: NodeCapture,
    markedIds: Set<String>,
    onUnmark: (String) -> Unit,
    onClearAll: () -> Unit
) {
    if (markedIds.isEmpty()) {
        Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
            Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(12.dp)) {
                Icon(Icons.Default.CheckBoxOutlineBlank, null, tint = Muted, modifier = Modifier.size(52.dp))
                Text("Nothing marked yet", color = OnBackground, fontSize = 16.sp, fontWeight = FontWeight.SemiBold)
                Text(
                    "Go to Pick elements and tap what you want to block",
                    color = Muted, fontSize = 13.sp, textAlign = TextAlign.Center,
                    modifier = Modifier.padding(horizontal = 32.dp)
                )
            }
        }
        return
    }

    val markedNodes = remember(markedIds) {
        capture.nodes.filter { it.id in markedIds }
    }

    LazyColumn(
        contentPadding = PaddingValues(12.dp),
        verticalArrangement = Arrangement.spacedBy(6.dp)
    ) {
        item {
            Row(
                Modifier.fillMaxWidth().padding(bottom = 4.dp),
                verticalAlignment = Alignment.CenterVertically
            ) {
                Text(
                    "${markedIds.size} element${if (markedIds.size == 1) "" else "s"} marked to block",
                    color = AccentGreen, fontWeight = FontWeight.Bold, fontSize = 14.sp
                )
                Spacer(Modifier.weight(1f))
                TextButton(onClick = onClearAll) {
                    Text("Clear all", color = AccentRed, fontSize = 12.sp)
                }
            }
        }
        items(markedNodes, key = { it.id }) { node ->
            MarkedNodeRow(node = node, onUnmark = { onUnmark(node.id) })
        }
        item { Spacer(Modifier.height(16.dp)) }
    }
}

@Composable
private fun MarkedNodeRow(node: NodeEntry, onUnmark: () -> Unit) {
    val label = node.text ?: node.desc ?: node.hint ?: node.resId?.substringAfterLast('/') ?: node.cls.substringAfterLast('.')
    val typeLabel = node.cls.substringAfterLast('.')

    Card(
        colors = CardDefaults.cardColors(containerColor = Surface),
        shape = RoundedCornerShape(8.dp),
        modifier = Modifier.fillMaxWidth()
    ) {
        Row(
            Modifier.padding(horizontal = 14.dp, vertical = 10.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            Box(
                Modifier
                    .size(36.dp)
                    .clip(RoundedCornerShape(8.dp))
                    .background(AccentGreen.copy(alpha = 0.15f)),
                contentAlignment = Alignment.Center
            ) {
                Icon(Icons.Default.Block, null, tint = AccentGreen, modifier = Modifier.size(18.dp))
            }
            Spacer(Modifier.width(12.dp))
            Column(Modifier.weight(1f)) {
                Text(label, color = OnBackground, fontSize = 14.sp, fontWeight = FontWeight.SemiBold,
                    maxLines = 1, overflow = TextOverflow.Ellipsis)
                Text(typeLabel, color = Muted, fontSize = 11.sp)
            }
            IconButton(onClick = onUnmark, modifier = Modifier.size(36.dp)) {
                Icon(Icons.Default.Close, "Unmark", tint = Muted, modifier = Modifier.size(18.dp))
            }
        }
    }
}

@Composable
private fun SuggestionsTab(
    appProfile: AppProfile,
    capture: NodeCapture,
    markedIds: Set<String>,
    onMarkSuggestion: (BlockSuggestion) -> Unit
) {
    LazyColumn(
        contentPadding = PaddingValues(12.dp),
        verticalArrangement = Arrangement.spacedBy(10.dp)
    ) {
        item {
            Column(
                Modifier
                    .fillMaxWidth()
                    .clip(RoundedCornerShape(10.dp))
                    .background(AccentBlue.copy(alpha = 0.08f))
                    .padding(14.dp)
            ) {
                Text(appProfile.tagline, color = AccentBlue, fontSize = 13.sp, fontWeight = FontWeight.SemiBold)
                Spacer(Modifier.height(4.dp))
                Text(
                    "Tap any suggestion below to automatically mark all matching elements in this snapshot.",
                    color = Muted, fontSize = 12.sp, lineHeight = 18.sp
                )
            }
        }

        items(appProfile.suggestions) { suggestion ->
            val matchCount = remember(suggestion, capture) {
                capture.nodes.count { matchesSuggestion(suggestion, it) }
            }
            val alreadyMarked = remember(suggestion, capture, markedIds) {
                capture.nodes.filter { matchesSuggestion(suggestion, it) }.all { it.id in markedIds }
            }

            SuggestionCard(
                suggestion = suggestion,
                matchCount = matchCount,
                alreadyMarked = alreadyMarked,
                onMark = { onMarkSuggestion(suggestion) }
            )
        }

        item {
            Column(
                Modifier
                    .fillMaxWidth()
                    .clip(RoundedCornerShape(10.dp))
                    .background(SurfaceVar)
                    .padding(14.dp)
            ) {
                Text("Don't see what you need?", color = OnBackground, fontSize = 13.sp, fontWeight = FontWeight.SemiBold)
                Spacer(Modifier.height(4.dp))
                Text(
                    "Switch to Pick elements and tap directly on what you want to block. You can also use Box select to mark a whole section at once.",
                    color = Muted, fontSize = 12.sp, lineHeight = 18.sp
                )
            }
        }
        item { Spacer(Modifier.height(16.dp)) }
    }
}

@Composable
private fun SuggestionCard(
    suggestion: BlockSuggestion,
    matchCount: Int,
    alreadyMarked: Boolean,
    onMark: () -> Unit
) {
    val hasMatches = matchCount > 0

    Card(
        colors = CardDefaults.cardColors(
            containerColor = if (alreadyMarked) AccentGreen.copy(alpha = 0.06f) else Surface
        ),
        shape = RoundedCornerShape(10.dp),
        modifier = Modifier.fillMaxWidth()
    ) {
        Row(
            Modifier.padding(14.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            Column(Modifier.weight(1f)) {
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text(suggestion.label, color = OnBackground, fontWeight = FontWeight.SemiBold, fontSize = 15.sp)
                    if (alreadyMarked) {
                        Box(
                            Modifier
                                .clip(RoundedCornerShape(4.dp))
                                .background(AccentGreen.copy(alpha = 0.15f))
                                .padding(horizontal = 6.dp, vertical = 2.dp)
                        ) {
                            Text("Marked", color = AccentGreen, fontSize = 10.sp, fontWeight = FontWeight.Bold)
                        }
                    }
                }
                Spacer(Modifier.height(4.dp))
                Text(suggestion.description, color = Muted, fontSize = 12.sp, lineHeight = 17.sp)
                if (hasMatches) {
                    Spacer(Modifier.height(4.dp))
                    Text(
                        "$matchCount matching element${if (matchCount == 1) "" else "s"} found in this snapshot",
                        color = if (alreadyMarked) AccentGreen else AccentBlue,
                        fontSize = 11.sp
                    )
                } else {
                    Spacer(Modifier.height(4.dp))
                    Text(
                        "Not found in this snapshot — try capturing that screen first",
                        color = Muted, fontSize = 11.sp
                    )
                }
            }
            Spacer(Modifier.width(12.dp))
            if (!alreadyMarked && hasMatches) {
                Button(
                    onClick = onMark,
                    colors = ButtonDefaults.buttonColors(containerColor = AccentGreen),
                    contentPadding = PaddingValues(horizontal = 14.dp, vertical = 8.dp),
                    shape = RoundedCornerShape(8.dp)
                ) {
                    Text("Mark", color = Background, fontSize = 13.sp, fontWeight = FontWeight.Bold)
                }
            } else if (alreadyMarked) {
                Icon(Icons.Default.CheckCircle, null, tint = AccentGreen, modifier = Modifier.size(28.dp))
            } else {
                Icon(Icons.Default.HelpOutline, null, tint = Muted, modifier = Modifier.size(24.dp))
            }
        }
    }
}

@Composable
private fun SimpleExportBar(
    markedCount: Int,
    onSend: () -> Unit,
    onShare: () -> Unit
) {
    Surface(color = Surface, tonalElevation = 4.dp) {
        Column(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 12.dp)) {
            if (markedCount == 0) {
                Text(
                    "Mark elements above, then tap Send to FocusFlow",
                    color = Muted, fontSize = 12.sp, textAlign = TextAlign.Center,
                    modifier = Modifier.fillMaxWidth()
                )
            } else {
                Row(
                    Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(10.dp),
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Button(
                        onClick = onSend,
                        modifier = Modifier.weight(1f),
                        colors = ButtonDefaults.buttonColors(containerColor = AccentGreen),
                        shape = RoundedCornerShape(10.dp),
                        contentPadding = PaddingValues(vertical = 14.dp)
                    ) {
                        Icon(Icons.Default.Send, null, modifier = Modifier.size(16.dp), tint = Background)
                        Spacer(Modifier.width(8.dp))
                        Text(
                            "Copy rules ($markedCount)",
                            color = Background,
                            fontWeight = FontWeight.Bold,
                            fontSize = 14.sp
                        )
                    }
                    OutlinedButton(
                        onClick = onShare,
                        colors = ButtonDefaults.outlinedButtonColors(contentColor = Muted),
                        border = androidx.compose.foundation.BorderStroke(1.dp, Outline),
                        shape = RoundedCornerShape(10.dp),
                        contentPadding = PaddingValues(horizontal = 16.dp, vertical = 14.dp)
                    ) {
                        Icon(Icons.Default.Share, null, modifier = Modifier.size(16.dp))
                    }
                }
            }
        }
    }
}

@Composable
private fun SendSuccessDialog(markedCount: Int, onDismiss: () -> Unit) {
    AlertDialog(
        onDismissRequest = onDismiss,
        containerColor = Surface,
        icon = {
            Box(
                Modifier
                    .size(56.dp)
                    .clip(CircleShape)
                    .background(AccentGreen.copy(alpha = 0.15f)),
                contentAlignment = Alignment.Center
            ) {
                Icon(Icons.Default.CheckCircle, null, tint = AccentGreen, modifier = Modifier.size(32.dp))
            }
        },
        title = {
            Text(
                "Rules copied to clipboard",
                color = OnBackground, fontWeight = FontWeight.Bold,
                textAlign = TextAlign.Center, modifier = Modifier.fillMaxWidth()
            )
        },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                Text(
                    "$markedCount element${if (markedCount == 1) "" else "s"} ready to block.",
                    color = Muted, fontSize = 14.sp, textAlign = TextAlign.Center,
                    modifier = Modifier.fillMaxWidth()
                )
                Column(
                    Modifier
                        .fillMaxWidth()
                        .clip(RoundedCornerShape(8.dp))
                        .background(SurfaceVar)
                        .padding(12.dp),
                    verticalArrangement = Arrangement.spacedBy(8.dp)
                ) {
                    StepRow(number = "1", text = "Open FocusFlow")
                    StepRow(number = "2", text = "Go to Custom Node Rules")
                    StepRow(number = "3", text = "Tap Import — then Paste")
                    StepRow(number = "4", text = "Save — you're done!")
                }
            }
        },
        confirmButton = {
            Button(
                onClick = onDismiss,
                modifier = Modifier.fillMaxWidth(),
                colors = ButtonDefaults.buttonColors(containerColor = AccentGreen),
                shape = RoundedCornerShape(8.dp)
            ) {
                Text("Got it", color = Background, fontWeight = FontWeight.Bold)
            }
        }
    )
}

@Composable
private fun StepRow(number: String, text: String) {
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
        Box(
            Modifier
                .size(22.dp)
                .clip(CircleShape)
                .background(AccentGreen.copy(alpha = 0.2f)),
            contentAlignment = Alignment.Center
        ) {
            Text(number, color = AccentGreen, fontSize = 11.sp, fontWeight = FontWeight.Bold)
        }
        Text(text, color = OnBackground, fontSize = 13.sp)
    }
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
