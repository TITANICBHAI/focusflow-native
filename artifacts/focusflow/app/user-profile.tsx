import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { router, useNavigation } from 'expo-router';
import { useApp } from '@/context/AppContext';
import { useTheme } from '@/hooks/useTheme';
import type { UserProfile } from '@/data/types';
import { COLORS, FONT, RADIUS, SPACING } from '@/styles/theme';

// ── Option data ───────────────────────────────────────────────────────────────

const OCCUPATIONS = [
  { id: 'student',      label: 'Student',      icon: 'school-outline'    },
  { id: 'professional', label: 'Professional', icon: 'briefcase-outline' },
  { id: 'freelancer',   label: 'Freelancer',   icon: 'laptop-outline'    },
  { id: 'creator',      label: 'Creator',      icon: 'color-palette-outline' },
  { id: 'other',        label: 'Other',        icon: 'person-outline'    },
];

const WAKE_UP_TIMES = [
  { id: '05:00', label: '5 am' },
  { id: '06:00', label: '6 am' },
  { id: '07:00', label: '7 am' },
  { id: '08:00', label: '8 am' },
  { id: '09:00', label: '9 am' },
  { id: '10:00', label: '10 am' },
  { id: '11:00', label: '11 am' },
];

const FOCUS_GOALS = [
  { id: 'deep_work',   label: 'Deep Work',      icon: 'flash-outline'         },
  { id: 'study',       label: 'Study',          icon: 'book-outline'          },
  { id: 'no_social',   label: 'No Social Media',icon: 'phone-portrait-outline' },
  { id: 'reading',     label: 'Reading',        icon: 'library-outline'       },
  { id: 'exercise',    label: 'Exercise',       icon: 'fitness-outline'       },
  { id: 'creative',    label: 'Creative',       icon: 'brush-outline'         },
  { id: 'coding',      label: 'Coding',         icon: 'code-slash-outline'    },
  { id: 'writing',     label: 'Writing',        icon: 'create-outline'        },
];

// ── Screen ────────────────────────────────────────────────────────────────────

