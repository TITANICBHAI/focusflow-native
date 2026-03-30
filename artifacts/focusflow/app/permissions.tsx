import React, { useEffect, useState, useCallback } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  Linking,
  Platform,
  AppState,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import * as Notifications from 'expo-notifications';
import { UsageStatsModule } from '@/native-modules/UsageStatsModule';
import { COLORS, FONT, RADIUS, SPACING } from '@/styles/theme';

type PermStatus = 'granted' | 'denied' | 'unknown';

interface PermissionItem {
  id: string;
  title: string;
  description: string;
  icon: keyof typeof Ionicons.glyphMap;
  check: () => Promise<PermStatus>;
  open: () => void;
  deepLinkLabel: string;
}

const PERMISSIONS: PermissionItem[] = [
  {
    id: 'accessibility',
    title: 'Accessibility Service',
    description:
      'Required to detect and block apps during Focus Mode. Enable "FocusFlow Focus Mode" in the Accessibility services list.',
    icon: 'eye-outline',
    deepLinkLabel: 'Open Accessibility Settings',
    check: async (): Promise<PermStatus> => {
      try {
        const granted = await UsageStatsModule.hasAccessibilityPermission();
        return granted ? 'granted' : 'denied';
      } catch {
        return 'unknown';
      }
    },
    open: () => {
      Linking.sendIntent('android.settings.ACCESSIBILITY_SETTINGS').catch(() =>
        Linking.openSettings()
      );
    },
  },
  {
    id: 'usage',
    title: 'Usage Access',
    description:
      'Lets FocusFlow see which apps are running. Tap to open the Usage Access list, then find "FocusFlow" and enable it.',
    icon: 'analytics-outline',
    deepLinkLabel: 'Open Usage Access Settings',
    check: async (): Promise<PermStatus> => {
      try {
        const granted = await UsageStatsModule.hasPermission();
        return granted ? 'granted' : 'denied';
      } catch {
        return 'unknown';
      }
    },
    open: () => {
      UsageStatsModule.openUsageAccessSettings().catch(() => Linking.openSettings());
    },
  },
  {
    id: 'battery',
    title: 'Battery Optimization',
    description:
      'Exempt FocusFlow from battery optimization so the blocking service stays alive. Critical on Samsung One UI, MIUI, ColorOS, and Realme UI — without this the service gets killed within minutes.',
    icon: 'battery-charging-outline',
    deepLinkLabel: 'Request Exemption',
    check: async (): Promise<PermStatus> => {
      try {
        const ignoring = await UsageStatsModule.isIgnoringBatteryOptimizations();
        return ignoring ? 'granted' : 'denied';
      } catch {
        return 'unknown';
      }
    },
    open: () => {
      // Must go through Kotlin: ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS needs a
      // "package:<name>" data URI which Linking.sendIntent() cannot set from JS.
      // The Kotlin method also has the Samsung One UI fallback chain built in.
      UsageStatsModule.openBatteryOptimizationSettings().catch(() =>
        Linking.openSettings()
      );
    },
  },
  {
    id: 'notifications',
    title: 'Notifications',
    description:
      'Allows FocusFlow to show task reminders and the persistent focus notification. Required for all in-app alerts.',
    icon: 'notifications-outline',
    deepLinkLabel: 'Open Notification Settings',
    check: async (): Promise<PermStatus> => {
      try {
        const { status } = await Notifications.getPermissionsAsync();
        if (status === 'granted') return 'granted';
        if (status === 'denied') return 'denied';
        return 'unknown';
      } catch {
        return 'unknown';
      }
    },
    open: () => {
      if (Platform.OS === 'android') {
        Linking.sendIntent('android.settings.APP_NOTIFICATION_SETTINGS', [
          {
            key: 'android.provider.extra.APP_PACKAGE',
            value: 'com.tbtechs.focusflow',
          },
        ]).catch(() => Linking.openSettings());
      } else {
        Linking.openSettings();
      }
    },
  },
  {
    id: 'device_admin',
    title: 'Device Admin (optional)',
    description:
      'Extra protection against Samsung One UI, MIUI, and ColorOS force-stopping the app. On Samsung: Biometrics & Security → Device admin apps → FocusFlow → Activate. Not required on stock Android.',
    icon: 'shield-outline',
    deepLinkLabel: 'Activate Device Admin',
    check: async (): Promise<PermStatus> => {
      try {
        const active = await UsageStatsModule.isDeviceAdminActive();
        return active ? 'granted' : 'denied';
      } catch {
        return 'unknown';
      }
    },
    open: () => {
      UsageStatsModule.openDeviceAdminSettings().catch(() =>
        Linking.openSettings()
      );
    },
  },
];

