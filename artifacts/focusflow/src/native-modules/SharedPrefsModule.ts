import { NativeModules } from 'react-native';

const { SharedPrefs } = NativeModules;

/**
 * SharedPrefsModule
 *
 * Writes focus-mode state into Android SharedPreferences so:
 *   - AppBlockerAccessibilityService knows which apps to allow even when JS is not running
 *   - BootReceiver can restart the foreground service after a reboot
 */
export const SharedPrefsModule = {
  /**
   * Tell the native layer whether focus mode is active.
   * The AccessibilityService reads this on every window-change event.
   */
  async setFocusActive(active: boolean): Promise<void> {
    if (!SharedPrefs) return;
    return SharedPrefs.setFocusActive(active);
  },

  /**
   * Write the list of ALLOWED Android package names.
   * The AccessibilityService blocks any foreground app NOT in this list.
   * The app's own package is always exempted inside the service automatically.
   *
   * Pass the complete allow-list every call — the service replaces the previous value.
   */
  async setAllowedPackages(packages: string[]): Promise<void> {
    if (!SharedPrefs) return;
    return SharedPrefs.setAllowedPackages(packages);
  },

  /**
   * Persist the active task so BootReceiver can restart the foreground service
   * after the phone is rebooted mid-session.
   *
   * @param name     Task display name
   * @param endMs    Task end time as epoch milliseconds (Date.getTime())
   * @param nextName Name of the next task, or null
   */
  async setActiveTask(name: string, endMs: number, nextName: string | null): Promise<void> {
    if (!SharedPrefs) return;
    return SharedPrefs.setActiveTask(name, endMs, nextName ?? null);
  },
};
