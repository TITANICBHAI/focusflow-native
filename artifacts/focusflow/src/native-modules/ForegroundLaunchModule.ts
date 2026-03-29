/**
 * Android Foreground Launch Module
 *
 * Brings FocusDay back to the foreground when a blocked app is detected.
 *
 * Required permission: android.permission.SYSTEM_ALERT_WINDOW (draw over other apps)
 *
 * ─── Kotlin Implementation ────────────────────────────────────────────────────
 * File: android-native/app/src/main/java/com/tbtechs/focusday/modules/ForegroundLaunchModule.kt
 *
 * Exposes four methods to JS:
 *   - bringToFront()               — launches main activity over the blocked app
 *   - showOverlay(message: String)  — shows a WindowManager overlay (SYSTEM_ALERT_WINDOW)
 *   - hasOverlayPermission()        — returns true if SYSTEM_ALERT_WINDOW is granted
 *   - requestOverlayPermission()    — opens system settings for the user to grant it
 */

import { NativeModules } from 'react-native';

const { ForegroundLaunch } = NativeModules;

export const ForegroundLaunchModule = {
  async bringToFront(): Promise<void> {
    if (!ForegroundLaunch) {
      console.warn('[ForegroundLaunchModule] Native module not linked. Run EAS build.');
      return;
    }
    return ForegroundLaunch.bringToFront();
  },

  async showOverlay(message: string): Promise<void> {
    if (!ForegroundLaunch) {
      console.warn('[ForegroundLaunchModule] Native module not linked. Run EAS build.');
      return;
    }
    return ForegroundLaunch.showOverlay(message);
  },

  async hasOverlayPermission(): Promise<boolean> {
    if (!ForegroundLaunch) return false;
    return ForegroundLaunch.hasOverlayPermission();
  },

  async requestOverlayPermission(): Promise<void> {
    if (!ForegroundLaunch) {
      console.warn('[ForegroundLaunchModule] Native module not linked. Run EAS build.');
      return;
    }
    return ForegroundLaunch.requestOverlayPermission();
  },
};
