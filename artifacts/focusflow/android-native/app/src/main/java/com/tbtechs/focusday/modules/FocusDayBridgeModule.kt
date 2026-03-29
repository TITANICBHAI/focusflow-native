package com.tbtechs.focusday.modules

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.os.Build
import com.facebook.react.bridge.*
import com.facebook.react.modules.core.DeviceEventManagerModule
import com.tbtechs.focusday.services.ForegroundTaskService

/**
 * FocusDayBridgeModule
 *
 * JS name: NativeModules.FocusDayBridge  (also used as an event emitter)
 *
 * This module:
 *  1. Forwards "FocusDayEvent" events from Android (broadcasts, service callbacks)
 *     to the React Native JS event bus.
 *  2. Listens for the TASK_ENDED broadcast fired by ForegroundTaskService and
 *     fires a "FocusDayEvent" of type "TASK_ENDED" to JS.
 *  3. Listens for the APP_BLOCKED broadcast fired by AppBlockerAccessibilityService
 *     and fires a "FocusDayEvent" of type "APP_BLOCKED" with the blocked package.
 *
 * JS usage:
 *   import { NativeEventEmitter, NativeModules } from 'react-native';
 *   const emitter = new NativeEventEmitter(NativeModules.FocusDayBridge);
 *   emitter.addListener('FocusDayEvent', (e) => console.log(e.type, e.payload));
 */
class FocusDayBridgeModule(private val reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext), LifecycleEventListener {

    companion object {
        const val JS_EVENT_NAME = "FocusDayEvent"
        const val ACTION_APP_BLOCKED = "com.tbtechs.focusday.APP_BLOCKED"
        const val EXTRA_BLOCKED_PKG  = "blockedPackage"
    }

    private var listenerCount = 0

    private val taskEndedReceiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context, intent: Intent) {
            sendEvent("TASK_ENDED", null)
        }
    }

    private val appBlockedReceiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context, intent: Intent) {
            val pkg = intent.getStringExtra(EXTRA_BLOCKED_PKG) ?: return
            sendEvent("APP_BLOCKED", pkg)
        }
    }

    override fun getName(): String = "FocusDayBridge"

    override fun initialize() {
        super.initialize()
        reactContext.addLifecycleEventListener(this)
        registerReceivers()
    }

    override fun invalidate() {
        reactContext.removeLifecycleEventListener(this)
        try {
            reactContext.unregisterReceiver(taskEndedReceiver)
            reactContext.unregisterReceiver(appBlockedReceiver)
        } catch (_: Exception) {}
        super.invalidate()
    }

    // ─── Listener count tracking (required for NativeEventEmitter on Android) ──

    @ReactMethod
    fun addListener(eventName: String) {
        listenerCount++
    }

    @ReactMethod
    fun removeListeners(count: Int) {
        listenerCount = maxOf(0, listenerCount - count)
    }

    // ─── Lifecycle ────────────────────────────────────────────────────────────

    override fun onHostResume() {}
    override fun onHostPause() {}
    override fun onHostDestroy() {}

    // ─── Private ─────────────────────────────────────────────────────────────

    private fun registerReceivers() {
        val taskEndedFilter = IntentFilter(ForegroundTaskService.ACTION_TASK_ENDED)
        val appBlockedFilter = IntentFilter(ACTION_APP_BLOCKED)

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            reactContext.registerReceiver(taskEndedReceiver, taskEndedFilter, Context.RECEIVER_NOT_EXPORTED)
            reactContext.registerReceiver(appBlockedReceiver, appBlockedFilter, Context.RECEIVER_NOT_EXPORTED)
        } else {
            reactContext.registerReceiver(taskEndedReceiver, taskEndedFilter)
            reactContext.registerReceiver(appBlockedReceiver, appBlockedFilter)
        }
    }

    private fun sendEvent(type: String, payload: String?) {
        if (!reactContext.hasActiveReactInstance()) return
        val params = Arguments.createMap().apply {
            putString("type", type)
            if (payload != null) putString("payload", payload) else putNull("payload")
        }
        reactContext
            .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
            .emit(JS_EVENT_NAME, params)
    }
}
