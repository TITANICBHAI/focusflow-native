package com.tbtechs.nodespy.ui.screens

import android.content.Intent
import android.provider.Settings
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.DeleteSweep
import androidx.compose.material.icons.filled.FiberManualRecord
import androidx.compose.material.icons.filled.RadioButtonUnchecked
import androidx.compose.material.icons.filled.Search
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.tbtechs.nodespy.data.CaptureStore
import com.tbtechs.nodespy.data.NodeCapture
import com.tbtechs.nodespy.ui.theme.*
import java.text.SimpleDateFormat
import java.util.*

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun CaptureListScreen(onOpenCapture: (String) -> Unit) {
    val context = LocalContext.current
    val captures by CaptureStore.captures.collectAsState()
    val serviceRunning by CaptureStore.serviceRunning.collectAsState()

    Scaffold(
        containerColor = Background,
        topBar = {
            TopAppBar(
                title = {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Text(
                            "NodeSpy",
                            color = OnBackground,
                            fontWeight = FontWeight.Bold,
                            fontFamily = FontFamily.Monospace,
                            fontSize = 20.sp
                        )
                        Spacer(Modifier.width(10.dp))
                        ServiceBadge(running = serviceRunning)
                    }
                },
                colors = TopAppBarDefaults.topAppBarColors(containerColor = Surface),
                actions = {
                    if (captures.isNotEmpty()) {
                        IconButton(onClick = { CaptureStore.clearAll() }) {
                            Icon(Icons.Default.DeleteSweep, "Clear all", tint = Muted)
                        }
                    }
                }
            )
        }
    ) { padding ->
        Column(
            Modifier
                .fillMaxSize()
                .padding(padding)
                .background(Background)
        ) {
            if (!serviceRunning) {
                ServiceBanner {
                    context.startActivity(Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS))
                }
            }

            if (captures.isEmpty()) {
                EmptyState(serviceRunning)
            } else {
                LazyColumn(
                    contentPadding = PaddingValues(12.dp),
                    verticalArrangement = Arrangement.spacedBy(8.dp)
                ) {
                    items(captures, key = { it.id }) { capture ->
                        CaptureCard(capture, onClick = { onOpenCapture(capture.id) })
                    }
                }
            }
        }
    }
}

@Composable
private fun ServiceBadge(running: Boolean) {
    val color = if (running) AccentGreen else AccentRed
    val label = if (running) "LIVE" else "OFF"
    Row(
        verticalAlignment = Alignment.CenterVertically,
        modifier = Modifier
            .clip(RoundedCornerShape(4.dp))
            .background(color.copy(alpha = 0.15f))
            .padding(horizontal = 6.dp, vertical = 2.dp)
    ) {
        Icon(
            if (running) Icons.Default.FiberManualRecord else Icons.Default.RadioButtonUnchecked,
            contentDescription = null,
            tint = color,
            modifier = Modifier.size(8.dp)
        )
        Spacer(Modifier.width(4.dp))
        Text(label, color = color, fontSize = 11.sp, fontFamily = FontFamily.Monospace,
            fontWeight = FontWeight.Bold)
    }
}

@Composable
private fun ServiceBanner(onEnable: () -> Unit) {
    Row(
        Modifier
            .fillMaxWidth()
            .background(AccentOrange.copy(alpha = 0.12f))
            .padding(horizontal = 16.dp, vertical = 10.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        Text(
            "Accessibility service is off — NodeSpy cannot capture nodes",
            color = AccentOrange,
            fontSize = 13.sp,
            modifier = Modifier.weight(1f)
        )
        Spacer(Modifier.width(8.dp))
        TextButton(onClick = onEnable) {
            Text("Enable", color = AccentOrange, fontWeight = FontWeight.Bold)
        }
    }
}

@Composable
private fun EmptyState(serviceRunning: Boolean) {
    Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
        Column(horizontalAlignment = Alignment.CenterHorizontally) {
            Icon(Icons.Default.Search, contentDescription = null,
                tint = Muted, modifier = Modifier.size(56.dp))
            Spacer(Modifier.height(16.dp))
            Text(
                if (serviceRunning) "Open any app to capture its node tree"
                else "Enable the accessibility service to start",
                color = Muted, fontSize = 15.sp
            )
        }
    }
}

@Composable
private fun CaptureCard(capture: NodeCapture, onClick: () -> Unit) {
    val fmt = remember { SimpleDateFormat("HH:mm:ss", Locale.getDefault()) }
    val shortPkg = capture.pkg.substringAfterLast('.')
    val shortCls = capture.activityClass.substringAfterLast('.')

    Card(
        modifier = Modifier
            .fillMaxWidth()
            .clickable(onClick = onClick),
        colors = CardDefaults.cardColors(containerColor = Surface),
        shape = RoundedCornerShape(10.dp)
    ) {
        Row(
            Modifier.padding(14.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            Box(
                Modifier
                    .size(40.dp)
                    .clip(CircleShape)
                    .background(AccentBlue.copy(alpha = 0.15f)),
                contentAlignment = Alignment.Center
            ) {
                Text(
                    shortPkg.take(2).uppercase(),
                    color = AccentBlue,
                    fontWeight = FontWeight.Bold,
                    fontFamily = FontFamily.Monospace,
                    fontSize = 14.sp
                )
            }

            Spacer(Modifier.width(12.dp))

            Column(Modifier.weight(1f)) {
                Text(
                    capture.pkg,
                    color = OnBackground,
                    fontWeight = FontWeight.SemiBold,
                    fontSize = 14.sp,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis
                )
                Spacer(Modifier.height(2.dp))
                Text(
                    shortCls,
                    color = Muted,
                    fontSize = 12.sp,
                    fontFamily = FontFamily.Monospace,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis
                )
            }

            Spacer(Modifier.width(8.dp))

            Column(horizontalAlignment = Alignment.End) {
                NodeCountBadge(capture.nodes.size)
                Spacer(Modifier.height(4.dp))
                Text(
                    fmt.format(Date(capture.timestamp)),
                    color = Muted,
                    fontSize = 11.sp,
                    fontFamily = FontFamily.Monospace
                )
            }
        }
    }
}

@Composable
private fun NodeCountBadge(count: Int) {
    Box(
        Modifier
            .clip(RoundedCornerShape(4.dp))
            .background(SurfaceVar)
            .padding(horizontal = 6.dp, vertical = 2.dp)
    ) {
        Text(
            "$count nodes",
            color = AccentGreen,
            fontSize = 11.sp,
            fontFamily = FontFamily.Monospace,
            fontWeight = FontWeight.Bold
        )
    }
}
