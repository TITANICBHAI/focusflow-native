/**
 * app/_layout.tsx
 *
 * expo-router entry layout. Reproduces the module-level setup from App.tsx:
 *   1. Background task definitions
 *   2. Notification foreground handler
 *   3. EventBridge initialisation
 *   4. Splash screen keep-alive
 *   5. Notification response handler
 *   6. Notification action categories
 *   7. React component tree (providers + expo-router Stack)
 */

// ─── 1. Register all background tasks with the OS ────────────────────────────
import '@/tasks/backgroundTasks';

import React, { useEffect } from 'react';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import * as SplashScreen from 'expo-splash-screen';
import * as Notifications from 'expo-notifications';
import { StyleSheet } from 'react-native';

import { AppProvider } from '@/context/AppContext';
import { EventBridge } from '@/services/eventBridge';
import { navigateToTask, consumePendingTaskNavigation } from '@/navigation/navigationRef';
import { registerBackgroundFetch, registerOverrunCheckTask } from '@/tasks/backgroundTasks';

// ─── 2. Foreground notification display behaviour ─────────────────────────────
Notifications.setNotificationHandler({
  handleNotification: async (notification) => {
    const data = notification.request.content.data as { type?: string };
    if (data?.type === 'focus-persistent') {
      return { shouldShowBanner: false, shouldShowList: false, shouldPlaySound: false, shouldSetBadge: false };
    }
    return { shouldShowBanner: true, shouldShowList: true, shouldPlaySound: true, shouldSetBadge: false };
  },
});

// ─── 3. Connect native event channel ─────────────────────────────────────────
EventBridge.init();

// ─── 4. Keep splash visible until app context is ready ───────────────────────
SplashScreen.preventAutoHideAsync();

// ─── 5. Notification response handler (tap or action button) ─────────────────
Notifications.addNotificationResponseReceivedListener((response) => {
  const data = response.notification.request.content.data as {
    taskId?: string;
    type?: string;
  };
  const actionId = response.actionIdentifier;

  if (!data?.taskId) return;

  if (
    actionId === Notifications.DEFAULT_ACTION_IDENTIFIER ||
    actionId === 'VIEW'
  ) {
    navigateToTask(data.taskId);
  }
});

// ─── 6. Foreground notification received listener ────────────────────────────
Notifications.addNotificationReceivedListener((notification) => {
  const data = notification.request.content.data as {
    taskId?: string;
    type?: string;
  };
  if (data?.type === 'LATE_START_WARNING' && data.taskId) {
    // Handled by ScheduleScreen polling
  }
});

// ─── 7. Notification action categories ───────────────────────────────────────
async function setupNotificationCategories() {
  await Notifications.setNotificationCategoryAsync('task-active', [
    {
      identifier: 'COMPLETE',
      buttonTitle: '✅ Complete',
      options: { opensAppToForeground: false },
    },
    {
      identifier: 'EXTEND',
      buttonTitle: '⏱ +15 min',
      options: { opensAppToForeground: false },
    },
    {
      identifier: 'VIEW',
      buttonTitle: '👁 View',
      options: { opensAppToForeground: true },
    },
  ]);

  await Notifications.setNotificationCategoryAsync('task-reminder', [
    {
      identifier: 'VIEW',
      buttonTitle: '👁 Open',
      options: { opensAppToForeground: true },
    },
    {
      identifier: 'COMPLETE',
      buttonTitle: '✅ Done',
      options: { opensAppToForeground: false },
    },
  ]);
}

// ─── React component ──────────────────────────────────────────────────────────

export default function RootLayout() {
  useEffect(() => {
    async function bootstrap() {
      await setupNotificationCategories();
      await registerBackgroundFetch();
      await registerOverrunCheckTask();
      consumePendingTaskNavigation();

      try {
        const { ForegroundServiceModule } = await import('@/native-modules/ForegroundServiceModule');
        await ForegroundServiceModule.requestBatteryOptimizationExemption();
      } catch {
        // Native module not yet linked (dev build without EAS)
      }

      setTimeout(() => SplashScreen.hideAsync().catch(() => {}), 400);
    }

    bootstrap();
  }, []);

  return (
    <GestureHandlerRootView style={styles.root}>
      <SafeAreaProvider>
        <AppProvider>
          <Stack screenOptions={{ headerShown: false }}>
            <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
            <Stack.Screen name="onboarding" options={{ headerShown: false }} />
            <Stack.Screen name="+not-found" />
          </Stack>
          <StatusBar style="auto" />
        </AppProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
});
