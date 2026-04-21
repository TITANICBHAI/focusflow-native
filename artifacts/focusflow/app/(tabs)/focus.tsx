import React, { useEffect, useState } from 'react';
import { withScreenErrorBoundary } from '@/components/withScreenErrorBoundary';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Animated,
  Alert,
  Linking,
  Platform,
  AppState,
  ScrollView,
  useWindowDimensions,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import dayjs from 'dayjs';
import { useApp } from '@/context/AppContext';
import { useTaskTimer } from '@/hooks/useTimer';
import { formatTime } from '@/services/taskService';
import { dbLogFocusOverride } from '@/data/database';
import { UsageStatsModule } from '@/native-modules/UsageStatsModule';
import { StandaloneBlockModal } from '@/components/StandaloneBlockModal';
import ExtendModal from '@/components/ExtendModal';
import { COLORS, FONT, RADIUS, SPACING } from '@/styles/theme';
import { useTheme } from '@/hooks/useTheme';

function FocusScreen() {
  const insets = useSafeAreaInsets();
  const { theme } = useTheme();
  const { width: windowWidth } = useWindowDimensions();
  const ringSize = Math.min(Math.floor(windowWidth * 0.65), 260);
  const { state, activeTask, startFocusMode, stopFocusMode, completeTask, extendTaskTime, setStandaloneBlockAndAllowance, updateSettings, setRecurringBlockSchedules } = useApp();
  const isFocusing = state.focusSession !== null && state.focusSession.isActive;
  const [hasAccessibilityPermission, setHasAccessibilityPermission] = useState<boolean | null>(null);
  const [blockModalVisible, setBlockModalVisible] = useState(false);
  const [showExtendModal, setShowExtendModal] = useState(false);

  const { settings } = state;
  const standaloneActive = (() => {
    if (!settings.standaloneBlockUntil) return false;
    if ((settings.standaloneBlockPackages ?? []).length === 0) return false;
    return new Date(settings.standaloneBlockUntil).getTime() > Date.now();
  })();

  const task = activeTask;
  const blockPresets = settings.blockPresets ?? [];

  const handleSaveBlockPreset = async (preset: import('@/data/types').BlockPreset) => {
    const presets = [...blockPresets, preset];
    await updateSettings({ ...settings, blockPresets: presets });
  };

  const handleDeleteBlockPreset = async (id: string) => {
    const presets = blockPresets.filter((p) => p.id !== id);
    await updateSettings({ ...settings, blockPresets: presets });
  };

  const handleAddTime = async (minutes: number) => {
    const baseMs = settings.standaloneBlockUntil
      ? Math.max(new Date(settings.standaloneBlockUntil).getTime(), Date.now())
      : Date.now();
    const untilMs = baseMs + minutes * 60 * 1000;
    await setStandaloneBlockAndAllowance(
      settings.standaloneBlockPackages ?? [],
      untilMs,
      settings.dailyAllowanceEntries ?? [],
    );
  };

  const handleQuickBlock = async (preset: import('@/data/types').BlockPreset, hours: number) => {
    if (Platform.OS === 'android') {
      const hasA11y = await UsageStatsModule.hasAccessibilityPermission().catch(() => false);
      const hasUsage = await UsageStatsModule.hasPermission().catch(() => false);
      if (!hasA11y || !hasUsage) {
        Alert.alert(
          'Permissions Required',
          'FocusFlow needs Accessibility and Usage Access to block apps.\n\nGo to Settings → Permissions to grant them.',
          [
            { text: 'Not Now', style: 'cancel' },
            {
              text: 'Open Permissions',
              onPress: async () => {
                if (!hasA11y) await UsageStatsModule.openAccessibilitySettings().catch(() => {});
                else await UsageStatsModule.openUsageAccessSettings().catch(() => {});
              },
            },
          ]
        );
        return;
      }
    }
    const untilMs = Date.now() + hours * 60 * 60 * 1000;
    await setStandaloneBlockAndAllowance(preset.packages, untilMs, []);
  };

  const pulseAnim = React.useRef(new Animated.Value(1)).current;

  useEffect(() => {
    const checkPermission = async () => {
      try {
        const granted = await UsageStatsModule.hasAccessibilityPermission();
        setHasAccessibilityPermission(granted);
      } catch {
        setHasAccessibilityPermission(null);
      }
    };
    void checkPermission();

    let t1: ReturnType<typeof setTimeout> | null = null;
    let t2: ReturnType<typeof setTimeout> | null = null;

    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') {
        // Check immediately then retry — Samsung One UI and low-end devices may
        // not have flushed the updated permission state to AccessibilityManager
        // by the time the app regains focus. Galaxy A-series can take 2–3 seconds.
        void checkPermission();
        if (t1) clearTimeout(t1);
        if (t2) clearTimeout(t2);
        t1 = setTimeout(() => void checkPermission(), 2000);
        t2 = setTimeout(() => void checkPermission(), 4000);
      }
    });
    return () => {
      sub.remove();
      if (t1) clearTimeout(t1);
      if (t2) clearTimeout(t2);
    };
  }, []);

  useEffect(() => {
    if (!isFocusing) return;
    pulseAnim.setValue(1);
    const pulse = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, { toValue: 1.08, duration: 1200, useNativeDriver: true }),
        Animated.timing(pulseAnim, { toValue: 1, duration: 1200, useNativeDriver: true }),
      ]),
    );
    pulse.start();
    return () => pulse.stop();
  }, [isFocusing, task?.id]);

  if (!task) {
    // ── State 1: Standalone block is active, no task ──────────────────────────
    if (standaloneActive) {
      return (
        <SafeAreaView style={[styles.safe, { backgroundColor: theme.background }]}>
          <ScrollView
            contentContainerStyle={[styles.emptyContainer, { paddingBottom: 60 + insets.bottom + 20 }]}
            showsVerticalScrollIndicator={false}
          >
            {/* Big shield icon with red tint */}
            <View style={[styles.standaloneIconWrap, { backgroundColor: COLORS.red + '15' }]}>
              <Ionicons name="ban" size={42} color={COLORS.red} />
            </View>
            <Text style={[styles.emptyTitle, { color: theme.text }]}>Apps Blocked</Text>
            <Text style={[styles.emptySubtitle, { color: theme.muted }]}>
              Standalone block is running. You can add more apps but cannot stop the block early.
            </Text>

            {/* Countdown timer to expiry */}
            {settings.standaloneBlockUntil && (
              <StandaloneCountdown
                untilIso={settings.standaloneBlockUntil}
                blockedCount={(settings.standaloneBlockPackages ?? []).length}
              />
            )}

            {/* Add more apps button */}
            <TouchableOpacity
              style={[styles.addMoreAppsBtn, { backgroundColor: theme.card, borderColor: COLORS.red + '44' }]}
              onPress={() => setBlockModalVisible(true)}
              activeOpacity={0.8}
            >
              <Ionicons name="add-circle-outline" size={18} color={COLORS.red} />
              <Text style={[styles.addMoreAppsBtnText, { color: COLORS.red }]}>Add More Apps to Block</Text>
            </TouchableOpacity>

            {/* Add time to current block */}
            <View style={styles.quickBlockSection}>
              <Text style={[styles.quickBlockLabel, { color: theme.muted }]}>ADD TIME</Text>
              <View style={[styles.addTimeRow, { backgroundColor: theme.card, borderColor: theme.border }]}>
                {[
                  { label: '+30m', minutes: 30 },
                  { label: '+1h', minutes: 60 },
                  { label: '+2h', minutes: 120 },
                  { label: '+4h', minutes: 240 },
                ].map((opt) => (
                  <TouchableOpacity
                    key={opt.label}
                    style={[styles.addTimeBtn, { backgroundColor: COLORS.primary + '14', borderColor: COLORS.primary + '44' }]}
                    onPress={() => { void handleAddTime(opt.minutes); }}
                    activeOpacity={0.7}
                  >
                    <Text style={[styles.addTimeBtnText, { color: COLORS.primary }]}>{opt.label}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>
          </ScrollView>

          <StandaloneBlockModal
            visible={blockModalVisible}
            blockedPackages={settings.standaloneBlockPackages ?? []}
            blockUntil={settings.standaloneBlockUntil}
            locked={standaloneActive}
            dailyAllowanceEntries={settings.dailyAllowanceEntries ?? []}
            blockPresets={blockPresets}
            recurringBlockSchedules={settings.recurringBlockSchedules ?? []}
            onSave={async (packages, untilMs, allowanceEntries) => {
              await setStandaloneBlockAndAllowance(packages, untilMs, allowanceEntries);
            }}
            onSavePreset={handleSaveBlockPreset}
            onDeletePreset={handleDeleteBlockPreset}
            onSaveRecurringSchedules={async (schedules) => { await setRecurringBlockSchedules(schedules); }}
            onClose={() => setBlockModalVisible(false)}
          />
        </SafeAreaView>
      );
    }

    // ── State 2: Nothing active — prompt to create a task ─────────────────────
    return (
      <SafeAreaView style={[styles.safe, { backgroundColor: theme.background }]}>
        <ScrollView
          contentContainerStyle={[styles.emptyContainer, { paddingBottom: 60 + insets.bottom + 20 }]}
          showsVerticalScrollIndicator={false}
        >
          <Ionicons name="calendar-outline" size={64} color={theme.border} />
          <Text style={[styles.emptyTitle, { color: theme.muted }]}>No Tasks Yet</Text>
          <Text style={[styles.emptySubtitle, { color: theme.muted }]}>
            Create a task in the Schedule tab to start using Focus Mode
          </Text>

          <TouchableOpacity
            style={[styles.createTaskBtn, { backgroundColor: COLORS.primary }]}
            onPress={() => router.push('/(tabs)/')}
            activeOpacity={0.85}
          >
            <Ionicons name="add-circle-outline" size={20} color="#fff" />
            <Text style={styles.createTaskBtnText}>Create a Task</Text>
          </TouchableOpacity>

          {/* Quick-Block preset shortcuts */}
          {blockPresets.length > 0 && (
            <View style={styles.quickBlockSection}>
              <Text style={[styles.quickBlockLabel, { color: theme.muted }]}>QUICK BLOCK</Text>
              {blockPresets.map((preset) => (
                <View key={preset.id} style={[styles.quickBlockCard, { backgroundColor: theme.card, borderColor: theme.border }]}>
                  <View style={styles.quickBlockCardTop}>
                    <Ionicons name="ban-outline" size={16} color={COLORS.red} />
                    <Text style={[styles.quickBlockCardName, { color: theme.text }]} numberOfLines={1}>{preset.name}</Text>
                    <Text style={[styles.quickBlockCardCount, { color: theme.muted }]}>{preset.packages.length} app{preset.packages.length !== 1 ? 's' : ''}</Text>
                  </View>
                  <View style={styles.quickBlockDurations}>
                    {[1, 2, 4, 8].map((h) => (
                      <TouchableOpacity
                        key={h}
                        style={[styles.quickBlockDurationBtn, { backgroundColor: COLORS.red + '14', borderColor: COLORS.red + '33' }]}
                        onPress={() => { void handleQuickBlock(preset, h); }}
                        activeOpacity={0.7}
                      >
                        <Text style={[styles.quickBlockDurationText, { color: COLORS.red }]}>{h}h</Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                </View>
              ))}
            </View>
          )}

          <TouchableOpacity
            style={[styles.blockScheduleBtn, { backgroundColor: theme.card, borderColor: theme.border }]}
            onPress={() => setBlockModalVisible(true)}
            activeOpacity={0.8}
          >
            <Ionicons name="ban-outline" size={18} color={COLORS.primary} />
            <View style={{ flex: 1 }}>
              <Text style={[styles.blockScheduleBtnText, { color: theme.text }]}>
                Block Apps Without a Task
              </Text>
              <Text style={[styles.blockScheduleBtnDesc, { color: theme.textSecondary }]}>
                Start a standalone block or recurring schedule
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={16} color={COLORS.border} />
          </TouchableOpacity>
        </ScrollView>

        <StandaloneBlockModal
          visible={blockModalVisible}
          blockedPackages={settings.standaloneBlockPackages ?? []}
          blockUntil={settings.standaloneBlockUntil}
          locked={false}
          dailyAllowanceEntries={settings.dailyAllowanceEntries ?? []}
          blockPresets={blockPresets}
          recurringBlockSchedules={settings.recurringBlockSchedules ?? []}
          onSave={async (packages, untilMs, allowanceEntries) => {
            await setStandaloneBlockAndAllowance(packages, untilMs, allowanceEntries);
          }}
          onSavePreset={handleSaveBlockPreset}
          onDeletePreset={handleDeleteBlockPreset}
          onSaveRecurringSchedules={async (schedules) => { await setRecurringBlockSchedules(schedules); }}
          onClose={() => setBlockModalVisible(false)}
        />
      </SafeAreaView>
    );
  }

  const innerSize = Math.round(ringSize * 0.846);
  const coreSize = Math.round(ringSize * 0.731);

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: task.color + '18' }]}>
      {/* Accessibility permission warning banner — pinned above scroll.
          Suppressed during active focus to avoid false "permission revoked" flashes
          on Samsung One UI and other OEMs that delay AccessibilityManager updates. */}
      {hasAccessibilityPermission === false && !isFocusing && (
        <TouchableOpacity
          style={styles.permissionBanner}
          onPress={async () => {
            try {
              if (Platform.OS === 'android') {
                await UsageStatsModule.openAccessibilitySettings();
              } else {
                await Linking.openSettings();
              }
            } catch {
              await Linking.openSettings().catch(() => {});
            }
          }}
          activeOpacity={0.8}
        >
          <Ionicons name="warning-outline" size={18} color={COLORS.orange} />
          <View style={styles.permissionBannerText}>
            <Text style={styles.permissionBannerTitle}>Accessibility permission needed</Text>
            <Text style={styles.permissionBannerDesc}>
              Focus Mode can't block apps without Accessibility access. Tap to open Settings.
            </Text>
          </View>
          <Ionicons name="chevron-forward" size={16} color={COLORS.orange} />
        </TouchableOpacity>
      )}

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={[styles.scrollContent, { paddingBottom: 60 + insets.bottom + 20 }]}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {/* Focus status */}
        <View style={styles.statusRow}>
          <View style={[styles.statusDot, { backgroundColor: isFocusing ? COLORS.green : COLORS.muted }]} />
          <Text style={[styles.statusText, { color: theme.textSecondary }]}>
            {isFocusing ? 'Focus Mode Active' : 'Task In Progress'}
          </Text>
        </View>

      {/* Central ring + timer */}
      <View style={styles.centerContent}>
        <Animated.View
          style={[
            styles.ringOuter,
            {
              width: ringSize,
              height: ringSize,
              borderRadius: ringSize / 2,
              borderColor: task.color + '33',
              transform: [{ scale: pulseAnim }],
            },
          ]}
        >
          <View
            style={[
              styles.ringInner,
              {
                width: innerSize,
                height: innerSize,
                borderRadius: innerSize / 2,
                borderColor: task.color + '88',
              },
            ]}
          >
            <View
              style={[
                styles.ringCore,
                {
                  width: coreSize,
                  height: coreSize,
                  borderRadius: coreSize / 2,
                  backgroundColor: task.color,
                },
              ]}
            >
              <TimerDisplay startTime={task.startTime} endTime={task.endTime} color={task.color} ringSize={ringSize} />
            </View>
          </View>
        </Animated.View>

        {/* Task title */}
        <Text style={[styles.taskTitle, { color: theme.text }]} numberOfLines={2}>{task.title}</Text>
        <Text style={[styles.taskTime, { color: theme.textSecondary }]}>
          {formatTime(task.startTime)} – {formatTime(task.endTime)}
        </Text>

        {/* Tags */}
        {task.tags.length > 0 && (
          <View style={styles.tagsRow}>
            {task.tags.map((tag) => (
              <View key={tag} style={[styles.tag, { backgroundColor: task.color + '22' }]}>
                <Text style={[styles.tagText, { color: task.color }]}>#{tag}</Text>
              </View>
            ))}
          </View>
        )}
      </View>

      {/* Action buttons */}
      <View style={styles.actions}>
        {!isFocusing ? (
          <TouchableOpacity
            style={[styles.primaryBtn, { backgroundColor: task.color }]}
            onPress={async () => {
              if (Platform.OS === 'android') {
                const hasA11y = await UsageStatsModule.hasAccessibilityPermission().catch(() => false);
                const hasUsage = await UsageStatsModule.hasPermission().catch(() => false);
                if (!hasA11y || !hasUsage) {
                  Alert.alert(
                    'Permissions Required',
                    'Focus Mode needs Accessibility and Usage Access to block apps.\n\nGo to Settings → Permissions to grant them.',
                    [
                      { text: 'Not Now', style: 'cancel' },
                      {
                        text: 'Open Permissions',
                        onPress: async () => {
                          if (!hasA11y) await UsageStatsModule.openAccessibilitySettings().catch(() => {});
                          else await UsageStatsModule.openUsageAccessSettings().catch(() => {});
                        },
                      },
                    ]
                  );
                  return;
                }
              }
              startFocusMode(task.id);
            }}
          >
            <Ionicons name="shield-checkmark" size={20} color="#fff" />
            <Text style={styles.primaryBtnText}>Activate Focus</Text>
          </TouchableOpacity>
        ) : (
          <TouchableOpacity
            style={[styles.primaryBtn, { backgroundColor: COLORS.muted }]}
            onPress={() => {
              Alert.alert('Stop Focus', 'End focus mode for this task?', [
                { text: 'Cancel', style: 'cancel' },
                { text: 'Stop', style: 'destructive', onPress: () => stopFocusMode() },
              ]);
            }}
          >
            <Ionicons name="stop-circle-outline" size={20} color="#fff" />
            <Text style={styles.primaryBtnText}>Stop Focus</Text>
          </TouchableOpacity>
        )}

        <View style={styles.secondaryActions}>
          <SecondaryBtn
            icon="checkmark-circle-outline"
            label="Done"
            color={COLORS.green}
            onPress={() => {
              Alert.alert('Complete Task', 'Mark this task as done?', [
                { text: 'Cancel', style: 'cancel' },
                { text: 'Done', onPress: () => completeTask(task.id) },
              ]);
            }}
          />
          <SecondaryBtn
            icon="alarm-outline"
            label="Extend"
            color={COLORS.orange}
            onPress={() => setShowExtendModal(true)}
          />
        </View>

        {/* Emergency override — logs the break and stops focus */}
        {isFocusing && (
          <TouchableOpacity
            style={styles.emergencyBtn}
            onPress={() => {
              Alert.alert(
                '🚨 Emergency Override',
                'This will stop focus mode and be logged. Only use in a genuine emergency.',
                [
                  { text: 'Cancel', style: 'cancel' },
                  {
                    text: 'Override',
                    style: 'destructive',
                    onPress: async () => {
                      await dbLogFocusOverride(task.id, 'manual-override', 'User triggered emergency override');
                      await stopFocusMode();
                    },
                  },
                ],
              );
            }}
          >
            <Ionicons name="warning-outline" size={16} color={COLORS.red} />
            <Text style={styles.emergencyBtnText}>Emergency Override</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* Allowed apps list */}
      {isFocusing && (
        <View style={styles.allowedRow}>
          <Text style={[styles.allowedLabel, { color: theme.textSecondary }]}>Allowed: </Text>
          <Text style={[styles.allowedApps, { color: theme.muted }]}>
            {state.settings.allowedInFocus.join(', ')}
          </Text>
        </View>
      )}

        <View style={{ height: 60 + insets.bottom + 20 }} />
      </ScrollView>

      {/* Standalone block status chip (shown while task is active too) */}
      {standaloneActive && settings.standaloneBlockUntil && (
        <TouchableOpacity
          style={styles.standaloneChip}
          onPress={() => setBlockModalVisible(true)}
          activeOpacity={0.8}
        >
          <Ionicons name="ban" size={13} color={COLORS.red} />
          <Text style={styles.standaloneChipText}>
            +{(settings.standaloneBlockPackages ?? []).length} extra apps blocked
          </Text>
          <Ionicons name="add-outline" size={13} color={COLORS.red} />
        </TouchableOpacity>
      )}

      <StandaloneBlockModal
        visible={blockModalVisible}
        blockedPackages={settings.standaloneBlockPackages ?? []}
        blockUntil={settings.standaloneBlockUntil}
        locked={standaloneActive}
        dailyAllowanceEntries={settings.dailyAllowanceEntries ?? []}
        blockPresets={blockPresets}
        recurringBlockSchedules={settings.recurringBlockSchedules ?? []}
        onSave={async (packages, untilMs, allowanceEntries) => {
          await setStandaloneBlockAndAllowance(packages, untilMs, allowanceEntries);
        }}
        onSavePreset={handleSaveBlockPreset}
        onDeletePreset={handleDeleteBlockPreset}
        onSaveRecurringSchedules={async (schedules) => { await setRecurringBlockSchedules(schedules); }}
        onClose={() => setBlockModalVisible(false)}
      />

      {task && (
        <ExtendModal
          visible={showExtendModal}
          taskId={task.id}
          onClose={() => setShowExtendModal(false)}
          onExtend={async (id, mins) => {
            await extendTaskTime(id, mins);
            setShowExtendModal(false);
          }}
        />
      )}
    </SafeAreaView>
  );
}

function StandaloneCountdown({
  untilIso,
  blockedCount,
}: {
  untilIso: string;
  blockedCount: number;
}) {
  const [remaining, setRemaining] = useState(0);

  useEffect(() => {
    const tick = () => {
      const ms = Math.max(0, new Date(untilIso).getTime() - Date.now());
      setRemaining(ms);
    };
    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, [untilIso]);

  const totalHours = Math.floor(remaining / 3600000);
  const mins = Math.floor((remaining % 3600000) / 60000);
  const secs = Math.floor((remaining % 60000) / 1000);

  const timeStr = totalHours > 0
    ? `${totalHours}h ${mins}m`
    : `${mins}:${secs.toString().padStart(2, '0')}`;

  return (
    <View style={[countdownStyles.container, { backgroundColor: COLORS.red + '12', borderColor: COLORS.red + '30' }]}>
      <Text style={[countdownStyles.label, { color: COLORS.red }]}>BLOCK EXPIRES IN</Text>
      <Text style={[countdownStyles.time, { color: COLORS.red }]}>{timeStr}</Text>
      <Text style={[countdownStyles.apps, { color: COLORS.red }]}>
        {blockedCount} app{blockedCount !== 1 ? 's' : ''} blocked · cannot stop early
      </Text>
    </View>
  );
}

const countdownStyles = StyleSheet.create({
  container: {
    alignItems: 'center',
    paddingVertical: SPACING.lg,
    paddingHorizontal: SPACING.xl,
    borderRadius: RADIUS.lg,
    borderWidth: 1.5,
    gap: SPACING.xs,
    width: '100%',
  },
  label: {
    fontSize: FONT.xs,
    fontWeight: '700',
    letterSpacing: 0.8,
  },
  time: {
    fontSize: 44,
    fontWeight: '800',
    letterSpacing: -1,
  },
  apps: {
    fontSize: FONT.xs,
    fontWeight: '600',
    opacity: 0.8,
  },
});

function TimerDisplay({
  startTime,
  endTime,
  color,
  ringSize,
}: {
  startTime: string;
  endTime: string;
  color: string;
  ringSize: number;
}) {
  const timer = useTaskTimer(startTime, endTime);
  const mins = Math.floor(timer.remaining / 60);
  const secs = timer.remaining % 60;
  const timeFontSize = Math.round(ringSize * 0.138);

  return (
    <View style={timerStyles.container}>
      <Text style={[timerStyles.time, { fontSize: timeFontSize }]}>
        {timer.isOverdue ? `+${Math.floor(-timer.remaining / 60)}m` : `${mins}:${secs.toString().padStart(2, '0')}`}
      </Text>
      <Text style={timerStyles.label}>{timer.isOverdue ? 'overdue' : 'remaining'}</Text>
      <Text style={timerStyles.progress}>{Math.round(timer.progress * 100)}%</Text>
    </View>
  );
}

function SecondaryBtn({
  icon,
  label,
  color,
  onPress,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  color: string;
  onPress: () => void;
}) {
  return (
    <TouchableOpacity style={[styles.secondaryBtn, { borderColor: color + '44' }]} onPress={onPress}>
      <Ionicons name={icon} size={22} color={color} />
      <Text style={[styles.secondaryBtnText, { color }]}>{label}</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: COLORS.background },
  emptyContainer: { flexGrow: 1, alignItems: 'center', justifyContent: 'center', padding: SPACING.xl, gap: SPACING.md },
  quickBlockSection: { width: '100%', gap: SPACING.sm },
  quickBlockLabel: { fontSize: FONT.xs, fontWeight: '700', letterSpacing: 0.6, marginBottom: SPACING.xs },
  quickBlockCard: {
    borderRadius: RADIUS.lg,
    borderWidth: StyleSheet.hairlineWidth,
    padding: SPACING.md,
    gap: SPACING.sm,
    width: '100%',
  },
  quickBlockCardTop: { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm },
  quickBlockCardName: { fontSize: FONT.sm, fontWeight: '700', flex: 1 },
  quickBlockCardCount: { fontSize: FONT.xs },
  quickBlockDurations: { flexDirection: 'row', gap: SPACING.sm },
  quickBlockDurationBtn: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: SPACING.sm,
    borderRadius: RADIUS.md,
    borderWidth: 1,
  },
  quickBlockDurationText: { fontSize: FONT.sm, fontWeight: '700' },
  addTimeRow: {
    flexDirection: 'row',
    gap: SPACING.sm,
    padding: SPACING.md,
    borderRadius: RADIUS.lg,
    borderWidth: 1,
  },
  addTimeBtn: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: SPACING.md,
    borderRadius: RADIUS.md,
    borderWidth: 1,
  },
  addTimeBtnText: { fontSize: FONT.md, fontWeight: '700' },
  emptyTitle: { fontSize: FONT.xl, fontWeight: '700', color: COLORS.muted },
  emptySubtitle: { fontSize: FONT.md, color: COLORS.muted, textAlign: 'center', lineHeight: 22 },
  blockScheduleBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
    backgroundColor: COLORS.card,
    borderRadius: RADIUS.lg,
    padding: SPACING.md,
    borderWidth: 1,
    borderColor: COLORS.border,
    marginTop: SPACING.md,
    width: '100%',
  },
  blockScheduleBtnActive: {
    borderColor: COLORS.red + '44',
    backgroundColor: COLORS.red + '08',
  },
  standaloneIconWrap: {
    width: 90,
    height: 90,
    borderRadius: 45,
    alignItems: 'center',
    justifyContent: 'center',
  },
  addMoreAppsBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: SPACING.sm,
    paddingVertical: SPACING.md,
    paddingHorizontal: SPACING.xl,
    borderRadius: RADIUS.lg,
    borderWidth: 1.5,
    width: '100%',
  },
  addMoreAppsBtnText: {
    fontSize: FONT.sm,
    fontWeight: '700',
  },
  createTaskBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: SPACING.sm,
    paddingVertical: SPACING.md,
    paddingHorizontal: SPACING.xl,
    borderRadius: RADIUS.lg,
    width: '100%',
  },
  createTaskBtnText: {
    fontSize: FONT.md,
    fontWeight: '700',
    color: '#fff',
  },
  standaloneChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    alignSelf: 'center',
    backgroundColor: COLORS.red + '12',
    borderRadius: RADIUS.full,
    paddingHorizontal: SPACING.md,
    paddingVertical: 5,
    marginBottom: SPACING.sm,
    borderWidth: 1,
    borderColor: COLORS.red + '30',
  },
  standaloneChipText: {
    fontSize: FONT.xs,
    fontWeight: '700',
    color: COLORS.red,
  },
  blockScheduleBtnText: {
    fontSize: FONT.sm,
    fontWeight: '700',
    color: COLORS.primary,
  },
  blockScheduleBtnDesc: {
    fontSize: FONT.xs,
    color: COLORS.muted,
    marginTop: 2,
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.xs,
    padding: SPACING.lg,
    justifyContent: 'center',
  },
  statusDot: { width: 8, height: 8, borderRadius: 4 },
  statusText: { fontSize: FONT.sm, fontWeight: '600', color: COLORS.textSecondary },
  scrollContent: { flexGrow: 1 },
  centerContent: { alignItems: 'center', justifyContent: 'center', gap: SPACING.md, paddingVertical: SPACING.xl },
  ringOuter: {
    borderWidth: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ringInner: {
    borderWidth: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ringCore: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  taskTitle: { fontSize: FONT.xl, fontWeight: '700', color: COLORS.text, textAlign: 'center', paddingHorizontal: SPACING.xl },
  taskTime: { fontSize: FONT.md, color: COLORS.muted },
  tagsRow: { flexDirection: 'row', gap: SPACING.xs, flexWrap: 'wrap', justifyContent: 'center' },
  tag: { paddingHorizontal: SPACING.sm, paddingVertical: 3, borderRadius: RADIUS.full },
  tagText: { fontSize: FONT.xs, fontWeight: '600' },
  actions: { padding: SPACING.lg, gap: SPACING.sm },
  primaryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: SPACING.sm,
    paddingVertical: SPACING.md,
    borderRadius: RADIUS.lg,
  },
  primaryBtnText: { color: '#fff', fontSize: FONT.md, fontWeight: '700' },
  secondaryActions: { flexDirection: 'row', gap: SPACING.sm },
  secondaryBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: SPACING.xs,
    paddingVertical: SPACING.sm,
    borderRadius: RADIUS.md,
    borderWidth: 1.5,
  },
  secondaryBtnText: { fontSize: FONT.sm, fontWeight: '600' },
  allowedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: SPACING.lg,
    paddingBottom: SPACING.lg,
  },
  allowedLabel: { fontSize: FONT.xs, color: COLORS.muted, fontWeight: '600' },
  allowedApps: { fontSize: FONT.xs, color: COLORS.muted },
  emergencyBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: SPACING.xs,
    paddingVertical: SPACING.sm,
    borderRadius: RADIUS.md,
    borderWidth: 1.5,
    borderColor: COLORS.red + '44',
    backgroundColor: COLORS.red + '08',
  },
  emergencyBtnText: { fontSize: FONT.sm, fontWeight: '600', color: COLORS.red },
  permissionBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
    backgroundColor: COLORS.orange + '18',
    borderBottomWidth: 1,
    borderBottomColor: COLORS.orange + '44',
    paddingHorizontal: SPACING.lg,
    paddingVertical: SPACING.sm,
  },
  permissionBannerText: {
    flex: 1,
    gap: 2,
  },
  permissionBannerTitle: {
    fontSize: FONT.sm,
    fontWeight: '700',
    color: COLORS.orange,
  },
  permissionBannerDesc: {
    fontSize: FONT.xs,
    color: COLORS.textSecondary,
    lineHeight: 16,
  },
});

const timerStyles = StyleSheet.create({
  container: { alignItems: 'center' },
  time: { fontWeight: '800', color: '#fff' },
  label: { fontSize: FONT.xs, color: 'rgba(255,255,255,0.7)', fontWeight: '600' },
  progress: { fontSize: FONT.sm, color: 'rgba(255,255,255,0.9)', fontWeight: '700', marginTop: 2 },
});

export default withScreenErrorBoundary(FocusScreen, 'Focus');
