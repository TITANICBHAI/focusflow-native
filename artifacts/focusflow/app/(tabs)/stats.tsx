import React, { useMemo, useEffect, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import dayjs from 'dayjs';
import { useApp } from '@/context/AppContext';
import { COLORS, FONT, RADIUS, SPACING } from '@/styles/theme';
import {
  dbGetTodayFocusMinutes,
  dbGetTodayOverrideCount,
  dbGetStreak,
  dbRecordDayCompletion,
} from '@/data/database';
import type { Task } from '@/data/types';

export default function StatsScreen() {
  const { state } = useApp();
  const { tasks } = state;

  const [focusMinutes, setFocusMinutes] = useState(0);
  const [overrideCount, setOverrideCount] = useState(0);
  const [streak, setStreak] = useState(0);

  // Load DB-backed stats
  useEffect(() => {
    void (async () => {
      const [fm, oc, s] = await Promise.all([
        dbGetTodayFocusMinutes(),
        dbGetTodayOverrideCount(),
        dbGetStreak(),
      ]);
      setFocusMinutes(fm);
      setOverrideCount(oc);
      setStreak(s);
    })();
  }, []);

  const stats = useMemo(() => {
    const today = dayjs().startOf('day');
    const todayTasks = tasks.filter((t) => dayjs(t.startTime).isAfter(today));

    const completed = todayTasks.filter((t) => t.status === 'completed');
    const skipped = todayTasks.filter((t) => t.status === 'skipped');
    const scheduled = todayTasks.filter((t) => t.status === 'scheduled' || t.status === 'active');

    const totalMinutesScheduled = todayTasks.reduce((s, t) => s + t.durationMinutes, 0);
    const totalMinutesCompleted = completed.reduce((s, t) => s + t.durationMinutes, 0);

    const byPriority = {
      critical: todayTasks.filter((t) => t.priority === 'critical').length,
      high: todayTasks.filter((t) => t.priority === 'high').length,
      medium: todayTasks.filter((t) => t.priority === 'medium').length,
      low: todayTasks.filter((t) => t.priority === 'low').length,
    };

    const completionRate = todayTasks.length > 0
      ? Math.round((completed.length / todayTasks.length) * 100) : 0;

    return {
      total: todayTasks.length,
      completed: completed.length,
      skipped: skipped.length,
      remaining: scheduled.length,
      completionRate,
      totalMinutesScheduled,
      totalMinutesCompleted,
      byPriority,
      focusTasks: todayTasks.filter((t) => t.focusMode).length,
      topTags: getTopTags(todayTasks),
    };
  }, [tasks]);

  // Record daily completion for streak tracking — in useEffect to avoid DB write inside useMemo
  useEffect(() => {
    if (stats.total > 0) {
      void dbRecordDayCompletion(stats.completed, stats.total);
    }
  }, [stats.completed, stats.total]);

  const productivityColor =
    stats.completionRate >= 80 ? COLORS.green
    : stats.completionRate >= 50 ? COLORS.orange
    : COLORS.red;

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <Text style={styles.title}>Today's Stats</Text>
        <Text style={styles.date}>{dayjs().format('MMMM D, YYYY')}</Text>
      </View>

      <ScrollView style={styles.scroll} contentContainerStyle={styles.content}>

        {/* Streak banner */}
        {streak > 0 && (
          <View style={styles.streakBanner}>
            <Text style={styles.streakFire}>🔥</Text>
            <Text style={styles.streakText}>{streak}-day streak! Keep it up.</Text>
          </View>
        )}

        {/* Completion ring */}
        <View style={styles.card}>
          <View style={styles.ringRow}>
            <View style={[styles.ring, { borderColor: productivityColor }]}>
              <Text style={[styles.ringPercent, { color: productivityColor }]}>
                {stats.completionRate}%
              </Text>
              <Text style={styles.ringLabel}>done</Text>
            </View>
            <View style={styles.ringStats}>
              <StatItem icon="checkmark-circle" color={COLORS.green} label="Completed" value={stats.completed} />
              <StatItem icon="play-skip-forward" color={COLORS.muted} label="Skipped" value={stats.skipped} />
              <StatItem icon="time-outline" color={COLORS.blue} label="Remaining" value={stats.remaining} />
            </View>
          </View>
        </View>

        {/* Time */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Time Overview</Text>
          <View style={styles.statsGrid}>
            <StatCard icon="calendar-outline" label="Scheduled" value={fmtMins(stats.totalMinutesScheduled)} color={COLORS.blue} />
            <StatCard icon="checkmark-done-outline" label="Completed" value={fmtMins(stats.totalMinutesCompleted)} color={COLORS.green} />
          </View>
          <View style={styles.progressTrack}>
            <View style={[styles.progressFill, {
              width: stats.totalMinutesScheduled > 0
                ? `${Math.min(100, (stats.totalMinutesCompleted / stats.totalMinutesScheduled) * 100)}%` : '0%',
              backgroundColor: COLORS.green,
            }]} />
          </View>
        </View>

        {/* Focus stats */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Focus Mode</Text>
          <View style={styles.statsGrid}>
            <StatCard icon="shield-checkmark-outline" label="Focus Time" value={fmtMins(focusMinutes)} color={COLORS.primary} />
            <StatCard icon="shield-outline" label="Focus Tasks" value={String(stats.focusTasks)} color={COLORS.blue} />
          </View>
          {overrideCount > 0 && (
            <View style={styles.overrideRow}>
              <Ionicons name="warning-outline" size={14} color={COLORS.orange} />
              <Text style={styles.overrideText}>
                {overrideCount} emergency override{overrideCount !== 1 ? 's' : ''} used today
              </Text>
            </View>
          )}
        </View>

        {/* Priority breakdown */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>By Priority</Text>
          {[
            { label: 'Critical', value: stats.byPriority.critical, color: COLORS.red },
            { label: 'High', value: stats.byPriority.high, color: COLORS.orange },
            { label: 'Medium', value: stats.byPriority.medium, color: COLORS.blue },
            { label: 'Low', value: stats.byPriority.low, color: COLORS.green },
          ].map((p) => (
            <View key={p.label} style={styles.priorityRow}>
              <View style={[styles.priorityDot, { backgroundColor: p.color }]} />
              <Text style={styles.priorityLabel}>{p.label}</Text>
              <View style={styles.priorityBar}>
                <View style={[styles.priorityBarFill, {
                  backgroundColor: p.color,
                  width: stats.total > 0 ? `${Math.round((p.value / stats.total) * 100)}%` : '0%',
                }]} />
              </View>
              <Text style={[styles.priorityValue, { color: p.color }]}>{p.value}</Text>
            </View>
          ))}
        </View>

        {/* Tags */}
        {stats.topTags.length > 0 && (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Top Tags</Text>
            <View style={styles.tagsRow}>
              {stats.topTags.map(({ tag, count }) => (
                <View key={tag} style={styles.tagBadge}>
                  <Text style={styles.tagBadgeText}>#{tag}</Text>
                  <View style={styles.tagCount}>
                    <Text style={styles.tagCountText}>{count}</Text>
                  </View>
                </View>
              ))}
            </View>
          </View>
        )}

        {stats.total === 0 && (
          <View style={styles.emptyState}>
            <Ionicons name="bar-chart-outline" size={48} color={COLORS.border} />
            <Text style={styles.emptyText}>No tasks today yet</Text>
            <Text style={styles.emptySubtext}>Add tasks to see your stats</Text>
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function fmtMins(minutes: number): string {
  if (minutes < 60) return `${minutes}m`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

function StatItem({ icon, color, label, value }: { icon: keyof typeof Ionicons.glyphMap; color: string; label: string; value: number }) {
  return (
    <View style={styles.statItem}>
      <Ionicons name={icon} size={16} color={color} />
      <Text style={styles.statItemLabel}>{label}</Text>
      <Text style={[styles.statItemValue, { color }]}>{value}</Text>
    </View>
  );
}

function StatCard({ icon, label, value, color }: { icon: keyof typeof Ionicons.glyphMap; label: string; value: string; color: string }) {
  return (
    <View style={[styles.statCard, { borderColor: color + '33' }]}>
      <Ionicons name={icon} size={22} color={color} />
      <Text style={[styles.statCardValue, { color }]}>{value}</Text>
      <Text style={styles.statCardLabel}>{label}</Text>
    </View>
  );
}

function getTopTags(tasks: Task[]): { tag: string; count: number }[] {
  const counts: Record<string, number> = {};
  for (const t of tasks) {
    for (const tag of t.tags) {
      counts[tag] = (counts[tag] ?? 0) + 1;
    }
  }
  return Object.entries(counts)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 6)
    .map(([tag, count]) => ({ tag, count }));
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: COLORS.background },
  header: {
    padding: SPACING.lg,
    backgroundColor: COLORS.card,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: COLORS.border,
  },
  title: { fontSize: FONT.xxl, fontWeight: '800', color: COLORS.text },
  date: { fontSize: FONT.sm, color: COLORS.muted, marginTop: 2 },
  scroll: { flex: 1 },
  content: { padding: SPACING.lg, gap: SPACING.md, paddingBottom: 40 },
  streakBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.xs,
    backgroundColor: COLORS.orange + '18',
    borderRadius: RADIUS.lg,
    padding: SPACING.md,
    borderWidth: 1.5,
    borderColor: COLORS.orange + '44',
  },
  streakFire: { fontSize: 22 },
  streakText: { fontSize: FONT.md, fontWeight: '700', color: COLORS.orange },
  card: {
    backgroundColor: COLORS.card,
    borderRadius: RADIUS.lg,
    padding: SPACING.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: COLORS.border,
    gap: SPACING.sm,
  },
  cardTitle: { fontSize: FONT.md, fontWeight: '700', color: COLORS.text, marginBottom: SPACING.xs },
  ringRow: { flexDirection: 'row', alignItems: 'center', gap: SPACING.lg },
  ring: { width: 100, height: 100, borderRadius: 50, borderWidth: 8, alignItems: 'center', justifyContent: 'center' },
  ringPercent: { fontSize: FONT.xl, fontWeight: '800' },
  ringLabel: { fontSize: FONT.xs, color: COLORS.muted },
  ringStats: { flex: 1, gap: SPACING.sm },
  statItem: { flexDirection: 'row', alignItems: 'center', gap: SPACING.xs },
  statItemLabel: { flex: 1, fontSize: FONT.sm, color: COLORS.textSecondary },
  statItemValue: { fontSize: FONT.md, fontWeight: '700' },
  statsGrid: { flexDirection: 'row', gap: SPACING.sm },
  statCard: { flex: 1, alignItems: 'center', padding: SPACING.md, borderRadius: RADIUS.md, borderWidth: 1.5, gap: SPACING.xs },
  statCardValue: { fontSize: FONT.lg, fontWeight: '800' },
  statCardLabel: { fontSize: FONT.xs, color: COLORS.muted },
  progressTrack: { height: 6, backgroundColor: COLORS.border, borderRadius: 3, overflow: 'hidden', marginTop: SPACING.xs },
  progressFill: { height: '100%', borderRadius: 3 },
  overrideRow: { flexDirection: 'row', alignItems: 'center', gap: SPACING.xs, backgroundColor: COLORS.orange + '12', borderRadius: RADIUS.sm, padding: SPACING.xs },
  overrideText: { fontSize: FONT.xs, color: COLORS.orange, fontWeight: '600' },
  priorityRow: { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm, paddingVertical: SPACING.xs },
  priorityDot: { width: 10, height: 10, borderRadius: 5 },
  priorityLabel: { width: 60, fontSize: FONT.sm, color: COLORS.text },
  priorityBar: { flex: 1, height: 6, backgroundColor: COLORS.border, borderRadius: 3, overflow: 'hidden' },
  priorityBarFill: { height: '100%', borderRadius: 3 },
  priorityValue: { fontSize: FONT.md, fontWeight: '700', width: 24, textAlign: 'right' },
  tagsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: SPACING.xs },
  tagBadge: { flexDirection: 'row', alignItems: 'center', backgroundColor: COLORS.primaryLight, borderRadius: RADIUS.full, paddingLeft: SPACING.sm, overflow: 'hidden' },
  tagBadgeText: { fontSize: FONT.sm, color: COLORS.primary, fontWeight: '600', paddingVertical: 4 },
  tagCount: { backgroundColor: COLORS.primary, marginLeft: SPACING.xs, paddingHorizontal: SPACING.xs, paddingVertical: 2 },
  tagCountText: { fontSize: FONT.xs, color: '#fff', fontWeight: '700' },
  emptyState: { alignItems: 'center', paddingTop: 40, gap: SPACING.sm },
  emptyText: { fontSize: FONT.lg, fontWeight: '600', color: COLORS.muted },
  emptySubtext: { fontSize: FONT.sm, color: COLORS.border },
});
