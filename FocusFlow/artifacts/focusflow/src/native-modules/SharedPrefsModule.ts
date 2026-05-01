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
import type { DailyAllowanceEntry, CustomNodeRule } from '@/data/types';

const SharedPrefs = Platform.OS === 'android' ? NativeModules.SharedPrefs : null;

if (Platform.OS === 'android' && !SharedPrefs) {
  console.error('[SharedPrefsModule] NativeModules.SharedPrefs not found. Ensure an EAS build is used — Expo Go does not include custom native modules.');
}

export const isSharedPrefsAvailable = Platform.OS === 'android' && SharedPrefs != null;

function hasSharedPrefsMethod(name: string): boolean {
  return !!SharedPrefs && typeof SharedPrefs[name] === 'function';
}

export const SharedPrefsModule = {
  /**
   * Tells native whether task focus is active.
   * When deactivating (active=false) and a session PIN is configured, pinHash
   * must be the SHA-256 hex digest of the PIN — otherwise the call is rejected.
   */
  async setFocusActive(active: boolean, pinHash: string | null = null): Promise<void> {
    if (!hasSharedPrefsMethod('setFocusActive')) return;
    return SharedPrefs.setFocusActive(active, pinHash);
  },

  async setAllowedPackages(packages: string[]): Promise<void> {
    if (!hasSharedPrefsMethod('setAllowedPackages')) return;
    return SharedPrefs.setAllowedPackages(packages);
  },

  async setActiveTask(taskId: string, name: string, endMs: number, nextName: string | null): Promise<void> {
    if (!hasSharedPrefsMethod('setActiveTask')) return;
    return SharedPrefs.setActiveTask(taskId, name, endMs, nextName ?? null);
  },

  /**
   * Writes the active task's accent color (hex string, e.g. "#6366f1") so the
   * widget can tint its header / sub-line. Pass an empty string to clear.
   * Triggers a widget redraw on the native side.
   */
  async setActiveTaskColor(colorHex: string): Promise<void> {
    if (!hasSharedPrefsMethod('setActiveTaskColor')) return;
    return SharedPrefs.setActiveTaskColor(colorHex ?? '');
  },

  /**
   * Persists the wall-clock start time of the active task so the widget can
   * draw a progress bar even when the session was not started by the focus
   * service. Idempotent — only writes when task identity changes.
   * Pass 0 / negative to clear.
   */
  async setActiveTaskStartMs(taskId: string, startMs: number): Promise<void> {
    if (!hasSharedPrefsMethod('setActiveTaskStartMs')) return;
    return SharedPrefs.setActiveTaskStartMs(taskId, startMs);
  },

  /**
   * Clears the active-task fields in SharedPreferences (without touching focus
   * or block state) and pushes a widget redraw.
   */
  async clearActiveTask(): Promise<void> {
    if (!hasSharedPrefsMethod('clearActiveTask')) return;
    return SharedPrefs.clearActiveTask();
  },

  /**
   * Forces a redraw of any home-screen widgets using whatever is currently in
   * SharedPreferences. Use after standalone-block / task state changes that
   * happen outside a focus session (where ForegroundTaskService would have
   * pushed automatically).
   */
  async pushWidgetUpdate(): Promise<void> {
    if (!hasSharedPrefsMethod('pushWidgetUpdate')) return;
    return SharedPrefs.pushWidgetUpdate();
  },

  async setStandaloneBlock(active: boolean, packages: string[], untilMs: number): Promise<void> {
    if (!hasSharedPrefsMethod('setStandaloneBlock')) return;
    return SharedPrefs.setStandaloneBlock(active, packages, untilMs);
  },

  /**
   * Enables or disables always-on block enforcement, independent of any timed session.
   *
   * When active=true, the AccessibilityService enforces the provided package list
   * and all configured daily allowance rules even when no focus task or standalone
   * block timer is running.  The UI "locked" state is NOT affected — settings can
   * still be changed when no timed session is active.
   *
   * @param active    Whether always-on enforcement is enabled
   * @param packages  Package names to always block (empty list = only allowance enforced)
   */
  async setAlwaysBlockActive(active: boolean, packages: string[]): Promise<void> {
    if (!hasSharedPrefsMethod('setAlwaysBlockActive')) return;
    return SharedPrefs.setAlwaysBlockActive(active, packages);
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

  async setSystemGuardEnabled(enabled: boolean): Promise<void> {
    if (!hasSharedPrefsMethod('setSystemGuardEnabled')) return;
    return SharedPrefs.setSystemGuardEnabled(enabled);
  },

  async setBlockInstallActionsEnabled(enabled: boolean): Promise<void> {
    if (!hasSharedPrefsMethod('setBlockInstallActionsEnabled')) return;
    return SharedPrefs.setBlockInstallActionsEnabled(enabled);
  },

  async setBlockYoutubeShortsEnabled(enabled: boolean): Promise<void> {
    if (!hasSharedPrefsMethod('setBlockYoutubeShortsEnabled')) return;
    return SharedPrefs.setBlockYoutubeShortsEnabled(enabled);
  },

  async setBlockInstagramReelsEnabled(enabled: boolean): Promise<void> {
    if (!hasSharedPrefsMethod('setBlockInstagramReelsEnabled')) return;
    return SharedPrefs.setBlockInstagramReelsEnabled(enabled);
  },

  async putString(key: string, value: string): Promise<void> {
    if (!hasSharedPrefsMethod('putString')) return;
    return SharedPrefs.putString(key, value);
  },

  /**
   * Reads a string value from SharedPreferences by key.
   * Returns null if the key is absent or the native module is unavailable.
   * Used by AppContext to cross-check critical flags (e.g. privacy_accepted)
   * that are backed up in SharedPreferences in case the SQLite DB is wiped.
   */
  async getString(key: string): Promise<string | null> {
    if (!hasSharedPrefsMethod('getString')) return null;
    return SharedPrefs.getString(key);
  },

  /**
   * Writes the custom node rules (imported from NodeSpy NodeSpyCaptureV1 exports)
   * to SharedPreferences as a JSON string.
   * The AccessibilityService reads this to enforce per-node blocking rules.
   *
   * Only enabled rules are passed — disabled rules are filtered out client-side
   * before calling this method to keep the native scan loop fast.
   */
  async setCustomNodeRules(rules: CustomNodeRule[]): Promise<void> {
    if (!hasSharedPrefsMethod('setCustomNodeRules')) return;
    const enabledRules = rules.filter(r => r.enabled);
    return SharedPrefs.setCustomNodeRules(JSON.stringify(enabledRules));
  },

  /**
   * Returns true when the installed APK was built debuggable (debug variant).
   * Falls back to JS `__DEV__` when the native bridge is unavailable (Expo Go,
   * iOS, web). Use this to gate developer-only UI like the Diagnostics screen
   * — `__DEV__` alone is false in debug-built APKs that run their prebundled
   * JS, which would hide the screen exactly when it's needed.
   */
  async isDebuggableBuild(): Promise<boolean> {
    if (!hasSharedPrefsMethod('isDebuggable')) return __DEV__;
    try {
      return Boolean(await SharedPrefs.isDebuggable());
    } catch {
      return __DEV__;
    }
  },

  /**
   * Pushes today's progress snapshot (tasks done/total, focus minutes, streak)
   * into SharedPreferences so the home-screen widget can show motivational
   * context (e.g. "3/5 tasks · 45m today" with a streak chip) when no task
   * is active. Triggers a widget redraw on the native side.
   */
  async setDailyStats(
    tasksDone: number,
    tasksTotal: number,
    focusMins: number,
    streakDays: number,
  ): Promise<void> {
    if (!hasSharedPrefsMethod('setDailyStats')) return;
    return SharedPrefs.setDailyStats(
      Math.max(0, Math.floor(tasksDone)),
      Math.max(0, Math.floor(tasksTotal)),
      Math.max(0, Math.floor(focusMins)),
      Math.max(0, Math.floor(streakDays)),
    );
  },
};
