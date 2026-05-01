package com.tbtechs.nodespy.ui.screens

import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInHorizontally
import androidx.compose.animation.slideOutHorizontally
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ArrowBack
import androidx.compose.material.icons.filled.ArrowForward
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.tbtechs.nodespy.ui.theme.*

data class WizardStep(
    val emoji: String,
    val emojiBg: Color,
    val title: String,
    val subtitle: String,
    val body: String,
    val tips: List<String> = emptyList(),
    val codeBlock: String? = null,
    val warningNote: String? = null
)

private val steps = listOf(
    WizardStep(
        emoji = "🔍",
        emojiBg = Color(0xFF1C3A5E),
        title = "Welcome to NodeSpy",
        subtitle = "A developer-grade UI inspector for Android",
        body = "NodeSpy reads the live UI structure of any Android app using Android's Accessibility API — the same system used by screen readers like TalkBack. It requires no root, no ADB, and no screen recording.\n\nEvery visible element — buttons, text fields, images, tabs, scroll containers — is captured as a node with its exact ID, text, class, and screen coordinates.",
        tips = listOf(
            "Works on any app — social media, browsers, games, system apps",
            "No root or developer options required",
            "Exported rules work directly in FocusFlow's Custom Node Rules"
        )
    ),
    WizardStep(
        emoji = "📡",
        emojiBg = Color(0xFF1A3A2A),
        title = "Passive Background Capture",
        subtitle = "NodeSpy records while you use other apps",
        body = "Once the Accessibility Service is enabled, NodeSpy runs silently in the background. Every time a screen changes — a tab is tapped, a page loads, a dialog appears — NodeSpy automatically saves a full snapshot of the UI tree.\n\nYou never need to be inside NodeSpy while this happens. Just use the target app as you normally would, then return to NodeSpy to review what was captured.",
        tips = listOf(
            "Open the target app's exact screen state you want to block — then switch back",
            "Captures are timestamped so you can find the right moment",
            "Up to 30 captures are kept in memory; use LOG toggle to pause recording",
            "Each capture shows the full node tree of that exact screen state"
        )
    ),
    WizardStep(
        emoji = "🟢",
        emojiBg = Color(0xFF1A3A1A),
        title = "The Floating Bubble",
        subtitle = "Your in-app control center — always on top",
        body = "The floating bubble lets you interact with NodeSpy without ever leaving the target app. Launch it from the toolbar (📊 icon), grant Draw Over Apps permission once, and a draggable green bubble appears over every screen.\n\nTap the bubble to open the control panel. Drag it to any edge to keep it out of the way. The bubble stays on top of all apps until you stop it.",
        tips = listOf(
            "Drag the bubble to the screen edge so it doesn't block content",
            "The panel shows the last captured package name at the bottom",
            "LOG and SNAP toggles in the panel control what gets recorded",
            "Tap ✕ to close the panel, tap 'Stop' to remove the bubble entirely"
        ),
        warningNote = "First time only: Android will send you to Settings → Apps → Draw Over Other Apps to grant the permission. This is a one-time step."
    ),
    WizardStep(
        emoji = "👆",
        emojiBg = Color(0xFF3A2A1A),
        title = "Tap Select Mode",
        subtitle = "Pick exact nodes by touching them directly",
        body = "Tap the 👆 Tap Select button in the bubble panel. The panel closes and a transparent overlay appears with a green instruction bar at the top.\n\nNow tap any element on the screen — a button, a tab, a video thumbnail, anything. NodeSpy finds the smallest node whose bounds contain your touch point, highlights it with a green rectangle, and shows its resource ID and label in a floating chip.\n\nTap [ PIN ] on the chip to add that node to your pinned list. Then tap another element to continue, or tap ✕ DONE when finished.",
        tips = listOf(
            "Always aim for the smallest, most specific element — not its parent container",
            "resource IDs (e.g. com.app:id/shorts_tab) are the most reliable for blocking",
            "If two nodes overlap, the smallest bounding area wins",
            "You can pin multiple nodes in one session before exporting"
        ),
        codeBlock = "Tap → Highlight → [ PIN ] → repeat"
    ),
    WizardStep(
        emoji = "⬜",
        emojiBg = Color(0xFF1A2A3A),
        title = "Region Select Mode",
        subtitle = "Select groups of nodes in one drag",
        body = "Tap ⬜ Region in the bubble panel when you want to capture an entire section — a navigation bar, a row of tabs, a feed of recommended content.\n\nDrag your finger from one corner to the opposite corner of the area. A dashed blue rectangle is drawn as you drag. When you lift your finger, NodeSpy finds every node whose bounds overlap your rectangle.\n\nA confirmation button shows how many nodes were found. Tap PIN X NODES to pin them all at once, or tap CANCEL to redraw.",
        tips = listOf(
            "Use region select for entire tab bars, navigation drawers, or ad sections",
            "Nodes that are partially inside the rectangle are still captured",
            "After pinning, you can re-enter region mode to add more areas",
            "Combine with tap select: use region for a section, then tap select to remove specific items"
        ),
        codeBlock = "Drag rectangle → PIN X NODES → done"
    ),
    WizardStep(
        emoji = "📷",
        emojiBg = Color(0xFF1A1A3A),
        title = "Screenshots with Captures",
        subtitle = "Visual proof of exactly what was on screen",
        body = "Enable the SNAP toggle in the bubble panel (requires Android 11+). From that point on, every capture is automatically paired with a screenshot of the exact screen state at that moment.\n\nScreenshots are saved to your device storage and linked in the capture's JSON export. In the capture list, captures with screenshots show a 📷 badge.\n\nThis is especially useful when the app has multiple similar screens — the screenshot tells you immediately which screen the nodes came from.",
        tips = listOf(
            "Screenshots use the Accessibility screenshot API — no screen recording, no extra permissions",
            "Only available on Android 11 (API 30) and above",
            "Toggle SNAP off when you don't need it to save storage and battery",
            "The screenshotPath is included in the exported JSON for reference"
        ),
        warningNote = "Android 10 and below: Screenshots are not available. Use timestamps and package names to identify captures instead."
    ),
    WizardStep(
        emoji = "🎛️",
        emojiBg = Color(0xFF2A1A3A),
        title = "LOG & SNAP Toggles",
        subtitle = "Control exactly what gets recorded",
        body = "The bubble panel has two independent toggles:\n\n● LOG (green) — controls whether the Accessibility Service adds new captures. Turn it OFF when you're done recording a specific app and don't want the list filled with unrelated captures from other apps.\n\n● SNAP (blue) — controls whether screenshots are saved alongside new captures. This is independent of LOG — you can log without screenshots, or take a screenshot manually at any time via the service.",
        tips = listOf(
            "Turn LOG off before switching apps to freeze the capture list exactly where you want it",
            "Turn SNAP on only for the specific capture session where you need visual context",
            "Both toggles persist across bubble open/close cycles",
            "The status bar in NodeSpy's main screen shows current LOG and SNAP state"
        ),
        codeBlock = "LOG ON + SNAP OFF = lightweight node capture\nLOG ON + SNAP ON  = full visual capture\nLOG OFF + SNAP OFF = bubble only for pinning/export"
    ),
    WizardStep(
        emoji = "📋",
        emojiBg = Color(0xFF1A3A2A),
        title = "Pinning & Exporting to FocusFlow",
        subtitle = "Complete the blocking loop in 5 steps",
        body = "Once you've pinned the nodes you want to block, tap Export in the bubble panel. The full JSON is shared via Android's share sheet — save it to Files, copy it, or send it directly.\n\nTo use it in FocusFlow:",
        tips = listOf(
            "1. Copy the exported JSON text",
            "2. Open FocusFlow → Custom Node Rules",
            "3. Paste the JSON → tap Import",
            "4. Select your action: Overlay (blocked screen) or Home (silent redirect)",
            "5. Save — FocusFlow's Accessibility Service watches for those exact nodes"
        ),
        codeBlock = "\"pinnedNodeIds\": [\"n12\", \"n47\"]"
    ),
    WizardStep(
        emoji = "🔬",
        emojiBg = Color(0xFF2A2A1A),
        title = "The Inspector Screen",
        subtitle = "Deep-dive into any captured screen",
        body = "Tap any capture in the list to open the Inspector. It has two tabs:\n\n• Visual tab — renders all nodes as coloured rectangles on a canvas matching the original screen dimensions. Tap a node to select it, or drag to region-select. All node interactions here mirror what the bubble does.\n\n• Tree tab — shows the full node hierarchy as an indented list. Useful for finding parent-child relationships and understanding how the UI is structured.",
        tips = listOf(
            "Color coding: blue = layout, green = text, orange = button/clickable, purple = image",
            "Selected nodes show a white border — tap again to deselect",
            "Use the share icon in the top bar to export with selected nodes as pinned",
            "Notification capture: tap any capture notification to open directly here"
        )
    ),
    WizardStep(
        emoji = "⚡",
        emojiBg = Color(0xFF3A2A0A),
        title = "Power Tips",
        subtitle = "Get the best results faster",
        body = "These habits will save you time and produce more reliable block rules:",
        tips = listOf(
            "Prefer resource IDs over text labels — text changes with language and updates",
            "Capture the screen 2–3 times for dynamic content (ads load after a delay)",
            "Use the bubble's last-capture pkg indicator to confirm you're on the right app",
            "For tabs that only appear in specific states, navigate TO that state then capture",
            "Block the container of unwanted content, not just the content itself",
            "After importing to FocusFlow, test by opening the target app — the overlay fires immediately",
            "If a rule doesn't fire, open Inspector and check: did the resource ID change? Try text or class instead",
            "Keep the Accessibility Service ON while the phone is in use — it uses minimal battery"
        )
    ),
    WizardStep(
        emoji = "✅",
        emojiBg = Color(0xFF1A3A1A),
        title = "You're Ready!",
        subtitle = "Set up permissions and start capturing",
        body = "NodeSpy is fully set up when:\n\n1. Accessibility Service is ON (green LIVE badge in the toolbar)\n2. Draw Over Apps is granted (bubble launches without going to Settings)\n3. Post Notifications is allowed (optional — enables quick-access capture notifications)\n\nHead to the Permissions Setup screen to check and grant each one, then come back here and open any app to start capturing.",
        tips = listOf(
            "Tap the 🛡 shield icon in the toolbar to reach Permissions Setup anytime",
            "Tap 📊 in the toolbar to launch the floating bubble",
            "Tap any capture card to open the Inspector",
            "Captures from the notification tap directly to the Inspector"
        )
    )
)

