/**
 * SharedPrefsModule — Old Architecture (NativeModules bridge)
 *
 * Writes focus-mode and standalone-block state into Android SharedPreferences so:
 *   - AppBlockerAccessibilityService knows which apps to block even when JS is not running
 *   - BootReceiver can restore the foreground service state after device reboot
 *
 * Kotlin: android-native/app/.../modules/SharedPrefsModule.kt
 * Registered via: FocusDayPackage → createNativeModules()
 */

import { NativeModules, Platform } from 'react-native';

const SharedPrefs = Platform.OS === 'android' ? NativeModules.SharedPrefs : null;

if (Platform.OS === 'android' && !SharedPrefs) {
  console.error('[SharedPrefsModule] NativeModules.SharedPrefs not found. Ensure an EAS build is used — Expo Go does not include custom native modules.');
}

export const SharedPrefsModule = {
  async setFocusActive(active: boolean): Promise<void> {
    if (!SharedPrefs) return;
    return SharedPrefs.setFocusActive(active);
  },

  async setAllowedPackages(packages: string[]): Promise<void> {
    if (!SharedPrefs) return;
    return SharedPrefs.setAllowedPackages(packages);
  },

  async setActiveTask(taskId: string, name: string, endMs: number, nextName: string | null): Promise<void> {
    if (!SharedPrefs) return;
    return SharedPrefs.setActiveTask(taskId, name, endMs, nextName ?? null);
  },

  async setStandaloneBlock(active: boolean, packages: string[], untilMs: number): Promise<void> {
    if (!SharedPrefs) return;
    return SharedPrefs.setStandaloneBlock(active, packages, untilMs);
  },

  async setDailyAllowancePackages(packages: string[]): Promise<void> {
    if (!SharedPrefs) return;
    return SharedPrefs.setDailyAllowancePackages(packages);
  },

  async resetDailyAllowanceUsage(packageName: string | null): Promise<void> {
    if (!SharedPrefs) return;
    return SharedPrefs.resetDailyAllowanceUsage(packageName ?? null);
  },
};
