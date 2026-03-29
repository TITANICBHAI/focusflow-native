import React, {
  createContext,
  useContext,
  useEffect,
  useReducer,
  useCallback,
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
} from '@/services/schedulerEngine';
import {
  scheduleTaskReminders,
  cancelTaskReminders,
  setupNotificationChannels,
  requestPermissions,
  showPersistentTaskNotification,
  dismissPersistentNotification,
} from '@/services/notificationService';
import {
  startFocusMode as _startFocusMode,
  stopFocusMode as _stopFocusMode,
} from '@/services/focusService';

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

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [state, dispatch] = useReducer(reducer, initialState);

  useEffect(() => {
    async function init() {
      try {
        await setupNotificationChannels();
        await requestPermissions();
        const settings = await dbGetSettings();
        dispatch({ type: 'SET_SETTINGS', payload: settings });
        dispatch({ type: 'SET_DB_READY' });

        const today = new Date().toISOString();
        const tasks = await dbGetTasksForDate(today);
        dispatch({ type: 'SET_TASKS', payload: tasks });

        const activeSession = await dbGetActiveFocusSession();
        if (activeSession) {
          dispatch({ type: 'SET_FOCUS_SESSION', payload: activeSession });
        }
      } catch (e) {
        console.warn('[AppContext] init error', e);
      } finally {
        dispatch({ type: 'SET_LOADING', payload: false });
      }
    }
    void init();
  }, []);

  const refreshTasks = useCallback(async () => {
    const today = new Date().toISOString();
    const tasks = await dbGetTasksForDate(today);
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
    if (task.status !== 'skipped') {
      await scheduleTaskReminders(task);
    }
  }, []);

  const deleteTask = useCallback(async (taskId: string) => {
    await dbDeleteTask(taskId);
    await cancelTaskReminders(taskId);
    dispatch({ type: 'DELETE_TASK', payload: taskId });
  }, []);

  const completeTask = useCallback(async (taskId: string) => {
    const task = state.tasks.find((t) => t.id === taskId);
    if (!task) return;
    const updated = updateTaskStatus(task, 'completed');
    await dbUpdateTask(updated);
    await cancelTaskReminders(taskId);
    dispatch({ type: 'UPDATE_TASK', payload: updated });
  }, [state.tasks]);

  const skipTask = useCallback(async (taskId: string) => {
    const task = state.tasks.find((t) => t.id === taskId);
    if (!task) return;
    const updated = updateTaskStatus(task, 'skipped');
    await dbUpdateTask(updated);
    await cancelTaskReminders(taskId);
    dispatch({ type: 'UPDATE_TASK', payload: updated });
  }, [state.tasks]);

  const extendTaskTime = useCallback(async (taskId: string, extraMinutes: number) => {
    const task = state.tasks.find((t) => t.id === taskId);
    if (!task) return;
    const extended = extendTask(task, extraMinutes);
    const { updatedSchedule } = rebalanceAfterOverrun(extended, 0, state.tasks);
    for (const t of updatedSchedule) {
      await dbUpdateTask(t);
      await cancelTaskReminders(t.id);
      if (t.status !== 'skipped') await scheduleTaskReminders(t);
      dispatch({ type: 'UPDATE_TASK', payload: t });
    }
  }, [state.tasks]);

  const startFocusMode = useCallback(async (taskId: string) => {
    const task = state.tasks.find((t) => t.id === taskId);
    if (!task) return;
    await _startFocusMode(task, state.settings.allowedInFocus, (appName) => {
      dispatch({ type: 'SET_FOCUS_VIOLATION', payload: appName });
    });
    const session: FocusSession = {
      taskId: task.id,
      startedAt: new Date().toISOString(),
      isActive: true,
      allowedPackages: state.settings.allowedInFocus,
    };
    dispatch({ type: 'SET_FOCUS_SESSION', payload: session });
  }, [state.tasks, state.settings.allowedInFocus]);

  const stopFocusMode = useCallback(async () => {
    await _stopFocusMode();
    await dismissPersistentNotification();
    dispatch({ type: 'SET_FOCUS_SESSION', payload: null });
  }, []);

  const updateSettings = useCallback(async (settings: AppSettings) => {
    await dbSaveSettings(settings);
    dispatch({ type: 'SET_SETTINGS', payload: settings });
  }, []);

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
