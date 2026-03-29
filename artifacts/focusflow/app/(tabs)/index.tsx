import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  Alert,
  RefreshControl,
  Modal,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import dayjs from 'dayjs';
import { useApp } from '@/context/AppContext';
import TaskCard from '@/components/TaskCard';
import TimelineView from '@/components/TimelineView';
import QuickAddModal from '@/components/QuickAddModal';
import ExtendModal from '@/components/ExtendModal';
import EditTaskModal from '@/components/EditTaskModal';
import { COLORS, FONT, RADIUS, SPACING, SHADOW } from '@/styles/theme';
import type { Task } from '@/data/types';
import { formatTime } from '@/services/taskService';

type ViewMode = 'list' | 'timeline';

export default function ScheduleScreen() {
  const { state, todayTasks, activeTask, addTask, updateTask, deleteTask, completeTask, skipTask, extendTaskTime, startFocusMode, refreshTasks } = useApp();
  const [viewMode, setViewMode] = useState<ViewMode>('list');
  const [showAddModal, setShowAddModal] = useState(false);
  const [extendTaskId, setExtendTaskId] = useState<string | null>(null);
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);
  const [editTask, setEditTask] = useState<Task | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await refreshTasks();
    setRefreshing(false);
  }, [refreshTasks]);

  const handleCompleteTask = useCallback(
    async (taskId: string) => {
      Alert.alert('Complete Task', 'Mark this task as done?', [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Complete',
          onPress: async () => {
            await completeTask(taskId);
          },
        },
      ]);
    },
    [completeTask],
  );

  const handleSkipTask = useCallback(
    async (taskId: string) => {
      Alert.alert('Skip Task', 'Skip this task?', [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Skip',
          style: 'destructive',
          onPress: async () => {
            await skipTask(taskId);
          },
        },
      ]);
    },
    [skipTask],
  );

  const completedCount = todayTasks.filter((t) => t.status === 'completed').length;
  const totalCount = todayTasks.length;

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      {/* Header */}
      <View style={styles.header}>
        <View>
          <Text style={styles.dateText}>{dayjs().format('dddd, MMMM D')}</Text>
          <Text style={styles.subtitle}>
            {completedCount}/{totalCount} tasks done
          </Text>
        </View>
        <View style={styles.headerRight}>
          {/* View toggle */}
          <View style={styles.viewToggle}>
            <TouchableOpacity
              style={[styles.toggleBtn, viewMode === 'list' && styles.toggleBtnActive]}
              onPress={() => setViewMode('list')}
            >
              <Ionicons name="list" size={18} color={viewMode === 'list' ? '#fff' : COLORS.muted} />
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.toggleBtn, viewMode === 'timeline' && styles.toggleBtnActive]}
              onPress={() => setViewMode('timeline')}
            >
              <Ionicons name="time-outline" size={18} color={viewMode === 'timeline' ? '#fff' : COLORS.muted} />
            </TouchableOpacity>
          </View>
        </View>
      </View>

      {/* Active Task Banner */}
      {activeTask && (
        <TouchableOpacity
          style={styles.activeBanner}
          onPress={() => setSelectedTask(activeTask)}
          activeOpacity={0.9}
        >
          <View style={styles.activePulse} />
          <View style={styles.activeBannerContent}>
            <Text style={styles.activeBannerLabel}>NOW</Text>
            <Text style={styles.activeBannerTitle} numberOfLines={1}>
              {activeTask.title}
            </Text>
            <Text style={styles.activeBannerTime}>
              until {formatTime(activeTask.endTime)}
            </Text>
          </View>
          <View style={styles.activeBannerActions}>
            <TouchableOpacity
              style={styles.bannerAction}
              onPress={() => handleCompleteTask(activeTask.id)}
            >
              <Ionicons name="checkmark" size={16} color="#fff" />
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.bannerAction, { backgroundColor: 'rgba(255,255,255,0.15)' }]}
              onPress={() => setExtendTaskId(activeTask.id)}
            >
              <Ionicons name="add" size={16} color="#fff" />
            </TouchableOpacity>
            {activeTask.focusMode && (
              <TouchableOpacity
                style={[styles.bannerAction, { backgroundColor: 'rgba(245,158,11,0.4)' }]}
                onPress={() => startFocusMode(activeTask.id)}
              >
                <Ionicons name="shield-checkmark-outline" size={16} color="#fff" />
              </TouchableOpacity>
            )}
          </View>
        </TouchableOpacity>
      )}

      {/* Focus violation overlay */}
      {state.focusViolationApp && (
        <View style={styles.violationBanner}>
          <Ionicons name="ban" size={16} color="#fff" />
          <Text style={styles.violationText}>
            {state.focusViolationApp} blocked — stay focused!
          </Text>
        </View>
      )}

      {/* Task list or timeline */}
      {viewMode === 'list' ? (
        <ScrollView
          style={styles.list}
          contentContainerStyle={styles.listContent}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        >
          {todayTasks.length === 0 && (
            <View style={styles.emptyState}>
              <Ionicons name="calendar-outline" size={48} color={COLORS.border} />
              <Text style={styles.emptyText}>No tasks scheduled for today</Text>
              <Text style={styles.emptySubtext}>Tap + to add your first task</Text>
            </View>
          )}

          {todayTasks.map((task) => (
            <TaskCard
              key={task.id}
              task={task}
              isActive={task.id === activeTask?.id}
              onPress={(t) => setSelectedTask(t)}
              onComplete={handleCompleteTask}
              onSkip={handleSkipTask}
              onExtend={(id) => setExtendTaskId(id)}
              onStartFocus={startFocusMode}
            />
          ))}
        </ScrollView>
      ) : (
        <TimelineView tasks={todayTasks} onTaskPress={setSelectedTask} />
      )}

      {/* FAB */}
      <TouchableOpacity style={styles.fab} onPress={() => setShowAddModal(true)}>
        <Ionicons name="add" size={28} color="#fff" />
      </TouchableOpacity>

      {/* Modals */}
      <QuickAddModal
        visible={showAddModal}
        onClose={() => setShowAddModal(false)}
        onSave={addTask}
      />

      {extendTaskId && (
        <ExtendModal
          visible
          taskId={extendTaskId}
          onClose={() => setExtendTaskId(null)}
          onExtend={async (id, mins) => {
            await extendTaskTime(id, mins);
            setExtendTaskId(null);
          }}
        />
      )}

      {selectedTask && (
        <TaskDetailModal
          task={selectedTask}
          onClose={() => setSelectedTask(null)}
          onComplete={handleCompleteTask}
          onSkip={handleSkipTask}
          onExtend={(id) => { setSelectedTask(null); setExtendTaskId(id); }}
          onStartFocus={startFocusMode}
          onEdit={(task) => { setSelectedTask(null); setEditTask(task); }}
        />
      )}

      {editTask && (
        <EditTaskModal
          visible
          task={editTask}
          onClose={() => setEditTask(null)}
          onSave={updateTask}
          onDelete={async (id) => { await deleteTask(id); setEditTask(null); }}
        />
      )}
    </SafeAreaView>
  );
}

