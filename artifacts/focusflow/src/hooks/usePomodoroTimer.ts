/**
 * Pomodoro Timer Hook
 *
 * Cycles between work sessions and breaks.
 * Each "work" interval fires a notification when it ends,
 * then starts a break, and vice versa.
 */
import { useState, useEffect, useRef, useCallback } from 'react';
import * as Notifications from 'expo-notifications';

export type PomodoroPhase = 'work' | 'break' | 'idle';

export interface PomodoroState {
  phase: PomodoroPhase;
  remaining: number; // seconds
  round: number;
  isRunning: boolean;
}

export function usePomodoroTimer(workMinutes: number, breakMinutes: number) {
  const [state, setState] = useState<PomodoroState>({
    phase: 'idle',
    remaining: workMinutes * 60,
    round: 1,
    isRunning: false,
  });

  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const stateRef = useRef(state);
  stateRef.current = state;

  const tick = useCallback(() => {
    setState((prev) => {
      if (prev.remaining <= 1) {
        // Phase complete
        if (prev.phase === 'work') {
          void Notifications.scheduleNotificationAsync({
            identifier: 'pomodoro-break',
            content: { title: '🍅 Pomodoro Done!', body: 'Take a break. You earned it!', sound: 'default' },
            trigger: null,
          });
          return { ...prev, phase: 'break', remaining: breakMinutes * 60 };
        } else {
          void Notifications.scheduleNotificationAsync({
            identifier: 'pomodoro-work',
            content: { title: '🎯 Break Over!', body: 'Time to focus again.', sound: 'default' },
            trigger: null,
          });
          return { ...prev, phase: 'work', remaining: workMinutes * 60, round: prev.round + 1 };
        }
      }
      return { ...prev, remaining: prev.remaining - 1 };
    });
  }, [workMinutes, breakMinutes]);

  const start = useCallback(() => {
    setState((prev) => ({
      ...prev,
      phase: prev.phase === 'idle' ? 'work' : prev.phase,
      remaining: prev.phase === 'idle' ? workMinutes * 60 : prev.remaining,
      isRunning: true,
    }));
  }, [workMinutes]);

  const pause = useCallback(() => {
    setState((prev) => ({ ...prev, isRunning: false }));
  }, []);

  const reset = useCallback(() => {
    setState({ phase: 'idle', remaining: workMinutes * 60, round: 1, isRunning: false });
  }, [workMinutes]);

  useEffect(() => {
    if (state.isRunning) {
      intervalRef.current = setInterval(tick, 1000);
    } else {
      if (intervalRef.current) clearInterval(intervalRef.current);
    }
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [state.isRunning, tick]);

  const formatRemaining = () => {
    const m = Math.floor(state.remaining / 60);
    const s = state.remaining % 60;
    return `${m}:${s.toString().padStart(2, '0')}`;
  };

  return { state, start, pause, reset, formatRemaining };
}
