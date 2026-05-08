package com.focusflow.ui.screens

import androidx.compose.animation.core.FastOutSlowInEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.VerticalScrollbar
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.rememberScrollbarAdapter
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.scale
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.focusflow.data.Database
import com.focusflow.data.models.*
import com.focusflow.services.*
import com.focusflow.ui.theme.*
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.time.LocalDate

@Composable
fun ActiveScreen() {
    val sessionState    by FocusSessionService.state.collectAsState()
    val standaloneBlock by StandaloneBlockService.block.collectAsState()
    val scope           = rememberCoroutineScope()

    var blockRules        by remember { mutableStateOf(listOf<BlockRule>()) }
    var schedules         by remember { mutableStateOf(listOf<BlockSchedule>()) }
    var allowances        by remember { mutableStateOf(listOf<DailyAllowance>()) }
    var todayFocusMins    by remember { mutableStateOf(0) }
    var todaySessions     by remember { mutableStateOf(0) }
    var todayCompleted    by remember { mutableStateOf(0) }
    var todayTotal        by remember { mutableStateOf(0) }
    var currentStreak     by remember { mutableStateOf(0) }
    var alwaysOnEnabled   by remember { mutableStateOf(false) }
    var keywordsEnabled   by remember { mutableStateOf(false) }
    var keywordCount      by remember { mutableStateOf(0) }
    var tick              by remember { mutableStateOf(0) }

    fun reload() {
        scope.launch {
            try {
                withContext(Dispatchers.IO) {
                    blockRules      = Database.getBlockRules()
                    schedules       = Database.getBlockSchedules()
                    allowances      = Database.getDailyAllowances()
                    todayFocusMins  = Database.getTotalFocusMinutesToday()
                    currentStreak   = Database.getCurrentStreak()
                    alwaysOnEnabled = Database.getSetting("always_on_enforcement") == "true"
                    keywordsEnabled = Database.isKeywordBlockerEnabled()
                    keywordCount    = Database.getBlockedKeywords().size
                    val sessions = Database.getSessionsInDateRange(LocalDate.now(), LocalDate.now())
                    todaySessions   = sessions.size
                    val tasks = Database.getTasksForDate(LocalDate.now())
                    todayCompleted  = tasks.count { it.completed }
                    todayTotal      = tasks.size
                }
            } catch (_: Exception) {
                // DB temporarily unavailable — keep showing last known values
            }
        }
    }

    LaunchedEffect(Unit) {
        reload()
        while (true) { delay(10_000); tick++; reload() }
    }

    val scrollState = rememberScrollState()
    val now = java.time.LocalTime.now()

    Box(modifier = Modifier.fillMaxSize().background(Surface)) {
        Column(
            modifier = Modifier
                .fillMaxSize()
                .verticalScroll(scrollState)
                .padding(horizontal = 32.dp, vertical = 32.dp),
            verticalArrangement = Arrangement.spacedBy(20.dp)
        ) {
            // ── Header ────────────────────────────────────────────────────────
            val isAnythingActive = sessionState.isActive || standaloneBlock != null || alwaysOnEnabled
            val headerDotPulse = rememberInfiniteTransition(label = "headerDot")
            val headerDotScale by headerDotPulse.animateFloat(
                initialValue  = 1f,
                targetValue   = 1.35f,
                animationSpec = infiniteRepeatable(tween(800, easing = FastOutSlowInEasing), RepeatMode.Reverse),
                label         = "headerDotScale"
            )
            Row(
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(14.dp)
            ) {
                Box(
                    modifier = Modifier
                        .size(48.dp)
                        .clip(RoundedCornerShape(13.dp))
                        .background((if (isAnythingActive) Success else OnSurface2).copy(alpha = 0.15f)),
                    contentAlignment = Alignment.Center
                ) {
                    Icon(
                        Icons.Default.RadioButtonChecked,
                        contentDescription = null,
                        tint     = if (isAnythingActive) Success else OnSurface2,
                        modifier = Modifier.size(26.dp)
                    )
                }
                Column {
                    Text(
                        "Live Block Status",
                        style = MaterialTheme.typography.headlineLarge,
                        fontWeight = FontWeight.Bold,
                        color = OnSurface
                    )
                    Row(
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(5.dp)
                    ) {
                        Box(
                            modifier = Modifier
                                .size(6.dp)
                                .scale(if (isAnythingActive) headerDotScale else 1f)
                                .clip(CircleShape)
                                .background(if (isAnythingActive) Success else OnSurface2.copy(alpha = 0.4f))
                        )
                        Text(
                            if (isAnythingActive) "Enforcement active" else "No active enforcement",
                            style = MaterialTheme.typography.bodySmall,
                            color = if (isAnythingActive) Success else OnSurface2
                        )
                    }
                }
            }

            // Focus Session card
            StatusCard(
                icon  = Icons.Default.Timer,
                title = "Focus Session",
                color = if (sessionState.isActive) Purple80 else OnSurface2,
                status = when {
                    sessionState.isActive && !sessionState.isPaused -> {
                        val remaining = sessionState.totalSeconds - sessionState.elapsedSeconds
                        "Active · ${remaining / 60}m ${remaining % 60}s remaining — ${sessionState.taskName.take(30)}"
                    }
                    sessionState.isActive && sessionState.isPaused -> "Paused · ${sessionState.taskName.take(30)}"
                    else -> "Inactive"
                },
                active = sessionState.isActive
            )

            // Standalone block card
            StatusCard(
                icon   = Icons.Default.Block,
                title  = "Standalone Block",
                color  = if (standaloneBlock != null) Warning else OnSurface2,
                status = if (standaloneBlock != null) {
                    val minsLeft = ((standaloneBlock!!.untilMs - System.currentTimeMillis()) / 60_000).coerceAtLeast(0)
                    "Active · ${minsLeft}m remaining · ${standaloneBlock!!.processNames.size} app(s)"
                } else "Inactive",
                active = standaloneBlock != null
            )

            // Always-on enforcement
            StatusCard(
                icon   = Icons.Default.Shield,
                title  = "Always-On Enforcement",
                color  = if (alwaysOnEnabled) Success else OnSurface2,
                status = if (alwaysOnEnabled)
                    "Enabled · ${blockRules.count { it.enabled }} app(s) on the block list"
                else
                    "Disabled · ${blockRules.size} app(s) configured",
                active = alwaysOnEnabled
            )

            // Keyword blocker
            StatusCard(
                icon   = Icons.Default.TextFields,
                title  = "Keyword Blocker",
                color  = if (keywordsEnabled) Warning else OnSurface2,
                status = if (keywordsEnabled)
                    "Enabled · $keywordCount keyword(s) active"
                else
                    "Disabled · $keywordCount keyword(s) configured",
                active = keywordsEnabled
            )

            // Block schedules
            val activeSchedules = schedules.filter { s ->
                s.enabled && run {
                    // daysOfWeek is List<Int> where 1=Monday … 7=Sunday (ISO)
                    val day = java.time.LocalDate.now().dayOfWeek.value
                    s.daysOfWeek.contains(day) &&
                    now >= java.time.LocalTime.of(s.startHour, s.startMinute) &&
                    now < java.time.LocalTime.of(s.endHour, s.endMinute)
                }
            }
            StatusCard(
                icon   = Icons.Default.Schedule,
                title  = "Block Schedules",
                color  = if (activeSchedules.isNotEmpty()) Warning else OnSurface2,
                status = when {
                    activeSchedules.isNotEmpty() -> "${activeSchedules.size} schedule(s) active now"
                    schedules.isEmpty() -> "No schedules configured"
                    else -> "${schedules.count { it.enabled }} schedule(s) configured · none active now"
                },
                active = activeSchedules.isNotEmpty()
            )

            // Daily allowances
            val usingAllowance = allowances.isNotEmpty()
            StatusCard(
                icon   = Icons.Default.HourglassFull,
                title  = "Daily Allowances",
                color  = if (usingAllowance) Purple80 else OnSurface2,
                status = if (allowances.isEmpty()) "No allowances configured"
                else "${allowances.size} app(s) with daily time limits",
                active = usingAllowance
            )

            // ── Today's Progress ──────────────────────────────────────────────
            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .clip(RoundedCornerShape(16.dp))
                    .background(Surface2)
                    .padding(20.dp),
                verticalArrangement = Arrangement.spacedBy(14.dp)
            ) {
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(8.dp)
                ) {
                    Icon(Icons.Default.BarChart, null, tint = Purple80, modifier = Modifier.size(18.dp))
                    Text("Today's Progress", style = MaterialTheme.typography.titleMedium, color = OnSurface, fontWeight = FontWeight.SemiBold)
                }
                Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                    StatMini(label = "Focus Time", value = "${todayFocusMins}m", icon = Icons.Default.Timer, tint = Purple80, modifier = Modifier.weight(1f))
                    StatMini(label = "Sessions", value = "$todaySessions", icon = Icons.Default.PlayArrow, tint = Success, modifier = Modifier.weight(1f))
                    StatMini(label = "Tasks Done", value = "$todayCompleted/$todayTotal", icon = Icons.Default.CheckCircle, tint = Warning, modifier = Modifier.weight(1f))
                    StatMini(label = "Streak", value = "${currentStreak}d", icon = Icons.Default.Whatshot, tint = Error, modifier = Modifier.weight(1f))
                }
            }

            // ── Blocked Apps ──────────────────────────────────────────────────
            if (blockRules.isNotEmpty()) {
                Column(
                    modifier = Modifier
                        .fillMaxWidth()
                        .clip(RoundedCornerShape(16.dp))
                        .background(Surface2)
                        .padding(20.dp),
                    verticalArrangement = Arrangement.spacedBy(10.dp)
                ) {
                    Row(
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(8.dp)
                    ) {
                        Icon(Icons.Default.Block, null, tint = Error, modifier = Modifier.size(18.dp))
                        Text(
                            "Blocked Apps (${blockRules.size})",
                            style = MaterialTheme.typography.titleMedium,
                            color = OnSurface,
                            fontWeight = FontWeight.SemiBold
                        )
                    }
                    blockRules.take(6).forEach { rule ->
                        Row(
                            modifier = Modifier
                                .fillMaxWidth()
                                .clip(RoundedCornerShape(8.dp))
                                .background(Surface3)
                                .padding(horizontal = 12.dp, vertical = 8.dp),
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.spacedBy(10.dp)
                        ) {
                            Box(
                                modifier = Modifier.size(7.dp).clip(CircleShape)
                                    .background(if (rule.enabled) Success else OnSurface2.copy(alpha = 0.3f))
                            )
                            Text(rule.displayName, color = OnSurface, style = MaterialTheme.typography.bodySmall, fontWeight = FontWeight.Medium, modifier = Modifier.weight(1f))
                            Text(rule.processName, color = OnSurface2.copy(alpha = 0.6f), style = MaterialTheme.typography.bodySmall, fontSize = 10.sp)
                        }
                    }
                    if (blockRules.size > 6) {
                        Text(
                            "+ ${blockRules.size - 6} more apps…",
                            color = OnSurface2,
                            style = MaterialTheme.typography.bodySmall,
                            modifier = Modifier.align(Alignment.End)
                        )
                    }
                }
            }

            Spacer(Modifier.height(16.dp))
        }

        VerticalScrollbar(
            adapter = rememberScrollbarAdapter(scrollState),
            modifier = Modifier.align(Alignment.CenterEnd).fillMaxHeight().padding(end = 4.dp)
        )
    }
}

