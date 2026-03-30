/**
 * Android UsageStats Native Module
 *
 * Required permission: android.permission.PACKAGE_USAGE_STATS
 * User must manually grant in: Settings → Apps → Special app access → Usage access
 *
 * ─── Kotlin Implementation ────────────────────────────────────────────────────
 * File: android-native/app/src/main/java/com/tbtechs/focusday/modules/UsageStatsModule.kt
 *
 * Exposes these methods to JS:
 *   - getForegroundApp(): String? — returns package name of foreground app
 *   - hasPermission(): Boolean    — checks if PACKAGE_USAGE_STATS is granted (Usage Access)
 *   - openUsageAccessSettings()  — opens the Usage Access settings page
 *   - hasAccessibilityPermission(): Boolean — checks if our AccessibilityService is enabled
 *   - isIgnoringBatteryOptimizations(): Boolean — checks battery optimization exemption
 */

import { NativeModules } from 'react-native';

const { UsageStats } = NativeModules;

export const UsageStatsModule = {
  async getForegroundApp(): Promise<string | null> {
    if (!UsageStats) {
      console.warn('[UsageStatsModule] Native module not linked. Run EAS build.');
      return null;
    }
    return UsageStats.getForegroundApp();
  },

  async hasPermission(): Promise<boolean> {
    if (!UsageStats) return false;
    return UsageStats.hasPermission();
  },

  async openUsageAccessSettings(): Promise<void> {
    if (!UsageStats) return;
    return UsageStats.openUsageAccessSettings();
  },

  /**
   * Returns true if the AppBlockerAccessibilityService is enabled in system settings.
   * Uses Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES to check the service ID.
   */
  async hasAccessibilityPermission(): Promise<boolean> {
    if (!UsageStats) return false;
    return UsageStats.hasAccessibilityPermission();
  },

  /**
   * Returns true if the app is exempted from battery optimization.
   * Uses PowerManager.isIgnoringBatteryOptimizations() on Android M+.
   */
  async isIgnoringBatteryOptimizations(): Promise<boolean> {
    if (!UsageStats) return false;
    return UsageStats.isIgnoringBatteryOptimizations();
  },

  /**
   * Returns true if the app's Device Admin receiver component is active.
   * Uses DevicePolicyManager.isAdminActive(). Returns false if the receiver
   * component is not declared or not active.
   */
  async isDeviceAdminActive(): Promise<boolean> {
    if (!UsageStats) return false;
    return UsageStats.isDeviceAdminActive();
  },
};
