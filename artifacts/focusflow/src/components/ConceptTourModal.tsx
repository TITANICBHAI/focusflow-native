import React, { useRef, useState } from 'react';
import {
  Modal,
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Dimensions,
  Animated,
  NativeSyntheticEvent,
  NativeScrollEvent,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, FONT, RADIUS, SPACING } from '@/styles/theme';
import { useApp } from '@/context/AppContext';

/**
 * ConceptTourModal
 *
 * The 5-screen concept walkthrough shown ONCE, after the first-run "How to
 * use" guide. Gated by `settings.conceptTourSeen` so it only ever auto-fires
 * on first launch. The user can re-open it from Settings → "Replay tour".
 *
 * Each slide answers ONE question:
 *   1. What is FocusFlow?
 *   2. Tasks vs. Standalone Block — what's the difference?
 *   3. What is a Block Batch?
 *   4. What is Daily Allowance?
 *   5. Block Enforcement — how distractions actually get stopped.
 *
 * Pure RN Animated + ScrollView paging. No reanimated, no extra deps.
 */

interface Props {
  /** Force-show overrides the conceptTourSeen flag (used by "Replay tour"). */
  forceShow?: boolean;
  onClose?: () => void;
}

interface Slide {
  icon: React.ComponentProps<typeof Ionicons>['name'];
  color: string;
  title: string;
  body: string;
}

const SLIDES: Slide[] = [
  {
    icon: 'compass-outline',
    color: COLORS.primary,
    title: 'Welcome to FocusFlow',
    body:
      'FocusFlow is a discipline operating system for your phone. It blocks the apps, websites and on-screen keywords that pull you away from what matters — and gives you the data to see what was costing you time.',
  },
  {
    icon: 'checkmark-done-outline',
    color: COLORS.green,
    title: 'Tasks vs. Standalone Block',
    body:
      'A TASK is a focused work session with a timer. While it runs, your blocked apps go dark.\n\nSTANDALONE BLOCK is a list of apps you simply never want to open — it stays on 24/7, no session needed.\n\nUse both together for a complete distraction defense.',
  },
  {
    icon: 'time-outline',
    color: COLORS.orange,
    title: 'Block Batches',
    body:
      'A Block Batch is a recurring time window — e.g. "no Instagram, TikTok or YouTube on weekdays from 9 AM to 5 PM". Set it once, it runs forever. You can stack as many batches as you want, each with its own apps and hours.',
  },
  {
    icon: 'speedometer-outline',
    color: COLORS.purple,
    title: 'Daily Allowance',
    body:
      'For apps you don\'t want to ban outright, set a daily allowance — e.g. WhatsApp: 30 minutes, Instagram: 5 opens. When the budget is spent, the app is locked until tomorrow.',
  },
  {
    icon: 'shield-checkmark-outline',
    color: COLORS.red,
    title: 'Block Enforcement',
    body:
      'Behind the scenes FocusFlow runs four enforcement layers — Keyword Blocker (URL/title scanning), System Protection (anti-tamper), Aversion Deterrents (vibration / sound when you peek), and Block Batches. You control which ones are on from the side menu.',
  },
];

const { width } = Dimensions.get('window');

export function ConceptTourModal({ forceShow, onClose }: Props) {
  const { state, updateSettings } = useApp();
  const seen = state.settings.conceptTourSeen ?? false;
  // Gate auto-show on the user having finished the how-to-use guide. This
  // prevents the tour from flashing in front of the onboarding stack on the
  // very first launch (the flow is onboarding → permissions → user-profile
  // → how-to-use → home, and we only want the tour to appear once the user
  // lands on home for the first time).
  const howToUseSeen = state.settings.howToUseSeen ?? false;
  const visible = forceShow || (howToUseSeen && !seen);
  const [index, setIndex] = useState(0);
  const scrollRef = useRef<ScrollView>(null);

  const last = index === SLIDES.length - 1;

  const close = async () => {
    try {
      if (!seen) {
        await updateSettings({ ...state.settings, conceptTourSeen: true });
      }
    } catch { /* non-fatal */ }
    onClose?.();
  };

  const next = () => {
    if (last) { void close(); return; }
    const i = index + 1;
    setIndex(i);
    scrollRef.current?.scrollTo({ x: i * width, animated: true });
  };

  const onScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const i = Math.round(e.nativeEvent.contentOffset.x / width);
    if (i !== index) setIndex(i);
  };

  if (!visible) return null;

  return (
    <Modal visible animationType="fade" transparent={false} onRequestClose={close}>
      <View style={styles.root}>
        {/* Skip in top-right */}
        <View style={styles.topRow}>
          <Text style={styles.dots}>{index + 1} / {SLIDES.length}</Text>
          <TouchableOpacity onPress={close} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
            <Text style={styles.skip}>Skip</Text>
          </TouchableOpacity>
        </View>

        <ScrollView
          ref={scrollRef}
          horizontal
          pagingEnabled
          showsHorizontalScrollIndicator={false}
          onScroll={onScroll}
          scrollEventThrottle={16}
          style={{ flex: 1 }}
        >
          {SLIDES.map((s, i) => (
            <View key={i} style={[styles.slide, { width }]}>
              <View style={[styles.iconCircle, { backgroundColor: s.color + '22', borderColor: s.color }]}>
                <Ionicons name={s.icon} size={56} color={s.color} />
              </View>
              <Text style={styles.title}>{s.title}</Text>
              <Text style={styles.body}>{s.body}</Text>
            </View>
          ))}
        </ScrollView>

        {/* Pagination dots */}
        <View style={styles.dotsRow}>
          {SLIDES.map((_, i) => (
            <View
              key={i}
              style={[
                styles.dot,
                i === index && styles.dotActive,
              ]}
            />
          ))}
        </View>

        <TouchableOpacity style={[styles.cta, { backgroundColor: COLORS.primary }]} onPress={next} activeOpacity={0.85}>
          <Text style={styles.ctaText}>{last ? 'Start using FocusFlow' : 'Next'}</Text>
          <Ionicons name="arrow-forward" size={18} color="#fff" />
        </TouchableOpacity>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0f172a', paddingTop: 56, paddingBottom: 40 },
  topRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: SPACING.lg,
    marginBottom: SPACING.lg,
  },
  dots: { color: '#94a3b8', fontSize: FONT.xs, fontWeight: '700' },
  skip: { color: '#cbd5e1', fontSize: FONT.sm, fontWeight: '700' },

  slide: {
    paddingHorizontal: SPACING.xl,
    alignItems: 'center',
    justifyContent: 'center',
    gap: SPACING.lg,
  },
  iconCircle: {
    width: 120, height: 120, borderRadius: 60,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 2,
  },
  title: { color: '#fff', fontSize: FONT.xl, fontWeight: '900', textAlign: 'center' },
  body: { color: '#cbd5e1', fontSize: FONT.md, lineHeight: 24, textAlign: 'center' },

  dotsRow: { flexDirection: 'row', justifyContent: 'center', gap: 8, marginBottom: SPACING.lg },
  dot: {
    width: 8, height: 8, borderRadius: 4,
    backgroundColor: '#334155',
  },
  dotActive: { backgroundColor: COLORS.primary, width: 22 },

  cta: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: SPACING.sm,
    marginHorizontal: SPACING.lg,
    paddingVertical: SPACING.md,
    borderRadius: RADIUS.lg,
  },
  ctaText: { color: '#fff', fontSize: FONT.md, fontWeight: '800' },
});