@Composable
fun WizardScreen(
    onFinish: () -> Unit,
    onOpenSetup: () -> Unit
) {
    var currentStep by remember { mutableIntStateOf(0) }
    val totalSteps = steps.size
    val step = steps[currentStep]
    val isLast = currentStep == totalSteps - 1
    val scrollState = rememberScrollState()

    LaunchedEffect(currentStep) { scrollState.scrollTo(0) }

    Column(
        Modifier
            .fillMaxSize()
            .background(Background)
    ) {
        StepProgress(current = currentStep, total = totalSteps)

        AnimatedContent(
            targetState = currentStep,
            transitionSpec = {
                val dir = if (targetState > initialState) 1 else -1
                (slideInHorizontally(tween(280)) { dir * it } + fadeIn(tween(280))) togetherWith
                        (slideOutHorizontally(tween(280)) { -dir * it } + fadeOut(tween(200)))
            },
            modifier = Modifier.weight(1f),
            label = "wizard_step"
        ) { stepIndex ->
            val s = steps[stepIndex]
            Column(
                Modifier
                    .fillMaxSize()
                    .verticalScroll(scrollState)
                    .padding(horizontal = 24.dp, vertical = 16.dp),
                horizontalAlignment = Alignment.CenterHorizontally
            ) {
                EmojiIllustration(emoji = s.emoji, bg = s.emojiBg)
                Spacer(Modifier.height(20.dp))

                Text(
                    s.title,
                    color = AccentGreen,
                    fontSize = 22.sp,
                    fontWeight = FontWeight.Bold,
                    fontFamily = FontFamily.Monospace
                )
                Spacer(Modifier.height(6.dp))
                Text(
                    s.subtitle,
                    color = Muted,
                    fontSize = 13.sp,
                    fontFamily = FontFamily.Monospace
                )

                Spacer(Modifier.height(20.dp))

                if (s.body.isNotEmpty()) {
                    BodyText(s.body)
                    Spacer(Modifier.height(16.dp))
                }

                s.warningNote?.let { note ->
                    WarningBox(note)
                    Spacer(Modifier.height(16.dp))
                }

                s.codeBlock?.let { code ->
                    CodeBlock(code)
                    Spacer(Modifier.height(16.dp))
                }

                if (s.tips.isNotEmpty()) {
                    TipsList(
                        tips = s.tips,
                        isNumbered = stepIndex == 7
                    )
                }

                if (stepIndex == totalSteps - 1) {
                    Spacer(Modifier.height(24.dp))
                    Button(
                        onClick = onOpenSetup,
                        modifier = Modifier.fillMaxWidth(),
                        colors = ButtonDefaults.buttonColors(containerColor = AccentBlue),
                        shape = RoundedCornerShape(10.dp),
                        contentPadding = PaddingValues(vertical = 14.dp)
                    ) {
                        Icon(Icons.Default.CheckCircle, null, tint = Color(0xFF0D1117), modifier = Modifier.size(18.dp))
                        Spacer(Modifier.width(8.dp))
                        Text("Go to Permissions Setup", color = Color(0xFF0D1117), fontWeight = FontWeight.Bold, fontSize = 15.sp)
                    }
                    Spacer(Modifier.height(10.dp))
                    TextButton(
                        onClick = onFinish,
                        modifier = Modifier.fillMaxWidth()
                    ) {
                        Text("Skip to App →", color = AccentGreen, fontSize = 14.sp)
                    }
                }

                Spacer(Modifier.height(24.dp))
            }
        }

        BottomNav(
            currentStep = currentStep,
            totalSteps = totalSteps,
            isLast = isLast,
            onBack = { if (currentStep > 0) currentStep-- },
            onNext = {
                if (isLast) onFinish()
                else currentStep++
            }
        )
    }
}

