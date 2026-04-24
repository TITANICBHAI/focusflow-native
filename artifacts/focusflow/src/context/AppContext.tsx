import React, {
  createContext,
  useContext,
  useEffect,
  useReducer,
  useCallback,
  useRef,
} from 'react';
import { Alert } from 'react-native';
import type { Task, AppSettings, FocusSession, DailyAllowanceEntry, RecurringBlockSchedule, GreyoutWindow } from '@/data/types';
import {
  dbGetTasksForDate,
  dbGetRecentUnresolvedTasks,
  dbInsertTask,
  dbUpdateTask,
  dbDeleteTask,
  dbGetSettings,
  dbSaveSettings,
  dbGetActiveFocusSession,
  dbGetTodayFocusMinutes,
  dbGetStreak,
} from '@/data/database';
import {
  getTodayTasks,
  getActiveTask,
  getCurrentTask,
  getAllActiveTasks,
  getUpcomingTask,
  isAwaitingDecision,
  extendTask,
  updateTaskStatus,
} from '@/services/taskService';
import {
  rebalanceAfterOverrun,
  getUnfinishedOverdueTasks,
} from '@/services/schedulerEngine';
import {
  scheduleTaskReminders,
  cancelTaskReminders,
  setupNotificationChannels,
  requestPermissions,
  scheduleStandaloneBlockExpiry,
  cancelStandaloneBlockExpiry,
} from '@/services/notificationService';
import {
  startFocusMode as _startFocusMode,
  stopFocusMode as _stopFocusMode,
  isFocusActive,
} from '@/services/focusService';
import { SharedPrefsModule } from '@/native-modules/SharedPrefsModule';
import { ForegroundServiceModule } from '@/native-modules/ForegroundServiceModule';
import { TaskAlarmModule } from '@/native-modules/TaskAlarmModule';
import { EventBridge } from '@/services/eventBridge';
import { AversionsModule } from '@/native-modules/AversionsModule';
import { GreyoutModule } from '@/native-modules/GreyoutModule';
import { logger } from '@/services/startupLogger';

// ─── State ────────────────────────────────────────────────────────────────────

interface AppState {
  tasks: Task[];
  settings: AppSettings;
  focusSession: FocusSession | null;
  focusViolationApp: string | null;
  isLoading: boolean;
  isDbReady: boolean;
}

type AppAction =
  | { type: 'SET_LOADING'; payload: boolean }
  | { type: 'SET_DB_READY' }
  | { type: 'SET_TASKS'; payload: Task[] }
  | { type: 'ADD_TASK'; payload: Task }
  | { type: 'UPDATE_TASK'; payload: Task }
  | { type: 'DELETE_TASK'; payload: string }
  | { type: 'SET_SETTINGS'; payload: AppSettings }
  | { type: 'SET_FOCUS_SESSION'; payload: FocusSession | null }
  | { type: 'SET_FOCUS_VIOLATION'; payload: string | null };

function reducer(state: AppState, action: AppAction): AppState {
  switch (action.type) {
    case 'SET_LOADING':
      return { ...state, isLoading: action.payload };
    case 'SET_DB_READY':
      return { ...state, isDbReady: true };
    case 'SET_TASKS':
      return { ...state, tasks: action.payload };
    case 'ADD_TASK':
      return { ...state, tasks: [...state.tasks, action.payload] };
    case 'UPDATE_TASK':
      return {
        ...state,
        tasks: state.tasks.map((t) => (t.id === action.payload.id ? action.payload : t)),
      };
    case 'DELETE_TASK':
      return { ...state, tasks: state.tasks.filter((t) => t.id !== action.payload) };
    case 'SET_SETTINGS':
      return { ...state, settings: action.payload };
    case 'SET_FOCUS_SESSION':
      return { ...state, focusSession: action.payload };
    case 'SET_FOCUS_VIOLATION':
      return { ...state, focusViolationApp: action.payload };
    default:
      return state;
  }
}

const defaultSettings: AppSettings = {
  darkMode: true,
  defaultDuration: 60,
  defaultReminderOffsets: [-10, -5, 0],
  focusModeEnabled: true,
  allowedInFocus: [], // [] = all apps allowed (no blocking) — sentinel value
  allowedAppPresets: [],
  blockPresets: [],
  pomodoroEnabled: false,
  pomodoroDuration: 25,
  pomodoroBreak: 5,
  notificationsEnabled: true,
  privacyAccepted: false,
  onboardingComplete: false,
  standaloneBlockPackages: [],
  standaloneBlockUntil: null,
  dailyAllowanceEntries: [],
  blockedWords: [],
  aversionDimmerEnabled: false,
  aversionVibrateEnabled: false,
  aversionSoundEnabled: false,
  weeklyReportEnabled: false,
  greyoutSchedule: [],
  systemGuardEnabled: true,
  overlayWallpaper: '',
  overlayQuotes: [],
  customNodeRules: [],
  recurringBlockSchedules: [],
};

const initialState: AppState = {
  tasks: [],
  settings: defaultSettings,
  focusSession: null,
  focusViolationApp: null,
  isLoading: true,
  isDbReady: false,
};

function withTimeout<T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(fallback), ms);
    promise
      .then((value) => {
        clearTimeout(timer);
        resolve(value);
      })
      .catch((e) => {
        clearTimeout(timer);
        console.error('[AppContext] timed operation failed', e);
        resolve(fallback);
      });
  });
}

// ─── Context ──────────────────────────────────────────────────────────────────

interface AppContextValue {
  state: AppState;
  todayTasks: Task[];
  activeTask: Task | null;
  currentTask: Task | null;
  activeTasks: Task[];

  addTask: (task: Task) => Promise<void>;
  updateTask: (task: Task) => Promise<void>;
  deleteTask: (taskId: string) => Promise<void>;
  completeTask: (taskId: string) => Promise<void>;
  skipTask: (taskId: string) => Promise<void>;
  extendTaskTime: (taskId: string, extraMinutes: number) => Promise<void>;

