import React, { useState, useMemo, useEffect } from 'react';
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
import { scheduleMorningDigest } from '@/services/notificationService';
import {
  dbGetTodayFocusMinutes,
  dbGetStreak,
  dbGetBestStreak,
  dbGetAllTimeFocusMinutes,
  dbGetAllTimeFocusSessions,
} from '@/data/database';

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

// ── Deeper-profile option lists ───────────────────────────────────────────────

const SLEEP_TIMES = [
  { id: '21:00', label: '9 pm'  },
  { id: '22:00', label: '10 pm' },
  { id: '23:00', label: '11 pm' },
  { id: '00:00', label: '12 am' },
  { id: '01:00', label: '1 am'  },
  { id: '02:00', label: '2 am'  },
];

const CHRONOTYPES: { id: NonNullable<UserProfile['chronotype']>; label: string; icon: string }[] = [
  { id: 'morning',   label: 'Early morning (5–9 am)',  icon: 'sunny-outline'    },
  { id: 'midday',    label: 'Late morning (9–12)',     icon: 'partly-sunny-outline' },
  { id: 'afternoon', label: 'Afternoon (12–5 pm)',     icon: 'cafe-outline'     },
  { id: 'evening',   label: 'Evening (5–9 pm)',         icon: 'wine-outline'     },
  { id: 'night',     label: 'Late night (9 pm+)',       icon: 'moon-outline'     },
  { id: 'flexible',  label: 'Varies day to day',        icon: 'shuffle-outline'  },
];

const FOCUS_LENGTHS = [
  { id: 15, label: '15 min', hint: 'Quick sprints' },
  { id: 25, label: '25 min', hint: 'Classic Pomodoro' },
  { id: 45, label: '45 min', hint: 'Balanced block' },
  { id: 60, label: '60 min', hint: 'Deep focus' },
  { id: 90, label: '90 min', hint: 'Flow state' },
];

const BREAK_STYLES: { id: NonNullable<UserProfile['breakStyle']>; label: string; hint: string; mins: number }[] = [
  { id: 'short_frequent',  label: 'Short & frequent', hint: '5 min breaks',  mins: 5 },
  { id: 'balanced',        label: 'Balanced',         hint: '10 min breaks', mins: 10 },
  { id: 'long_infrequent', label: 'Long & infrequent',hint: '15 min breaks', mins: 15 },
  { id: 'no_break',        label: 'No breaks',        hint: 'Push straight through', mins: 0 },
];

const DISTRACTION_TRIGGERS = [
  { id: 'social',    label: 'Social media',  icon: 'people-outline'        },
  { id: 'video',     label: 'Videos / TV',   icon: 'play-circle-outline'   },
  { id: 'news',      label: 'News',          icon: 'newspaper-outline'     },
  { id: 'games',     label: 'Games',         icon: 'game-controller-outline' },
  { id: 'shopping',  label: 'Shopping',      icon: 'cart-outline'          },
  { id: 'messaging', label: 'Messaging',     icon: 'chatbubbles-outline'   },
];

const MOTIVATION_STYLES = [
  { id: 'streaks',    label: 'Streaks',         icon: 'flame-outline'    },
  { id: 'stats',      label: 'Stats & charts',  icon: 'stats-chart-outline' },
  { id: 'milestones', label: 'Milestones',      icon: 'trophy-outline'   },
  { id: 'quotes',     label: 'Daily quotes',    icon: 'chatbubble-ellipses-outline' },
];

const REVIEW_DAYS: { id: NonNullable<UserProfile['weeklyReviewDay']>; label: string }[] = [
  { id: 'sun', label: 'Sun' },
  { id: 'mon', label: 'Mon' },
  { id: 'tue', label: 'Tue' },
  { id: 'wed', label: 'Wed' },
  { id: 'thu', label: 'Thu' },
  { id: 'fri', label: 'Fri' },
  { id: 'sat', label: 'Sat' },
];

