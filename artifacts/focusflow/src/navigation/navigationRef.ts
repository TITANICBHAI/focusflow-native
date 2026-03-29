import { router } from 'expo-router';

export function navigateToTask(taskId: string) {
  try {
    router.navigate({ pathname: '/(tabs)/', params: { highlightTaskId: taskId } });
  } catch {
  }
}
