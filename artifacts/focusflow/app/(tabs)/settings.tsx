import React, { useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  Switch,
  TouchableOpacity,
  StyleSheet,
  Alert,
  Linking,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useApp } from '@/context/AppContext';
import { COLORS, FONT, RADIUS, SPACING } from '@/styles/theme';
import { cancelAllReminders, requestPermissions } from '@/services/notificationService';
import { UsageStatsModule } from '@/native-modules/UsageStatsModule';
import { formatDuration } from '@/services/taskService';

const DURATION_OPTIONS = [30, 45, 60, 90, 120];

export default function SettingsScreen() {
  const { state, updateSettings, refreshTasks } = useApp();
  const { settings } = state;
  const [allowedText, setAllowedText] = useState(settings.allowedInFocus.join(', '));

  const update = async (partial: Partial<typeof settings>) => {
    await updateSettings({ ...settings, ...partial });
  };

  const handleRequestNotifications = async () => {
    const granted = await requestPermissions();
    Alert.alert(
      granted ? 'Notifications Enabled' : 'Permission Denied',
      granted
        ? 'You will now receive task reminders.'
        : 'Please enable notifications in your device Settings.',
    );
  };

  const handleUsageAccess = async () => {
    const has = await UsageStatsModule.hasPermission();
    if (has) {
      Alert.alert('Permission Granted', 'Usage Access is already enabled.');
      return;
    }
    Alert.alert(
      'Usage Access Required',
      'To detect apps during Focus Mode, FocusDay needs Usage Access. This opens your device settings.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Open Settings', onPress: () => UsageStatsModule.openUsageAccessSettings() },
      ],
    );
  };

  const handleClearAllTasks = () => {
    Alert.alert('Clear All Tasks', 'This will delete ALL tasks. Are you sure?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Clear All',
        style: 'destructive',
        onPress: async () => {
          await cancelAllReminders();
          await refreshTasks();
          Alert.alert('Done', 'All tasks cleared.');
        },
      },
    ]);
  };

  const openAppSettings = () => {
    Linking.openSettings();
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <Text style={styles.title}>Settings</Text>
      </View>

      <ScrollView style={styles.scroll} contentContainerStyle={styles.content}>

        {/* ── Notifications ── */}
        <Section title="Notifications">
          <SettingRow label="Enable Reminders" description="Get alerts before & during tasks">
            <Switch
              value={settings.notificationsEnabled}
              onValueChange={(v) => update({ notificationsEnabled: v })}
              trackColor={{ false: COLORS.border, true: COLORS.primary + '88' }}
              thumbColor={settings.notificationsEnabled ? COLORS.primary : COLORS.muted}
            />
          </SettingRow>
          <SettingButton
            icon="notifications-outline"
            label="Request Notification Permission"
            onPress={handleRequestNotifications}
          />
        </Section>

        {/* ── Scheduling ── */}
        <Section title="Scheduling">
          <SettingRow label="Default Task Duration">
            <Text style={styles.valueText}>{formatDuration(settings.defaultDuration)}</Text>
          </SettingRow>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: SPACING.xs }}>
            <View style={styles.chipRow}>
              {DURATION_OPTIONS.map((d) => (
                <TouchableOpacity
                  key={d}
                  style={[styles.chip, d === settings.defaultDuration && styles.chipActive]}
                  onPress={() => update({ defaultDuration: d })}
                >
                  <Text style={[styles.chipText, d === settings.defaultDuration && styles.chipTextActive]}>
                    {formatDuration(d)}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </ScrollView>
        </Section>

        {/* ── Focus Mode ── */}
        <Section title="Focus Mode">
          <SettingRow label="Auto-enable Focus Mode" description="Activate when a focus task starts">
            <Switch
              value={settings.focusModeEnabled}
              onValueChange={(v) => update({ focusModeEnabled: v })}
              trackColor={{ false: COLORS.border, true: COLORS.primary + '88' }}
              thumbColor={settings.focusModeEnabled ? COLORS.primary : COLORS.muted}
            />
          </SettingRow>
          <SettingRow label="Allowed in Focus" description="Apps that won't be blocked">
            <Text style={styles.valueText} numberOfLines={1}>
              {settings.allowedInFocus.length} apps
            </Text>
          </SettingRow>
          <View style={styles.descCard}>
            <Text style={styles.descText}>
              Allowed: {settings.allowedInFocus.join(', ')}
              {'\n'}Add Android package names (e.g. com.whatsapp) separated by commas.
            </Text>
          </View>

          <SettingButton
            icon="analytics-outline"
            label="Grant Usage Access"
            description="Required to detect and block apps during Focus Mode"
            onPress={handleUsageAccess}
          />
        </Section>

        {/* ── Pomodoro ── */}
        <Section title="Pomodoro Mode">
          <SettingRow label="Enable Pomodoro" description="Auto-cycle work and break sessions">
            <Switch
              value={settings.pomodoroEnabled}
              onValueChange={(v) => update({ pomodoroEnabled: v })}
              trackColor={{ false: COLORS.border, true: COLORS.primary + '88' }}
              thumbColor={settings.pomodoroEnabled ? COLORS.primary : COLORS.muted}
            />
          </SettingRow>
          {settings.pomodoroEnabled && (
            <>
              <SettingRow label="Work Duration">
                <Text style={styles.valueText}>{settings.pomodoroDuration}m</Text>
              </SettingRow>
              <SettingRow label="Break Duration">
                <Text style={styles.valueText}>{settings.pomodoroBreak}m</Text>
              </SettingRow>
            </>
          )}
        </Section>

        {/* ── Permissions ── */}
        <Section title="Permissions">
          <SettingButton icon="settings-outline" label="Open App Settings" onPress={openAppSettings} />
        </Section>

        {/* ── Danger Zone ── */}
        <Section title="Data">
          <SettingButton
            icon="trash-outline"
            label="Clear All Tasks"
            description="Permanently delete all scheduled tasks"
            danger
            onPress={handleClearAllTasks}
          />
        </Section>

        {/* App info */}
        <View style={styles.footer}>
          <Text style={styles.footerText}>FocusDay v1.0.0</Text>
          <Text style={styles.footerText}>All data stored locally on device</Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      <View style={styles.sectionCard}>{children}</View>
    </View>
  );
}

function SettingRow({
  label,
  description,
  children,
}: {
  label: string;
  description?: string;
  children?: React.ReactNode;
}) {
  return (
    <View style={styles.row}>
      <View style={styles.rowText}>
        <Text style={styles.rowLabel}>{label}</Text>
        {description && <Text style={styles.rowDesc}>{description}</Text>}
      </View>
      {children}
    </View>
  );
}

function SettingButton({
  icon,
  label,
  description,
  danger = false,
  onPress,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  description?: string;
  danger?: boolean;
  onPress: () => void;
}) {
  return (
    <TouchableOpacity style={styles.settingButton} onPress={onPress}>
      <Ionicons name={icon} size={20} color={danger ? COLORS.red : COLORS.primary} />
      <View style={styles.rowText}>
        <Text style={[styles.rowLabel, danger && { color: COLORS.red }]}>{label}</Text>
        {description && <Text style={styles.rowDesc}>{description}</Text>}
      </View>
      <Ionicons name="chevron-forward" size={16} color={COLORS.border} />
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: COLORS.background },
  header: {
    padding: SPACING.lg,
    backgroundColor: COLORS.card,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: COLORS.border,
  },
  title: { fontSize: FONT.xxl, fontWeight: '800', color: COLORS.text },
  scroll: { flex: 1 },
  content: { padding: SPACING.lg, paddingBottom: 60, gap: SPACING.md },
  section: { gap: SPACING.xs },
  sectionTitle: {
    fontSize: FONT.xs,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    color: COLORS.muted,
    paddingHorizontal: SPACING.xs,
    marginBottom: SPACING.xs,
  },
  sectionCard: {
    backgroundColor: COLORS.card,
    borderRadius: RADIUS.lg,
    overflow: 'hidden',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: COLORS.border,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: SPACING.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: COLORS.border,
    gap: SPACING.sm,
  },
  rowText: { flex: 1 },
  rowLabel: { fontSize: FONT.md, fontWeight: '600', color: COLORS.text },
  rowDesc: { fontSize: FONT.xs, color: COLORS.muted, marginTop: 2 },
  valueText: { fontSize: FONT.sm, fontWeight: '600', color: COLORS.primary },
  settingButton: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: SPACING.md,
    gap: SPACING.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: COLORS.border,
  },
  chipRow: { flexDirection: 'row', gap: SPACING.xs, paddingHorizontal: SPACING.md, paddingBottom: SPACING.sm },
  chip: {
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.xs,
    borderRadius: RADIUS.full,
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  chipActive: { backgroundColor: COLORS.primary, borderColor: COLORS.primary },
  chipText: { fontSize: FONT.sm, color: COLORS.text },
  chipTextActive: { color: '#fff', fontWeight: '700' },
  descCard: {
    margin: SPACING.md,
    padding: SPACING.md,
    backgroundColor: COLORS.surface,
    borderRadius: RADIUS.md,
  },
  descText: { fontSize: FONT.xs, color: COLORS.muted, lineHeight: 18 },
  footer: { alignItems: 'center', paddingTop: SPACING.xl, gap: SPACING.xs },
  footerText: { fontSize: FONT.xs, color: COLORS.border },
});
