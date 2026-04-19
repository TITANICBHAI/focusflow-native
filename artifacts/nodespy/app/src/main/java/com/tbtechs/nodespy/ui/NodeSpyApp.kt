package com.tbtechs.nodespy.ui

import androidx.compose.runtime.Composable
import androidx.navigation.NavType
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.rememberNavController
import androidx.navigation.navArgument
import com.tbtechs.nodespy.ui.screens.CaptureListScreen
import com.tbtechs.nodespy.ui.screens.InspectorScreen

@Composable
fun NodeSpyApp() {
    val nav = rememberNavController()

    NavHost(navController = nav, startDestination = "captures") {
        composable("captures") {
            CaptureListScreen(onOpenCapture = { id -> nav.navigate("inspector/$id") })
        }
        composable(
            "inspector/{captureId}",
            arguments = listOf(navArgument("captureId") { type = NavType.StringType })
        ) { back ->
            val id = back.arguments?.getString("captureId") ?: return@composable
            InspectorScreen(captureId = id, onBack = { nav.popBackStack() })
        }
    }
}
