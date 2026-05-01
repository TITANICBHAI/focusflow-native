package com.tbtechs.nodespy.export

import com.tbtechs.nodespy.data.NodeCapture
import com.tbtechs.nodespy.data.NodeEntry

data class RuleRecommendation(
    val nodeId: String,
    val label: String,
    val pkg: String,
    val selectorType: String,
    val selector: Map<String, String>,
    val confidence: Int,
    val tier: String,
    val exportable: Boolean,
    val uniqueInCapture: Boolean,
    val matchedInRecentCaptures: Int,
    val comparedCaptures: Int,
    val stability: Float,
    val reasons: List<String>,
    val warnings: List<String>
)

data class RuleQualitySummary(
    val totalPinned: Int,
    val exportableRules: Int,
    val strongRules: Int,
    val mediumRules: Int,
    val weakRules: Int,
    val averageConfidence: Int,
    val warnings: List<String>,
    val guidance: List<String>
)

object RuleAnalyzer {
    fun analyze(
        capture: NodeCapture,
        pinnedIds: Set<String>,
        recentCaptures: List<NodeCapture> = emptyList()
    ): List<RuleRecommendation> {
        val pinned = capture.nodes.filter { it.id in pinnedIds }
        val samePackageHistory = recentCaptures
            .filter { it.id != capture.id && it.pkg == capture.pkg }
            .take(5)
        return pinned.map { node -> analyzeNode(capture, node, samePackageHistory) }
            .sortedWith(compareByDescending<RuleRecommendation> { it.confidence }.thenBy { it.label })
    }

    fun summarize(recommendations: List<RuleRecommendation>): RuleQualitySummary {
        val warnings = mutableListOf<String>()
        val weakCount = recommendations.count { it.tier == "weak" }
        val exportable = recommendations.count { it.exportable }
        if (recommendations.isEmpty()) {
            warnings += "Pin at least one node before exporting."
        }
        if (weakCount > 0) {
            warnings += "$weakCount pinned node${if (weakCount == 1) "" else "s"} only has weak selectors."
        }
        if (exportable == 0 && recommendations.isNotEmpty()) {
            warnings += "No high-confidence rules are ready; capture another state or choose nodes with text/resource IDs."
        }

        return RuleQualitySummary(
            totalPinned = recommendations.size,
            exportableRules = exportable,
            strongRules = recommendations.count { it.tier == "strong" },
            mediumRules = recommendations.count { it.tier == "medium" },
            weakRules = weakCount,
            averageConfidence = if (recommendations.isEmpty()) 0 else recommendations.map { it.confidence }.average().toInt(),
            warnings = warnings,
            guidance = listOf(
                "Open the target app and navigate to the exact feature you want to block.",
                "Capture the screen two or three times after small UI changes so stability can be measured.",
                "Pin the smallest visible node with a resource ID or stable label.",
                "Export recommended rules; weak class/bounds-only matches are kept as warnings, not default FocusFlow rules."
            )
        )
    }

    private fun analyzeNode(
        capture: NodeCapture,
        node: NodeEntry,
        history: List<NodeCapture>
    ): RuleRecommendation {
        val reasons = mutableListOf<String>()
        val warnings = mutableListOf<String>()
        val selector = linkedMapOf<String, String>()
        var score = 0

        val resId = node.resId?.takeIf { it.isNotBlank() }
        val text = node.text?.takeIf { it.isNotBlank() }
        val desc = node.desc?.takeIf { it.isNotBlank() }
        val textLike = text ?: desc
        val clsShort = node.cls.substringAfterLast('.')

        val resIdUnique = resId?.let { value -> capture.nodes.count { it.resId == value } == 1 } ?: false
        val textUnique = textLike?.let { value ->
            capture.nodes.count { it.text == value || it.desc == value } == 1
        } ?: false

        if (resId != null) {
            selector["matchResId"] = resId
            score += if (resIdUnique) 48 else 34
            reasons += if (resIdUnique) "resource ID is unique in this capture" else "resource ID is present but reused"
        }

        if (textLike != null && textLike.length in 2..100) {
            if (resId == null || !resIdUnique) selector["matchText"] = textLike.take(100)
            score += if (textUnique) 24 else 14
            reasons += if (textUnique) "visible label/content description is unique" else "visible label/content description is reusable"
        } else if (textLike != null) {
            warnings += "text/description is too long or too short for a reliable selector"
        }

        if (selector.isEmpty()) {
            selector["matchCls"] = clsShort
            score += 20
            warnings += "class-only selectors can match unrelated UI elements"
        } else if (node.flags.clickable || clsShort.contains("Button", ignoreCase = true)) {
            score += 8
            reasons += "node appears actionable"
        }

        if (!node.flags.visible) warnings += "node is not marked visible"
        if (node.boundsR <= node.boundsL || node.boundsB <= node.boundsT) warnings += "node bounds are empty"

        val matchedHistory = history.count { past -> matchesPastCapture(past, node, resId, textLike) }
        val compared = history.size
        val stability = if (compared == 0) 0.5f else matchedHistory.toFloat() / compared.toFloat()
        when {
            compared == 0 -> warnings += "capture another screen state to verify selector stability"
            stability >= 0.67f -> {
                score += 14
                reasons += "selector reappears across recent captures"
            }
            stability > 0f -> {
                score += 7
                reasons += "selector appears in some recent captures"
            }
            else -> warnings += "selector did not reappear in recent captures"
        }

        if (resId == null && textLike == null) warnings += "no resource ID or readable label was available"
        if (!resIdUnique && textLike == null && resId != null) warnings += "resource ID is reused and no label narrows the match"

        val confidence = score.coerceIn(0, 100)
        val tier = when {
            confidence >= 80 -> "strong"
            confidence >= 55 -> "medium"
            else -> "weak"
        }
        val exportable = tier != "weak" && selector.keys.any { it == "matchResId" || it == "matchText" }
        val selectorType = when {
            "matchResId" in selector && "matchText" in selector -> "resourceId+label"
            "matchResId" in selector -> "resourceId"
            "matchText" in selector -> "label"
            else -> "class"
        }

        return RuleRecommendation(
            nodeId = node.id,
            label = (textLike ?: resId?.substringAfterLast('/') ?: clsShort).take(60),
            pkg = capture.pkg,
            selectorType = selectorType,
            selector = selector,
            confidence = confidence,
            tier = tier,
            exportable = exportable,
            uniqueInCapture = resIdUnique || textUnique,
            matchedInRecentCaptures = matchedHistory,
            comparedCaptures = compared,
            stability = stability,
            reasons = reasons,
            warnings = warnings
        )
    }

    private fun matchesPastCapture(
        capture: NodeCapture,
        source: NodeEntry,
        resId: String?,
        textLike: String?
    ): Boolean {
        return capture.nodes.any { node ->
            val nodeTextLike = node.text ?: node.desc
            when {
                resId != null && node.resId == resId -> true
                textLike != null && nodeTextLike == textLike && node.cls == source.cls -> true
                else -> false
            }
        }
    }
}