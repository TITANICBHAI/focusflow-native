package com.focusflow.ui.screens

import androidx.compose.foundation.VerticalScrollbar
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.rememberScrollbarAdapter
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import com.focusflow.services.PrivacyPolicyService
import com.focusflow.ui.theme.*

@Composable
fun PrivacyPermissionsDialog(onDismiss: () -> Unit) {
    var tab by remember { mutableStateOf(0) }
    val tabs = listOf("Permissions", "Privacy Policy", "EULA")

    Dialog(
        onDismissRequest = onDismiss,
        properties = DialogProperties(usePlatformDefaultWidth = false)
    ) {
        Surface(
            shape = RoundedCornerShape(20.dp),
            color = Surface,
            modifier = Modifier.width(680.dp).height(560.dp)
        ) {
            Column(modifier = Modifier.fillMaxSize()) {
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .background(Surface2)
                        .padding(horizontal = 20.dp, vertical = 12.dp),
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Icon(Icons.Default.Security, null, tint = Purple80, modifier = Modifier.size(22.dp))
                    Spacer(Modifier.width(10.dp))
                    Text("Privacy & Permissions", fontWeight = FontWeight.Bold, fontSize = 17.sp, color = OnSurface)
                    Spacer(Modifier.weight(1f))
                    IconButton(onClick = onDismiss, modifier = Modifier.size(32.dp)) {
                        Icon(Icons.Default.Close, "Close", tint = OnSurface2)
                    }
                }

                TabRow(
                    selectedTabIndex = tab,
                    containerColor = Surface2,
                    contentColor = Purple80
                ) {
                    tabs.forEachIndexed { i, t ->
                        Tab(
                            selected = tab == i,
                            onClick = { tab = i },
                            text = { Text(t, fontSize = 13.sp) }
                        )
                    }
                }

                val scroll = rememberScrollState()
                Box(modifier = Modifier.weight(1f)) {
                    Column(
                        modifier = Modifier
                            .fillMaxSize()
                            .verticalScroll(scroll)
                            .padding(20.dp)
                    ) {
                        when (tab) {
                            0 -> PermissionsTab()
                            1 -> LegalTextTab(PrivacyPolicyService.PRIVACY_POLICY.trim())
                            2 -> LegalTextTab(PrivacyPolicyService.EULA.trim())
                        }
                    }
                    VerticalScrollbar(
                        rememberScrollbarAdapter(scroll),
                        modifier = Modifier.align(Alignment.CenterEnd).fillMaxHeight().padding(4.dp)
                    )
                }
            }
        }
    }
}

@Composable
private fun PermissionsTab() {
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(10.dp))
            .background(Purple80.copy(alpha = 0.08f))
            .padding(horizontal = 14.dp, vertical = 10.dp)
    ) {
        Row(
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(8.dp)
        ) {
            Icon(Icons.Default.Lock, null, tint = Purple80, modifier = Modifier.size(14.dp))
            Text(
                "100% local — no data ever leaves your device.",
                fontSize = 12.sp,
                color = OnSurface2,
                fontWeight = FontWeight.Medium
            )
        }
    }
    Spacer(Modifier.height(14.dp))

    PrivacyPolicyService.PERMISSIONS_SUMMARY.forEach { (name, action, justification) ->
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(bottom = 10.dp)
                .clip(RoundedCornerShape(12.dp))
                .background(Surface2)
                .padding(14.dp),
            verticalAlignment = Alignment.Top,
            horizontalArrangement = Arrangement.spacedBy(12.dp)
        ) {
            Box(
                modifier = Modifier
                    .size(36.dp)
                    .clip(RoundedCornerShape(9.dp))
                    .background(Success.copy(alpha = 0.14f)),
                contentAlignment = Alignment.Center
            ) {
                Icon(
                    Icons.Default.CheckCircle,
                    null,
                    tint     = Success,
                    modifier = Modifier.size(18.dp)
                )
            }
            Column(modifier = Modifier.weight(1f)) {
                Text(name, fontWeight = FontWeight.SemiBold, fontSize = 13.sp, color = OnSurface)
                Text(action, fontSize = 12.sp, color = OnSurface2, lineHeight = 17.sp)
                Spacer(Modifier.height(4.dp))
                Row(
                    modifier = Modifier
                        .clip(RoundedCornerShape(4.dp))
                        .background(Purple80.copy(alpha = 0.08f))
                        .padding(horizontal = 6.dp, vertical = 3.dp)
                ) {
                    Text(
                        "Why: $justification",
                        fontSize = 11.sp,
                        color    = Purple80.copy(alpha = 0.85f),
                        lineHeight = 16.sp
                    )
                }
            }
        }
    }
}

@Composable
private fun LegalTextTab(text: String) {
    Box(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(10.dp))
            .background(Surface2)
            .padding(16.dp)
    ) {
        Text(
            text,
            fontSize = 12.sp,
            color = OnSurface2,
            lineHeight = 20.sp,
            fontFamily = androidx.compose.ui.text.font.FontFamily.Monospace
        )
    }
}
