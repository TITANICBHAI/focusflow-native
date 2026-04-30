package com.tbtechs.nodespy.ui.screens

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.provider.Settings
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ArrowBack
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.Error
import androidx.compose.material.icons.filled.Info
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalLifecycleOwner
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.core.content.ContextCompat
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import com.tbtechs.nodespy.data.CaptureStore
import com.tbtechs.nodespy.ui.theme.*

data class PermissionItem(
    val title: String,
    val description: String,
    val required: Boolean,
    val isGranted: () -> Boolean,
    val action: (() -> Unit)? = null,
    val actionLabel: String = "Enable",
    val note: String? = null
)

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun PermissionsScreen(onBack: () -> Unit) {
    val context = LocalContext.current
    val lifecycleOwner = LocalLifecycleOwner.current
    var refreshTick by remember { mutableIntStateOf(0) }

    DisposableEffect(lifecycleOwner) {
        val obs = LifecycleEventObserver { _, event ->
            if (event == Lifecycle.Event.ON_RESUME) refreshTick++
        }
        lifecycleOwner.lifecycle.addObserver(obs)
        onDispose { lifecycleOwner.lifecycle.removeObserver(obs) }
    }

    val notifLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.RequestPermission()
    ) { refreshTick++ }

    val serviceRunning by CaptureStore.serviceRunning.collectAsState()

    val permissions = remember(refreshTick, serviceRunning) {
        buildList {
            add(PermissionItem(
                title = "Accessibility Service",
                description = "Required to read the UI node tree of other apps. This is NodeSpy's core function — without it, nothing is captured.",
                required = true,
                isGranted = { serviceRunning },
                action = {
                    context.startActivity(Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS))
                },
                actionLabel = "Open Accessibility Settings"
            ))

            add(PermissionItem(
                title = "Draw Over Other Apps",
                description = "Required for the floating bubble that lets you select and pin nodes while staying inside the target app.",
                required = true,
                isGranted = { Settings.canDrawOverlays(context) },
                action = {
                    context.startActivity(
                        Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION, Uri.parse("package:${context.packageName}"))
                    )
                },
                actionLabel = "Grant Overlay Permission"
            ))

            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                add(PermissionItem(
                    title = "Post Notifications",
                    description = "Used to show a quick-access notification whenever a new capture is taken, so you can tap straight to that capture without hunting through the list.",
                    required = false,
                    isGranted = {
                        ContextCompat.checkSelfPermission(
                            context, Manifest.permission.POST_NOTIFICATIONS
                        ) == PackageManager.PERMISSION_GRANTED
                    },
                    action = {
                        notifLauncher.launch(Manifest.permission.POST_NOTIFICATIONS)
                    },
                    actionLabel = "Allow Notifications"
                ))
            }

            if (Build.VERSION.SDK_INT <= Build.VERSION_CODES.P) {
                add(PermissionItem(
                    title = "Storage (Write)",
                    description = "Required on Android 9 and below to save screenshots alongside captures. On Android 10+, app-specific storage is used automatically.",
                    required = false,
                    isGranted = {
                        ContextCompat.checkSelfPermission(
                            context, Manifest.permission.WRITE_EXTERNAL_STORAGE
                        ) == PackageManager.PERMISSION_GRANTED
                    },
                    note = "Android 9 and below only"
                ))
            }

            add(PermissionItem(
                title = "Screenshot Capture",
                description = "Saves a screenshot alongside each node capture. Only available on Android 11 and above — uses the built-in Accessibility screenshot API, no screen recording needed.",
                required = false,
                isGranted = { Build.VERSION.SDK_INT >= Build.VERSION_CODES.R },
                note = if (Build.VERSION.SDK_INT < Build.VERSION_CODES.R)
                    "Your device runs Android ${Build.VERSION.RELEASE} — requires Android 11+" else null,
                action = null,
                actionLabel = ""
            ))
        }
    }

    val allRequired = permissions.filter { it.required }.all { it.isGranted() }

    Scaffold(
        containerColor = Background,
        topBar = {
            TopAppBar(
                title = {
                    Text(
                        "Permissions Setup",
                        color = OnBackground,
                        fontWeight = FontWeight.Bold,
                        fontFamily = FontFamily.Monospace
                    )
                },
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(Icons.Default.ArrowBack, "Back", tint = OnBackground)
                    }
                },
                colors = TopAppBarDefaults.topAppBarColors(containerColor = Surface)
            )
        }
    ) { padding ->
        Column(
            Modifier
                .fillMaxSize()
                .padding(padding)
                .background(Background)
                .verticalScroll(rememberScrollState())
                .padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp)
        ) {
            StatusBanner(allRequiredGranted = allRequired)

            permissions.forEachIndexed { _, item ->
                val granted = item.isGranted()
                PermissionCard(item = item, granted = granted)
            }

            Spacer(Modifier.height(16.dp))
        }
    }
}

