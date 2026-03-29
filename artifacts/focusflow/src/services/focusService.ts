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
import { showPersistentTaskNotification, dismissPersistentNotification } from './notificationService';
import { dbStartFocusSession, dbEndFocusSession } from '@/data/database';
import { ForegroundServiceModule } from '@/native-modules/ForegroundServiceModule';
import { SharedPrefsModule } from '@/native-modules/SharedPrefsModule';
import { getUpcomingTask } from './taskService';
import type { Task, FocusSession } from '@/data/types';

// ─── State ────────────────────────────────────────────────────────────────────

let focusActive = false;
let currentTask: Task | null = null;
let appStateSubscription: ReturnType<typeof AppState.addEventListener> | null = null;
let pollInterval: ReturnType<typeof setInterval> | null = null;
let onFocusViolation: ((appName: string) => void) | null = null;

// ─── Allowed apps (Android package names) ────────────────────────────────────

const DEFAULT_ALLOWED = [
  'com.android.phone',
  'com.android.dialer',
  'com.google.android.dialer',
  'com.whatsapp',
  'com.samsung.android.incallui',
];

// ─── Public API ───────────────────────────────────────────────────────────────

export async function startFocusMode(
  task: Task,
  allowedExtras: string[] = [],
  onViolation?: (appName: string) => void,
): Promise<void> {
  if (focusActive) await stopFocusMode();

  focusActive = true;
  currentTask = task;
  onFocusViolation = onViolation ?? null;

  const session: FocusSession = {
    taskId: task.id,
    startedAt: new Date().toISOString(),
    isActive: true,
    allowedPackages: [...DEFAULT_ALLOWED, ...allowedExtras],
  };

  await dbStartFocusSession(session);
  await showPersistentTaskNotification(task);

  const nextTask = getUpcomingTask([task]);
  const endMs = new Date(task.endTime).getTime();

  await ForegroundServiceModule.startService(task.title, endMs, nextTask?.title ?? '');
  await ForegroundServiceModule.requestBatteryOptimizationExemption();

  // Write state to SharedPreferences so:
  //   • AppBlockerAccessibilityService knows focus is on and which apps to block
  //   • BootReceiver can restart the service after a reboot
  await SharedPrefsModule.setFocusActive(true);
  await SharedPrefsModule.setActiveTask(task.title, endMs, nextTask?.title ?? null);
  // Write the allowed-list so the AccessibilityService knows which apps to permit.
  await SharedPrefsModule.setAllowedPackages(
    session.allowedPackages.filter((p) => p.includes('.')),
  );

  startAndroidUsageMonitor(task, session.allowedPackages);

  // Listen for app backgrounding – when user leaves our app
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

function handleAppStateChange(state: AppStateStatus): void {
  if (!focusActive || !currentTask) return;

  if (state === 'background') {
    Notifications.scheduleNotificationAsync({
      identifier: 'focus-leave-alert',
      content: {
        title: `🎯 Stay Focused!`,
        body: `Return to: ${currentTask.title}`,
        data: { type: 'focus-alert' },
        sound: 'default',
      },
      trigger: null,
    }).catch(() => {});
  }
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

      if (!isAllowed && foreground !== 'com.tbtechs.focusday') {
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