// ─── Task Detail Modal ────────────────────────────────────────────────────────

function TaskDetailModal({
  task,
  onClose,
  onComplete,
  onSkip,
  onExtend,
  onStartFocus,
  onEdit,
}: {
  task: Task;
  onClose: () => void;
  onComplete: (id: string) => void;
  onSkip: (id: string) => void;
  onExtend: (id: string) => void;
  onStartFocus: (id: string) => void;
  onEdit: (task: Task) => void;
}) {
  const isActive =
    task.status !== 'completed' &&
    task.status !== 'skipped' &&
    dayjs(task.startTime).isBefore(dayjs()) &&
    dayjs(task.endTime).isAfter(dayjs());

  return (
    <Modal visible animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <SafeAreaView style={detailStyles.safe}>
        <View style={detailStyles.header}>
          <View style={[detailStyles.colorDot, { backgroundColor: task.color }]} />
          <Text style={detailStyles.title} numberOfLines={2}>{task.title}</Text>
          <TouchableOpacity onPress={onClose}>
            <Ionicons name="close" size={24} color={COLORS.muted} />
          </TouchableOpacity>
        </View>

        <ScrollView style={detailStyles.body}>
          {task.description && (
            <View style={detailStyles.section}>
              <Text style={detailStyles.label}>Notes</Text>
              <Text style={detailStyles.desc}>{task.description}</Text>
            </View>
          )}

          <View style={detailStyles.section}>
            <Text style={detailStyles.label}>Schedule</Text>
            <Text style={detailStyles.value}>{formatTime(task.startTime)} – {formatTime(task.endTime)}</Text>
            <Text style={detailStyles.subvalue}>{dayjs(task.startTime).format('dddd, MMMM D')}</Text>
          </View>

          <View style={detailStyles.section}>
            <Text style={detailStyles.label}>Priority</Text>
            <Text style={[detailStyles.value, { textTransform: 'capitalize' }]}>{task.priority}</Text>
          </View>

          {task.tags.length > 0 && (
            <View style={detailStyles.section}>
              <Text style={detailStyles.label}>Tags</Text>
              <Text style={detailStyles.value}>{task.tags.map((t) => `#${t}`).join(' ')}</Text>
            </View>
          )}

          <View style={detailStyles.section}>
            <Text style={detailStyles.label}>Status</Text>
            <Text style={[detailStyles.value, { textTransform: 'capitalize' }]}>{task.status}</Text>
          </View>
        </ScrollView>

        {/* Actions */}
        <View style={detailStyles.actions}>
          <ActionBtn label="Edit" icon="create-outline" color={COLORS.blue} onPress={() => onEdit(task)} />
          {task.status !== 'completed' && task.status !== 'skipped' && (
            <>
              <ActionBtn label="Complete" icon="checkmark-circle" color={COLORS.green} onPress={() => { onComplete(task.id); onClose(); }} />
              <ActionBtn label="Skip" icon="close-circle" color={COLORS.muted} onPress={() => { onSkip(task.id); onClose(); }} />
              <ActionBtn label="Extend" icon="alarm-outline" color={COLORS.orange} onPress={() => onExtend(task.id)} />
              {task.focusMode && (
                <ActionBtn label="Focus" icon="shield-checkmark" color={COLORS.primary} onPress={() => { onStartFocus(task.id); onClose(); }} />
              )}
            </>
          )}
        </View>
      </SafeAreaView>
    </Modal>
  );
}

