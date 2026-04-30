import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  Modal,
  FlatList,
  TouchableOpacity,
  TextInput,
  StyleSheet,
  Image,
  ActivityIndicator,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { InstalledAppsModule, InstalledApp } from '@/native-modules/InstalledAppsModule';
import { COLORS, FONT, RADIUS, SPACING } from '@/styles/theme';
import { useTheme } from '@/hooks/useTheme';
import type { DailyAllowanceEntry, AllowanceMode } from '@/data/types';

interface Props {
  visible: boolean;
  selectedEntries: DailyAllowanceEntry[];
  locked?: boolean;
  onSave: (entries: DailyAllowanceEntry[]) => void | Promise<void>;
  onClose: () => void;
}

const MODE_LABELS: Record<AllowanceMode, string> = {
  count: 'Count',
  time_budget: 'Time Budget',
  interval: 'Interval',
};

const MODE_ICONS: Record<AllowanceMode, React.ComponentProps<typeof Ionicons>['name']> = {
  count: 'finger-print-outline',
  time_budget: 'hourglass-outline',
  interval: 'timer-outline',
};

const ALL_MODES: AllowanceMode[] = ['count', 'time_budget', 'interval'];

function makeDefaultEntry(pkg: string): DailyAllowanceEntry {
  return { packageName: pkg, mode: 'count', countPerDay: 1, budgetMinutes: 30, intervalMinutes: 5, intervalHours: 1 };
}

/**
 * DailyAllowanceModal
 *
 * Full per-app daily allowance configuration. Each selected app can have its own
 * mode: Count (N opens/day), Time Budget (N total minutes/day), or Interval
 * (N minutes every Y hours). Selecting an app shows its configuration inline.
 */
