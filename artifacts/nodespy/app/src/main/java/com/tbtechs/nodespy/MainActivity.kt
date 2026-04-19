package com.tbtechs.nodespy

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import com.tbtechs.nodespy.ui.NodeSpyApp
import com.tbtechs.nodespy.ui.theme.NodeSpyTheme

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        setContent {
            NodeSpyTheme {
                NodeSpyApp()
            }
        }
    }
}
