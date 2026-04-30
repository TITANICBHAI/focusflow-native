package com.tbtechs.nodespy.ui.theme

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color

private val DarkColorScheme = darkColorScheme(
    primary = AccentBlue,
    secondary = AccentGreen,
    tertiary = AccentOrange,
    background = Background,
    surface = Surface,
    surfaceVariant = SurfaceVar,
    outline = Outline,
    onBackground = OnBackground,
    onSurface = OnSurface,
    onPrimary = Color(0xFF0D1117),
    onSecondary = Color(0xFF0D1117),
    error = AccentRed
)

@Composable
fun NodeSpyTheme(content: @Composable () -> Unit) {
    MaterialTheme(
        colorScheme = DarkColorScheme,
        content = content
    )
}