// ── App block suggestions ─────────────────────────────────────────────────────
// Maps occupation IDs and goal IDs to lists of suggested apps to block.
// Each entry: { name, pkg } — name is for display, pkg is the package name.

interface SuggestedApp { name: string; pkg: string; reason: string; }

const OCCUPATION_SUGGESTIONS: Record<string, SuggestedApp[]> = {
  student: [
    { name: 'YouTube',    pkg: 'com.google.android.youtube',       reason: 'Big time sink during study' },
    { name: 'Instagram',  pkg: 'com.instagram.android',            reason: 'Constant scroll distraction' },
    { name: 'TikTok',     pkg: 'com.zhiliaoapp.musically',          reason: 'Short-form video addiction' },
    { name: 'Snapchat',   pkg: 'com.snapchat.android',             reason: 'Frequent social interruptions' },
    { name: 'Reddit',     pkg: 'com.reddit.frontpage',             reason: 'Endless rabbit holes' },
  ],
  professional: [
    { name: 'Twitter / X', pkg: 'com.twitter.android',            reason: 'News doom-scroll during work hours' },
    { name: 'LinkedIn',    pkg: 'com.linkedin.android',            reason: 'Passive browsing vs active work' },
    { name: 'YouTube',     pkg: 'com.google.android.youtube',      reason: 'Autoplay pulls attention away' },
    { name: 'Candy Crush', pkg: 'com.king.candycrushsaga',         reason: '"Just one level" trap' },
  ],
  freelancer: [
    { name: 'Instagram',  pkg: 'com.instagram.android',            reason: 'Comparison scrolling kills momentum' },
    { name: 'Twitter / X', pkg: 'com.twitter.android',            reason: 'Compulsive checking breaks flow' },
    { name: 'YouTube',    pkg: 'com.google.android.youtube',       reason: 'Autoplay derails deep work' },
    { name: 'WhatsApp',   pkg: 'com.whatsapp',                    reason: 'Client messages can wait for batch reply' },
  ],
  creator: [
    { name: 'Twitter / X', pkg: 'com.twitter.android',            reason: 'Engagement anxiety blocks creation' },
    { name: 'Instagram',   pkg: 'com.instagram.android',           reason: 'Scroll triggers comparison' },
    { name: 'TikTok',      pkg: 'com.zhiliaoapp.musically',         reason: 'Short-form competes with long creation' },
    { name: 'Netflix',     pkg: 'com.netflix.mediaclient',         reason: 'Passive consumption mode' },
  ],
};

