import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  TextInput,
  Modal,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  KeyboardAvoidingView,
  Switch,
  Alert,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import dayjs from 'dayjs';
import { createTask, parseQuickInput, formatDuration } from '@/services/taskService';
import { COLORS, FONT, RADIUS, SPACING, TASK_COLORS } from '@/styles/theme';
import type { Task, TaskPriority } from '@/data/types';

interface Props {
  visible: boolean;
  onClose: () => void;
  onSave: (task: Task) => Promise<void>;
  initialStartTime?: string;
}

const DURATION_OPTIONS = [15, 30, 45, 60, 90, 120];
const PRIORITY_OPTIONS: TaskPriority[] = ['low', 'medium', 'high', 'critical'];

export default function QuickAddModal({ visible, onClose, onSave, initialStartTime }: Props) {
  const [quickText, setQuickText] = useState('');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [startTime, setStartTime] = useState(
    initialStartTime ?? dayjs().add(5, 'minute').format('HH:mm'),
  );
  const [duration, setDuration] = useState(60);
  const [priority, setPriority] = useState<TaskPriority>('medium');
  const [tags, setTags] = useState('');
  const [color, setColor] = useState(TASK_COLORS[0]);
  const [focusMode, setFocusMode] = useState(false);
  const [isAdvanced, setIsAdvanced] = useState(false);
  const [saving, setSaving] = useState(false);

  const handleQuickParse = useCallback(() => {
    if (!quickText.trim()) return;
    const parsed = parseQuickInput(quickText);
    setTitle(parsed.title);
    setDuration(parsed.durationMinutes);
    if (parsed.startTime) {
      setStartTime(dayjs(parsed.startTime).format('HH:mm'));
    }
    setIsAdvanced(true);
  }, [quickText]);

  const handleSave = useCallback(async () => {
    const finalTitle = title || quickText || 'New Task';
    if (!finalTitle.trim()) {
      Alert.alert('Title required', 'Please enter a task title.');
      return;
    }

    const [hours, mins] = startTime.split(':').map(Number);
    const startISO = dayjs().hour(hours).minute(mins).second(0).toISOString();

    const task = createTask({
      title: finalTitle.trim(),
      description: description.trim() || undefined,
      startTime: startISO,
      durationMinutes: duration,
      priority,
      tags: tags.split(',').map((t) => t.trim()).filter(Boolean),
      color,
      focusMode,
    });

    setSaving(true);
    try {
      await onSave(task);
      handleClose();
    } catch (e) {
      Alert.alert('Error', 'Failed to save task. Please try again.');
    } finally {
      setSaving(false);
    }
  }, [title, quickText, description, startTime, duration, priority, tags, color, focusMode, onSave]);

  const handleClose = () => {
    setQuickText('');
    setTitle('');
    setDescription('');
    setStartTime(initialStartTime ?? dayjs().add(5, 'minute').format('HH:mm'));
    setDuration(60);
    setPriority('medium');
    setTags('');
    setColor(TASK_COLORS[0]);
    setFocusMode(false);
    setIsAdvanced(false);
    onClose();
  };

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={handleClose}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={undefined}
      >
        <View style={styles.container}>
          {/* Header */}
          <View style={styles.header}>
            <TouchableOpacity onPress={handleClose}>
              <Ionicons name="close" size={24} color={COLORS.muted} />
            </TouchableOpacity>
            <Text style={styles.headerTitle}>New Task</Text>
            <TouchableOpacity onPress={handleSave} disabled={saving} style={styles.saveBtn}>
              <Text style={styles.saveBtnText}>{saving ? 'Saving…' : 'Save'}</Text>
            </TouchableOpacity>
          </View>

          <ScrollView style={styles.body} keyboardShouldPersistTaps="handled">

            {/* Quick input */}
            {!isAdvanced && (
              <View style={styles.quickRow}>
                <TextInput
                  style={styles.quickInput}
                  placeholder='e.g. "Call Bob at 3pm for 30m"'
                  placeholderTextColor={COLORS.muted}
                  value={quickText}
                  onChangeText={setQuickText}
                  onSubmitEditing={handleQuickParse}
                  returnKeyType="done"
                  autoFocus
                />
                <TouchableOpacity style={styles.parseBtn} onPress={handleQuickParse}>
                  <Ionicons name="flash" size={18} color="#fff" />
                </TouchableOpacity>
              </View>
            )}

            {(isAdvanced || !quickText) && (
              <>
                {/* Title */}
                <Field label="Title">
                  <TextInput
                    style={styles.input}
                    placeholder="What do you need to do?"
                    placeholderTextColor={COLORS.muted}
                    value={title}
                    onChangeText={setTitle}
                    autoFocus={isAdvanced}
                  />
                </Field>

                {/* Description */}
                <Field label="Notes (optional)">
                  <TextInput
                    style={[styles.input, styles.multiline]}
                    placeholder="Add details…"
                    placeholderTextColor={COLORS.muted}
                    value={description}
                    onChangeText={setDescription}
                    multiline
                    numberOfLines={3}
                  />
                </Field>

                {/* Time */}
                <Field label="Start Time">
                  <TextInput
                    style={styles.input}
                    placeholder="HH:MM"
                    placeholderTextColor={COLORS.muted}
                    value={startTime}
                    onChangeText={setStartTime}
                    keyboardType="numbers-and-punctuation"
                  />
                </Field>

                {/* Duration */}
                <Field label={`Duration: ${formatDuration(duration)}`}>
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipScroll}>
                    {DURATION_OPTIONS.map((d) => (
                      <TouchableOpacity
                        key={d}
                        style={[styles.chip, d === duration && styles.chipSelected]}
                        onPress={() => setDuration(d)}
                      >
                        <Text style={[styles.chipText, d === duration && styles.chipTextSelected]}>
                          {formatDuration(d)}
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </ScrollView>
                </Field>

                {/* Priority */}
                <Field label="Priority">
                  <View style={styles.row}>
                    {PRIORITY_OPTIONS.map((p) => (
                      <TouchableOpacity
                        key={p}
                        style={[styles.chip, p === priority && styles.chipSelected]}
                        onPress={() => setPriority(p)}
                      >
                        <Text style={[styles.chipText, p === priority && styles.chipTextSelected]}>
                          {p}
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                </Field>

                {/* Color */}
                <Field label="Color">
                  <View style={styles.row}>
                    {TASK_COLORS.map((c) => (
                      <TouchableOpacity
                        key={c}
                        style={[styles.colorDot, { backgroundColor: c }, c === color && styles.colorDotSelected]}
                        onPress={() => setColor(c)}
                      />
                    ))}
                  </View>
                </Field>

                {/* Tags */}
                <Field label="Tags (comma separated)">
                  <TextInput
                    style={styles.input}
                    placeholder="work, focus, meeting"
                    placeholderTextColor={COLORS.muted}
                    value={tags}
                    onChangeText={setTags}
                    autoCapitalize="none"
                  />
                </Field>

                {/* Focus Mode toggle */}
                <View style={styles.switchRow}>
                  <View>
                    <Text style={styles.switchLabel}>Enable Focus Mode</Text>
                    <Text style={styles.switchDesc}>Block distractions during this task</Text>
                  </View>
                  <Switch
                    value={focusMode}
                    onValueChange={setFocusMode}
                    trackColor={{ false: COLORS.border, true: COLORS.primary + '88' }}
                    thumbColor={focusMode ? COLORS.primary : COLORS.muted}
                  />
                </View>
              </>
            )}
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: SPACING.lg,
    paddingTop: SPACING.lg,
    paddingBottom: SPACING.md,
    backgroundColor: COLORS.card,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: COLORS.border,
  },
  headerTitle: { fontSize: FONT.lg, fontWeight: '700', color: COLORS.text },
  saveBtn: {
    backgroundColor: COLORS.primary,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.xs,
    borderRadius: RADIUS.full,
  },
  saveBtnText: { color: '#fff', fontWeight: '700', fontSize: FONT.sm },
  body: { flex: 1, padding: SPACING.lg },
  quickRow: { flexDirection: 'row', gap: SPACING.sm, marginBottom: SPACING.md },
  quickInput: {
    flex: 1,
    backgroundColor: COLORS.card,
    borderRadius: RADIUS.md,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
    fontSize: FONT.md,
    color: COLORS.text,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  parseBtn: {
    backgroundColor: COLORS.primary,
    borderRadius: RADIUS.md,
    paddingHorizontal: SPACING.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  field: { marginBottom: SPACING.md },
  fieldLabel: { fontSize: FONT.sm, fontWeight: '600', color: COLORS.textSecondary, marginBottom: SPACING.xs },
  input: {
    backgroundColor: COLORS.card,
    borderRadius: RADIUS.md,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
    fontSize: FONT.md,
    color: COLORS.text,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  multiline: { height: 80, textAlignVertical: 'top', paddingTop: SPACING.sm },
  chipScroll: { flexGrow: 0 },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: SPACING.xs },
  chip: {
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.xs,
    borderRadius: RADIUS.full,
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.border,
    marginRight: SPACING.xs,
  },
  chipSelected: { backgroundColor: COLORS.primary, borderColor: COLORS.primary },
  chipText: { fontSize: FONT.sm, color: COLORS.text, textTransform: 'capitalize' },
  chipTextSelected: { color: '#fff', fontWeight: '600' },
  colorDot: {
    width: 28,
    height: 28,
    borderRadius: 14,
    marginRight: SPACING.xs,
    borderWidth: 2,
    borderColor: 'transparent',
  },
  colorDotSelected: { borderColor: COLORS.text },
  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: COLORS.card,
    borderRadius: RADIUS.md,
    padding: SPACING.md,
    marginBottom: SPACING.md,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  switchLabel: { fontSize: FONT.md, fontWeight: '600', color: COLORS.text },
  switchDesc: { fontSize: FONT.sm, color: COLORS.muted, marginTop: 2 },
});
