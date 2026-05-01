package com.tbtechs.nodespy

import android.Manifest
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.provider.Settings
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.contract.ActivityResultContracts
import com.tbtechs.nodespy.data.CaptureStore
import com.tbtechs.nodespy.service.FloatingBubbleService
import com.tbtechs.nodespy.ui.NodeSpyApp
import com.tbtechs.nodespy.ui.theme.NodeSpyTheme

class MainActivity : ComponentActivity() {

    companion object {
        const val ACTION_OPEN_CAPTURE = "com.tbtechs.nodespy.OPEN_CAPTURE"
        const val EXTRA_CAPTURE_ID = "capture_id"
        private const val PREFS_NAME = "nodespy_prefs"
        private const val KEY_WIZARD_SEEN = "wizard_seen"
    }

    private var pendingCaptureId: String? = null

    private val notifPermLauncher = registerForActivityResult(
        ActivityResultContracts.RequestPermission()
    ) { /* PermissionsScreen refreshes on resume */ }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()

        pendingCaptureId = intent
            ?.takeIf { it.action == ACTION_OPEN_CAPTURE }
            ?.getStringExtra(EXTRA_CAPTURE_ID)

        val prefs = getSharedPreferences(PREFS_NAME, MODE_PRIVATE)
        val showWizard = !prefs.getBoolean(KEY_WIZARD_SEEN, false) && pendingCaptureId == null

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            notifPermLauncher.launch(Manifest.permission.POST_NOTIFICATIONS)
        }

        setContent {
            NodeSpyTheme {
                NodeSpyApp(
                    showWizard = showWizard,
                    initialCaptureId = pendingCaptureId,
                    onLaunchBubble = { launchBubble() },
                    onWizardDone = {
                        prefs.edit().putBoolean(KEY_WIZARD_SEEN, true).apply()
                    }
                )
            }
        }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        if (intent.action == ACTION_OPEN_CAPTURE) {
            val id = intent.getStringExtra(EXTRA_CAPTURE_ID) ?: return
            CaptureStore.emitOpenCapture(id)
        }
    }

    private fun launchBubble() {
        if (!Settings.canDrawOverlays(this)) {
            startActivity(
                Intent(
                    Settings.ACTION_MANAGE_OVERLAY_PERMISSION,
                    Uri.parse("package:$packageName")
                )
            )
        } else {
            startService(Intent(this, FloatingBubbleService::class.java))
        }
    }
}
