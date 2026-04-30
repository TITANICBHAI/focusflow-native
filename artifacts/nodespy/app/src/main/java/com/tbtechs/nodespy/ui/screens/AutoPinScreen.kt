package com.tbtechs.nodespy.ui.screens

import android.net.Uri
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.ArrowBack
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.FileOpen
import androidx.compose.material.icons.filled.PushPin
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
import com.google.gson.Gson
import com.tbtechs.nodespy.data.AutoPinRule
import com.tbtechs.nodespy.data.CaptureStore
import com.tbtechs.nodespy.data.MatchField
import com.tbtechs.nodespy.ui.theme.*
import kotlinx.coroutines.launch

// ─── JSON parsing helpers ─────────────────────────────────────────────────────

private val gson = Gson()

@Suppress("UNCHECKED_CAST")
private fun parseRulesFromJson(json: String): List<AutoPinRule> {
    val rules = mutableListOf<AutoPinRule>()
    runCatching {
        val root = gson.fromJson(json, Any::class.java)

        when {
            // NodeSpyCaptureV1 — parse recommendedRules array
            root is Map<*, *> && root["format"] == "NodeSpyCaptureV1" -> {
                val recommended = root["recommendedRules"] as? List<*> ?: return@runCatching
                for (entry in recommended) {
                    val map = entry as? Map<*, *> ?: continue
                    val selectorType = map["selectorType"] as? String ?: continue
                    val selector = map["selector"] as? Map<*, *> ?: continue
                    val (pattern, field) = when (selectorType) {
                        "resourceId" -> (selector["matchResId"] as? String) to MatchField.RES_ID
                        "label" -> (selector["matchText"] as? String) to MatchField.TEXT
                        "resourceId+label" -> (selector["matchResId"] as? String) to MatchField.RES_ID
                        "class" -> (selector["matchCls"] as? String) to MatchField.CLASS
                        else -> null to MatchField.RES_ID
                    }
                    if (!pattern.isNullOrBlank()) {
                        rules += AutoPinRule(pattern = pattern, matchField = field)
                    }
                }
            }

            // Plain array: [{"pattern": "...", "matchField": "TEXT"}, ...]
            root is List<*> -> {
                for (entry in root) {
                    val map = entry as? Map<*, *> ?: continue
                    val pattern = map["pattern"] as? String ?: continue
                    val fieldName = map["matchField"] as? String ?: "RES_ID"
                    val field = runCatching { MatchField.valueOf(fieldName) }.getOrDefault(MatchField.RES_ID)
                    if (pattern.isNotBlank()) {
                        rules += AutoPinRule(pattern = pattern, matchField = field)
                    }
                }
            }
        }
    }
    return rules
}