  startFocusMode: (taskId: string) => Promise<void>;
  stopFocusMode: () => Promise<void>;

  updateSettings: (settings: AppSettings) => Promise<void>;
  setStandaloneBlock: (packages: string[], untilMs: number | null) => Promise<void>;
  setStandaloneBlockAndAllowance: (packages: string[], untilMs: number | null, allowanceEntries: DailyAllowanceEntry[]) => Promise<void>;
  setDailyAllowanceEntries: (entries: DailyAllowanceEntry[]) => Promise<void>;
  setBlockedWords: (words: string[]) => Promise<void>;
  setRecurringBlockSchedules: (schedules: RecurringBlockSchedule[]) => Promise<void>;
  refreshTasks: () => Promise<void>;
}

const AppContext = createContext<AppContextValue | null>(null);

// ─── Provider ─────────────────────────────────────────────────────────────────

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [state, dispatch] = useReducer(reducer, initialState);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const watchdogRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Tracks which unresolved task IDs have already triggered a "did you finish
  // your previous task?" alert so we don't show the same prompt twice.
  const alertedUnresolvedRef = useRef<Set<string>>(new Set());

  // ── 12-second splash watchdog ─────────────────────────────────────────────
  // If SET_DB_READY hasn't fired within 12 s, force the app past the splash
  // screen so it is never permanently stuck.

  useEffect(() => {
    watchdogRef.current = setTimeout(() => {
      if (!state.isDbReady) {
        void logger.error('AppContext', '[WATCHDOG_TRIGGERED] isDbReady still false after 12 s — forcing ready');
        dispatch({ type: 'SET_DB_READY' });
        dispatch({ type: 'SET_LOADING', payload: false });
      }
    }, 12000);
    return () => {
      if (watchdogRef.current) clearTimeout(watchdogRef.current);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (state.isDbReady && watchdogRef.current) {
      clearTimeout(watchdogRef.current);
      watchdogRef.current = null;
    }
  }, [state.isDbReady]);

  // ── Initialize ──────────────────────────────────────────────────────────────

  useEffect(() => {
    void init();
    return () => {
      if (tickRef.current) clearInterval(tickRef.current);
    };
  }, []);

  async function init() {
    void logger.info('AppContext', '[STARTUP_BEGIN] init() called');
    dispatch({ type: 'SET_LOADING', payload: true });
    try {
      // ── Notification channels ──────────────────────────────────────────────
      try {
        void logger.info('AppContext', 'Setting up notification channels');
        await setupNotificationChannels();
        void logger.info('AppContext', 'Notification channels ready');
      } catch (e) {
        void logger.warn('AppContext', `Notification channel setup failed: ${String(e)}`);
      }

      // ── Notification permissions ───────────────────────────────────────────
      try {
        void logger.info('AppContext', 'Requesting notification permissions');
        const granted = await requestPermissions();
        void logger.info('AppContext', `Notification permission: ${granted ? 'granted' : 'denied'}`);
      } catch (e) {
        void logger.warn('AppContext', `Notification permission request failed: ${String(e)}`);
      }

      // ── Foreground service (idle mode) ─────────────────────────────────────
      // Isolated: failure here must NOT prevent DB readiness
      try {
        void logger.info('AppContext', 'Starting idle foreground service');
        await ForegroundServiceModule.startIdleService();
        void logger.info('AppContext', 'Idle foreground service started');
      } catch (e) {
        void logger.warn('AppContext', `Idle foreground service failed: ${String(e)}`);
      }

      // ── Database / settings ────────────────────────────────────────────────
      void logger.info('AppContext', 'Loading settings from DB (timeout=8000ms)');
      const rawSettings = await withTimeout(dbGetSettings(), 8000, defaultSettings);
      void logger.info('AppContext', 'Settings loaded from DB');

      // If the DB returned privacyAccepted=false (e.g. because it fell back to
      // the recovery DB after OEM memory management wiped the DB file), cross-
      // check with SharedPreferences — which survives DB file deletion — before
      // concluding the user needs to re-accept the privacy policy. This stops
      // the privacy policy screen from appearing randomly between sessions.
      let settings = rawSettings;
      if (!rawSettings.privacyAccepted) {
        try {
          const spValue = await SharedPrefsModule.getString('privacy_accepted');
          if (spValue === 'true') {
            void logger.info('AppContext', 'privacyAccepted restored from SharedPreferences backup');
            settings = { ...rawSettings, privacyAccepted: true };
            try { await dbSaveSettings(settings); } catch { /* non-fatal */ }
          }
        } catch (e) {
          void logger.warn('AppContext', `SharedPrefs privacy backup check failed: ${String(e)}`);
        }
      }

      void logger.info('AppContext', 'Dispatching SET_SETTINGS + SET_DB_READY');
      dispatch({ type: 'SET_SETTINGS', payload: settings });
      dispatch({ type: 'SET_DB_READY' });

      // ── Native module syncs — each isolated ───────────────────────────────
      try {
        void logger.info('AppContext', 'Syncing standalone block');
        await _syncStandaloneBlock(settings);
        void logger.info('AppContext', 'Standalone block synced');
      } catch (e) {
        void logger.warn('AppContext', `Standalone block sync failed: ${String(e)}`);
      }

      try {
        void logger.info('AppContext', 'Syncing daily allowance');
        await _syncDailyAllowance(settings);
        void logger.info('AppContext', 'Daily allowance synced');
      } catch (e) {
        void logger.warn('AppContext', `Daily allowance sync failed: ${String(e)}`);
      }

      try {
        void logger.info('AppContext', 'Syncing blocked words');
        await _syncBlockedWords(settings);
        void logger.info('AppContext', 'Blocked words synced');
      } catch (e) {
        void logger.warn('AppContext', `Blocked words sync failed: ${String(e)}`);
      }

      try {
        void logger.info('AppContext', 'Syncing aversions');
        await _syncAversions(settings);
        void logger.info('AppContext', 'Aversions synced');
      } catch (e) {
        void logger.warn('AppContext', `Aversions sync failed: ${String(e)}`);
      }

      try {
        void logger.info('AppContext', 'Syncing greyout schedule + recurring block schedules');
        const combined = _recurringSchedulesToGreyoutWindows(settings);
        await GreyoutModule.setSchedule(combined);
        void logger.info('AppContext', 'Greyout schedule synced');
      } catch (e) {
        void logger.warn('AppContext', `Greyout schedule sync failed: ${String(e)}`);
      }

      try {
        void logger.info('AppContext', 'Syncing system guard');
        await _syncSystemGuard(settings);
        void logger.info('AppContext', 'System guard synced');
      } catch (e) {
        void logger.warn('AppContext', `System guard sync failed: ${String(e)}`);
      }

      // ── Tasks & overdue recovery ───────────────────────────────────────────
      try {
        void logger.info('AppContext', 'Refreshing tasks');
        await refreshTasks();
        void logger.info('AppContext', 'Tasks refreshed');
      } catch (e) {
        void logger.warn('AppContext', `Task refresh failed: ${String(e)}`);
      }

      try {
        void logger.info('AppContext', 'Checking for overdue tasks');
        const allTasks = await dbGetTasksForDate(new Date().toISOString());
        const overdue = getUnfinishedOverdueTasks(allTasks);
        for (const t of overdue) {
          const marked = updateTaskStatus(t, 'overdue');
          await dbUpdateTask(marked);
        }
        if (overdue.length > 0) {
          void logger.info('AppContext', `Marked ${overdue.length} tasks as overdue`);
          await refreshTasks();
        }
      } catch (e) {
        void logger.warn('AppContext', `Overdue task recovery failed: ${String(e)}`);
      }

      // ── Active focus session restore ───────────────────────────────────────
      try {
        void logger.info('AppContext', 'Checking for active focus session');
        const activeSession = await dbGetActiveFocusSession();
        if (activeSession) {
          void logger.info('AppContext', `Restored active focus session for task ${activeSession.taskId}`);
          dispatch({ type: 'SET_FOCUS_SESSION', payload: activeSession });
        }
      } catch (e) {
        void logger.warn('AppContext', `Focus session restore failed: ${String(e)}`);
      }

      void logger.info('AppContext', '[STARTUP_COMPLETE] init() finished successfully');
    } catch (e) {
      void logger.error('AppContext', `[STARTUP_ERROR] Unhandled init error: ${String(e)}`);
      dispatch({ type: 'SET_SETTINGS', payload: defaultSettings });
      dispatch({ type: 'SET_DB_READY' });
    } finally {
      dispatch({ type: 'SET_LOADING', payload: false });
      void logger.info('AppContext', 'SET_LOADING: false dispatched');
    }
  }

  /**
   * Syncs the rich daily allowance entries into SharedPreferences so the
   * AccessibilityService can enforce count / time_budget / interval modes
   * without the JS bundle being running.
   */
  async function _syncDailyAllowance(settings: AppSettings): Promise<void> {
    const entries = settings.dailyAllowanceEntries ?? [];
    try {
      await SharedPrefsModule.setDailyAllowanceConfig(entries);
    } catch (e) {
      void logger.warn('AppContext', `daily allowance sync failed: ${String(e)}`);
    }
  }

  /**
   * Syncs the blocked words list into SharedPreferences so the
   * AccessibilityService can read it without the JS bundle being running.
   */
  async function _syncBlockedWords(settings: AppSettings): Promise<void> {
    const words = settings.blockedWords ?? [];
    try {
      await SharedPrefsModule.setBlockedWords(words);
    } catch (e) {
      void logger.warn('AppContext', `blocked words sync failed: ${String(e)}`);
    }
  }

  /**
   * Syncs aversion deterrent flags (dimmer, vibration, sound, weekly report)
   * into SharedPreferences via the Kotlin bridge.
   */
  async function _syncAversions(settings: AppSettings): Promise<void> {
    try {
      await AversionsModule.setSettings({
        dimmerEnabled:       settings.aversionDimmerEnabled  ?? false,
        vibrateEnabled:      settings.aversionVibrateEnabled ?? false,
        soundEnabled:        settings.aversionSoundEnabled   ?? false,
        weeklyReportEnabled: settings.weeklyReportEnabled    ?? false,
      });
    } catch (e) {
      void logger.warn('AppContext', `aversions sync failed: ${String(e)}`);
    }
  }

  /**
   * Syncs the greyout schedule JSON into SharedPreferences so the
   * AccessibilityService can enforce time-window blocks without JS running.
   */
  async function _syncGreyoutSchedule(settings: AppSettings): Promise<void> {
    try {
      await GreyoutModule.setSchedule(settings.greyoutSchedule ?? []);
    } catch (e) {
      void logger.warn('AppContext', `greyout sync failed: ${String(e)}`);
    }
  }

  /**
   * Converts enabled recurring block schedules into GreyoutWindow entries
   * (one per package per schedule) and syncs the full combined list with
   * the native GreyoutModule. User-created greyout windows are preserved.
   */
  function _recurringSchedulesToGreyoutWindows(settings: AppSettings): GreyoutWindow[] {
    const schedules = settings.recurringBlockSchedules ?? [];
    // Keep user-created windows (no scheduleId) untouched
    const userWindows = (settings.greyoutSchedule ?? []).filter((w) => !w.scheduleId);
    const scheduleWindows: GreyoutWindow[] = [];
    for (const sched of schedules) {
      if (!sched.enabled || sched.packages.length === 0) continue;
      for (const pkg of sched.packages) {
        scheduleWindows.push({
          pkg,
          startHour: sched.startHour,
          startMin: sched.startMin,
          endHour: sched.endHour,
          endMin: sched.endMin,
          days: sched.days,
          scheduleId: sched.id,
        });
      }
    }
    return [...userWindows, ...scheduleWindows];
  }

  async function _syncSystemGuard(settings: AppSettings): Promise<void> {
    try {
      await SharedPrefsModule.setSystemGuardEnabled(settings.systemGuardEnabled ?? true);
    } catch (e) {
      void logger.warn('AppContext', `system guard sync failed: ${String(e)}`);
    }
  }

  /**
   * Syncs standalone block state from settings into SharedPreferences.
   * Clears the block if it has already expired.
   */
  async function _syncStandaloneBlock(settings: AppSettings): Promise<void> {
    const { standaloneBlockPackages, standaloneBlockUntil } = settings;
    const packages = standaloneBlockPackages ?? [];
    if (packages.length === 0 || !standaloneBlockUntil) {
      try {
        await SharedPrefsModule.setStandaloneBlock(false, [], 0);
      } catch (e) {
        void logger.warn('AppContext', `standalone block clear failed: ${String(e)}`);
      }
      return;
    }
    const untilMs = new Date(standaloneBlockUntil).getTime();
    if (untilMs <= Date.now()) {
      try {
        await SharedPrefsModule.setStandaloneBlock(false, [], 0);
      } catch (e) {
        void logger.warn('AppContext', `expired standalone block clear failed: ${String(e)}`);
      }
      const cleared = { ...settings, standaloneBlockPackages: [], standaloneBlockUntil: null };
      await dbSaveSettings(cleared);
      dispatch({ type: 'SET_SETTINGS', payload: cleared });
    } else {
      try {
        await SharedPrefsModule.setStandaloneBlock(true, packages, untilMs);
      } catch (e) {
        void logger.warn('AppContext', `standalone block sync failed: ${String(e)}`);
      }
    }
  }

  // ── Keep a ref to latest state so the tick interval never needs to re-create ─
  // (fixes NEW-021: setInterval restarting on every task/settings change)
  const stateRef = useRef(state);
  useEffect(() => {
    stateRef.current = state;
  });

  // ── Tick: check active tasks + standalone block expiry every 30s ─────────────
  // Only recreated when DB readiness changes — state is read via stateRef.

  useEffect(() => {
    if (!state.isDbReady) return;
    tickRef.current = setInterval(() => {
      const s = stateRef.current;
      // NOTE: We deliberately DO NOT auto-stop focus mode when the active task
      // ends — that caused tasks to silently disappear. The TASK_ENDED handler
      // and the focus screen now show a "Time's up — what next?" prompt so
      // the user explicitly decides to complete, extend, or skip.
      // The native ForegroundTaskService already shows a persistent
      // notification while focus is active (NEW-011). No JS sticky needed here.
      // Also clear any expired standalone block so the UI reflects reality.
      if (s.settings.standaloneBlockUntil) {
        void _syncStandaloneBlock(s.settings);
      }
      // Refresh the home-screen widget so its time-remaining counter and
      // standalone-block expiry stay in sync without waiting for the next
      // user action. Cheap: it's a single SharedPrefs read + RemoteViews push.
      void _syncWidget(s);
    }, 30000);
    return () => {
      if (tickRef.current) clearInterval(tickRef.current);
    };
  }, [state.isDbReady]);

  /**
   * Pushes the current "active task" snapshot to SharedPreferences for the
   * home-screen widget. When focus mode is running we leave the prefs alone —
   * focusService and ForegroundTaskService own those keys during a session.
   * Otherwise we mirror the time-active task (or clear it).
   */
  async function _syncWidget(s: AppState): Promise<void> {
    try {
      // Focus session owns the task_* keys + pushes widget itself — don't fight it.
      if (s.focusSession) return;

      const active   = getActiveTask(s.tasks);
      const current  = getCurrentTask(s.tasks);   // includes ended-but-unresolved
      const awaiting = current && isAwaitingDecision(current) ? current : null;

      if (active) {
        // ── State 1: task running ────────────────────────────────────────────
        const endMs   = new Date(active.endTime).getTime();
        const startMs = new Date(active.startTime).getTime();
        const next    = s.tasks.find(
          (t) => t.id !== active.id && new Date(t.startTime).getTime() >= endMs,
        );
        await SharedPrefsModule.setActiveTask(active.id, active.title, endMs, next?.title ?? null);
        await SharedPrefsModule.setActiveTaskColor(active.color ?? '');
        await SharedPrefsModule.setActiveTaskStartMs(active.id, startMs);
        // Clear awaiting-decision and next-upcoming so they don't bleed through
        await SharedPrefsModule.putString('task_awaiting_decision', '');
        await SharedPrefsModule.putString('next_upcoming_name', '');
        await SharedPrefsModule.putString('next_upcoming_start_ms', '0');
      } else if (awaiting) {
        // ── State 2: task ended, user hasn't resolved it yet ─────────────────
        // Keep task_name / task_end_ms in SharedPrefs so the widget can show
        // "TIME'S UP · <task name> · Tap to resolve" without the app running.
        const endMs   = new Date(awaiting.endTime).getTime();
        const startMs = new Date(awaiting.startTime).getTime();
        await SharedPrefsModule.setActiveTask(awaiting.id, awaiting.title, endMs, null);
        await SharedPrefsModule.setActiveTaskColor(awaiting.color ?? '');
        await SharedPrefsModule.setActiveTaskStartMs(awaiting.id, startMs);
        await SharedPrefsModule.putString('task_awaiting_decision', 'true');
        await SharedPrefsModule.putString('next_upcoming_name', '');
        await SharedPrefsModule.putString('next_upcoming_start_ms', '0');
        await SharedPrefsModule.pushWidgetUpdate();
      } else {
        // ── State 3 / 4 / 5: idle ────────────────────────────────────────────
        await SharedPrefsModule.clearActiveTask();
        await SharedPrefsModule.putString('task_awaiting_decision', '');

        // Show the next upcoming task in the widget if one exists today
        const upcoming = getUpcomingTask(s.tasks);
        if (upcoming) {
          await SharedPrefsModule.putString('next_upcoming_name', upcoming.title);
          await SharedPrefsModule.putString(
            'next_upcoming_start_ms',
            String(new Date(upcoming.startTime).getTime()),
          );
        } else {
          await SharedPrefsModule.putString('next_upcoming_name', '');
          await SharedPrefsModule.putString('next_upcoming_start_ms', '0');
        }
        // Standalone-block state may still be active — push so the widget
        // re-renders to the standalone or idle state immediately.
        await SharedPrefsModule.pushWidgetUpdate();
      }
    } catch (e) {
      void logger.warn('AppContext', `widget sync failed: ${String(e)}`);
    }
  }

  // ── React-driven widget refresh ──────────────────────────────────────────────
  // Whenever the task list, focus session, or standalone-block state changes,
  // push a fresh snapshot to the widget so the home screen reflects reality
  // immediately (start / end / extend / complete / skip / block toggle all
  // mutate one of these dependencies).
  useEffect(() => {
    if (!state.isDbReady) return;
    void _syncWidget(state);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    state.isDbReady,
    state.tasks,
    state.focusSession,
    state.settings.standaloneBlockUntil,
    state.settings.standaloneBlockPackages,
  ]);

  // ── Daily-stats snapshot for the widget ────────────────────────────────────
  // Pushes today's progress (tasks done/total, focus minutes, streak) into
  // SharedPreferences whenever the task list or focus session changes. The
  // widget reads these to show "Done · 3/5 tasks · 45m today" and a 🔥 streak
  // chip in idle / next-up / active states. Wrapped in a single try/catch so
  // a DB read failure never breaks the UI thread.
  useEffect(() => {
    if (!state.isDbReady) return;
    let cancelled = false;
    (async () => {
      try {
        const todayTasks = getTodayTasks(state.tasks);
        const tasksTotal = todayTasks.length;
        const tasksDone  = todayTasks.filter((t) => t.status === 'completed').length;
        const [focusMins, streak] = await Promise.all([
          dbGetTodayFocusMinutes().catch(() => 0),
          dbGetStreak().catch(() => 0),
        ]);
        if (cancelled) return;
        await SharedPrefsModule.setDailyStats(tasksDone, tasksTotal, focusMins, streak);
      } catch (e) {
        void logger.warn('AppContext', `daily-stats sync failed: ${String(e)}`);
      }
    })();
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    state.isDbReady,
    state.tasks,
    state.focusSession,
  ]);

  // ── Precise expiry timer: clears standalone block the moment it expires ───────
  // Fires a one-shot setTimeout set to the exact expiry ms so the UI updates
  // immediately rather than waiting up to 30 s for the next tick.

  useEffect(() => {
    const until = state.settings.standaloneBlockUntil;
    if (!until) return;
    const msUntilExpiry = new Date(until).getTime() - Date.now();
    if (msUntilExpiry <= 0) return;
    const t = setTimeout(() => {
      void _syncStandaloneBlock(stateRef.current.settings);
    }, msUntilExpiry + 500); // +500 ms buffer so the clock has definitely passed
    return () => clearTimeout(t);
  }, [state.settings.standaloneBlockUntil]);

  // ── Auto-start focus mode when active task has focusMode: true ───────────────
  // Runs when the active task changes. If the task was created with focusMode
  // enabled and no focus session is running yet, activate silently (no goHome).

  useEffect(() => {
    const active = getActiveTask(stateRef.current.tasks);
    if (active && active.focusMode && stateRef.current.settings.focusModeEnabled && stateRef.current.focusSession === null && !isFocusActive()) {
      // Task-specific allowed packages take priority over the global list when auto-starting.
      const autoAllowed =
        active.focusAllowedPackages !== undefined
          ? active.focusAllowedPackages
          : stateRef.current.settings.allowedInFocus;
      void _startFocusMode(
        active,
        autoAllowed,
        (app) => {
          dispatch({ type: 'SET_FOCUS_VIOLATION', payload: app });
          setTimeout(() => dispatch({ type: 'SET_FOCUS_VIOLATION', payload: null }), 4000);
        },
        { skipGoHome: true },
      ).then(() => {
        const session: FocusSession = {
          taskId: active.id,
          startedAt: new Date().toISOString(),
          isActive: true,
          allowedPackages: autoAllowed,
        };
        dispatch({ type: 'SET_FOCUS_SESSION', payload: session });
      }).catch(() => {});
    }
  // Re-run when the active task identity changes (new task or task cleared)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.tasks]);

  // ── Prompt user to resolve past unresolved tasks when a new task starts ──────
  // When a new task becomes active while a previous task is still awaiting a
  // decision (ended without Complete / Extend / Skip), show an Alert so the
  // user is never silently moved on without resolving their work.

  useEffect(() => {
    if (!state.isDbReady) return;
    const tasks = state.tasks;
    const active = getActiveTask(tasks);
    // Only prompt when there is a fresh active task — no active task means
    // the user is between tasks or in idle, and we don't want to nag then.
    if (!active) return;

    const unresolved = tasks.filter(
      (t) => t.id !== active.id && isAwaitingDecision(t),
    );

    for (const t of unresolved) {
      if (alertedUnresolvedRef.current.has(t.id)) continue;
      alertedUnresolvedRef.current.add(t.id);
      Alert.alert(
        'Previous Task Unresolved',
        `"${t.title}" ended without being marked done or skipped.\n\nDid you complete it?`,
        [
          {
            text: 'Mark Done',
            onPress: () => {
              void (async () => {
                try {
                  const updated = { ...t, status: 'completed' as const, updatedAt: new Date().toISOString() };
                  await dbUpdateTask(updated);
                  dispatch({ type: 'UPDATE_TASK', payload: updated });
                } catch { /* non-fatal */ }
              })();
            },
          },
          {
            text: 'Skip It',
            style: 'destructive',
            onPress: () => {
              void (async () => {
                try {
                  const updated = { ...t, status: 'skipped' as const, updatedAt: new Date().toISOString() };
                  await dbUpdateTask(updated);
                  dispatch({ type: 'UPDATE_TASK', payload: updated });
                } catch { /* non-fatal */ }
              })();
            },
          },
          { text: 'Keep Working', style: 'cancel' },
        ],
        { cancelable: false },
      );
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.isDbReady, state.tasks]);

  // ── Native event subscriptions ───────────────────────────────────────────────

  useEffect(() => {
    const unsubTaskEnded = EventBridge.subscribe('TASK_ENDED', () => {
      // Do NOT auto-stop focus or hide the task. The user must explicitly
      // resolve the task (Complete / Extend / Skip) via the in-app prompt.
      // Keeping focus mode running prevents distractions while they decide.
      void logger.info('AppContext', 'TASK_ENDED received — awaiting user decision');
    });

    const unsubAppBlocked = EventBridge.subscribe('APP_BLOCKED', (event) => {
      dispatch({ type: 'SET_FOCUS_VIOLATION', payload: event.blockedApp ?? null });
    });

    return () => {
      unsubTaskEnded();
      unsubAppBlocked();
    };
  }, []);

  // ── Tasks ───────────────────────────────────────────────────────────────────

  const refreshTasks = useCallback(async () => {
    try {
      const todayTasks = await dbGetTasksForDate(new Date().toISOString());
      // Also include tasks from the last 24 hours that are still unresolved so
      // they stay visible on the Focus tab after midnight. The user will be
      // prompted to resolve them when a new task or block session starts.
      const recentUnresolved = await dbGetRecentUnresolvedTasks();
      const todayIds = new Set(todayTasks.map((t) => t.id));
      const merged = [
        ...todayTasks,
        ...recentUnresolved.filter((t) => !todayIds.has(t.id)),
      ];
      dispatch({ type: 'SET_TASKS', payload: merged });
    } catch (e) {
      void logger.warn('AppContext', `refreshTasks failed: ${String(e)}`);
    }
  }, []);

  const addTask = useCallback(async (task: Task) => {
    try {
      await dbInsertTask(task);
      dispatch({ type: 'ADD_TASK', payload: task });
      await scheduleTaskReminders(task);
    } catch (e) {
      void logger.error('AppContext', `addTask failed: ${String(e)}`);
      throw e;
    }
  }, []);

  const updateTask = useCallback(async (task: Task) => {
    try {
      await dbUpdateTask(task);
      dispatch({ type: 'UPDATE_TASK', payload: task });
      await cancelTaskReminders(task.id);
      await scheduleTaskReminders(task);
    } catch (e) {
      void logger.error('AppContext', `updateTask failed: ${String(e)}`);
      throw e;
    }
  }, []);

  const deleteTask = useCallback(async (taskId: string) => {
    try {
      await dbDeleteTask(taskId);
      await cancelTaskReminders(taskId);
      dispatch({ type: 'DELETE_TASK', payload: taskId });
    } catch (e) {
      void logger.error('AppContext', `deleteTask failed: ${String(e)}`);
      throw e;
    }
  }, []);

  // Guard against concurrent extend calls — prevents stale-state double-writes.
  const extendingRef = useRef(false);

  const completeTask = useCallback(
    async (taskId: string) => {
      const tasks = stateRef.current.tasks;
      const task = tasks.find((t) => t.id === taskId);
      if (!task) return;
      try {
        const updated = updateTaskStatus(task, 'completed');
        await dbUpdateTask(updated);
        await cancelTaskReminders(taskId);
        // Dismiss the full-screen task-end alarm if it is currently ringing
        // for this task — keeps the alarm UI in sync with in-app resolution.
        void TaskAlarmModule.dismissAlarm(taskId);
        dispatch({ type: 'UPDATE_TASK', payload: updated });
        if (stateRef.current.focusSession?.taskId === taskId) {
          await stopFocusMode();
        }
      } catch (e) {
        void logger.error('AppContext', `completeTask failed: ${String(e)}`);
        throw e;
      }
    },
    // stateRef is a stable ref — no deps needed
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const skipTask = useCallback(
    async (taskId: string) => {
      const tasks = stateRef.current.tasks;
      const task = tasks.find((t) => t.id === taskId);
      if (!task) return;
      try {
        const updated = updateTaskStatus(task, 'skipped');
        await dbUpdateTask(updated);
        await cancelTaskReminders(taskId);
        void TaskAlarmModule.dismissAlarm(taskId);
        dispatch({ type: 'UPDATE_TASK', payload: updated });
      } catch (e) {
        void logger.error('AppContext', `skipTask failed: ${String(e)}`);
        throw e;
      }
    },
    [],
  );

  const extendTaskTime = useCallback(
    async (taskId: string, extraMinutes: number) => {
      // Prevent concurrent extend calls — second tap is silently ignored.
      if (extendingRef.current) return;
      extendingRef.current = true;
      try {
        // Always read from the ref so we get the latest tasks even if the
        // closure was captured before a previous extend dispatch resolved.
        const tasks = stateRef.current.tasks;
        const task = tasks.find((t) => t.id === taskId);
        if (!task) return;

        const extended = extendTask(task, extraMinutes);

        const { updatedSchedule, needsUserConfirm, skipped, shifted } = rebalanceAfterOverrun(extended, extraMinutes, tasks);

        await dbUpdateTask(extended);
        for (const t of updatedSchedule) {
          if (t.id !== extended.id) await dbUpdateTask(t);
        }

        const updatedById = new Map(updatedSchedule.map((t) => [t.id, t]));
        const finalTasks = tasks.map((t) => {
          if (t.id === extended.id) return extended;
          return updatedById.get(t.id) ?? t;
        });
        dispatch({ type: 'SET_TASKS', payload: finalTasks });

        // Reschedule the extended task at its new end time
        await cancelTaskReminders(taskId);
        await scheduleTaskReminders(extended);

        // Reschedule every task that was shifted to new times — their old
        // pre-start / mid-session / end notifications would fire at wrong times.
        for (const t of shifted) {
          await cancelTaskReminders(t.id);
          await scheduleTaskReminders(t);
        }

        // Cancel notifications for tasks the scheduler auto-skipped — they
        // are no longer going to run so their reminders should not fire.
        for (const t of skipped) {
          await cancelTaskReminders(t.id);
        }

        // Dismiss the full-screen task-end alarm only after the extension has
        // been persisted — keeps the alarm UI in sync with task state so a
        // mid-flight failure leaves the alarm ringing for the user to retry.
        void TaskAlarmModule.dismissAlarm(taskId);

        // If this task is the one currently in focus, update the foreground notification
        // with the new end time so the countdown shows the correct remaining time.
        if (stateRef.current.focusSession?.taskId === taskId) {
          const newEndMs = new Date(extended.endTime).getTime();
          const nextTask = finalTasks.find(
            (t) => t.id !== extended.id && new Date(t.startTime).getTime() >= newEndMs
          );
          await ForegroundServiceModule.updateNotification(
            extended.id,
            extended.title,
            newEndMs,
            nextTask?.title ?? null,
          );
          // Also update the SharedPrefs task_end_ms so the widget and AccessibilityService
          // see the new end time immediately.
          await SharedPrefsModule.setActiveTask(
            extended.id,
            extended.title,
            newEndMs,
            nextTask?.title ?? null,
          );
        }

        if (needsUserConfirm.length > 0) {
          const names = needsUserConfirm.map((t) => `• ${t.title}`).join('\n');
          Alert.alert(
            '⚠️ Critical Tasks Affected',
            `These high-priority tasks overlap with your extension and need your attention:\n\n${names}\n\nPlease review and reschedule them manually.`,
            [{ text: 'OK' }],
          );
        }
        if (skipped.length > 0) {
          const names = skipped.map((t) => `• ${t.title}`).join('\n');
          Alert.alert(
            'Tasks Auto-Skipped',
            `These lower-priority tasks were skipped to protect your schedule:\n\n${names}`,
            [{ text: 'OK' }],
          );
        }
      } finally {
        extendingRef.current = false;
      }
    },
    [],
  );

  // The native ForegroundTaskService fires NOTIF_ACTION when the user taps a
  // button on the persistent focus notification. We handle it here so the app
  // does not need to be open for task state to update.
  // NOTE: must live after completeTask / extendTaskTime / skipTask declarations
  // to avoid a const-TDZ error when the dependency array is evaluated.
  useEffect(() => {
    const unsubNotifAction = EventBridge.subscribe('NOTIF_ACTION', (event) => {
      const { notifAction, taskId, minutes } = event;
      if (!taskId || !notifAction) return;
      if (notifAction === 'COMPLETE') {
        void completeTask(taskId);
      } else if (notifAction === 'EXTEND') {
        void extendTaskTime(taskId, minutes ?? 15);
      } else if (notifAction === 'SKIP') {
        void skipTask(taskId);
      }
    });
    return () => { unsubNotifAction(); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [completeTask, extendTaskTime, skipTask]);

  // ── Focus Mode ──────────────────────────────────────────────────────────────

  const startFocusMode = useCallback(
    async (taskId: string) => {
      const task = state.tasks.find((t) => t.id === taskId);
      if (!task) return;

      // Task-specific allowed packages take priority over the global setting.
      // undefined → fall back to global; [] → all allowed; [...] → specific list.
      const allowedPackages =
        task.focusAllowedPackages !== undefined
          ? task.focusAllowedPackages
          : state.settings.allowedInFocus;

      try {
        await _startFocusMode(task, allowedPackages, (app) => {
          dispatch({ type: 'SET_FOCUS_VIOLATION', payload: app });
          setTimeout(() => dispatch({ type: 'SET_FOCUS_VIOLATION', payload: null }), 4000);
        });

        const session: FocusSession = {
          taskId: task.id,
          startedAt: new Date().toISOString(),
          isActive: true,
          allowedPackages,
        };
        dispatch({ type: 'SET_FOCUS_SESSION', payload: session });
      } catch (e) {
        void logger.error('AppContext', `startFocusMode failed: ${String(e)}`);
        throw e;
      }
    },
    [state.tasks, state.settings.allowedInFocus],
  );

  const stopFocusMode = useCallback(async () => {
    // Always attempt native teardown directly — _stopFocusMode() short-circuits
    // when focusActive is false (e.g. after a cold app restart), so we call
    // the native layer unconditionally here to guarantee the foreground service
    // and SharedPrefs are cleared regardless of JS module state.
    try {
      await _stopFocusMode();
    } catch (e) {
      void logger.warn('AppContext', `stopFocusMode JS-layer failed: ${String(e)}`);
    }
    try {
      await ForegroundServiceModule.stopService();
    } catch { /* already stopped */ }
    try {
      await SharedPrefsModule.setFocusActive(false);
      await SharedPrefsModule.setAllowedPackages([]);
    } catch { /* best-effort */ }
    dispatch({ type: 'SET_FOCUS_SESSION', payload: null });
  }, []);

  // ── Settings ─────────────────────────────────────────────────────────────────

  const updateSettings = useCallback(async (settings: AppSettings) => {
    try {
      await dbSaveSettings(settings);
      dispatch({ type: 'SET_SETTINGS', payload: settings });
      if (state.focusSession !== null) {
        await SharedPrefsModule.setAllowedPackages(
          settings.allowedInFocus.filter((p) => p.includes('.')),
        );
      }
      // Always sync standalone block — it works independently of task focus.
      await _syncStandaloneBlock(settings);
      // Sync daily allowance packages.
      await _syncDailyAllowance(settings);
      // Sync aversion deterrent flags.
      await _syncAversions(settings);
      // Sync greyout schedule (combined: user windows + recurring schedule windows).
      const combinedGreyout = _recurringSchedulesToGreyoutWindows(settings);
      await GreyoutModule.setSchedule(combinedGreyout).catch((e) =>
        void logger.warn('AppContext', `greyout sync failed: ${String(e)}`),
      );
      await _syncSystemGuard(settings);
    } catch (e) {
      void logger.error('AppContext', `updateSettings failed: ${String(e)}`);
      throw e;
    }
  }, [state.focusSession]);

  /**
   * Enable or disable standalone app blocking.
   * Writes to both the SQLite settings and SharedPreferences (native layer).
   *
   * @param packages  Package names to block (empty array = disable)
   * @param untilMs   Epoch ms when block expires (null = disable)
   */
  const setDailyAllowanceEntries = useCallback(async (entries: DailyAllowanceEntry[]) => {
    const newSettings: AppSettings = {
      ...state.settings,
      dailyAllowanceEntries: entries,
    };
    await dbSaveSettings(newSettings);
    dispatch({ type: 'SET_SETTINGS', payload: newSettings });
    await SharedPrefsModule.setDailyAllowanceConfig(entries);
  }, [state.settings]);

  const setBlockedWords = useCallback(async (words: string[]) => {
    const newSettings: AppSettings = {
      ...state.settings,
      blockedWords: words,
    };
    await dbSaveSettings(newSettings);
    dispatch({ type: 'SET_SETTINGS', payload: newSettings });
    await SharedPrefsModule.setBlockedWords(words);
  }, [state.settings]);

  const setRecurringBlockSchedules = useCallback(async (schedules: RecurringBlockSchedule[]) => {
    const newSettings: AppSettings = {
      ...state.settings,
      recurringBlockSchedules: schedules,
    };
    await dbSaveSettings(newSettings);
    dispatch({ type: 'SET_SETTINGS', payload: newSettings });
    // Sync combined greyout windows (user windows + recurring schedule windows)
    const combined = _recurringSchedulesToGreyoutWindows(newSettings);
    await GreyoutModule.setSchedule(combined).catch((e) =>
      void logger.warn('AppContext', `greyout sync (recurring) failed: ${String(e)}`),
    );
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.settings]);

  const setStandaloneBlock = useCallback(async (packages: string[], untilMs: number | null) => {
    const untilIso = untilMs ? new Date(untilMs).toISOString() : null;
    const newSettings: AppSettings = {
      ...state.settings,
      standaloneBlockPackages: packages,
      standaloneBlockUntil: untilIso,
    };
    await dbSaveSettings(newSettings);
    dispatch({ type: 'SET_SETTINGS', payload: newSettings });
    const active = packages.length > 0 && untilMs !== null && untilMs > Date.now();
    await SharedPrefsModule.setStandaloneBlock(active, packages, untilMs ?? 0);
    // Schedule or cancel the expiry warning notification
    if (active && untilMs) {
      void scheduleStandaloneBlockExpiry(untilMs, packages.length).catch(() => {});
    } else {
      void cancelStandaloneBlockExpiry().catch(() => {});
    }
  }, [state.settings]);

  /**
   * Atomically saves standalone block settings AND daily allowance entries
   * in a single DB write and single state dispatch.
   *
   * This prevents the stale-closure bug that occurs when setStandaloneBlock
   * and setDailyAllowanceEntries are called back-to-back from the block
   * schedule modal — where the second call would overwrite the first with
   * stale state.settings, erasing the newly saved standalone block.
   */
  const setStandaloneBlockAndAllowance = useCallback(async (
    packages: string[],
    untilMs: number | null,
    allowanceEntries: DailyAllowanceEntry[],
  ) => {
    const untilIso = untilMs ? new Date(untilMs).toISOString() : null;
    const newSettings: AppSettings = {
      ...state.settings,
      standaloneBlockPackages: packages,
      standaloneBlockUntil: untilIso,
      dailyAllowanceEntries: allowanceEntries,
    };
    await dbSaveSettings(newSettings);
    dispatch({ type: 'SET_SETTINGS', payload: newSettings });
    const active = packages.length > 0 && untilMs !== null && untilMs > Date.now();
    await SharedPrefsModule.setStandaloneBlock(active, packages, untilMs ?? 0);
    await SharedPrefsModule.setDailyAllowanceConfig(allowanceEntries);
    // Schedule or cancel the expiry warning notification
    if (active && untilMs) {
      void scheduleStandaloneBlockExpiry(untilMs, packages.length).catch(() => {});
    } else {
      void cancelStandaloneBlockExpiry().catch(() => {});
    }
  }, [state.settings]);

  // ── Derived ──────────────────────────────────────────────────────────────────

  const todayTasks = getTodayTasks(state.tasks);
  const activeTask = getActiveTask(state.tasks);
  const currentTask = getCurrentTask(state.tasks);
  const activeTasks = getAllActiveTasks(state.tasks);

  const value: AppContextValue = {
    state,
    todayTasks,
    activeTask,
    currentTask,
    activeTasks,
    addTask,
    updateTask,
    deleteTask,
    completeTask,
    skipTask,
    extendTaskTime,
    startFocusMode,
    stopFocusMode,
    updateSettings,
    setStandaloneBlock,
    setStandaloneBlockAndAllowance,
    setDailyAllowanceEntries,
    setBlockedWords,
    setRecurringBlockSchedules,
    refreshTasks,
  };

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp(): AppContextValue {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp must be used within AppProvider');
  return ctx;
}