export function DailyAllowanceModal({ visible, selectedEntries, locked = false, onSave, onClose }: Props) {
  const { theme } = useTheme();
  const [apps, setApps] = useState<InstalledApp[]>([]);
  const [entriesMap, setEntriesMap] = useState<Map<string, DailyAllowanceEntry>>(new Map());
  const [originalPkgs, setOriginalPkgs] = useState<Set<string>>(new Set());
  const [expandedPkg, setExpandedPkg] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!visible) return;
    const map = new Map<string, DailyAllowanceEntry>();
    for (const e of selectedEntries) map.set(e.packageName, { ...e });
    setEntriesMap(map);
    setOriginalPkgs(new Set(selectedEntries.map((e) => e.packageName)));
    setExpandedPkg(null);
    setSearch('');
    if (apps.length === 0) {
      setLoading(true);
      InstalledAppsModule.getInstalledApps()
        .then(setApps)
        .catch(() => {})
        .finally(() => setLoading(false));
    }
  }, [visible]);

  const filtered = useMemo(() => {
    if (!search.trim()) return apps;
    const q = search.toLowerCase();
    return apps.filter(
      (a) => a.appName.toLowerCase().includes(q) || a.packageName.toLowerCase().includes(q),
    );
  }, [apps, search]);

  const isEntryLocked = useCallback((pkg: string) => locked && originalPkgs.has(pkg), [locked, originalPkgs]);

  const toggle = useCallback((pkg: string) => {
    setEntriesMap((prev) => {
      const next = new Map(prev);
      if (next.has(pkg)) {
        if (locked && originalPkgs.has(pkg)) return next;
        next.delete(pkg);
        setExpandedPkg((ep) => (ep === pkg ? null : ep));
      } else {
        next.set(pkg, makeDefaultEntry(pkg));
        setExpandedPkg(pkg);
      }
      return next;
    });
  }, [locked, originalPkgs]);

  const updateEntry = useCallback((pkg: string, patch: Partial<DailyAllowanceEntry>) => {
    setEntriesMap((prev) => {
      const next = new Map(prev);
      const existing = next.get(pkg) ?? makeDefaultEntry(pkg);
      next.set(pkg, { ...existing, ...patch });
      return next;
    });
  }, []);

  const handleSave = async () => {
    setSaving(true);
    try {
      await onSave(Array.from(entriesMap.values()));
      onClose();
    } catch (e) {
      console.error('[DailyAllowanceModal] save failed', e);
    } finally {
      setSaving(false);
    }
  };

  const renderModeConfig = (entry: DailyAllowanceEntry) => {
    const pkg = entry.packageName;
    const entryLocked = isEntryLocked(pkg);
    return (
      <View style={[styles.configPanel, { backgroundColor: theme.surface, borderTopColor: theme.border }]}>
        {/* Locked read-only notice — only shown for pre-existing entries */}
        {entryLocked && (
          <View style={styles.lockNotice}>
            <Ionicons name="lock-closed-outline" size={12} color={COLORS.orange} />
            <Text style={styles.lockNoticeText}>Values locked while block is active</Text>
          </View>
        )}

        {/* Mode picker */}
        <Text style={[styles.configLabel, { color: theme.muted }]}>ALLOWANCE MODE</Text>
        <View style={styles.modeRow}>
          {ALL_MODES.map((m) => (
            <TouchableOpacity
              key={m}
              style={[styles.modeBtn, { borderColor: theme.border }, entry.mode === m && styles.modeBtnActive, entryLocked && styles.modeBtnDisabled]}
              onPress={() => { if (!entryLocked) updateEntry(pkg, { mode: m }); }}
              activeOpacity={entryLocked ? 1 : 0.7}
            >
              <Ionicons
                name={MODE_ICONS[m]}
                size={14}
                color={entry.mode === m ? (entryLocked ? COLORS.muted : COLORS.orange) : COLORS.muted}
              />
              <Text style={[styles.modeBtnText, entry.mode === m && !entryLocked && styles.modeBtnTextActive]}>
                {MODE_LABELS[m]}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* Mode-specific config */}
        {entry.mode === 'count' && (
          <View style={styles.configRow}>
            <Text style={[styles.configFieldLabel, { color: theme.textSecondary }]}>Opens per day</Text>
            <View style={styles.stepper}>
              <TouchableOpacity
                style={[styles.stepBtn, { backgroundColor: theme.card }, entryLocked && styles.stepBtnDisabled]}
                onPress={() => { if (!entryLocked) updateEntry(pkg, { countPerDay: Math.max(1, (entry.countPerDay ?? 1) - 1) }); }}
                disabled={entryLocked}
              >
                <Ionicons name="remove" size={16} color={entryLocked ? COLORS.muted : COLORS.text} />
              </TouchableOpacity>
              <Text style={[styles.stepValue, { color: entryLocked ? theme.muted : theme.text }]}>{entry.countPerDay ?? 1}</Text>
              <TouchableOpacity
                style={[styles.stepBtn, { backgroundColor: theme.card }, entryLocked && styles.stepBtnDisabled]}
                onPress={() => { if (!entryLocked) updateEntry(pkg, { countPerDay: Math.min(20, (entry.countPerDay ?? 1) + 1) }); }}
                disabled={entryLocked}
              >
                <Ionicons name="add" size={16} color={entryLocked ? COLORS.muted : COLORS.text} />
              </TouchableOpacity>
            </View>
          </View>
        )}

        {entry.mode === 'time_budget' && (
          <View style={styles.configRow}>
            <Text style={[styles.configFieldLabel, { color: theme.textSecondary }]}>Total minutes per day</Text>
            <View style={styles.stepper}>
              <TouchableOpacity
                style={[styles.stepBtn, { backgroundColor: theme.card }, entryLocked && styles.stepBtnDisabled]}
                onPress={() => { if (!entryLocked) updateEntry(pkg, { budgetMinutes: Math.max(1, (entry.budgetMinutes ?? 30) - 5) }); }}
                disabled={entryLocked}
              >
                <Ionicons name="remove" size={16} color={entryLocked ? COLORS.muted : COLORS.text} />
              </TouchableOpacity>
              <Text style={[styles.stepValue, { color: entryLocked ? theme.muted : theme.text }]}>{entry.budgetMinutes ?? 30} min</Text>
              <TouchableOpacity
                style={[styles.stepBtn, { backgroundColor: theme.card }, entryLocked && styles.stepBtnDisabled]}
                onPress={() => { if (!entryLocked) updateEntry(pkg, { budgetMinutes: Math.min(480, (entry.budgetMinutes ?? 30) + 5) }); }}
                disabled={entryLocked}
              >
                <Ionicons name="add" size={16} color={entryLocked ? COLORS.muted : COLORS.text} />
              </TouchableOpacity>
            </View>
          </View>
        )}

        {entry.mode === 'interval' && (
          <>
            <View style={styles.configRow}>
              <Text style={[styles.configFieldLabel, { color: theme.textSecondary }]}>Minutes allowed per window</Text>
              <View style={styles.stepper}>
                <TouchableOpacity
                  style={[styles.stepBtn, { backgroundColor: theme.card }, entryLocked && styles.stepBtnDisabled]}
                  onPress={() => { if (!entryLocked) updateEntry(pkg, { intervalMinutes: Math.max(1, (entry.intervalMinutes ?? 5) - 1) }); }}
                  disabled={entryLocked}
                >
                  <Ionicons name="remove" size={16} color={entryLocked ? COLORS.muted : COLORS.text} />
                </TouchableOpacity>
                <Text style={[styles.stepValue, { color: entryLocked ? theme.muted : theme.text }]}>{entry.intervalMinutes ?? 5} min</Text>
                <TouchableOpacity
                  style={[styles.stepBtn, { backgroundColor: theme.card }, entryLocked && styles.stepBtnDisabled]}
                  onPress={() => { if (!entryLocked) updateEntry(pkg, { intervalMinutes: Math.min(120, (entry.intervalMinutes ?? 5) + 1) }); }}
                  disabled={entryLocked}
                >
                  <Ionicons name="add" size={16} color={entryLocked ? COLORS.muted : COLORS.text} />
                </TouchableOpacity>
              </View>
            </View>
            <View style={styles.configRow}>
              <Text style={[styles.configFieldLabel, { color: theme.textSecondary }]}>Window size (hours)</Text>
              <View style={styles.stepper}>
                <TouchableOpacity
                  style={[styles.stepBtn, { backgroundColor: theme.card }, entryLocked && styles.stepBtnDisabled]}
                  onPress={() => { if (!entryLocked) updateEntry(pkg, { intervalHours: Math.max(1, (entry.intervalHours ?? 1) - 1) }); }}
                  disabled={entryLocked}
                >
                  <Ionicons name="remove" size={16} color={entryLocked ? COLORS.muted : COLORS.text} />
                </TouchableOpacity>
                <Text style={[styles.stepValue, { color: entryLocked ? theme.muted : theme.text }]}>{entry.intervalHours ?? 1} hr</Text>
                <TouchableOpacity
                  style={[styles.stepBtn, { backgroundColor: theme.card }, entryLocked && styles.stepBtnDisabled]}
                  onPress={() => { if (!entryLocked) updateEntry(pkg, { intervalHours: Math.min(24, (entry.intervalHours ?? 1) + 1) }); }}
                  disabled={entryLocked}
                >
                  <Ionicons name="add" size={16} color={entryLocked ? COLORS.muted : COLORS.text} />
                </TouchableOpacity>
              </View>
            </View>
            <Text style={[styles.intervalSummary, { color: theme.muted }]}>
              App is allowed for {entry.intervalMinutes ?? 5} min every {entry.intervalHours ?? 1} hour{(entry.intervalHours ?? 1) !== 1 ? 's' : ''}.
            </Text>
          </>
        )}
      </View>
    );
  };

  const renderItem = ({ item }: { item: InstalledApp }) => {
    const active = entriesMap.has(item.packageName);
    const entry = entriesMap.get(item.packageName);
    const isExpanded = expandedPkg === item.packageName;

    return (
      <View>
        <TouchableOpacity
          style={[styles.row, { backgroundColor: theme.card }, active && styles.rowActive]}
          onPress={() => {
            if (!active) {
              toggle(item.packageName);
            } else {
              setExpandedPkg((ep) => ep === item.packageName ? null : item.packageName);
            }
          }}
          onLongPress={() => toggle(item.packageName)}
          activeOpacity={0.7}
        >
          {item.iconBase64 ? (
            <Image source={{ uri: `data:image/png;base64,${item.iconBase64}` }} style={styles.icon} />
          ) : (
            <View style={styles.iconPlaceholder}>
              <Ionicons name="apps-outline" size={22} color={COLORS.muted} />
            </View>
          )}
          <View style={styles.appInfo}>
            <Text style={[styles.appName, { color: theme.text }]} numberOfLines={1}>
              {item.appName}
            </Text>
            <Text style={[styles.packageName, { color: theme.muted }]} numberOfLines={1}>
              {item.packageName}
            </Text>
            {active && entry && (
              <Text style={styles.activeLabel}>
                {entry.mode === 'count' && `${entry.countPerDay ?? 1} open${(entry.countPerDay ?? 1) !== 1 ? 's' : ''}/day`}
                {entry.mode === 'time_budget' && `${entry.budgetMinutes ?? 30} min/day`}
                {entry.mode === 'interval' && `${entry.intervalMinutes ?? 5} min every ${entry.intervalHours ?? 1}hr`}
              </Text>
            )}
          </View>
          <View style={styles.rightActions}>
            {active && (
              <Ionicons
                name={isExpanded ? 'chevron-up' : 'chevron-down'}
                size={14}
                color={COLORS.muted}
                style={{ marginRight: SPACING.xs }}
              />
            )}
            <TouchableOpacity
              style={[styles.toggleBox, active && styles.toggleBoxActive]}
              onPress={() => toggle(item.packageName)}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <Ionicons
                name={active ? 'sunny' : 'sunny-outline'}
                size={16}
                color={active ? COLORS.orange : COLORS.muted}
              />
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
        {active && entry && isExpanded && renderModeConfig(entry)}
      </View>
    );
  };

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <SafeAreaView style={[styles.container, { backgroundColor: theme.background }]}>

        {/* Header */}
        <View style={[styles.header, { backgroundColor: theme.card, borderBottomColor: theme.border }]}>
          <TouchableOpacity onPress={onClose} style={styles.headerBtn}>
            <Text style={styles.cancelText}>Cancel</Text>
          </TouchableOpacity>
          <View style={styles.headerCenter}>
            <Ionicons name="sunny" size={16} color={COLORS.orange} />
            <Text style={[styles.title, { color: theme.text }]}>Daily Allowance</Text>
          </View>
          <TouchableOpacity onPress={handleSave} style={styles.headerBtn} disabled={saving}>
            <Text style={[styles.saveText, saving && { opacity: 0.5 }]}>Save</Text>
          </TouchableOpacity>
        </View>

        {/* Lock banner — shown when a block is active */}
        {locked && (
          <View style={[styles.infoBanner, { backgroundColor: COLORS.orange + '18', borderBottomColor: COLORS.orange + '40' }]}>
            <Ionicons name="lock-closed-outline" size={14} color={COLORS.orange} />
            <Text style={styles.infoText}>
              Block is active — existing allowances are locked. You can add new apps but cannot remove any until the block expires.
            </Text>
          </View>
        )}

        {/* Info banner */}
        <View style={[styles.infoBanner, { backgroundColor: COLORS.orange + '15', borderBottomColor: COLORS.orange + '33' }]}>
          <Ionicons name="information-circle-outline" size={14} color={COLORS.orange} />
          <Text style={styles.infoText}>
            Tap an app to enable its allowance. Tap again to expand its mode settings.{' '}
            <Text style={{ fontWeight: '800' }}>Long-press to remove</Text>
            {locked && <Text> (locked apps cannot be removed)</Text>}
            <Text>.</Text>
          </Text>
        </View>

        <FlatList
          data={filtered}
          keyExtractor={(item) => item.packageName}
          renderItem={renderItem}
          ItemSeparatorComponent={() => <View style={[styles.sep, { backgroundColor: theme.border }]} />}
          keyboardShouldPersistTaps="handled"
          ListHeaderComponent={
            <>
              <View style={[styles.searchBox, { backgroundColor: theme.card, borderColor: theme.border }]}>
                <Ionicons name="search" size={16} color={COLORS.muted} />
                <TextInput
                  style={[styles.searchInput, { color: theme.text }]}
                  placeholder="Search apps…"
                  placeholderTextColor={COLORS.muted}
                  value={search}
                  onChangeText={setSearch}
                  autoCorrect={false}
                  clearButtonMode="while-editing"
                />
              </View>

              <Text style={[styles.countLabel, { color: theme.textSecondary }]}>
                {entriesMap.size > 0
                  ? `${entriesMap.size} app${entriesMap.size !== 1 ? 's' : ''} with daily allowance`
                  : 'No apps have a daily allowance — tap to add one'}
              </Text>

              {loading && (
                <View style={styles.loadingRow}>
                  <ActivityIndicator size="small" color={COLORS.primary} />
                  <Text style={[styles.loadingText, { color: theme.textSecondary }]}>
                    Loading installed apps…
                  </Text>
                </View>
              )}
            </>
          }
          ListEmptyComponent={
            !loading ? (
              <View style={styles.emptyWrap}>
                <Ionicons name="apps-outline" size={40} color={COLORS.border} />
                <Text style={[styles.emptyText, { color: theme.muted }]}>
                  {search ? 'No apps match your search.' : 'No user-installed apps found.'}
                </Text>
              </View>
            ) : null
          }
          ListFooterComponent={
            entriesMap.size > 0 && Array.from(entriesMap.keys()).some((pkg) => !isEntryLocked(pkg)) ? (
              <TouchableOpacity style={styles.clearBtn} onPress={() => {
                setEntriesMap((prev) => {
                  const next = new Map(prev);
                  for (const pkg of Array.from(next.keys())) {
                    if (!isEntryLocked(pkg)) next.delete(pkg);
                  }
                  return next;
                });
                setExpandedPkg(null);
              }}>
                <Ionicons name="close-circle-outline" size={16} color={COLORS.muted} />
                <Text style={styles.clearText}>{locked ? 'Clear New Allowances' : 'Clear All Daily Allowances'}</Text>
              </TouchableOpacity>
            ) : null
          }
        />
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm + 2,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerCenter: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.xs,
  },
  headerBtn: { minWidth: 60, alignItems: 'center', paddingVertical: SPACING.xs },
  cancelText: { fontSize: FONT.sm, color: COLORS.muted },
  saveText: { fontSize: FONT.sm, fontWeight: '700', color: COLORS.primary },
  title: { fontSize: FONT.md, fontWeight: '700' },

  infoBanner: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: SPACING.xs,
    paddingHorizontal: SPACING.lg,
    paddingVertical: SPACING.sm,
    borderBottomWidth: 1,
  },
  infoText: {
    flex: 1,
    fontSize: FONT.xs,
    color: COLORS.orange,
    lineHeight: 16,
  },

  searchBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
    marginHorizontal: SPACING.md,
    marginTop: SPACING.md,
    marginBottom: SPACING.xs,
    paddingHorizontal: SPACING.md,
    paddingVertical: Platform.OS === 'ios' ? SPACING.sm : SPACING.xs,
    borderRadius: RADIUS.lg,
    borderWidth: StyleSheet.hairlineWidth,
  },
  searchInput: { flex: 1, fontSize: FONT.sm },

  countLabel: {
    fontSize: FONT.xs,
    fontWeight: '600',
    marginHorizontal: SPACING.md,
    marginBottom: SPACING.sm,
  },

  loadingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: SPACING.sm,
    paddingVertical: SPACING.lg,
  },
  loadingText: { fontSize: FONT.sm },

  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
    gap: SPACING.sm,
  },
  rowActive: {
    borderLeftWidth: 3,
    borderLeftColor: COLORS.orange,
  },
  icon: { width: 40, height: 40, borderRadius: RADIUS.sm },
  iconPlaceholder: {
    width: 40,
    height: 40,
    borderRadius: RADIUS.sm,
    backgroundColor: COLORS.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  appInfo: { flex: 1, gap: 1 },
  appName: { fontSize: FONT.sm, fontWeight: '600' },
  packageName: { fontSize: FONT.xs },
  activeLabel: {
    fontSize: FONT.xs,
    color: COLORS.orange,
    fontWeight: '600',
    marginTop: 1,
  },

  rightActions: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  toggleBox: {
    width: 32,
    height: 32,
    borderRadius: RADIUS.md,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.surface,
  },
  toggleBoxActive: {
    backgroundColor: COLORS.orange + '20',
  },

  // Config panel (expanded per-app settings)
  configPanel: {
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    gap: SPACING.sm,
  },
  configLabel: {
    fontSize: FONT.xs,
    fontWeight: '700',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
  },
  modeRow: {
    flexDirection: 'row',
    gap: SPACING.xs,
  },
  modeBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    paddingVertical: SPACING.xs + 2,
    borderRadius: RADIUS.md,
    borderWidth: 1.5,
  },
  modeBtnActive: {
    borderColor: COLORS.orange,
    backgroundColor: COLORS.orange + '15',
  },
  modeBtnDisabled: {
    opacity: 0.45,
  },
  modeBtnText: {
    fontSize: FONT.xs,
    fontWeight: '600',
    color: COLORS.muted,
  },
  modeBtnTextActive: {
    color: COLORS.orange,
  },

  configRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: SPACING.sm,
  },
  configFieldLabel: {
    flex: 1,
    fontSize: FONT.xs,
    lineHeight: 16,
  },
  stepper: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.xs,
  },
  stepBtn: {
    width: 28,
    height: 28,
    borderRadius: RADIUS.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepBtnDisabled: {
    opacity: 0.35,
  },
  lockNotice: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginBottom: 2,
  },
  lockNoticeText: {
    fontSize: FONT.xs,
    color: COLORS.orange,
    fontStyle: 'italic',
  },
  stepValue: {
    minWidth: 52,
    textAlign: 'center',
    fontSize: FONT.sm,
    fontWeight: '700',
  },
  intervalSummary: {
    fontSize: FONT.xs,
    fontStyle: 'italic',
    marginTop: 2,
  },

  sep: { height: StyleSheet.hairlineWidth, marginLeft: 56 + SPACING.md },

  emptyWrap: {
    paddingTop: SPACING.xl * 2,
    alignItems: 'center',
    gap: SPACING.sm,
  },
  emptyText: { fontSize: FONT.sm },

  clearBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: SPACING.xs,
    marginVertical: SPACING.lg,
    padding: SPACING.md,
  },
  clearText: {
    fontSize: FONT.sm,
    color: COLORS.muted,
  },
});
