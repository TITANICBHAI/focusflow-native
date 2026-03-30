/**
 * Android UsageStats Native Module
 *
 * Required permission: android.permission.PACKAGE_USAGE_STATS
 * User must manually grant in: Settings → Apps → Special app access → Usage access
 *
 * ─── Kotlin Implementation ────────────────────────────────────────────────────
 * File: android-native/app/src/main/java/com/tbtechs/focusflow/modules/UsageStatsModule.kt
 *
 * Exposes these methods to JS:
 *   - getForegroundApp(): String? — returns package name of foreground app
 *   - hasPermission(): Boolean    — checks if PACKAGE_USAGE_STATS is granted (Usage Access)
 *   - openUsageAccessSettings()  — opens the Usage Access settings page
 *   - hasAccessibilityPermission(): Boolean — checks if our AccessibilityService is enabled
 *   - isIgnoringBatteryOptimizations(): Boolean — checks battery optimization exemption
 *   - openBatteryOptimizationSettings() — opens battery exemption dialog (needs package: URI, must be done in Kotlin)
 *   - isDeviceAdminActive(): Boolean — checks if Device Admin receiver is active
 *   - openDeviceAdminSettings() — opens Device Admin activation dialog
 */

import { TurboModuleRegistry, TurboModule } from 'react-native';

interface UsageStatsSpec extends TurboModule {
  getForegroundApp(): Promise<string | null>;
  hasPermission(): Promise<boolean>;
  openUsageAccessSettings(): Promise<void>;
  hasAccessibilityPermission(): Promise<boolean>;
  openAccessibilitySettings(): Promise<void>;
  isIgnoringBatteryOptimizations(): Promise<boolean>;
  openBatteryOptimizationSettings(): Promise<void>;
  isDeviceAdminActive(): Promise<boolean>;
  openDeviceAdminSettings(): Promise<void>;
}

const UsageStats = TurboModuleRegistry.get<UsageStatsSpec>('UsageStats');
console.log('[UsageStatsModule] resolved:', !!UsageStats);

export const UsageStatsModule = {
  async getForegroundApp(): Promise<string | null> {
    if (!UsageStats) {
      console.error('[UsageStatsModule] Native module "UsageStats" not found. Ensure FocusDayPackage is registered and an EAS build was used.');
      return null;
    }
    return UsageStats.getForegroundApp();
  },

  async hasPermission(): Promise<boolean> {
    if (!UsageStats) {
      console.error('[UsageStatsModule] Native module "UsageStats" not found. Ensure FocusDayPackage is registered and an EAS build was used.');
      return false;
    }
    return UsageStats.hasPermission();
  },

  async openUsageAccessSettings(): Promise<void> {
    if (!UsageStats) {
      console.error('[UsageStatsModule] Native module "UsageStats" not found. Ensure FocusDayPackage is registered and an EAS build was used.');
      return;
    }
    return UsageStats.openUsageAccessSettings();
  },

  /**
   * Returns true if the AppBlockerAccessibilityService is enabled in system settings.
   * Uses Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES to check the service ID.
   */
  async hasAccessibilityPermission(): Promise<boolean> {
    if (!UsageStats) {
      console.error('[UsageStatsModule] Native module "UsageStats" not found. Ensure FocusDayPackage is registered and an EAS build was used.');
      return false;
    }
    return UsageStats.hasAccessibilityPermission();
  },

  /**
   * Opens the Accessibility Settings screen using a native Kotlin method with OEM
   * fallback chain. Preferred over Linking.sendIntent() which lacks fallbacks for
   * MDM-managed / company phones.
   */
  async openAccessibilitySettings(): Promise<void> {
    if (!UsageStats) {
      console.error('[UsageStatsModule] Native module "UsageStats" not found. Ensure FocusDayPackage is registered and an EAS build was used.');
      return;
    }
    return UsageStats.openAccessibilitySettings();
  },

  /**
   * Returns true if the app is exempted from battery optimization.
   * Uses PowerManager.isIgnoringBatteryOptimizations() on Android M+.
   */
  async isIgnoringBatteryOptimizations(): Promise<boolean> {
    if (!UsageStats) {
      console.error('[UsageStatsModule] Native module "UsageStats" not found. Ensure FocusDayPackage is registered and an EAS build was used.');
      return false;
    }
    return UsageStats.isIgnoringBatteryOptimizations();
  },

  /**
   * Opens the battery optimization exemption dialog directly for this app.
   * Must be done in Kotlin because ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS
   * requires a "package:<name>" data URI that cannot be set via Linking.sendIntent().
   * Samsung One UI may block the direct dialog and will fall back to the list screen.
   */
  async openBatteryOptimizationSettings(): Promise<void> {
    if (!UsageStats) {
      console.error('[UsageStatsModule] Native module "UsageStats" not found. Ensure FocusDayPackage is registered and an EAS build was used.');
      return;
    }
    return UsageStats.openBatteryOptimizationSettings();
  },

  /**
   * Returns true if the app's Device Admin receiver component is active.
   * Uses DevicePolicyManager.isAdminActive(). Returns false if the receiver
   * component is not declared or not active.
   */
  async isDeviceAdminActive(): Promise<boolean> {
    if (!UsageStats) {
      console.error('[UsageStatsModule] Native module "UsageStats" not found. Ensure FocusDayPackage is registered and an EAS build was used.');
      return false;
    }
    return UsageStats.isDeviceAdminActive();
  },

  /**
   * Opens the Device Admin activation dialog for FocusDayDeviceAdminReceiver.
   * Falls back to Security Settings if the receiver is not registered.
   */
  async openDeviceAdminSettings(): Promise<void> {
    if (!UsageStats) {
      console.error('[UsageStatsModule] Native module "UsageStats" not found. Ensure FocusDayPackage is registered and an EAS build was used.');
      return;
    }
    return UsageStats.openDeviceAdminSettings();
  },
};
