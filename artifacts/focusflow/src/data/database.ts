import * as SQLite from 'expo-sqlite';
import type { Task, AppSettings, FocusSession, DailyAllowanceEntry } from './types';

let db: SQLite.SQLiteDatabase | null = null;

export async function getDb(): Promise<SQLite.SQLiteDatabase> {
  if (!db) {
    db = await SQLite.openDatabaseAsync('focusday.db');
    await initSchema(db);
  }
  return db;
}

/**
 * Reset the DB singleton — call after a recoverable open error so the next
 * getDb() call re-opens the database instead of retrying on a null reference.
 * (fixes NEW-018)
 */
export function resetDb(): void {
  db = null;
}

async function initSchema(db: SQLite.SQLiteDatabase): Promise<void> {
  await db.execAsync(`
    PRAGMA journal_mode = WAL;

    CREATE TABLE IF NOT EXISTS tasks (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      description TEXT,
      start_time TEXT NOT NULL,
      end_time TEXT NOT NULL,
      duration_minutes INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'scheduled',
      priority TEXT NOT NULL DEFAULT 'medium',
      tags TEXT NOT NULL DEFAULT '[]',
      reminders TEXT NOT NULL DEFAULT '[]',
      color TEXT NOT NULL DEFAULT '#6366f1',
      focus_mode INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS focus_sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      task_id TEXT NOT NULL,
      started_at TEXT NOT NULL,
      ended_at TEXT,
      is_active INTEGER NOT NULL DEFAULT 1,
      allowed_packages TEXT NOT NULL DEFAULT '[]'
    );

    CREATE TABLE IF NOT EXISTS focus_overrides (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      task_id TEXT NOT NULL,
      app_name TEXT NOT NULL,
      overridden_at TEXT NOT NULL,
      reason TEXT
    );

    CREATE TABLE IF NOT EXISTS daily_completions (
      date TEXT PRIMARY KEY,
      completed INTEGER NOT NULL DEFAULT 0,
      total INTEGER NOT NULL DEFAULT 0
    );
  `);

  // Migration: add focus_allowed_packages column to tasks.
  // ALTER TABLE ADD COLUMN is idempotent via try/catch — safe to run every time.
  try {
    await db.execAsync(`ALTER TABLE tasks ADD COLUMN focus_allowed_packages TEXT;`);
  } catch {
    // Column already exists — ignore.
  }
}

// ─── Tasks ────────────────────────────────────────────────────────────────────

export async function dbGetAllTasks(): Promise<Task[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<Record<string, unknown>>('SELECT * FROM tasks ORDER BY start_time ASC');
  return rows.map(rowToTask);
}

export async function dbGetTasksForDate(dateISO: string): Promise<Task[]> {
  const db = await getDb();
  // Use LOCAL date boundaries so tasks at 11pm local are not missed for UTC-offset
  // users and tasks at 1am local are found for UTC+ users.
  // new Date(dateISO) gives the local representation of the timestamp, then we
  // build midnight..23:59:59 in LOCAL time and convert back to UTC ISO for the
  // SQL comparison (task start_time values are always stored as UTC ISO strings).
  const ref = new Date(dateISO);
  const startOfLocal = new Date(ref.getFullYear(), ref.getMonth(), ref.getDate(), 0, 0, 0, 0);
  const endOfLocal   = new Date(ref.getFullYear(), ref.getMonth(), ref.getDate(), 23, 59, 59, 999);
  const rows = await db.getAllAsync<Record<string, unknown>>(
    `SELECT * FROM tasks WHERE start_time >= ? AND start_time <= ? ORDER BY start_time ASC`,
    [startOfLocal.toISOString(), endOfLocal.toISOString()],
  );
  return rows.map(rowToTask);
}