const GOAL_SUGGESTIONS: Record<string, SuggestedApp[]> = {
  deep_work: [
    { name: 'YouTube',    pkg: 'com.google.android.youtube',       reason: 'Autoplay destroys flow state' },
    { name: 'Twitter / X', pkg: 'com.twitter.android',            reason: 'Micro-updates interrupt sustained thought' },
    { name: 'Instagram',  pkg: 'com.instagram.android',            reason: 'Visual scroll breaks context' },
    { name: 'TikTok',     pkg: 'com.zhiliaoapp.musically',          reason: 'Dopamine-reward loop vs deep focus' },
    { name: 'Discord',    pkg: 'com.discord',                     reason: 'Constant pings fragment attention' },
    { name: 'Reddit',     pkg: 'com.reddit.frontpage',             reason: 'Link-hopping destroys deep work' },
  ],
  study: [
    { name: 'YouTube',    pkg: 'com.google.android.youtube',       reason: 'Unless used for lectures — hard to resist' },
    { name: 'TikTok',     pkg: 'com.zhiliaoapp.musically',          reason: 'Strongest short-form reward cycle' },
    { name: 'Snapchat',   pkg: 'com.snapchat.android',             reason: 'Streaks create artificial urgency' },
    { name: 'Games (Candy Crush)', pkg: 'com.king.candycrushsaga', reason: 'Designed to be picked up mid-task' },
  ],
  no_social: [
    { name: 'Facebook',   pkg: 'com.facebook.katana',              reason: 'Block the source' },
    { name: 'Instagram',  pkg: 'com.instagram.android',            reason: 'Block the source' },
    { name: 'Twitter / X', pkg: 'com.twitter.android',            reason: 'Block the source' },
    { name: 'TikTok',     pkg: 'com.zhiliaoapp.musically',          reason: 'Block the source' },
    { name: 'Snapchat',   pkg: 'com.snapchat.android',             reason: 'Block the source' },
    { name: 'Reddit',     pkg: 'com.reddit.frontpage',             reason: 'Block the source' },
    { name: 'BeReal',     pkg: 'com.bereal.android',               reason: 'Block the source' },
    { name: 'Pinterest',  pkg: 'com.pinterest',                   reason: 'Block the source' },
  ],
  reading: [
    { name: 'YouTube',    pkg: 'com.google.android.youtube',       reason: 'Video competes with deep reading' },
    { name: 'TikTok',     pkg: 'com.zhiliaoapp.musically',          reason: 'Opposite attention pattern to reading' },
    { name: 'Instagram',  pkg: 'com.instagram.android',            reason: 'Visual scroll interrupts immersion' },
  ],
  coding: [
    { name: 'YouTube',    pkg: 'com.google.android.youtube',       reason: 'Autoplay derails coding sessions' },
    { name: 'Twitter / X', pkg: 'com.twitter.android',            reason: 'Tech news loops break focus' },
    { name: 'Instagram',  pkg: 'com.instagram.android',            reason: 'Passive scroll replaces active building' },
    { name: 'Games',      pkg: 'com.roblox.client',               reason: 'Easy to slip into play mode' },
  ],
  writing: [
    { name: 'Twitter / X', pkg: 'com.twitter.android',            reason: 'Micro-writing substitutes for real writing' },
    { name: 'Reddit',      pkg: 'com.reddit.frontpage',            reason: 'Procrastination disguised as research' },
    { name: 'YouTube',     pkg: 'com.google.android.youtube',      reason: '"Background noise" becomes main event' },
  ],
  exercise: [
    { name: 'YouTube',    pkg: 'com.google.android.youtube',       reason: 'Passive watching replaces active doing' },
    { name: 'Netflix',    pkg: 'com.netflix.mediaclient',          reason: 'Couch time grows, gym time shrinks' },
  ],
  creative: [
    { name: 'Instagram',  pkg: 'com.instagram.android',            reason: 'Comparison anxiety kills creative flow' },
    { name: 'Twitter / X', pkg: 'com.twitter.android',            reason: 'Engagement anxiety distracts from creation' },
    { name: 'TikTok',     pkg: 'com.zhiliaoapp.musically',          reason: 'Consuming replaces creating' },
  ],
};

