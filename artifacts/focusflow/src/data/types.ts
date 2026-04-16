export type TaskStatus = 'scheduled' | 'active' | 'completed' | 'skipped' | 'overdue';
export type TaskPriority = 'low' | 'medium' | 'high' | 'critical';
export type ReminderType = 'pre-start' | 'at-start' | 'post-start';

export type AllowanceMode = 'count' | 'time_budget' | 'interval';

export interface DailyAllowanceEntry {
  packageName: string;
  mode: AllowanceMode;
  countPerDay: number;       // count mode: max opens per day (min 1, default 1)
  budgetMinutes: number;     // time_budget mode: total minutes per day (default 30)
  intervalMinutes: number;   // interval mode: minutes allowed per window (default 5)
  intervalHours: number;     // interval mode: window size in hours (default 1)
}

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

export interface GreyoutWindow {
  pkg: string;
  startHour: number;
  startMin: number;
  endHour: number;
  endMin: number;
  days: number[]; // Calendar.DAY_OF_WEEK: 1=Sun 2=Mon 3=Tue 4=Wed 5=Thu 6=Fri 7=Sat
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
  privacyAccepted: boolean;
  // Standalone app blocking — independent of any task
  standaloneBlockPackages: string[]; // packages to always block regardless of task state
  standaloneBlockUntil: string | null; // ISO timestamp when the standalone block expires
  allowedAppPresets: AllowedAppPreset[]; // saved preset allow-lists
  // Per-app daily allowance — replaces old dailyAllowancePackages: string[]
  // Each entry configures a specific allowance mode for an app:
  //   count:       allowed N opens per day (resets midnight)
  //   time_budget: allowed N total minutes per day (resets midnight)
  //   interval:    allowed N minutes every X hours (rolling window)
  dailyAllowanceEntries: DailyAllowanceEntry[];
  // Word blocking: if any of these words appear on screen during an active blocking session
  // (task focus or standalone block), the user is immediately redirected to home.
  blockedWords: string[];
  // Aversion deterrents — each applied the instant a blocked app is detected
  aversionDimmerEnabled: boolean;   // near-black WindowManager overlay (dark screen)
  aversionVibrateEnabled: boolean;  // repeated vibration pulse while app is open
  aversionSoundEnabled: boolean;    // alert sound the moment the blocked app opens
  // Temptation report
  weeklyReportEnabled: boolean;     // Sunday notification with blocked-app attempt counts
  // Greyout schedule — time-window blocks independent of any focus session
  greyoutSchedule: GreyoutWindow[];
  // Block overlay appearance
  overlayWallpaper?: string;        // Absolute path to custom background image (empty = use gradient)
  overlayQuotes?: string[];         // Custom quote pool (empty = use built-in quotes)
}
