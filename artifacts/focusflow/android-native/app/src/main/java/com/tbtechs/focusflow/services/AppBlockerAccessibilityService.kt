package com.tbtechs.focusflow.services

import android.accessibilityservice.AccessibilityService
import android.accessibilityservice.AccessibilityServiceInfo
import android.content.Intent
import android.content.SharedPreferences
import android.view.accessibility.AccessibilityEvent
import com.tbtechs.focusflow.modules.FocusDayBridgeModule

/**
 * AppBlockerAccessibilityService
 *
 * Listens for window-content-changed and window-state-changed events.
 * When a blocked app comes to the foreground, it:
 *   1. Fires a broadcast to FocusDayBridgeModule → forwarded as "APP_BLOCKED" to JS.
 *   2. Launches FocusDay's MainActivity over the top of the blocked app.
 *
 * How to enable:
 *   - Declare in AndroidManifest (already done in manifest_additions.xml).
 *   - User must grant in: Settings → Accessibility → FocusDay → Allow.
 *
 * How JS controls which apps are blocked:
 *   - When focus mode starts, JS (via FocusService) writes a JSON array of blocked
 *     package names into SharedPreferences under the key "blocked_packages".
 *   - This service reads that key on every window event.
 *   - The app's own package is always exempted so FocusDay itself is never blocked.
 *
 * SharedPreferences file: "focusday_prefs"
 * Key: "blocked_packages" → JSON array string, e.g. '["com.instagram.android","com.twitter.android"]'
 * Key: "focus_active"     → "true" | "false"
 */
class AppBlockerAccessibilityService : AccessibilityService() {

    companion object {
        const val PREFS_NAME       = "focusday_prefs"
        const val PREF_ALLOWED_PKG = "allowed_packages"
        const val PREF_FOCUS_ON    = "focus_active"

        /**
         * Package installers / uninstall UIs that are ALWAYS blocked during a focus
         * session, regardless of what JS writes to SharedPreferences.
         * JS settings cannot override this set.
         * NOTE: com.android.vending (Play Store) is intentionally excluded — it is
         * only blocked if the user explicitly adds it to the blocked list.
         */
        val ALWAYS_BLOCKED: Set<String> = setOf(
            "com.android.packageinstaller",
            "com.google.android.packageinstaller",
            "com.samsung.android.packageinstaller",
            "com.miui.packageinstaller"
        )
    }

    private lateinit var prefs: SharedPreferences
    private var lastBlockedPkg: String? = null

    override fun onServiceConnected() {
        prefs = getSharedPreferences(PREFS_NAME, MODE_PRIVATE)

        serviceInfo = serviceInfo.apply {
            eventTypes = AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED or
                         AccessibilityEvent.TYPE_WINDOW_CONTENT_CHANGED
            feedbackType = AccessibilityServiceInfo.FEEDBACK_GENERIC
            notificationTimeout = 100L   // milliseconds between events
            flags = AccessibilityServiceInfo.FLAG_INCLUDE_NOT_IMPORTANT_VIEWS
        }
    }

    override fun onAccessibilityEvent(event: AccessibilityEvent?) {
        if (event?.eventType != AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED) return

        val focusActive = prefs.getString(PREF_FOCUS_ON, "false") == "true"
        if (!focusActive) return

        val pkg = event.packageName?.toString() ?: return
        if (pkg == packageName) return  // never block our own app

        // Always block package installers / uninstall UIs — JS cannot override this.
        val isAlwaysBlocked = ALWAYS_BLOCKED.any { blocked ->
            pkg.equals(blocked, ignoreCase = true) || pkg.contains(blocked, ignoreCase = true)
        }

        val allowedJson = prefs.getString(PREF_ALLOWED_PKG, "[]") ?: "[]"
        val allowedList = parseJsonArray(allowedJson)

        // Block any app that is NOT in the allowed list (and not our own package)
        val isBlocked = isAlwaysBlocked || (allowedList.isNotEmpty() && !allowedList.any { allowed ->
            pkg.equals(allowed, ignoreCase = true) || pkg.contains(allowed, ignoreCase = true)
        })

        if (isBlocked && pkg != lastBlockedPkg) {
            lastBlockedPkg = pkg
            handleBlockedApp(pkg)
        } else if (!isBlocked) {
            lastBlockedPkg = null
        }
    }

    override fun onInterrupt() {
        lastBlockedPkg = null
    }

    // ─── Private helpers ─────────────────────────────────────────────────────

    private fun handleBlockedApp(blockedPackage: String) {
        // 1. Notify JS via broadcast → FocusDayBridgeModule → "APP_BLOCKED" event
        val broadcast = Intent(FocusDayBridgeModule.ACTION_APP_BLOCKED).apply {
            `package` = packageName
            putExtra(FocusDayBridgeModule.EXTRA_BLOCKED_PKG, blockedPackage)
        }
        sendBroadcast(broadcast)

        // 2. Bring FocusDay to the front immediately
        val pm = packageManager
        val launchIntent = pm.getLaunchIntentForPackage(packageName)?.apply {
            addFlags(
                Intent.FLAG_ACTIVITY_NEW_TASK or
                Intent.FLAG_ACTIVITY_SINGLE_TOP or
                Intent.FLAG_ACTIVITY_REORDER_TO_FRONT
            )
            // Pass the blocked package so MainActivity can show a "blocked" message
            putExtra("blocked_app", blockedPackage)
        }
        launchIntent?.let { startActivity(it) }

        // 3. Press Back to ensure the blocked app is pushed off the stack.
        //    The Back press combined with launching FocusDay keeps the stack clean.
        performGlobalAction(GLOBAL_ACTION_BACK)
    }

    /**
     * Minimal JSON array parser — avoids a full JSON library dependency.
     * Parses ["pkg1","pkg2"] → listOf("pkg1","pkg2")
     */
    private fun parseJsonArray(json: String): List<String> {
        return try {
            json
                .trim()
                .removePrefix("[")
                .removeSuffix("]")
                .split(",")
                .map { it.trim().removeSurrounding("\"") }
                .filter { it.isNotEmpty() }
        } catch (_: Exception) {
            emptyList()
        }
    }
}
