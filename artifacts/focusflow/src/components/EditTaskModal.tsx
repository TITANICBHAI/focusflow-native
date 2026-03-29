import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  Modal,
  ScrollView,
  StyleSheet,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import dayjs from 'dayjs';
import { COLORS, FONT, RADIUS, SPACING } from '@/styles/theme';
import type { Task, TaskPriority } from '@/data/types';

interface Props {
  task: Task;
  visible: boolean;
  onClose: () => void;
  onSave: (updated: Task) => Promise<void>;
  onDelete: (taskId: string) => Promise<void>;
}

const PRIORITIES: TaskPriority[] = ['low', 'medium', 'high', 'critical'];
const PRIORITY_COLORS: Record<TaskPriority, string> = {
  low: COLORS.green,
  medium: COLORS.blue,
  high: COLORS.orange,
  critical: COLORS.red,
};
const COLORS_OPTIONS = [
  '#6366f1', '#f59e0b', '#10b981', '#ef4444',
  '#3b82f6', '#8b5cf6', '#ec4899', '#06b6d4',
];

export default function EditTaskModal({ task, visible, onClose, onSave, onDelete }: Props) {
  const [title, setTitle] = useState(task.title);
  const [description, setDescription] = useState(task.description ?? '');
  const [startHour, setStartHour] = useState(dayjs(task.startTime).format('HH'));
  const [startMin, setStartMin] = useState(dayjs(task.startTime).format('mm'));
  const [durationStr, setDurationStr] = useState(String(task.durationMinutes));
  const [priority, setPriority] = useState<TaskPriority>(task.priority);
  const [tags, setTags] = useState(task.tags.join(', '));
  const [color, setColor] = useState(task.color);
  const [focusMode, setFocusMode] = useState(task.focusMode);
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    if (!title.trim()) {
      Alert.alert('Missing title', 'Please enter a task title.');
      return;
    }

    const hour = parseInt(startHour, 10);
    const min = parseInt(startMin, 10);
    const duration = parseInt(durationStr, 10);

    if (isNaN(hour) || hour < 0 || hour > 23) {
      Alert.alert('Invalid time', 'Hour must be 0–23.');
      return;
    }
    if (isNaN(min) || min < 0 || min > 59) {
      Alert.alert('Invalid time', 'Minutes must be 0–59.');
      return;
    }
    if (isNaN(duration) || duration < 5) {
      Alert.alert('Invalid duration', 'Duration must be at least 5 minutes.');
      return;
    }

    const newStart = dayjs(task.startTime).hour(hour).minute(min).second(0).millisecond(0);
    const newEnd = newStart.add(duration, 'minute');

    const updated: Task = {
      ...task,
      title: title.trim(),
      description: description.trim() || undefined,
      startTime: newStart.toISOString(),
      endTime: newEnd.toISOString(),
      durationMinutes: duration,
      priority,
      tags: tags.split(',').map((t) => t.trim()).filter(Boolean),
      color,
      focusMode,
      updatedAt: new Date().toISOString(),
    };

    setSaving(true);
    try {
      await onSave(updated);
      onClose();
    } catch (e) {
      Alert.alert('Error', 'Failed to save task. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = () => {
    Alert.alert(
      'Delete Task',
      `Delete "${task.title}"? This cannot be undone.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            await onDelete(task.id);
            onClose();
          },
        },
      ],
    );
  };

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <SafeAreaView style={styles.safe}>
        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity onPress={onClose}>
            <Text style={styles.cancel}>Cancel</Text>
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Edit Task</Text>
          <TouchableOpacity onPress={handleSave} disabled={saving}>
            <Text style={[styles.save, saving && { opacity: 0.5 }]}>
              {saving ? 'Saving…' : 'Save'}
            </Text>
          </TouchableOpacity>
        </View>

        <ScrollView style={styles.body} contentContainerStyle={styles.bodyContent} keyboardShouldPersistTaps="handled">

          {/* Title */}
          <View style={styles.field}>
            <Text style={styles.label}>Title</Text>
            <TextInput
              style={styles.input}
              value={title}
              onChangeText={setTitle}
              placeholder="Task title"
              placeholderTextColor={COLORS.muted}
              returnKeyType="next"
              autoFocus
            />
          </View>

          {/* Description */}
          <View style={styles.field}>
            <Text style={styles.label}>Notes (optional)</Text>
            <TextInput
              style={[styles.input, styles.textArea]}
              value={description}
              onChangeText={setDescription}
              placeholder="Add notes..."
              placeholderTextColor={COLORS.muted}
              multiline
              numberOfLines={3}
            />
          </View>

          {/* Start time */}
          <View style={styles.field}>
            <Text style={styles.label}>Start Time</Text>
            <View style={styles.timeRow}>
              <TextInput
                style={[styles.input, styles.timeInput]}
                value={startHour}
                onChangeText={setStartHour}
                placeholder="HH"
                placeholderTextColor={COLORS.muted}
                keyboardType="number-pad"
                maxLength={2}
              />
              <Text style={styles.timeSep}>:</Text>
              <TextInput
                style={[styles.input, styles.timeInput]}
                value={startMin}
                onChangeText={setStartMin}
                placeholder="MM"
                placeholderTextColor={COLORS.muted}
                keyboardType="number-pad"
                maxLength={2}
              />
            </View>
          </View>

          {/* Duration */}
          <View style={styles.field}>
            <Text style={styles.label}>Duration (minutes)</Text>
            <TextInput
              style={[styles.input, { width: 120 }]}
              value={durationStr}
              onChangeText={setDurationStr}
              keyboardType="number-pad"
              placeholder="60"
              placeholderTextColor={COLORS.muted}
            />
          </View>

          {/* Priority */}
          <View style={styles.field}>
            <Text style={styles.label}>Priority</Text>
            <View style={styles.chipRow}>
              {PRIORITIES.map((p) => (
                <TouchableOpacity
                  key={p}
                  style={[
                    styles.chip,
                    priority === p && { backgroundColor: PRIORITY_COLORS[p], borderColor: PRIORITY_COLORS[p] },
                  ]}
                  onPress={() => setPriority(p)}
                >
                  <Text style={[styles.chipText, priority === p && { color: '#fff' }]}>
                    {p.charAt(0).toUpperCase() + p.slice(1)}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>

          {/* Tags */}
          <View style={styles.field}>
            <Text style={styles.label}>Tags (comma separated)</Text>
            <TextInput
              style={styles.input}
              value={tags}
              onChangeText={setTags}
              placeholder="work, deep-focus, health"
              placeholderTextColor={COLORS.muted}
            />
          </View>

          {/* Color */}
          <View style={styles.field}>
            <Text style={styles.label}>Color</Text>
            <View style={styles.colorRow}>
              {COLORS_OPTIONS.map((c) => (
                <TouchableOpacity
                  key={c}
                  style={[styles.colorDot, { backgroundColor: c }, color === c && styles.colorDotSelected]}
                  onPress={() => setColor(c)}
                >
                  {color === c && <Ionicons name="checkmark" size={14} color="#fff" />}
                </TouchableOpacity>
              ))}
            </View>
          </View>

          {/* Focus mode toggle */}
          <View style={styles.field}>
            <TouchableOpacity style={styles.toggleRow} onPress={() => setFocusMode((v) => !v)}>
              <View style={styles.toggleInfo}>
                <Text style={styles.toggleTitle}>Focus Mode</Text>
                <Text style={styles.toggleSub}>Block distracting apps during this task</Text>
              </View>
              <View style={[styles.toggle, focusMode && styles.toggleOn]}>
                <View style={[styles.toggleThumb, focusMode && styles.toggleThumbOn]} />
              </View>
            </TouchableOpacity>
          </View>
        </ScrollView>

        {/* Delete */}
        <TouchableOpacity style={styles.deleteBtn} onPress={handleDelete}>
          <Ionicons name="trash-outline" size={18} color={COLORS.red} />
          <Text style={styles.deleteBtnText}>Delete Task</Text>
        </TouchableOpacity>
      </SafeAreaView>
    </Modal>
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
  headerTitle: { fontSize: FONT.md, fontWeight: '700', color: COLORS.text },
  cancel: { fontSize: FONT.md, color: COLORS.muted },
  save: { fontSize: FONT.md, fontWeight: '700', color: COLORS.primary },
  body: { flex: 1 },
  bodyContent: { padding: SPACING.lg, gap: SPACING.lg, paddingBottom: 40 },
  field: { gap: SPACING.xs },
  label: { fontSize: FONT.xs, fontWeight: '700', color: COLORS.muted, textTransform: 'uppercase', letterSpacing: 0.8 },
  input: {
    backgroundColor: COLORS.card,
    borderRadius: RADIUS.md,
    borderWidth: 1.5,
    borderColor: COLORS.border,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
    fontSize: FONT.md,
    color: COLORS.text,
  },
  textArea: { minHeight: 80, textAlignVertical: 'top', paddingTop: SPACING.sm },
  timeRow: { flexDirection: 'row', alignItems: 'center', gap: SPACING.xs },
  timeInput: { width: 70, textAlign: 'center' },
  timeSep: { fontSize: FONT.xl, fontWeight: '700', color: COLORS.text },
  chipRow: { flexDirection: 'row', gap: SPACING.xs, flexWrap: 'wrap' },
  chip: {
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.xs,
    borderRadius: RADIUS.full,
    borderWidth: 1.5,
    borderColor: COLORS.border,
  },
  chipText: { fontSize: FONT.sm, fontWeight: '600', color: COLORS.text },
  colorRow: { flexDirection: 'row', gap: SPACING.sm, flexWrap: 'wrap' },
  colorDot: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  colorDotSelected: { borderWidth: 3, borderColor: '#fff', shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.3, shadowRadius: 4, elevation: 4 },
  toggleRow: { flexDirection: 'row', alignItems: 'center', gap: SPACING.md, backgroundColor: COLORS.card, borderRadius: RADIUS.md, padding: SPACING.md, borderWidth: 1.5, borderColor: COLORS.border },
  toggleInfo: { flex: 1 },
  toggleTitle: { fontSize: FONT.md, fontWeight: '600', color: COLORS.text },
  toggleSub: { fontSize: FONT.xs, color: COLORS.muted, marginTop: 2 },
  toggle: { width: 44, height: 26, borderRadius: 13, backgroundColor: COLORS.border, padding: 3 },
  toggleOn: { backgroundColor: COLORS.primary },
  toggleThumb: { width: 20, height: 20, borderRadius: 10, backgroundColor: '#fff' },
  toggleThumbOn: { transform: [{ translateX: 18 }] },
  deleteBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: SPACING.xs,
    padding: SPACING.md,
    margin: SPACING.lg,
    borderRadius: RADIUS.lg,
    borderWidth: 1.5,
    borderColor: COLORS.red + '44',
    backgroundColor: COLORS.red + '08',
  },
  deleteBtnText: { color: COLORS.red, fontSize: FONT.md, fontWeight: '600' },
});
