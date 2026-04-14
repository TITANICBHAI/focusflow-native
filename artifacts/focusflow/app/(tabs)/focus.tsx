import React, { useEffect, useState } from 'react';
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

export default function FocusScreen() {
  const insets = useSafeAreaInsets();
  const { theme } = useTheme();
  const { width: windowWidth } = useWindowDimensions();
  const ringSize = Math.min(Math.floor(windowWidth * 0.65), 260);
  const { state, activeTask, startFocusMode, stopFocusMode, completeTask, extendTaskTime, setStandaloneBlockAndAllowance } = useApp();
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
    return (
      <SafeAreaView style={[styles.safe, { backgroundColor: theme.background }]}>
        <View style={styles.emptyContainer}>
          <Ionicons name="moon-outline" size={64} color={theme.border} />
          <Text style={[styles.emptyTitle, { color: theme.muted }]}>No Active Task</Text>
          <Text style={[styles.emptySubtitle, { color: theme.muted }]}>
            Start a task from the Schedule tab to activate Focus Mode
          </Text>

          <TouchableOpacity
            style={[styles.blockScheduleBtn, { backgroundColor: theme.card, borderColor: theme.border }, standaloneActive && styles.blockScheduleBtnActive]}
            onPress={() => setBlockModalVisible(true)}
            activeOpacity={0.8}
          >
            <Ionicons
              name={standaloneActive ? 'ban' : 'ban-outline'}
              size={18}
              color={standaloneActive ? COLORS.red : COLORS.primary}
            />
            <View style={{ flex: 1 }}>
              <Text style={[styles.blockScheduleBtnText, { color: theme.text }, standaloneActive && { color: COLORS.red }]}>
                {standaloneActive ? 'Block Schedule Active' : 'Set Block Schedule'}
              </Text>
              {standaloneActive && settings.standaloneBlockUntil && (
                <Text style={[styles.blockScheduleBtnDesc, { color: theme.textSecondary }]}>
                  {(settings.standaloneBlockPackages ?? []).length} apps blocked until{' '}
                  {dayjs(settings.standaloneBlockUntil).format('MMM D [at] h:mm A')}
                </Text>
              )}
            </View>
            <Ionicons name="chevron-forward" size={16} color={COLORS.border} />
          </TouchableOpacity>
        </View>

        <StandaloneBlockModal
          visible={blockModalVisible}
          blockedPackages={settings.standaloneBlockPackages ?? []}
          blockUntil={settings.standaloneBlockUntil}
          locked={standaloneActive}
          dailyAllowanceEntries={settings.dailyAllowanceEntries ?? []}
          onSave={async (packages, untilMs, allowanceEntries) => {
            await setStandaloneBlockAndAllowance(packages, untilMs, allowanceEntries);
          }}
          onClose={() => setBlockModalVisible(false)}
        />
        <View style={{ height: 60 + insets.bottom + 20 }} />
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
            onPress={() => startFocusMode(task.id)}
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

      <StandaloneBlockModal
        visible={blockModalVisible}
        blockedPackages={settings.standaloneBlockPackages ?? []}
        blockUntil={settings.standaloneBlockUntil}
        locked={standaloneActive}
        dailyAllowanceEntries={settings.dailyAllowanceEntries ?? []}
        onSave={async (packages, untilMs, allowanceEntries) => {
          await setStandaloneBlockAndAllowance(packages, untilMs, allowanceEntries);
        }}
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
  emptyContainer: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: SPACING.xl, gap: SPACING.md },
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
