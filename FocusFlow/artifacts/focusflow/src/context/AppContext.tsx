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
  dbBackfillDayCompletions,
  dbRecordDayCompletion,
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
import { logBootMarker, logger } from '@/services/startupLogger';

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
  blockInstallActionsEnabled: false,
  blockYoutubeShortsEnabled: false,
  blockInstagramReelsEnabled: false,
  keepFocusActiveUntilTaskEnd: false,
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
  // Ref to the latest tryAutoStartFocus so the long-lived 30 s tick can call
  // it without re-creating the interval whenever the callback identity changes.
  const tryAutoStartFocusRef = useRef<(() => void) | null>(null);
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
    // Drop a clear cold-vs-warm boundary before any other log entry from this
    // session. Cold = first launch since install or last "Clear logs". Warm =
    // any subsequent relaunch where we still have prior session entries on
    // disk. Without this marker, every session looks identical in the shared
    // log file and there's no way to tell which entries belong to which
    // launch — especially confusing when investigating bugs that only repro
    // on the second or third app open.
    try {
      await logBootMarker();
    } catch {
      // Marker is diagnostic only — never let it block init.
    }
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

      // ── Exact alarm permission (Android 12+) ───────────────────────────────
      // Without this permission, AlarmManager.setAlarmClock() fires up to 10
      // minutes late even with USE_EXACT_ALARM declared on certain OEM ROMs,
      // which defeats the entire purpose of an alarm. We only LOG the state
      // here so we don't interrupt boot — a banner in Settings (handled by
      // the Settings screen) takes the user to the system grant screen on
      // demand. The probe itself is a no-op on Android < 12 and on iOS.
      try {
        const exactOk = await TaskAlarmModule.canScheduleExactAlarms();
        void logger.info(
          'AppContext',
          `Exact alarm permission: ${exactOk ? 'granted' : 'denied'}`,
        );
      } catch (e) {
        void logger.warn('AppContext', `Exact alarm probe failed: ${String(e)}`);
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

      // If the DB returned privacyAccepted=false or onboardingComplete=false
      // (e.g. because it fell back to the recovery DB after OEM memory
      // management wiped the DB file), cross-check with SharedPreferences —
      // which survives DB file deletion — before concluding the user needs to
      // re-accept the privacy policy or redo onboarding.  Stops the
      // privacy/onboarding screens from re-appearing randomly between sessions.
      let settings = rawSettings;
      let restoredFromSp = false;
      if (!rawSettings.privacyAccepted) {
        try {
          const spValue = await SharedPrefsModule.getString('privacy_accepted');
          if (spValue === 'true') {
            void logger.info('AppContext', 'privacyAccepted restored from SharedPreferences backup');
            settings = { ...settings, privacyAccepted: true };
            restoredFromSp = true;
          }
        } catch (e) {
          void logger.warn('AppContext', `SharedPrefs privacy backup check failed: ${String(e)}`);
        }
      }
      if (!rawSettings.onboardingComplete) {
        try {
          const spValue = await SharedPrefsModule.getString('onboarding_complete');
          if (spValue === 'true') {
            void logger.info('AppContext', 'onboardingComplete restored from SharedPreferences backup');
            settings = { ...settings, onboardingComplete: true };
            restoredFromSp = true;
          }
        } catch (e) {
          void logger.warn('AppContext', `SharedPrefs onboarding backup check failed: ${String(e)}`);
        }
      }
      if (restoredFromSp) {
        try { await dbSaveSettings(settings); } catch { /* non-fatal — primary path is the in-memory state */ }
      }

      void logger.info('AppContext', 'Dispatching SET_SETTINGS + SET_DB_READY');
      dispatch({ type: 'SET_SETTINGS', payload: settings });
      dispatch({ type: 'SET_DB_READY' });

      // Backfill the daily_completions table from real task history so the
      // streak banner is correct even if the user never opened the Stats tab
      // on a given day. Fire-and-forget — non-fatal if it fails. After the
      // backfill completes we read the current streak and, if it crosses a
      // milestone we haven't celebrated yet, queue a celebration modal.
      void (async () => {
        try {
          await dbBackfillDayCompletions(30);
          const streak = await dbGetStreak();
          const lastShown = settings.lastShownStreakMilestone ?? 0;
          const milestones = [3, 7, 14, 30, 60, 90, 180, 365];
          // The largest milestone the streak has reached AND we haven't shown.
          const due = milestones.filter((m) => streak >= m && m > lastShown).pop();
          if (due) {
            const next = { ...settings, pendingAchievementCelebration: due };
            try { await dbSaveSettings(next); } catch { /* non-fatal */ }
            dispatch({ type: 'SET_SETTINGS', payload: next });
          }
        } catch (e) {
          void logger.warn('AppContext', `streak milestone check failed: ${String(e)}`);
        }
      })();

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
        void logger.info('AppContext', 'Syncing always-on block');
        await _syncAlwaysBlock(settings);
        void logger.info('AppContext', 'Always-on block synced');
      } catch (e) {
        void logger.warn('AppContext', `Always-on block sync failed: ${String(e)}`);
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
   * Syncs always-on block enforcement flag into SharedPreferences.
   *
   * Always-on enforcement is active when the user has configured any standalone
   * blocked packages OR any daily allowance entries — so those rules are
   * enforced at all times, not just during a timed session.
   *
   * This is separate from the "locked" UI state: the UI remains editable when
   * no timed session (focus task or standalone block with expiry) is running.
   */
  async function _syncAlwaysBlock(settings: AppSettings): Promise<void> {
    const packages = settings.standaloneBlockPackages ?? [];
    const allowanceEntries = settings.dailyAllowanceEntries ?? [];
    // Master enforcement switch — when false, the user has explicitly paused
    // the always-on list. Packages stay in `standaloneBlockPackages` so the
    // list isn't lost, but we tell the native side to deactivate enforcement.
    const enforcementOn = settings.alwaysOnEnforcementEnabled !== false;
    const active = enforcementOn && (packages.length > 0 || allowanceEntries.length > 0);
    try {
      // When enforcement is paused we still pass the package list through so
      // the native side knows what would be enforced if re-enabled.
      await SharedPrefsModule.setAlwaysBlockActive(active, packages);
    } catch (e) {
      void logger.warn('AppContext', `always block sync failed: ${String(e)}`);
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
    try {
      await SharedPrefsModule.setBlockInstallActionsEnabled(settings.blockInstallActionsEnabled ?? false);
    } catch (e) {
      void logger.warn('AppContext', `install-actions guard sync failed: ${String(e)}`);
    }
    try {
      await SharedPrefsModule.setBlockYoutubeShortsEnabled(settings.blockYoutubeShortsEnabled ?? false);
    } catch (e) {
      void logger.warn('AppContext', `youtube-shorts guard sync failed: ${String(e)}`);
    }
    try {
      await SharedPrefsModule.setBlockInstagramReelsEnabled(settings.blockInstagramReelsEnabled ?? false);
    } catch (e) {
      void logger.warn('AppContext', `instagram-reels guard sync failed: ${String(e)}`);
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
      // Timer expired: end the timed session but RETAIN the package list so
      // always-on enforcement keeps blocking those apps 24/7. The user
      // explicitly wipes the list via the "Clear list" action on the Focus tab
      // / Standalone Block modal, never automatically.
      try {
        await SharedPrefsModule.setStandaloneBlock(false, packages, 0);
      } catch (e) {
        void logger.warn('AppContext', `expired standalone block clear failed: ${String(e)}`);
      }
      const cleared = { ...settings, standaloneBlockUntil: null };
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
      // Safety net: if the precise focus-mode timer was cleared by an unmount
      // or a hot-reload, the tick still catches the activation within 30 s.
      tryAutoStartFocusRef.current?.();
      // "Keep focus active until task end" enforcement —
      // when the user completed (or skipped) a task BEFORE its scheduled end
      // and chose to keep focus running, we don't stop focus inside completeTask.
      // Instead this tick stops it once we cross task.endTime. Robust across
      // app restarts because the focus session and tasks both live in the DB.
      if (s.focusSession) {
        const linkedTask = s.tasks.find((t) => t.id === s.focusSession?.taskId);
        if (
          linkedTask &&
          (linkedTask.status === 'completed' || linkedTask.status === 'skipped') &&
          new Date(linkedTask.endTime).getTime() <= Date.now()
        ) {
          void stopFocusMode().catch((e) => {
            void logger.warn('AppContext', `tick stopFocusMode failed: ${String(e)}`);
          });
        }
      }
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
  // PROBLEM PREVIOUSLY: this only fired when state.tasks changed. If a task was
  // created in advance (e.g. created at 10:00 to start at 11:00), state.tasks
  // didn't change at 11:00, so the effect never re-ran and focus mode never
  // auto-started — making the per-task "Enable Focus Mode" toggle look broken.
  //
  // NEW DESIGN:
  //   1. tryAutoStartFocus()  — pure function that checks whether the currently
  //      active task wants focus mode and starts it if so. Safe to call any
  //      number of times (guarded by focusSession === null && !isFocusActive()).
  //   2. Run it whenever state.tasks changes (instant if a task is created
  //      already-active or already-late).
  //   3. Schedule a one-shot setTimeout for the *next* future focus-mode task's
  //      startTime so it fires the moment the task becomes active — no waiting
  //      for the 30 s tick.
  //   4. The 30 s tick (further down) also calls it as a safety net.

  const tryAutoStartFocus = useCallback(() => {
    const s = stateRef.current;
    if (!s.settings.focusModeEnabled) return;
    if (s.focusSession !== null) return;
    if (isFocusActive()) return;
    const active = getActiveTask(s.tasks);
    if (!active || !active.focusMode) return;

    // Task-specific allowed packages take priority over the global list.
    const autoAllowed =
      active.focusAllowedPackages !== undefined
        ? active.focusAllowedPackages
        : s.settings.allowedInFocus;
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
  }, []);

  // Keep the long-lived 30 s tick's ref in sync with the latest callback.
  useEffect(() => {
    tryAutoStartFocusRef.current = tryAutoStartFocus;
  }, [tryAutoStartFocus]);

  // (a) Try right away whenever the task list changes.
  useEffect(() => {
    tryAutoStartFocus();
  }, [state.tasks, tryAutoStartFocus]);

  // (b) Schedule a precise one-shot timer for the next future focus-mode task
  // so auto-start fires the *moment* its startTime arrives, not 30 s later.
  useEffect(() => {
    const now = Date.now();
    const nextFocusTask = state.tasks
      .filter(
        (t) =>
          t.focusMode &&
          t.status !== 'completed' &&
          t.status !== 'skipped' &&
          new Date(t.startTime).getTime() > now,
      )
      .sort(
        (a, b) =>
          new Date(a.startTime).getTime() - new Date(b.startTime).getTime(),
      )[0];
    if (!nextFocusTask) return;
    const msUntilStart = new Date(nextFocusTask.startTime).getTime() - now;
    // Cap at ~24 h — beyond that we'll re-schedule on the next state.tasks change.
    if (msUntilStart > 24 * 60 * 60 * 1000) return;
    const t = setTimeout(() => {
      tryAutoStartFocus();
    }, msUntilStart + 250); // small buffer so getActiveTask sees the task as started
    return () => clearTimeout(t);
  }, [state.tasks, tryAutoStartFocus]);

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

        // Record/refresh today's daily-completion row immediately so the
        // streak survives even if the user never opens the Stats tab today.
        try {
          const refreshed = stateRef.current.tasks.map((t) => (t.id === taskId ? updated : t));
          const today = getTodayTasks(refreshed);
          if (today.length > 0) {
            const done = today.filter((t) => t.status === 'completed').length;
            void dbRecordDayCompletion(done, today.length);
          }
        } catch (e) {
          void logger.warn('AppContext', `dbRecordDayCompletion in completeTask failed: ${String(e)}`);
        }
        if (stateRef.current.focusSession?.taskId === taskId) {
          // If the user has opted in to "keep focus running for the full
          // duration", and we're still before the task's scheduled end time,
          // leave the focus session running. The 30 s tick below will stop it
          // automatically once we cross task.endTime — robust across app
          // restarts because both the task (with its endTime) and the focus
          // session live in the DB.
          const keepUntilEnd = stateRef.current.settings.keepFocusActiveUntilTaskEnd ?? false;
          const taskEndMs = new Date(updated.endTime).getTime();
          if (keepUntilEnd && taskEndMs > Date.now()) {
            void logger.info(
              'AppContext',
              `task ${taskId} marked done early; keeping focus active until ${new Date(taskEndMs).toISOString()}`,
            );
          } else {
            await stopFocusMode();
          }
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
    // Optimistic UI: dispatch first so toggles flip instantly. The DB write
    // and the half-dozen native bridge syncs below were previously awaited
    // serially before the dispatch, which made every Switch feel laggy.
    dispatch({ type: 'SET_SETTINGS', payload: settings });
    try {
      await dbSaveSettings(settings);
      // Run all native syncs concurrently — they are independent of each other.
      await Promise.all([
        state.focusSession !== null
          ? SharedPrefsModule.setAllowedPackages(
              settings.allowedInFocus.filter((p) => p.includes('.')),
            )
          : Promise.resolve(),
        _syncStandaloneBlock(settings),
        _syncDailyAllowance(settings),
        _syncAlwaysBlock(settings),
        _syncAversions(settings),
        GreyoutModule.setSchedule(_recurringSchedulesToGreyoutWindows(settings)).catch((e) =>
          void logger.warn('AppContext', `greyout sync failed: ${String(e)}`),
        ),
        _syncSystemGuard(settings),
      ]);
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
    // Enable always-on enforcement whenever allowance entries are configured.
    const packages = newSettings.standaloneBlockPackages ?? [];
    const alwaysActive = packages.length > 0 || entries.length > 0;
    await SharedPrefsModule.setAlwaysBlockActive(alwaysActive, packages).catch(() => {});
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
    // Always enforce the block list even without an active timed session.
    const allowanceEntries = newSettings.dailyAllowanceEntries ?? [];
    const alwaysActive = packages.length > 0 || allowanceEntries.length > 0;
    await SharedPrefsModule.setAlwaysBlockActive(alwaysActive, packages).catch(() => {});
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
    // Always enforce both lists even without an active timed session.
    const alwaysActive = packages.length > 0 || allowanceEntries.length > 0;
    await SharedPrefsModule.setAlwaysBlockActive(alwaysActive, packages).catch(() => {});
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