function ActionBtn({ label, icon, color, onPress }: { label: string; icon: keyof typeof Ionicons.glyphMap; color: string; onPress: () => void }) {
  return (
    <TouchableOpacity style={detailStyles.actionBtn} onPress={onPress}>
      <View style={[detailStyles.actionIcon, { backgroundColor: color + '22' }]}>
        <Ionicons name={icon} size={22} color={color} />
      </View>
      <Text style={[detailStyles.actionLabel, { color }]}>{label}</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: COLORS.background },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: SPACING.lg,
    paddingVertical: SPACING.md,
    backgroundColor: COLORS.card,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: COLORS.border,
  },
  dateText: { fontSize: FONT.xl, fontWeight: '700', color: COLORS.text },
  subtitle: { fontSize: FONT.sm, color: COLORS.muted, marginTop: 2 },
  headerRight: { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm },
  viewToggle: {
    flexDirection: 'row',
    backgroundColor: COLORS.surface,
    borderRadius: RADIUS.md,
    padding: 3,
  },
  toggleBtn: {
    padding: SPACING.xs,
    borderRadius: RADIUS.sm,
  },
  toggleBtnActive: { backgroundColor: COLORS.primary },
  activeBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.primary,
    marginHorizontal: SPACING.lg,
    marginTop: SPACING.md,
    borderRadius: RADIUS.lg,
    padding: SPACING.md,
    ...SHADOW.lg,
  },
  activePulse: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#fff',
    marginRight: SPACING.sm,
    opacity: 0.8,
  },
  activeBannerContent: { flex: 1 },
  activeBannerLabel: { fontSize: FONT.xs, fontWeight: '700', color: 'rgba(255,255,255,0.7)', letterSpacing: 1 },
  activeBannerTitle: { fontSize: FONT.md, fontWeight: '700', color: '#fff' },
  activeBannerTime: { fontSize: FONT.xs, color: 'rgba(255,255,255,0.7)' },
  activeBannerActions: { flexDirection: 'row', gap: SPACING.xs },
  bannerAction: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: 'rgba(255,255,255,0.25)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  violationBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.xs,
    backgroundColor: COLORS.red,
    marginHorizontal: SPACING.lg,
    marginTop: SPACING.xs,
    borderRadius: RADIUS.md,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.xs,
  },
  violationText: { color: '#fff', fontSize: FONT.sm, fontWeight: '600' },
  list: { flex: 1, marginTop: SPACING.md },
  listContent: { paddingHorizontal: SPACING.lg, paddingBottom: 100 },
  emptyState: { alignItems: 'center', paddingTop: 80, gap: SPACING.sm },
  emptyText: { fontSize: FONT.lg, fontWeight: '600', color: COLORS.muted },
  emptySubtext: { fontSize: FONT.sm, color: COLORS.border },
  fab: {
    position: 'absolute',
    bottom: 30,
    right: SPACING.lg,
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: COLORS.primary,
    alignItems: 'center',
    justifyContent: 'center',
    ...SHADOW.lg,
  },
});

const detailStyles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: COLORS.background },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    padding: SPACING.lg,
    gap: SPACING.sm,
    backgroundColor: COLORS.card,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: COLORS.border,
  },
  colorDot: { width: 12, height: 12, borderRadius: 6, marginTop: 4 },
  title: { flex: 1, fontSize: FONT.xl, fontWeight: '700', color: COLORS.text },
  body: { flex: 1, padding: SPACING.lg },
  section: { marginBottom: SPACING.lg },
  label: { fontSize: FONT.xs, fontWeight: '700', color: COLORS.muted, textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: SPACING.xs },
  desc: { fontSize: FONT.md, color: COLORS.text, lineHeight: 22 },
  value: { fontSize: FONT.md, fontWeight: '600', color: COLORS.text },
  subvalue: { fontSize: FONT.sm, color: COLORS.muted, marginTop: 2 },
  actions: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    paddingVertical: SPACING.lg,
    paddingHorizontal: SPACING.md,
    backgroundColor: COLORS.card,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: COLORS.border,
  },
  actionBtn: { alignItems: 'center', gap: SPACING.xs },
  actionIcon: { width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center' },
  actionLabel: { fontSize: FONT.xs, fontWeight: '600' },
});
