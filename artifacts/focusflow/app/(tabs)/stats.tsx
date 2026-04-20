import React, { useMemo, useEffect, useState, useCallback } from 'react';
import { withScreenErrorBoundary } from '@/components/withScreenErrorBoundary';
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

interface AppStat  { pkg: string; appName: string; count: number }
interface DayStat  { day: string; date: string; count: number }
interface WeekDay  {
  day: string; date: string; isToday: boolean;
  total: number; completed: number; focusMinutes: number;
}

// ─────────────────────────────────────────────────────────────────────────────

function StatsScreen() {
  const insets        = useSafeAreaInsets();
  const { state }     = useApp();
  const { theme }     = useTheme();
  const { tasks }     = state;

  const [filter, setFilter] = useState<Filter>('today');

  // ── Today DB data ─────────────────────────────────────────────────────────
  const [focusMinutes,  setFocusMinutes]  = useState(0);
  const [overrideCount, setOverrideCount] = useState(0);
  const [streak,        setStreak]        = useState(0);

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

  // ── Today computed stats ──────────────────────────────────────────────────
  const todayStats = useMemo(() => {
    const todayStr   = dayjs().format('YYYY-MM-DD');
    const todayTasks = tasks.filter((t) => dayjs(t.startTime).format('YYYY-MM-DD') === todayStr);
    const completed  = todayTasks.filter((t) => t.status === 'completed');
    const skipped    = todayTasks.filter((t) => t.status === 'skipped');
    const overdue    = todayTasks.filter((t) => t.status === 'overdue');
    const remaining  = todayTasks.filter((t) => t.status === 'scheduled' || t.status === 'active');
    const total      = todayTasks.length;
    const rate       = total > 0 ? Math.round((completed.length / total) * 100) : 0;
    const minsScheduled = todayTasks.reduce((s, t) => s + t.durationMinutes, 0);
    const minsCompleted = completed.reduce((s, t) => s + t.durationMinutes, 0);
    return {
      total,
      completed:   completed.length,
      skipped:     skipped.length,
      overdue:     overdue.length,
      remaining:   remaining.length,
      rate,
      minsScheduled,
      minsCompleted,
      focusTasks:  todayTasks.filter((t) => t.focusMode).length,
      byPriority: {
        critical: todayTasks.filter((t) => t.priority === 'critical').length,
        high:     todayTasks.filter((t) => t.priority === 'high').length,
        medium:   todayTasks.filter((t) => t.priority === 'medium').length,
        low:      todayTasks.filter((t) => t.priority === 'low').length,
      },
      topTags: getTopTags(todayTasks),
    };
  }, [tasks]);

  useEffect(() => {
    if (todayStats.total > 0) {
      void dbRecordDayCompletion(todayStats.completed, todayStats.total);
    }
  }, [todayStats.completed, todayStats.total]);

  const rateColor =
    todayStats.rate >= 80 ? COLORS.green
    : todayStats.rate >= 50 ? COLORS.orange
    : todayStats.rate >   0 ? COLORS.red
    : theme.muted as string;

  // ── Weekly task data (from state.tasks) ───────────────────────────────────
  const weeklyDays = useMemo<WeekDay[]>(() => {
    const days: WeekDay[] = [];
    for (let i = 6; i >= 0; i--) {
      const d         = dayjs().subtract(i, 'day');
      const dStr      = d.format('YYYY-MM-DD');
      const dayTasks  = tasks.filter((t) => dayjs(t.startTime).format('YYYY-MM-DD') === dStr);
      const completed = dayTasks.filter((t) => t.status === 'completed');
      days.push({
        day:          d.format('ddd'),
        date:         d.format('MMM D'),
        isToday:      i === 0,
        total:        dayTasks.length,
        completed:    completed.length,
        focusMinutes: completed.filter((t) => t.focusMode).reduce((s, t) => s + t.durationMinutes, 0),
      });
    }
    return days;
  }, [tasks]);

  const weekSummary = useMemo(() => {
    const total     = weeklyDays.reduce((s, d) => s + d.total, 0);
    const completed = weeklyDays.reduce((s, d) => s + d.completed, 0);
    const focusMins = weeklyDays.reduce((s, d) => s + d.focusMinutes, 0);
    const rate      = total > 0 ? Math.round((completed / total) * 100) : 0;
    return { total, completed, rate, focusMins };
  }, [weeklyDays]);

  const maxWeekCompleted = Math.max(...weeklyDays.map((d) => d.completed), 1);

  // ── Weekly temptation log data ────────────────────────────────────────────
  const [weekLoading,   setWeekLoading]   = useState(false);
  const [appStats,      setAppStats]      = useState<AppStat[]>([]);
  const [dayStats,      setDayStats]      = useState<DayStat[]>([]);
  const [totalThisWeek, setTotalThisWeek] = useState(0);
  const [totalAllTime,  setTotalAllTime]  = useState(0);
  const [cleanStreak,   setCleanStreak]   = useState(0);

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
    const cutoff   = Date.now() - 7 * 24 * 60 * 60 * 1000;
    const thisWeek = log.filter((e) => e.timestamp >= cutoff);
    setTotalThisWeek(thisWeek.length);
    setTotalAllTime(log.length);

    const appMap = new Map<string, AppStat>();
    for (const e of thisWeek) {
      const ex = appMap.get(e.pkg);
      if (ex) ex.count++;
      else appMap.set(e.pkg, { pkg: e.pkg, appName: e.appName || e.pkg, count: 1 });
    }
    setAppStats(Array.from(appMap.values()).sort((a, b) => b.count - a.count));

    const days: DayStat[] = [];
    for (let i = 6; i >= 0; i--) {
      const d        = dayjs().subtract(i, 'day');
      const start    = d.startOf('day').valueOf();
      const end      = d.endOf('day').valueOf();
      const count    = log.filter((e) => e.timestamp >= start && e.timestamp <= end).length;
      days.push({ day: d.format('ddd'), date: d.format('MMM D'), count });
    }
    setDayStats(days);

    let cs = 0;
    for (let i = days.length - 1; i >= 0; i--) {
      if (days[i].count === 0) cs++;
      else break;
    }
    setCleanStreak(cs);
  }

  const handleClearLog = () => {
    Alert.alert('Clear Temptation Log', 'Permanently delete all blocked-app intercept data?', [
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

  // ─── Render ────────────────────────────────────────────────────────────────
  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: theme.background }]} edges={['top']}>

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <View style={[styles.header, { backgroundColor: theme.card, borderBottomColor: theme.border }]}>
        <View>
          <Text style={[styles.title, { color: theme.text }]}>Stats</Text>
          <Text style={[styles.subtitle, { color: theme.textSecondary }]}>
            {filter === 'today'
              ? dayjs().format('MMMM D, YYYY')
              : `${dayjs().subtract(6, 'day').format('MMM D')} – ${dayjs().format('MMM D')}`}
          </Text>
        </View>
        {filter === 'week' && (
          <TouchableOpacity
            onPress={handleClearLog}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            style={[styles.iconBtn, { backgroundColor: COLORS.red + '15' }]}
          >
            <Ionicons name="trash-outline" size={17} color={COLORS.red} />
          </TouchableOpacity>
        )}
      </View>

      {/* ── Filter pills ──────────────────────────────────────────────────── */}
      <View style={[styles.filterRow, { backgroundColor: theme.card, borderBottomColor: theme.border }]}>
        {(['today', 'week'] as const).map((f) => (
          <TouchableOpacity
            key={f}
            style={[styles.filterPill, filter === f && { backgroundColor: COLORS.primary }]}
            onPress={() => setFilter(f)}
          >
            <Text style={[styles.filterLabel, { color: filter === f ? '#fff' : theme.textSecondary }]}>
              {f === 'today' ? 'Today' : 'This Week'}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* ════════════════════════ TODAY ════════════════════════════════════ */}
      {filter === 'today' && (
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={[styles.content, { paddingBottom: 60 + insets.bottom + 24 }]}
          showsVerticalScrollIndicator={false}
        >
          {/* Streak banner */}
          {streak > 0 && (
            <View style={[styles.streakBanner, { borderColor: COLORS.orange + '40' }]}>
              <Text style={styles.streakFire}>🔥</Text>
              <View style={{ flex: 1 }}>
                <Text style={[styles.streakTitle, { color: COLORS.orange }]}>{streak}-day streak!</Text>
                <Text style={[styles.streakSub, { color: theme.textSecondary }]}>Keep completing tasks daily</Text>
              </View>
            </View>
          )}

          {/* ── Completion hero ─────────────────────────────────────────── */}
          <View style={[styles.card, { backgroundColor: theme.card }]}>
            <View style={styles.heroRow}>
              {/* Big percentage disc */}
              <View style={[styles.heroDisk, { borderColor: rateColor + '30', backgroundColor: rateColor + '12' }]}>
                <Text style={[styles.heroPercent, { color: rateColor }]}>
                  {todayStats.rate}<Text style={styles.heroPct}>%</Text>
                </Text>
                <Text style={[styles.heroLabel, { color: theme.muted }]}>done</Text>
              </View>

              {/* Right-side status items */}
              <View style={styles.heroStats}>
                <StatusRow icon="checkmark-circle" color={COLORS.green}  label="Completed" value={todayStats.completed} />
                <StatusRow icon="time-outline"     color={COLORS.blue}   label="Remaining" value={todayStats.remaining} />
                <StatusRow icon="play-skip-forward" color={theme.muted as string} label="Skipped"   value={todayStats.skipped} />
                {todayStats.overdue > 0 && (
                  <StatusRow icon="alert-circle" color={COLORS.red} label="Overdue" value={todayStats.overdue} />
                )}
              </View>
            </View>

            {/* Progress bar — scheduled vs completed time */}
            {todayStats.minsScheduled > 0 && (
              <View style={{ gap: SPACING.xs, marginTop: SPACING.xs }}>
                <View style={styles.progLabels}>
                  <Text style={[styles.progLabelText, { color: theme.muted }]}>
                    {fmtMins(todayStats.minsCompleted)} of {fmtMins(todayStats.minsScheduled)} scheduled
                  </Text>
                  <Text style={[styles.progLabelText, { color: COLORS.green }]}>
                    {todayStats.minsScheduled > 0
                      ? Math.round((todayStats.minsCompleted / todayStats.minsScheduled) * 100)
                      : 0}%
                  </Text>
                </View>
                <View style={[styles.trackFull, { backgroundColor: theme.border }]}>
                  <View style={[styles.trackFill, {
                    backgroundColor: COLORS.green,
                    width: todayStats.minsScheduled > 0
                      ? `${Math.min(100, (todayStats.minsCompleted / todayStats.minsScheduled) * 100)}%`
                      : '0%',
                  }]} />
                </View>
              </View>
            )}
          </View>

          {/* ── Focus & activity chips ──────────────────────────────────── */}
          <View style={styles.chipRow}>
            <InfoChip
              icon="timer-outline"
              label="Focus Time"
              value={focusMinutes > 0 ? fmtMins(focusMinutes) : '—'}
              color={COLORS.primary}
              theme={theme}
            />
            <InfoChip
              icon="shield-checkmark-outline"
              label="Focus Tasks"
              value={String(todayStats.focusTasks)}
              color={COLORS.blue}
              theme={theme}
            />
            <InfoChip
              icon="warning-outline"
              label="Overrides"
              value={String(overrideCount)}
              color={overrideCount > 0 ? COLORS.orange : COLORS.green}
              theme={theme}
            />
          </View>

          {/* ── Task status breakdown bars ──────────────────────────────── */}
          {todayStats.total > 0 && (
            <View style={[styles.card, { backgroundColor: theme.card }]}>
              <Text style={[styles.cardTitle, { color: theme.text }]}>Task Breakdown</Text>
              {[
                { label: 'Completed', value: todayStats.completed, color: COLORS.green },
                { label: 'Remaining', value: todayStats.remaining, color: COLORS.blue },
                { label: 'Skipped',   value: todayStats.skipped,   color: theme.muted as string },
                { label: 'Overdue',   value: todayStats.overdue,   color: COLORS.red },
              ].filter((r) => r.value > 0).map((r) => (
                <View key={r.label} style={styles.breakdownRow}>
                  <Text style={[styles.breakdownLabel, { color: theme.textSecondary }]}>{r.label}</Text>
                  <View style={[styles.breakdownTrack, { backgroundColor: theme.border }]}>
                    <View style={[styles.breakdownFill, {
                      backgroundColor: r.color,
                      width: `${Math.round((r.value / todayStats.total) * 100)}%`,
                    }]} />
                  </View>
                  <Text style={[styles.breakdownValue, { color: r.color }]}>{r.value}</Text>
                </View>
              ))}
            </View>
          )}

          {/* ── Priority breakdown ──────────────────────────────────────── */}
          {todayStats.total > 0 && (() => {
            const pRows = [
              { label: 'Critical', value: todayStats.byPriority.critical, color: COLORS.red },
              { label: 'High',     value: todayStats.byPriority.high,     color: COLORS.orange },
              { label: 'Medium',   value: todayStats.byPriority.medium,   color: COLORS.blue },
              { label: 'Low',      value: todayStats.byPriority.low,      color: COLORS.green },
            ].filter((p) => p.value > 0);
            if (pRows.length === 0) return null;
            return (
              <View style={[styles.card, { backgroundColor: theme.card }]}>
                <Text style={[styles.cardTitle, { color: theme.text }]}>By Priority</Text>
                {pRows.map((p) => (
                  <View key={p.label} style={styles.breakdownRow}>
                    <View style={[styles.dot, { backgroundColor: p.color }]} />
                    <Text style={[styles.breakdownLabel, { color: theme.textSecondary, width: 58 }]}>{p.label}</Text>
                    <View style={[styles.breakdownTrack, { backgroundColor: theme.border }]}>
                      <View style={[styles.breakdownFill, {
                        backgroundColor: p.color,
                        width: `${Math.round((p.value / todayStats.total) * 100)}%`,
                      }]} />
                    </View>
                    <Text style={[styles.breakdownValue, { color: p.color }]}>{p.value}</Text>
                  </View>
                ))}
              </View>
            );
          })()}

          {/* ── Top Tags ────────────────────────────────────────────────── */}
          {todayStats.topTags.length > 0 && (
            <View style={[styles.card, { backgroundColor: theme.card }]}>
              <Text style={[styles.cardTitle, { color: theme.text }]}>Top Tags</Text>
              <View style={styles.tagsWrap}>
                {todayStats.topTags.map(({ tag, count }) => (
                  <View key={tag} style={[styles.tag, { backgroundColor: COLORS.primary + '18', borderColor: COLORS.primary + '33' }]}>
                    <Text style={[styles.tagText, { color: COLORS.primary }]}>#{tag}</Text>
                    <View style={[styles.tagCount, { backgroundColor: COLORS.primary + '22' }]}>
                      <Text style={[styles.tagCountText, { color: COLORS.primary }]}>{count}</Text>
                    </View>
                  </View>
                ))}
              </View>
            </View>
          )}

          {/* ── Empty state ─────────────────────────────────────────────── */}
          {todayStats.total === 0 && (
            <View style={styles.emptyState}>
              <Ionicons name="bar-chart-outline" size={52} color={theme.border} />
              <Text style={[styles.emptyTitle, { color: theme.text }]}>Nothing scheduled today</Text>
              <Text style={[styles.emptySub, { color: theme.muted }]}>Add tasks to start tracking your productivity</Text>
            </View>
          )}
        </ScrollView>
      )}

      {/* ════════════════════════ WEEK ═════════════════════════════════════ */}
      {filter === 'week' && (
        weekLoading ? (
          <View style={styles.center}>
            <ActivityIndicator size="large" color={COLORS.primary} />
          </View>
        ) : (
          <ScrollView
            style={styles.scroll}
            contentContainerStyle={[styles.content, { paddingBottom: 60 + insets.bottom + 24 }]}
            showsVerticalScrollIndicator={false}
          >
            {/* ── TASK PRODUCTIVITY section ──────────────────────────── */}
            <SectionHeader label="TASK PRODUCTIVITY" theme={theme} />

            {/* Summary chips */}
            <View style={styles.chipRow}>
              <InfoChip
                icon="list-outline"
                label="Tasks"
                value={String(weekSummary.total)}
                color={COLORS.blue}
                theme={theme}
              />
              <InfoChip
                icon="checkmark-circle-outline"
                label="Done"
                value={weekSummary.rate > 0 ? `${weekSummary.rate}%` : '—'}
                color={weekSummary.rate >= 80 ? COLORS.green : weekSummary.rate >= 50 ? COLORS.orange : COLORS.red}
                theme={theme}
              />
              <InfoChip
                icon="timer-outline"
                label="Focus"
                value={weekSummary.focusMins > 0 ? fmtMins(weekSummary.focusMins) : '—'}
                color={COLORS.primary}
                theme={theme}
              />
            </View>

            {/* Completed tasks bar chart */}
            <View style={[styles.card, { backgroundColor: theme.card }]}>
              <Text style={[styles.cardTitle, { color: theme.text }]}>Completed Tasks per Day</Text>
              <View style={styles.barChart}>
                {weeklyDays.map((d) => {
                  const pct      = d.completed === 0 ? 0 : Math.max(0.05, d.completed / maxWeekCompleted);
                  const barColor = d.completed === 0
                    ? (theme.border as string)
                    : d.isToday ? COLORS.primary : COLORS.green;
                  return (
                    <View key={d.date} style={styles.barCol}>
                      <Text style={[styles.barCount, { color: d.completed === 0 ? theme.muted : theme.text }]}>
                        {d.completed === 0 ? '·' : d.completed}
                      </Text>
                      <View style={[styles.barTrack, { backgroundColor: theme.border }]}>
                        <View style={[styles.barFill, { height: `${pct * 100}%`, backgroundColor: barColor }]} />
                      </View>
                      <Text style={[styles.barDay, {
                        color:      d.isToday ? COLORS.primary : theme.muted,
                        fontWeight: d.isToday ? '700' : '500',
                      }]}>
                        {d.day}
                      </Text>
                      {d.total > 0 && (
                        <Text style={[styles.barTotal, { color: theme.muted }]}>/{d.total}</Text>
                      )}
                    </View>
                  );
                })}
              </View>
              {weekSummary.total === 0 && (
                <Text style={[styles.chartEmpty, { color: theme.muted }]}>
                  No tasks scheduled this week yet
                </Text>
              )}
            </View>

            {/* ── APP DISCIPLINE section ─────────────────────────────── */}
            <SectionHeader label="APP DISCIPLINE" theme={theme} />

            {/* Summary grid */}
            <View style={styles.chipRow}>
              <InfoChip
                icon="shield-checkmark"
                label="Blocked"
                value={String(totalThisWeek)}
                color={totalThisWeek === 0 ? COLORS.green : COLORS.orange}
                theme={theme}
              />
              <InfoChip
                icon="flame"
                label="Clean Days"
                value={`${cleanStreak}d`}
                color={cleanStreak > 0 ? COLORS.green : theme.muted as string}
                theme={theme}
              />
              <InfoChip
                icon="apps-outline"
                label="Apps Tempted"
                value={String(appStats.length)}
                color={COLORS.blue}
                theme={theme}
              />
            </View>

            {/* Daily blocked attempts bar chart */}
            <View style={[styles.card, { backgroundColor: theme.card }]}>
              <Text style={[styles.cardTitle, { color: theme.text }]}>App Block Intercepts per Day</Text>
              <View style={styles.barChart}>
                {dayStats.map((d, i) => {
                  const isToday  = i === dayStats.length - 1;
                  const pct      = d.count === 0 ? 0 : Math.max(0.06, d.count / maxDay);
                  const barColor = d.count === 0 ? COLORS.green : isToday ? COLORS.primary : COLORS.orange;
                  return (
                    <View key={d.date} style={styles.barCol}>
                      <Text style={[styles.barCount, { color: d.count === 0 ? COLORS.green : theme.text }]}>
                        {d.count === 0 ? '✓' : d.count}
                      </Text>
                      <View style={[styles.barTrack, { backgroundColor: theme.border }]}>
                        <View style={[styles.barFill, { height: `${pct * 100}%`, backgroundColor: barColor }]} />
                      </View>
                      <Text style={[styles.barDay, {
                        color:      isToday ? COLORS.primary : theme.muted,
                        fontWeight: isToday ? '700' : '500',
                      }]}>
                        {d.day}
                      </Text>
                    </View>
                  );
                })}
              </View>
              {dayStats.length === 0 && (
                <Text style={[styles.chartEmpty, { color: theme.muted }]}>
                  Block some apps to see intercept data
                </Text>
              )}
            </View>

            {/* Most tempting apps */}
            {appStats.length > 0 && (
              <View style={[styles.card, { backgroundColor: theme.card }]}>
                <Text style={[styles.cardTitle, { color: theme.text }]}>Most Tempting Apps</Text>
                {appStats.slice(0, 8).map((a, i) => (
                  <View key={a.pkg} style={[styles.appRow, { borderBottomColor: theme.border }]}>
                    <View style={[styles.rankBadge, {
                      backgroundColor: i === 0 ? COLORS.red + '18' : theme.surface,
                    }]}>
                      <Text style={[styles.rankText, { color: i === 0 ? COLORS.red : theme.muted }]}>
                        #{i + 1}
                      </Text>
                    </View>
                    <View style={styles.appInfo}>
                      <Text style={[styles.appName, { color: theme.text }]} numberOfLines={1}>
                        {a.appName}
                      </Text>
                      <View style={[styles.trackFull, { backgroundColor: theme.border }]}>
                        <View style={[styles.trackFill, {
                          width:           `${(a.count / maxApp) * 100}%`,
                          backgroundColor: i === 0 ? COLORS.red : COLORS.orange,
                        }]} />
                      </View>
                    </View>
                    <View style={[styles.countBadge, {
                      backgroundColor: i === 0 ? COLORS.red + '18' : theme.surface,
                    }]}>
                      <Text style={[styles.countText, { color: i === 0 ? COLORS.red : theme.text }]}>
                        {a.count}×
                      </Text>
                    </View>
                  </View>
                ))}
              </View>
            )}

            {appStats.length === 0 && totalThisWeek === 0 && (
              <View style={styles.emptyState}>
                <Ionicons name="shield-checkmark" size={52} color={COLORS.green} />
                <Text style={[styles.emptyTitle, { color: theme.text }]}>Clean discipline this week!</Text>
                <Text style={[styles.emptySub, { color: theme.muted }]}>
                  Data appears here when the app blocker intercepts an attempt to open a blocked app.
                </Text>
              </View>
            )}

            {/* All-time footnote */}
            {totalAllTime > 0 && (
              <Text style={[styles.footnote, { color: theme.muted }]}>
                {totalAllTime} total block intercepts all time
              </Text>
            )}
          </ScrollView>
        )
      )}
    </SafeAreaView>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function SectionHeader({ label, theme }: { label: string; theme: any }) {
  return (
    <Text style={[styles.sectionLabel, { color: theme.muted }]}>{label}</Text>
  );
}

function StatusRow({
  icon, color, label, value,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  color: string;
  label: string;
  value: number;
}) {
  const { theme } = useTheme();
  return (
    <View style={styles.statusRow}>
      <Ionicons name={icon} size={15} color={color} />
      <Text style={[styles.statusLabel, { color: theme.textSecondary }]}>{label}</Text>
      <Text style={[styles.statusValue, { color }]}>{value}</Text>
    </View>
  );
}

function InfoChip({
  icon, label, value, color, theme,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  value: string;
  color: string;
  theme: any;
}) {
  return (
    <View style={[styles.chip, { backgroundColor: theme.card, borderColor: color + '33' }]}>
      <Ionicons name={icon} size={18} color={color} />
      <Text style={[styles.chipValue, { color }]}>{value}</Text>
      <Text style={[styles.chipLabel, { color: theme.muted }]}>{label}</Text>
    </View>
  );
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtMins(minutes: number): string {
  if (minutes < 60) return `${minutes}m`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
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

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  safe:    { flex: 1 },
  scroll:  { flex: 1 },
  center:  { flex: 1, alignItems: 'center', justifyContent: 'center' },
  content: { padding: SPACING.md, gap: SPACING.md },

  header: {
    flexDirection:       'row',
    alignItems:          'center',
    justifyContent:      'space-between',
    paddingHorizontal:   SPACING.lg,
    paddingVertical:     SPACING.md,
    borderBottomWidth:   StyleSheet.hairlineWidth,
  },
  title:    { fontSize: FONT.xxl, fontWeight: '800' },
  subtitle: { fontSize: FONT.sm, marginTop: 2 },
  iconBtn:  { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },

  filterRow: {
    flexDirection:     'row',
    padding:           SPACING.xs,
    gap:               SPACING.xs,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  filterPill: {
    flex:            1,
    paddingVertical: SPACING.sm,
    borderRadius:    RADIUS.md,
    alignItems:      'center',
  },
  filterLabel: { fontSize: FONT.sm, fontWeight: '700' },

  // ── Cards & sections ──────────────────────────────────────────────────────
  card: {
    borderRadius: RADIUS.lg,
    padding:      SPACING.md,
    gap:          SPACING.sm,
  },
  cardTitle: { fontSize: FONT.md, fontWeight: '700' },
  sectionLabel: {
    fontSize:      FONT.xs,
    fontWeight:    '700',
    letterSpacing: 0.8,
    marginTop:     SPACING.xs,
    paddingLeft:   SPACING.xs,
  },

  // ── Streak banner ─────────────────────────────────────────────────────────
  streakBanner: {
    flexDirection:   'row',
    alignItems:      'center',
    gap:             SPACING.sm,
    backgroundColor: COLORS.orange + '15',
    borderRadius:    RADIUS.lg,
    padding:         SPACING.md,
    borderWidth:     1.5,
  },
  streakFire:  { fontSize: 24 },
  streakTitle: { fontSize: FONT.md, fontWeight: '700' },
  streakSub:   { fontSize: FONT.xs, marginTop: 1 },

  // ── Hero completion ───────────────────────────────────────────────────────
  heroRow:    { flexDirection: 'row', alignItems: 'center', gap: SPACING.lg },
  heroDisk: {
    width:        108,
    height:       108,
    borderRadius: 54,
    borderWidth:  3,
    alignItems:   'center',
    justifyContent: 'center',
    gap:          2,
  },
  heroPercent: { fontSize: 36, fontWeight: '800', lineHeight: 42 },
  heroPct:     { fontSize: 20, fontWeight: '600' },
  heroLabel:   { fontSize: FONT.xs, fontWeight: '600', letterSpacing: 0.5 },
  heroStats:   { flex: 1, gap: SPACING.sm },

  statusRow: { flexDirection: 'row', alignItems: 'center', gap: SPACING.xs },
  statusLabel: { flex: 1, fontSize: FONT.sm },
  statusValue: { fontSize: FONT.md, fontWeight: '700', minWidth: 24, textAlign: 'right' },

  // ── Progress bar ──────────────────────────────────────────────────────────
  progLabels:    { flexDirection: 'row', justifyContent: 'space-between' },
  progLabelText: { fontSize: FONT.xs },
  trackFull:     { height: 7, borderRadius: 4, overflow: 'hidden' },
  trackFill:     { height: '100%', borderRadius: 4 },

  // ── Info chips (3-across) ─────────────────────────────────────────────────
  chipRow: { flexDirection: 'row', gap: SPACING.sm },
  chip: {
    flex:            1,
    alignItems:      'center',
    paddingVertical: SPACING.md,
    borderRadius:    RADIUS.lg,
    borderWidth:     1.5,
    gap:             4,
  },
  chipValue: { fontSize: FONT.lg, fontWeight: '800' },
  chipLabel: { fontSize: FONT.xs, fontWeight: '600' },

  // ── Task breakdown bars ───────────────────────────────────────────────────
  breakdownRow: {
    flexDirection: 'row',
    alignItems:    'center',
    gap:           SPACING.sm,
  },
  breakdownLabel: { fontSize: FONT.sm, width: 70 },
  breakdownTrack: { flex: 1, height: 7, borderRadius: 4, overflow: 'hidden' },
  breakdownFill:  { height: '100%', borderRadius: 4 },
  breakdownValue: { fontSize: FONT.md, fontWeight: '700', width: 24, textAlign: 'right' },
  dot:            { width: 10, height: 10, borderRadius: 5 },

  // ── Tags ──────────────────────────────────────────────────────────────────
  tagsWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: SPACING.xs },
  tag: {
    flexDirection:   'row',
    alignItems:      'center',
    gap:             5,
    paddingVertical: 5,
    paddingHorizontal: SPACING.sm,
    borderRadius:    RADIUS.pill,
    borderWidth:     1,
  },
  tagText:      { fontSize: FONT.xs, fontWeight: '600' },
  tagCount:     { borderRadius: 10, paddingHorizontal: 5, paddingVertical: 1 },
  tagCountText: { fontSize: 10, fontWeight: '700' },

  // ── Bar chart ─────────────────────────────────────────────────────────────
  barChart: {
    flexDirection:   'row',
    alignItems:      'flex-end',
    height:          120,
    gap:             SPACING.xs,
    paddingTop:      SPACING.sm,
  },
  barCol: {
    flex:           1,
    alignItems:     'center',
    height:         '100%',
    justifyContent: 'flex-end',
    gap:            3,
  },
  barCount:  { fontSize: 10, fontWeight: '700' },
  barTrack:  { width: '100%', flex: 1, borderRadius: 3, overflow: 'hidden', justifyContent: 'flex-end' },
  barFill:   { width: '100%', borderRadius: 3 },
  barDay:    { fontSize: 10 },
  barTotal:  { fontSize: 9 },
  chartEmpty:{ fontSize: FONT.sm, textAlign: 'center', paddingVertical: SPACING.md },

  // ── App rows ──────────────────────────────────────────────────────────────
  appRow: {
    flexDirection:    'row',
    alignItems:       'center',
    gap:              SPACING.sm,
    paddingVertical:  SPACING.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  rankBadge:  { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center' },
  rankText:   { fontSize: FONT.xs, fontWeight: '700' },
  appInfo:    { flex: 1, gap: 5 },
  appName:    { fontSize: FONT.sm, fontWeight: '600' },
  countBadge: { paddingHorizontal: SPACING.sm, paddingVertical: 4, borderRadius: RADIUS.sm },
  countText:  { fontSize: FONT.sm, fontWeight: '700' },

  // ── Empty / footnote ──────────────────────────────────────────────────────
  emptyState: {
    alignItems:    'center',
    paddingVertical: SPACING.xxl,
    gap:             SPACING.sm,
  },
  emptyTitle: { fontSize: FONT.lg, fontWeight: '700', textAlign: 'center' },
  emptySub:   { fontSize: FONT.sm, textAlign: 'center', maxWidth: 280 },
  footnote:   { fontSize: FONT.xs, textAlign: 'center', paddingBottom: SPACING.sm },
});

export default withScreenErrorBoundary(StatsScreen, 'Stats');
