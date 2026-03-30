import React, {
  createContext,
  useContext,
  useEffect,
  useReducer,
  useCallback,
  useRef,
} from 'react';
import { Alert } from 'react-native';
import type { Task, AppSettings, FocusSession } from '@/data/types';
import {
  dbGetTasksForDate,
  dbInsertTask,
  dbUpdateTask,
  dbDeleteTask,
  dbGetSettings,
  dbSaveSettings,
  dbGetActiveFocusSession,
} from '@/data/database';
import {
  getTodayTasks,
  getActiveTask,
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
} from '@/services/notificationService';
import {
  startFocusMode as _startFocusMode,
  stopFocusMode as _stopFocusMode,
  isFocusActive,
} from '@/services/focusService';
import { SharedPrefsModule } from '@/native-modules/SharedPrefsModule';
import { EventBridge } from '@/services/eventBridge';

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
  darkMode: false,
  defaultDuration: 60,
  defaultReminderOffsets: [-10, -5, 0],
  focusModeEnabled: true,
  allowedInFocus: [
    'com.android.phone',
    'com.android.dialer',
    'com.google.android.dialer',
    'com.whatsapp',
    'com.samsung.android.incallui',
  ],
  pomodoroEnabled: false,
  pomodoroDuration: 25,
  pomodoroBreak: 5,
  notificationsEnabled: true,
  onboardingComplete: false,
};

const initialState: AppState = {
  tasks: [],
  settings: defaultSettings,
  focusSession: null,
  focusViolationApp: null,
  isLoading: true,
  isDbReady: false,
};

// ─── Context ──────────────────────────────────────────────────────────────────

interface AppContextValue {
  state: AppState;
  todayTasks: Task[];
  activeTask: Task | null;

  addTask: (task: Task) => Promise<void>;
  updateTask: (task: Task) => Promise<void>;
  deleteTask: (taskId: string) => Promise<void>;
  completeTask: (taskId: string) => Promise<void>;
  skipTask: (taskId: string) => Promise<void>;
  extendTaskTime: (taskId: string, extraMinutes: number) => Promise<void>;

  startFocusMode: (taskId: string) => Promise<void>;
  stopFocusMode: () => Promise<void>;

  updateSettings: (settings: AppSettings) => Promise<void>;
  refreshTasks: () => Promise<void>;
}

const AppContext = createContext<AppContextValue | null>(null);

