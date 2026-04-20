import React from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useTheme } from '@/hooks/useTheme';
import { COLORS, FONT, RADIUS, SPACING } from '@/styles/theme';

type Entry = {
  version: string;
  date: string;
  sections: { heading: string; icon: string; items: string[] }[];
};

const CHANGELOG: Entry[] = [
  {
    version: 'c1.0.6',
    date: 'April 2026',
    sections: [
      {
        heading: 'Focus Mode Toggle Fixed',
        icon: 'shield-checkmark-outline',
        items: [
          'Auto-enable Focus Mode setting now correctly gates whether focus mode activates when a task starts — toggling it off prevents auto-start even if a task has focus mode enabled',
        ],
      },
      {
        heading: 'Standalone Block Modal',
        icon: 'ban-outline',
        items: [
          'Time addition now adds to the existing end time instead of replacing it — tap +30m, +1h, +2h, or +4h while a block is locked to extend it',
          'Recurring Block Schedules section removed for a cleaner interface',
          'Block by Category section removed',
          'Add by Package Name moved under an Advanced toggle — hidden by default',
        ],
      },
      {
        heading: 'Recents Screen Behaviour',
        icon: 'apps-outline',
        items: [
          'The recents / recent-apps button is no longer blocked during standalone app blocks — it is only redirected during active task focus sessions',
        ],
      },
      {
        heading: 'Splash Screen',
        icon: 'phone-portrait-outline',
        items: [
          'Native splash background changed to match the in-app purple splash — eliminates the black flash on cold start',
          'In-app splash logo now starts at 30% opacity instead of fully invisible, making the entrance feel smoother',
        ],
      },
    ],
  },
  {
    version: 'c1.0.5',
    date: 'April 2026',
    sections: [
      {
        heading: 'Session Security Hardening',
        icon: 'lock-closed-outline',
        items: [
          'Session PIN — SHA-256 PIN gates all native session-ending calls (stop service, stop network block, deactivate focus). Raw PIN is never stored.',
          'FLAG_SECURE on block overlay — prevents screenshots and hides session content from the Android recents thumbnail',
          'Self-package loophole closed — FocusFlow\'s own activity classes are allowlisted so they can never be used to dismiss the block overlay',
          'Recents screen detection — pressing the overview/recent-apps button during a session now sends HOME, preventing escape via app switching',
        ],
      },
      {
        heading: 'Mid-Session Install Blocking',
        icon: 'shield-checkmark-outline',
        items: [
          'Newly installed apps are automatically added to the block list if a standalone block session is active at install time',
          'Every new install during a session triggers an aversion vibration deterrent and flags the app for a JS-side warning banner',
          'Clock-tamper defense — BootReceiver now cross-checks task duration against wall-clock time to detect system-time manipulation',
        ],
      },
      {
        heading: 'IME & Keyboard Detection',
        icon: 'keypad-outline',
        items: [
          'Input Method Engines (keyboards) are now tagged with isIme in the app list — keyboards with built-in browsers or GIF search can be explicitly blocked',
        ],
      },
      {
        heading: 'Home Screen Reminder',
        icon: 'notifications-outline',
        items: [
          'A high-priority peek notification now appears when the user returns to the home screen after being kicked from a blocked app — clear reminder that the session is still running',
        ],
      },
    ],
  },
  {
    version: 'c1.0.4',
    date: 'April 2026',
    sections: [
      {
        heading: 'Alarm Safety',
        icon: 'alarm-outline',
        items: [
          'Native Samsung, Android, and Google clock/alarm apps are now never blocked',
          'SystemUI is no longer dismissed by broad package-level fallback, preventing focus protection from interrupting phone alarms while the screen is off',
        ],
      },
      {
        heading: 'System Screen Matching',
        icon: 'shield-checkmark-outline',
        items: [
          'Notification shade, quick settings, power menu, and Samsung Emergency mode are now detected by accessibility class/text matching only',
          'Blocked keywords now continue working during active Focus Mode or app blocks even when System Protection is turned off',
        ],
      },
    ],
  },
  {
    version: 'c1.0.3',
    date: 'April 2026',
    sections: [
      {
        heading: 'Never Blocked Packages',
        icon: 'call-outline',
        items: [
          'Added Samsung Phone, Phone services, Phone calls, Phone and Messaging Storage, VLC, WhatsApp, Gurukripa, PW, and ALLEN package IDs to the never-blocked safety list',
        ],
      },
      {
        heading: 'System Protection Toggle',
        icon: 'shield-checkmark-outline',
        items: [
          'Settings now includes a system protection toggle for power menu, notification shade, blocked words, and sensitive Settings-page blocking',
          'The toggle can be enabled anytime, but cannot be disabled while Focus Mode or an app block is active',
        ],
      },
    ],
  },
  {
    version: 'c1.0.2',
    date: 'April 2026',
    sections: [
      {
        heading: 'Power Menu & Notification Blocking',
        icon: 'shield-outline',
        items: [
          'Samsung One UI power menu now caught via com.samsung.android.app.powerkey (was entirely missed before)',
          'Android 14 GlobalActionsLayout, Samsung SecGlobalActionsDialog, MIUI MiuiGlobalActionsDialog added to detection',
          'Text-fallback now triggers on any 1 keyword — "Emergency call", "Safe mode" added',
          'Three-layer dismiss: ACTION_CLOSE_SYSTEM_DIALOGS → GLOBAL_ACTION_BACK (80 ms) → GLOBAL_ACTION_HOME (350 ms)',
          'Samsung One UI notification panel class names added (CentralSurfaces, StatusBarWindowView, SamsungQSPanel)',
          'Broad fallback catches unknown OEM class names automatically',
        ],
      },
      {
        heading: 'NLP Task Parser',
        icon: 'text-outline',
        items: [
          '"tomorrow", "tonight" scheduling',
          '"morning" (09:00), "afternoon" (14:00), "evening" (18:00)',
          '"in 30 minutes" / "in 2 hours" relative times',
          'Bare times: "9am", "14:30", "3pm"',
          '"today" keyword support',
        ],
      },
      {
        heading: 'Stats Screen',
        icon: 'bar-chart-outline',
        items: [
          'Overdue tasks shown as a separate line with a red alert icon',
          'Previously overdue tasks were hidden inside the "Remaining" count',
        ],
      },
      {
        heading: 'Permissions & Build',
        icon: 'construct-outline',
        items: [
          'EXPAND_STATUS_BAR permission added to manifest',
          'AAB release build fixed — ABI splits disabled before bundleRelease',
          'CI workflow files corrected (pnpm + Node 20 + Expo Prebuild)',
        ],
      },
    ],
  },
  {
    version: '1.0.0',
    date: 'Initial Release',
    sections: [
      {
        heading: 'Core Focus Engine',
        icon: 'timer-outline',
        items: [
          'Task-based focus sessions with configurable duration',
          'Allowed-apps whitelist during focus',
          'Standalone block mode independent of any session',
          'Daily allowance system (count / time-budget / interval)',
          'Automatic session expiry via native time authority',
        ],
      },
      {
        heading: 'App Blocking',
        icon: 'ban-outline',
        items: [
          'Foreground-app detection via AccessibilityService',
          'Full-screen block overlay with session context',
          'WindowManager overlay path for instant blocking',
          'Retry mechanism — up to 5 re-checks at 300 ms intervals',
          'NEVER_BLOCK list: phone dialers and WhatsApp always accessible',
        ],
      },
      {
        heading: 'Keyword & Network Blocking',
        icon: 'globe-outline',
        items: [
          'URL-bar scanning in Chrome, Firefox, Samsung Internet, Brave, Edge, DuckDuckGo and more',
          'VPN-based null-routing for blocked apps',
          'Greyout schedule — pre-committed time-window blocks',
        ],
      },
      {
        heading: 'Deep Android Enforcement',
        icon: 'lock-closed-outline',
        items: [
          'Settings sub-pages blocked: accessibility, clear data, date/time, usage access, battery optimisation, developer options, reset',
          'BootReceiver — service restarts after reboot',
          'Device Admin prevents uninstallation during active blocks',
          'FocusLauncherActivity for nuclear focus mode',
        ],
      },
      {
        heading: 'Widgets & Reports',
        icon: 'grid-outline',
        items: [
          'Home-screen widget showing session status',
          'Weekly Temptation Report every Sunday — blocked-app attempt summary',
          'Aversion deterrents: screen dimmer, vibration, sound cues',
        ],
      },
    ],
  },
];