// Distraction-trigger → suggested apps. Merged into the main suggestion list
// so picking "Social media" and "Games" pre-fills Instagram/TikTok/Roblox/etc
// even when the user hasn't picked a focus goal yet.
const TRIGGER_SUGGESTIONS: Record<string, SuggestedApp[]> = {
  social: [
    { name: 'Instagram',  pkg: 'com.instagram.android',     reason: 'Top scroll-trigger for most users' },
    { name: 'Facebook',   pkg: 'com.facebook.katana',       reason: 'Endless feed' },
    { name: 'Twitter / X', pkg: 'com.twitter.android',       reason: 'Compulsive checking' },
    { name: 'Snapchat',   pkg: 'com.snapchat.android',      reason: 'Streak pressure pulls you back' },
  ],
  video: [
    { name: 'YouTube',    pkg: 'com.google.android.youtube',reason: 'Autoplay derails everything' },
    { name: 'TikTok',     pkg: 'com.zhiliaoapp.musically',  reason: 'Strongest short-form reward loop' },
    { name: 'Netflix',    pkg: 'com.netflix.mediaclient',   reason: '"One more episode" trap' },
    { name: 'Twitch',     pkg: 'tv.twitch.android.app',     reason: 'Live content hard to leave' },
  ],
  news: [
    { name: 'Google News', pkg: 'com.google.android.apps.magazines', reason: 'Doom-scroll trigger' },
    { name: 'Reddit',      pkg: 'com.reddit.frontpage',      reason: 'Endless rabbit holes' },
    { name: 'Twitter / X', pkg: 'com.twitter.android',       reason: 'Real-time news anxiety' },
  ],
  games: [
    { name: 'Candy Crush', pkg: 'com.king.candycrushsaga',  reason: '"Just one level" trap' },
    { name: 'Roblox',      pkg: 'com.roblox.client',        reason: 'Multi-hour sessions are easy' },
    { name: 'Clash Royale',pkg: 'com.supercell.clashroyale',reason: 'Designed to interrupt your day' },
  ],
  shopping: [
    { name: 'Amazon',     pkg: 'com.amazon.mShop.android.shopping', reason: 'Browsing burns hours' },
    { name: 'AliExpress', pkg: 'com.alibaba.aliexpresshd',  reason: 'Endless deals scroll' },
    { name: 'Temu',       pkg: 'com.einnovation.temu',      reason: 'Designed for compulsive use' },
  ],
  messaging: [
    { name: 'WhatsApp',   pkg: 'com.whatsapp',              reason: 'Frequent interruptions' },
    { name: 'Messenger',  pkg: 'com.facebook.orca',         reason: 'Always-on chat fragments focus' },
    { name: 'Telegram',   pkg: 'org.telegram.messenger',    reason: 'Group chats keep ringing' },
    { name: 'Discord',    pkg: 'com.discord',               reason: 'Servers ping constantly' },
  ],
};