// ─── Screen ──────────────────────────────────────────────────────────────────

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun AutoPinScreen(onBack: () -> Unit) {
    val rules by CaptureStore.autoPinRules.collectAsState()
    var showDialog by remember { mutableStateOf(false) }
    val snackbarHostState = remember { SnackbarHostState() }
    val scope = rememberCoroutineScope()
    val context = LocalContext.current

    val importLauncher = rememberLauncherForActivityResult(
        contract = ActivityResultContracts.OpenDocument()
    ) { uri: Uri? ->
        if (uri == null) return@rememberLauncherForActivityResult
        scope.launch {
            val json = runCatching {
                context.contentResolver.openInputStream(uri)?.bufferedReader()?.readText()
            }.getOrNull()

            if (json.isNullOrBlank()) {
                snackbarHostState.showSnackbar("Could not read file")
                return@launch
            }

            val imported = parseRulesFromJson(json)
            if (imported.isEmpty()) {
                snackbarHostState.showSnackbar("No valid rules found in JSON")
                return@launch
            }

            val existing = CaptureStore.autoPinRules.value.map { it.pattern }.toSet()
            val novel = imported.filter { it.pattern !in existing }
            novel.forEach { CaptureStore.addAutoPinRule(it) }

            val msg = when {
                novel.isEmpty() -> "All ${imported.size} rules already exist"
                novel.size == imported.size -> "Imported ${novel.size} rule${if (novel.size == 1) "" else "s"}"
                else -> "Imported ${novel.size} new rule${if (novel.size == 1) "" else "s"} (${imported.size - novel.size} duplicate${if (imported.size - novel.size == 1) "" else "s"} skipped)"
            }
            snackbarHostState.showSnackbar(msg)
        }
    }

    Scaffold(
        containerColor = Background,
        snackbarHost = { SnackbarHost(snackbarHostState) },
        topBar = {
            TopAppBar(
                title = {
                    Text(
                        "Auto-Pin Rules",
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
                    IconButton(
                        onClick = { importLauncher.launch(arrayOf("application/json", "application/octet-stream", "*/*")) }
                    ) {
                        Icon(
                            Icons.Default.FileOpen,
                            contentDescription = "Import from JSON",
                            tint = AccentBlue
                        )
                    }
                },
                colors = TopAppBarDefaults.topAppBarColors(containerColor = Surface)
            )
        },
        floatingActionButton = {
            FloatingActionButton(
                onClick = { showDialog = true },
                containerColor = AccentGreen,
                contentColor = Background
            ) {
                Icon(Icons.Default.Add, "Add rule")
            }
        }
    ) { padding ->
        Column(
            Modifier
                .fillMaxSize()
                .padding(padding)
                .background(Background)
        ) {
            ExplainerBanner()

            if (rules.isEmpty()) {
                EmptyAutoPinState(onAdd = { showDialog = true })
            } else {
                LazyColumn(
                    contentPadding = PaddingValues(horizontal = 16.dp, vertical = 8.dp),
                    verticalArrangement = Arrangement.spacedBy(8.dp)
                ) {
                    items(rules, key = { it.id }) { rule ->
                        AutoPinRuleCard(
                            rule = rule,
                            onToggle = { CaptureStore.toggleAutoPinRule(rule.id) },
                            onDelete = { CaptureStore.removeAutoPinRule(rule.id) }
                        )
                    }
                    item { Spacer(Modifier.height(80.dp)) }
                }
            }
        }
    }

    if (showDialog) {
        AddRuleDialog(
            onAdd = { rule ->
                CaptureStore.addAutoPinRule(rule)
                showDialog = false
            },
            onDismiss = { showDialog = false }
        )
    }
}

@Composable
private fun ExplainerBanner() {
    Row(
        Modifier
            .fillMaxWidth()
            .background(AccentOrange.copy(alpha = 0.08f))
            .padding(horizontal = 16.dp, vertical = 10.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(10.dp)
    ) {
        Icon(Icons.Default.PushPin, null, tint = AccentOrange, modifier = Modifier.size(18.dp))
        Text(
            "Matching nodes are auto-pinned on every new capture. Use * as a wildcard. Tap the file icon to import rules from any JSON export.",
            color = AccentOrange,
            fontSize = 12.sp,
            lineHeight = 17.sp
        )
    }
}

@Composable
private fun AutoPinRuleCard(
    rule: AutoPinRule,
    onToggle: () -> Unit,
    onDelete: () -> Unit
) {
    val activeColor = if (rule.enabled) AccentGreen else Muted
    Card(
        colors = CardDefaults.cardColors(containerColor = Surface),
        shape = RoundedCornerShape(10.dp)
    ) {
        Row(
            Modifier
                .fillMaxWidth()
                .padding(horizontal = 14.dp, vertical = 12.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            Switch(
                checked = rule.enabled,
                onCheckedChange = { onToggle() },
                colors = SwitchDefaults.colors(
                    checkedThumbColor = Background,
                    checkedTrackColor = AccentGreen,
                    uncheckedThumbColor = Muted,
                    uncheckedTrackColor = SurfaceVar
                ),
                modifier = Modifier.size(width = 40.dp, height = 24.dp)
            )
            Spacer(Modifier.width(12.dp))
            Column(Modifier.weight(1f)) {
                Text(
                    rule.pattern,
                    color = activeColor,
                    fontFamily = FontFamily.Monospace,
                    fontWeight = FontWeight.Bold,
                    fontSize = 14.sp,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis
                )
                Spacer(Modifier.height(2.dp))
                Box(
                    Modifier
                        .clip(RoundedCornerShape(3.dp))
                        .background(activeColor.copy(alpha = 0.12f))
                        .padding(horizontal = 5.dp, vertical = 1.dp)
                ) {
                    Text(
                        rule.matchField.label,
                        color = activeColor,
                        fontSize = 10.sp,
                        fontFamily = FontFamily.Monospace,
                        fontWeight = FontWeight.Bold
                    )
                }
            }
            IconButton(onClick = onDelete, modifier = Modifier.size(36.dp)) {
                Icon(Icons.Default.Close, "Delete", tint = Muted, modifier = Modifier.size(18.dp))
            }
        }
    }
}

@Composable
private fun EmptyAutoPinState(onAdd: () -> Unit) {
    Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
        Column(horizontalAlignment = Alignment.CenterHorizontally) {
            Icon(
                Icons.Default.PushPin,
                contentDescription = null,
                tint = Muted,
                modifier = Modifier.size(52.dp)
            )
            Spacer(Modifier.height(14.dp))
            Text("No rules yet", color = OnBackground, fontWeight = FontWeight.SemiBold, fontSize = 16.sp)
            Spacer(Modifier.height(8.dp))
            Text(
                "Tap + to create your first pattern.\nExample: *skip* on Resource ID pins all skip buttons.\nOr tap the file icon to import from a JSON export.",
                color = Muted,
                fontSize = 13.sp,
                textAlign = androidx.compose.ui.text.style.TextAlign.Center,
                lineHeight = 19.sp,
                modifier = Modifier.padding(horizontal = 32.dp)
            )
            Spacer(Modifier.height(20.dp))
            TextButton(onClick = onAdd) {
                Text("+ Add rule", color = AccentGreen, fontWeight = FontWeight.Bold)
            }
        }
    }
}

@Composable
private fun AddRuleDialog(
    onAdd: (AutoPinRule) -> Unit,
    onDismiss: () -> Unit
) {
    var pattern by remember { mutableStateOf("") }
    var selectedField by remember { mutableStateOf(MatchField.RES_ID) }

    AlertDialog(
        onDismissRequest = onDismiss,
        containerColor = Surface,
        title = {
            Text(
                "New Auto-Pin Rule",
                color = OnBackground,
                fontWeight = FontWeight.Bold,
                fontFamily = FontFamily.Monospace
            )
        },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(14.dp)) {
                OutlinedTextField(
                    value = pattern,
                    onValueChange = { pattern = it },
                    label = {
                        Text("Pattern (* = wildcard)", color = Muted, fontSize = 12.sp)
                    },
                    placeholder = {
                        Text("*skip* or *ad_banner*", color = Muted, fontFamily = FontFamily.Monospace, fontSize = 12.sp)
                    },
                    singleLine = true,
                    colors = OutlinedTextFieldDefaults.colors(
                        focusedBorderColor = AccentGreen,
                        unfocusedBorderColor = Muted,
                        focusedTextColor = OnBackground,
                        unfocusedTextColor = OnBackground,
                        cursorColor = AccentGreen,
                        focusedLabelColor = AccentGreen,
                        unfocusedLabelColor = Muted
                    ),
                    textStyle = LocalTextStyle.current.copy(fontFamily = FontFamily.Monospace)
                )

                Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                    Text("Match against:", color = Muted, fontSize = 12.sp)
                    Row(
                        horizontalArrangement = Arrangement.spacedBy(6.dp),
                        modifier = Modifier.fillMaxWidth()
                    ) {
                        MatchField.entries.forEach { field ->
                            val selected = field == selectedField
                            FilterChip(
                                selected = selected,
                                onClick = { selectedField = field },
                                label = {
                                    Text(
                                        field.label,
                                        fontSize = 11.sp,
                                        fontFamily = FontFamily.Monospace
                                    )
                                },
                                colors = FilterChipDefaults.filterChipColors(
                                    selectedContainerColor = AccentGreen.copy(alpha = 0.15f),
                                    selectedLabelColor = AccentGreen,
                                    containerColor = SurfaceVar,
                                    labelColor = Muted
                                )
                            )
                        }
                    }
                }
            }
        },
        confirmButton = {
            TextButton(
                onClick = {
                    if (pattern.isNotBlank()) {
                        onAdd(AutoPinRule(pattern = pattern.trim(), matchField = selectedField))
                    }
                },
                enabled = pattern.isNotBlank()
            ) {
                Text("Add", color = AccentGreen, fontWeight = FontWeight.Bold)
            }
        },
        dismissButton = {
            TextButton(onClick = onDismiss) {
                Text("Cancel", color = Muted)
            }
        }
    )
}
