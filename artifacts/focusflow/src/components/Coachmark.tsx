import React, { useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Animated, Modal, Pressable, Dimensions } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, FONT, RADIUS, SPACING } from '@/styles/theme';
import { useApp } from '@/context/AppContext';

/**
 * Coachmark
 *
 * One-shot tooltip surfaced on a tab's first ever appearance, gated by
 * `settings.coachmarksSeen[key]`. Once dismissed the flag is set and the
 * coachmark never reappears (until `coachmarksSeen` is cleared, e.g. via
 * Settings → Reset Walkthroughs).
 *
 * Renders a translucent backdrop + a centered card; pure RN Animated, no
 * extra deps.
 *
 *   <Coachmark
 *     keyName="focus"
 *     title="This is the Focus tab"
 *     body="Start a session, see your active task, and stop when you're done."
 *   />
 */

type CoachmarkKey = 'schedule' | 'focus' | 'stats' | 'settings';

interface Props {
  keyName: CoachmarkKey;
  title: string;
  body: string;
  /** Delay before the coachmark appears (ms). Default 600. */
  delayMs?: number;
}

export function Coachmark({ keyName, title, body, delayMs = 600 }: Props) {
  const { state, updateSettings } = useApp();
  const seen = state.settings.coachmarksSeen?.[keyName] ?? false;
  const [visible, setVisible] = useState(false);
  const opacity = useRef(new Animated.Value(0)).current;
  const scale = useRef(new Animated.Value(0.92)).current;

  // Reveal once after delay, but only the very first time.
  useEffect(() => {
    if (seen) return;
    const t = setTimeout(() => setVisible(true), delayMs);
    return () => clearTimeout(t);
  }, [seen, delayMs]);

  // Animate in when becoming visible.
  useEffect(() => {
    if (!visible) return;
    Animated.parallel([
      Animated.timing(opacity, { toValue: 1, duration: 220, useNativeDriver: true }),
      Animated.spring(scale, { toValue: 1, friction: 7, tension: 60, useNativeDriver: true }),
    ]).start();
  }, [visible, opacity, scale]);

  const dismiss = async () => {
    setVisible(false);
    try {
      const prev = state.settings.coachmarksSeen ?? {};
      await updateSettings({
        ...state.settings,
        coachmarksSeen: { ...prev, [keyName]: true },
      });
    } catch { /* non-fatal — flag will retry on next dismiss */ }
  };

  if (!visible) return null;

  return (
    <Modal transparent visible={visible} animationType="none" onRequestClose={dismiss}>
      <Pressable style={styles.backdrop} onPress={dismiss}>
        <Animated.View
          style={[
            styles.card,
            { opacity, transform: [{ scale }] },
          ]}
        >
          <View style={styles.iconRow}>
            <View style={styles.iconCircle}>
              <Ionicons name="bulb-outline" size={22} color="#fff" />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.title}>{title}</Text>
            </View>
          </View>
          <Text style={styles.body}>{body}</Text>
          <TouchableOpacity style={styles.btn} onPress={dismiss} activeOpacity={0.8}>
            <Text style={styles.btnText}>Got it</Text>
          </TouchableOpacity>
        </Animated.View>
      </Pressable>
    </Modal>
  );
}

const { width } = Dimensions.get('window');

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.55)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: SPACING.lg,
  },
  card: {
    width: Math.min(width - SPACING.lg * 2, 360),
    backgroundColor: '#1f2937',
    borderRadius: RADIUS.lg,
    padding: SPACING.lg,
    gap: SPACING.md,
    borderWidth: 1,
    borderColor: COLORS.primary,
  },
  iconRow: { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm },
  iconCircle: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: COLORS.primary,
    alignItems: 'center', justifyContent: 'center',
  },
  title: { color: '#fff', fontSize: FONT.md, fontWeight: '800' },
  body: { color: '#cbd5e1', fontSize: FONT.sm, lineHeight: 20 },
  btn: {
    alignSelf: 'flex-end',
    paddingHorizontal: SPACING.lg,
    paddingVertical: SPACING.sm,
    borderRadius: RADIUS.md,
    backgroundColor: COLORS.primary,
  },
  btnText: { color: '#fff', fontSize: FONT.sm, fontWeight: '700' },
});
