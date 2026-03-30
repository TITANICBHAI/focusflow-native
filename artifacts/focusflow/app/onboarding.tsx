/**
 * OnboardingScreen
 *
 * Shown only on first launch. Walks the user through granting:
 *   1. Notification permission (Android 13+)
 *   2. Battery optimization exemption (Android)
 *   3. Usage Access (manual Settings step)
 *   4. Accessibility Service (manual Settings step)
 *
 * Once complete, sets settings.onboardingComplete = true → tabs appear.
 */

import React, { useState, useEffect, useRef } from 'react';
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
import { useApp } from '@/context/AppContext';
import { requestPermissions } from '@/services/notificationService';
import { ForegroundServiceModule } from '@/native-modules/ForegroundServiceModule';
import { UsageStatsModule } from '@/native-modules/UsageStatsModule';
import { COLORS, FONT, RADIUS, SPACING } from '@/styles/theme';

type StepStatus = 'pending' | 'granted' | 'skipped' | 'manual';

interface Step {
  id: string;
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  description: string;
  action: 'auto' | 'manual';
  status: StepStatus;
  intentAction?: string;
}

const INITIAL_STEPS: Step[] = [
  {
    id: 'notifications',
    icon: 'notifications-outline',
    title: 'Notifications',
    description: 'Get reminders before tasks start and alerts when time is up.',
    action: 'auto',
    status: 'pending',
  },
  {
    id: 'battery',
    icon: 'battery-charging-outline',
    title: 'Battery Optimization',
    description: 'Exclude FocusDay from battery optimization so reminders fire reliably.',
    action: 'auto',
    status: 'pending',
  },
  {
    id: 'usage',
    icon: 'shield-outline',
    title: 'Usage Access',
    description:
      'Allow FocusDay to detect which app is in the foreground so it can enforce focus mode. Tap to open Settings → Special app access → Usage access → FocusDay → Enable.',
    action: 'manual',
    status: 'pending',
    intentAction: 'android.settings.USAGE_ACCESS_SETTINGS',
  },
  {
    id: 'accessibility',
    icon: 'accessibility-outline',
    title: 'Accessibility Service',
    description:
      'Required for Focus Mode to block distracting apps. Tap to open Settings → Accessibility → Installed apps → FocusDay → Enable.',
    action: 'manual',
    status: 'pending',
    intentAction: 'android.settings.ACCESSIBILITY_SETTINGS',
  },
];