export default function UserProfileScreen() {
  const { state, updateSettings } = useApp();
  const { theme } = useTheme();
  const navigation = useNavigation();
  const isEditMode = navigation.canGoBack(); // came from settings — back is available

  const existing = state.settings.userProfile ?? {};
  const [name, setName]           = useState(existing.name ?? '');
  const [occupation, setOccupation] = useState(existing.occupation ?? '');
  const [goalHours, setGoalHours] = useState(existing.dailyGoalHours ?? 4);
  const [wakeTime, setWakeTime]   = useState(existing.wakeUpTime ?? '');
  const [goals, setGoals]         = useState<string[]>(existing.focusGoals ?? []);
  const [saving, setSaving]       = useState(false);

  const toggleGoal = (id: string) => {
    setGoals((prev) =>
      prev.includes(id) ? prev.filter((g) => g !== id) : [...prev, id],
    );
  };

  const handleSave = async () => {
    if (saving) return;
    setSaving(true);
    try {
      const profile: UserProfile = {
        name: name.trim() || undefined,
        occupation: occupation || undefined,
        dailyGoalHours: goalHours,
        wakeUpTime: wakeTime || undefined,
        focusGoals: goals.length > 0 ? goals : undefined,
      };
      const updated = {
        ...state.settings,
        onboardingComplete: true,
        userProfile: profile,
      };
      await updateSettings(updated);
      if (isEditMode) {
        router.back();
      } else {
        router.replace('/');
      }
    } finally {
      setSaving(false);
    }
  };

  const handleSkip = async () => {
    if (isEditMode) { router.back(); return; }
    // Mark onboarding done but don't save a profile
    await updateSettings({ ...state.settings, onboardingComplete: true });
    router.replace('/');
  };

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: theme.background }]}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>

        {/* Top bar */}
        <View style={[styles.topBar, { borderBottomColor: theme.border }]}>
          {isEditMode ? (
            <TouchableOpacity onPress={() => router.back()} style={styles.iconBtn} hitSlop={12}>
              <Ionicons name="arrow-back" size={22} color={theme.text} />
            </TouchableOpacity>
          ) : (
            <View style={{ width: 40 }} />
          )}
          <Text style={[styles.topTitle, { color: theme.text }]}>
            {isEditMode ? 'Your Profile' : 'Tell Us About You'}
          </Text>
          {!isEditMode && (
            <TouchableOpacity onPress={handleSkip} style={styles.skipBtn} hitSlop={8}>
              <Text style={styles.skipText}>Skip</Text>
            </TouchableOpacity>
          )}
          {isEditMode && <View style={{ width: 40 }} />}
        </View>

        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">

          {!isEditMode && (
            <Text style={[styles.intro, { color: theme.muted }]}>
              This helps FocusFlow personalise your daily summaries and weekly reports. Everything is stored locally — nothing is shared.
            </Text>
          )}

          {/* Name */}
          <FormSection title="What's your name?">
            <TextInput
              style={[styles.textInput, { backgroundColor: theme.card, borderColor: theme.border, color: theme.text }]}
              placeholder="e.g. Alex"
              placeholderTextColor={theme.muted}
              value={name}
              onChangeText={setName}
              autoCapitalize="words"
              returnKeyType="done"
              maxLength={40}
            />
          </FormSection>

          {/* Occupation */}
          <FormSection title="What best describes you?">
            <View style={styles.chipGrid}>
              {OCCUPATIONS.map((o) => {
                const selected = occupation === o.id;
                return (
                  <TouchableOpacity
                    key={o.id}
                    style={[styles.chip, selected && styles.chipSelected, { borderColor: selected ? COLORS.primary : theme.border, backgroundColor: selected ? COLORS.primary : theme.card }]}
                    onPress={() => setOccupation(selected ? '' : o.id)}
                    activeOpacity={0.75}
                  >
                    <Ionicons name={o.icon as any} size={15} color={selected ? '#fff' : theme.muted} />
                    <Text style={[styles.chipLabel, { color: selected ? '#fff' : theme.text }]}>{o.label}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </FormSection>

          {/* Daily focus goal */}
          <FormSection title="Daily focus goal (hours)">
            <View style={styles.stepperRow}>
              <TouchableOpacity
                style={[styles.stepBtn, { backgroundColor: theme.card, borderColor: theme.border }]}
                onPress={() => setGoalHours((h) => Math.max(1, h - 1))}
                hitSlop={8}
              >
                <Ionicons name="remove" size={20} color={theme.text} />
              </TouchableOpacity>
              <View style={[styles.stepValue, { backgroundColor: COLORS.primaryLight, borderColor: COLORS.primary + '44' }]}>
                <Text style={styles.stepValueText}>{goalHours}h</Text>
              </View>
              <TouchableOpacity
                style={[styles.stepBtn, { backgroundColor: theme.card, borderColor: theme.border }]}
                onPress={() => setGoalHours((h) => Math.min(16, h + 1))}
                hitSlop={8}
              >
                <Ionicons name="add" size={20} color={theme.text} />
              </TouchableOpacity>
              <Text style={[styles.stepHint, { color: theme.muted }]}>
                FocusFlow will track your daily progress toward this goal.
              </Text>
            </View>
          </FormSection>

          {/* Wake-up time */}
          <FormSection title="When do you usually wake up?">
            <View style={styles.chipRow}>
              {WAKE_UP_TIMES.map((t) => {
                const selected = wakeTime === t.id;
                return (
                  <TouchableOpacity
                    key={t.id}
                    style={[styles.chip, selected && styles.chipSelected, { borderColor: selected ? COLORS.primary : theme.border, backgroundColor: selected ? COLORS.primary : theme.card }]}
                    onPress={() => setWakeTime(selected ? '' : t.id)}
                    activeOpacity={0.75}
                  >
                    <Text style={[styles.chipLabel, { color: selected ? '#fff' : theme.text }]}>{t.label}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </FormSection>

          {/* Focus goals */}
          <FormSection title="What are your main focus goals?">
            <Text style={[styles.multiHint, { color: theme.muted }]}>Select all that apply</Text>
            <View style={styles.chipGrid}>
              {FOCUS_GOALS.map((g) => {
                const selected = goals.includes(g.id);
                return (
                  <TouchableOpacity
                    key={g.id}
                    style={[styles.chip, selected && styles.chipSelected, { borderColor: selected ? COLORS.primary : theme.border, backgroundColor: selected ? COLORS.primary : theme.card }]}
                    onPress={() => toggleGoal(g.id)}
                    activeOpacity={0.75}
                  >
                    <Ionicons name={g.icon as any} size={15} color={selected ? '#fff' : theme.muted} />
                    <Text style={[styles.chipLabel, { color: selected ? '#fff' : theme.text }]}>{g.label}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </FormSection>

          {/* Save button */}
          <TouchableOpacity
            style={[styles.saveBtn, saving && { opacity: 0.7 }]}
            onPress={handleSave}
            activeOpacity={0.85}
            disabled={saving}
          >
            <Text style={styles.saveBtnText}>
              {saving ? 'Saving…' : isEditMode ? 'Save Changes' : 'Save & Continue →'}
            </Text>
          </TouchableOpacity>

          {!isEditMode && (
            <TouchableOpacity onPress={handleSkip} activeOpacity={0.7} style={styles.skipLink}>
              <Text style={styles.skipLinkText}>Skip for now — I'll set this up later in Settings</Text>
            </TouchableOpacity>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────

function FormSection({ title, children }: { title: string; children: React.ReactNode }) {
  const { theme } = useTheme();
  return (
    <View style={styles.section}>
      <Text style={[styles.sectionTitle, { color: theme.text }]}>{title}</Text>
      {children}
    </View>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  safe: { flex: 1 },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  iconBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  topTitle: { fontSize: FONT.md, fontWeight: '800' },
  skipBtn: { paddingHorizontal: SPACING.sm, paddingVertical: SPACING.xs },
  skipText: { color: COLORS.primary, fontSize: FONT.sm, fontWeight: '700' },
  content: { padding: SPACING.lg, paddingBottom: 56, gap: SPACING.xl },
  intro: { fontSize: FONT.sm, lineHeight: 20 },
  section: { gap: SPACING.sm },
  sectionTitle: { fontSize: FONT.md, fontWeight: '800' },
  textInput: {
    borderRadius: RADIUS.md,
    borderWidth: 1,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
    fontSize: FONT.md,
    height: 48,
  },
  chipGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: SPACING.sm },
  chipRow:  { flexDirection: 'row', flexWrap: 'wrap', gap: SPACING.sm },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
    borderRadius: RADIUS.full,
    borderWidth: 1,
  },
  chipSelected: {},
  chipLabel: { fontSize: FONT.sm, fontWeight: '700' },
  stepperRow: { flexDirection: 'row', alignItems: 'center', gap: SPACING.md, flexWrap: 'wrap' },
  stepBtn: {
    width: 42,
    height: 42,
    borderRadius: RADIUS.md,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepValue: {
    minWidth: 64,
    height: 42,
    borderRadius: RADIUS.md,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: SPACING.md,
  },
  stepValueText: { fontSize: FONT.lg, fontWeight: '900', color: COLORS.primary },
  stepHint: { flex: 1, fontSize: FONT.xs, lineHeight: 16 },
  multiHint: { fontSize: FONT.xs, marginTop: -SPACING.xs },
  saveBtn: {
    backgroundColor: COLORS.primary,
    borderRadius: RADIUS.lg,
    padding: SPACING.md,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 52,
    marginTop: SPACING.xs,
  },
  saveBtnText: { color: '#fff', fontSize: FONT.md, fontWeight: '800' },
  skipLink: { alignItems: 'center', paddingVertical: SPACING.xs },
  skipLinkText: { color: COLORS.muted, fontSize: FONT.xs, textAlign: 'center' },
});
