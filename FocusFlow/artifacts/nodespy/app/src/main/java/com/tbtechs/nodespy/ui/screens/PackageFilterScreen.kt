package com.tbtechs.nodespy.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.ArrowBack
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.FilterList
import androidx.compose.material.icons.filled.FilterListOff
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.tbtechs.nodespy.data.CaptureStore
import com.tbtechs.nodespy.ui.theme.*

private val SUGGESTIONS = listOf(
    "com.instagram.android",
    "com.google.android.youtube",
    "com.twitter.android",
    "com.facebook.katana",
    "com.zhiliaoapp.musically",
    "com.reddit.frontpage",
    "com.snapchat.android"
)

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun PackageFilterScreen(onBack: () -> Unit) {
    val allowlist by CaptureStore.packageAllowlist.collectAsState()
    var input by remember { mutableStateOf("") }
    val focusRequester = remember { FocusRequester() }

    fun addPkg(pkg: String) {
        val trimmed = pkg.trim()
        if (trimmed.isNotEmpty()) {
            CaptureStore.addToAllowlist(trimmed)
            input = ""
        }
    }

    Scaffold(
        containerColor = Background,
        topBar = {
            TopAppBar(
                title = {
                    Text(
                        "Package Filter",
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
                actions = {
                    if (allowlist.isNotEmpty()) {
                        IconButton(onClick = { CaptureStore.clearAllowlist() }) {
                            Icon(Icons.Default.FilterListOff, "Clear filter", tint = AccentOrange)
                        }
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
        ) {
            StatusBanner(allowlist)

            Row(
                Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 16.dp, vertical = 12.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(8.dp)
            ) {
                OutlinedTextField(
                    value = input,
                    onValueChange = { input = it },
                    modifier = Modifier
                        .weight(1f)
                        .focusRequester(focusRequester),
                    placeholder = {
                        Text(
                            "com.example.app",
                            color = Muted,
                            fontFamily = FontFamily.Monospace,
                            fontSize = 13.sp
                        )
                    },
                    singleLine = true,
                    keyboardOptions = KeyboardOptions(
                        keyboardType = KeyboardType.Uri,
                        imeAction = ImeAction.Done
                    ),
                    keyboardActions = KeyboardActions(onDone = { addPkg(input) }),
                    colors = OutlinedTextFieldDefaults.colors(
                        focusedBorderColor = AccentGreen,
                        unfocusedBorderColor = Muted,
                        focusedTextColor = OnBackground,
                        unfocusedTextColor = OnBackground,
                        cursorColor = AccentGreen
                    ),
                    textStyle = LocalTextStyle.current.copy(
                        fontFamily = FontFamily.Monospace,
                        fontSize = 13.sp
                    )
                )
                IconButton(
                    onClick = { addPkg(input) },
                    enabled = input.isNotBlank(),
                    modifier = Modifier
                        .clip(RoundedCornerShape(8.dp))
                        .background(if (input.isNotBlank()) AccentGreen.copy(alpha = 0.15f) else SurfaceVar)
                ) {
                    Icon(
                        Icons.Default.Add,
                        "Add",
                        tint = if (input.isNotBlank()) AccentGreen else Muted
                    )
                }
            }

            if (allowlist.isNotEmpty()) {
                LazyColumn(
                    contentPadding = PaddingValues(horizontal = 16.dp, vertical = 4.dp),
                    verticalArrangement = Arrangement.spacedBy(6.dp)
                ) {
                    items(allowlist.sorted(), key = { it }) { pkg ->
                        AllowlistRow(pkg = pkg, onRemove = { CaptureStore.removeFromAllowlist(pkg) })
                    }
                    item {
                        Spacer(Modifier.height(16.dp))
                        Text(
                            "Suggestions",
                            color = Muted,
                            fontSize = 11.sp,
                            fontFamily = FontFamily.Monospace,
                            fontWeight = FontWeight.Bold,
                            modifier = Modifier.padding(bottom = 6.dp)
                        )
                    }
                    items(SUGGESTIONS.filter { it !in allowlist }) { pkg ->
                        SuggestionRow(pkg = pkg, onAdd = { CaptureStore.addToAllowlist(pkg) })
                    }
                }
            } else {
                AllAppsState(
                    suggestions = SUGGESTIONS,
                    onAddSuggestion = { CaptureStore.addToAllowlist(it) }
                )
            }
        }
    }
}

@Composable
private fun StatusBanner(allowlist: Set<String>) {
    val (color, icon, text) = if (allowlist.isEmpty()) {
        Triple(AccentBlue, Icons.Default.FilterListOff, "Capturing from ALL apps")
    } else {
        Triple(AccentGreen, Icons.Default.FilterList, "Capturing from ${allowlist.size} app${if (allowlist.size == 1) "" else "s"} only")
    }
    Row(
        Modifier
            .fillMaxWidth()
            .background(color.copy(alpha = 0.08f))
            .padding(horizontal = 16.dp, vertical = 10.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(10.dp)
    ) {
        Icon(icon, null, tint = color, modifier = Modifier.size(18.dp))
        Text(text, color = color, fontSize = 13.sp, fontWeight = FontWeight.SemiBold)
    }
}

@Composable
private fun AllowlistRow(pkg: String, onRemove: () -> Unit) {
    Card(
        colors = CardDefaults.cardColors(containerColor = Surface),
        shape = RoundedCornerShape(8.dp)
    ) {
        Row(
            Modifier
                .fillMaxWidth()
                .padding(horizontal = 14.dp, vertical = 10.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            Box(
                Modifier
                    .clip(RoundedCornerShape(4.dp))
                    .background(AccentGreen.copy(alpha = 0.12f))
                    .padding(horizontal = 6.dp, vertical = 2.dp)
            ) {
                Text("●", color = AccentGreen, fontSize = 10.sp)
            }
            Spacer(Modifier.width(10.dp))
            Text(
                pkg,
                color = OnBackground,
                fontFamily = FontFamily.Monospace,
                fontSize = 13.sp,
                modifier = Modifier.weight(1f)
            )
            IconButton(onClick = onRemove, modifier = Modifier.size(32.dp)) {
                Icon(Icons.Default.Close, "Remove", tint = Muted, modifier = Modifier.size(16.dp))
            }
        }
    }
}

@Composable
private fun SuggestionRow(pkg: String, onAdd: () -> Unit) {
    Row(
        Modifier
            .fillMaxWidth()
            .padding(vertical = 3.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        Text(
            pkg,
            color = Muted,
            fontFamily = FontFamily.Monospace,
            fontSize = 12.sp,
            modifier = Modifier.weight(1f)
        )
        TextButton(onClick = onAdd, contentPadding = PaddingValues(horizontal = 8.dp, vertical = 4.dp)) {
            Text("+ Add", color = AccentGreen, fontSize = 11.sp, fontFamily = FontFamily.Monospace)
        }
    }
}

@Composable
private fun AllAppsState(suggestions: List<String>, onAddSuggestion: (String) -> Unit) {
    Column(
        Modifier
            .fillMaxSize()
            .padding(horizontal = 24.dp, vertical = 16.dp)
    ) {
        Text(
            "No filter active",
            color = OnBackground,
            fontWeight = FontWeight.SemiBold,
            fontSize = 16.sp
        )
        Spacer(Modifier.height(6.dp))
        Text(
            "NodeSpy is capturing from every app. Add package names above to restrict it to specific targets — this reduces noise and battery usage.",
            color = Muted,
            fontSize = 13.sp,
            lineHeight = 19.sp
        )
        Spacer(Modifier.height(20.dp))
        Text(
            "Common apps",
            color = Muted,
            fontSize = 11.sp,
            fontFamily = FontFamily.Monospace,
            fontWeight = FontWeight.Bold
        )
        Spacer(Modifier.height(8.dp))
        suggestions.forEach { pkg ->
            SuggestionRow(pkg = pkg, onAdd = { onAddSuggestion(pkg) })
        }
    }
}
