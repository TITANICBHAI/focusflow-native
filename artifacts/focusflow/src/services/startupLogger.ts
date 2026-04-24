/**
 * startupLogger.ts
 *
 * Timestamped, levelled log queue (INFO / WARN / ERROR).
 *
 * Concurrency contract:
 *   - All callers await `loadPromise` before touching `memoryLog`.
 *     The shared promise ensures the initial AsyncStorage read completes
 *     exactly once, and no entry is appended before history is restored.
 *   - All persist operations are funnelled through `persistChain`, a
 *     tail-chained Promise that serialises AsyncStorage + file writes so
 *     a newer snapshot never races and overwrites a slightly earlier one.
 *
 * Persistence strategy (two layers):
 *   1. AsyncStorage — fast, in-process, cleared on reinstall.
 *   2. File system  — `{documentDirectory}focusflow-boot.log`
 *      Rewrites the complete rotated log on every write (no append/overwrite
 *      ambiguity). Survives reinstalls on most platforms.
 *
 * Capped at MAX_ENTRIES (500) with auto-rotation (oldest entries dropped).
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import * as FileSystem from 'expo-file-system/legacy';
import { NativeModules, Platform } from 'react-native';

const STORAGE_KEY = 'focusflow_startup_log';
const LOG_FILENAME = 'focusflow-boot.log';
const MAX_ENTRIES = 500;

/**
 * Cached "is this a debuggable build?" flag — `__DEV__` alone is only true when
 * running through the Metro bundler. A debug-built APK with prebundled JS
 * reports false, which would silently hide all log output (and the Diagnostics
 * screen). We mirror the native ApplicationInfo.FLAG_DEBUGGABLE so the
 * developer surface stays available in true debug builds.
 */
let cachedDebuggable: boolean = __DEV__;
let debuggableProbed = false;
function probeDebuggable(): void {
  if (debuggableProbed || Platform.OS !== 'android') return;
  debuggableProbed = true;
  try {
    const mod = (NativeModules as Record<string, { isDebuggable?: () => Promise<boolean> }>).SharedPrefs;
    if (mod && typeof mod.isDebuggable === 'function') {
      void mod.isDebuggable().then((v) => { cachedDebuggable = Boolean(v) || __DEV__; }).catch(() => {});
    }
  } catch {
    // Non-fatal — keep the optimistic default.
  }
}

export type LogLevel = 'INFO' | 'WARN' | 'ERROR';

export interface LogEntry {
  ts: string;
  level: LogLevel;
  tag: string;
  message: string;
}

let memoryLog: LogEntry[] = [];

/**
 * Shared load promise — all concurrent calls await the same promise so
 * the AsyncStorage read completes exactly once before any entry is appended.
 */
let loadPromise: Promise<void> | null = null;

/**
 * Serialised persist chain — each persist is tail-chained so writes
 * execute in order and a newer snapshot never overwrites a stale one.
 */
let persistChain: Promise<void> = Promise.resolve();

function logFilePath(): string | null {
  if (Platform.OS === 'web') return null;
  return (FileSystem.documentDirectory ?? '') + LOG_FILENAME;
}

function ensureLoaded(): Promise<void> {
  if (loadPromise) return loadPromise;
  loadPromise = (async () => {
    try {
      const raw = await AsyncStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as LogEntry[];
        if (Array.isArray(parsed)) {
          memoryLog = parsed;
        }
      }
    } catch {
      memoryLog = [];
    }
  })();
  return loadPromise;
}

async function runPersist(): Promise<void> {
  try {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(memoryLog));
  } catch {
    // Non-fatal
  }
  const path = logFilePath();
  if (!path) return;
  try {
    const content = memoryLog
      .map((e) => `${e.ts} [${e.level}] [${e.tag}] ${e.message}`)
      .join('\n');
    await FileSystem.writeAsStringAsync(path, content);
  } catch {
    // Non-fatal
  }
}

function queuePersist(): void {
  persistChain = persistChain
    .then(() => runPersist())
    .catch(() => {});
}

function rotate(): void {
  if (memoryLog.length > MAX_ENTRIES) {
    memoryLog = memoryLog.slice(memoryLog.length - MAX_ENTRIES);
  }
}

export async function log(level: LogLevel, tag: string, message: string): Promise<void> {
  await ensureLoaded();
  const entry: LogEntry = {
    ts: new Date().toISOString(),
    level,
    tag,
    message,
  };
  memoryLog.push(entry);
  rotate();
  queuePersist();

  // Probe once on first call (cheap, idempotent), then mirror to console
  // whenever this is a debuggable build. ERROR-level entries are also mirrored
  // unconditionally so production crashes still surface in adb logcat.
  probeDebuggable();
  if (cachedDebuggable || level === 'ERROR') {
    const prefix = `[${level}][${tag}]`;
    if (level === 'ERROR') console.error(prefix, message);
    else if (level === 'WARN') console.warn(prefix, message);
    else console.log(prefix, message);
  }
}

export const logger = {
  info: (tag: string, message: string) => log('INFO', tag, message),
  warn: (tag: string, message: string) => log('WARN', tag, message),
  error: (tag: string, message: string) => log('ERROR', tag, message),
};

/** Return last N entries from the in-memory log (most recent last). */
export async function getRecentLogs(n = 100): Promise<LogEntry[]> {
  await ensureLoaded();
  return memoryLog.slice(-n);
}

/** Return all log entries from the in-memory log. */
export async function getAllLogs(): Promise<LogEntry[]> {
  await ensureLoaded();
  return [...memoryLog];
}

/** Clear all logs from memory, AsyncStorage, and the log file.
 *  Chained through persistChain so any in-flight persist completes
 *  first, then the clear executes — preventing a queued write from
 *  repopulating the log after the clear resolves.
 */
export function clearLogs(): Promise<void> {
  persistChain = persistChain
    .then(async () => {
      memoryLog = [];
      try {
        await AsyncStorage.removeItem(STORAGE_KEY);
      } catch {
        // ignore
      }
      const path = logFilePath();
      if (path) {
        try {
          await FileSystem.deleteAsync(path, { idempotent: true });
        } catch {
          // ignore
        }
      }
    })
    .catch(() => {});
  return persistChain;
}

/** Format all logs as a plain-text string suitable for sharing. */
export async function formatLogsForShare(): Promise<string> {
  await ensureLoaded();
  const header = `FocusFlow Startup Log — ${new Date().toISOString()}\n${'─'.repeat(60)}\n`;
  const body = memoryLog
    .map((e) => `${e.ts} [${e.level}] [${e.tag}] ${e.message}`)
    .join('\n');
  return header + body;
}

/** Returns the path to the persistent log file (for sharing via expo-sharing). */
export function getLogFilePath(): string | null {
  return logFilePath();
}
