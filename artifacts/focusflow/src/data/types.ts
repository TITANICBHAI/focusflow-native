export type TaskStatus = 'scheduled' | 'active' | 'completed' | 'skipped' | 'overdue';
export type TaskPriority = 'low' | 'medium' | 'high' | 'critical';
export type ReminderType = 'pre-start' | 'at-start' | 'post-start';

export interface AllowedAppPreset {
  id: string;
  name: string;
  packages: string[]; // [] = "all apps allowed" sentinel
}

export interface Reminder {
  id: string;
  taskId: string;
  offsetMinutes: number; // negative = before start, positive = after start
  type: ReminderType;
  notifId?: string;
}

export interface Task {
  id: string;
  title: string;
  description?: string;
  startTime: string; // ISO string
  endTime: string;   // ISO string
  durationMinutes: number;
  status: TaskStatus;
  priority: TaskPriority;
  tags: string[];
  reminders: Reminder[];
  color: string;
  focusMode: boolean;
  focusAllowedPackages?: string[]; // undefined = use global setting, [] = all allowed, [...] = specific list
  createdAt: string;
  updatedAt: string;
}

export interface FocusSession {
  taskId: string;
  startedAt: string;
  isActive: boolean;
  allowedPackages: string[]; // e.g. com.whatsapp, com.android.phone
}

export interface AppSettings {
  darkMode: boolean;
  defaultDuration: number; // minutes
  defaultReminderOffsets: number[]; // e.g. [-10, -5, 0]
  focusModeEnabled: boolean;
  allowedInFocus: string[]; // Android package names allowed during focus (e.g. com.whatsapp)
  pomodoroEnabled: boolean;
  pomodoroDuration: number; // minutes
  pomodoroBreak: number;    // minutes
  notificationsEnabled: boolean;
  onboardingComplete: boolean;
  // Standalone app blocking — independent of any task
  standaloneBlockPackages: string[]; // packages to always block regardless of task state
  standaloneBlockUntil: string | null; // ISO timestamp when the standalone block expires
  allowedAppPresets: AllowedAppPreset[]; // saved preset allow-lists
  // Once-per-day allowance: these apps are allowed through ONE TIME per calendar day during
  // any blocking session (task focus or standalone block). After the first open, they are
  // blocked for the rest of the day. The counter resets at midnight.
  dailyAllowancePackages: string[];
}
