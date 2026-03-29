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
import type { Task } from '@/data/types';
import { formatTime, formatDuration, getRemainingMinutes } from './taskService';

type AndroidContent = Notifications.NotificationContentInput & {
  channelId?: string;
  ongoing?: boolean;
  autoDismiss?: boolean;
  sticky?: boolean;
};

// ─── Constants ────────────────────────────────────────────────────────────────

export const FOCUS_CHANNEL_ID      = 'focus-ongoing';
export const REMINDER_CHANNEL_ID   = 'task-reminders';
export const PERSISTENT_NOTIF_ID   = 'focusday-persistent';

// ─── Permissions ──────────────────────────────────────────────────────────────

export async function requestPermissions(): Promise<boolean> {
  const { status: existing } = await Notifications.getPermissionsAsync();
  if (existing === 'granted') return true;

  const { status } = await Notifications.requestPermissionsAsync();
  return status === 'granted';
}

// ─── Android notification channels ───────────────────────────────────────────

export async function setupNotificationChannels(): Promise<void> {
  await Notifications.setNotificationChannelAsync(REMINDER_CHANNEL_ID, {
    name: 'Task Reminders',
    importance: Notifications.AndroidImportance.HIGH,
    vibrationPattern: [0, 250, 250, 250],
    lightColor: '#6366f1',
    sound: 'default',
  });

  await Notifications.setNotificationChannelAsync(FOCUS_CHANNEL_ID, {
    name: 'Focus Mode (Ongoing)',
    importance: Notifications.AndroidImportance.MAX,
    vibrationPattern: [0, 100],
    lightColor: '#f59e0b',
    sound: null,
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
  const preStart: Array<{ offsetMs: number; body: string }> = [
    { offsetMs: -10 * 60_000, body: `Starting in 10 minutes` },
    { offsetMs: -5  * 60_000, body: `Starting in 5 minutes` },
    { offsetMs: -1  * 60_000, body: `Starting in 1 minute — get ready!` },
    { offsetMs: 0,            body: `Time to start! (${formatDuration(task.durationMinutes)})` },
  ];

  for (const r of preStart) {
    const fireAt = startMs + r.offsetMs;
    if (fireAt - now < 1000) continue;

    await Notifications.scheduleNotificationAsync({
      identifier: `${task.id}-pre${r.offsetMs}`,
      content: {
        title: `🎯 ${task.title}`,
        body:  r.body,
        data:  { taskId: task.id, type: 'reminder' },
        sound: 'default',
        categoryIdentifier: 'task-reminder',
        channelId: REMINDER_CHANNEL_ID,
      } as AndroidContent,
      trigger: { date: new Date(fireAt) },
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
      trigger: { date: new Date(fireAt) },
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
      trigger: { date: new Date(almostDone) },
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
      trigger: { date: new Date(endMs) },
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
// Backed by the native ForegroundTaskService on Android.
// The persistent notification lives in the Android notification tray
// until dismissPersistentNotification() is called.

export async function showPersistentTaskNotification(task: Task): Promise<void> {
  const remaining     = getRemainingMinutes(task.endTime);
  const remainingText = remaining > 0 ? `${remaining}m remaining` : `Time's up!`;

  await Notifications.scheduleNotificationAsync({
    identifier: PERSISTENT_NOTIF_ID,
    content: {
      title: `🟢 In Progress: ${task.title}`,
      body:  `${formatTime(task.startTime)} – ${formatTime(task.endTime)} · ${remainingText}`,
      data:  { taskId: task.id, type: 'focus-persistent' },
      sticky:      true,
      autoDismiss: false,
      categoryIdentifier: 'task-active',
      priority: Notifications.AndroidNotificationPriority.MAX,
      channelId: FOCUS_CHANNEL_ID,
      ongoing: true,
    } as AndroidContent,
    trigger: null,
  });
}

export async function dismissPersistentNotification(): Promise<void> {
  await Notifications.dismissNotificationAsync(PERSISTENT_NOTIF_ID);
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
