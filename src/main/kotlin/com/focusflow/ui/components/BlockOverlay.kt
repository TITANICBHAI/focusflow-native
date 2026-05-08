package com.focusflow.ui.components

import androidx.compose.animation.*
import androidx.compose.animation.core.*
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Block
import androidx.compose.material.icons.filled.Shield
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.scale
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.focusflow.data.Database
import com.focusflow.ui.theme.*

/**
 * BlockOverlay
 *
 * Full-screen overlay shown when a blocked app is detected and killed.
 * Displayed as an always-on-top composable layer over the main window.
 */
@Composable
fun BlockOverlay(
    visible: Boolean,
    appName: String,
    onDismiss: () -> Unit
) {
    AnimatedVisibility(
        visible = visible,
        enter   = fadeIn(tween(220)) + scaleIn(tween(220), initialScale = 0.94f),
        exit    = fadeOut(tween(180)) + scaleOut(tween(180), targetScale = 0.96f)
    ) {
        Box(
            modifier          = Modifier.fillMaxSize().background(Color(0xF0080710)),
            contentAlignment  = Alignment.Center
        ) {
            // Ambient glow behind the card
            Box(
                modifier = Modifier
                    .size(340.dp)
                    .clip(CircleShape)
                    .background(Error.copy(alpha = 0.07f))
            )

            Column(
                horizontalAlignment   = Alignment.CenterHorizontally,
                verticalArrangement   = Arrangement.spacedBy(0.dp),
                modifier              = Modifier.padding(48.dp)
            ) {
                // ── Pulsing icon ring ──────────────────────────────────────────
                val pulse = rememberInfiniteTransition(label = "blockPulse")
                val pulseScale by pulse.animateFloat(
                    initialValue  = 1f,
                    targetValue   = 1.12f,
                    animationSpec = infiniteRepeatable(tween(900, easing = FastOutSlowInEasing), RepeatMode.Reverse),
                    label         = "blockPulseScale"
                )
                val pulseAlpha by pulse.animateFloat(
                    initialValue  = 0.18f,
                    targetValue   = 0.36f,
                    animationSpec = infiniteRepeatable(tween(900), RepeatMode.Reverse),
                    label         = "blockPulseAlpha"
                )

                Box(contentAlignment = Alignment.Center, modifier = Modifier.size(130.dp)) {
                    // Outer pulse ring
                    Box(
                        modifier = Modifier
                            .size(110.dp)
                            .scale(pulseScale)
                            .clip(CircleShape)
                            .background(Error.copy(alpha = pulseAlpha))
                    )
                    // Inner icon container
                    Box(
                        modifier = Modifier
                            .size(80.dp)
                            .clip(CircleShape)
                            .background(Error.copy(alpha = 0.20f)),
                        contentAlignment = Alignment.Center
                    ) {
                        Icon(
                            Icons.Default.Block,
                            contentDescription = null,
                            tint               = Error,
                            modifier           = Modifier.size(40.dp)
                        )
                    }
                }

                Spacer(Modifier.height(28.dp))

                // ── App name ──────────────────────────────────────────────────
                Text(
                    text      = appName,
                    style     = MaterialTheme.typography.headlineMedium,
                    fontWeight = FontWeight.Bold,
                    color     = OnSurface,
                    textAlign = TextAlign.Center
                )

                Spacer(Modifier.height(6.dp))

                Text(
                    "is blocked",
                    style     = MaterialTheme.typography.titleMedium,
                    color     = Error,
                    fontWeight = FontWeight.SemiBold,
                    textAlign = TextAlign.Center
                )

                Spacer(Modifier.height(24.dp))

                // ── Motivational message card ──────────────────────────────────
                Column(
                    modifier = Modifier
                        .widthIn(max = 380.dp)
                        .clip(RoundedCornerShape(16.dp))
                        .background(Color(0xFF1A1826))
                        .padding(horizontal = 24.dp, vertical = 18.dp),
                    horizontalAlignment = Alignment.CenterHorizontally,
                    verticalArrangement = Arrangement.spacedBy(8.dp)
                ) {
                    Row(
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(8.dp)
                    ) {
                        Icon(Icons.Default.Shield, null, tint = Purple80, modifier = Modifier.size(16.dp))
                        Text(
                            "FocusFlow",
                            style      = MaterialTheme.typography.labelSmall,
                            color      = Purple80,
                            fontWeight = FontWeight.SemiBold,
                            letterSpacing = 0.6.sp
                        )
                    }
                    Text(
                        Database.getSetting("overlay_message") ?: "Stay focused. You've got this.",
                        style     = MaterialTheme.typography.bodyLarge,
                        color     = OnSurface,
                        textAlign = TextAlign.Center,
                        fontWeight = FontWeight.Medium,
                        lineHeight = 24.sp
                    )
                }

                Spacer(Modifier.height(20.dp))

                Text(
                    "This window will close automatically.",
                    style = MaterialTheme.typography.bodySmall,
                    color = OnSurface2.copy(alpha = 0.5f)
                )

                Spacer(Modifier.height(16.dp))

                TextButton(onClick = onDismiss) {
                    Text("Dismiss", color = Purple60, fontWeight = FontWeight.SemiBold)
                }
            }
        }
    }
}