@Composable
private fun StatusCard(
    icon: ImageVector,
    title: String,
    color: Color,
    status: String,
    active: Boolean
) {
    val pulse = rememberInfiniteTransition(label = "statusDot_$title")
    val dotAlpha by pulse.animateFloat(
        initialValue  = if (active) 0.5f else 1f,
        targetValue   = 1f,
        animationSpec = if (active) infiniteRepeatable(tween(750), RepeatMode.Reverse)
                        else        infiniteRepeatable(tween(1), RepeatMode.Restart),
        label         = "dotAlpha_$title"
    )

    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(14.dp))
            .background(if (active) color.copy(alpha = 0.06f) else Surface2)
            .padding(horizontal = 20.dp, vertical = 16.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(16.dp)
    ) {
        Box(
            modifier = Modifier
                .size(44.dp)
                .clip(RoundedCornerShape(12.dp))
                .background(color.copy(alpha = if (active) 0.18f else 0.10f)),
            contentAlignment = Alignment.Center
        ) {
            Icon(icon, contentDescription = null, tint = color, modifier = Modifier.size(22.dp))
        }
        Column(modifier = Modifier.weight(1f)) {
            Text(
                title,
                color = OnSurface,
                style = MaterialTheme.typography.bodyMedium,
                fontWeight = FontWeight.SemiBold
            )
            Text(
                status,
                color = if (active) color.copy(alpha = 0.8f) else OnSurface2,
                style = MaterialTheme.typography.bodySmall
            )
        }
        // Active dot — pulses when enforcement is live
        Box(
            modifier = Modifier
                .size(8.dp)
                .clip(CircleShape)
                .background(
                    if (active) color.copy(alpha = dotAlpha)
                    else Surface3
                )
        )
    }
}

@Composable
private fun StatMini(
    label: String,
    value: String,
    icon: ImageVector,
    tint: Color,
    modifier: Modifier = Modifier
) {
    Column(
        modifier = modifier
            .clip(RoundedCornerShape(12.dp))
            .background(Surface3)
            .padding(12.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(4.dp)
    ) {
        Box(
            modifier = Modifier
                .size(32.dp)
                .clip(RoundedCornerShape(8.dp))
                .background(tint.copy(alpha = 0.14f)),
            contentAlignment = Alignment.Center
        ) {
            Icon(icon, null, tint = tint, modifier = Modifier.size(16.dp))
        }
        Text(value, color = tint, fontWeight = FontWeight.Bold, fontSize = 16.sp)
        Text(label, color = OnSurface2, style = MaterialTheme.typography.bodySmall, fontSize = 9.sp)
    }
}