function computeSuggestedApps(
  occupation: string,
  goals: string[],
  triggers: string[] = [],
): SuggestedApp[] {
  const seen = new Set<string>();
  const results: SuggestedApp[] = [];
  const addAll = (list: SuggestedApp[]) => {
    for (const item of list) {
      if (!seen.has(item.pkg)) {
        seen.add(item.pkg);
        results.push(item);
      }
    }
  };
  if (occupation && OCCUPATION_SUGGESTIONS[occupation]) {
    addAll(OCCUPATION_SUGGESTIONS[occupation]);
  }
  for (const goal of goals) {
    if (GOAL_SUGGESTIONS[goal]) {
      addAll(GOAL_SUGGESTIONS[goal]);
    }
  }
  for (const trigger of triggers) {
    if (TRIGGER_SUGGESTIONS[trigger]) {
      addAll(TRIGGER_SUGGESTIONS[trigger]);
    }
  }
  return results;
}

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

  // Personal-journey stats — only loaded in edit mode (returning user). On
  // first-run onboarding the DB is empty and this section stays hidden.
  const [stats, setStats] = useState<{
    todayMins: number;
    streak: number;
    bestStreak: number;
    allTimeMins: number;
    sessions: number;
  } | null>(null);

  useEffect(() => {
    if (!isEditMode) return;
    let cancelled = false;
    (async () => {
      try {
        const [todayMins, streak, bestStreak, allTimeMins, sessions] = await Promise.all([
          dbGetTodayFocusMinutes().catch(() => 0),
          dbGetStreak().catch(() => 0),
          dbGetBestStreak().catch(() => 0),
          dbGetAllTimeFocusMinutes().catch(() => 0),
          dbGetAllTimeFocusSessions().catch(() => 0),
        ]);
        if (!cancelled) setStats({ todayMins, streak, bestStreak, allTimeMins, sessions });
      } catch {
        // Non-fatal — section stays hidden.
      }
    })();
    return () => { cancelled = true; };
  }, [isEditMode]);

  const suggestedApps = useMemo(
    () => computeSuggestedApps(occupation, goals),
    [occupation, goals],
  );

  // Computes today's progress toward the daily focus-hour goal and a short
  // motivational caption used in the journey panel.
  const goalProgress = useMemo(() => {
    if (!stats) return null;
    const targetMins = Math.max(1, goalHours * 60);
    const pct = Math.min(100, Math.round((stats.todayMins / targetMins) * 100));
    const remaining = Math.max(0, targetMins - stats.todayMins);
    const caption = pct >= 100
      ? `Daily goal hit — ${stats.todayMins}m focused today`
      : `${remaining}m to go to today's ${goalHours}h goal`;
    return { pct, caption };
  }, [stats, goalHours]);

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

      // Schedule morning digest for tomorrow if a wake-up time is set.
      if (profile.wakeUpTime) {
        try {
          await scheduleMorningDigest(profile, state.tasks ?? []);
        } catch {
          // Non-fatal — notification permission may not be granted yet.
        }
      }

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

          {/* Your Journey — personal stats panel (edit mode only). Renders only
              once stats have loaded so first-time editors don't see a flash of
              zeros. Shows "today" + "all time" + a goal-progress caption. */}
          {isEditMode && stats && (stats.allTimeMins > 0 || stats.sessions > 0 || stats.streak > 0) && (
            <View style={[styles.journeyCard, { backgroundColor: theme.card, borderColor: theme.border }]}>
              <View style={styles.journeyHeader}>
                <Ionicons name="trophy-outline" size={18} color={COLORS.primary} />
                <Text style={[styles.journeyTitle, { color: theme.text }]}>
                  {name ? `${name}'s journey` : 'Your journey'}
                </Text>
              </View>

              <View style={styles.statRow}>
                <StatTile
                  icon="flame"
                  iconColor="#f97316"
                  label="Streak"
                  value={`${stats.streak}d`}
                  hint={stats.bestStreak > stats.streak ? `Best ${stats.bestStreak}d` : 'Keep going'}
                  theme={theme}
                />
                <StatTile
                  icon="time-outline"
                  iconColor={COLORS.primary}
                  label="Today"
                  value={formatHm(stats.todayMins)}
                  hint={goalProgress ? `${goalProgress.pct}% of goal` : ''}
                  theme={theme}
                />
              </View>

              <View style={styles.statRow}>
                <StatTile
                  icon="hourglass-outline"
                  iconColor="#10b981"
                  label="All time"
                  value={formatHm(stats.allTimeMins)}
                  hint={`${stats.sessions} session${stats.sessions === 1 ? '' : 's'}`}
                  theme={theme}
                />
                <StatTile
                  icon="ribbon-outline"
                  iconColor="#8b5cf6"
                  label="Best streak"
                  value={`${stats.bestStreak}d`}
                  hint={stats.bestStreak === stats.streak && stats.streak > 0 ? 'Personal best!' : 'Personal record'}
                  theme={theme}
                />
              </View>

              {goalProgress && (
                <View style={styles.goalRow}>
                  <View style={[styles.goalBarBg, { backgroundColor: COLORS.primaryLight }]}>
                    <View
                      style={[
                        styles.goalBarFill,
                        { width: `${goalProgress.pct}%`, backgroundColor: COLORS.primary },
                      ]}
                    />
                  </View>
                  <Text style={[styles.goalCaption, { color: theme.muted }]}>{goalProgress.caption}</Text>
                </View>
              )}
            </View>
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

          {/* App block suggestions — shown when occupation or goals are set */}
          {suggestedApps.length > 0 && (
            <FormSection title="Apps to consider blocking">
              <Text style={[styles.multiHint, { color: theme.muted }]}>
                Based on your profile. You can block these anytime from the Focus screen.
              </Text>
              <View style={{ gap: 8 }}>
                {suggestedApps.map((app) => (
                  <View
                    key={app.pkg}
                    style={[styles.suggestionCard, { backgroundColor: theme.card, borderColor: theme.border }]}
                  >
                    <View style={[styles.suggestionIcon, { backgroundColor: COLORS.primaryLight }]}>
                      <Ionicons name="ban-outline" size={16} color={COLORS.primary} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.suggestionName, { color: theme.text }]}>{app.name}</Text>
                      <Text style={[styles.suggestionReason, { color: theme.muted }]}>{app.reason}</Text>
                    </View>
                    <View style={[styles.suggestionBadge, { backgroundColor: COLORS.primaryLight }]}>
                      <Text style={styles.suggestionBadgeText}>Block</Text>
                    </View>
                  </View>
                ))}
              </View>
            </FormSection>
          )}

          {/* "How your profile is used" — shows the user exactly which parts
              of the app react to each profile field, so the form doesn't feel
              like a black hole of preferences. Always rendered. */}
          <View style={[styles.usageCard, { backgroundColor: theme.card, borderColor: theme.border }]}>
            <View style={styles.usageHeader}>
              <Ionicons name="sparkles-outline" size={16} color={COLORS.primary} />
              <Text style={[styles.usageTitle, { color: theme.text }]}>How your profile is used</Text>
            </View>
            <UsageRow
              icon="time-outline"
              label="Daily focus goal"
              value={`${goalHours}h`}
              detail="Tracked on the Stats screen and on your home-screen widget."
              theme={theme}
            />
            <UsageRow
              icon="sunny-outline"
              label="Wake-up time"
              value={wakeTime ? formatWake(wakeTime) : 'Not set'}
              detail={
                wakeTime
                  ? 'A morning digest notification fires at this time with today\'s plan.'
                  : 'Set a wake-up time to get a morning plan notification.'
              }
              theme={theme}
            />
            <UsageRow
              icon="briefcase-outline"
              label="Occupation"
              value={occupation ? labelFor(OCCUPATIONS, occupation) : 'Not set'}
              detail={
                occupation
                  ? 'Used to suggest distracting apps to block, tailored to your work pattern.'
                  : 'Pick one to see tailored app-block suggestions below.'
              }
              theme={theme}
            />
            <UsageRow
              icon="flag-outline"
              label="Focus goals"
              value={goals.length > 0 ? `${goals.length} selected` : 'None'}
              detail={
                goals.length > 0
                  ? `Drives suggestions for "${goals.map((g) => labelFor(FOCUS_GOALS, g)).slice(0, 2).join(', ')}${goals.length > 2 ? '…' : ''}".`
                  : 'Add goals to refine app-block suggestions.'
              }
              theme={theme}
            />
            <UsageRow
              icon="person-circle-outline"
              label="Name"
              value={name || 'Not set'}
              detail={name ? 'Used in your morning digest greeting and journey panel.' : 'Add a name to personalise your morning digest.'}
              theme={theme}
              isLast
            />
          </View>

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

