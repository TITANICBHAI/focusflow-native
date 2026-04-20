import * as SQLite from 'expo-sqlite';
import type { Task, AppSettings, FocusSession, DailyAllowanceEntry } from './types';
import { logger } from '@/services/startupLogger';

let db: SQLite.SQLiteDatabase | null = null;
const PRIMARY_DB_NAME = 'focusday.db';
const RECOVERY_DB_NAME = 'focusday_recovery.db';

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
  systemGuardEnabled: true,
  customNodeRules: [],
};

/**
 * Reset the DB singleton — call after a recoverable open error so the next
 * getDb() call re-opens the database instead of retrying on a null reference.
 * (fixes NEW-018)
 */
export function resetDb(): void {
  db = null;
}

async function openAndInit(name: string = PRIMARY_DB_NAME): Promise<SQLite.SQLiteDatabase> {
  const opened = await SQLite.openDatabaseAsync(name);
  await initSchema(opened);
  return opened;
}

/**
 * Returns the open database, opening it if needed.
 * Retry strategy (3 attempts, never throws):
 *   1. Open PRIMARY_DB_NAME; if OK, return.
 *   2. Reset singleton, wait 300ms, retry PRIMARY_DB_NAME; if OK, return.
 *   3. Assume corruption — open RECOVERY_DB_NAME (always a fresh file).
 *      Logs [DB_CORRUPTION_RECOVERY] to the startup logger.
 *      If even this fails, return null.
 */
export async function getDb(): Promise<SQLite.SQLiteDatabase | null> {
  if (db) return db;

  try {
    db = await openAndInit(PRIMARY_DB_NAME);
    return db;
  } catch (firstErr) {
    console.error('[database] open/init failed (attempt 1):', firstErr);
    void logger.warn('database', `open/init attempt 1 failed: ${String(firstErr)}`);
    resetDb();
    await new Promise((r) => setTimeout(r, 300));
    try {
      db = await openAndInit(PRIMARY_DB_NAME);
      return db;
    } catch (secondErr) {
      console.error('[database] open/init failed (attempt 2 — trying recovery DB):', secondErr);
      void logger.error('database', `open/init attempt 2 failed: ${String(secondErr)} — switching to recovery DB`);
      try {
        db = await openAndInit(RECOVERY_DB_NAME);
        void logger.error('database', '[DB_CORRUPTION_RECOVERY] opened recovery DB — primary may be corrupted');
        return db;
      } catch (recoveryErr) {
        console.error('[database] recovery DB also failed — giving up:', recoveryErr);
        void logger.error('database', `[DB_UNRECOVERABLE] recovery DB failed: ${String(recoveryErr)}`);
        return null;
      }
    }
  }
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
  try {
    const database = await getDb();
    if (!database) return [];
    const rows = await database.getAllAsync<Record<string, unknown>>('SELECT * FROM tasks ORDER BY start_time ASC');
    return rows.map(rowToTask);
  } catch (e) {
    console.error('[database] dbGetAllTasks failed:', e);
    return [];
  }
}

export async function dbGetTasksForDate(dateISO: string): Promise<Task[]> {
  try {
    const database = await getDb();
    if (!database) return [];
    // Use the local calendar date — tasks are displayed in local time so queries
    // must match local date, not UTC. We pass a YYYY-MM-DD string derived from
    // a local Date so that users in UTC-X timezones see evening tasks correctly.
    const localDate = new Date(dateISO);
    const day = `${localDate.getFullYear()}-${String(localDate.getMonth() + 1).padStart(2, '0')}-${String(localDate.getDate()).padStart(2, '0')}`;
    // SQLite datetime() with 'localtime' modifier converts the stored UTC ISO
    // timestamp to the device's local timezone before extracting the date.
    const rows = await database.getAllAsync<Record<string, unknown>>(
      `SELECT * FROM tasks WHERE date(datetime(start_time, 'localtime')) = ? ORDER BY start_time ASC`,
      [day],
    );
    return rows.map(rowToTask);
  } catch (e) {
    console.error('[database] dbGetTasksForDate failed:', e);
    return [];
  }
}

