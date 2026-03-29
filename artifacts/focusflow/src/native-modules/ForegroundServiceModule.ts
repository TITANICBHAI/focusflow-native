/**
 * Android Foreground Service Module
 *
 * A foreground service runs even when the app is backgrounded or the screen is off.
 * It shows a PERSISTENT notification (cannot be swiped away) with:
 *   - Current task name + time remaining
 *   - Next task name
 *   - Action buttons (Done, Extend)
 *
 * The service also:
 *   - Survives Doze mode (uses setExactAndAllowWhileIdle internally)
 *   - Restarts automatically if killed (START_STICKY)
 *   - Registers a BOOT_COMPLETED receiver to re-launch after device restart
 *
 * ─── Android Implementation ──────────────────────────────────────────────────
 * File: android-native/app/src/main/java/com/tbtechs/focusday/services/ForegroundTaskService.kt
 *
 * Manifest additions (handled automatically by withFocusDayAndroid plugin):
 *   <uses-permission android:name="android.permission.FOREGROUND_SERVICE" />
 *   <uses-permission android:name="android.permission.FOREGROUND_SERVICE_SPECIAL_USE" />
 *   <uses-permission android:name="android.permission.RECEIVE_BOOT_COMPLETED" />
 *   <uses-permission android:name="android.permission.REQUEST_IGNORE_BATTERY_OPTIMIZATIONS" />
 *
 *   <service android:name=".services.ForegroundTaskService"
 *            android:foregroundServiceType="specialUse"
 *            android:exported="false" />
 *
 *   <receiver android:name=".services.BootReceiver" android:exported="true">
 *     <intent-filter>
 *       <action android:name="android.intent.action.BOOT_COMPLETED" />
 *     </intent-filter>
 *   </receiver>
 */

import { NativeModules } from 'react-native';

const { ForegroundService } = NativeModules;

export const ForegroundServiceModule = {
  async startService(taskName: string, endTimeMs: number, nextTaskName: string): Promise<void> {
    if (!ForegroundService) {
      console.warn('[ForegroundService] Native module not linked. Run EAS build.');
      return;
    }
    return ForegroundService.startService(taskName, endTimeMs, nextTaskName);
  },

  async stopService(): Promise<void> {
    if (!ForegroundService) return;
    return ForegroundService.stopService();
  },

  async updateNotification(taskName: string, endTimeMs: number, nextTaskName: string): Promise<void> {
    if (!ForegroundService) return;
    return ForegroundService.updateNotification(taskName, endTimeMs, nextTaskName);
  },

  async requestBatteryOptimizationExemption(): Promise<void> {
    if (!ForegroundService) return;
    return ForegroundService.requestBatteryOptimizationExemption();
  },
};
