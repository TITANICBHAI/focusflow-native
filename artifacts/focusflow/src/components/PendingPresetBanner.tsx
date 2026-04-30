import React, { useMemo, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Alert } from 'react-native';
import { useApp } from '@/context/AppContext';
import { useTheme } from '@/hooks/useTheme';
import { COLORS, FONT, RADIUS, SPACING } from '@/styles/theme';
import type { PendingPresets, AppSettings } from '@/data/types';

/**
 * PendingPresetBanner
 *
 * Surfaces the staged-but-not-yet-applied preset payloads written into
 * `settings.pendingPresets` by the import pipeline (`backupService.restoreFromJson`).
 *
 * The import path deliberately does NOT overwrite live enforcement settings
 * because doing so silently changes what the user is currently being blocked
 * on. Instead each "dangerous" category (Block list / Daily allowance /
 * Deterrents / Enforcement / Profile) is parked here until the user explicitly
 * Applies or Dismisses it.
 *
 * Usage: drop `<PendingPresetBanner category="blockApps" />` near the top of
 * any screen that owns the matching setting (e.g. settings.tsx for everything,
 * DailyAllowanceModal for `dailyAllowance`, user-profile.tsx for `profile`).
 *
 * Pass `category="all"` to render banners for every staged category at once.
 */

type Category = keyof PendingPresets | 'all';

interface Props {
  category?: Category;
  /** Hide entirely when there's nothing staged for this category. Default true. */
  hideWhenEmpty?: boolean;
}

const CATEGORY_META: Record<keyof PendingPresets, { title: string; describe: (p: NonNullable<PendingPresets[keyof PendingPresets]>) => string }> = {
  blockApps: {
    title: 'Imported block list',
    describe: (p: any) =>
      `${p.packages?.length ?? 0} app(s) ready to add to your always-on block list.`,
  },
  dailyAllowance: {
    title: 'Imported daily allowance',
    describe: (p: any) =>
      `${p.entries?.length ?? 0} per-app allowance rule(s) ready to apply.`,
  },
  deterrents: {
    title: 'Imported deterrent settings',
    describe: (p: any) => {
      const on = [
        p.aversionDimmerEnabled && 'Dimmer',
        p.aversionVibrateEnabled && 'Vibration',
        p.aversionSoundEnabled && 'Sound',
      ].filter(Boolean).join(', ');
      return on ? `Will turn on: ${on}.` : 'Will refresh deterrent toggles.';
    },
  },
  enforcement: {
    title: 'Imported enforcement settings',
    describe: (p: any) => {
      const parts: string[] = [];
      if (p.systemGuardEnabled) parts.push('System Protection');
      if (p.blockInstallActionsEnabled) parts.push('Install Blocker');
      if (p.blockYoutubeShortsEnabled) parts.push('YouTube Shorts');
      if (p.blockInstagramReelsEnabled) parts.push('Instagram Reels');
      if (p.blockedWords?.length) parts.push(`${p.blockedWords.length} keyword(s)`);
      return parts.length
        ? `Will turn on: ${parts.join(', ')}.`
        : 'Will refresh enforcement toggles.';
    },
  },
  profile: {
    title: 'Imported user profile',
    describe: (p: any) =>
      `Profile fields from your previous device are ready to apply.`,
  },
};