export default function OnboardingScreen() {
  const { state, updateSettings } = useApp();
  const [steps, setSteps] = useState<Step[]>(INITIAL_STEPS);
  const [loading, setLoading] = useState<string | null>(null);
  const appStateRef = useRef(AppState.currentState);

  const setStepStatus = (id: string, status: StepStatus) => {
    setSteps((prev) => prev.map((s) => (s.id === id ? { ...s, status } : s)));
  };

  // When the user returns from Settings, re-check permission statuses
  useEffect(() => {
    const subscription = AppState.addEventListener('change', async (nextState) => {
      if (appStateRef.current.match(/inactive|background/) && nextState === 'active') {
        // Re-check usage access permission via native module
        try {
          const hasUsage = await UsageStatsModule.hasPermission();
          if (hasUsage) {
            setStepStatus('usage', 'granted');
          }
        } catch {
          // Native module not available in dev
        }

        // Accessibility permission cannot be checked programmatically (no native module).
        // Users confirm by tapping the card again after returning from Settings.
      }
      appStateRef.current = nextState;
    });
    return () => subscription.remove();
  }, []);

  const handleStep = async (step: Step) => {
    if (step.status === 'granted') return;

    if (step.action === 'manual') {
      if (step.status === 'manual') {
        // User has returned from Settings — try to verify via native module first
        if (step.id === 'usage') {
          setLoading(step.id);
          try {
            const hasUsage = await UsageStatsModule.hasPermission();
            setStepStatus(step.id, hasUsage ? 'granted' : 'pending');
          } catch {
            // Native module not available — let user confirm manually
            setStepStatus(step.id, 'granted');
          } finally {
            setLoading(null);
          }
          return;
        }
        // For accessibility and other manual steps without a native check,
        // accept the user's tap as confirmation they granted the permission.
        setStepStatus(step.id, 'granted');
        return;
      }
      setStepStatus(step.id, 'manual');
      // Open the correct Android settings screen
      if (Platform.OS === 'android') {
        try {
          if (step.id === 'accessibility') {
            // Use native module with OEM fallback chain instead of Linking.sendIntent
            await UsageStatsModule.openAccessibilitySettings();
          } else if (step.intentAction) {
            await Linking.sendIntent(step.intentAction);
          }
        } catch {
          // Fallback to app settings if intent not available
          try {
            await Linking.openSettings();
          } catch {
            // ignore
          }
        }
      }
      return;
    }

    setLoading(step.id);
    try {
      if (step.id === 'notifications') {
        const granted = await requestPermissions();
        setStepStatus(step.id, granted ? 'granted' : 'skipped');
      } else if (step.id === 'battery') {
        await ForegroundServiceModule.requestBatteryOptimizationExemption();
        setStepStatus(step.id, 'granted');
      }
    } catch {
      setStepStatus(step.id, 'skipped');
    } finally {
      setLoading(null);
    }
  };

  const allActionableGranted = steps
    .filter((s) => s.action === 'auto')
    .every((s) => s.status === 'granted' || s.status === 'skipped');

  const handleFinish = async () => {
    await updateSettings({ ...state.settings, onboardingComplete: true });
  };

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.scroll}>
        {/* Header */}
        <View style={styles.header}>
          <View style={styles.logoCircle}>
            <Ionicons name="shield-checkmark" size={36} color="#fff" />
          </View>
          <Text style={styles.appName}>FocusDay</Text>
          <Text style={styles.tagline}>Your discipline operating system</Text>
        </View>

        <Text style={styles.sectionLabel}>GRANT PERMISSIONS</Text>

        {steps.map((step) => (
          <TouchableOpacity
            key={step.id}
            style={[
              styles.stepCard,
              step.status === 'granted' && styles.stepGranted,
              step.status === 'manual' && styles.stepManual,
            ]}
            onPress={() => handleStep(step)}
            activeOpacity={step.status === 'granted' ? 1 : 0.75}
          >
            <View style={[styles.stepIconWrap, step.status === 'granted' && styles.stepIconGranted]}>
              {step.status === 'granted' ? (
                <Ionicons name="checkmark" size={20} color="#fff" />
              ) : loading === step.id ? (
                <ActivityIndicator size="small" color={COLORS.primary} />
              ) : (
                <Ionicons name={step.icon} size={20} color={COLORS.primary} />
              )}
            </View>

            <View style={styles.stepText}>
              <Text style={styles.stepTitle}>{step.title}</Text>
              <Text style={styles.stepDesc}>{step.description}</Text>
              {step.status === 'manual' && (
                <Text style={styles.manualNote}>
                  Settings opened — grant the permission, then tap here to confirm.
                </Text>
              )}
            </View>

            {step.status !== 'granted' && step.action === 'auto' && (
              <Ionicons name="chevron-forward" size={18} color={COLORS.muted} />
            )}
            {step.status !== 'granted' && step.action === 'manual' && (
              <Ionicons name="open-outline" size={18} color={COLORS.muted} />
            )}
          </TouchableOpacity>
        ))}

        {/* Done button */}
        <TouchableOpacity
          style={[styles.doneBtn, !allActionableGranted && styles.doneBtnDim]}
          onPress={handleFinish}
        >
          <Text style={styles.doneBtnText}>
            {allActionableGranted ? 'Get Started →' : 'Skip & Continue →'}
          </Text>
        </TouchableOpacity>

        <Text style={styles.footerNote}>
          You can adjust all permissions later in Settings.
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: COLORS.background },
  scroll: { padding: SPACING.lg, paddingBottom: 48, gap: SPACING.md },
  header: { alignItems: 'center', paddingVertical: SPACING.xl, gap: SPACING.sm },
  logoCircle: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: COLORS.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  appName: { fontSize: FONT.xxl + 4, fontWeight: '900', color: COLORS.text, letterSpacing: -1 },
  tagline: { fontSize: FONT.sm, color: COLORS.muted, textAlign: 'center' },
  sectionLabel: { fontSize: FONT.xs, fontWeight: '700', color: COLORS.muted, letterSpacing: 1 },
  stepCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: COLORS.card,
    borderRadius: RADIUS.lg,
    padding: SPACING.md,
    gap: SPACING.md,
    borderWidth: 1.5,
    borderColor: COLORS.border,
  },
  stepGranted: { borderColor: COLORS.green + '66', backgroundColor: COLORS.green + '08' },
  stepManual: { borderColor: COLORS.orange + '66', backgroundColor: COLORS.orange + '08' },
  stepIconWrap: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: COLORS.primaryLight,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  stepIconGranted: { backgroundColor: COLORS.green },
  stepText: { flex: 1, gap: 4 },
  stepTitle: { fontSize: FONT.md, fontWeight: '700', color: COLORS.text },
  stepDesc: { fontSize: FONT.sm, color: COLORS.textSecondary, lineHeight: 18 },
  manualNote: { fontSize: FONT.xs, color: COLORS.orange, fontWeight: '600', marginTop: 4 },
  doneBtn: {
    backgroundColor: COLORS.primary,
    borderRadius: RADIUS.lg,
    padding: SPACING.md,
    alignItems: 'center',
    marginTop: SPACING.sm,
  },
  doneBtnDim: { backgroundColor: COLORS.primaryLight },
  doneBtnText: { fontSize: FONT.md, fontWeight: '800', color: '#fff' },
  footerNote: { fontSize: FONT.xs, color: COLORS.muted, textAlign: 'center' },
});
