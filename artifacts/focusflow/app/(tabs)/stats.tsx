import React, { useMemo, useEffect, useState, useCallback } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import dayjs from 'dayjs';
import { useApp } from '@/context/AppContext';
import { COLORS, FONT, RADIUS, SPACING } from '@/styles/theme';
import { useTheme } from '@/hooks/useTheme';
import {
  dbGetTodayFocusMinutes,
  dbGetTodayOverrideCount,
  dbGetStreak,
  dbRecordDayCompletion,
} from '@/data/database';
import { GreyoutModule, TemptationEntry } from '@/native-modules/GreyoutModule';
import type { Task } from '@/data/types';

type Filter = 'today' | 'week';

interface AppStat { pkg: string; appName: string; count: number }
interface DayStat { day: string; date: string; count: number }

export default function StatsScreen() {
  const insets = useSafeAreaInsets();
  const { state } = useApp();
  const { theme } = useTheme();
  const { tasks } = state;

  const [filter, setFilter] = useState<Filter>('today');

  // ── Today state ──────────────────────────────────────────────────────────
  const [focusMinutes, setFocusMinutes] = useState(0);
  const [overrideCount, setOverrideCount] = useState(0);
  const [streak, setStreak] = useState(0);

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

  const todayStats = useMemo(() => {
    const today = dayjs().startOf('day');
    const todayTasks = tasks.filter((t) => dayjs(t.startTime).isAfter(today));
    const completed = todayTasks.filter((t) => t.status === 'completed');
    const skipped = todayTasks.filter((t) => t.status === 'skipped');
    const overdue = todayTasks.filter((t) => t.status === 'overdue');
    const scheduled = todayTasks.filter((t) => t.status === 'scheduled' || t.status === 'active');
    const totalMinutesScheduled = todayTasks.reduce((s, t) => s + t.durationMinutes, 0);
    const totalMinutesCompleted = completed.reduce((s, t) => s + t.durationMinutes, 0);
    const completionRate = todayTasks.length > 0
      ? Math.round((completed.length / todayTasks.length) * 100) : 0;
    return {
      total: todayTasks.length,
      completed: completed.length,
      skipped: skipped.length,
      overdue: overdue.length,
      remaining: scheduled.length,
      completionRate,
      totalMinutesScheduled,
      totalMinutesCompleted,
      byPriority: {
        critical: todayTasks.filter((t) => t.priority === 'critical').length,
        high: todayTasks.filter((t) => t.priority === 'high').length,
        medium: todayTasks.filter((t) => t.priority === 'medium').length,
        low: todayTasks.filter((t) => t.priority === 'low').length,
      },
      focusTasks: todayTasks.filter((t) => t.focusMode).length,
      topTags: getTopTags(todayTasks),
    };
  }, [tasks]);

  useEffect(() => {
    if (todayStats.total > 0) {
      void dbRecordDayCompletion(todayStats.completed, todayStats.total);
    }
  }, [todayStats.completed, todayStats.total]);

  const productivityColor =
    todayStats.completionRate >= 80 ? COLORS.green
    : todayStats.completionRate >= 50 ? COLORS.orange
    : COLORS.red;

  // ── Weekly report state ──────────────────────────────────────────────────
  const [weekLoading, setWeekLoading] = useState(false);
  const [appStats, setAppStats] = useState<AppStat[]>([]);
  const [dayStats, setDayStats] = useState<DayStat[]>([]);
  const [totalThisWeek, setTotalThisWeek] = useState(0);
  const [totalAllTime, setTotalAllTime] = useState(0);
  const [cleanStreak, setCleanStreak] = useState(0);

  const loadWeekly = useCallback(async () => {
    setWeekLoading(true);
    try {
      const log = await GreyoutModule.getTemptationLog();
      processWeeklyData(log);
    } catch {
      processWeeklyData([]);
    } finally {
      setWeekLoading(false);
    }
  }, []);

  useEffect(() => {
    if (filter === 'week') void loadWeekly();
  }, [filter, loadWeekly]);

  function processWeeklyData(log: TemptationEntry[]) {
    const weekCutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
    const thisWeek = log.filter((e) => e.timestamp >= weekCutoff);
    setTotalThisWeek(thisWeek.length);
    setTotalAllTime(log.length);

    const appMap = new Map<string, AppStat>();
    for (const e of thisWeek) {
      const existing = appMap.get(e.pkg);
      if (existing) existing.count++;
      else appMap.set(e.pkg, { pkg: e.pkg, appName: e.appName || e.pkg, count: 1 });
    }
    setAppStats(Array.from(appMap.values()).sort((a, b) => b.count - a.count));

    const days: DayStat[] = [];
    for (let i = 6; i >= 0; i--) {
      const d = dayjs().subtract(i, 'day');
      const dayStart = d.startOf('day').valueOf();
      const dayEnd = d.endOf('day').valueOf();
      const count = log.filter((e) => e.timestamp >= dayStart && e.timestamp <= dayEnd).length;
      days.push({ day: d.format('ddd'), date: d.format('MMM D'), count });
    }
    setDayStats(days);

    let cStreak = 0;
    for (let i = days.length - 1; i >= 0; i--) {
      if (days[i].count === 0) cStreak++;
      else break;
    }
    setCleanStreak(cStreak);
  }

  const handleClearLog = () => {
    Alert.alert('Clear Log', 'Permanently delete all temptation log data?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Clear All',
        style: 'destructive',
        onPress: async () => {
          await GreyoutModule.clearTemptationLog();
          await loadWeekly();
        },
      },
    ]);
  };

  const maxDay = Math.max(...dayStats.map((d) => d.count), 1);
  const maxApp = appStats[0]?.count ?? 1;

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: theme.background }]} edges={['top']}>
      {/* Header */}
      <View style={[styles.header, { backgroundColor: theme.card, borderBottomColor: theme.border }]}>
        <View>
          <Text style={[styles.title, { color: theme.text }]}>Stats</Text>
          <Text style={[styles.date, { color: theme.textSecondary }]}>
            {filter === 'today'
              ? dayjs().format('MMMM D, YYYY')
              : `${dayjs().subtract(6, 'day').format('MMM D')} – ${dayjs().format('MMM D')}`}
          </Text>
        </View>
        {filter === 'week' && (
          <TouchableOpacity
            onPress={handleClearLog}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            style={[styles.clearBtn, { backgroundColor: COLORS.red + '15' }]}
          >
            <Ionicons name="trash-outline" size={17} color={COLORS.red} />
          </TouchableOpacity>
        )}
      </View>

      {/* Filter toggle */}
      <View style={[styles.filterRow, { backgroundColor: theme.card, borderBottomColor: theme.border }]}>
        <TouchableOpacity
          style={[styles.filterBtn, filter === 'today' && { backgroundColor: COLORS.primary }]}
          onPress={() => setFilter('today')}
        >
          <Text style={[styles.filterLabel, { color: filter === 'today' ? '#fff' : theme.textSecondary }]}>
            Today
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.filterBtn, filter === 'week' && { backgroundColor: COLORS.primary }]}
          onPress={() => setFilter('week')}
        >
          <Text style={[styles.filterLabel, { color: filter === 'week' ? '#fff' : theme.textSecondary }]}>
            This Week
          </Text>
        </TouchableOpacity>
      </View>

      {/* ── TODAY VIEW ─────────────────────────────────────────────────────── */}
      {filter === 'today' && (
        <ScrollView style={styles.scroll} contentContainerStyle={[styles.content, { paddingBottom: 60 + insets.bottom + 20 }]}>

          {streak > 0 && (
            <View style={styles.streakBanner}>
              <Text style={styles.streakFire}>🔥</Text>
              <Text style={styles.streakText}>{streak}-day streak! Keep it up.</Text>
            </View>
          )}

          <View style={[styles.card, { backgroundColor: theme.card }]}>
            <View style={styles.ringRow}>
              <View style={[styles.ring, { borderColor: productivityColor }]}>
                <Text style={[styles.ringPercent, { color: productivityColor }]}>{todayStats.completionRate}%</Text>
                <Text style={[styles.ringLabel, { color: theme.textSecondary }]}>done</Text>
              </View>
              <View style={styles.ringStats}>
                <StatItem icon="checkmark-circle" color={COLORS.green} label="Completed" value={todayStats.completed} />
                <StatItem icon="play-skip-forward" color={COLORS.muted} label="Skipped" value={todayStats.skipped} />
                <StatItem icon="time-outline" color={COLORS.blue} label="Remaining" value={todayStats.remaining} />
                {todayStats.overdue > 0 && (
                  <StatItem icon="alert-circle" color={COLORS.red} label="Overdue" value={todayStats.overdue} />
                )}
              </View>
            </View>
          </View>

          <View style={[styles.card, { backgroundColor: theme.card }]}>
            <Text style={[styles.cardTitle, { color: theme.text }]}>Time Overview</Text>
            <View style={styles.statsGrid}>
              <StatCard icon="calendar-outline" label="Scheduled" value={fmtMins(todayStats.totalMinutesScheduled)} color={COLORS.blue} />
              <StatCard icon="checkmark-done-outline" label="Completed" value={fmtMins(todayStats.totalMinutesCompleted)} color={COLORS.green} />
            </View>
            <View style={[styles.progressTrack, { backgroundColor: theme.border }]}>
              <View style={[styles.progressFill, {
                width: todayStats.totalMinutesScheduled > 0
                  ? `${Math.min(100, (todayStats.totalMinutesCompleted / todayStats.totalMinutesScheduled) * 100)}%` : '0%',
                backgroundColor: COLORS.green,
              }]} />
            </View>
          </View>

          <View style={[styles.card, { backgroundColor: theme.card }]}>
            <Text style={[styles.cardTitle, { color: theme.text }]}>Focus Mode</Text>
            <View style={styles.statsGrid}>
              <StatCard icon="shield-checkmark-outline" label="Focus Time" value={fmtMins(focusMinutes)} color={COLORS.primary} />
              <StatCard icon="shield-outline" label="Focus Tasks" value={String(todayStats.focusTasks)} color={COLORS.blue} />
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

          <View style={[styles.card, { backgroundColor: theme.card }]}>
            <Text style={[styles.cardTitle, { color: theme.text }]}>By Priority</Text>
            {[
              { label: 'Critical', value: todayStats.byPriority.critical, color: COLORS.red },
              { label: 'High', value: todayStats.byPriority.high, color: COLORS.orange },
              { label: 'Medium', value: todayStats.byPriority.medium, color: COLORS.blue },
              { label: 'Low', value: todayStats.byPriority.low, color: COLORS.green },
            ].map((p) => (
              <View key={p.label} style={styles.priorityRow}>
                <View style={[styles.priorityDot, { backgroundColor: p.color }]} />
                <Text style={[styles.priorityLabel, { color: theme.text }]}>{p.label}</Text>
                <View style={[styles.priorityBar, { backgroundColor: theme.border }]}>
                  <View style={[styles.priorityBarFill, {
                    backgroundColor: p.color,
                    width: todayStats.total > 0 ? `${Math.round((p.value / todayStats.total) * 100)}%` : '0%',
                  }]} />
                </View>
                <Text style={[styles.priorityValue, { color: p.color }]}>{p.value}</Text>
              </View>
            ))}
          </View>

          {todayStats.topTags.length > 0 && (
            <View style={[styles.card, { backgroundColor: theme.card }]}>
              <Text style={[styles.cardTitle, { color: theme.text }]}>Top Tags</Text>
              <View style={styles.tagsRow}>
                {todayStats.topTags.map(({ tag, count }) => (
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

          {todayStats.total === 0 && (
            <View style={styles.emptyState}>
              <Ionicons name="bar-chart-outline" size={48} color={theme.border} />
              <Text style={[styles.emptyText, { color: theme.muted }]}>No tasks today yet</Text>
              <Text style={[styles.emptySubtext, { color: theme.muted }]}>Add tasks to see your stats</Text>
            </View>
          )}
        </ScrollView>
      )}

      {/* ── THIS WEEK VIEW ──────────────────────────────────────────────────── */}
      {filter === 'week' && (
        weekLoading ? (
          <View style={styles.center}>
            <ActivityIndicator size="large" color={COLORS.primary} />
          </View>
        ) : (
          <ScrollView style={styles.scroll} contentContainerStyle={[styles.content, { paddingBottom: 60 + insets.bottom + 20 }]} showsVerticalScrollIndicator={false}>

            <View style={styles.statsGrid}>
              <WeekCard theme={theme} icon="shield-checkmark" color={totalThisWeek === 0 ? COLORS.green : COLORS.orange} label="This Week" value={String(totalThisWeek)} sub="blocked attempts" />
              <WeekCard theme={theme} icon="flame" color={cleanStreak > 0 ? COLORS.green : COLORS.muted} label="Clean Streak" value={`${cleanStreak}d`} sub={cleanStreak === 0 ? 'no clean days' : 'no temptations'} />
            </View>
            <View style={styles.statsGrid}>
              <WeekCard theme={theme} icon="time-outline" color={COLORS.purple} label="All Time" value={String(totalAllTime)} sub="total blocks logged" />
              <WeekCard theme={theme} icon="apps-outline" color={COLORS.blue} label="Apps Tempted" value={String(appStats.length)} sub="unique apps" />
            </View>

            <Text style={[styles.sectionLabel, { color: theme.muted }]}>LAST 7 DAYS</Text>
            <View style={[styles.card, { backgroundColor: theme.card }]}>
              <View style={styles.barChart}>
                {dayStats.map((d, i) => {
                  const isToday = i === dayStats.length - 1;
                  const barPct = d.count === 0 ? 0 : Math.max(0.06, d.count / maxDay);
                  const barColor = d.count === 0 ? COLORS.green : isToday ? COLORS.primary : COLORS.orange;
                  return (
                    <View key={d.date} style={styles.barCol}>
                      <Text style={[styles.barCount, { color: d.count === 0 ? COLORS.green : theme.text }]}>
                        {d.count === 0 ? '✓' : d.count}
                      </Text>
                      <View style={styles.barTrack}>
                        <View style={[styles.barFill, { height: `${barPct * 100}%`, backgroundColor: barColor }]} />
                      </View>
                      <Text style={[styles.barDay, { color: isToday ? COLORS.primary : theme.muted, fontWeight: isToday ? '700' : '500' }]}>
                        {d.day}
                      </Text>
                    </View>
                  );
                })}
              </View>
            </View>

            <Text style={[styles.sectionLabel, { color: theme.muted }]}>MOST TEMPTING APPS</Text>
            <View style={[styles.card, { backgroundColor: theme.card }]}>
              {appStats.length === 0 ? (
                <View style={styles.emptyState}>
                  <Ionicons name="shield-checkmark" size={44} color={COLORS.green} />
                  <Text style={[styles.emptyText, { color: theme.text }]}>You resisted everything this week!</Text>
                  <Text style={[styles.emptySubtext, { color: theme.muted }]}>Data appears here when the blocker intercepts an app.</Text>
                </View>
              ) : (
                appStats.slice(0, 8).map((a, i) => (
                  <View key={a.pkg} style={[styles.appRow, { borderBottomColor: theme.border }]}>
                    <View style={[styles.rankBadge, { backgroundColor: i === 0 ? COLORS.redLight : theme.surface }]}>
                      <Text style={[styles.rankText, { color: i === 0 ? COLORS.red : theme.muted }]}>#{i + 1}</Text>
                    </View>
                    <View style={styles.appInfo}>
                      <Text style={[styles.appName, { color: theme.text }]} numberOfLines={1}>{a.appName}</Text>
                      <View style={[styles.progressTrack, { backgroundColor: theme.border }]}>
                        <View style={[styles.progressFill, { width: `${(a.count / maxApp) * 100}%`, backgroundColor: i === 0 ? COLORS.red : COLORS.orange }]} />
                      </View>
                    </View>
                    <View style={[styles.countBadge, { backgroundColor: i === 0 ? COLORS.redLight : theme.surface }]}>
                      <Text style={[styles.countText, { color: i === 0 ? COLORS.red : theme.text }]}>{a.count}×</Text>
                    </View>
                  </View>
                ))
              )}
            </View>

          </ScrollView>
        )
      )}
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
  const { theme } = useTheme();
  return (
    <View style={styles.statItem}>
      <Ionicons name={icon} size={16} color={color} />
      <Text style={[styles.statItemLabel, { color: theme.textSecondary }]}>{label}</Text>
      <Text style={[styles.statItemValue, { color }]}>{value}</Text>
    </View>
  );
}

function StatCard({ icon, label, value, color }: { icon: keyof typeof Ionicons.glyphMap; label: string; value: string; color: string }) {
  const { theme } = useTheme();
  return (
    <View style={[styles.statCard, { borderColor: color + '33' }]}>
      <Ionicons name={icon} size={22} color={color} />
      <Text style={[styles.statCardValue, { color }]}>{value}</Text>
      <Text style={[styles.statCardLabel, { color: theme.muted }]}>{label}</Text>
    </View>
  );
}

function WeekCard({ theme, icon, color, label, value, sub }: { theme: any; icon: any; color: string; label: string; value: string; sub: string }) {
  return (
    <View style={[styles.weekCard, { backgroundColor: theme.card, borderColor: theme.border }]}>
      <Ionicons name={icon} size={22} color={color} />
      <Text style={[styles.weekCardValue, { color: theme.text }]}>{value}</Text>
      <Text style={[styles.weekCardLabel, { color }]}>{label}</Text>
      <Text style={[styles.weekCardSub, { color: theme.muted }]}>{sub}</Text>
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
  return Object.entries(counts).sort(([, a], [, b]) => b - a).slice(0, 6).map(([tag, count]) => ({ tag, count }));
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: SPACING.lg,
    paddingVertical: SPACING.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  title: { fontSize: FONT.xxl, fontWeight: '800' },
  date: { fontSize: FONT.sm, marginTop: 2 },
  clearBtn: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  filterRow: {
    flexDirection: 'row',
    padding: SPACING.xs,
    gap: SPACING.xs,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  filterBtn: {
    flex: 1,
    paddingVertical: SPACING.sm,
    borderRadius: RADIUS.md,
    alignItems: 'center',
  },
  filterLabel: { fontSize: FONT.sm, fontWeight: '700' },
  scroll: { flex: 1 },
  content: { padding: SPACING.md, gap: SPACING.md },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
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
    borderRadius: RADIUS.lg,
    padding: SPACING.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: COLORS.border,
    gap: SPACING.sm,
  },
  cardTitle: { fontSize: FONT.md, fontWeight: '700', marginBottom: SPACING.xs },
  ringRow: { flexDirection: 'row', alignItems: 'center', gap: SPACING.lg },
  ring: { width: 100, height: 100, borderRadius: 50, borderWidth: 8, alignItems: 'center', justifyContent: 'center' },
  ringPercent: { fontSize: FONT.xl, fontWeight: '800' },
  ringLabel: { fontSize: FONT.xs },
  ringStats: { flex: 1, gap: SPACING.sm },
  statItem: { flexDirection: 'row', alignItems: 'center', gap: SPACING.xs },
  statItemLabel: { flex: 1, fontSize: FONT.sm },
  statItemValue: { fontSize: FONT.md, fontWeight: '700' },
  statsGrid: { flexDirection: 'row', gap: SPACING.sm },
  statCard: { flex: 1, alignItems: 'center', padding: SPACING.md, borderRadius: RADIUS.md, borderWidth: 1.5, gap: SPACING.xs },
  statCardValue: { fontSize: FONT.lg, fontWeight: '800' },
  statCardLabel: { fontSize: FONT.xs },
  progressTrack: { height: 6, borderRadius: 3, overflow: 'hidden', marginTop: SPACING.xs },
  progressFill: { height: '100%', borderRadius: 3 },
  overrideRow: { flexDirection: 'row', alignItems: 'center', gap: SPACING.xs, backgroundColor: COLORS.orange + '12', borderRadius: RADIUS.sm, padding: SPACING.xs },
  overrideText: { fontSize: FONT.xs, color: COLORS.orange, fontWeight: '600' },
  priorityRow: { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm, paddingVertical: SPACING.xs },
  priorityDot: { width: 10, height: 10, borderRadius: 5 },
  priorityLabel: { width: 60, fontSize: FONT.sm },
  priorityBar: { flex: 1, height: 6, borderRadius: 3, overflow: 'hidden' },
  priorityBarFill: { height: '100%', borderRadius: 3 },
  priorityValue: { fontSize: FONT.md, fontWeight: '700', width: 24, textAlign: 'right' },
  tagsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: SPACING.xs },
  tagBadge: { flexDirection: 'row', alignItems: 'center', backgroundColor: COLORS.primaryLight, borderRadius: RADIUS.full, paddingLeft: SPACING.sm, overflow: 'hidden' },
  tagBadgeText: { fontSize: FONT.sm, color: COLORS.primary, fontWeight: '600', paddingVertical: 4 },
  tagCount: { backgroundColor: COLORS.primary, marginLeft: SPACING.xs, paddingHorizontal: SPACING.xs, paddingVertical: 2 },
  tagCountText: { fontSize: FONT.xs, color: '#fff', fontWeight: '700' },
  emptyState: { alignItems: 'center', paddingTop: 40, paddingBottom: 20, gap: SPACING.sm },
  emptyText: { fontSize: FONT.lg, fontWeight: '600' },
  emptySubtext: { fontSize: FONT.sm, textAlign: 'center' },
  sectionLabel: {
    fontSize: FONT.xs,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    paddingHorizontal: 4,
    marginTop: SPACING.xs,
  },
  weekCard: {
    flex: 1,
    borderRadius: RADIUS.lg,
    padding: SPACING.md,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    gap: 2,
  },
  weekCardValue: { fontSize: FONT.xxl, fontWeight: '800', marginTop: 4 },
  weekCardLabel: { fontSize: FONT.xs, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5 },
  weekCardSub: { fontSize: 10, textAlign: 'center' },
  barChart: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    paddingTop: SPACING.md,
    paddingBottom: SPACING.sm,
    paddingHorizontal: SPACING.sm,
    height: 140,
    gap: 4,
  },
  barCol: { flex: 1, alignItems: 'center', gap: 4, height: '100%', justifyContent: 'flex-end' },
  barTrack: { width: '60%', height: 80, justifyContent: 'flex-end', borderRadius: 3, overflow: 'hidden' },
  barFill: { width: '100%', borderRadius: 3 },
  barCount: { fontSize: 10, fontWeight: '700' },
  barDay: { fontSize: 10 },
  appRow: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: SPACING.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: SPACING.sm,
  },
  rankBadge: { width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  rankText: { fontSize: 10, fontWeight: '700' },
  appInfo: { flex: 1, gap: 5 },
  appName: { fontSize: FONT.sm, fontWeight: '600' },
  countBadge: { paddingHorizontal: SPACING.sm, paddingVertical: 4, borderRadius: RADIUS.full, minWidth: 38, alignItems: 'center' },
  countText: { fontSize: FONT.sm, fontWeight: '700' },
});