export function PendingPresetBanner({ category = 'all', hideWhenEmpty = true }: Props) {
  const { state, updateSettings, setStandaloneBlock, setDailyAllowanceEntries } = useApp();
  const { theme } = useTheme();
  const [busy, setBusy] = useState<string | null>(null);

  const pending = state.settings.pendingPresets ?? {};
  const categories = useMemo<(keyof PendingPresets)[]>(() => {
    const all: (keyof PendingPresets)[] = ['blockApps', 'dailyAllowance', 'deterrents', 'enforcement', 'profile'];
    return category === 'all' ? all : [category as keyof PendingPresets];
  }, [category]);

  const visible = categories.filter((k) => pending[k] != null);
  if (visible.length === 0) {
    return hideWhenEmpty ? null : <View />;
  }

  const clearCategory = async (key: keyof PendingPresets) => {
    const next: PendingPresets = { ...pending };
    delete next[key];
    const newSettings: AppSettings = {
      ...state.settings,
      pendingPresets: Object.keys(next).length > 0 ? next : undefined,
    };
    await updateSettings(newSettings);
  };

  const onApply = async (key: keyof PendingPresets) => {
    setBusy(key);
    try {
      const payload = pending[key]!;
      const s = state.settings;

      if (key === 'blockApps') {
        // Union the imported packages with whatever is already in the always-on
        // list so the user never loses what they had.
        const incoming = (payload as PendingPresets['blockApps'])!.packages ?? [];
        const current = s.standaloneBlockPackages ?? [];
        const merged = Array.from(new Set([...current, ...incoming]));
        // standaloneBlockUntil is an ISO string in settings, but setStandaloneBlock
        // wants epoch ms. Convert (or pass null when no active timed window).
        const untilMs = s.standaloneBlockUntil
          ? new Date(s.standaloneBlockUntil).getTime()
          : null;
        await setStandaloneBlock(merged, untilMs);
      } else if (key === 'dailyAllowance') {
        const incoming = (payload as PendingPresets['dailyAllowance'])!.entries ?? [];
        const currentByPkg = new Map((s.dailyAllowanceEntries ?? []).map((e) => [e.packageName, e]));
        for (const e of incoming) currentByPkg.set(e.packageName, e);
        await setDailyAllowanceEntries(Array.from(currentByPkg.values()));
      } else if (key === 'deterrents') {
        const p = payload as NonNullable<PendingPresets['deterrents']>;
        await updateSettings({
          ...s,
          aversionDimmerEnabled:  p.aversionDimmerEnabled  ?? s.aversionDimmerEnabled,
          aversionVibrateEnabled: p.aversionVibrateEnabled ?? s.aversionVibrateEnabled,
          aversionSoundEnabled:   p.aversionSoundEnabled   ?? s.aversionSoundEnabled,
          pendingPresets: dropKey(s.pendingPresets, key),
        });
        setBusy(null);
        return;
      } else if (key === 'enforcement') {
        const p = payload as NonNullable<PendingPresets['enforcement']>;
        const currentWords = s.blockedWords ?? [];
        const incomingWords = p.blockedWords ?? [];
        const mergedWords = Array.from(new Set([...currentWords, ...incomingWords]));
        await updateSettings({
          ...s,
          systemGuardEnabled:           p.systemGuardEnabled           ?? s.systemGuardEnabled,
          blockInstallActionsEnabled:   p.blockInstallActionsEnabled   ?? s.blockInstallActionsEnabled,
          blockYoutubeShortsEnabled:    p.blockYoutubeShortsEnabled    ?? s.blockYoutubeShortsEnabled,
          blockInstagramReelsEnabled:   p.blockInstagramReelsEnabled   ?? s.blockInstagramReelsEnabled,
          blockedWords: mergedWords,
          pendingPresets: dropKey(s.pendingPresets, key),
        });
        setBusy(null);
        return;
      } else if (key === 'profile') {
        const p = payload as NonNullable<PendingPresets['profile']>;
        await updateSettings({
          ...s,
          userProfile: { ...(s.userProfile ?? {}), ...(p.profile ?? {}) },
          pendingPresets: dropKey(s.pendingPresets, key),
        });
        setBusy(null);
        return;
      }

      // For blockApps + dailyAllowance the dedicated mutators above don't
      // touch pendingPresets, so clear the category here.
      await clearCategory(key);
    } catch (e) {
      Alert.alert('Could not apply', String(e));
    } finally {
      setBusy(null);
    }
  };

  const onDismiss = (key: keyof PendingPresets) => {
    Alert.alert(
      'Dismiss imported preset?',
      'This will discard the staged values for this section. You can re-import the backup file later if needed.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Dismiss',
          style: 'destructive',
          onPress: async () => {
            try { await clearCategory(key); }
            catch (e) { Alert.alert('Could not dismiss', String(e)); }
          },
        },
      ],
    );
  };

  return (
    <View style={{ gap: SPACING.sm }}>
      {visible.map((key) => {
        const meta = CATEGORY_META[key];
        const payload = pending[key]!;
        return (
          <View
            key={key}
            style={[styles.card, { backgroundColor: theme.card, borderColor: COLORS.primary }]}
          >
            <View style={styles.row}>
              <View style={styles.dot} />
              <View style={{ flex: 1 }}>
                <Text style={[styles.title, { color: theme.text }]}>{meta.title}</Text>
                <Text style={[styles.body, { color: theme.muted }]}>
                  {meta.describe(payload as any)}
                </Text>
                {(payload as any).sourceName ? (
                  <Text style={[styles.source, { color: theme.muted }]}>
                    From: {(payload as any).sourceName}
                  </Text>
                ) : null}
              </View>
            </View>
            <View style={styles.actions}>
              <TouchableOpacity
                onPress={() => onDismiss(key)}
                style={[styles.btn, styles.btnGhost, { borderColor: theme.border }]}
                activeOpacity={0.7}
                disabled={busy === key}
              >
                <Text style={[styles.btnGhostText, { color: theme.text }]}>Dismiss</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => onApply(key)}
                style={[styles.btn, styles.btnPrimary, busy === key && { opacity: 0.6 }]}
                activeOpacity={0.7}
                disabled={busy === key}
              >
                <Text style={styles.btnPrimaryText}>
                  {busy === key ? 'Applying…' : 'Apply'}
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        );
      })}
    </View>
  );
}

function dropKey(p: PendingPresets | undefined, key: keyof PendingPresets): PendingPresets | undefined {
  if (!p) return undefined;
  const next: PendingPresets = { ...p };
  delete next[key];
  return Object.keys(next).length > 0 ? next : undefined;
}

const styles = StyleSheet.create({
  card: {
    borderRadius: RADIUS.lg,
    borderWidth: 1.5,
    padding: SPACING.md,
    gap: SPACING.sm,
  },
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: SPACING.sm },
  dot: {
    width: 10, height: 10, borderRadius: 5,
    backgroundColor: COLORS.primary,
    marginTop: 6,
  },
  title: { fontSize: FONT.sm, fontWeight: '800', marginBottom: 2 },
  body: { fontSize: FONT.xs, lineHeight: 16 },
  source: { fontSize: FONT.xs - 1, marginTop: 4, fontStyle: 'italic' },
  actions: { flexDirection: 'row', justifyContent: 'flex-end', gap: SPACING.sm },
  btn: {
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
    borderRadius: RADIUS.md,
    minWidth: 88,
    alignItems: 'center',
  },
  btnGhost: { borderWidth: 1 },
  btnGhostText: { fontSize: FONT.sm, fontWeight: '700' },
  btnPrimary: { backgroundColor: COLORS.primary },
  btnPrimaryText: { color: '#fff', fontSize: FONT.sm, fontWeight: '700' },
});