@Composable
private fun StepProgress(current: Int, total: Int) {
    Column(Modifier.fillMaxWidth().background(Surface)) {
        Row(
            Modifier
                .fillMaxWidth()
                .padding(horizontal = 24.dp, vertical = 14.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            Text(
                "NodeSpy Guide",
                color = AccentGreen,
                fontWeight = FontWeight.Bold,
                fontFamily = FontFamily.Monospace,
                fontSize = 16.sp,
                modifier = Modifier.weight(1f)
            )
            Text(
                "${current + 1} / $total",
                color = Muted,
                fontFamily = FontFamily.Monospace,
                fontSize = 12.sp
            )
        }
        LinearProgressIndicator(
            progress = { (current + 1).toFloat() / total.toFloat() },
            modifier = Modifier.fillMaxWidth().height(3.dp),
            color = AccentGreen,
            trackColor = Outline
        )
        Row(
            Modifier.fillMaxWidth().padding(horizontal = 24.dp, vertical = 8.dp),
            horizontalArrangement = Arrangement.Center,
            verticalAlignment = Alignment.CenterVertically
        ) {
            repeat(total) { i ->
                val active = i == current
                val passed = i < current
                Box(
                    Modifier
                        .padding(horizontal = 3.dp)
                        .size(if (active) 10.dp else 6.dp)
                        .clip(CircleShape)
                        .background(
                            when {
                                active -> AccentGreen
                                passed -> AccentGreen.copy(alpha = 0.4f)
                                else -> Outline
                            }
                        )
                )
            }
        }
    }
}

@Composable
private fun EmojiIllustration(emoji: String, bg: Color) {
    Box(
        Modifier
            .size(96.dp)
            .clip(CircleShape)
            .background(bg),
        contentAlignment = Alignment.Center
    ) {
        Text(emoji, fontSize = 44.sp)
    }
}

@Composable
private fun BodyText(text: String) {
    val paragraphs = text.split("\n\n")
    Column(verticalArrangement = Arrangement.spacedBy(10.dp), modifier = Modifier.fillMaxWidth()) {
        paragraphs.forEach { para ->
            Text(
                para,
                color = OnBackground,
                fontSize = 14.sp,
                lineHeight = 22.sp
            )
        }
    }
}

@Composable
private fun TipsList(tips: List<String>, isNumbered: Boolean = false) {
    Column(
        Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(10.dp))
            .background(SurfaceVar)
            .padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(10.dp)
    ) {
        tips.forEachIndexed { i, tip ->
            Row(verticalAlignment = Alignment.Top) {
                Text(
                    if (isNumbered) "${i + 1}." else "›",
                    color = AccentGreen,
                    fontFamily = FontFamily.Monospace,
                    fontWeight = FontWeight.Bold,
                    fontSize = 13.sp,
                    modifier = Modifier.width(20.dp)
                )
                Spacer(Modifier.width(6.dp))
                Text(
                    buildHighlightedTip(tip),
                    color = OnBackground,
                    fontSize = 13.sp,
                    lineHeight = 20.sp,
                    modifier = Modifier.weight(1f)
                )
            }
        }
    }
}

