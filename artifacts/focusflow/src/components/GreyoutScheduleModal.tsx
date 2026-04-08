import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  Modal,
  TouchableOpacity,
  ScrollView,
  TextInput,
  StyleSheet,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '@/hooks/useTheme';
import { COLORS, FONT, RADIUS, SPACING } from '@/styles/theme';
import type { GreyoutWindow } from '@/data/types';

interface Props {
  visible: boolean;
  windows: GreyoutWindow[];
  onSave: (windows: GreyoutWindow[]) => Promise<void>;
  onClose: () => void;
}

const DAY_LABELS  = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
const DAY_NAMES   = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const DAY_VALUES  = [1, 2, 3, 4, 5, 6, 7]; // Calendar.DAY_OF_WEEK

type Mode = 'list' | 'add';

const BLANK_WINDOW: GreyoutWindow = {
  pkg: '',
  startHour: 9,
  startMin: 0,
  endHour: 18,
  endMin: 0,
  days: [2, 3, 4, 5, 6], // Mon–Fri
};

export function GreyoutScheduleModal({ visible, windows, onSave, onClose }: Props) {
  const { theme } = useTheme();
  const [localWindows, setLocalWindows] = useState<GreyoutWindow[]>([]);
  const [mode, setMode] = useState<Mode>('list');
  const [draft, setDraft] = useState<GreyoutWindow>(BLANK_WINDOW);
  const [editIndex, setEditIndex] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (visible) {
      setLocalWindows(windows);
      setMode('list');
      setDraft(BLANK_WINDOW);
      setEditIndex(null);
    }
  }, [visible, windows]);

  const pad = (n: number) => String(n).padStart(2, '0');
  const formatTime = (h: number, m: number) => `${pad(h)}:${pad(m)}`;

  const toggleDay = (dayVal: number) => {
    const exists = draft.days.includes(dayVal);
    setDraft(d => ({
      ...d,
      days: exists ? d.days.filter(v => v !== dayVal) : [...d.days, dayVal].sort((a, b) => a - b),
    }));
  };

  const adjustHour = (field: 'startHour' | 'endHour', delta: number) => {
    setDraft(d => ({ ...d, [field]: (d[field] + delta + 24) % 24 }));
  };

  const adjustMin = (field: 'startMin' | 'endMin', delta: number) => {
    setDraft(d => ({ ...d, [field]: (d[field] + delta + 60) % 60 }));
  };

  const openAdd = () => {
    setDraft(BLANK_WINDOW);
    setEditIndex(null);
    setMode('add');
  };

  const openEdit = (idx: number) => {
    setDraft({ ...localWindows[idx] });
    setEditIndex(idx);
    setMode('add');
  };

  const commitDraft = () => {
    const pkg = draft.pkg.trim();
    if (!pkg) {
      Alert.alert('Package name required', 'Enter the Android package name of the app (e.g. com.instagram.android).');
      return;
    }
    if (draft.days.length === 0) {
      Alert.alert('Select at least one day');
      return;
    }
    const updated = [...localWindows];
    if (editIndex !== null) {
      updated[editIndex] = { ...draft, pkg };
    } else {
      updated.push({ ...draft, pkg });
    }
    setLocalWindows(updated);
    setMode('list');
  };

  const deleteWindow = (idx: number) => {
    Alert.alert(
      'Remove Window',
      `Remove greyout window for ${localWindows[idx].pkg}?`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Remove', style: 'destructive', onPress: () => {
          setLocalWindows(w => w.filter((_, i) => i !== idx));
        }},
      ]
    );
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await onSave(localWindows);
      onClose();
    } finally {
      setSaving(false);
    }
  };

  const dayRowLabel = (window: GreyoutWindow) => {
    if (window.days.length === 7) return 'Every day';
    if (JSON.stringify(window.days) === JSON.stringify([2,3,4,5,6])) return 'Weekdays';
    if (JSON.stringify(window.days) === JSON.stringify([1,7])) return 'Weekends';
    return window.days.map(d => DAY_NAMES[d - 1]).join(', ');
  };

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={[styles.sheet, { backgroundColor: theme.card }]}>

          {/* Header */}
          <View style={[styles.header, { borderBottomColor: theme.border }]}>
            {mode === 'add' ? (
              <TouchableOpacity onPress={() => setMode('list')} style={styles.backBtn}>
                <Ionicons name="chevron-back" size={20} color={theme.text} />
                <Text style={[styles.headerTitle, { color: theme.text }]}>Back</Text>
              </TouchableOpacity>
            ) : (
              <Text style={[styles.headerTitle, { color: theme.text }]}>Greyout Schedule</Text>
            )}
            <TouchableOpacity onPress={onClose} style={styles.closeBtn}>
              <Ionicons name="close" size={22} color={theme.muted} />
            </TouchableOpacity>
          </View>

          {/* ── List view ─── */}
          {mode === 'list' && (
            <>
              <ScrollView style={styles.scroll} contentContainerStyle={{ paddingBottom: 20 }}>
                {localWindows.length === 0 && (
                  <View style={styles.emptyBox}>
                    <Ionicons name="time-outline" size={32} color={theme.muted} />
                    <Text style={[styles.emptyText, { color: theme.muted }]}>
                      No greyout windows yet.{'\n'}Add one to block apps during specific hours.
                    </Text>
                  </View>
                )}
                {localWindows.map((w, idx) => (
                  <View key={idx} style={[styles.windowCard, { borderColor: theme.border, backgroundColor: theme.surface }]}>
                    <TouchableOpacity style={styles.windowMain} onPress={() => openEdit(idx)}>
                      <View style={{ flex: 1 }}>
                        <Text style={[styles.windowPkg, { color: theme.text }]} numberOfLines={1}>{w.pkg}</Text>
                        <Text style={[styles.windowTime, { color: COLORS.primary }]}>
                          {formatTime(w.startHour, w.startMin)} – {formatTime(w.endHour, w.endMin)}
                        </Text>
                        <Text style={[styles.windowDays, { color: theme.muted }]}>{dayRowLabel(w)}</Text>
                      </View>
                      <Ionicons name="create-outline" size={18} color={theme.muted} style={{ marginRight: 8 }} />
                    </TouchableOpacity>
                    <TouchableOpacity onPress={() => deleteWindow(idx)} style={styles.deleteBtn}>
                      <Ionicons name="trash-outline" size={18} color={COLORS.red} />
                    </TouchableOpacity>
                  </View>
                ))}
              </ScrollView>

              <View style={[styles.footer, { borderTopColor: theme.border }]}>
                <TouchableOpacity style={[styles.addBtn, { borderColor: COLORS.primary }]} onPress={openAdd}>
                  <Ionicons name="add" size={18} color={COLORS.primary} />
                  <Text style={[styles.addBtnText, { color: COLORS.primary }]}>Add Window</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.saveBtn, { backgroundColor: COLORS.primary }]}
                  onPress={handleSave}
                  disabled={saving}
                >
                  {saving
                    ? <ActivityIndicator color="#fff" size="small" />
                    : <Text style={styles.saveBtnText}>Save</Text>
                  }
                </TouchableOpacity>
              </View>
            </>
          )}

          {/* ── Add / Edit view ─── */}
          {mode === 'add' && (
            <ScrollView style={styles.scroll} contentContainerStyle={{ paddingBottom: 20 }}>
              <Text style={[styles.formLabel, { color: theme.muted }]}>PACKAGE NAME</Text>
              <TextInput
                style={[styles.pkgInput, { color: theme.text, borderColor: theme.border, backgroundColor: theme.surface }]}
                value={draft.pkg}
                onChangeText={t => setDraft(d => ({ ...d, pkg: t }))}
                placeholder="com.instagram.android"
                placeholderTextColor={theme.muted}
                autoCapitalize="none"
                autoCorrect={false}
              />
              <Text style={[styles.formHint, { color: theme.muted }]}>
                Find it in Settings → Apps → [App name] → App info.
              </Text>

              {/* Start time */}
              <Text style={[styles.formLabel, { color: theme.muted }]}>START TIME</Text>
              <View style={styles.timeRow}>
                <TimePicker
                  label="Hour"
                  value={draft.startHour}
                  onDecrement={() => adjustHour('startHour', -1)}
                  onIncrement={() => adjustHour('startHour', 1)}
                  theme={theme}
                />
                <Text style={[styles.timeSep, { color: theme.muted }]}>:</Text>
                <TimePicker
                  label="Min"
                  value={draft.startMin}
                  onDecrement={() => adjustMin('startMin', -5)}
                  onIncrement={() => adjustMin('startMin', 5)}
                  theme={theme}
                  pad
                />
              </View>

              {/* End time */}
              <Text style={[styles.formLabel, { color: theme.muted }]}>END TIME</Text>
              <View style={styles.timeRow}>
                <TimePicker
                  label="Hour"
                  value={draft.endHour}
                  onDecrement={() => adjustHour('endHour', -1)}
                  onIncrement={() => adjustHour('endHour', 1)}
                  theme={theme}
                />
                <Text style={[styles.timeSep, { color: theme.muted }]}>:</Text>
                <TimePicker
                  label="Min"
                  value={draft.endMin}
                  onDecrement={() => adjustMin('endMin', -5)}
                  onIncrement={() => adjustMin('endMin', 5)}
                  theme={theme}
                  pad
                />
              </View>

              {/* Days */}
              <Text style={[styles.formLabel, { color: theme.muted }]}>ACTIVE DAYS</Text>
              <View style={styles.daysRow}>
                {DAY_VALUES.map((dayVal, i) => {
                  const active = draft.days.includes(dayVal);
                  return (
                    <TouchableOpacity
                      key={dayVal}
                      style={[
                        styles.dayChip,
                        { borderColor: active ? COLORS.primary : theme.border },
                        active && { backgroundColor: COLORS.primary },
                      ]}
                      onPress={() => toggleDay(dayVal)}
                    >
                      <Text style={[styles.dayChipText, { color: active ? '#fff' : theme.muted }]}>
                        {DAY_LABELS[i]}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>

              <View style={{ flexDirection: 'row', gap: SPACING.sm, marginTop: SPACING.lg }}>
                <TouchableOpacity
                  style={[styles.cancelAddBtn, { borderColor: theme.border }]}
                  onPress={() => setMode('list')}
                >
                  <Text style={[styles.cancelAddText, { color: theme.muted }]}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.confirmAddBtn, { backgroundColor: COLORS.primary }]}
                  onPress={commitDraft}
                >
                  <Text style={styles.confirmAddText}>
                    {editIndex !== null ? 'Update Window' : 'Add Window'}
                  </Text>
                </TouchableOpacity>
              </View>
            </ScrollView>
          )}
        </View>
      </View>
    </Modal>
  );
}

