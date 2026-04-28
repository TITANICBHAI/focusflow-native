/**
 * backupService.ts
 *
 * Export & import the user's full FocusFlow state — settings, profile, tasks,
 * presets, schedules, custom rules — as a portable JSON file.
 *
 * Export: builds a JSON string and hands it to Share so the user can save it
 *         to Drive / Files / e-mail it to themselves / send it to another phone.
 * Import: opens the Android file picker, validates the JSON shape, then
 *         replaces the live settings + tasks via the AppContext callbacks.
 *
 * This is also a usable migration path for users coming from another focus app
 * that exports a compatible JSON envelope (FocusFlowBackupV1) — third-party
 * imports just need to match the shape below.
 */

import { Platform, Share } from 'react-native';
import * as FileSystem from 'expo-file-system';
import { dbGetAllTasks } from '@/data/database';
import { NativeFilePickerModule } from '@/native-modules/NativeFilePickerModule';
import type { AppSettings, Task } from '@/data/types';

// ─── Envelope shape ──────────────────────────────────────────────────────────

export const BACKUP_ENVELOPE_KIND = 'FocusFlowBackupV1';

export interface BackupEnvelope {
  kind: typeof BACKUP_ENVELOPE_KIND;
  version: 1;
  exportedAt: string;        // ISO timestamp
  appVersion?: string;       // optional, for diagnostics
  settings: AppSettings;
  tasks: Task[];
}

export interface ImportSummary {
  settings: boolean;
  tasksImported: number;
  tasksSkipped: number;
  warnings: string[];
}

// ─── Build the JSON envelope ─────────────────────────────────────────────────

export async function buildBackupJson(settings: AppSettings, appVersion?: string): Promise<string> {
  const tasks = await dbGetAllTasks().catch(() => [] as Task[]);
  const envelope: BackupEnvelope = {
    kind: BACKUP_ENVELOPE_KIND,
    version: 1,
    exportedAt: new Date().toISOString(),
    appVersion,
    settings,
    tasks,
  };
  return JSON.stringify(envelope, null, 2);
}

// ─── Export — write file + Share sheet ───────────────────────────────────────

export async function exportBackup(settings: AppSettings, appVersion?: string): Promise<{ ok: boolean; path?: string; error?: string }> {
  try {
    const json = await buildBackupJson(settings, appVersion);
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const filename = `focusflow-backup-${stamp}.json`;

    // Write the JSON to a sharable location in the app sandbox.
    const dir = (FileSystem as unknown as { documentDirectory?: string }).documentDirectory ?? '';
    const path = `${dir}${filename}`;
    if (dir && (FileSystem as unknown as { writeAsStringAsync?: (p: string, c: string) => Promise<void> }).writeAsStringAsync) {
      await (FileSystem as unknown as { writeAsStringAsync: (p: string, c: string) => Promise<void> }).writeAsStringAsync(path, json);
    }

    // Hand the file off to the system share sheet. On Android this brings up
    // the standard chooser — Drive, Files, Email, Bluetooth, nearby share, etc.
    if (Platform.OS === 'web') {
      // Web fallback — copy to clipboard or let the caller deal with the JSON.
      return { ok: true, path };
    }

    await Share.share(
      {
        title: 'FocusFlow backup',
        message: json,
      },
      { dialogTitle: 'Save FocusFlow backup' },
    );

    return { ok: true, path };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}

// ─── Validate ────────────────────────────────────────────────────────────────

function isObj(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

export function parseBackupJson(text: string): { ok: true; envelope: BackupEnvelope } | { ok: false; error: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (e) {
    return { ok: false, error: 'File is not valid JSON.' };
  }
  if (!isObj(parsed)) return { ok: false, error: 'Backup is empty or malformed.' };
  if (parsed.kind !== BACKUP_ENVELOPE_KIND) {
    return { ok: false, error: `Unsupported backup format (expected ${BACKUP_ENVELOPE_KIND}).` };
  }
  if (!isObj(parsed.settings)) return { ok: false, error: 'Backup is missing settings.' };
  if (!Array.isArray(parsed.tasks)) return { ok: false, error: 'Backup is missing tasks.' };
  return { ok: true, envelope: parsed as unknown as BackupEnvelope };
}

// ─── Import — pick file, validate, restore ──────────────────────────────────

export interface RestoreCallbacks {
  updateSettings: (s: AppSettings) => Promise<void>;
  addTask: (t: Task) => Promise<void>;
  deleteTask: (id: string) => Promise<void>;
  refreshTasks: () => Promise<void>;
  /** When true, every existing task is deleted before restore.
   *  When false, imported tasks are appended (skipping duplicate IDs). */
  replaceTasks: boolean;
  /** Existing live tasks — used to detect ID collisions. */
  currentTasks: Task[];
  /** Existing live settings — used as a fallback merge target. */
  currentSettings: AppSettings;
}

export async function pickAndImportBackup(cb: RestoreCallbacks): Promise<ImportSummary | { error: string }> {
  if (Platform.OS !== 'android') {
    return { error: 'File import is only available on Android.' };
  }

  let picked;
  try {
    picked = await NativeFilePickerModule.pickFile('application/json');
  } catch (e) {
    return { error: `Could not open file picker: ${String(e)}` };
  }
  if (!picked) return { error: 'No file selected.' };

  return restoreFromJson(picked.content, cb);
}

export async function restoreFromJson(text: string, cb: RestoreCallbacks): Promise<ImportSummary | { error: string }> {
  const parsed = parseBackupJson(text);
  if (!parsed.ok) return { error: parsed.error };
  const env = parsed.envelope;

  const summary: ImportSummary = {
    settings: false,
    tasksImported: 0,
    tasksSkipped: 0,
    warnings: [],
  };

  // ── Settings ────────────────────────────────────────────────────────────
  // Merge over current settings so any newer field added in a future release
  // (and absent from the backup) keeps its current value rather than getting
  // wiped out.
  try {
    const merged: AppSettings = { ...cb.currentSettings, ...env.settings };
    await cb.updateSettings(merged);
    summary.settings = true;
  } catch (e) {
    summary.warnings.push(`Settings could not be restored: ${String(e)}`);
  }

  // ── Tasks ───────────────────────────────────────────────────────────────
  if (cb.replaceTasks) {
    for (const t of cb.currentTasks) {
      try { await cb.deleteTask(t.id); } catch { /* keep going */ }
    }
  }
  const existingIds = cb.replaceTasks ? new Set<string>() : new Set(cb.currentTasks.map((t) => t.id));
  for (const t of env.tasks) {
    if (!t || typeof t !== 'object' || !t.id) {
      summary.tasksSkipped++;
      continue;
    }
    if (existingIds.has(t.id)) {
      summary.tasksSkipped++;
      continue;
    }
    try {
      await cb.addTask(t as Task);
      summary.tasksImported++;
    } catch (e) {
      summary.tasksSkipped++;
      summary.warnings.push(`Task "${(t as Task).title ?? t.id}" failed: ${String(e)}`);
    }
  }
  await cb.refreshTasks().catch(() => {});

  return summary;
}