function ChangeEntry({ entry }: { entry: Entry }) {
  const { theme } = useTheme();
  return (
    <View style={[styles.card, { backgroundColor: theme.card, borderColor: theme.border }]}>
      <View style={styles.versionRow}>
        <View style={styles.versionBadge}>
          <Text style={styles.versionText}>{entry.version.startsWith('c') ? entry.version : `v${entry.version}`}</Text>
        </View>
        <Text style={[styles.dateText, { color: theme.muted }]}>{entry.date}</Text>
      </View>
      {entry.sections.map((sec) => (
        <View key={sec.heading} style={styles.section}>
          <View style={styles.sectionHeader}>
            <Ionicons name={sec.icon as any} size={15} color={COLORS.primary} style={{ marginRight: 6 }} />
            <Text style={[styles.sectionTitle, { color: theme.text }]}>{sec.heading}</Text>
          </View>
          {sec.items.map((item, i) => (
            <View key={i} style={styles.itemRow}>
              <Text style={[styles.bullet, { color: COLORS.primary }]}>•</Text>
              <Text style={[styles.itemText, { color: theme.muted }]}>{item}</Text>
            </View>
          ))}
        </View>
      ))}
    </View>
  );
}

export default function ChangelogScreen() {
  const { theme } = useTheme();

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: theme.background }]}>
      <View style={[styles.topBar, { borderBottomColor: theme.border }]}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn} hitSlop={12}>
          <Ionicons name="arrow-back" size={22} color={theme.text} />
        </TouchableOpacity>
        <Text style={[styles.topTitle, { color: theme.text }]}>What's New</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.header}>
          <View style={styles.logoCircle}>
            <Ionicons name="rocket-outline" size={32} color="#fff" />
          </View>
          <Text style={[styles.title, { color: theme.text }]}>Changelog</Text>
          <Text style={[styles.subtitle, { color: theme.muted }]}>
            Every improvement, fix, and new feature across all versions.
          </Text>
        </View>

        {CHANGELOG.map((entry) => (
          <ChangeEntry key={entry.version} entry={entry} />
        ))}

        <Text style={[styles.footer, { color: theme.muted }]}>
          Privacy Policy: titanicbhai.github.io/FocusFlow
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: SPACING.md,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  backBtn: { width: 40, alignItems: 'flex-start' },
  topTitle: { fontSize: 17, fontFamily: FONT.semiBold, letterSpacing: 0.2 },
  content: { padding: SPACING.md, paddingBottom: 48 },
  header: { alignItems: 'center', marginBottom: SPACING.lg },
  logoCircle: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: COLORS.primary,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 14,
  },
  title: { fontSize: 24, fontFamily: FONT.bold, marginBottom: 6 },
  subtitle: { fontSize: 14, fontFamily: FONT.regular, textAlign: 'center', lineHeight: 20 },
  card: {
    borderRadius: RADIUS.lg,
    borderWidth: StyleSheet.hairlineWidth,
    padding: SPACING.md,
    marginBottom: SPACING.md,
  },
  versionRow: { flexDirection: 'row', alignItems: 'center', marginBottom: SPACING.sm },
  versionBadge: {
    backgroundColor: COLORS.primary,
    borderRadius: RADIUS.sm,
    paddingHorizontal: 10,
    paddingVertical: 3,
    marginRight: 10,
  },
  versionText: { color: '#fff', fontSize: 13, fontFamily: FONT.bold },
  dateText: { fontSize: 13, fontFamily: FONT.regular },
  section: { marginTop: SPACING.sm },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', marginBottom: 6 },
  sectionTitle: { fontSize: 14, fontFamily: FONT.semiBold },
  itemRow: { flexDirection: 'row', marginBottom: 4, paddingLeft: 4 },
  bullet: { fontSize: 14, marginRight: 6, lineHeight: 20 },
  itemText: { fontSize: 13, fontFamily: FONT.regular, lineHeight: 20, flex: 1 },
  footer: { textAlign: 'center', fontSize: 12, marginTop: 8 },
});
