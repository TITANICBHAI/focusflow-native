import React, { useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Linking,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { router, useNavigation } from 'expo-router';
import { useApp } from '@/context/AppContext';
import { useTheme } from '@/hooks/useTheme';
import { COLORS, FONT, RADIUS, SPACING } from '@/styles/theme';
import { SharedPrefsModule } from '@/native-modules/SharedPrefsModule';

const PRIVACY_URL = 'https://titanicbhai.github.io/FocusFlow/privacy-policy/';
const TERMS_URL   = 'https://titanicbhai.github.io/FocusFlow/terms-of-service/';

export default function PrivacyPolicyScreen() {
  const { state, updateSettings } = useApp();
  const { theme } = useTheme();
  const navigation = useNavigation();
  const isRevisit = navigation.canGoBack();
  const [accepted, setAccepted] = useState(false);
  const [accepting, setAccepting] = useState(false);

  const handleAccept = async () => {
    if (accepting || !accepted) return;
    setAccepting(true);
    try {
      const updated = { ...state.settings, privacyAccepted: true };
      await updateSettings(updated);
      try {
        await SharedPrefsModule.putString('privacy_accepted', 'true');
      } catch {
        // Non-fatal — the DB save above is the primary path.
      }
      router.replace('/onboarding');
    } finally {
      setAccepting(false);
    }
  };

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: theme.background }]}>
      {isRevisit && (
        <View style={[styles.topBar, { borderBottomColor: theme.border }]}>
          <TouchableOpacity onPress={() => router.back()} style={styles.backBtn} hitSlop={12}>
            <Ionicons name="arrow-back" size={22} color={theme.text} />
          </TouchableOpacity>
          <Text style={[styles.topTitle, { color: theme.text }]}>Privacy & Terms</Text>
          <View style={{ width: 40 }} />
        </View>
      )}

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {/* Hero */}
        <View style={styles.header}>
          <View style={styles.logoCircle}>
            <Ionicons name="lock-closed" size={34} color="#fff" />
          </View>
          <Text style={[styles.title, { color: theme.text }]}>Privacy & Terms</Text>
          <Text style={[styles.subtitle, { color: theme.muted }]}>
            FocusFlow is designed to keep your data fully on this device. Nothing is sent to any server.
          </Text>
        </View>

        {/* Policy cards */}
        <PolicyCard title="Local-first data" icon="phone-portrait-outline">
          Tasks, schedules, block lists, allowances, and settings are stored in FocusFlow's on-device database and Android preferences only.
        </PolicyCard>

        <PolicyCard title="Android permissions" icon="shield-checkmark-outline">
          FocusFlow asks for special Android access to detect foreground apps, show blocking overlays, keep reminders running, and enforce focus sessions.
        </PolicyCard>

        <PolicyCard title="No message or password collection" icon="eye-off-outline">
          The accessibility service is used only for app-name signals. FocusFlow does not collect passwords, private messages, form entries, or screen recordings.
        </PolicyCard>

        <PolicyCard title="Photos stay private" icon="images-outline">
          If you set a custom block-screen wallpaper, FocusFlow copies that image into app-private storage only. It is never uploaded or shared.
        </PolicyCard>

        <PolicyCard title="Your control" icon="settings-outline">
          You can change permissions in Android Settings at any time. Removing app data deletes all your local FocusFlow data permanently.
        </PolicyCard>

        {/* Divider */}
        <View style={[styles.divider, { backgroundColor: theme.border }]} />

        {/* External links row */}
        <View style={styles.linksRow}>
          <TouchableOpacity
            style={[styles.linkPill, { borderColor: COLORS.primary + '55', backgroundColor: COLORS.primaryLight }]}
            onPress={() => Linking.openURL(PRIVACY_URL)}
            activeOpacity={0.7}
          >
            <Ionicons name="document-text-outline" size={14} color={COLORS.primary} />
            <Text style={styles.linkPillText}>Full Privacy Policy</Text>
            <Ionicons name="open-outline" size={12} color={COLORS.primary} />
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.linkPill, { borderColor: COLORS.primary + '55', backgroundColor: COLORS.primaryLight }]}
            onPress={() => Linking.openURL(TERMS_URL)}
            activeOpacity={0.7}
          >
            <Ionicons name="reader-outline" size={14} color={COLORS.primary} />
            <Text style={styles.linkPillText}>Terms of Service</Text>
            <Ionicons name="open-outline" size={12} color={COLORS.primary} />
          </TouchableOpacity>
        </View>

        {/* Checkbox — required before the accept button is enabled */}
        {!isRevisit && (
          <TouchableOpacity
            style={[styles.checkRow, { backgroundColor: theme.card, borderColor: accepted ? COLORS.primary : theme.border }]}
            onPress={() => setAccepted((v) => !v)}
            activeOpacity={0.8}
          >
            <View style={[styles.checkbox, { borderColor: accepted ? COLORS.primary : theme.border, backgroundColor: accepted ? COLORS.primary : 'transparent' }]}>
              {accepted && <Ionicons name="checkmark" size={14} color="#fff" />}
            </View>
            <Text style={[styles.checkText, { color: theme.textSecondary }]}>
              I have read and agree to the{' '}
              <Text
                style={styles.checkLink}
                onPress={(e) => { e.stopPropagation?.(); Linking.openURL(PRIVACY_URL); }}
              >
                Privacy Policy
              </Text>
              {' '}and{' '}
              <Text
                style={styles.checkLink}
                onPress={(e) => { e.stopPropagation?.(); Linking.openURL(TERMS_URL); }}
              >
                Terms of Service
              </Text>
            </Text>
          </TouchableOpacity>
        )}

        {/* Action button */}
        {isRevisit ? (
          <TouchableOpacity style={styles.backBtnBottom} onPress={() => router.back()} activeOpacity={0.8}>
            <Ionicons name="arrow-back" size={18} color={COLORS.primary} />
            <Text style={styles.backBtnText}>Back to Settings</Text>
          </TouchableOpacity>
        ) : (
          <TouchableOpacity
            style={[styles.acceptBtn, (!accepted || accepting) && styles.acceptBtnDisabled]}
            onPress={handleAccept}
            activeOpacity={0.85}
            disabled={!accepted || accepting}
          >
            {accepting ? (
              <ActivityIndicator color="#fff" size="small" />
            ) : (
              <>
                <Text style={styles.acceptText}>I Understand and Continue</Text>
                <Ionicons name="arrow-forward" size={18} color="#fff" />
              </>
            )}
          </TouchableOpacity>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function PolicyCard({ title, icon, children }: { title: string; icon: keyof typeof Ionicons.glyphMap; children: React.ReactNode }) {
  const { theme } = useTheme();
  return (
    <View style={[styles.card, { backgroundColor: theme.card, borderColor: theme.border }]}>
      <View style={styles.cardHeader}>
        <View style={styles.iconWrap}>
          <Ionicons name={icon} size={18} color={COLORS.primary} />
        </View>
        <Text style={[styles.cardTitle, { color: theme.text }]}>{title}</Text>
      </View>
      <Text style={[styles.cardBody, { color: theme.textSecondary }]}>{children}</Text>
    </View>
  );
}

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
  backBtn: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  topTitle: { fontSize: FONT.md, fontWeight: '700' },
  backBtnBottom: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: SPACING.xs,
    paddingVertical: SPACING.md,
    marginTop: SPACING.sm,
  },
  backBtnText: { color: COLORS.primary, fontSize: FONT.md, fontWeight: '700' },
  content: { padding: SPACING.lg, paddingBottom: 48, gap: SPACING.md },
  header: { alignItems: 'center', paddingVertical: SPACING.xl, gap: SPACING.sm },
  logoCircle: {
    width: 76,
    height: 76,
    borderRadius: 38,
    backgroundColor: COLORS.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: { fontSize: FONT.xxl, fontWeight: '900', textAlign: 'center' },
  subtitle: { fontSize: FONT.sm, lineHeight: 20, textAlign: 'center', maxWidth: 320 },
  card: {
    borderRadius: RADIUS.lg,
    borderWidth: StyleSheet.hairlineWidth,
    padding: SPACING.md,
    gap: SPACING.sm,
  },
  cardHeader: { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm },
  iconWrap: {
    width: 34,
    height: 34,
    borderRadius: RADIUS.md,
    backgroundColor: COLORS.primaryLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardTitle: { flex: 1, fontSize: FONT.md, fontWeight: '800' },
  cardBody: { fontSize: FONT.sm, lineHeight: 21 },
  divider: { height: StyleSheet.hairlineWidth, marginVertical: SPACING.xs },
  linksRow: { flexDirection: 'row', gap: SPACING.sm },
  linkPill: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    paddingVertical: SPACING.sm,
    paddingHorizontal: SPACING.sm,
    borderRadius: RADIUS.md,
    borderWidth: 1,
  },
  linkPillText: { color: COLORS.primary, fontSize: FONT.xs, fontWeight: '700', flex: 1 },
  checkRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: SPACING.sm,
    padding: SPACING.md,
    borderRadius: RADIUS.lg,
    borderWidth: 1.5,
  },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
    marginTop: 1,
  },
  checkText: { flex: 1, fontSize: FONT.sm, lineHeight: 20 },
  checkLink: { color: COLORS.primary, fontWeight: '700', textDecorationLine: 'underline' },
  acceptBtn: {
    marginTop: SPACING.xs,
    backgroundColor: COLORS.primary,
    borderRadius: RADIUS.lg,
    padding: SPACING.md,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: SPACING.sm,
    minHeight: 52,
  },
  acceptBtnDisabled: { opacity: 0.4 },
  acceptText: { color: '#fff', fontSize: FONT.md, fontWeight: '800' },
});
