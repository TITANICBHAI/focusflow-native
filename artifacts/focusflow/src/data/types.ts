export type TaskStatus = 'scheduled' | 'active' | 'completed' | 'skipped' | 'overdue';
export type TaskPriority = 'low' | 'medium' | 'high' | 'critical';
export type ReminderType = 'pre-start' | 'at-start' | 'post-start';

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
}
