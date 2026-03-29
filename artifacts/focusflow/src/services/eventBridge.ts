/**
 * Event Bridge — JS ↔ Native Real-Time Sync
 *
 * Handles bidirectional events between:
 *   - Native foreground service → JS (task timer ticks, task end, violation detected)
 *   - JS → Native (start/stop service, update task, user actions)
 *
 * Native side emits events via DeviceEventManagerModule.RCTDeviceEventEmitter (Android).
 * This module listens for them on the JS side.
 *
 * Pattern:
 *   - Native fires: "FocusDayEvent" with { type, payload }
 *   - JS handlers registered per-event-type via subscribe()
 */

import { NativeEventEmitter, NativeModules, EmitterSubscription } from 'react-native';

export type NativeEventType =
  | 'TASK_END'          // foreground service: task timer reached zero
  | 'TASK_TICK'         // foreground service: every 30s update
  | 'APP_BLOCKED'       // app blocker: forbidden app was detected
  | 'FOCUS_START'       // native side started focus mode
  | 'FOCUS_STOP'        // native side stopped focus mode
  | 'SERVICE_RESTART'   // foreground service restarted after being killed
  | 'BOOT_COMPLETED'    // device rebooted, schedule needs restoring
  | 'PERMISSION_RESULT' // user responded to a permission prompt
  | 'BATTERY_LOW';      // battery optimization is blocking the service

export interface NativeEvent {
  type: NativeEventType;
  taskId?: string;
  taskName?: string;
  remainingSeconds?: number;
  blockedApp?: string;
  granted?: boolean;
}

type EventHandler = (event: NativeEvent) => void;

class EventBridgeClass {
  private emitter: NativeEventEmitter | null = null;
  private subscription: EmitterSubscription | null = null;
  private handlers = new Map<NativeEventType, Set<EventHandler>>();

  init(): void {
    const bridge = NativeModules.FocusDayBridge;
    if (!bridge) {
      console.warn('[EventBridge] FocusDayBridge native module not found. Running in stub mode.');
      return;
    }

    this.emitter = new NativeEventEmitter(bridge);
    this.subscription = this.emitter.addListener('FocusDayEvent', (event: NativeEvent) => {
      this.dispatch(event);
    });
  }

  subscribe(type: NativeEventType, handler: EventHandler): () => void {
    if (!this.handlers.has(type)) {
      this.handlers.set(type, new Set());
    }
    this.handlers.get(type)!.add(handler);

    return () => {
      this.handlers.get(type)?.delete(handler);
    };
  }

  private dispatch(event: NativeEvent): void {
    const handlers = this.handlers.get(event.type);
    if (!handlers) return;
    handlers.forEach((h) => {
      try {
        h(event);
      } catch (e) {
        console.error('[EventBridge] Handler error for', event.type, e);
      }
    });
  }

  // ── JS → Native calls ──────────────────────────────────────────────────────

  notifyTaskStarted(taskId: string, taskName: string, endTimeMs: number, nextTaskName: string): void {
    try {
      const { ForegroundService } = NativeModules;
      ForegroundService?.startService(taskName, endTimeMs, nextTaskName);
    } catch (e) {
      console.warn('[EventBridge] notifyTaskStarted failed', e);
    }
  }

  notifyTaskEnded(taskId: string): void {
    try {
      const { ForegroundService } = NativeModules;
      ForegroundService?.stopService();
    } catch (e) {
      console.warn('[EventBridge] notifyTaskEnded failed', e);
    }
  }

  updateTimer(taskName: string, endTimeMs: number, nextTaskName: string): void {
    try {
      const { ForegroundService } = NativeModules;
      ForegroundService?.updateNotification(taskName, endTimeMs, nextTaskName);
    } catch (e) {
      console.warn('[EventBridge] updateTimer failed', e);
    }
  }

  destroy(): void {
    this.subscription?.remove();
    this.subscription = null;
    this.handlers.clear();
  }
}

export const EventBridge = new EventBridgeClass();

// ─── React hook for subscribing to native events ──────────────────────────────

import { useEffect } from 'react';

export function useNativeEvent(type: NativeEventType, handler: EventHandler): void {
  useEffect(() => {
    const unsub = EventBridge.subscribe(type, handler);
    return unsub;
  }, [type, handler]);
}