export async function dbInsertTask(task: Task): Promise<void> {
  const database = await getDb();
  if (!database) { console.error('[database] dbInsertTask skipped — DB unavailable'); return; }
  await database.runAsync(
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
  const database = await getDb();
  if (!database) { console.error('[database] dbUpdateTask skipped — DB unavailable'); return; }
  await database.runAsync(
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
  const database = await getDb();
  if (!database) { console.error('[database] dbDeleteTask skipped — DB unavailable'); return; }
  await database.runAsync('DELETE FROM tasks WHERE id = ?', [taskId]);
}

function safeJsonParse<T>(raw: unknown, fallback: T): T {
  try {
    return JSON.parse(raw as string) as T;
  } catch {
    return fallback;
  }
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
    // Individual try/catch via safeJsonParse — a single malformed row
    // no longer throws through the whole rows.map() and wipes today's tasks.
    tags: safeJsonParse<string[]>(row.tags, []),
    reminders: safeJsonParse<Task['reminders']>(row.reminders, []),
    color: row.color as string,
    focusMode: (row.focus_mode as number) === 1,
    focusAllowedPackages: rawFap ? safeJsonParse<string[]>(rawFap, []) : undefined,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  };
}

// ─── Settings ────────────────────────────────────────────────────────────────

export async function dbGetSettings(): Promise<AppSettings> {
  try {
    const database = await getDb();
    if (!database) return DEFAULT_SETTINGS;
    const row = await database.getFirstAsync<{ value: string }>(
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
  } catch (e) {
    console.error('[database] dbGetSettings failed — returning defaults:', e);
    return DEFAULT_SETTINGS;
  }
}

export async function dbSaveSettings(settings: AppSettings): Promise<void> {
  const database = await getDb();
  if (!database) { console.error('[database] dbSaveSettings skipped — DB unavailable'); return; }
  await database.runAsync(
    `INSERT OR REPLACE INTO settings (key, value) VALUES ('app_settings', ?)`,
    [JSON.stringify(settings)],
  );
}

// ─── Focus Sessions ──────────────────────────────────────────────────────────

export async function dbStartFocusSession(session: FocusSession): Promise<void> {
  const database = await getDb();
  if (!database) { console.error('[database] dbStartFocusSession skipped — DB unavailable'); return; }
  await database.runAsync(
    `INSERT INTO focus_sessions (task_id, started_at, is_active, allowed_packages) VALUES (?, ?, 1, ?)`,
    [session.taskId, session.startedAt, JSON.stringify(session.allowedPackages)],
  );
}

export async function dbEndFocusSession(taskId: string): Promise<void> {
  const database = await getDb();
  if (!database) { console.error('[database] dbEndFocusSession skipped — DB unavailable'); return; }
  await database.runAsync(
    `UPDATE focus_sessions SET is_active = 0, ended_at = ? WHERE task_id = ? AND is_active = 1`,
    [new Date().toISOString(), taskId],
  );
}

export async function dbGetActiveFocusSession(): Promise<FocusSession | null> {
  try {
    const database = await getDb();
    if (!database) return null;
    const row = await database.getFirstAsync<Record<string, unknown>>(
      `SELECT * FROM focus_sessions WHERE is_active = 1 ORDER BY id DESC LIMIT 1`,
    );
    if (!row) return null;
    return {
      taskId: row.task_id as string,
      startedAt: row.started_at as string,
      isActive: true,
      allowedPackages: JSON.parse(row.allowed_packages as string) as string[],
    };
  } catch (e) {
    console.error('[database] dbGetActiveFocusSession failed:', e);
    return null;
  }
}

export async function dbGetTodayFocusMinutes(): Promise<number> {
  try {
    const database = await getDb();
    if (!database) return 0;
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    const rows = await database.getAllAsync<{ started_at: string; ended_at: string | null }>(
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
  } catch (e) {
    console.error('[database] dbGetTodayFocusMinutes failed:', e);
    return 0;
  }
}

// ─── Override Logging ─────────────────────────────────────────────────────────

export async function dbLogFocusOverride(taskId: string, appName: string, reason?: string): Promise<void> {
  try {
    const database = await getDb();
    if (!database) { return; }
    await database.runAsync(
      `INSERT INTO focus_overrides (task_id, app_name, overridden_at, reason) VALUES (?, ?, ?, ?)`,
      [taskId, appName, new Date().toISOString(), reason ?? null],
    );
  } catch (e) {
    console.error('[database] dbLogFocusOverride failed:', e);
  }
}

export async function dbGetTodayOverrideCount(): Promise<number> {
  try {
    const database = await getDb();
    if (!database) return 0;
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    const row = await database.getFirstAsync<{ count: number }>(
      `SELECT COUNT(*) as count FROM focus_overrides WHERE overridden_at >= ?`,
      [startOfDay.toISOString()],
    );
    return row?.count ?? 0;
  } catch (e) {
    console.error('[database] dbGetTodayOverrideCount failed:', e);
    return 0;
  }
}

// ─── Daily Streak ─────────────────────────────────────────────────────────────

export async function dbRecordDayCompletion(completed: number, total: number): Promise<void> {
  try {
    const database = await getDb();
    if (!database) { return; }
    const date = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
    await database.runAsync(
      `INSERT OR REPLACE INTO daily_completions (date, completed, total) VALUES (?, ?, ?)`,
      [date, completed, total],
    );
  } catch (e) {
    console.error('[database] dbRecordDayCompletion failed:', e);
  }
}

export async function dbGetStreak(): Promise<number> {
  try {
    const database = await getDb();
    if (!database) return 0;
    const rows = await database.getAllAsync<{ date: string; completed: number; total: number }>(
      `SELECT date, completed, total FROM daily_completions ORDER BY date DESC LIMIT 60`,
    );
    let streak = 0;
    let checkDate = new Date();
    checkDate.setHours(0, 0, 0, 0);

    for (const row of rows) {
      const rowDate = new Date(row.date);
      const diffDays = Math.round((checkDate.getTime() - rowDate.getTime()) / 86400000);
      if (diffDays > 1) break; // gap in streak
      // Count day as "active" if at least 50% completion
      if (row.total > 0 && row.completed / row.total >= 0.5) {
        streak++;
        checkDate = rowDate;
      } else {
        break;
      }
    }
    return streak;
  } catch (e) {
    console.error('[database] dbGetStreak failed:', e);
    return 0;
  }
}
