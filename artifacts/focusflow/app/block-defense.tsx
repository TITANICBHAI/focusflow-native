/**
 * block-defense.tsx
 *
 * "Block Enforcement" screen — groups the tools that make blocks impossible to bypass.
 * Accessible from the Side Menu. Opens with an optional `tab` query param:
 *   /block-defense?tab=keywords   → scroll to Keyword Blocker
 *   /block-defense?tab=system     → scroll to System Protection
 *   /block-defense?tab=aversion   → scroll to Aversion Deterrents
 *   /block-defense?tab=greyout    → scroll to Greyout Schedule
 */

import React, { useState, useRef, useEffect } from 'react';
import {
  View,
  Text,
  ScrollView,
  Switch,
  TouchableOpacity,
  StyleSheet,
  Alert,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';

import { useApp } from '@/context/AppContext';
import { useTheme } from '@/hooks/useTheme';
import { COLORS, FONT, RADIUS, SPACING } from '@/styles/theme';
import { GreyoutScheduleModal } from '@/components/GreyoutScheduleModal';
import type { GreyoutWindow } from '@/data/types';

export default function BlockDefenseScreen() {
  const insets = useSafeAreaInsets();
  const { theme, isDark } = useTheme();
  const { state, updateSettings } = useApp();
  const { settings } = state;
  const params = useLocalSearchParams<{ tab?: string }>();

  const [greyoutModalVisible, setGreyoutModalVisible] = useState(false);

  const scrollRef = useRef<ScrollView>(null);
  const sectionRefs = {
    system: useRef<View>(null),
    aversion: useRef<View>(null),
    greyout: useRef<View>(null),
  };

  const focusActive = state.focusSession?.isActive === true;
  const standaloneActive = (() => {
    if (!settings.standaloneBlockUntil) return false;
    if ((settings.standaloneBlockPackages ?? []).length === 0) return false;
    return new Date(settings.standaloneBlockUntil).getTime() > Date.now();
  })();
  const blockProtectionActive = focusActive || standaloneActive;

  // Always-on enforcement is active whenever standalone packages OR allowance
  // entries exist — those rules are enforced even with no timed session running.
  // Mirrors the logic in AppContext._syncAlwaysBlock so the banner reflects
  // exactly what the AccessibilityService is doing right now.
  const standalonePkgCount = (settings.standaloneBlockPackages ?? []).length;
  const allowanceEntryCount = (settings.dailyAllowanceEntries ?? []).length;
  const alwaysOnActive = standalonePkgCount > 0 || allowanceEntryCount > 0;

  useEffect(() => {
    const tab = params.tab;
    if (!tab) return;
    // Keyword Blocker has moved to its own page; redirect any old deep-links.
    if (tab === 'keywords') {
      router.replace('/keyword-blocker');
      return;
    }
    const timeout = setTimeout(() => {
      const ref = sectionRefs[tab as keyof typeof sectionRefs];
      if (ref?.current) {
        ref.current.measureLayout(
          scrollRef.current as unknown as never,
          (_x: number, y: number) => {
            scrollRef.current?.scrollTo({ y: y - 16, animated: true });
          },
          () => {},
        );
      }
      // Auto-open the appropriate modal
      if (tab === 'greyout') setGreyoutModalVisible(true);
    }, 400);
    return () => clearTimeout(timeout);
  }, [params.tab]);

  const update = async (partial: Partial<typeof settings>) => {
    await updateSettings({ ...settings, ...partial });
  };

  const handleSystemGuardToggle = async (enabled: boolean) => {
    if (!enabled && blockProtectionActive) {
      Alert.alert('Protection is active', 'Cannot disable while Focus Mode or a block is active.');
      return;
    }
    await update({ systemGuardEnabled: enabled });
  };

  const handleInstallToggle = async (enabled: boolean) => {
    if (!enabled && blockProtectionActive) {
      Alert.alert('Protection is active', 'Cannot disable while a block is active.');
      return;
    }
    await update({ blockInstallActionsEnabled: enabled });
  };

  const handleYoutubeToggle = async (enabled: boolean) => {
    if (!enabled && blockProtectionActive) {
      Alert.alert('Protection is active', 'Cannot disable while a block is active.');
      return;
    }
    await update({ blockYoutubeShortsEnabled: enabled });
  };

  const handleReelsToggle = async (enabled: boolean) => {
    if (!enabled && blockProtectionActive) {
      Alert.alert('Protection is active', 'Cannot disable while a block is active.');
      return;
    }
    await update({ blockInstagramReelsEnabled: enabled });
  };

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: theme.background }]} edges={['top']}>
      {/* Header */}
      <View style={[styles.header, { backgroundColor: theme.card, borderBottomColor: theme.border }]}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
          <Ionicons name="chevron-back" size={24} color={theme.text} />
        </TouchableOpacity>
        <View style={{ flex: 1, marginLeft: SPACING.sm }}>
          <Text style={[styles.title, { color: theme.text }]}>Block Enforcement</Text>
          <Text style={[styles.subtitle, { color: theme.muted }]}>
            The layers that make your blocks impossible to bypass
          </Text>
        </View>
      </View>

      <ScrollView
        ref={scrollRef}
        style={styles.scroll}
        contentContainerStyle={[styles.content, { paddingBottom: 40 + insets.bottom }]}
      >
        {/* Slight inline hint when nothing is blocking — points to Active page */}
        {!blockProtectionActive && !alwaysOnActive && (
          <TouchableOpacity
            style={[styles.hintBanner, { backgroundColor: COLORS.primary + '0E', borderColor: COLORS.primary + '33' }]}
            onPress={() => router.push('/active')}
            activeOpacity={0.8}
          >
            <Ionicons name="pulse-outline" size={16} color={COLORS.primary} />
            <Text style={[styles.hintBannerText, { color: theme.text }]}>
              Nothing is blocking right now. See live status on the Active page.
            </Text>
            <Ionicons name="chevron-forward" size={14} color={COLORS.primary} />
          </TouchableOpacity>
        )}

        {/* Intro banner */}
        <View style={[styles.introBanner, { backgroundColor: COLORS.primary + '12', borderColor: COLORS.primary + '33' }]}>
          <Ionicons name="shield-checkmark" size={20} color={COLORS.primary} />
          <Text style={[styles.introText, { color: theme.text }]}>
            These tools run continuously in the background whenever they are switched on — they do not need a Focus session or standalone block to be active. While a block IS running, the toggles below stay locked on so they can&apos;t be disabled mid-session.
          </Text>
        </View>

        {/* ── Focus Session Behaviour ──────────────────────────────── */}
        <View collapsable={false}>
          <SectionHeader
            icon="hourglass-outline"
            title="Focus Session Behaviour"
            description="Controls what happens to a running focus session when you finish or skip a task early."
            theme={theme}
          />
          <View style={[styles.card, { backgroundColor: theme.card, borderColor: theme.border }]}>
            <SwitchRow
              label="Keep focus active for the full duration"
              description={
                (settings.keepFocusActiveUntilTaskEnd ?? false)
                  ? 'On — completing a task early keeps app-blocking running until the original end time'
                  : 'Off — completing a task immediately ends the focus session (default)'
              }
              value={settings.keepFocusActiveUntilTaskEnd ?? false}
              onValueChange={(v) => update({ keepFocusActiveUntilTaskEnd: v })}
              theme={theme}
              isLast
            />
          </View>
        </View>

        {/* ── System Protection ────────────────────────────────────── */}
        <View ref={sectionRefs.system} collapsable={false}>
          <SectionHeader
            icon="lock-closed-outline"
            title="System Protection"
            description="Locks down Android system controls so there's no way to wriggle out through system menus. Each toggle runs continuously while it is on."
            theme={theme}
          />
          <View style={[styles.card, { backgroundColor: theme.card, borderColor: theme.border }]}>
            <SwitchRow
              label="Protect system controls"
              description={
                blockProtectionActive && (settings.systemGuardEnabled ?? true)
                  ? 'Locked on — active block in progress'
                  : 'Power menu, Emergency mode & sensitive Settings pages — guarded all the time when on'
              }
              value={settings.systemGuardEnabled ?? true}
              onValueChange={handleSystemGuardToggle}
              disabled={blockProtectionActive && (settings.systemGuardEnabled ?? true)}
              theme={theme}
            />
            <SwitchRow
              label="Block install / uninstall"
              description={
                blockProtectionActive && (settings.blockInstallActionsEnabled ?? false)
                  ? 'Locked on — active block in progress'
                  : 'Stops Play Store installs & package-installer dialogs from slipping through — runs all the time when on'
              }
              value={settings.blockInstallActionsEnabled ?? false}
              onValueChange={handleInstallToggle}
              disabled={blockProtectionActive && (settings.blockInstallActionsEnabled ?? false)}
              theme={theme}
            />
            <SwitchRow
              label="Block YouTube Shorts"
              description={
                blockProtectionActive && (settings.blockYoutubeShortsEnabled ?? false)
                  ? 'Locked on — active block in progress'
                  : 'Sends you home the moment the Shorts player opens (regular YouTube stays usable) — runs all the time when on'
              }
              value={settings.blockYoutubeShortsEnabled ?? false}
              onValueChange={handleYoutubeToggle}
              disabled={blockProtectionActive && (settings.blockYoutubeShortsEnabled ?? false)}
              theme={theme}
            />
            <SwitchRow
              label="Block Instagram Reels"
              description={
                blockProtectionActive && (settings.blockInstagramReelsEnabled ?? false)
                  ? 'Locked on — active block in progress'
                  : 'Closes the Reels viewer (rest of Instagram stays usable) — runs all the time when on'
              }
              value={settings.blockInstagramReelsEnabled ?? false}
              onValueChange={handleReelsToggle}
              disabled={blockProtectionActive && (settings.blockInstagramReelsEnabled ?? false)}
              theme={theme}
              isLast
            />
          </View>
        </View>

        {/* ── Aversion Deterrents ──────────────────────────────────── */}
        <View ref={sectionRefs.aversion} collapsable={false}>
          <SectionHeader
            icon="flash-outline"
            title="Aversion Deterrents"
            description="Pair discomfort with distraction. Applied the instant a blocked app launches to build a negative reflex."
            theme={theme}
          />
          <View style={[styles.card, { backgroundColor: theme.card, borderColor: theme.border }]}>
            <SwitchRow
              label="Screen Dimmer"
              description="Near-black overlay appears while a blocked app is open"
              value={settings.aversionDimmerEnabled}
              onValueChange={(v) => update({ aversionDimmerEnabled: v })}
              theme={theme}
            />
            <SwitchRow
              label="Vibration Harassment"
              description="Repeated pulse vibration while a blocked app is in foreground"
              value={settings.aversionVibrateEnabled}
              onValueChange={(v) => update({ aversionVibrateEnabled: v })}
              theme={theme}
            />
            <SwitchRow
              label="Sound Alert"
              description="Startling sound plays the moment a blocked app launches"
              value={settings.aversionSoundEnabled}
              onValueChange={(v) => update({ aversionSoundEnabled: v })}
              theme={theme}
              isLast
            />
          </View>
        </View>

        {/* ── Block Batches ─────────────────────────────────────── */}
        <View ref={sectionRefs.greyout} collapsable={false}>
          <SectionHeader
            icon="time-outline"
            title="Block Batches"
            description="Create one or more batches — each batch picks a group of apps and the hours/days they should be blocked. Set once, runs forever, no focus session needed."
            theme={theme}
          />
          <View style={[styles.card, { backgroundColor: theme.card, borderColor: theme.border }]}>
            <TouchableOpacity style={styles.cardButton} onPress={() => setGreyoutModalVisible(true)}>
              <View style={styles.cardButtonContent}>
                <Text style={[styles.cardButtonLabel, { color: theme.text }]}>Manage Schedule Batches</Text>
                <Text style={[styles.cardButtonDesc, { color: theme.muted }]}>
                  {(settings.greyoutSchedule ?? []).length === 0
                    ? 'No batches set — tap to add your first one'
                    : `${(settings.greyoutSchedule ?? []).length} batch${(settings.greyoutSchedule ?? []).length !== 1 ? 'es' : ''} active`}
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={16} color={theme.border} />
            </TouchableOpacity>
          </View>
        </View>
      </ScrollView>

      {/* Modals */}
      <GreyoutScheduleModal
        visible={greyoutModalVisible}
        windows={settings.greyoutSchedule ?? []}
        onSave={async (windows: GreyoutWindow[]) => { await update({ greyoutSchedule: windows }); }}
        onClose={() => setGreyoutModalVisible(false)}
      />
    </SafeAreaView>
  );
}

