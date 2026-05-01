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

type Tab = 'privacy' | 'terms';

export default function PrivacyPolicyScreen() {
  const { state, updateSettings } = useApp();
  const { theme } = useTheme();
  const navigation = useNavigation();
  const isRevisit = navigation.canGoBack();
  const [activeTab, setActiveTab] = useState<Tab>('privacy');
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
      {/* Top bar — only shown when revisiting from settings */}
      {isRevisit && (
        <View style={[styles.topBar, { borderBottomColor: theme.border }]}>
          <TouchableOpacity onPress={() => router.back()} style={styles.backBtn} hitSlop={12}>
            <Ionicons name="arrow-back" size={22} color={theme.text} />
          </TouchableOpacity>
          <Text style={[styles.topTitle, { color: theme.text }]}>Privacy & Terms</Text>
          <View style={{ width: 40 }} />
        </View>
      )}

      {/* Hero */}
      <View style={styles.hero}>
        <View style={styles.logoCircle}>
          <Ionicons name="lock-closed" size={28} color="#fff" />
        </View>
        <Text style={[styles.heroTitle, { color: theme.text }]}>Privacy & Terms</Text>
        <Text style={[styles.heroSub, { color: theme.muted }]}>
          Your data never leaves this device.
        </Text>
      </View>

      {/* Tab bar */}
      <View style={[styles.tabBar, { backgroundColor: theme.surface, borderColor: theme.border }]}>
        <TouchableOpacity
          style={[styles.tab, activeTab === 'privacy' && styles.tabActive]}
          onPress={() => setActiveTab('privacy')}
          activeOpacity={0.8}
        >
          <Ionicons
            name="document-text-outline"
            size={15}
            color={activeTab === 'privacy' ? COLORS.primary : theme.muted}
          />
          <Text style={[styles.tabLabel, activeTab === 'privacy' && styles.tabLabelActive, { color: activeTab === 'privacy' ? COLORS.primary : theme.muted }]}>
            Privacy Policy
          </Text>
        </TouchableOpacity>
        <View style={[styles.tabDivider, { backgroundColor: theme.border }]} />
        <TouchableOpacity
          style={[styles.tab, activeTab === 'terms' && styles.tabActive]}
          onPress={() => setActiveTab('terms')}
          activeOpacity={0.8}
        >
          <Ionicons
            name="reader-outline"
            size={15}
            color={activeTab === 'terms' ? COLORS.primary : theme.muted}
          />
          <Text style={[styles.tabLabel, activeTab === 'terms' && styles.tabLabelActive, { color: activeTab === 'terms' ? COLORS.primary : theme.muted }]}>
            Terms of Service
          </Text>
        </TouchableOpacity>
      </View>

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>

        {activeTab === 'privacy' ? (
          <>
            <PolicyCard title="Local-first data" icon="phone-portrait-outline">
              Tasks, schedules, block lists, allowances, and settings are stored exclusively in FocusFlow's on-device SQLite database and Android SharedPreferences. Nothing is transmitted to any server.
            </PolicyCard>

            <PolicyCard title="Android permissions" icon="shield-checkmark-outline">
              FocusFlow requests special Android access (Accessibility Service, Usage Stats, Draw over Other Apps) strictly to detect the foreground app, show blocking overlays, and keep focus sessions running. These are never used for data collection.
            </PolicyCard>

            <PolicyCard title="No message or password collection" icon="eye-off-outline">
              The Accessibility Service reads only the foreground package name to trigger app blocking. FocusFlow does not capture passwords, messages, form entries, clipboard contents, or screen recordings — ever.
            </PolicyCard>

            <PolicyCard title="Photos stay private" icon="images-outline">
              If you set a custom block-screen wallpaper, FocusFlow copies the image into app-private storage. It is never uploaded, shared, or accessible to other apps.
            </PolicyCard>

            <PolicyCard title="Your control" icon="settings-outline">
              You can revoke any permission in Android Settings at any time. Clearing app data permanently removes all FocusFlow data from the device. No cloud backup exists.
            </PolicyCard>

            <PolicyCard title="Children's privacy" icon="people-outline">
              FocusFlow does not collect personal information and is safe for all ages. No accounts, analytics, or advertising are involved.
            </PolicyCard>

            <PolicyCard title="Policy changes" icon="refresh-outline">
              This Privacy Policy may be updated at any time without prior notice. Continued use of FocusFlow after any change constitutes your acceptance of the revised policy. The current version is always the one in effect.
            </PolicyCard>

            <TouchableOpacity
              style={[styles.fullLinkBtn, { borderColor: COLORS.primary + '44', backgroundColor: COLORS.primaryLight }]}
              onPress={() => Linking.openURL(PRIVACY_URL)}
              activeOpacity={0.7}
            >
              <Ionicons name="open-outline" size={14} color={COLORS.primary} />
              <Text style={styles.fullLinkText}>Read the full Privacy Policy online</Text>
            </TouchableOpacity>
          </>
        ) : (
          <>
            <PolicyCard title="Acceptance of terms" icon="checkmark-circle-outline">
              By using FocusFlow you agree to these Terms of Service. These Terms may be changed at any time without prior notice. Continued use constitutes immediate, irrevocable acceptance of the current Terms.
            </PolicyCard>

            <PolicyCard title="No warranty" icon="warning-outline">
              FocusFlow is provided "AS IS" without any warranty of any kind. We make no guarantee it will function on your device, Android version, or OEM configuration. Blocking relies on Android permissions the OS may revoke at any time, for any reason.
            </PolicyCard>

            <PolicyCard title="Emergency access" icon="medkit-outline">
              FocusFlow attempts to permit emergency calls, but makes NO guarantee that emergency services will be reachable during an active session. Device or OS restrictions may override any permission. Do not rely on FocusFlow in safety-critical situations.
            </PolicyCard>

            <PolicyCard title="Limitation of liability" icon="shield-outline">
              To the maximum extent permitted by law, TBTechs shall not be liable for any damages — including missed emergencies, personal injury, or data loss — arising from use of or inability to use FocusFlow, regardless of cause or legal theory.
            </PolicyCard>

            <PolicyCard title="Accessibility Service disclosure" icon="eye-outline">
              FocusFlow's Accessibility Service is used solely to detect foreground apps and enforce blocking rules you configure. It is not used for any other purpose. This declaration is required by Google Play policy.
            </PolicyCard>

            <TouchableOpacity
              style={[styles.fullLinkBtn, { borderColor: COLORS.primary + '44', backgroundColor: COLORS.primaryLight }]}
              onPress={() => Linking.openURL(TERMS_URL)}
              activeOpacity={0.7}
            >
              <Ionicons name="open-outline" size={14} color={COLORS.primary} />
              <Text style={styles.fullLinkText}>Read the full Terms of Service online</Text>
            </TouchableOpacity>
          </>
        )}

        {/* ── Agreement checkbox + action button — first-time only ── */}
        {!isRevisit && (
          <>
            <View style={[styles.divider, { backgroundColor: theme.border }]} />

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
          </>
        )}

        {isRevisit && (
          <TouchableOpacity style={styles.backBtnBottom} onPress={() => router.back()} activeOpacity={0.8}>
            <Ionicons name="arrow-back" size={18} color={COLORS.primary} />
            <Text style={styles.backBtnText}>Back to Settings</Text>
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
    width: 40, height: 40, alignItems: 'center', justifyContent: 'center',
  },
  topTitle: { fontSize: FONT.md, fontWeight: '700' },
  hero: {
    alignItems: 'center',
    paddingTop: SPACING.lg,
    paddingBottom: SPACING.md,
    gap: 6,
  },
  logoCircle: {
    width: 60, height: 60, borderRadius: 30,
    backgroundColor: COLORS.primary,
    alignItems: 'center', justifyContent: 'center',
  },
  heroTitle: { fontSize: FONT.xl, fontWeight: '900' },
  heroSub: { fontSize: FONT.sm, textAlign: 'center' },
  tabBar: {
    flexDirection: 'row',
    marginHorizontal: SPACING.lg,
    marginBottom: SPACING.sm,
    borderRadius: RADIUS.lg,
    borderWidth: 1,
    overflow: 'hidden',
  },
  tab: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: SPACING.sm + 2,
  },
  tabActive: {
    backgroundColor: COLORS.primaryLight,
  },
  tabDivider: {
    width: StyleSheet.hairlineWidth,
    marginVertical: SPACING.xs,
  },
  tabLabel: { fontSize: FONT.sm, fontWeight: '600' },
  tabLabelActive: { fontWeight: '800' },
  content: { paddingHorizontal: SPACING.lg, paddingBottom: 48, gap: SPACING.md },
  card: {
    borderRadius: RADIUS.lg,
    borderWidth: StyleSheet.hairlineWidth,
    padding: SPACING.md,
    gap: SPACING.sm,
  },
  cardHeader: { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm },
  iconWrap: {
    width: 34, height: 34, borderRadius: RADIUS.md,
    backgroundColor: COLORS.primaryLight,
    alignItems: 'center', justifyContent: 'center',
  },
  cardTitle: { flex: 1, fontSize: FONT.md, fontWeight: '800' },
  cardBody: { fontSize: FONT.sm, lineHeight: 21 },
  fullLinkBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: SPACING.xs,
    paddingVertical: SPACING.sm,
    paddingHorizontal: SPACING.md,
    borderRadius: RADIUS.md,
    borderWidth: 1,
  },
  fullLinkText: { color: COLORS.primary, fontSize: FONT.sm, fontWeight: '700' },
  divider: { height: StyleSheet.hairlineWidth, marginVertical: SPACING.xs },
  checkRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: SPACING.sm,
    padding: SPACING.md,
    borderRadius: RADIUS.lg,
    borderWidth: 1.5,
  },
  checkbox: {
    width: 22, height: 22, borderRadius: 6, borderWidth: 2,
    alignItems: 'center', justifyContent: 'center',
    flexShrink: 0, marginTop: 1,
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
  backBtnBottom: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: SPACING.xs,
    paddingVertical: SPACING.md,
    marginTop: SPACING.sm,
  },
  backBtnText: { color: COLORS.primary, fontSize: FONT.md, fontWeight: '700' },
});