// ─── Provider ─────────────────────────────────────────────────────────────────

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [state, dispatch] = useReducer(reducer, initialState);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── Initialize ──────────────────────────────────────────────────────────────

  useEffect(() => {
    void init();
    return () => {
      if (tickRef.current) clearInterval(tickRef.current);
    };
  }, []);

  async function init() {
    dispatch({ type: 'SET_LOADING', payload: true });
    try {
      await setupNotificationChannels();
      await requestPermissions();

      const settings = await dbGetSettings();
      dispatch({ type: 'SET_SETTINGS', payload: settings });
      dispatch({ type: 'SET_DB_READY' });

      await refreshTasks();

      // Recover tasks that were still "scheduled" when the app was killed/restarted
      const allTasks = await dbGetTasksForDate(new Date().toISOString());
      const overdue = getUnfinishedOverdueTasks(allTasks);
      for (const t of overdue) {
        const marked = updateTaskStatus(t, 'overdue');
        await dbUpdateTask(marked);
      }
      if (overdue.length > 0) await refreshTasks();

      const activeSession = await dbGetActiveFocusSession();
      if (activeSession) {
        dispatch({ type: 'SET_FOCUS_SESSION', payload: activeSession });
      }
    } catch (e) {
      console.error('[AppContext] init error', e);
    } finally {
      dispatch({ type: 'SET_LOADING', payload: false });
    }
  }

  // ── Keep a ref to latest state so the tick interval never needs to re-create ─
  // (fixes NEW-021: setInterval restarting on every task/settings change)
  const stateRef = useRef(state);
  useEffect(() => {
    stateRef.current = state;
  });

  // ── Tick: check active tasks every 30s ──────────────────────────────────────
  // Only recreated when DB readiness changes — state is read via stateRef.

  useEffect(() => {
    if (!state.isDbReady) return;
    tickRef.current = setInterval(() => {
      const active = getActiveTask(stateRef.current.tasks);
      // NOTE: The native ForegroundTaskService already shows a persistent
      // notification while focus is active (NEW-011). No JS sticky needed here.
      if (!active && isFocusActive()) {
        void _stopFocusMode();
        dispatch({ type: 'SET_FOCUS_SESSION', payload: null });
      }
    }, 30000);
    return () => {
      if (tickRef.current) clearInterval(tickRef.current);
    };
  }, [state.isDbReady]);

  // ── Native event subscriptions ───────────────────────────────────────────────

  useEffect(() => {
    const unsubTaskEnded = EventBridge.subscribe('TASK_ENDED', () => {
      void _stopFocusMode();
      dispatch({ type: 'SET_FOCUS_SESSION', payload: null });
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
    const tasks = await dbGetTasksForDate(new Date().toISOString());
    dispatch({ type: 'SET_TASKS', payload: tasks });
  }, []);

  const addTask = useCallback(async (task: Task) => {
    await dbInsertTask(task);
    dispatch({ type: 'ADD_TASK', payload: task });
    await scheduleTaskReminders(task);
  }, []);

  const updateTask = useCallback(async (task: Task) => {
    await dbUpdateTask(task);
    dispatch({ type: 'UPDATE_TASK', payload: task });
    await cancelTaskReminders(task.id);
    await scheduleTaskReminders(task);
  }, []);

  const deleteTask = useCallback(async (taskId: string) => {
    await dbDeleteTask(taskId);
    await cancelTaskReminders(taskId);
    dispatch({ type: 'DELETE_TASK', payload: taskId });
  }, []);

  const completeTask = useCallback(
    async (taskId: string) => {
      const task = state.tasks.find((t) => t.id === taskId);
      if (!task) return;
      const updated = updateTaskStatus(task, 'completed');
      await dbUpdateTask(updated);
      await cancelTaskReminders(taskId);
      dispatch({ type: 'UPDATE_TASK', payload: updated });
      if (state.focusSession?.taskId === taskId) {
        await stopFocusMode();
      }
    },
    [state.tasks, state.focusSession],
  );

  const skipTask = useCallback(
    async (taskId: string) => {
      const task = state.tasks.find((t) => t.id === taskId);
      if (!task) return;
      const updated = updateTaskStatus(task, 'skipped');
      await dbUpdateTask(updated);
      await cancelTaskReminders(taskId);
      dispatch({ type: 'UPDATE_TASK', payload: updated });
    },
    [state.tasks],
  );

  const extendTaskTime = useCallback(
    async (taskId: string, extraMinutes: number) => {
      const task = state.tasks.find((t) => t.id === taskId);
      if (!task) return;

      const extended = extendTask(task, extraMinutes);

      const { updatedSchedule, needsUserConfirm, skipped } = rebalanceAfterOverrun(extended, extraMinutes, state.tasks);

      await dbUpdateTask(extended);
      for (const t of updatedSchedule) {
        if (t.id !== extended.id) await dbUpdateTask(t);
      }

      const finalTasks = updatedSchedule.map((t) => (t.id === extended.id ? extended : t));
      dispatch({ type: 'SET_TASKS', payload: finalTasks });

      await cancelTaskReminders(taskId);
      await scheduleTaskReminders(extended);

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
    },
    [state.tasks],
  );

  // ── Focus Mode ──────────────────────────────────────────────────────────────

  const startFocusMode = useCallback(
    async (taskId: string) => {
      const task = state.tasks.find((t) => t.id === taskId);
      if (!task) return;

      await _startFocusMode(task, state.settings.allowedInFocus, (app) => {
        dispatch({ type: 'SET_FOCUS_VIOLATION', payload: app });
        setTimeout(() => dispatch({ type: 'SET_FOCUS_VIOLATION', payload: null }), 4000);
      });

      const session: FocusSession = {
        taskId: task.id,
        startedAt: new Date().toISOString(),
        isActive: true,
        allowedPackages: state.settings.allowedInFocus,
      };
      dispatch({ type: 'SET_FOCUS_SESSION', payload: session });
    },
    [state.tasks, state.settings.allowedInFocus],
  );

  const stopFocusMode = useCallback(async () => {
    await _stopFocusMode();
    dispatch({ type: 'SET_FOCUS_SESSION', payload: null });
  }, []);

  // ── Settings ─────────────────────────────────────────────────────────────────

  const updateSettings = useCallback(async (settings: AppSettings) => {
    await dbSaveSettings(settings);
    dispatch({ type: 'SET_SETTINGS', payload: settings });
    if (state.focusSession !== null) {
      await SharedPrefsModule.setAllowedPackages(
        settings.allowedInFocus.filter((p) => p.includes('.')),
      );
    }
  }, [state.focusSession]);

  // ── Derived ──────────────────────────────────────────────────────────────────

  const todayTasks = getTodayTasks(state.tasks);
  const activeTask = getActiveTask(state.tasks);

  const value: AppContextValue = {
    state,
    todayTasks,
    activeTask,
    addTask,
    updateTask,
    deleteTask,
    completeTask,
    skipTask,
    extendTaskTime,
    startFocusMode,
    stopFocusMode,
    updateSettings,
    refreshTasks,
  };

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp(): AppContextValue {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp must be used within AppProvider');
  return ctx;
}
