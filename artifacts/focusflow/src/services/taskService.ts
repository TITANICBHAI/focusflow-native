import { nanoid } from 'nanoid/non-secure';
import dayjs from 'dayjs';
import type { Task, TaskPriority, TaskStatus } from '@/data/types';

// ─── Task Factory ────────────────────────────────────────────────────────────

export function createTask(data: {
  title: string;
  description?: string;
  startTime: string;
  durationMinutes: number;
  priority?: TaskPriority;
  tags?: string[];
  color?: string;
  focusMode?: boolean;
}): Task {
  const start = dayjs(data.startTime);
  const end = start.add(data.durationMinutes, 'minute');

  return {
    id: nanoid(),
    title: data.title,
    description: data.description,
    startTime: start.toISOString(),
    endTime: end.toISOString(),
    durationMinutes: data.durationMinutes,
    status: 'scheduled',
    priority: data.priority ?? 'medium',
    tags: data.tags ?? [],
    reminders: [],
    color: data.color ?? '#6366f1',
    focusMode: data.focusMode ?? false,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

export function updateTaskStatus(task: Task, status: TaskStatus): Task {
  return { ...task, status, updatedAt: new Date().toISOString() };
}

// ─── Extend a task and shift all subsequent tasks forward ────────────────────

export function extendTask(task: Task, extraMinutes: number): Task {
  const newEnd = dayjs(task.endTime).add(extraMinutes, 'minute');
  return {
    ...task,
    endTime: newEnd.toISOString(),
    durationMinutes: task.durationMinutes + extraMinutes,
    updatedAt: new Date().toISOString(),
  };
}

export function shiftTasksAfter(
  tasks: Task[],
  afterTask: Task,
  minutesShift: number,
): Task[] {
  return tasks.map((t) => {
    if (
      t.id !== afterTask.id &&
      dayjs(t.startTime).isAfter(dayjs(afterTask.startTime))
    ) {
      return {
        ...t,
        startTime: dayjs(t.startTime).add(minutesShift, 'minute').toISOString(),
        endTime: dayjs(t.endTime).add(minutesShift, 'minute').toISOString(),
        updatedAt: new Date().toISOString(),
      };
    }
    return t;
  });
}

// ─── Query helpers ────────────────────────────────────────────────────────────

export function getActiveTask(tasks: Task[]): Task | null {
  const now = dayjs();
  return (
    tasks.find(
      (t) =>
        t.status !== 'completed' &&
        t.status !== 'skipped' &&
        dayjs(t.startTime).isBefore(now) &&
        dayjs(t.endTime).isAfter(now),
    ) ?? null
  );
}

export function getUpcomingTask(tasks: Task[]): Task | null {
  const now = dayjs();
  return (
    [...tasks]
      .filter((t) => t.status === 'scheduled' && dayjs(t.startTime).isAfter(now))
      .sort((a, b) => dayjs(a.startTime).unix() - dayjs(b.startTime).unix())[0] ?? null
  );
}

export function getOverdueTasks(tasks: Task[]): Task[] {
  const now = dayjs();
  return tasks.filter(
    (t) =>
      t.status === 'scheduled' &&
      dayjs(t.endTime).isBefore(now),
  );
}

export function getTodayTasks(tasks: Task[]): Task[] {
  const startOfDay = dayjs().startOf('day');
  const endOfDay = dayjs().endOf('day');
  return tasks
    .filter((t) => {
      const s = dayjs(t.startTime);
      return s.isAfter(startOfDay) && s.isBefore(endOfDay);
    })
    .sort((a, b) => dayjs(a.startTime).unix() - dayjs(b.startTime).unix());
}

// ─── Format helpers ───────────────────────────────────────────────────────────

export function formatTime(isoString: string): string {
  return dayjs(isoString).format('h:mm A');
}

export function formatTimeRange(start: string, end: string): string {
  return `${formatTime(start)} – ${formatTime(end)}`;
}

export function formatDuration(minutes: number): string {
  if (minutes < 60) return `${minutes}m`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

export function getTimeUntilStart(isoString: string): string {
  const diff = dayjs(isoString).diff(dayjs(), 'minute');
  if (diff <= 0) return 'Now';
  if (diff < 60) return `in ${diff}m`;
  const hrs = Math.floor(diff / 60);
  const rem = diff % 60;
  return rem === 0 ? `in ${hrs}h` : `in ${hrs}h ${rem}m`;
}

export function getElapsedMinutes(startIso: string): number {
  return dayjs().diff(dayjs(startIso), 'minute');
}

export function getRemainingMinutes(endIso: string): number {
  return dayjs(endIso).diff(dayjs(), 'minute');
}

// ─── NLP-style quick input parser ────────────────────────────────────────────
// Parses strings like "Call Bob at 3pm for 30m" or "Meeting 14:00 1h"

export interface ParsedTask {
  title: string;
  startTime?: string;
  durationMinutes: number;
}

export function parseQuickInput(input: string): ParsedTask {
  const now = dayjs();
  let title = input.trim();
  let startTime: string | undefined;
  let durationMinutes = 60;

  // Duration: "for 30m", "30min", "1h30m", "1.5h"
  const durRegex = /\b(?:for\s+)?(\d+(?:\.\d+)?)\s*(h(?:ours?)?|m(?:in(?:utes?)?)?)\b/i;
  const durMatch = title.match(durRegex);
  if (durMatch) {
    const val = parseFloat(durMatch[1]);
    const unit = durMatch[2].toLowerCase();
    durationMinutes = unit.startsWith('h') ? Math.round(val * 60) : Math.round(val);
    title = title.replace(durMatch[0], '').trim();
  }

  // Time: "at 3pm", "at 14:00", "3:30pm", "9am"
  const timeRegex = /\bat\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b/i;
  const timeMatch = title.match(timeRegex);
  if (timeMatch) {
    let hour = parseInt(timeMatch[1], 10);
    const min = timeMatch[2] ? parseInt(timeMatch[2], 10) : 0;
    const meridiem = timeMatch[3]?.toLowerCase();
    if (meridiem === 'pm' && hour < 12) hour += 12;
    if (meridiem === 'am' && hour === 12) hour = 0;
    startTime = now.hour(hour).minute(min).second(0).millisecond(0).toISOString();
    title = title.replace(timeMatch[0], '').trim();
  }

  // Clean up trailing/leading "at", commas, etc.
  title = title.replace(/\bat\b/gi, '').replace(/,/g, '').replace(/\s+/g, ' ').trim();

  return { title: title || 'New Task', startTime, durationMinutes };
}
