/**
 * SessionPinModule — Old Architecture (NativeModules bridge)
 *
 * Manages a session PIN that gates all session-ending native calls.
 * The raw PIN is NEVER sent to native — only its SHA-256 hex digest is used.
 *
 * When a PIN is set, these native methods require a matching hash:
 *   - SharedPrefsModule.setFocusActive(false, pinHash)
 *   - ForegroundServiceModule.stopService(pinHash)
 *   - NetworkBlockModule.stopNetworkBlock(pinHash)
 *
 * Usage pattern (JS layer):
 *   import { sha256 } from 'your-crypto-lib';
 *   const hash = sha256(userPin);
 *   await SessionPinModule.setPinHash(hash);
 *   // Later, to end session:
 *   const hash = sha256(userEnteredPin);
 *   const ok = await SessionPinModule.verifyPin(hash);
 *   if (ok) await ForegroundServiceModule.stopService(hash);
 *
 * Kotlin: android-native/app/.../modules/SessionPinModule.kt
 * Registered via: FocusDayPackage → createNativeModules()
 */

import { NativeModules, Platform } from 'react-native';

const SessionPin = Platform.OS === 'android' ? NativeModules.SessionPin : null;

if (Platform.OS === 'android' && !SessionPin) {
  console.warn('[SessionPinModule] NativeModules.SessionPin not found. Session PIN protection is unavailable.');
}

export const SessionPinModule = {
  /**
   * Stores a new session PIN as its SHA-256 hex digest.
   * Pass the hex of the user's PIN, not the raw PIN string.
   */
  async setPinHash(sha256hex: string): Promise<void> {
    if (!SessionPin) return;
    return SessionPin.setPinHash(sha256hex);
  },

  /**
   * Removes the stored PIN. Requires the current PIN hash to succeed —
   * prevents a JS bridge compromise from clearing the PIN without knowing it.
   */
  async clearPin(currentSha256hex: string): Promise<void> {
    if (!SessionPin) return;
    return SessionPin.clearPin(currentSha256hex);
  },

  /**
   * Returns true if the supplied hash matches the stored PIN.
   * Returns true if no PIN is set (i.e. everything is permitted).
   */
  async verifyPin(sha256hex: string): Promise<boolean> {
    if (!SessionPin) return true;
    return SessionPin.verifyPin(sha256hex);
  },

  /**
   * Returns true if a PIN has been configured.
   */
  async isPinSet(): Promise<boolean> {
    if (!SessionPin) return false;
    return SessionPin.isPinSet();
  },
};
