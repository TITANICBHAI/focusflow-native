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
  blockPresets: [],
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
  systemGuardEnabled: false,
  blockInstallActionsEnabled: false,
  blockYoutubeShortsEnabled: false,
  blockInstagramReelsEnabled: false,
  keepFocusActiveUntilTaskEnd: false,
  customNodeRules: [],
  recurringBlockSchedules: [],
  beginnerMode: true,
  tipsCardDismissed: false,
  alwaysOnEnforcementEnabled: true,
  lastShownStreakMilestone: 0,
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

// ─── Self-healing DB wrapper ─────────────────────────────────────────────────
//
// expo-sqlite caches the open SQLiteDatabase as a JS object whose underlying
// native pointer can be invalidated out from under us — most commonly when
// the OS trims our process while the app is backgrounded, when a foreground
// service restart races the JS init, or when WAL mode files are wiped from
// /data. After that, the JS handle still looks alive (`db !== null`) but every
// call into it surfaces as
//     "Call to function 'NativeDatabase.prepareAsync' has been rejected.
//      Caused by: java.lang.NullPointerException"
// and never recovers because the singleton stays cached. The user sees task
// edits, settings saves, and focus-session writes all silently failing for
// the rest of the app session.
//
// `runWithDb` detects that error signature, wipes the singleton, reopens the
// database (which also re-runs `initSchema`), and retries the operation once.

type DbOp<T> = (db: SQLite.SQLiteDatabase) => Promise<T>;

function isDeadHandleError(e: unknown): boolean {
  const m = String((e as { message?: string } | null | undefined)?.message ?? e);
  return (
    m.includes('NullPointerException') ||
    m.includes('NativeDatabase') ||
    m.includes('prepareAsync') ||
    m.includes('database is not open') ||
    m.includes('database has been closed')
  );
}

function shortErr(e: unknown): string {
  return String((e as { message?: string } | null | undefined)?.message ?? e).slice(0, 160);
}

/**
 * Run an operation against the open DB. On a "dead handle" failure, the
 * singleton is reset, the DB is reopened, and the operation is retried once.
 * Any other error is rethrown unchanged so callers' existing try/catch
 * branches keep working.
 */
async function runWithDb<T>(opName: string, op: DbOp<T>): Promise<T> {
  const first = await getDb();
  if (!first) throw new Error(`${opName}: DB unavailable`);
  try {
    return await op(first);
  } catch (e) {
    if (!isDeadHandleError(e)) throw e;
    void logger.warn('database', `${opName}: dead handle (${shortErr(e)}) — resetting and retrying once`);
    resetDb();
    const second = await getDb();
    if (!second) throw new Error(`${opName}: DB unavailable after reset`);
    try {
      const out = await op(second);
      void logger.info('database', `${opName}: retry succeeded after handle reset`);
      return out;
    } catch (e2) {
      void logger.error('database', `${opName}: retry also failed: ${shortErr(e2)}`);
      throw e2;
    }
  }
}

/**
 * Same as `runWithDb` but returns a fallback value instead of throwing —
 * for read-only callers that prefer to render an empty state on failure.
 */
async function runWithDbOr<T>(opName: string, fallback: T, op: DbOp<T>): Promise<T> {
  try {
    return await runWithDb(opName, op);
  } catch (e) {
    void logger.warn('database', `${opName}: returning fallback after error: ${shortErr(e)}`);
    return fallback;
  }
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
  return runWithDbOr('dbGetAllTasks', [], async (database) => {
    const rows = await database.getAllAsync<Record<string, unknown>>('SELECT * FROM tasks ORDER BY start_time ASC');
    return rows.map(rowToTask);
  });
}

/**
 * Returns tasks from the last 24 hours that ended before now but are still
 * unresolved (status is not 'completed' or 'skipped').
 *
 * Used by AppContext.refreshTasks() to keep yesterday's unresolved tasks
 * visible on the Focus tab even after midnight, so the user is prompted to
 * resolve them when a new task or block session starts.
 */
export async function dbGetRecentUnresolvedTasks(): Promise<Task[]> {
  return runWithDbOr('dbGetRecentUnresolvedTasks', [], async (database) => {
    const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const now = new Date().toISOString();
    const rows = await database.getAllAsync<Record<string, unknown>>(
      `SELECT * FROM tasks
       WHERE end_time >= ? AND end_time < ?
         AND status NOT IN ('completed', 'skipped')
       ORDER BY end_time DESC`,
      [cutoff, now],
    );
    return rows.map(rowToTask);
  });
}

/**
 * Returns all tasks whose start_time (interpreted in local time) falls within
 * the inclusive [startDateISO, endDateISO] range. Used by the Stats screen so
 * the Yesterday / Week / All-Time tabs aren't limited to the small in-memory
 * `state.tasks` window (which only holds today + recent unresolved).
 */
