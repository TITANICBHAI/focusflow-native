package com.tbtechs.focusflow.modules

import android.content.Intent
import android.os.Build
import android.os.PowerManager
import android.provider.Settings
import android.net.Uri
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.tbtechs.focusflow.services.ForegroundTaskService

/**
 * ForegroundServiceModule
 *
 * JS name: NativeModules.ForegroundService
 * Methods:
 *   - startIdleService()                           → Promise<null>  — ensure service is running in idle mode
 *   - startService(taskName, endTimeMs, nextName)  → Promise<null>  — start active focus session
 *   - stopService()                                → Promise<null>  — switch to idle (service stays alive)
 *   - updateNotification(taskName, endTimeMs, nextName) → Promise<null>
 *   - requestBatteryOptimizationExemption()        → Promise<null>
 */
class ForegroundServiceModule(private val reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    companion object {
        const val NAME = "ForegroundService"
    }

    override fun getName(): String = NAME

    /**
     * Ensures the foreground service is running in idle mode.
     * Call on app startup to guarantee the persistent notification is always present.
     * Safe to call if the service is already running — it will remain in its current state.
     */
    @ReactMethod
    fun startIdleService(promise: Promise) {
        try {
            // Send a plain intent with no action so the service starts in idle mode.
            // The service's onCreate calls startForeground with the idle notification,
            // and onStartCommand's else branch (no EXTRA_TASK_NAME present) falls
            // through to goIdle() — routing through ACTION_SET_IDLE on first launch
            // would cause a redundant second goIdle() call.
            val intent = Intent(reactContext, ForegroundTaskService::class.java)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                reactContext.startForegroundService(intent)
            } else {
                reactContext.startService(intent)
            }
            promise.resolve(null)
        } catch (e: Exception) {
            promise.reject("SERVICE_IDLE_ERROR", e.message, e)
        }
    }

    /**
     * Starts the foreground task service in ACTIVE mode with countdown and task name.
     *
     * @param taskName  Display name of the active focus task
     * @param endTimeMs Epoch milliseconds when the task ends
     * @param nextName  (nullable) Display name of the next task shown in sub-text
     */
    @ReactMethod
    fun startService(taskId: String, taskName: String, endTimeMs: Double, nextName: String?, promise: Promise) {
        try {
            val intent = Intent(reactContext, ForegroundTaskService::class.java).apply {
                putExtra(ForegroundTaskService.EXTRA_TASK_ID,   taskId)
                putExtra(ForegroundTaskService.EXTRA_TASK_NAME, taskName)
                putExtra(ForegroundTaskService.EXTRA_END_MS,    endTimeMs.toLong())
                nextName?.let { putExtra(ForegroundTaskService.EXTRA_NEXT_NAME, it) }
            }
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                reactContext.startForegroundService(intent)
            } else {
                reactContext.startService(intent)
            }
            promise.resolve(null)
        } catch (e: Exception) {
            promise.reject("SERVICE_START_ERROR", e.message, e)
        }
    }

    /**
     * Switches the service to idle mode (persistent notification stays, countdown stops).
     * The service is NOT stopped — it stays alive to keep the process running.
     * This preserves the always-on notification and prevents Android from killing the service.
     */
    @ReactMethod
    fun stopService(promise: Promise) {
        try {
            val intent = Intent(reactContext, ForegroundTaskService::class.java).apply {
                action = ForegroundTaskService.ACTION_SET_IDLE
            }
            reactContext.startService(intent)
            promise.resolve(null)
        } catch (e: Exception) {
            promise.reject("SERVICE_STOP_ERROR", e.message, e)
        }
    }

    /**
     * Updates the active focus session notification with new task details.
     * Sends a new start command directly — the service handles it in onStartCommand.
     */
    @ReactMethod
    fun updateNotification(taskId: String, taskName: String, endTimeMs: Double, nextName: String?, promise: Promise) {
        try {
            val intent = Intent(reactContext, ForegroundTaskService::class.java).apply {
                putExtra(ForegroundTaskService.EXTRA_TASK_ID,   taskId)
                putExtra(ForegroundTaskService.EXTRA_TASK_NAME, taskName)
                putExtra(ForegroundTaskService.EXTRA_END_MS,    endTimeMs.toLong())
                nextName?.let { putExtra(ForegroundTaskService.EXTRA_NEXT_NAME, it) }
            }
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                reactContext.startForegroundService(intent)
            } else {
                reactContext.startService(intent)
            }
            promise.resolve(null)
        } catch (e: Exception) {
            promise.reject("UPDATE_ERROR", e.message, e)
        }
    }

    /**
     * Opens the battery optimization exemption screen so Android stops killing the service.
     * Critical on MIUI, ColorOS, Realme UI, and other aggressive OEM skins.
     */
    @ReactMethod
    fun requestBatteryOptimizationExemption(promise: Promise) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M) {
            promise.resolve(null)
            return
        }
        try {
            val pm = reactContext.getSystemService(android.content.Context.POWER_SERVICE) as PowerManager
            if (pm.isIgnoringBatteryOptimizations(reactContext.packageName)) {
                promise.resolve(null)
                return
            }
        } catch (_: Exception) {
            promise.resolve(null)
            return
        }
        val activity = reactContext.currentActivity
        fun launch(intent: Intent): Boolean {
            return try {
                if (activity != null && !activity.isFinishing) {
                    activity.startActivity(intent)
                } else {
                    reactContext.startActivity(intent.apply { flags = Intent.FLAG_ACTIVITY_NEW_TASK })
                }
                true
            } catch (_: Exception) {
                false
            }
        }
        val direct = Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS).apply {
            data = Uri.parse("package:${reactContext.packageName}")
            flags = Intent.FLAG_ACTIVITY_NEW_TASK
        }
        if (launch(direct)) { promise.resolve(null); return }
        val list = Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS).apply {
            flags = Intent.FLAG_ACTIVITY_NEW_TASK
        }
        if (launch(list)) { promise.resolve(null); return }
        val settings = Intent(Settings.ACTION_SETTINGS).apply {
            flags = Intent.FLAG_ACTIVITY_NEW_TASK
        }
        launch(settings)
        promise.resolve(null)
    }
}
