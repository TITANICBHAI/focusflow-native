/**
 * notificationService.ts
 *
 * Manages expo-notifications scheduling for FocusDay (Android).
 *
 * Note: setNotificationHandler and TaskManager.defineTask are NOT here.
 * They live at the top level of App.tsx and backgroundTasks.ts respectively,
 * which is required so the OS can find them on a headless re-launch.
 */

import * as Notifications from 'expo-notifications';
import { SchedulableTriggerInputTypes } from 'expo-notifications';
import { Platform } from 'react-native';
import type { Task } from '@/data/types';
import { formatTime, formatDuration, getRemainingMinutes } from './taskService';

type AndroidContent = Notifications.NotificationContentInput & {
  channelId?: string;
  ongoing?: boolean;
  autoDismiss?: boolean;
  sticky?: boolean;
};

// ─── Constants ────────────────────────────────────────────────────────────────

export const REMINDER_CHANNEL_ID   = 'task-reminders';

// ─── Permissions ──────────────────────────────────────────────────────────────

export async function requestPermissions(): Promise<boolean> {
  if (Platform.OS === 'web') return false;
  const { status: existing } = await Notifications.getPermissionsAsync();
  if (existing === 'granted') return true;

  const { status } = await Notifications.requestPermissionsAsync();
  return status === 'granted';
}

// ─── Android notification channels ───────────────────────────────────────────

export async function setupNotificationChannels(): Promise<void> {
  if (Platform.OS !== 'android') return;
  // Task reminder channel — used for pre-start alerts, mid-session check-ins, and end notifications.
  // The persistent focus notification is owned entirely by the native ForegroundTaskService
  // (IMPORTANCE_LOW, setOngoing(true)) — no JS channel is needed for it.
  await Notifications.setNotificationChannelAsync(REMINDER_CHANNEL_ID, {
    name: 'Task Reminders',
    importance: Notifications.AndroidImportance.HIGH,
    vibrationPattern: [0, 250, 250, 250],
    lightColor: '#6366f1',
    sound: 'default',
  });
}

// ─── Schedule reminders for a task ───────────────────────────────────────────