function SectionHeader({
  icon,
  title,
  description,
  theme,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  description: string;
  theme: ReturnType<typeof useTheme>['theme'];
}) {
  return (
    <View style={styles.sectionHeader}>
      <View style={styles.sectionHeaderRow}>
        <View style={[styles.sectionIcon, { backgroundColor: COLORS.primary + '18' }]}>
          <Ionicons name={icon} size={16} color={COLORS.primary} />
        </View>
        <Text style={[styles.sectionTitle, { color: theme.text }]}>{title}</Text>
      </View>
      <Text style={[styles.sectionDesc, { color: theme.muted }]}>{description}</Text>
    </View>
  );
}

function SwitchRow({
  label,
  description,
  value,
  onValueChange,
  disabled = false,
  theme,
  isLast = false,
}: {
  label: string;
  description: string;
  value: boolean;
  onValueChange: (v: boolean) => void;
  disabled?: boolean;
  theme: ReturnType<typeof useTheme>['theme'];
  isLast?: boolean;
}) {
  return (
    <View style={[styles.switchRow, !isLast && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: theme.border }]}>
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={[styles.switchLabel, { color: theme.text }]}>{label}</Text>
        <Text style={[styles.switchDesc, { color: theme.muted }]}>{description}</Text>
      </View>
      <Switch
        value={value}
        onValueChange={onValueChange}
        disabled={disabled}
        trackColor={{ false: COLORS.border, true: COLORS.primary + '88' }}
        thumbColor={value ? COLORS.primary : COLORS.muted}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: SPACING.lg,
    paddingVertical: SPACING.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  title: { fontSize: FONT.lg, fontWeight: '800' },
  subtitle: { fontSize: FONT.xs, marginTop: 2 },
  scroll: { flex: 1 },
  content: { padding: SPACING.lg, gap: SPACING.md },
  introBanner: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: SPACING.sm,
    padding: SPACING.md,
    borderRadius: RADIUS.md,
    borderWidth: 1,
  },
  introText: { flex: 1, fontSize: FONT.sm, lineHeight: 20 },
  hintBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm + 2,
    borderRadius: RADIUS.md,
    borderWidth: 1,
  },
  hintBannerText: { flex: 1, fontSize: FONT.xs, lineHeight: 17 },
  sectionHeader: {
    gap: 4,
    marginBottom: SPACING.xs,
  },
  sectionHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
  },
  sectionIcon: {
    width: 28,
    height: 28,
    borderRadius: RADIUS.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sectionTitle: { fontSize: FONT.md, fontWeight: '700' },
  sectionDesc: { fontSize: FONT.xs, lineHeight: 18, paddingLeft: 28 + SPACING.sm },
  card: {
    borderRadius: RADIUS.md,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
  },
  cardButton: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: SPACING.md,
    gap: SPACING.sm,
  },
  cardButtonContent: { flex: 1, gap: 2 },
  cardButtonLabel: { fontSize: FONT.sm, fontWeight: '600' },
  cardButtonDesc: { fontSize: FONT.xs },
  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm + 2,
  },
  switchLabel: { fontSize: FONT.sm, fontWeight: '600' },
  switchDesc: { fontSize: FONT.xs, lineHeight: 17 },
});
