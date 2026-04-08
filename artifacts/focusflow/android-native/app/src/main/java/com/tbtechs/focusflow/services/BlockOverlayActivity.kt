package com.tbtechs.focusflow.services

import android.animation.ValueAnimator
import android.app.Activity
import android.content.SharedPreferences
import android.graphics.BitmapFactory
import android.graphics.Color
import android.graphics.drawable.GradientDrawable
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.view.Gravity
import android.view.View
import android.view.WindowManager
import android.widget.FrameLayout
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.TextView
import com.tbtechs.focusflow.MainActivity
import org.json.JSONArray
import java.io.File

/**
 * BlockOverlayActivity
 *
 * Full-screen blocking overlay launched the instant a blocked package is detected.
 * The overlay covers the entire screen (including status/nav bars), persists while
 * the session is active, and cannot be dismissed by the user until the accessibility
 * service has confirmed the blocked app is gone from the foreground.
 *
 * Dismissal flow:
 *   1. Overlay appears immediately when blocked app opens.
 *   2. AccessibilityService presses HOME — blocked app leaves foreground.
 *   3. On the next window event (launcher/home visible), the service writes
 *      overlay_x_ready = true in SharedPreferences.
 *   4. This activity polls prefs every 300 ms; when overlay_x_ready = true it
 *      fades in the ✕ button in the top-right corner.
 *   5. User taps ✕ → overlay finishes.  No navigation — they're already at home.
 *
 * Back button: intentionally swallowed — overlay cannot be dismissed by back press.
 * onPause re-raise: kept from the original for slow-device protection.
 *
 * SharedPrefs keys read:
 *   block_overlay_quote      — fixed quote string
 *   block_overlay_quotes     — JSON array of custom quotes
 *   block_overlay_wallpaper  — absolute path to background image
 *   overlay_x_ready          — Boolean set by AccessibilityService; cleared here on dismiss
 *   focus_active / standalone_block_active — used by re-raise guard
 */
class BlockOverlayActivity : Activity() {

    companion object {
        const val EXTRA_BLOCKED_PKG  = "blocked_pkg"
        const val EXTRA_BLOCKED_NAME = "blocked_name"

        /** Written by AccessibilityService after HOME press is confirmed. */
        const val PREF_OVERLAY_X_READY = "overlay_x_ready"

        private const val X_POLL_INTERVAL_MS = 300L

        private val DEFAULT_QUOTES = listOf(
            "The present moment is the only time over which we have dominion.",
            "Focus is the art of knowing what to ignore.",
            "Deep work is the superpower of the 21st century.",
            "Your future self is watching. Don't let them down.",
            "One task at a time. One step at a time. One breath at a time.",
            "Discipline is choosing between what you want now and what you want most.",
            "The successful warrior is the average person with laser-like focus.",
            "Where attention goes, energy flows.",
            "Distraction is the enemy of vision.",
            "Every time you resist the urge to check, you grow stronger.",
            "You don't need to check your phone. The world can wait.",
            "Protect your attention like you protect your money.",
            "Clarity comes from action, not thought.",
            "Small disciplines repeated with consistency lead to great achievements.",
            "The cost of distraction is the loss of the life you could have built."
        )
    }

    private lateinit var prefs: SharedPreferences
    private val handler = Handler(Looper.getMainLooper())
    private var blockedName: String = ""
    private var intentionalFinish = false

    // The ✕ button — starts invisible, fades in when x_ready flag is set
    private lateinit var xButton: TextView
    private var xButtonRevealed = false

    // ─── Polling runnable ─────────────────────────────────────────────────────

    private val pollRunnable = object : Runnable {
        override fun run() {
            if (isFinishing || isDestroyed || xButtonRevealed) return
            if (prefs.getBoolean(PREF_OVERLAY_X_READY, false)) {
                revealXButton()
            } else {
                handler.postDelayed(this, X_POLL_INTERVAL_MS)
            }
        }
    }

    // ─── Lifecycle ────────────────────────────────────────────────────────────

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        prefs = getSharedPreferences(AppBlockerAccessibilityService.PREFS_NAME, MODE_PRIVATE)
        blockedName = intent?.getStringExtra(EXTRA_BLOCKED_NAME) ?: ""

        // Clear any stale x_ready flag from a previous session
        prefs.edit().putBoolean(PREF_OVERLAY_X_READY, false).apply()

        applyWindowFlags()
        buildUI()

