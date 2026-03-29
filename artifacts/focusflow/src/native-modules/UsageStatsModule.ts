/**
 * Android UsageStats Native Module
 *
 * Required permission: android.permission.PACKAGE_USAGE_STATS
 * User must manually grant in: Settings → Apps → Special app access → Usage access
 *
 * ─── Kotlin Implementation ────────────────────────────────────────────────────
 * File: android-native/app/src/main/java/com/tbtechs/focusday/modules/UsageStatsModule.kt
 *
 * Exposes three methods to JS:
 *   - getForegroundApp(): String? — returns package name of foreground app
 *   - hasPermission(): Boolean    — checks if PACKAGE_USAGE_STATS is granted
 *   - openUsageAccessSettings()  — opens the Usage Access settings page
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
};
