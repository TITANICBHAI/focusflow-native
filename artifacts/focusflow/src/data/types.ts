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

export interface BlockPreset {
  id: string;
  name: string;
  packages: string[];
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
  /**
   * True when this task was created from an import (`.focusflow` envelope,
   * Stay Focused export, etc.) and represents a historical session from
   * another device / blocker. Imported tasks are excluded from live alarm
   * scheduling and from "current task" queries, but kept in stats history.
   */
  imported?: boolean;
  /** ISO timestamp when this task was imported. Empty if `imported` is false. */
  importedAt?: string;
}

export interface FocusSession {
  taskId: string;
  startedAt: string;
  isActive: boolean;
  allowedPackages: string[]; // e.g. com.whatsapp, com.android.phone
}

export interface GreyoutWindow {
  /** Primary package name (backward-compat; always equals pkgs[0] when pkgs is set). */
  pkg: string;
  /** All package names covered by this window. Overrides pkg when present. */
  pkgs?: string[];
  startHour: number;
  startMin: number;
  endHour: number;
  endMin: number;
  days: number[]; // Calendar.DAY_OF_WEEK: 1=Sun 2=Mon 3=Tue 4=Wed 5=Thu 6=Fri 7=Sat
  scheduleId?: string; // if set, this window was auto-generated from a RecurringBlockSchedule
}

/**
 * A recurring block schedule that blocks a set of apps on specific days/times.
 * These are stored separately and converted to GreyoutWindows at sync time.
 */
export interface RecurringBlockSchedule {
  id: string;
  name: string;
  packages: string[];
  days: number[];        // Calendar.DAY_OF_WEEK: 1=Sun 2=Mon 3=Tue 4=Wed 5=Thu 6=Fri 7=Sat
  startHour: number;
  startMin: number;
  endHour: number;
  endMin: number;
  enabled: boolean;
}

export interface UserProfile {
  name?: string;
  occupation?: string;          // 'student' | 'professional' | 'freelancer' | 'creator' | 'other'
  dailyGoalHours?: number;      // target focus hours per day (1–12)
  wakeUpTime?: string;          // "HH:MM" e.g. "07:00"
  focusGoals?: string[];        // e.g. ['deep_work', 'no_social', 'study']

  // ── Deeper profile (added later) ───────────────────────────────────────────
  // All optional so existing profiles keep working unchanged.

  /** "HH:MM" e.g. "23:00" — pairs with wakeUpTime to define the available day. */
  sleepTime?: string;

  /** When the user focuses best — drives task-scheduling suggestions. */
  chronotype?: 'morning' | 'midday' | 'afternoon' | 'evening' | 'night' | 'flexible';

  /** Preferred focus block length in minutes; written through to
   *  settings.defaultDuration & settings.pomodoroDuration on save. */
  focusSessionLength?: number;  // 15 | 25 | 45 | 60 | 90

  /** How the user likes to break between focus blocks; written through to
   *  settings.pomodoroBreak on save. */
  breakStyle?: 'short_frequent' | 'balanced' | 'long_infrequent' | 'no_break';

  /** Categories of apps the user finds most distracting — fed into the
   *  suggested-apps-to-block list alongside occupation + focusGoals. */
  distractionTriggers?: string[]; // e.g. ['social','video','news','games','shopping','messaging']

  /** What kinds of motivation work for them — drives which gamification
   *  surfaces (streak chips, charts, milestone toasts, daily quotes). */
  motivationStyle?: string[];     // e.g. ['streaks','stats','milestones','quotes']

  /** Day of the week the user wants a weekly recap notification. */
  weeklyReviewDay?: 'sun' | 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat';
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
  /**
   * Master switch for the always-on block list. When false, packages in
   * `standaloneBlockPackages` are preserved but NOT enforced (so the user can
   * temporarily pause enforcement without losing their list). Default true.
   */
  alwaysOnEnforcementEnabled?: boolean;
  /**
   * Highest streak milestone (in days) the user has already been congratulated
   * for. Used to detect new milestones (3, 7, 14, 30, 60, 90, 180, 365) and
   * trigger a one-time celebration modal on the next app open.
   */
  lastShownStreakMilestone?: number;
  /**
   * When set to a milestone day count, the root layout shows a celebration
   * modal once and then clears this field (and bumps lastShownStreakMilestone).
   */
  pendingAchievementCelebration?: number;
  allowedAppPresets: AllowedAppPreset[]; // saved preset allow-lists
  blockPresets: BlockPreset[];           // saved preset block-lists
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
  systemGuardEnabled: boolean;
  // Content-specific guards — opt-in per category. Behave like systemGuardEnabled:
  //   • Locked on while Focus Mode or an app block is active (toggle disabled).
  //   • Enforced by AppBlockerAccessibilityService during focusActive || saActive.
  blockInstallActionsEnabled: boolean;   // Intercept Play Store / packageinstaller install/update/uninstall confirmation dialogs
  blockYoutubeShortsEnabled: boolean;    // Intercept the YouTube Shorts player (YouTube itself stays usable)
  blockInstagramReelsEnabled: boolean;   // Intercept the Instagram Reels player / clips viewer (Instagram itself stays usable)
  // Focus session behaviour
  // When true, finishing a task before its scheduled end time keeps the focus session
  // running until the original end time (the task is marked done in your stats, but
  // app-blocking and the persistent notification stay active). Default false: completing
  // a task stops focus immediately (the existing behaviour).
  keepFocusActiveUntilTaskEnd: boolean;
  // Block overlay appearance
  overlayWallpaper?: string;        // Absolute path to custom background image (empty = use gradient)
  overlayQuotes?: string[];         // Custom quote pool (empty = use built-in quotes)
  // Recurring block schedules — blocks a group of apps on a repeating daily/weekly timetable
  recurringBlockSchedules: RecurringBlockSchedule[];
  userProfile?: UserProfile;

