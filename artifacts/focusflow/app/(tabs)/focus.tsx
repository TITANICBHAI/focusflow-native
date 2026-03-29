import React, { useEffect } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Animated,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useApp } from '@/context/AppContext';
import { useTaskTimer } from '@/hooks/useTimer';
import { formatTime } from '@/services/taskService';
import { dbLogFocusOverride } from '@/data/database';
import { COLORS, FONT, RADIUS, SPACING } from '@/styles/theme';

export default function FocusScreen() {
  const { state, activeTask, startFocusMode, stopFocusMode, completeTask, extendTaskTime } = useApp();
  const isFocusing = state.focusSession !== null && state.focusSession.isActive;

  const task = activeTask;

  const pulseAnim = React.useRef(new Animated.Value(1)).current;

  useEffect(() => {
    if (!isFocusing) return;
    const pulse = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, { toValue: 1.08, duration: 1200, useNativeDriver: true }),
        Animated.timing(pulseAnim, { toValue: 1, duration: 1200, useNativeDriver: true }),
      ]),
    );
    pulse.start();
    return () => pulse.stop();
  }, [isFocusing]);

  if (!task) {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.emptyContainer}>
          <Ionicons name="moon-outline" size={64} color={COLORS.border} />
          <Text style={styles.emptyTitle}>No Active Task</Text>
          <Text style={styles.emptySubtitle}>
            Start a task from the Schedule tab to activate Focus Mode
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: task.color + '18' }]}>
      {/* Focus status */}
      <View style={styles.statusRow}>
        <View style={[styles.statusDot, { backgroundColor: isFocusing ? COLORS.green : COLORS.muted }]} />
        <Text style={styles.statusText}>
          {isFocusing ? 'Focus Mode Active' : 'Task In Progress'}
        </Text>
      </View>

      {/* Central ring + timer */}
      <View style={styles.centerContent}>
        <Animated.View
          style={[
            styles.ringOuter,
            { borderColor: task.color + '33', transform: [{ scale: pulseAnim }] },
          ]}
        >
          <View style={[styles.ringInner, { borderColor: task.color + '88' }]}>
            <View style={[styles.ringCore, { backgroundColor: task.color }]}>
              <TimerDisplay startTime={task.startTime} endTime={task.endTime} color={task.color} />
            </View>
          </View>
        </Animated.View>

        {/* Task title */}
        <Text style={styles.taskTitle} numberOfLines={2}>{task.title}</Text>
        <Text style={styles.taskTime}>
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

      {/* Violation alert */}
      {state.focusViolationApp && (
        <View style={styles.violationCard}>
          <Ionicons name="ban" size={20} color={COLORS.red} />
          <Text style={styles.violationText}>
            Blocked: {state.focusViolationApp}
          </Text>
        </View>
      )}

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
            onPress={() => {
              Alert.alert('Extend Task', 'How much extra time?', [
                { text: '15m', onPress: () => extendTaskTime(task.id, 15) },
                { text: '30m', onPress: () => extendTaskTime(task.id, 30) },
                { text: '60m', onPress: () => extendTaskTime(task.id, 60) },
                { text: 'Cancel', style: 'cancel' },
              ]);
            }}
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
          <Text style={styles.allowedLabel}>Allowed: </Text>
          <Text style={styles.allowedApps}>
            {state.settings.allowedInFocus.join(', ')}
          </Text>
        </View>
      )}
    </SafeAreaView>
  );
}

function TimerDisplay({
  startTime,
  endTime,
  color,
}: {
  startTime: string;
  endTime: string;
  color: string;
}) {
  const timer = useTaskTimer(startTime, endTime);
  const mins = Math.floor(timer.remaining / 60);
  const secs = timer.remaining % 60;

  return (
    <View style={timerStyles.container}>
      <Text style={timerStyles.time}>
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
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.xs,
    padding: SPACING.lg,
    justifyContent: 'center',
  },
  statusDot: { width: 8, height: 8, borderRadius: 4 },
  statusText: { fontSize: FONT.sm, fontWeight: '600', color: COLORS.textSecondary },
  centerContent: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: SPACING.md },
  ringOuter: {
    width: 260,
    height: 260,
    borderRadius: 130,
    borderWidth: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ringInner: {
    width: 220,
    height: 220,
    borderRadius: 110,
    borderWidth: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ringCore: {
    width: 190,
    height: 190,
    borderRadius: 95,
    alignItems: 'center',
    justifyContent: 'center',
  },
  taskTitle: { fontSize: FONT.xl, fontWeight: '700', color: COLORS.text, textAlign: 'center', paddingHorizontal: SPACING.xl },
  taskTime: { fontSize: FONT.md, color: COLORS.muted },
  tagsRow: { flexDirection: 'row', gap: SPACING.xs, flexWrap: 'wrap', justifyContent: 'center' },
  tag: { paddingHorizontal: SPACING.sm, paddingVertical: 3, borderRadius: RADIUS.full },
  tagText: { fontSize: FONT.xs, fontWeight: '600' },
  violationCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
    backgroundColor: COLORS.redLight,
    marginHorizontal: SPACING.lg,
    borderRadius: RADIUS.md,
    padding: SPACING.md,
    marginBottom: SPACING.sm,
  },
  violationText: { color: COLORS.red, fontWeight: '600', fontSize: FONT.sm, flex: 1 },
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
});

const timerStyles = StyleSheet.create({
  container: { alignItems: 'center' },
  time: { fontSize: 36, fontWeight: '800', color: '#fff' },
  label: { fontSize: FONT.xs, color: 'rgba(255,255,255,0.7)', fontWeight: '600' },
  progress: { fontSize: FONT.sm, color: 'rgba(255,255,255,0.9)', fontWeight: '700', marginTop: 2 },
});