export async function dbGetTasksInDateRange(startDateISO: string, endDateISO: string): Promise<Task[]> {
  return runWithDbOr('dbGetTasksInDateRange', [], async (database) => {
    const localDate = (iso: string) => {
      const d = new Date(iso);
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    };
    const start = localDate(startDateISO);
    const end = localDate(endDateISO);
    const rows = await database.getAllAsync<Record<string, unknown>>(
      `SELECT * FROM tasks
       WHERE date(datetime(start_time, 'localtime')) BETWEEN ? AND ?
       ORDER BY start_time ASC`,
      [start, end],
    );
    return rows.map(rowToTask);
  });
}

export async function dbGetTasksForDate(dateISO: string): Promise<Task[]> {
  return runWithDbOr('dbGetTasksForDate', [], async (database) => {
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
  });
}

export async function dbInsertTask(task: Task): Promise<void> {
  return runWithDb('dbInsertTask', (database) => database.runAsync(
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
  ).then(() => undefined));
}

export async function dbUpdateTask(task: Task): Promise<void> {
  return runWithDb('dbUpdateTask', (database) => database.runAsync(
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
  ).then(() => undefined));
}

export async function dbDeleteTask(taskId: string): Promise<void> {
  return runWithDb('dbDeleteTask', (database) =>
    database.runAsync('DELETE FROM tasks WHERE id = ?', [taskId]).then(() => undefined),
  );
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
  return runWithDbOr('dbGetSettings', DEFAULT_SETTINGS, async (database) => {
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
  });
}

export async function dbSaveSettings(settings: AppSettings): Promise<void> {
  return runWithDb('dbSaveSettings', (database) => database.runAsync(
    `INSERT OR REPLACE INTO settings (key, value) VALUES ('app_settings', ?)`,
    [JSON.stringify(settings)],
  ).then(() => undefined));
}

// ─── Focus Sessions ──────────────────────────────────────────────────────────

export async function dbStartFocusSession(session: FocusSession): Promise<void> {
  return runWithDb('dbStartFocusSession', (database) => database.runAsync(
    `INSERT INTO focus_sessions (task_id, started_at, is_active, allowed_packages) VALUES (?, ?, 1, ?)`,
    [session.taskId, session.startedAt, JSON.stringify(session.allowedPackages)],
  ).then(() => undefined));
}

export async function dbEndFocusSession(taskId: string): Promise<void> {
  return runWithDb('dbEndFocusSession', (database) => database.runAsync(
    `UPDATE focus_sessions SET is_active = 0, ended_at = ? WHERE task_id = ? AND is_active = 1`,
    [new Date().toISOString(), taskId],
  ).then(() => undefined));
}

export async function dbGetActiveFocusSession(): Promise<FocusSession | null> {
  return runWithDbOr('dbGetActiveFocusSession', null, async (database) => {
    const row = await database.getFirstAsync<Record<string, unknown>>(
      `SELECT * FROM focus_sessions WHERE is_active = 1 ORDER BY id DESC LIMIT 1`,
    );
    if (!row) return null;
    return {
      taskId: row.task_id as string,
      startedAt: row.started_at as string,
      isActive: true,
      allowedPackages: safeJsonParse<string[]>(row.allowed_packages, []),
    };
  });
}

export async function dbGetTodayFocusMinutes(): Promise<number> {
  return runWithDbOr('dbGetTodayFocusMinutes', 0, async (database) => {
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
  });
}

// ─── Override Logging ─────────────────────────────────────────────────────────

export async function dbLogFocusOverride(taskId: string, appName: string, reason?: string): Promise<void> {
  try {
    await runWithDb('dbLogFocusOverride', (database) => database.runAsync(
      `INSERT INTO focus_overrides (task_id, app_name, overridden_at, reason) VALUES (?, ?, ?, ?)`,
      [taskId, appName, new Date().toISOString(), reason ?? null],
    ).then(() => undefined));
  } catch (e) {
    console.error('[database] dbLogFocusOverride failed:', e);
  }
}

export async function dbGetTodayOverrideCount(): Promise<number> {
  return runWithDbOr('dbGetTodayOverrideCount', 0, async (database) => {
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    const row = await database.getFirstAsync<{ count: number }>(
      `SELECT COUNT(*) as count FROM focus_overrides WHERE overridden_at >= ?`,
      [startOfDay.toISOString()],
    );
    return row?.count ?? 0;
  });
}

// ─── Daily Streak ─────────────────────────────────────────────────────────────

export async function dbRecordDayCompletion(completed: number, total: number): Promise<void> {
  try {
    await runWithDb('dbRecordDayCompletion', (database) => {
      const date = localDateString(new Date());
      return database.runAsync(
        `INSERT OR REPLACE INTO daily_completions (date, completed, total) VALUES (?, ?, ?)`,
        [date, completed, total],
      ).then(() => undefined);
    });
  } catch (e) {
    console.error('[database] dbRecordDayCompletion failed:', e);
  }
}