interface ThemeShape {
  text: string;
  muted: string;
  card: string;
  border: string;
  background: string;
}

function StatTile({
  icon, iconColor, label, value, hint, theme,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  iconColor: string;
  label: string;
  value: string;
  hint: string;
  theme: ThemeShape;
}) {
  return (
    <View style={[styles.statTile, { backgroundColor: theme.background, borderColor: theme.border }]}>
      <View style={styles.statTopRow}>
        <Ionicons name={icon} size={14} color={iconColor} />
        <Text style={[styles.statLabel, { color: theme.muted }]}>{label}</Text>
      </View>
      <Text style={[styles.statValue, { color: theme.text }]}>{value}</Text>
      {!!hint && <Text style={[styles.statHint, { color: theme.muted }]}>{hint}</Text>}
    </View>
  );
}

function UsageRow({
  icon, label, value, detail, theme, isLast,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  value: string;
  detail: string;
  theme: ThemeShape;
  isLast?: boolean;
}) {
  return (
    <View style={[styles.usageRow, !isLast && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: theme.border }]}>
      <View style={[styles.usageIconWrap, { backgroundColor: COLORS.primaryLight }]}>
        <Ionicons name={icon} size={14} color={COLORS.primary} />
      </View>
      <View style={{ flex: 1 }}>
        <View style={styles.usageRowTop}>
          <Text style={[styles.usageLabel, { color: theme.text }]}>{label}</Text>
          <Text style={[styles.usageValue, { color: COLORS.primary }]}>{value}</Text>
        </View>
        <Text style={[styles.usageDetail, { color: theme.muted }]}>{detail}</Text>
      </View>
    </View>
  );
}

