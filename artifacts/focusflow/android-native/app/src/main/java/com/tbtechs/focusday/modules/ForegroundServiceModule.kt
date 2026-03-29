package com.tbtechs.focusday.modules

import android.content.Intent
import android.os.Build
import android.os.PowerManager
import android.provider.Settings
import android.net.Uri
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.tbtechs.focusday.services.ForegroundTaskService

/**
 * ForegroundServiceModule
 *
 * JS name: NativeModules.ForegroundService
 * Methods:
 *   - startService(taskName, endTimeMs, nextName)  → Promise<null>
 *   - stopService()                                → Promise<null>
 *   - updateNotification(taskName, endTimeMs, nextName) → Promise<null>
 *   - requestBatteryOptimizationExemption()        → Promise<null>
 */
class ForegroundServiceModule(private val reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    override fun getName(): String = "ForegroundService"

    /**
     * Starts the foreground task service.
     *
     * @param taskName  Display name of the active focus task
     * @param endTimeMs Epoch milliseconds when the task ends
     * @param nextName  (nullable) Display name of the next task shown in sub-text
     */
    @ReactMethod
    fun startService(taskName: String, endTimeMs: Double, nextName: String?, promise: Promise) {
        try {
            val intent = Intent(reactContext, ForegroundTaskService::class.java).apply {
                putExtra(ForegroundTaskService.EXTRA_TASK_NAME, taskName)
                putExtra(ForegroundTaskService.EXTRA_END_MS, endTimeMs.toLong())
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
     * Stops the foreground task service by sending it the STOP action.
     */
    @ReactMethod
    fun stopService(promise: Promise) {
        try {
            val intent = Intent(reactContext, ForegroundTaskService::class.java).apply {
                action = ForegroundTaskService.ACTION_STOP
            }
            reactContext.startService(intent)
            promise.resolve(null)
        } catch (e: Exception) {
            promise.reject("SERVICE_STOP_ERROR", e.message, e)
        }
    }

    /**
     * Updates the notification in a running service without restarting it.
     * Internally: stops and restarts with new extras. The service tick counter resets,
     * but since we always use an absolute endTimeMs the countdown remains accurate.
     */
    @ReactMethod
    fun updateNotification(taskName: String, endTimeMs: Double, nextName: String?, promise: Promise) {
        stopService(object : Promise {
            override fun resolve(value: Any?) {
                startService(taskName, endTimeMs, nextName, promise)
            }
            override fun reject(code: String?, message: String?) = promise.reject(code, message)
            override fun reject(code: String?, throwable: Throwable?) = promise.reject(code, throwable)
            override fun reject(code: String?, message: String?, throwable: Throwable?) = promise.reject(code, message, throwable)
            override fun reject(throwable: Throwable?) = promise.reject(throwable)
            override fun reject(throwable: Throwable?, userInfo: com.facebook.react.bridge.WritableMap?) = promise.reject(throwable, userInfo)
            override fun reject(code: String?, userInfo: com.facebook.react.bridge.WritableMap) = promise.reject(code, userInfo)
            override fun reject(code: String?, message: String?, userInfo: com.facebook.react.bridge.WritableMap) = promise.reject(code, message, userInfo)
            override fun reject(code: String?, throwable: Throwable?, userInfo: com.facebook.react.bridge.WritableMap) = promise.reject(code, throwable, userInfo)
            override fun reject(code: String?, message: String?, throwable: Throwable?, userInfo: com.facebook.react.bridge.WritableMap) = promise.reject(code, message, throwable, userInfo)
            override fun reject(message: String?) = promise.reject(message)
        })
    }

    /**
     * Opens the battery optimization exemption screen so Android stops killing the service.
     * This is critical on MIUI, ColorOS, Realme UI, and other aggressive OEM skins.
     */
    @ReactMethod
    fun requestBatteryOptimizationExemption(promise: Promise) {
        try {
            val pm = reactContext.getSystemService(android.content.Context.POWER_SERVICE) as PowerManager
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M &&
                !pm.isIgnoringBatteryOptimizations(reactContext.packageName)) {
                val intent = Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS).apply {
                    data = Uri.parse("package:${reactContext.packageName}")
                    flags = Intent.FLAG_ACTIVITY_NEW_TASK
                }
                reactContext.startActivity(intent)
            }
            promise.resolve(null)
        } catch (e: Exception) {
            promise.reject("BATTERY_ERROR", e.message, e)
        }
    }
}