/**
 * Backfill the `daily_completions` table from the actual `tasks` table for the
 * last `daysBack` days. Useful on app start so the streak isn't broken just
 * because the user never opened the Stats screen on a given day. Only writes
 * rows for days that have at least one task. Existing rows are overwritten so
 * the derived value always reflects the current task statuses.
 */
export async function dbBackfillDayCompletions(daysBack: number = 30): Promise<void> {
  try {
    await runWithDb('dbBackfillDayCompletions', async (database) => {
      const cutoff = new Date();
      cutoff.setHours(0, 0, 0, 0);
      cutoff.setDate(cutoff.getDate() - daysBack + 1);
      const cutoffIso = cutoff.toISOString();
      const rows = await database.getAllAsync<{ start_time: string; status: string }>(
        `SELECT start_time, status FROM tasks WHERE start_time >= ?`,
        [cutoffIso],
      );
      const buckets = new Map<string, { completed: number; total: number }>();
      for (const r of rows) {
        const d = localDateString(new Date(r.start_time));
        const b = buckets.get(d) ?? { completed: 0, total: 0 };
        b.total += 1;
        if (r.status === 'completed') b.completed += 1;
        buckets.set(d, b);
      }
      for (const [date, b] of buckets) {
        await database.runAsync(
          `INSERT OR REPLACE INTO daily_completions (date, completed, total) VALUES (?, ?, ?)`,
          [date, b.completed, b.total],
        );
      }
    });
  } catch (e) {
    console.error('[database] dbBackfillDayCompletions failed:', e);
  }
}

function localDateString(d: Date): string {
  // Local YYYY-MM-DD — must match what dbGetStreak expects so streak math
  // doesn't break across UTC midnight for users in non-UTC timezones.
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export async function dbGetStreak(): Promise<number> {
  return runWithDbOr('dbGetStreak', 0, async (database) => {
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
  });
}

// ─── All-time / heatmap stats ─────────────────────────────────────────────────

/** Returns all daily_completions rows for the last `days` days, sorted oldest-first. */
export async function dbGetRecentDayCompletions(days: number): Promise<
  { date: string; completed: number; total: number }[]
> {
  return runWithDbOr('dbGetRecentDayCompletions', [], async (database) => {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - days + 1);
    cutoff.setHours(0, 0, 0, 0);
    const cutoffStr = cutoff.toISOString().slice(0, 10);
    return await database.getAllAsync<{ date: string; completed: number; total: number }>(
      `SELECT date, completed, total FROM daily_completions WHERE date >= ? ORDER BY date ASC`,
      [cutoffStr],
    );
  });
}

/** Total focus minutes across all recorded sessions. */
export async function dbGetAllTimeFocusMinutes(): Promise<number> {
  return runWithDbOr('dbGetAllTimeFocusMinutes', 0, async (database) => {
    const rows = await database.getAllAsync<{ started_at: string; ended_at: string | null }>(
      `SELECT started_at, ended_at FROM focus_sessions WHERE is_active = 0`,
    );
    let total = 0;
    for (const r of rows) {
      if (!r.ended_at) continue;
      const ms = new Date(r.ended_at).getTime() - new Date(r.started_at).getTime();
      if (ms > 0) total += ms / 60_000;
    }
    return Math.round(total);
  });
}

/** Total count of completed focus sessions across all time. */
export async function dbGetAllTimeFocusSessions(): Promise<number> {
  return runWithDbOr('dbGetAllTimeFocusSessions', 0, async (database) => {
    const row = await database.getFirstAsync<{ count: number }>(
      `SELECT COUNT(*) as count FROM focus_sessions WHERE is_active = 0`,
    );
    return row?.count ?? 0;
  });
}

/** Best consecutive-day streak ever recorded (50% completion threshold). */
export async function dbGetBestStreak(): Promise<number> {
  return runWithDbOr('dbGetBestStreak', 0, async (database) => {
    const rows = await database.getAllAsync<{ date: string; completed: number; total: number }>(
      `SELECT date, completed, total FROM daily_completions ORDER BY date ASC`,
    );
    let best = 0;
    let current = 0;
    let prevDate: Date | null = null;
    for (const r of rows) {
      const d = new Date(r.date);
      const isGood = r.total > 0 && r.completed / r.total >= 0.5;
      if (!isGood) { best = Math.max(best, current); current = 0; prevDate = null; continue; }
      if (!prevDate) { current = 1; }
      else {
        const diff = Math.round((d.getTime() - prevDate.getTime()) / 86400000);
        if (diff === 1) current++;
        else { best = Math.max(best, current); current = 1; }
      }
      prevDate = d;
    }
    return Math.max(best, current);
  });
}
