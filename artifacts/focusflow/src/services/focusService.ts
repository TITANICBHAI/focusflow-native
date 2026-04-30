/**
 * Focus Mode Service
 *
 * On Android (with PACKAGE_USAGE_STATS + SYSTEM_ALERT_WINDOW permissions):
 *   - Poll UsageStats every 2s to detect foreground app
 *   - If a blocked app is detected, show a full-screen overlay intent
 *
 * This service handles the JS-side orchestration. The actual native
 * enforcement bridges are in src/native-modules/.
 */

import { AppState, type AppStateStatus } from 'react-native';
import * as Notifications from 'expo-notifications';
import { dismissPersistentNotification } from './notificationService';
import { dbStartFocusSession, dbEndFocusSession } from '@/data/database';
import { ForegroundServiceModule } from '@/native-modules/ForegroundServiceModule';
import { SharedPrefsModule } from '@/native-modules/SharedPrefsModule';
import { ForegroundLaunchModule } from '@/native-modules/ForegroundLaunchModule';
import { getUpcomingTask } from './taskService';
import type { Task, FocusSession } from '@/data/types';

// ─── State ────────────────────────────────────────────────────────────────────

let focusActive = false;
let currentTask: Task | null = null;
let appStateSubscription: ReturnType<typeof AppState.addEventListener> | null = null;
let pollInterval: ReturnType<typeof setInterval> | null = null;
let onFocusViolation: ((appName: string) => void) | null = null;

// ─── Public API ───────────────────────────────────────────────────────────────

export async function startFocusMode(
  task: Task,
  allowedExtras: string[] = [],
  onViolation?: (appName: string) => void,
  options: { skipGoHome?: boolean } = {},
): Promise<void> {
  // Always clean up any existing subscription unconditionally before re-entering
  // (fixes NEW-019: subscription leaks when stopFocusMode short-circuits)
  appStateSubscription?.remove();
  appStateSubscription = null;

  if (focusActive) await stopFocusMode();

  focusActive = true;
  currentTask = task;
  onFocusViolation = onViolation ?? null;

  const session: FocusSession = {
    taskId: task.id,
    startedAt: new Date().toISOString(),
    isActive: true,
    allowedPackages: allowedExtras,
  };

  await dbStartFocusSession(session);

  const nextTask = getUpcomingTask([task]);
  const startMs = new Date(task.startTime).getTime();
  const endMs = new Date(task.endTime).getTime();

  await ForegroundServiceModule.startService(task.id, task.title, startMs, endMs, nextTask?.title ?? null);
  await ForegroundServiceModule.requestBatteryOptimizationExemption();

  // Send the user to the home screen so focus mode starts with a clean slate,
  // unless the caller opted out (e.g. auto-start when app is already open).
  if (!options.skipGoHome) {
    await ForegroundLaunchModule.goHome();
  }

  // Write state to SharedPreferences so:
  //   • AppBlockerAccessibilityService knows focus is on and which apps to block
  //   • BootReceiver can restart the service after a reboot
  await SharedPrefsModule.setFocusActive(true);
  await SharedPrefsModule.setActiveTask(task.id, task.title, endMs, nextTask?.title ?? null);
  // Tint the home-screen widget with the task's accent color.
  await SharedPrefsModule.setActiveTaskColor(task.color ?? '');
  // Write the allowed-list so the AccessibilityService knows which apps to permit.
  // An empty whitelist means "block all during focus" — we pass a sentinel package
  // name that will never be installed so the Kotlin service denies all foreground apps.
  const filteredAllowed = session.allowedPackages.filter((p) => p.includes('.'));
  await SharedPrefsModule.setAllowedPackages(
    filteredAllowed.length > 0 ? filteredAllowed : ['com.focusflow.internal.blockall'],
  );

  // App blocking is handled entirely by AppBlockerAccessibilityService (Kotlin).
  // It reads focus_active and allowed_packages from SharedPreferences (written
  // above) and intercepts window changes at the OS level — no JS poll needed.
  // startAndroidUsageMonitor is intentionally not called here.

  appStateSubscription = AppState.addEventListener('change', handleAppStateChange);
}

export async function stopFocusMode(): Promise<void> {
  if (!focusActive || !currentTask) return;

  focusActive = false;
  const task = currentTask;
  currentTask = null;
  onFocusViolation = null;

  await dbEndFocusSession(task.id);
  await dismissPersistentNotification();

  await ForegroundServiceModule.stopService();
  await SharedPrefsModule.setFocusActive(false);
  await SharedPrefsModule.setAllowedPackages([]);
  // Clear the widget's active-task snapshot. The AppContext tick will re-populate
  // it on the next pass if there's still a time-active task running.
  await SharedPrefsModule.clearActiveTask();
  stopAndroidUsageMonitor();

  appStateSubscription?.remove();
  appStateSubscription = null;
}

export function isFocusActive(): boolean {
  return focusActive;
}

export function getCurrentFocusTask(): Task | null {
  return currentTask;
}

// ─── App State Handling ───────────────────────────────────────────────────────

function handleAppStateChange(_state: AppStateStatus): void {
  // App blocking is handled entirely by AppBlockerAccessibilityService (Kotlin).
  // No JS-side nudge notifications are needed — they would be dismissable and
  // create a false sense of enforcement.
}

// ─── Android: Usage Stats Polling ────────────────────────────────────────────
//
// Requires: PACKAGE_USAGE_STATS permission (granted in Settings > Special app access)
// Uses the native module at src/native-modules/UsageStatsModule.ts

function startAndroidUsageMonitor(task: Task, allowed: string[]): void {
  stopAndroidUsageMonitor();

  pollInterval = setInterval(async () => {
    try {
      const { UsageStatsModule } = await import('@/native-modules/UsageStatsModule');
      const foreground = await UsageStatsModule.getForegroundApp();

      if (!foreground) return;

      const isAllowed = allowed.some(
        (a) => foreground.toLowerCase().includes(a.toLowerCase()),
      );

      if (!isAllowed && foreground !== 'com.tbtechs.focusflow') {
        onFocusViolation?.(foreground);

        const { ForegroundLaunchModule } = await import('@/native-modules/ForegroundLaunchModule');
        await ForegroundLaunchModule.bringToFront();

        await Notifications.scheduleNotificationAsync({
          identifier: 'focus-block',
          content: {
            title: `🚫 Focus Mode Active`,
            body: `${foreground} is blocked. Return to "${task.title}"`,
            data: { type: 'focus-block' },
            priority: Notifications.AndroidNotificationPriority.MAX,
          },
          trigger: null,
        });
      }
    } catch {
      // Native module not available (simulator / permissions not granted)
    }
  }, 2000);
}

function stopAndroidUsageMonitor(): void {
  if (pollInterval) {
    clearInterval(pollInterval);
    pollInterval = null;
  }
}