@Composable
private fun buildHighlightedTip(tip: String) = buildAnnotatedString {
    val patterns = listOf("resource ID", "LOG", "SNAP", "PIN", "Export", "FocusFlow",
        "Overlay", "Home", "Accessibility", "Inspector", "Visual", "Tree")
    var remaining = tip
    while (remaining.isNotEmpty()) {
        val match = patterns.mapNotNull { p ->
            val idx = remaining.indexOf(p, ignoreCase = false)
            if (idx >= 0) idx to p else null
        }.minByOrNull { it.first }

        if (match == null) {
            append(remaining); break
        }
        val (idx, pattern) = match
        append(remaining.substring(0, idx))
        withStyle(SpanStyle(color = AccentGreen, fontWeight = FontWeight.Bold)) {
            append(pattern)
        }
        remaining = remaining.substring(idx + pattern.length)
    }
}

@Composable
private fun CodeBlock(code: String) {
    Box(
        Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(8.dp))
            .background(Color(0xFF0A0E14))
    ) {
        Column(Modifier.padding(14.dp)) {
            code.split("\n").forEach { line ->
                Text(
                    line,
                    color = AccentGreen,
                    fontFamily = FontFamily.Monospace,
                    fontSize = 12.sp,
                    lineHeight = 20.sp
                )
            }
        }
    }
}