@Composable
private fun StatusBanner(allRequiredGranted: Boolean) {
    val color = if (allRequiredGranted) AccentGreen else AccentOrange
    val msg = if (allRequiredGranted)
        "All required permissions are granted — NodeSpy is fully operational"
    else
        "Some required permissions are missing — grant them to enable all features"

    Row(
        Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(10.dp))
            .background(color.copy(alpha = 0.12f))
            .padding(14.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        Icon(
            if (allRequiredGranted) Icons.Default.CheckCircle else Icons.Default.Error,
            contentDescription = null,
            tint = color,
            modifier = Modifier.size(20.dp)
        )
        Spacer(Modifier.width(10.dp))
        Text(msg, color = color, fontSize = 13.sp, modifier = Modifier.weight(1f))
    }
}

@Composable
private fun PermissionCard(item: PermissionItem, granted: Boolean) {
    val statusColor = when {
        granted -> AccentGreen
        item.required -> AccentRed
        else -> AccentOrange
    }
    val statusLabel = when {
        granted -> "GRANTED"
        item.required -> "REQUIRED"
        else -> "OPTIONAL"
    }

    Card(
        colors = CardDefaults.cardColors(containerColor = Surface),
        shape = RoundedCornerShape(12.dp),
        modifier = Modifier.fillMaxWidth()
    ) {
        Column(Modifier.padding(16.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Icon(
                    if (granted) Icons.Default.CheckCircle else Icons.Default.Error,
                    contentDescription = null,
                    tint = statusColor,
                    modifier = Modifier.size(18.dp)
                )
                Spacer(Modifier.width(8.dp))
                Text(
                    item.title,
                    color = OnBackground,
                    fontWeight = FontWeight.SemiBold,
                    fontSize = 15.sp,
                    modifier = Modifier.weight(1f)
                )
                Box(
                    Modifier
                        .clip(RoundedCornerShape(4.dp))
                        .background(statusColor.copy(alpha = 0.15f))
                        .padding(horizontal = 6.dp, vertical = 2.dp)
                ) {
                    Text(
                        statusLabel,
                        color = statusColor,
                        fontSize = 10.sp,
                        fontFamily = FontFamily.Monospace,
                        fontWeight = FontWeight.Bold
                    )
                }
            }

            Spacer(Modifier.height(8.dp))

            Text(
                item.description,
                color = Muted,
                fontSize = 13.sp,
                lineHeight = 19.sp
            )

            item.note?.let { note ->
                Spacer(Modifier.height(6.dp))
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Icon(Icons.Default.Info, null, tint = AccentYellow, modifier = Modifier.size(13.dp))
                    Spacer(Modifier.width(4.dp))
                    Text(note, color = AccentYellow, fontSize = 11.sp, fontFamily = FontFamily.Monospace)
                }
            }

            if (!granted && item.action != null && item.actionLabel.isNotEmpty()) {
                Spacer(Modifier.height(12.dp))
                Button(
                    onClick = item.action,
                    colors = ButtonDefaults.buttonColors(containerColor = statusColor.copy(alpha = 0.2f)),
                    contentPadding = PaddingValues(horizontal = 16.dp, vertical = 8.dp),
                    shape = RoundedCornerShape(8.dp)
                ) {
                    Text(item.actionLabel, color = statusColor, fontSize = 13.sp, fontWeight = FontWeight.Bold)
                }
            }
        }
    }
}