  /**
   * Beginner mode hides advanced surfaces (Recurring Schedules, Aversion
   * Deterrents, Custom Wallpaper). Default true so new users land in the
   * friendlier UI.
   */
  beginnerMode?: boolean;

  /**
   * Tips card on the idle Focus tab — auto-fades after 7 days from
   * `tipsCardFirstShownAt` (ISO). User can also dismiss manually.
   */
  tipsCardDismissed?: boolean;
  tipsCardFirstShownAt?: string;

  /**
   * Marks the first-run "How to use" walkthrough as seen so it isn't shown
   * again at app start. Set to true after the user finishes (or skips) the
   * walkthrough on the user-profile → /how-to-use?firstRun=1 leg.
   */
  howToUseSeen?: boolean;

  /**
   * Marks the 5-screen concept tour (shown once on very first launch) as
   * complete. Cleared by "Run the tour again" to re-trigger it.
   */
  conceptTourSeen?: boolean;

  /**
   * Per-tab one-shot coachmarks — set to true when the tooltip for that tab
   * has been shown / dismissed once.
   */
  coachmarksSeen?: {
    schedule?: boolean;
    focus?: boolean;
    stats?: boolean;
    settings?: boolean;
  };

  /**
   * `.focusflow` imports land here as TEMPORARY presets — never overwrites
   * live settings. Each affected screen surfaces an "Apply / Dismiss" banner
   * to commit or drop the preset. Cleared per-category once applied/dismissed.
   */
  pendingPresets?: PendingPresets;
}

/** Preset payload from a `.focusflow` import that has not been applied yet. */
export interface PendingPresets {
  blockApps?: { packages: string[]; sourceName?: string; importedAt: string };
  dailyAllowance?: { entries: DailyAllowanceEntry[]; sourceName?: string; importedAt: string };
  deterrents?: {
    aversionDimmerEnabled?: boolean;
    aversionVibrateEnabled?: boolean;
    aversionSoundEnabled?: boolean;
    sourceName?: string;
    importedAt: string;
  };
  enforcement?: {
    systemGuardEnabled?: boolean;
    blockInstallActionsEnabled?: boolean;
    blockYoutubeShortsEnabled?: boolean;
    blockInstagramReelsEnabled?: boolean;
    blockedWords?: string[];
    sourceName?: string;
    importedAt: string;
  };
  profile?: { profile: Partial<UserProfile>; sourceName?: string; importedAt: string };
}

/**
 * Type alias for the per-task `imported` flag on Task — kept here so all
 * import-related fields are visible in one place.
 *
 * When a Task is created via the import path (.focusflow envelope or
 * Stay Focused-style historical export), `imported` is set to `true` so:
 *   - notificationService.scheduleTaskAlarm short-circuits (no AlarmManager
 *     entry is created — these tasks are historical, not live).
 *   - taskService.getCurrentTask / getAllActiveTasks skip the row.
 *   - stats / yesterday breakdowns still include the row so the user keeps
 *     visibility into what they imported.
 *
 * Backed by the `imported` and `imported_at` columns on the tasks table.
 */
export type ImportedTaskMarker = boolean;

/**
 * A scheduled "block batch" — formerly GreyoutWindow. Blocks a set of apps
 * on specific days/times. Multiple batches can co-exist with different
 * apps + times. The native side (AccessibilityService + SharedPrefsModule)
 * still reads the legacy `greyoutSchedule` SharedPreferences key, which is
 * a flattened list derived from `recurringBlockSchedules` at sync time.
 *
 * Renamed from "Greyout" (which implied screen dimming, but this just blocks
 * the apps). Kept as an alias for backwards-compat with native pref keys.
 */
export type BlockBatch = GreyoutWindow;