// ─── Time picker sub-component ────────────────────────────────────────────────

function TimePicker({
  label, value, onDecrement, onIncrement, theme, pad: doPad,
}: {
  label: string;
  value: number;
  onDecrement: () => void;
  onIncrement: () => void;
  theme: ReturnType<typeof useTheme>['theme'];
  pad?: boolean;
}) {
  const display = doPad ? String(value).padStart(2, '0') : String(value);
  return (
    <View style={styles.timePicker}>
      <Text style={[styles.timePickerLabel, { color: theme.muted }]}>{label}</Text>
      <TouchableOpacity onPress={onIncrement} style={styles.timeArrow}>
        <Ionicons name="chevron-up" size={20} color={theme.text} />
      </TouchableOpacity>
      <Text style={[styles.timePickerValue, { color: theme.text }]}>{display}</Text>
      <TouchableOpacity onPress={onDecrement} style={styles.timeArrow}>
        <Ionicons name="chevron-down" size={20} color={theme.text} />
      </TouchableOpacity>
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.55)',
    justifyContent: 'flex-end',
  },
  sheet: {
    borderTopLeftRadius: RADIUS.xl,
    borderTopRightRadius: RADIUS.xl,
    maxHeight: '88%',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: SPACING.lg,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  backBtn: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  headerTitle: { fontSize: FONT.lg, fontWeight: '700' },
  closeBtn: { padding: 4 },
  scroll: { paddingHorizontal: SPACING.lg },

  emptyBox: {
    alignItems: 'center',
    paddingVertical: SPACING.xl,
    gap: SPACING.sm,
  },
  emptyText: {
    fontSize: FONT.sm,
    textAlign: 'center',
    lineHeight: 20,
  },
  windowCard: {
    borderRadius: RADIUS.md,
    borderWidth: StyleSheet.hairlineWidth,
    marginTop: SPACING.sm,
    flexDirection: 'row',
    alignItems: 'center',
    overflow: 'hidden',
  },
  windowMain: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    padding: SPACING.md,
  },
  windowPkg: { fontSize: FONT.sm, fontWeight: '600' },
  windowTime: { fontSize: FONT.md, fontWeight: '700', marginTop: 2 },
  windowDays: { fontSize: FONT.xs, marginTop: 2 },
  deleteBtn: {
    padding: SPACING.md,
    borderLeftWidth: StyleSheet.hairlineWidth,
    borderLeftColor: COLORS.border,
  },

  footer: {
    flexDirection: 'row',
    gap: SPACING.sm,
    padding: SPACING.lg,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  addBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: SPACING.xs,
    paddingVertical: SPACING.sm,
    borderRadius: RADIUS.md,
    borderWidth: 1,
  },
  addBtnText: { fontSize: FONT.sm, fontWeight: '600' },
  saveBtn: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: SPACING.sm,
    borderRadius: RADIUS.md,
  },
  saveBtnText: { color: '#fff', fontSize: FONT.sm, fontWeight: '700' },

  formLabel: {
    fontSize: FONT.xs,
    fontWeight: '700',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    marginTop: SPACING.lg,
    marginBottom: SPACING.xs,
  },
  pkgInput: {
    borderWidth: 1,
    borderRadius: RADIUS.md,
    padding: SPACING.sm,
    fontSize: FONT.sm,
  },
  formHint: {
    fontSize: FONT.xs,
    marginTop: SPACING.xs,
    marginBottom: SPACING.xs,
  },

  timeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
    marginBottom: SPACING.sm,
  },
  timeSep: {
    fontSize: FONT.xl,
    fontWeight: '300',
    marginTop: 16,
  },
  timePicker: {
    alignItems: 'center',
    width: 72,
  },
  timePickerLabel: {
    fontSize: FONT.xs,
    marginBottom: 2,
  },
  timeArrow: {
    padding: 4,
  },
  timePickerValue: {
    fontSize: FONT.xxl,
    fontWeight: '700',
    minWidth: 48,
    textAlign: 'center',
  },

  daysRow: {
    flexDirection: 'row',
    gap: SPACING.xs,
  },
  dayChip: {
    width: 36,
    height: 36,
    borderRadius: 18,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dayChipText: { fontSize: FONT.sm, fontWeight: '700' },

  cancelAddBtn: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: SPACING.sm,
    borderRadius: RADIUS.md,
    borderWidth: 1,
  },
  cancelAddText: { fontSize: FONT.sm, fontWeight: '600' },
  confirmAddBtn: {
    flex: 2,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: SPACING.sm,
    borderRadius: RADIUS.md,
  },
  confirmAddText: { color: '#fff', fontSize: FONT.sm, fontWeight: '700' },
});