export async function scheduleTaskReminders(task: Task): Promise<void> {
  await cancelTaskReminders(task.id);

  const granted = await requestPermissions();
  if (!granted) return;

  const now     = Date.now();
  const startMs = new Date(task.startTime).getTime();
  const endMs   = new Date(task.endTime).getTime();

  // Pre-start reminders
  const endLabel = formatTime(task.endTime);
  const durLabel = formatDuration(task.durationMinutes);
  const preStart: Array<{ offsetMs: number; body: string; isStart?: boolean }> = [
    { offsetMs: -10 * 60_000, body: `Starting in 10 min · ends at ${endLabel} · ${durLabel} total` },
    { offsetMs: -5  * 60_000, body: `Starting in 5 min · ends at ${endLabel}` },
    { offsetMs: -1  * 60_000, body: `Starting in 1 min — get ready! Ends at ${endLabel}` },
    { offsetMs: 0,            body: `${durLabel} session · ends at ${endLabel} — tap to open`, isStart: true },
  ];

  for (const r of preStart) {
    const fireAt = startMs + r.offsetMs;
    if (fireAt - now < 1000) {
      continue;
    }

    await Notifications.scheduleNotificationAsync({
      identifier: `${task.id}-pre${r.offsetMs}`,
      content: {
        title: `🎯 ${task.title}`,
        body:  r.body,
        data:  { taskId: task.id, type: r.isStart ? 'task-start' : 'reminder' },
        sound: 'default',
        categoryIdentifier: 'task-reminder',
        channelId: REMINDER_CHANNEL_ID,
      } as AndroidContent,
      trigger: { type: SchedulableTriggerInputTypes.DATE, date: new Date(fireAt) },
    });
  }

  // Schedule persistent notification dismissal when the task ends
  if (endMs - now > 1000) {
    await Notifications.scheduleNotificationAsync({
      identifier: `${task.id}-persistent-dismiss`,
      content: {
        title: `Task ended: ${task.title}`,
        body:  `Focus session complete.`,
        data:  { taskId: task.id, type: 'persistent-dismiss' },
        channelId: REMINDER_CHANNEL_ID,
      } as AndroidContent,
      trigger: { type: SchedulableTriggerInputTypes.DATE, date: new Date(endMs) },
    });
  }

  // Mid-session check-ins
  const midSession: Array<{ offsetMs: number; body: string }> = [
    { offsetMs: 15 * 60_000, body: `15 minutes in — how's it going?` },
    { offsetMs: 30 * 60_000, body: `Half hour in — keep going!` },
  ];

  for (const r of midSession) {
    const fireAt = startMs + r.offsetMs;
    if (fireAt - now < 1000 || fireAt >= endMs) continue;

    await Notifications.scheduleNotificationAsync({
      identifier: `${task.id}-mid${r.offsetMs}`,
      content: {
        title: `🟢 ${task.title}`,
        body:  r.body,
        data:  { taskId: task.id, type: 'checkin' },
        sound: 'default',
        categoryIdentifier: 'task-active',
        channelId: REMINDER_CHANNEL_ID,
      } as AndroidContent,
      trigger: { type: SchedulableTriggerInputTypes.DATE, date: new Date(fireAt) },
    });
  }

  // T-1 minute warning before end
  const almostDone = endMs - 60_000;
  if (almostDone - now > 1000) {
    await Notifications.scheduleNotificationAsync({
      identifier: `${task.id}-almost`,
      content: {
        title: `⏳ ${task.title} — 1 minute left`,
        body:  `Start wrapping up!`,
        data:  { taskId: task.id, type: 'almost-done' },
        sound: 'default',
        categoryIdentifier: 'task-active',
        channelId: REMINDER_CHANNEL_ID,
      } as AndroidContent,
      trigger: { type: SchedulableTriggerInputTypes.DATE, date: new Date(almostDone) },
    });
  }

  // End-time notification — also used as the OVERRUN_CHECK trigger by backgroundTasks.ts
  if (endMs - now > 1000) {
    await Notifications.scheduleNotificationAsync({
      identifier: `${task.id}-end`,
      content: {
        title: `⏰ ${task.title} — Time's up!`,
        body:  `Mark as done, or extend your session.`,
        data:  { taskId: task.id, type: 'OVERRUN_CHECK' },
        sound: 'default',
        categoryIdentifier: 'task-active',
        channelId: REMINDER_CHANNEL_ID,
      } as AndroidContent,
      trigger: { type: SchedulableTriggerInputTypes.DATE, date: new Date(endMs) },
    });
  }
}

// ─── Cancel helpers ───────────────────────────────────────────────────────────

export async function cancelTaskReminders(taskId: string): Promise<void> {
  const scheduled = await Notifications.getAllScheduledNotificationsAsync();
  await Promise.all(
    scheduled
      .filter((n) => n.identifier.startsWith(taskId))
      .map((n) => Notifications.cancelScheduledNotificationAsync(n.identifier))
  );
}

export async function cancelAllReminders(): Promise<void> {
  await Notifications.cancelAllScheduledNotificationsAsync();
}

// ─── Persistent "in-progress" notification ───────────────────────────────────
// The persistent notification is owned entirely by the native ForegroundTaskService.
// It uses setOngoing(true) + IMPORTANCE_LOW so Samsung One UI does not flag it.
// JS must NOT post a duplicate ongoing notification — doing so with IMPORTANCE_MAX
// causes Samsung to show a "This app might have a bug — clear cache?" dialog.
//
// dismissPersistentNotification is kept as a no-op shim so callers don't need
// to be updated. The native service manages its own notification lifecycle.

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export async function dismissPersistentNotification(): Promise<void> {
  // No-op: the native ForegroundTaskService owns the persistent notification.
  // It clears automatically when the service goes idle or is stopped.
}

// ─── Late-start warning ───────────────────────────────────────────────────────
// Called by the background fetch task when a task is overdue to start.

export async function fireLateStartWarning(task: Task, minutesLate: number): Promise<void> {
  const granted = await requestPermissions();
  if (!granted) return;

  await Notifications.scheduleNotificationAsync({
    identifier: `${task.id}-late`,
    content: {
      title: `⏰ You're late: ${task.title}`,
      body:  `This task was supposed to start ${minutesLate}m ago.`,
      data:  { taskId: task.id, type: 'LATE_START_WARNING' },
      sound: 'default',
      categoryIdentifier: 'task-reminder',
      channelId: REMINDER_CHANNEL_ID,
    } as AndroidContent,
    trigger: null,
  });
}