        // Start polling for the x_ready signal
        handler.postDelayed(pollRunnable, X_POLL_INTERVAL_MS)
    }

    override fun onNewIntent(intent: android.content.Intent?) {
        super.onNewIntent(intent)
        // singleTask re-use: just update the blocked name label if needed
        intent?.getStringExtra(EXTRA_BLOCKED_NAME)?.let { if (it.isNotEmpty()) blockedName = it }
    }

    // ─── Back button: swallowed entirely — overlay CANNOT be dismissed by back ─

    @Deprecated("Deprecated in Java")
    override fun onBackPressed() {
        // Intentionally do nothing — the ✕ button is the only exit
    }

    // ─── Slow-phone re-raise guard ────────────────────────────────────────────
    //
    // If the overlay is paused (e.g. the blocked app finishes drawing on a very
    // slow phone before the overlay could take focus), re-raise ourselves.
    // The x_ready polling continues after we re-raise.

    override fun onPause() {
        super.onPause()
        if (intentionalFinish || isFinishing) return

        val focusActive = prefs.getBoolean(AppBlockerAccessibilityService.PREF_FOCUS_ON, false)
        val saActive    = prefs.getBoolean(AppBlockerAccessibilityService.PREF_SA_ACTIVE, false)
        val greyActive  = prefs.getBoolean("overlay_x_ready", false)  // still in blocking context
        if (!focusActive && !saActive && !greyActive) return

        handler.postDelayed({
            if (!isFinishing && !isDestroyed && !intentionalFinish) {
                try {
                    val reRaise = android.content.Intent(
                        applicationContext, BlockOverlayActivity::class.java
                    ).apply {
                        flags = android.content.Intent.FLAG_ACTIVITY_NEW_TASK or
                                android.content.Intent.FLAG_ACTIVITY_REORDER_TO_FRONT
                        putExtra(EXTRA_BLOCKED_NAME, blockedName)
                    }
                    applicationContext.startActivity(reRaise)
                } catch (_: Exception) { }
            }
        }, 550L)
    }

    override fun onDestroy() {
        handler.removeCallbacksAndMessages(null)
        super.onDestroy()
    }

    // ─── Window flags ─────────────────────────────────────────────────────────

    private fun applyWindowFlags() {
        window.apply {
            addFlags(
                WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON or
                WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED or
                WindowManager.LayoutParams.FLAG_DISMISS_KEYGUARD or
                WindowManager.LayoutParams.FLAG_FULLSCREEN or
                WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS
            )
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) {
            setShowWhenLocked(true)
            setTurnScreenOn(true)
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            window.setDecorFitsSystemWindows(false)
        } else {
            @Suppress("DEPRECATION")
            window.decorView.systemUiVisibility = (
                View.SYSTEM_UI_FLAG_LAYOUT_STABLE or
                View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION or
                View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN or
                View.SYSTEM_UI_FLAG_HIDE_NAVIGATION or
                View.SYSTEM_UI_FLAG_FULLSCREEN or
                View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
            )
        }
    }

    // ─── UI construction ──────────────────────────────────────────────────────

    private fun buildUI() {
        val root = FrameLayout(this).apply {
            layoutParams = FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT,
                FrameLayout.LayoutParams.MATCH_PARENT
            )
            setBackgroundColor(Color.parseColor("#0A0A0F"))
        }

        // Optional wallpaper at reduced opacity
        val wallpaperPath = prefs.getString("block_overlay_wallpaper", "") ?: ""
        if (wallpaperPath.isNotEmpty()) {
            val file = File(wallpaperPath)
            if (file.exists()) {
                try {
                    val bmp = BitmapFactory.decodeFile(wallpaperPath)
                    if (bmp != null) {
                        root.addView(ImageView(this).apply {
                            layoutParams = FrameLayout.LayoutParams(
                                FrameLayout.LayoutParams.MATCH_PARENT,
                                FrameLayout.LayoutParams.MATCH_PARENT
                            )
                            setImageBitmap(bmp)
                            scaleType = ImageView.ScaleType.CENTER_CROP
                            alpha = 0.30f
                        })
                    }
                } catch (_: Exception) { }
            }
        }

        // Dark scrim — text always readable
        root.addView(View(this).apply {
            layoutParams = FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT,
                FrameLayout.LayoutParams.MATCH_PARENT
            )
            setBackgroundColor(Color.parseColor("#CC0A0A0F"))
        })

        // Centered content column
        val col = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            layoutParams = FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT,
                FrameLayout.LayoutParams.MATCH_PARENT
            )
            gravity = Gravity.CENTER
            setPadding(dp(32), dp(80), dp(32), dp(80))
        }
        col.addView(buildLockEmoji())
        col.addView(buildBlockedLabel())
        col.addView(buildQuoteView())
        col.addView(buildSubLabel())
        root.addView(col)

        // ✕ button — top-right corner, starts invisible
        xButton = buildXButton()
        root.addView(xButton)

        setContentView(root)
    }

    private fun buildLockEmoji(): TextView = TextView(this).apply {
        text = "\uD83D\uDD12"
        textSize = 52f
        gravity = Gravity.CENTER
        layoutParams = LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT,
            LinearLayout.LayoutParams.WRAP_CONTENT
        ).apply { bottomMargin = dp(20) }
    }

    private fun buildBlockedLabel(): TextView = TextView(this).apply {
        text = if (blockedName.isNotEmpty()) "\u201C$blockedName\u201D is blocked" else "App Blocked"
        textSize = 15f
        setTextColor(Color.parseColor("#FF6B6B"))
        gravity = Gravity.CENTER
        letterSpacing = 0.12f
        layoutParams = LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT,
            LinearLayout.LayoutParams.WRAP_CONTENT
        ).apply { bottomMargin = dp(36) }
    }

    private fun buildQuoteView(): TextView = TextView(this).apply {
        text = "\u201C${resolveQuote()}\u201D"
        textSize = 20f
        setTextColor(Color.parseColor("#E8E8F0"))
        gravity = Gravity.CENTER
        lineSpacingMultiplier = 1.55f
        layoutParams = LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT,
            LinearLayout.LayoutParams.WRAP_CONTENT
        ).apply { bottomMargin = dp(48) }
    }

    private fun buildSubLabel(): TextView = TextView(this).apply {
        text = "Stay focused. You\u2019ve got this."
        textSize = 13f
        setTextColor(Color.parseColor("#55556A"))
        gravity = Gravity.CENTER
        layoutParams = LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT,
            LinearLayout.LayoutParams.WRAP_CONTENT
        )
    }

    /**
     * Corner ✕ button — initially invisible (alpha = 0, not clickable).
     * Positioned in the top-right corner via FrameLayout gravity.
     * Fades in and becomes clickable when [revealXButton] is called.
     */
    private fun buildXButton(): TextView = TextView(this).apply {
        text = "\u2715"    // ✕
        textSize = 20f
        setTextColor(Color.parseColor("#AAAACC"))
        gravity = Gravity.CENTER
        setPadding(dp(16), dp(16), dp(16), dp(16))
        background = GradientDrawable().apply {
            shape = GradientDrawable.OVAL
            setColor(Color.parseColor("#22222E"))
            setStroke(dp(1), Color.parseColor("#44445A"))
        }
        alpha = 0f
        isClickable = false
        isFocusable = false

        val size = dp(48)
        layoutParams = FrameLayout.LayoutParams(size, size).apply {
            gravity = Gravity.TOP or Gravity.END
            topMargin  = dp(56)
            rightMargin = dp(24)
        }
        setOnClickListener { dismissOverlay() }
    }

    // ─── X button reveal ──────────────────────────────────────────────────────

    private fun revealXButton() {
        if (xButtonRevealed) return
        xButtonRevealed = true

        // Clear the flag so the next overlay doesn't skip the wait
        prefs.edit().putBoolean(PREF_OVERLAY_X_READY, false).apply()

        xButton.isClickable = true
        xButton.isFocusable = true

        ValueAnimator.ofFloat(0f, 1f).apply {
            duration = 400L
            addUpdateListener { xButton.alpha = it.animatedValue as Float }
            start()
        }
    }

    // ─── Dismissal ────────────────────────────────────────────────────────────

    private fun dismissOverlay() {
        intentionalFinish = true
        prefs.edit().putBoolean(PREF_OVERLAY_X_READY, false).apply()
        finish()
    }

    // ─── Quote resolution ─────────────────────────────────────────────────────

    private fun resolveQuote(): String {
        val fixed = prefs.getString("block_overlay_quote", "") ?: ""
        if (fixed.isNotEmpty()) return fixed

        val customJson = prefs.getString("block_overlay_quotes", "") ?: ""
        val pool: List<String> = if (customJson.isNotEmpty()) {
            try {
                val arr = JSONArray(customJson)
                (0 until arr.length()).map { arr.getString(it) }.takeIf { it.isNotEmpty() }
                    ?: DEFAULT_QUOTES
            } catch (_: Exception) { DEFAULT_QUOTES }
        } else DEFAULT_QUOTES

        return pool.random()
    }

    // ─── Helpers ──────────────────────────────────────────────────────────────

    private fun dp(value: Int): Int =
        (value * resources.displayMetrics.density + 0.5f).toInt()
}
