/**
 * OnboardingScreen
 *
 * Shown on first launch as a full-screen modal over the tabs.
 * Rich expandable permission cards matching the detail level of
 * the manage-permissions screen.
 *
 * - Auto-checks all permission statuses on mount and on every app-resume.
 * - Button is always enabled; if permissions are missing a tip points the
 *   user to Settings → Permissions instead of blocking entry.
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  AppState,
  Linking,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import * as Notifications from 'expo-notifications';
import { NativeImagePickerModule } from '@/native-modules/NativeImagePickerModule';
import { Alert } from 'react-native';
import { useApp } from '@/context/AppContext';
import { useTheme } from '@/hooks/useTheme';
import { requestPermissions } from '@/services/notificationService';
import { mergeIntoBlockPreset } from '@/services/blockListImport';
import { ForegroundServiceModule } from '@/native-modules/ForegroundServiceModule';
import { UsageStatsModule } from '@/native-modules/UsageStatsModule';
import { ForegroundLaunchModule } from '@/native-modules/ForegroundLaunchModule';
import { ImportFromOtherAppModal } from '@/components/ImportFromOtherAppModal';
import { RestrictedSettingsBanner } from '@/components/RestrictedSettingsBanner';
import { COLORS, FONT, RADIUS, SPACING } from '@/styles/theme';

type PermStatus = 'granted' | 'denied' | 'unknown';

interface PermItem {
  id: string;
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  description: string;
  whyNeeded: string;
  brokenWithout: string[];
  deepLinkLabel: string;
  grantAction: 'auto' | 'manual';
}

const PERMISSIONS: PermItem[] = [
  {
    id: 'media',
    icon: 'images-outline',
    title: 'Media & Files',
    description: 'Access your photo library to set a custom wallpaper on the block screen.',
    whyNeeded:
      'Only needed if you want to pick a custom background image for the block overlay. The default wallpaper works without this.',
    brokenWithout: [
      'You cannot pick a custom wallpaper for the block screen',
      'The default built-in wallpaper will be used instead',
    ],
    deepLinkLabel: 'Allow Media Access',
    grantAction: 'auto',
  },
  {
    id: 'notifications',
    icon: 'notifications-outline',
    title: 'Notifications',
    description: 'Task reminders and live focus session alerts.',
    whyNeeded:
      'Required for all alerts, task reminders, and keeping the foreground service visible to Android.',
    brokenWithout: [
      'No task start or end reminders',
      'The focus session notification disappears',
      'Android may kill the blocking service without the persistent notification',
    ],
    deepLinkLabel: 'Allow Notifications',
    grantAction: 'auto',
  },
  {
    id: 'battery',
    icon: 'battery-charging-outline',
    title: 'Battery Optimization',
    description: 'Keeps FocusFlow alive in the background on all OEM ROMs.',
    whyNeeded:
      'Samsung, Xiaomi, Realme, and OnePlus phones aggressively kill background services — this exemption stops that.',
    brokenWithout: [
      'Blocking service gets killed within minutes on most phones',
      'Focus sessions stop enforcing after the screen turns off',
      'Especially severe on Samsung One UI, MIUI, and ColorOS',
    ],
    deepLinkLabel: 'Request Exemption',
    grantAction: 'auto',
  },
  {
    id: 'overlay',
    icon: 'layers-outline',
    title: 'Appear on Top',
    description: 'Draws the block screen directly over blocked apps.',
    whyNeeded:
      'This lets FocusFlow cover blocked apps instantly without briefly showing the app underneath.',
    brokenWithout: [
      'Block overlay opens inside FocusFlow instead of directly over the blocked app',
      'A brief flash of the blocked app may appear before redirect',
    ],
    deepLinkLabel: 'Enable Appear on Top',
    grantAction: 'manual',
  },
  {
    id: 'usage',
    icon: 'analytics-outline',
    title: 'Usage Access',
    description: 'Lets FocusFlow see which app is in the foreground.',
    whyNeeded:
      'Without this, FocusFlow is blind — it cannot detect which app you switched to.',
    brokenWithout: [
      'FocusFlow cannot detect which app you opened',
      'App blocking will silently fail',
      'Stats and focus session tracking will be inaccurate',
    ],
    deepLinkLabel: 'Open Usage Access Settings',
    grantAction: 'manual',
  },
  {
    id: 'accessibility',
    icon: 'eye-outline',
    title: 'Accessibility Service',
    description: 'Redirects you away from blocked apps the instant you open them.',
    whyNeeded:
      'This is how FocusFlow instantly redirects you the moment you open a blocked app during a focus session.',
    brokenWithout: [
      'App blocking will not work at all',
      'Blocked apps will open freely during focus sessions',
      'You can bypass all blocks with no consequence',
    ],
    deepLinkLabel: 'Open Accessibility Settings',
    grantAction: 'manual',
  },
];

async function checkStatus(id: string): Promise<PermStatus> {
  try {
    switch (id) {
      case 'media': {
        const granted = await NativeImagePickerModule.checkMediaPermission();
        return granted ? 'granted' : 'denied';
      }
      case 'notifications': {
        const { status } = await Notifications.getPermissionsAsync();
        return status === 'granted' ? 'granted' : 'denied';
      }
      case 'battery': {
        const ok = await UsageStatsModule.isIgnoringBatteryOptimizations();
        return ok ? 'granted' : 'denied';
      }
      case 'usage': {
        const ok = await UsageStatsModule.hasPermission();
        return ok ? 'granted' : 'denied';
      }
      case 'accessibility': {
        const ok = await UsageStatsModule.hasAccessibilityPermission();
        return ok ? 'granted' : 'denied';
      }
      case 'overlay': {
        const ok = await ForegroundLaunchModule.hasOverlayPermission();
        return ok ? 'granted' : 'denied';
      }
      default:
        return 'unknown';
    }
  } catch {
    return 'unknown';
  }
}

export default function OnboardingScreen() {
  const { state, updateSettings } = useApp();
  const { theme } = useTheme();
  const [statuses, setStatuses] = useState<Record<string, PermStatus>>({});
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [importVisible, setImportVisible] = useState(false);
  const appStateRef = useRef(AppState.currentState);

  /**
   * One-tap entry for users switching from another blocker (Stay Focused,
   * AppBlock, Lock Me Out, etc). Imported packages are saved as a NEW
   * BlockPreset rather than dumped into the always-on block list, so the
   * user explicitly chooses when to start enforcement (and no alarm or
   * focus session fires automatically). The new preset shows up in
   * Standalone Block, Block Schedules, and Daily Allowance.
   */
  const handleImportFromOnboarding = async (packages: string[]) => {
    const result = mergeIntoBlockPreset(packages, state.settings);
    if (result.added === 0) {
      Alert.alert('Nothing imported', 'No valid app names were found.');
      return;
    }
    await updateSettings({ ...state.settings, blockPresets: result.allPresets });
    Alert.alert(
      'Saved as a preset',
      `${result.added} app${result.added !== 1 ? 's' : ''} saved as the preset "${result.preset.name}".\n\nFinish granting the permissions below, then open Standalone Block from the side menu and pick this preset whenever you're ready to start blocking.`,
    );
  };

  const checkAll = useCallback(async () => {
    const result: Record<string, PermStatus> = {};
    await Promise.all(
      PERMISSIONS.map(async (p) => {
        result[p.id] = await checkStatus(p.id);
      })
    );
    setStatuses(result);
  }, []);

  useEffect(() => {
    void checkAll();
  }, [checkAll]);

  useEffect(() => {
    const sub = AppState.addEventListener('change', async (next) => {
      if (appStateRef.current.match(/inactive|background/) && next === 'active') {
        await checkAll();
      }
      appStateRef.current = next;
    });
    return () => sub.remove();
  }, [checkAll]);

  const handleGrant = async (perm: PermItem) => {
    if (statuses[perm.id] === 'granted') return;
    setActionLoading(perm.id);
    try {
      if (perm.id === 'media') {
        const granted = await NativeImagePickerModule.requestMediaPermission();
        setStatuses((prev) => ({ ...prev, media: granted ? 'granted' : 'denied' }));
      } else if (perm.id === 'notifications') {
        const granted = await requestPermissions();
        setStatuses((prev) => ({ ...prev, notifications: granted ? 'granted' : 'denied' }));
      } else if (perm.id === 'battery') {
        await ForegroundServiceModule.requestBatteryOptimizationExemption();
        setTimeout(async () => {
          const s = await checkStatus('battery');
          setStatuses((prev) => ({ ...prev, battery: s }));
        }, 800);
      } else if (perm.id === 'usage') {
        if (Platform.OS === 'android') {
          await Linking.sendIntent('android.settings.USAGE_ACCESS_SETTINGS');
        }
      } else if (perm.id === 'accessibility') {
        await UsageStatsModule.openAccessibilitySettings();
      } else if (perm.id === 'overlay') {
        await ForegroundLaunchModule.requestOverlayPermission();
      }
    } catch {
      try {
        await Linking.openSettings();
      } catch { /* ignore */ }
    } finally {
      setActionLoading(null);
    }
  };

  const grantedCount = PERMISSIONS.filter((p) => statuses[p.id] === 'granted').length;
  const allGranted = grantedCount === PERMISSIONS.length;

  const handleFinish = async () => {
    // Don't mark onboardingComplete here — user-profile.tsx does that
    // so we know the user has seen (or skipped) the profile setup step.
    router.replace('/user-profile');
  };

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: theme.background }]}>
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>

        {/* Header */}
        <View style={styles.header}>
          <View style={styles.logoCircle}>
            <Ionicons name="shield-checkmark" size={38} color="#fff" />
          </View>
          <Text style={[styles.appName, { color: theme.text }]}>FocusFlow</Text>
          <Text style={[styles.tagline, { color: theme.muted }]}>Your discipline operating system</Text>
        </View>

        {/* Restricted-settings unlock banner — shown above everything else
            on the first-run flow when the OS is currently locking the
            Accessibility toggle. Auto-hides the moment the user completes
            the App Info → ⋮ → Allow restricted settings flow. */}
        <View style={{ marginHorizontal: SPACING.lg, marginBottom: SPACING.md }}>
          <RestrictedSettingsBanner />
        </View>

        {/* Why banner */}
        <View style={styles.tutorialBanner}>
          <View style={styles.tutorialIconWrap}>
            <Ionicons name="shield-checkmark" size={24} color={COLORS.primary} />
          </View>
          <View style={styles.tutorialTextWrap}>
            <Text style={styles.tutorialTitle}>Why these permissions?</Text>
            <Text style={styles.tutorialBody}>
              FocusFlow enforces focus at the system level — not just reminders.
              To actually block apps and keep your session running, Android requires
              special access that regular apps don't need.
            </Text>
          </View>
        </View>

        {/* One-tap import for users coming from another blocker */}
        <TouchableOpacity
          style={styles.importBanner}
          onPress={() => setImportVisible(true)}
          activeOpacity={0.85}
        >
          <View style={styles.importBannerIconWrap}>
            <Ionicons name="swap-horizontal" size={22} color="#fff" />
          </View>
          <View style={styles.importBannerTextWrap}>
            <Text style={styles.importBannerTitle}>Switching from another blocker?</Text>
            <Text style={styles.importBannerBody}>
              Bring your block list across in one tap — works for Stay Focused, AppBlock, Lock Me Out and more.
            </Text>
          </View>
          <Ionicons name="chevron-forward" size={20} color="#fff" style={{ opacity: 0.85 }} />
        </TouchableOpacity>

        {/* Progress bar */}
        <View style={styles.progressSection}>
          <View style={styles.progressLabelRow}>
            <Text style={[styles.progressLabel, { color: theme.muted }]}>Permissions granted</Text>
            <Text style={[styles.progressCount, allGranted && styles.progressCountDone]}>
              {grantedCount} / {PERMISSIONS.length}
            </Text>
          </View>
          <View style={[styles.progressBar, { backgroundColor: theme.border }]}>
            <View
              style={[
                styles.progressFill,
                {
                  width: `${(grantedCount / PERMISSIONS.length) * 100}%` as any,
                  backgroundColor: allGranted ? COLORS.green : COLORS.primary,
                },
              ]}
            />
          </View>
          {allGranted && (
            <Text style={styles.allSetText}>
              All permissions granted — blocking is fully active.
            </Text>
          )}
        </View>

        {/* Section label */}
        <Text style={[styles.sectionLabel, { color: theme.muted }]}>TAP A CARD TO SEE DETAILS</Text>

        {/* Permission cards */}
        {PERMISSIONS.map((perm) => {
          const status = statuses[perm.id] ?? 'unknown';
          const isExpanded = expandedId === perm.id;
          const isLoading = actionLoading === perm.id;

          return (
            <View
              key={perm.id}
              style={[styles.card, { backgroundColor: theme.card, borderColor: theme.border }, status === 'granted' && styles.cardGranted]}
            >
              <TouchableOpacity
                style={styles.cardMain}
                onPress={() => setExpandedId(isExpanded ? null : perm.id)}
                activeOpacity={0.75}
              >
                <View style={[styles.iconWrap, { backgroundColor: statusColor(status) + '22' }]}>
                  <Ionicons name={perm.icon} size={22} color={statusColor(status)} />
                </View>

                <View style={styles.cardBody}>
                  <View style={styles.cardTitleRow}>
                    <Text style={[styles.cardTitle, { color: theme.text }]}>{perm.title}</Text>
                    <StatusBadge status={status} />
                  </View>
                  <Text style={[styles.cardDesc, { color: theme.muted }]} numberOfLines={isExpanded ? undefined : 2}>
                    {perm.description}
                  </Text>
                </View>

                <Ionicons
                  name={isExpanded ? 'chevron-up' : 'chevron-down'}
                  size={16}
                  color={theme.muted}
                />
              </TouchableOpacity>

              {isExpanded && (
                <View style={[styles.expandedSection, { backgroundColor: theme.surface, borderTopColor: theme.border }]}>
                  {/* Why needed */}
                  <View style={styles.whyBox}>
                    <Ionicons name="bulb-outline" size={14} color={COLORS.orange} />
                    <Text style={styles.whyText}>{perm.whyNeeded}</Text>
                  </View>

                  {/* What breaks without it */}
                  {status !== 'granted' && (
                    <View style={styles.brokenSection}>
                      <Text style={[styles.brokenTitle, { color: theme.text }]}>Without this permission:</Text>
                      {perm.brokenWithout.map((item, i) => (
                        <View key={i} style={styles.brokenRow}>
                          <Ionicons name="close-circle" size={14} color={COLORS.red} />
                          <Text style={[styles.brokenText, { color: theme.textSecondary }]}>{item}</Text>
                        </View>
                      ))}
                    </View>
                  )}

                  {/* Grant button */}
                  {status !== 'granted' && (
                    <TouchableOpacity
                      style={styles.grantBtn}
                      onPress={() => handleGrant(perm)}
                      disabled={isLoading}
                    >
                      {isLoading ? (
                        <ActivityIndicator size="small" color="#fff" />
                      ) : (
                        <>
                          <Ionicons name="open-outline" size={14} color="#fff" />
                          <Text style={styles.grantBtnText}>{perm.deepLinkLabel}</Text>
                        </>
                      )}
                    </TouchableOpacity>
                  )}
                </View>
              )}
            </View>
          );
        })}

        {/* Missing perms tip — points to manage perms instead of blocking */}
        {!allGranted && (
          <View style={styles.manageTip}>
            <Ionicons name="information-circle-outline" size={18} color={COLORS.primary} />
            <Text style={[styles.manageTipText, { color: theme.textSecondary }]}>
              Missing permissions can be fixed anytime in{' '}
              <Text style={styles.manageTipHighlight}>Settings → Permissions</Text>
              {' '}where you'll also find troubleshooting help.
            </Text>
          </View>
        )}

        {/* Enter button — always enabled */}
        <TouchableOpacity
          style={[styles.enterBtn, allGranted && styles.enterBtnReady]}
          onPress={handleFinish}
          activeOpacity={0.85}
        >
          <Text style={styles.enterBtnText}>Continue →</Text>
        </TouchableOpacity>

        <Text style={[styles.footerNote, { color: theme.muted }]}>
          All permissions can be managed in Settings at any time.
        </Text>
      </ScrollView>

      <ImportFromOtherAppModal
        visible={importVisible}
        onClose={() => setImportVisible(false)}
        onImport={handleImportFromOnboarding}
      />
    </SafeAreaView>
  );
}

