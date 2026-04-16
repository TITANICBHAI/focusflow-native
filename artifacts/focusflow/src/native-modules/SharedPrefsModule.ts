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
import type { DailyAllowanceEntry } from '@/data/types';

const SharedPrefs = Platform.OS === 'android' ? NativeModules.SharedPrefs : null;

if (Platform.OS === 'android' && !SharedPrefs) {
  console.error('[SharedPrefsModule] NativeModules.SharedPrefs not found. Ensure an EAS build is used — Expo Go does not include custom native modules.');
}

export const isSharedPrefsAvailable = Platform.OS === 'android' && SharedPrefs != null;

function hasSharedPrefsMethod(name: string): boolean {
  return !!SharedPrefs && typeof SharedPrefs[name] === 'function';
}

export const SharedPrefsModule = {
  async setFocusActive(active: boolean): Promise<void> {
    if (!hasSharedPrefsMethod('setFocusActive')) return;
    return SharedPrefs.setFocusActive(active);
  },

  async setAllowedPackages(packages: string[]): Promise<void> {
    if (!hasSharedPrefsMethod('setAllowedPackages')) return;
    return SharedPrefs.setAllowedPackages(packages);
  },

  async setActiveTask(taskId: string, name: string, endMs: number, nextName: string | null): Promise<void> {
    if (!hasSharedPrefsMethod('setActiveTask')) return;
    return SharedPrefs.setActiveTask(taskId, name, endMs, nextName ?? null);
  },

  async setStandaloneBlock(active: boolean, packages: string[], untilMs: number): Promise<void> {
    if (!hasSharedPrefsMethod('setStandaloneBlock')) return;
    return SharedPrefs.setStandaloneBlock(active, packages, untilMs);
  },

  /**
   * Writes the rich daily allowance config (DailyAllowanceEntry[]) to SharedPreferences
   * as a JSON string. The AccessibilityService reads this to enforce per-app allowance modes.
   *
   * Replaces the old setDailyAllowancePackages (string[]) method.
   */
  async setDailyAllowanceConfig(entries: DailyAllowanceEntry[]): Promise<void> {
    if (!hasSharedPrefsMethod('setDailyAllowanceConfig')) return;
    return SharedPrefs.setDailyAllowanceConfig(JSON.stringify(entries));
  },

  async resetDailyAllowanceUsage(packageName: string | null): Promise<void> {
    if (!hasSharedPrefsMethod('resetDailyAllowanceUsage')) return;
    return SharedPrefs.resetDailyAllowanceUsage(packageName ?? null);
  },

  async setBlockedWords(words: string[]): Promise<void> {
    if (!hasSharedPrefsMethod('setBlockedWords')) return;
    return SharedPrefs.setBlockedWords(words);
  },

  async putString(key: string, value: string): Promise<void> {
    if (!hasSharedPrefsMethod('putString')) return;
    return SharedPrefs.putString(key, value);
  },
};