export default function PermissionsScreen() {
  const [statuses, setStatuses] = useState<Record<string, PermStatus>>({});
  const [checking, setChecking] = useState(true);

  const checkAll = useCallback(async () => {
    setChecking(true);
    const result: Record<string, PermStatus> = {};
    await Promise.all(
      PERMISSIONS.map(async (p) => {
        result[p.id] = await p.check();
      })
    );
    setStatuses(result);
    setChecking(false);
  }, []);

  useEffect(() => {
    void checkAll();
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') {
        // Check immediately, then again after a short delay.
        // Android (especially Samsung One UI) may not have flushed the updated
        // permission state to AccessibilityManager by the time the app regains focus.
        void checkAll();
        const t = setTimeout(() => void checkAll(), 800);
        return () => clearTimeout(t);
      }
    });
    return () => sub.remove();
  }, [checkAll]);

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="chevron-back" size={24} color={COLORS.primary} />
        </TouchableOpacity>
        <Text style={styles.title}>Permissions</Text>
        <TouchableOpacity onPress={checkAll} style={styles.refreshBtn} disabled={checking}>
          {checking ? (
            <ActivityIndicator size="small" color={COLORS.primary} />
          ) : (
            <Ionicons name="refresh" size={20} color={COLORS.primary} />
          )}
        </TouchableOpacity>
      </View>

      <ScrollView style={styles.scroll} contentContainerStyle={styles.content}>
        <Text style={styles.intro}>
          FocusFlow needs these permissions to block apps and show persistent notifications.
          Tap each row to go to the correct system screen.
        </Text>

        {PERMISSIONS.map((perm) => {
          const status = statuses[perm.id] ?? 'unknown';
          return (
            <TouchableOpacity
              key={perm.id}
              style={styles.card}
              onPress={perm.open}
              activeOpacity={0.75}
            >
              <View style={[styles.iconContainer, { backgroundColor: statusColor(status) + '22' }]}>
                <Ionicons name={perm.icon} size={22} color={statusColor(status)} />
              </View>
              <View style={styles.cardBody}>
                <View style={styles.cardTitleRow}>
                  <Text style={styles.cardTitle}>{perm.title}</Text>
                  <StatusBadge status={status} />
                </View>
                <Text style={styles.cardDesc}>{perm.description}</Text>
                <Text style={[styles.deepLinkLabel, { color: COLORS.primary }]}>
                  {perm.deepLinkLabel} →
                </Text>
              </View>
            </TouchableOpacity>
          );
        })}

        <Text style={styles.footer}>
          Statuses refresh when you return to this screen.{'\n'}
          "Unknown" = status cannot be determined without running on a real Android device.
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}

function statusColor(status: PermStatus): string {
  if (status === 'granted') return COLORS.green;
  if (status === 'denied') return COLORS.red;
  return COLORS.muted;
}

function StatusBadge({ status }: { status: PermStatus }) {
  const label = status === 'granted' ? 'Granted' : status === 'denied' ? 'Denied' : 'Unknown';
  const color = statusColor(status);
  return (
    <View style={[styles.badge, { backgroundColor: color + '22', borderColor: color + '44' }]}>
      <Text style={[styles.badgeText, { color }]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: COLORS.background },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: SPACING.lg,
    backgroundColor: COLORS.card,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: COLORS.border,
    gap: SPACING.sm,
  },
  backBtn: { padding: 4 },
  title: { flex: 1, fontSize: FONT.xl, fontWeight: '800', color: COLORS.text },
  refreshBtn: { padding: 4 },
  scroll: { flex: 1 },
  content: { padding: SPACING.lg, gap: SPACING.md, paddingBottom: 60 },
  intro: {
    fontSize: FONT.sm,
    color: COLORS.textSecondary,
    lineHeight: 20,
    marginBottom: SPACING.xs,
  },
  card: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: COLORS.card,
    borderRadius: RADIUS.lg,
    padding: SPACING.md,
    gap: SPACING.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: COLORS.border,
  },
  iconContainer: {
    width: 44,
    height: 44,
    borderRadius: RADIUS.md,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 2,
  },
  cardBody: { flex: 1, gap: 4 },
  cardTitleRow: { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm, flexWrap: 'wrap' },
  cardTitle: { fontSize: FONT.md, fontWeight: '700', color: COLORS.text },
  cardDesc: { fontSize: FONT.xs, color: COLORS.muted, lineHeight: 17 },
  deepLinkLabel: { fontSize: FONT.xs, fontWeight: '600', marginTop: 4 },
  badge: {
    paddingHorizontal: SPACING.sm,
    paddingVertical: 2,
    borderRadius: RADIUS.full,
    borderWidth: 1,
  },
  badgeText: { fontSize: FONT.xs, fontWeight: '700' },
  footer: {
    fontSize: FONT.xs,
    color: COLORS.border,
    textAlign: 'center',
    lineHeight: 16,
    marginTop: SPACING.sm,
  },
});