function statusColor(status: PermStatus): string {
  if (status === 'granted') return COLORS.green;
  if (status === 'denied') return COLORS.red;
  return COLORS.muted;
}

function StatusBadge({ status }: { status: PermStatus }) {
  const label =
    status === 'granted' ? 'Granted' : status === 'denied' ? 'Missing' : 'Checking…';
  const color = statusColor(status);
  return (
    <View style={[badge.wrap, { backgroundColor: color + '22', borderColor: color + '44' }]}>
      <Text style={[badge.text, { color }]}>{label}</Text>
    </View>
  );
}

const badge = StyleSheet.create({
  wrap: {
    paddingHorizontal: SPACING.sm,
    paddingVertical: 2,
    borderRadius: RADIUS.full,
    borderWidth: 1,
  },
  text: { fontSize: FONT.xs, fontWeight: '700' },
});

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: COLORS.background },
  scroll: { padding: SPACING.lg, paddingBottom: 56, gap: SPACING.md },

  // Header
  header: {
    alignItems: 'center',
    paddingVertical: SPACING.xl,
    gap: SPACING.sm,
  },
  logoCircle: {
    width: 84,
    height: 84,
    borderRadius: 42,
    backgroundColor: COLORS.primary,
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 6,
  },
  appName: {
    fontSize: FONT.xxl + 4,
    fontWeight: '900',
    color: COLORS.text,
    letterSpacing: -1,
  },
  tagline: { fontSize: FONT.sm, color: COLORS.muted, textAlign: 'center' },

  // One-tap import banner (Stay Focused / AppBlock / Lock Me Out refugees)
  importBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.md,
    backgroundColor: COLORS.primary,
    borderRadius: RADIUS.lg,
    padding: SPACING.md,
    marginHorizontal: SPACING.lg,
    marginBottom: SPACING.lg,
  },
  importBannerIconWrap: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.18)',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  importBannerTextWrap: { flex: 1 },
  importBannerTitle: {
    fontSize: FONT.sm,
    fontWeight: '700',
    color: '#fff',
    marginBottom: 2,
  },
  importBannerBody: {
    fontSize: FONT.xs,
    color: 'rgba(255,255,255,0.92)',
    lineHeight: 16,
  },

  // Tutorial banner
  tutorialBanner: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: COLORS.primaryLight,
    borderRadius: RADIUS.lg,
    padding: SPACING.md,
    gap: SPACING.md,
    borderWidth: 1,
    borderColor: COLORS.primary + '33',
  },
  tutorialIconWrap: {
    width: 44,
    height: 44,
    borderRadius: RADIUS.md,
    backgroundColor: COLORS.primary + '18',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  tutorialTextWrap: { flex: 1, gap: 4 },
  tutorialTitle: {
    fontSize: FONT.sm,
    fontWeight: '800',
    color: COLORS.primary,
  },
  tutorialBody: {
    fontSize: FONT.xs,
    color: COLORS.primary + 'cc',
    lineHeight: 17,
  },

  // Progress
  progressSection: { gap: SPACING.xs },
  progressLabelRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  progressLabel: { fontSize: FONT.xs, color: COLORS.muted, fontWeight: '600' },
  progressCount: { fontSize: FONT.xs, fontWeight: '800', color: COLORS.primary },
  progressCountDone: { color: COLORS.green },
  progressBar: {
    height: 6,
    backgroundColor: COLORS.border,
    borderRadius: RADIUS.full,
    overflow: 'hidden',
  },
  progressFill: { height: 6, borderRadius: RADIUS.full },
  allSetText: {
    fontSize: FONT.xs,
    color: COLORS.green,
    fontWeight: '600',
    textAlign: 'center',
    marginTop: 2,
  },

  sectionLabel: {
    fontSize: FONT.xs,
    fontWeight: '700',
    color: COLORS.muted,
    letterSpacing: 1,
  },

  // Cards
  card: {
    backgroundColor: COLORS.card,
    borderRadius: RADIUS.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: COLORS.border,
    overflow: 'hidden',
  },
  cardGranted: { borderColor: COLORS.green + '55' },
  cardMain: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    padding: SPACING.md,
    gap: SPACING.md,
  },
  iconWrap: {
    width: 44,
    height: 44,
    borderRadius: RADIUS.md,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
    marginTop: 2,
  },
  cardBody: { flex: 1, gap: 4 },
  cardTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
    flexWrap: 'wrap',
  },
  cardTitle: { fontSize: FONT.md, fontWeight: '700', color: COLORS.text },
  cardDesc: { fontSize: FONT.xs, color: COLORS.muted, lineHeight: 17 },

  // Expanded
  expandedSection: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: COLORS.border,
    padding: SPACING.md,
    gap: SPACING.sm,
    backgroundColor: COLORS.surface,
  },
  whyBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 6,
    backgroundColor: COLORS.orangeLight,
    borderRadius: RADIUS.md,
    padding: SPACING.sm,
  },
  whyText: {
    flex: 1,
    fontSize: FONT.xs,
    color: COLORS.orange,
    lineHeight: 17,
    fontWeight: '600',
  },
  brokenSection: { gap: 6 },
  brokenTitle: {
    fontSize: FONT.xs,
    fontWeight: '700',
    color: COLORS.text,
    marginBottom: 2,
  },
  brokenRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 6 },
  brokenText: {
    flex: 1,
    fontSize: FONT.xs,
    color: COLORS.textSecondary,
    lineHeight: 17,
  },
  grantBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: COLORS.primary,
    borderRadius: RADIUS.md,
    padding: SPACING.sm,
  },
  grantBtnText: { fontSize: FONT.xs, fontWeight: '700', color: '#fff' },

  // Manage permissions tip
  manageTip: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: SPACING.sm,
    backgroundColor: COLORS.primaryLight,
    borderRadius: RADIUS.lg,
    padding: SPACING.md,
    borderWidth: 1,
    borderColor: COLORS.primary + '33',
  },
  manageTipText: {
    flex: 1,
    fontSize: FONT.xs,
    color: COLORS.textSecondary,
    lineHeight: 17,
  },
  manageTipHighlight: {
    color: COLORS.primary,
    fontWeight: '700',
  },

  // Enter button
  enterBtn: {
    backgroundColor: COLORS.primaryLight,
    borderRadius: RADIUS.lg,
    padding: SPACING.md,
    alignItems: 'center',
    marginTop: SPACING.xs,
  },
  enterBtnReady: { backgroundColor: COLORS.primary },
  enterBtnText: { fontSize: FONT.md, fontWeight: '800', color: '#fff' },

  footerNote: {
    fontSize: FONT.xs,
    color: COLORS.muted,
    textAlign: 'center',
  },
});
