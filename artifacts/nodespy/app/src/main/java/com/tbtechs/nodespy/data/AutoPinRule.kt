package com.tbtechs.nodespy.data

import java.util.UUID

data class AutoPinRule(
    val id: String = UUID.randomUUID().toString(),
    val pattern: String,
    val matchField: MatchField = MatchField.RES_ID,
    val enabled: Boolean = true
)

enum class MatchField(val label: String) {
    RES_ID("Resource ID"),
    TEXT("Text"),
    CLASS("Class Name"),
    DESC("Content Desc"),
    HINT("Hint Text")
}

fun globMatch(pattern: String, value: String?): Boolean {
    if (value.isNullOrBlank()) return false
    if (!pattern.contains('*')) return value.contains(pattern, ignoreCase = true)
    val regexPattern = pattern
        .replace(".", "\\.")
        .replace("*", ".*")
    return Regex(regexPattern, RegexOption.IGNORE_CASE).containsMatchIn(value)
}

fun AutoPinRule.matches(node: NodeEntry): Boolean {
    if (!enabled) return false
    val field = when (matchField) {
        MatchField.RES_ID -> node.resId
        MatchField.TEXT -> node.text
        MatchField.CLASS -> node.cls
        MatchField.DESC -> node.desc
        MatchField.HINT -> node.hint
    }
    return globMatch(pattern, field)
}