export async function dbInsertTask(task: Task): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    `INSERT INTO tasks (id, title, description, start_time, end_time, duration_minutes, status, priority, tags, reminders, color, focus_mode, focus_allowed_packages, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      task.id,
      task.title,
      task.description ?? null,
      task.startTime,
      task.endTime,
      task.durationMinutes,
      task.status,
      task.priority,
      JSON.stringify(task.tags),
      JSON.stringify(task.reminders),
      task.color,
      task.focusMode ? 1 : 0,
      task.focusAllowedPackages !== undefined ? JSON.stringify(task.focusAllowedPackages) : null,
      task.createdAt,
      task.updatedAt,
    ],
  );
}

export async function dbUpdateTask(task: Task): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    `UPDATE tasks SET title=?, description=?, start_time=?, end_time=?, duration_minutes=?, status=?, priority=?, tags=?, reminders=?, color=?, focus_mode=?, focus_allowed_packages=?, updated_at=? WHERE id=?`,
    [
      task.title,
      task.description ?? null,
      task.startTime,
      task.endTime,
      task.durationMinutes,
      task.status,
      task.priority,
      JSON.stringify(task.tags),
      JSON.stringify(task.reminders),
      task.color,
      task.focusMode ? 1 : 0,
      task.focusAllowedPackages !== undefined ? JSON.stringify(task.focusAllowedPackages) : null,
      task.updatedAt,
      task.id,
    ],
  );
}

export async function dbDeleteTask(taskId: string): Promise<void> {
  const db = await getDb();
  await db.runAsync('DELETE FROM tasks WHERE id = ?', [taskId]);
}

function safeParseJson<T>(raw: unknown, fallback: T): T {
  if (typeof raw !== 'string' || raw === '') return fallback;
  try { return JSON.parse(raw) as T; } catch { return fallback; }
}

function rowToTask(row: Record<string, unknown>): Task {
  const rawFap = row.focus_allowed_packages as string | null | undefined;
  return {
    id: row.id as string,
    title: row.title as string,
    description: (row.description as string | null) ?? undefined,
    startTime: row.start_time as string,
    endTime: row.end_time as string,
    durationMinutes: row.duration_minutes as number,
    status: row.status as Task['status'],
    priority: row.priority as Task['priority'],
    tags: safeParseJson<string[]>(row.tags, []),
    reminders: safeParseJson<Task['reminders']>(row.reminders, []),
    color: row.color as string,
    focusMode: (row.focus_mode as number) === 1,
    focusAllowedPackages: rawFap ? safeParseJson<string[]>(rawFap, undefined as unknown as string[]) : undefined,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  };
}

// ─── Settings ────────────────────────────────────────────────────────────────

const DEFAULT_SETTINGS: AppSettings = {
  darkMode: false,
  defaultDuration: 60,
  defaultReminderOffsets: [-10, -5, 0],
  focusModeEnabled: true,
  allowedInFocus: [],
  allowedAppPresets: [],
  pomodoroEnabled: false,
  pomodoroDuration: 25,
  pomodoroBreak: 5,
  notificationsEnabled: true,
  privacyAccepted: false,
  standaloneBlockPackages: [],
  standaloneBlockUntil: null,
  dailyAllowanceEntries: [],
  onboardingComplete: false,
  blockedWords: [],
  aversionDimmerEnabled: false,
  aversionVibrateEnabled: false,
  aversionSoundEnabled: false,
  weeklyReportEnabled: false,
  greyoutSchedule: [],
};

export async function dbGetSettings(): Promise<AppSettings> {
  const db = await getDb();
  const row = await db.getFirstAsync<{ value: string }>(
    `SELECT value FROM settings WHERE key = 'app_settings'`,
  );
  if (!row) return DEFAULT_SETTINGS;
  try {
    const parsed = JSON.parse(row.value) as Partial<AppSettings> & { dailyAllowancePackages?: string[] };
    // Migrate old dailyAllowancePackages: string[] → dailyAllowanceEntries: DailyAllowanceEntry[]
    if (parsed.dailyAllowancePackages && !parsed.dailyAllowanceEntries) {
      parsed.dailyAllowanceEntries = parsed.dailyAllowancePackages.map((pkg): DailyAllowanceEntry => ({
        packageName: pkg,
        mode: 'count',
        countPerDay: 1,
        budgetMinutes: 30,
        intervalMinutes: 5,
        intervalHours: 1,
      }));
      delete parsed.dailyAllowancePackages;
    }
    return { ...DEFAULT_SETTINGS, ...parsed };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export async function dbSaveSettings(settings: AppSettings): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    `INSERT OR REPLACE INTO settings (key, value) VALUES ('app_settings', ?)`,
    [JSON.stringify(settings)],
  );
}

// ─── Focus Sessions ──────────────────────────────────────────────────────────

export async function dbStartFocusSession(session: FocusSession): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    `INSERT INTO focus_sessions (task_id, started_at, is_active, allowed_packages) VALUES (?, ?, 1, ?)`,
    [session.taskId, session.startedAt, JSON.stringify(session.allowedPackages)],
  );
}

export async function dbEndFocusSession(taskId: string): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    `UPDATE focus_sessions SET is_active = 0, ended_at = ? WHERE task_id = ? AND is_active = 1`,
    [new Date().toISOString(), taskId],
  );
}

export async function dbGetActiveFocusSession(): Promise<FocusSession | null> {
  const db = await getDb();
  const row = await db.getFirstAsync<Record<string, unknown>>(
    `SELECT * FROM focus_sessions WHERE is_active = 1 ORDER BY id DESC LIMIT 1`,
  );
  if (!row) return null;
  return {
    taskId: row.task_id as string,
    startedAt: row.started_at as string,
    isActive: true,
    allowedPackages: JSON.parse(row.allowed_packages as string) as string[],
  };
}

export async function dbGetTodayFocusMinutes(): Promise<number> {
  const db = await getDb();
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);
  const rows = await db.getAllAsync<{ started_at: string; ended_at: string | null }>(
    `SELECT started_at, ended_at FROM focus_sessions WHERE started_at >= ? ORDER BY id DESC`,
    [startOfDay.toISOString()],
  );
  let totalMs = 0;
  const now = Date.now();
  for (const row of rows) {
    const start = new Date(row.started_at).getTime();
    const end = row.ended_at ? new Date(row.ended_at).getTime() : now;
    totalMs += Math.max(0, end - start);
  }
  return Math.floor(totalMs / 60000);
}

// ─── Override Logging ─────────────────────────────────────────────────────────

export async function dbLogFocusOverride(taskId: string, appName: string, reason?: string): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    `INSERT INTO focus_overrides (task_id, app_name, overridden_at, reason) VALUES (?, ?, ?, ?)`,
    [taskId, appName, new Date().toISOString(), reason ?? null],
  );
}

export async function dbGetTodayOverrideCount(): Promise<number> {
  const db = await getDb();
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);
  const row = await db.getFirstAsync<{ count: number }>(
    `SELECT COUNT(*) as count FROM focus_overrides WHERE overridden_at >= ?`,
    [startOfDay.toISOString()],
  );
  return row?.count ?? 0;
}

// ─── Daily Streak ─────────────────────────────────────────────────────────────

export async function dbRecordDayCompletion(completed: number, total: number): Promise<void> {
  const db = await getDb();
  // Use LOCAL date parts — .toISOString() gives the UTC date which is ahead of
  // local date for UTC− users in the evening, causing dbGetStreak to never find
  // today's record (it compares against the local date).
  const now = new Date();
  const date = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  await db.runAsync(
    `INSERT OR REPLACE INTO daily_completions (date, completed, total) VALUES (?, ?, ?)`,
    [date, completed, total],
  );
}

export async function dbGetStreak(): Promise<number> {
  const db = await getDb();
  const rows = await db.getAllAsync<{ date: string; completed: number; total: number }>(
    `SELECT date, completed, total FROM daily_completions ORDER BY date DESC LIMIT 60`,
  );
  let streak = 0;
  // Use local date parts to avoid UTC-midnight parsing shifting the date by one day
  // in timezones west of UTC (e.g. new Date('2024-01-15') = Dec 14 23:00 in UTC-1).
  const now = new Date();
  let checkYMD = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;

  for (const row of rows) {
    const rowYMD = row.date.slice(0, 10);
    if (rowYMD !== checkYMD) break; // gap in streak
    // Count day as "active" if at least 50% completion
    if (row.total > 0 && row.completed / row.total >= 0.5) {
      streak++;
      // Move checkYMD back one calendar day
      const prev = new Date(now.getTime());
      prev.setDate(prev.getDate() - streak);
      checkYMD = `${prev.getFullYear()}-${String(prev.getMonth() + 1).padStart(2, '0')}-${String(prev.getDate()).padStart(2, '0')}`;
    } else {
      break;
    }
  }
  return streak;
}