// ── Small formatters ───────────────────────────────────────────────────────────

function formatHm(mins: number): string {
  if (mins <= 0) return '0m';
  if (mins < 60) return `${mins}m`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

function formatWake(id: string): string {
  // The WAKE_UP_TIMES values are ids like "07:00" — find the friendly label.
  return WAKE_UP_TIMES.find((t) => t.id === id)?.label ?? id;
}

function labelFor(items: { id: string; label: string }[], id: string): string {
  return items.find((i) => i.id === id)?.label ?? id;
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
  suggestionCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
    padding: SPACING.sm,
    borderRadius: RADIUS.md,
    borderWidth: StyleSheet.hairlineWidth,
  },
  suggestionIcon: {
    width: 32, height: 32, borderRadius: RADIUS.sm,
    alignItems: 'center', justifyContent: 'center', flexShrink: 0,
  },
  suggestionName: { fontSize: FONT.sm, fontWeight: '700' },
  suggestionReason: { fontSize: FONT.xs, lineHeight: 16, marginTop: 1 },
  suggestionBadge: {
    paddingHorizontal: SPACING.sm,
    paddingVertical: 3,
    borderRadius: RADIUS.full,
    flexShrink: 0,
  },
  suggestionBadgeText: { fontSize: 10, fontWeight: '800', color: COLORS.primary },

  // ── Journey card (personal stats panel) ────────────────────────────────
  journeyCard: {
    borderRadius: RADIUS.lg,
    borderWidth: StyleSheet.hairlineWidth,
    padding: SPACING.md,
    gap: SPACING.sm,
  },
  journeyHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 2,
  },
  journeyTitle: { fontSize: FONT.md, fontWeight: '800' },
  statRow: {
    flexDirection: 'row',
    gap: SPACING.sm,
  },
  statTile: {
    flex: 1,
    borderRadius: RADIUS.md,
    borderWidth: StyleSheet.hairlineWidth,
    paddingVertical: SPACING.sm,
    paddingHorizontal: SPACING.sm,
    gap: 2,
  },
  statTopRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  statLabel: { fontSize: 10, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5 },
  statValue: { fontSize: FONT.lg, fontWeight: '900' },
  statHint: { fontSize: 10, marginTop: 1 },
  goalRow: { gap: 4, marginTop: SPACING.xs },
  goalBarBg: { height: 6, borderRadius: 3, overflow: 'hidden' },
  goalBarFill: { height: 6, borderRadius: 3 },
  goalCaption: { fontSize: 11, fontWeight: '600' },

  // ── "How your profile is used" card ────────────────────────────────────
  usageCard: {
    borderRadius: RADIUS.lg,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: SPACING.md,
    paddingTop: SPACING.md,
  },
  usageHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: SPACING.sm,
  },
  usageTitle: { fontSize: FONT.md, fontWeight: '800' },
  usageRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: SPACING.sm,
    paddingVertical: SPACING.sm,
  },
  usageIconWrap: {
    width: 28, height: 28, borderRadius: RADIUS.sm,
    alignItems: 'center', justifyContent: 'center', flexShrink: 0,
    marginTop: 1,
  },
  usageRowTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: SPACING.sm,
  },
  usageLabel: { fontSize: FONT.sm, fontWeight: '700' },
  usageValue: { fontSize: FONT.xs, fontWeight: '800' },
  usageDetail: { fontSize: 11, lineHeight: 15, marginTop: 2 },
});