@Composable
private fun WarningBox(note: String) {
    Row(
        Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(8.dp))
            .background(AccentOrange.copy(alpha = 0.1f))
            .padding(12.dp),
        verticalAlignment = Alignment.Top
    ) {
        Text("⚠", fontSize = 14.sp, modifier = Modifier.padding(top = 1.dp))
        Spacer(Modifier.width(8.dp))
        Text(note, color = AccentOrange, fontSize = 12.sp, lineHeight = 18.sp)
    }
}

@Composable
private fun BottomNav(
    currentStep: Int,
    totalSteps: Int,
    isLast: Boolean,
    onBack: () -> Unit,
    onNext: () -> Unit
) {
    Row(
        Modifier
            .fillMaxWidth()
            .background(Surface)
            .padding(horizontal = 24.dp, vertical = 14.dp),
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalAlignment = Alignment.CenterVertically
    ) {
        AnimatedVisibility(visible = currentStep > 0) {
            TextButton(onClick = onBack) {
                Icon(Icons.Default.ArrowBack, null, tint = Muted, modifier = Modifier.size(18.dp))
                Spacer(Modifier.width(4.dp))
                Text("Back", color = Muted, fontSize = 14.sp)
            }
        }
        if (currentStep == 0) Spacer(Modifier.width(1.dp))

        Button(
            onClick = onNext,
            colors = ButtonDefaults.buttonColors(containerColor = if (isLast) AccentGreen else AccentBlue),
            shape = RoundedCornerShape(10.dp),
            contentPadding = PaddingValues(horizontal = 24.dp, vertical = 10.dp)
        ) {
            Text(
                if (isLast) "Start Capturing" else "Next",
                color = Color(0xFF0D1117),
                fontWeight = FontWeight.Bold,
                fontSize = 14.sp
            )
            if (!isLast) {
                Spacer(Modifier.width(4.dp))
                Icon(Icons.Default.ArrowForward, null, tint = Color(0xFF0D1117), modifier = Modifier.size(16.dp))
            }
        }
    }
}
