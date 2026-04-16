import React from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useTheme } from '@/hooks/useTheme';
import { COLORS, FONT, RADIUS, SPACING } from '@/styles/theme';

export default function TermsOfServiceScreen() {
  const { theme } = useTheme();

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: theme.background }]}>
      <View style={[styles.topBar, { borderBottomColor: theme.border }]}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn} hitSlop={12}>
          <Ionicons name="arrow-back" size={22} color={theme.text} />
        </TouchableOpacity>
        <Text style={[styles.topTitle, { color: theme.text }]}>Terms of Service</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.header}>
          <View style={styles.logoCircle}>
            <Ionicons name="document-text" size={34} color="#fff" />
          </View>
          <Text style={[styles.title, { color: theme.text }]}>Terms of Service</Text>
          <Text style={[styles.subtitle, { color: theme.muted }]}>
            Last updated: April 2026
          </Text>
        </View>

        <TosSection title="1. Acceptance">
          By installing or using FocusFlow, you agree to these Terms of Service. If you do not agree, please uninstall the app. These terms apply to all features of the app including focus sessions, app blocking, and keyword filtering.
        </TosSection>

        <TosSection title="2. What FocusFlow Does">
          FocusFlow is a productivity tool that uses Android Accessibility Services, Usage Stats, and System Overlay permissions to enforce self-imposed focus sessions and app restrictions. All enforcement is performed locally on your device.
        </TosSection>

        <TosSection title="3. Your Responsibility">
          You are solely responsible for configuring and activating blocking sessions. FocusFlow enforces the rules you set. We are not liable for missed communications, alarms, or events that occur because a blocking session was active.
        </TosSection>

        <TosSection title="4. Emergency Access">
          Phone calls, emergency dialers, and WhatsApp are always permitted regardless of any active blocking session. FocusFlow is not intended to prevent access to emergency services.
        </TosSection>

        <TosSection title="5. No Data Collection">
          FocusFlow does not collect, transmit, or share any personal data, usage statistics, or behavioral information. All app data is stored locally on your device and never leaves it.
        </TosSection>

        <TosSection title="6. Accessibility Service">
          FocusFlow uses Android's Accessibility Service solely to detect which app is in the foreground and enforce blocking rules you have configured. It does not read passwords, private messages, or any user input beyond what is necessary for keyword blocking you explicitly configure.
        </TosSection>

        <TosSection title="7. No Warranty">
          FocusFlow is provided "as is" without any warranty of any kind. We do not guarantee uninterrupted service or that the app will function correctly on all devices, OS versions, or OEM configurations. Certain device manufacturers or Android versions may limit the app's ability to enforce blocking.
        </TosSection>

        <TosSection title="8. Limitation of Liability">
          To the maximum extent permitted by law, FocusFlow and its developers shall not be liable for any indirect, incidental, special, or consequential damages resulting from your use of or inability to use the app.
        </TosSection>

        <TosSection title="9. Changes to Terms">
          These terms may be updated from time to time. Continued use of FocusFlow after changes constitutes acceptance of the updated terms. The "Last updated" date above will reflect the most recent revision.
        </TosSection>

        <TosSection title="10. Contact">
          For questions about these terms, reach out via the app's GitHub page or through the Play Store listing contact details.
        </TosSection>

        <TouchableOpacity
          style={styles.backBtnBottom}
          onPress={() => router.back()}
          activeOpacity={0.8}
        >
          <Ionicons name="arrow-back" size={18} color={COLORS.primary} />
          <Text style={styles.backBtnText}>Back to Settings</Text>
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}

function TosSection({ title, children }: { title: string; children: React.ReactNode }) {
  const { theme } = useTheme();
  return (
    <View style={[styles.section, { backgroundColor: theme.card, borderColor: theme.border }]}>
      <Text style={[styles.sectionTitle, { color: theme.text }]}>{title}</Text>
      <Text style={[styles.sectionBody, { color: theme.textSecondary }]}>{children}</Text>
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
  topTitle: {
    fontSize: FONT.md,
    fontWeight: '700',
  },
  content: {
    padding: SPACING.lg,
    paddingBottom: 48,
    gap: SPACING.md,
  },
  header: {
    alignItems: 'center',
    paddingVertical: SPACING.xl,
    gap: SPACING.sm,
  },
  logoCircle: {
    width: 76,
    height: 76,
    borderRadius: 38,
    backgroundColor: COLORS.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    fontSize: FONT.xxl,
    fontWeight: '900',
    textAlign: 'center',
  },
  subtitle: {
    fontSize: FONT.sm,
    textAlign: 'center',
  },
  section: {
    borderRadius: RADIUS.lg,
    borderWidth: StyleSheet.hairlineWidth,
    padding: SPACING.md,
    gap: SPACING.xs,
  },
  sectionTitle: {
    fontSize: FONT.md,
    fontWeight: '800',
  },
  sectionBody: {
    fontSize: FONT.sm,
    lineHeight: 21,
  },
  backBtnBottom: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: SPACING.xs,
    paddingVertical: SPACING.md,
    marginTop: SPACING.sm,
  },
  backBtnText: {
    color: COLORS.primary,
    fontSize: FONT.md,
    fontWeight: '700',
  },
});
