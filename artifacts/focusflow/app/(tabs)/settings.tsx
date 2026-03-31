import React, { useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  Switch,
  TouchableOpacity,
  StyleSheet,
  Alert,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import dayjs from 'dayjs';
import { useApp } from '@/context/AppContext';
import { COLORS, FONT, RADIUS, SPACING } from '@/styles/theme';
import { cancelAllReminders, requestPermissions } from '@/services/notificationService';
import { formatDuration } from '@/services/taskService';
import { AllowedAppsModal } from '@/components/AllowedAppsModal';
import { StandaloneBlockModal } from '@/components/StandaloneBlockModal';
import { SharedPrefsModule } from '@/native-modules/SharedPrefsModule';

const DURATION_OPTIONS = [30, 45, 60, 90, 120];

export default function SettingsScreen() {
  const insets = useSafeAreaInsets();
  const { state, updateSettings, setStandaloneBlock, refreshTasks } = useApp();
  const { settings } = state;
  const [appsModalVisible, setAppsModalVisible] = useState(false);
  const [blockModalVisible, setBlockModalVisible] = useState(false);

  if (!state.isDbReady) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <View style={styles.header}>
          <Text style={styles.title}>Settings</Text>
        </View>
        <View style={styles.loadingContainer}>
          <Text style={styles.loadingText}>Loading…</Text>
        </View>
      </SafeAreaView>
    );
  }

  const update = async (partial: Partial<typeof settings>) => {
    await updateSettings({ ...settings, ...partial });
  };

  // ── Standalone block status ───────────────────────────────────────────────

  const standaloneActive = (() => {
    if (!settings.standaloneBlockUntil) return false;
    if ((settings.standaloneBlockPackages ?? []).length === 0) return false;
    return new Date(settings.standaloneBlockUntil).getTime() > Date.now();
  })();

  const blockUntilLabel = standaloneActive && settings.standaloneBlockUntil
    ? dayjs(settings.standaloneBlockUntil).format('MMM D [at] h:mm A')
    : null;

  const handleSaveStandaloneBlock = async (packages: string[], untilMs: number | null) => {
    await setStandaloneBlock(packages, untilMs);
  };

  // ── Other handlers ────────────────────────────────────────────────────────

  const handleRequestNotifications = async () => {
    const granted = await requestPermissions();
    Alert.alert(
      granted ? 'Notifications Enabled' : 'Permission Denied',
      granted
        ? 'You will now receive task reminders.'
        : 'Please enable notifications in your device Settings.',
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

  const handleSaveAllowedApps = async (packages: string[]) => {
    await update({ allowedInFocus: packages });
    if (state.focusSession?.isActive) {
      await SharedPrefsModule.setAllowedPackages(packages);
    }
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <Text style={styles.title}>Settings</Text>
      </View>

      <ScrollView style={styles.scroll} contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 80 }]}>

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
          <SettingButton
            icon="apps-outline"
            label="Manage Allowed Apps"
            description={`${settings.allowedInFocus.length} app${settings.allowedInFocus.length !== 1 ? 's' : ''} won't be blocked during Focus Mode`}
            onPress={() => setAppsModalVisible(true)}
          />
        </Section>

        {/* ── Block Schedule ── */}
        <Section title="Block Schedule">
          {standaloneActive ? (
            <View style={styles.blockActiveCard}>
              <View style={styles.blockActiveRow}>
                <View style={styles.blockDot} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.blockActiveTitle}>Block active</Text>
                  <Text style={styles.blockActiveDesc}>
                    {(settings.standaloneBlockPackages ?? []).length} app{(settings.standaloneBlockPackages ?? []).length !== 1 ? 's' : ''} blocked until {blockUntilLabel}
                  </Text>
                </View>
              </View>
            </View>
          ) : (
            <View style={styles.blockInactiveCard}>
              <Ionicons name="shield-outline" size={18} color={COLORS.muted} />
              <Text style={styles.blockInactiveText}>No scheduled block active</Text>
            </View>
          )}
          <SettingButton
            icon={standaloneActive ? 'lock-closed-outline' : 'ban-outline'}
            label={standaloneActive ? 'Add More Apps to Block' : 'Set Block Schedule'}
            description={standaloneActive ? 'Block is locked — you can add apps but not remove any until it expires' : 'Block specific apps until a date and time — regardless of tasks'}
            onPress={() => setBlockModalVisible(true)}
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
          <SettingButton
            icon="shield-checkmark-outline"
            label="Manage Permissions"
            description="Accessibility, Usage Access, Battery, Notifications"
            onPress={() => router.push('/permissions' as never)}
          />
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

        <View style={styles.footer}>
          <Text style={styles.footerText}>FocusFlow v1.0.0</Text>
          <Text style={styles.footerText}>All data stored locally on device</Text>
        </View>
      </ScrollView>

      <AllowedAppsModal
        visible={appsModalVisible}
        allowedPackages={settings.allowedInFocus}
        onSave={handleSaveAllowedApps}
        onClose={() => setAppsModalVisible(false)}
      />

      <StandaloneBlockModal
        visible={blockModalVisible}
        blockedPackages={settings.standaloneBlockPackages ?? []}
        blockUntil={settings.standaloneBlockUntil}
        locked={standaloneActive}
        onSave={handleSaveStandaloneBlock}
        onClose={() => setBlockModalVisible(false)}
      />
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
  blockActiveCard: {
    padding: SPACING.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: COLORS.border,
  },
  blockActiveRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
  },
  blockDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: COLORS.red,
  },
  blockActiveTitle: {
    fontSize: FONT.sm,
    fontWeight: '700',
    color: COLORS.red,
  },
  blockActiveDesc: {
    fontSize: FONT.xs,
    color: COLORS.muted,
    marginTop: 2,
  },
  blockInactiveCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
    padding: SPACING.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: COLORS.border,
  },
  blockInactiveText: {
    fontSize: FONT.sm,
    color: COLORS.muted,
  },
  footer: { alignItems: 'center', paddingTop: SPACING.xl, gap: SPACING.xs },
  footerText: { fontSize: FONT.xs, color: COLORS.border },
  loadingContainer: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  loadingText: { fontSize: FONT.md, color: COLORS.muted },
});
