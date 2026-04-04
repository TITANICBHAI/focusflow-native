import React, { useEffect, useState, useMemo } from 'react';
import {
  View,
  Text,
  Modal,
  FlatList,
  TextInput,
  TouchableOpacity,
  Image,
  ActivityIndicator,
  StyleSheet,
  SafeAreaView,
  Platform,
  Alert,
} from 'react-native';
import DateTimePicker, { type DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { Ionicons } from '@expo/vector-icons';
import dayjs from 'dayjs';
import { InstalledAppsModule, InstalledApp } from '@/native-modules/InstalledAppsModule';
import { COLORS, FONT, RADIUS, SPACING } from '@/styles/theme';
import { useTheme } from '@/hooks/useTheme';
import type { DailyAllowanceEntry } from '@/data/types';

interface Props {
  visible: boolean;
  blockedPackages: string[];
  blockUntil: string | null;
  locked?: boolean;
  dailyAllowanceEntries?: DailyAllowanceEntry[];
  onSave: (packages: string[], untilMs: number | null) => void | Promise<void>;
  onSaveDailyAllowance?: (entries: DailyAllowanceEntry[]) => void | Promise<void>;
  onClose: () => void;
}

/**
 * StandaloneBlockModal
 *
 * Lets the user pick apps to block and set an expiry date/time.
 * Independent of any task — the block persists until the expiry, regardless
 * of whether a task focus session is running or not.
 *
 * Renders immediately with a manual entry field at the top.
 * The auto-detected installed apps list loads asynchronously in the background.
 */
export function StandaloneBlockModal({
  visible,
  blockedPackages,
  blockUntil,
  locked = false,
  dailyAllowanceEntries = [],
  onSave,
  onSaveDailyAllowance,
  onClose,
}: Props) {
  const { theme } = useTheme();
  const [apps, setApps] = useState<InstalledApp[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set(blockedPackages));
  // Derive allowed-package set from entries (for display) and keep the full entries map for saving
  const [dailyEntriesMap, setDailyEntriesMap] = useState<Map<string, DailyAllowanceEntry>>(
    new Map(dailyAllowanceEntries.map((e) => [e.packageName, e]))
  );
  const dailyAllowed = useMemo(() => new Set(dailyEntriesMap.keys()), [dailyEntriesMap]);
  const [search, setSearch] = useState('');
  const [loadingApps, setLoadingApps] = useState(false);
  const [saving, setSaving] = useState(false);
  const [manualInput, setManualInput] = useState('');
  const [manualPackages, setManualPackages] = useState<string[]>([]);

  const defaultUntil = blockUntil ? new Date(blockUntil) : dayjs().add(1, 'day').toDate();
  const [untilDate, setUntilDate] = useState<Date>(defaultUntil);
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [showTimePicker, setShowTimePicker] = useState(false);

  useEffect(() => {
    if (!visible) return;
    setSelected(new Set(blockedPackages));
    setDailyEntriesMap(new Map(dailyAllowanceEntries.map((e) => [e.packageName, e])));
    setSearch('');
    setManualInput('');
    setUntilDate(blockUntil ? new Date(blockUntil) : dayjs().add(1, 'day').toDate());

    // Derive manual packages from existing blocked list before apps load
    const existingManual = blockedPackages.filter(
      (pkg) => !apps.some((a) => a.packageName === pkg)
    );
    setManualPackages(existingManual);

    // Load apps asynchronously — modal is already visible
    void loadApps();
  }, [visible]);

  const loadApps = async () => {
    setLoadingApps(true);
    try {
      const result = await InstalledAppsModule.getInstalledApps();
      const sorted = result.slice().sort((a, b) =>
        a.appName.toLowerCase().localeCompare(b.appName.toLowerCase())
      );
      setApps(sorted);
      // Re-derive manual packages now that we have the installed list
      setManualPackages((prev) => {
        const installedPkgs = new Set(sorted.map((a) => a.packageName));
        const fromCurrent = Array.from(selected).filter((pkg) => !installedPkgs.has(pkg));
        const union = new Set([...prev, ...fromCurrent]);
        return Array.from(union);
      });
    } catch (e) {
      console.warn('[StandaloneBlockModal] Failed to load apps', e);
    } finally {
      setLoadingApps(false);
    }
  };

  const filtered = useMemo(() => {
    if (!search.trim()) return apps;
    const q = search.toLowerCase();
    return apps.filter(
      (a) =>
        a.appName.toLowerCase().includes(q) ||
        a.packageName.toLowerCase().includes(q)
    );
  }, [apps, search]);

  const lockedSet = useMemo(() => new Set(blockedPackages), [blockedPackages]);

  const toggle = (packageName: string) => {
    if (locked && lockedSet.has(packageName)) return;
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(packageName)) {
        next.delete(packageName);
      } else {
        next.add(packageName);
      }
      return next;
    });
  };

  const toggleDailyAllowed = (packageName: string) => {
    setDailyEntriesMap((prev) => {
      const next = new Map(prev);
      if (next.has(packageName)) {
        next.delete(packageName);
      } else {
        next.set(packageName, {
          packageName,
          mode: 'count',
          countPerDay: 1,
          budgetMinutes: 30,
          intervalMinutes: 5,
          intervalHours: 1,
        });
      }
      return next;
    });
  };

  const adjustDailyCount = (packageName: string, delta: number) => {
    setDailyEntriesMap((prev) => {
      const next = new Map(prev);
      const existing = next.get(packageName);
      if (!existing) return next;
      const newCount = Math.min(20, Math.max(1, (existing.countPerDay ?? 1) + delta));
      next.set(packageName, { ...existing, countPerDay: newCount });
      return next;
    });
  };

  const handleAddManual = () => {
    const pkg = manualInput.trim().toLowerCase();
    if (!pkg || !pkg.includes('.')) return;
    if (!manualPackages.includes(pkg)) {
      setManualPackages((prev) => [...prev, pkg]);
    }
    setSelected((prev) => new Set([...prev, pkg]));
    setManualInput('');
  };

  const handleSave = async () => {
    if (selected.size === 0) {
      Alert.alert(
        'No Apps Selected',
        'Select at least one app to block, or use Clear Block to disable.',
        [{ text: 'OK' }]
      );
      return;
    }
    if (untilDate.getTime() <= Date.now()) {
      Alert.alert(
        'Expiry in the Past',
        'Please set a future date and time for the block to expire.',
        [{ text: 'OK' }]
      );
      return;
    }
    setSaving(true);
    try {
      await onSave(Array.from(selected), untilDate.getTime());
      if (onSaveDailyAllowance) {
        await onSaveDailyAllowance(Array.from(dailyEntriesMap.values()));
      }
      onClose();
    } catch (e) {
      console.error('[StandaloneBlockModal] Failed to save', e);
    } finally {
      setSaving(false);
    }
  };

  const handleClear = async () => {
    Alert.alert(
      'Clear Block',
      'This will disable the app block schedule and allow all apps again.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Clear',
          style: 'destructive',
          onPress: async () => {
            try {
              await onSave([], null);
              onClose();
            } catch (e) {
              console.error('[StandaloneBlockModal] Failed to clear', e);
            }
          },
        },
      ]
    );
  };

  const onDateChange = (_: DateTimePickerEvent, date?: Date) => {
    setShowDatePicker(false);
    if (date) {
      const merged = dayjs(date)
        .hour(untilDate.getHours())
        .minute(untilDate.getMinutes())
        .second(0)
        .toDate();
      setUntilDate(merged);
    }
  };

  const onTimeChange = (_: DateTimePickerEvent, date?: Date) => {
    setShowTimePicker(false);
    if (date) {
      const merged = dayjs(untilDate)
        .hour(date.getHours())
        .minute(date.getMinutes())
        .second(0)
        .toDate();
      setUntilDate(merged);
    }
  };

  const renderItem = ({ item }: { item: InstalledApp }) => {
    const blocked = selected.has(item.packageName);
    const isDaily = dailyAllowed.has(item.packageName);
    const dailyEntry = dailyEntriesMap.get(item.packageName);
    return (
      <View style={styles.rowWrap}>
        <TouchableOpacity style={[styles.row, { backgroundColor: theme.card }]} onPress={() => toggle(item.packageName)} activeOpacity={0.7}>
          {item.iconBase64 ? (
            <Image
              source={{ uri: `data:image/png;base64,${item.iconBase64}` }}
              style={styles.icon}
            />
          ) : (
            <View style={styles.iconPlaceholder}>
              <Ionicons name="apps-outline" size={22} color={COLORS.muted} />
            </View>
          )}
          <View style={styles.appInfo}>
            <Text style={[styles.appName, { color: theme.text }]} numberOfLines={1}>{item.appName}</Text>
            <Text style={[styles.packageName, { color: theme.muted }]} numberOfLines={1}>{item.packageName}</Text>
          </View>
          <View style={[styles.checkbox, { borderColor: theme.border }, blocked && styles.checkboxBlocked]}>
            {blocked && <Ionicons name="ban" size={13} color="#fff" />}
          </View>
        </TouchableOpacity>
        {/* Daily allowance row — toggle + inline count stepper when active */}
        <View style={[styles.dailyRow, { backgroundColor: theme.surface, borderTopColor: theme.border }, isDaily && styles.dailyRowActive]}>
          <TouchableOpacity style={styles.dailyToggle} onPress={() => toggleDailyAllowed(item.packageName)} activeOpacity={0.7}>
            <Ionicons
              name={isDaily ? 'sunny' : 'sunny-outline'}
              size={13}
              color={isDaily ? COLORS.orange : COLORS.muted}
            />
            <Text style={[styles.dailyText, isDaily && styles.dailyTextActive]}>
              {isDaily ? 'Daily allowance:' : 'Add daily allowance'}
            </Text>
          </TouchableOpacity>
          {isDaily && dailyEntry && (
            <View style={styles.dailyStepper}>
              <TouchableOpacity onPress={() => adjustDailyCount(item.packageName, -1)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                <Ionicons name="remove-circle-outline" size={18} color={COLORS.orange} />
              </TouchableOpacity>
              <Text style={styles.dailyCountText}>{dailyEntry.countPerDay ?? 1}×/day</Text>
              <TouchableOpacity onPress={() => adjustDailyCount(item.packageName, 1)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                <Ionicons name="add-circle-outline" size={18} color={COLORS.orange} />
              </TouchableOpacity>
            </View>
          )}
        </View>
      </View>
    );
  };

  const renderManualPackage = (pkg: string) => {
    const blocked = selected.has(pkg);
    const isDaily = dailyAllowed.has(pkg);
    const dailyEntry = dailyEntriesMap.get(pkg);
    return (
      <View key={pkg} style={styles.rowWrap}>
        <TouchableOpacity style={[styles.row, { backgroundColor: theme.card }]} onPress={() => toggle(pkg)} activeOpacity={0.7}>
          <View style={styles.iconPlaceholder}>
            <Ionicons name="cube-outline" size={22} color={COLORS.muted} />
          </View>
          <View style={styles.appInfo}>
            <Text style={[styles.appName, { color: theme.text }]} numberOfLines={1}>Manual Entry</Text>
            <Text style={[styles.packageName, { color: theme.muted }]} numberOfLines={1}>{pkg}</Text>
          </View>
          <View style={[styles.checkbox, { borderColor: theme.border }, blocked && styles.checkboxBlocked]}>
            {blocked && <Ionicons name="ban" size={13} color="#fff" />}
          </View>
        </TouchableOpacity>
        <View style={[styles.dailyRow, { backgroundColor: theme.surface, borderTopColor: theme.border }, isDaily && styles.dailyRowActive]}>
          <TouchableOpacity style={styles.dailyToggle} onPress={() => toggleDailyAllowed(pkg)} activeOpacity={0.7}>
            <Ionicons name={isDaily ? 'sunny' : 'sunny-outline'} size={13} color={isDaily ? COLORS.orange : COLORS.muted} />
            <Text style={[styles.dailyText, isDaily && styles.dailyTextActive]}>
              {isDaily ? 'Daily allowance:' : 'Add daily allowance'}
            </Text>
          </TouchableOpacity>
          {isDaily && dailyEntry && (
            <View style={styles.dailyStepper}>
              <TouchableOpacity onPress={() => adjustDailyCount(pkg, -1)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                <Ionicons name="remove-circle-outline" size={18} color={COLORS.orange} />
              </TouchableOpacity>
              <Text style={styles.dailyCountText}>{dailyEntry.countPerDay ?? 1}×/day</Text>
              <TouchableOpacity onPress={() => adjustDailyCount(pkg, 1)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                <Ionicons name="add-circle-outline" size={18} color={COLORS.orange} />
              </TouchableOpacity>
            </View>
          )}
        </View>
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
          <Text style={[styles.title, { color: theme.text }]}>{locked ? '🔒 Block Active' : 'Block Schedule'}</Text>
          <TouchableOpacity onPress={handleSave} style={styles.headerBtn} disabled={saving}>
            <Text style={[styles.saveText, saving && { opacity: 0.5 }]}>Save</Text>
          </TouchableOpacity>
        </View>

        {/* Locked banner */}
        {locked && (
          <View style={styles.lockedBanner}>
            <Ionicons name="lock-closed" size={14} color={COLORS.orange} />
            <Text style={styles.lockedBannerText}>
              Block is active — you can add more apps but cannot remove any until it expires.
            </Text>
          </View>
        )}

        {/* Expiry date/time pickers */}
        <View style={[styles.expirySection, { backgroundColor: theme.card, borderColor: theme.border }, locked && styles.expirySectionLocked]}>
          <Text style={[styles.expirySectionLabel, { color: theme.textSecondary }]}>Block until</Text>
          <View style={styles.expiryRow}>
            <TouchableOpacity
              style={[styles.expiryBtn, locked && styles.expiryBtnLocked]}
              onPress={() => !locked && setShowDatePicker(true)}
              activeOpacity={locked ? 1 : 0.7}
            >
              <Ionicons name="calendar-outline" size={16} color={locked ? COLORS.muted : COLORS.primary} />
              <Text style={[styles.expiryBtnText, locked && { color: COLORS.muted }]}>
                {dayjs(untilDate).format('MMM D, YYYY')}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.expiryBtn, locked && styles.expiryBtnLocked]}
              onPress={() => !locked && setShowTimePicker(true)}
              activeOpacity={locked ? 1 : 0.7}
            >
              <Ionicons name="time-outline" size={16} color={locked ? COLORS.muted : COLORS.primary} />
              <Text style={[styles.expiryBtnText, locked && { color: COLORS.muted }]}>
                {dayjs(untilDate).format('h:mm A')}
              </Text>
            </TouchableOpacity>
          </View>
        </View>

        {showDatePicker && (
          <DateTimePicker
            value={untilDate}
            mode="date"
            display={Platform.OS === 'ios' ? 'spinner' : 'default'}
            minimumDate={new Date()}
            onChange={onDateChange}
          />
        )}
        {showTimePicker && (
          <DateTimePicker
            value={untilDate}
            mode="time"
            display={Platform.OS === 'ios' ? 'spinner' : 'clock'}
            onChange={onTimeChange}
          />
        )}

        <FlatList
          data={filtered}
          keyExtractor={(item) => item.packageName}
          renderItem={renderItem}
          ItemSeparatorComponent={() => <View style={styles.separator} />}
          contentContainerStyle={styles.list}
          keyboardShouldPersistTaps="handled"
          ListHeaderComponent={
            <>
              {/* Manual entry — always shown at the top, primary option */}
              <View style={[styles.manualSection, { backgroundColor: theme.card, borderColor: theme.border }]}>
                <Text style={[styles.manualSectionLabel, { color: theme.muted }]}>ADD BY PACKAGE NAME</Text>
                <Text style={[styles.manualHint, { color: theme.textSecondary }]}>
                  Enter app package name, e.g. com.instagram.android
                </Text>
                <View style={[styles.installerTip, { backgroundColor: theme.surface }]}>
                  <Ionicons name="information-circle-outline" size={14} color={COLORS.muted} />
                  <Text style={[styles.installerTipText, { color: theme.textSecondary }]}>
                    To block the Android Package Installer / Uninstaller, add it manually:{' '}
                    <Text style={styles.installerTipCode}>com.android.packageinstaller</Text>
                  </Text>
                </View>
                <View style={styles.manualInputRow}>
                  <TextInput
                    style={[styles.manualInput, { backgroundColor: theme.surface, color: theme.text, borderColor: theme.border }]}
                    placeholder="com.example.app"
                    placeholderTextColor={COLORS.muted}
                    value={manualInput}
                    onChangeText={setManualInput}
                    autoCapitalize="none"
                    autoCorrect={false}
                    onSubmitEditing={handleAddManual}
                    returnKeyType="done"
                  />
                  <TouchableOpacity
                    style={[styles.addBtn, !manualInput.trim().includes('.') && styles.addBtnDisabled]}
                    onPress={handleAddManual}
                    disabled={!manualInput.trim().includes('.')}
                  >
                    <Text style={styles.addBtnText}>Add</Text>
                  </TouchableOpacity>
                </View>
              </View>

              {/* Manually added packages */}
              {manualPackages.length > 0 && (
                <View style={[styles.manualSection, { backgroundColor: theme.card, borderColor: theme.border }]}>
                  <Text style={[styles.manualSectionLabel, { color: theme.muted }]}>MANUALLY ADDED</Text>
                  {manualPackages.map(renderManualPackage)}
                </View>
              )}

              {/* Search and installed apps header */}
              <View style={[styles.searchContainer, { backgroundColor: theme.card, borderColor: theme.border }]}>
                <Ionicons name="search" size={16} color={COLORS.muted} style={styles.searchIcon} />
                <TextInput
                  style={[styles.searchInput, { color: theme.text }]}
                  placeholder="Search installed apps…"
                  placeholderTextColor={COLORS.muted}
                  value={search}
                  onChangeText={setSearch}
                  autoCorrect={false}
                  clearButtonMode="while-editing"
                />
              </View>

              <Text style={[styles.hint, { color: theme.textSecondary }]}>
                {selected.size > 0
                  ? `${selected.size} app${selected.size !== 1 ? 's' : ''} will be blocked — tap to toggle`
                  : 'Tap apps below to block them'}
              </Text>

              {loadingApps && (
                <View style={styles.loadingRow}>
                  <ActivityIndicator size="small" color={COLORS.primary} />
                  <Text style={[styles.loadingText, { color: theme.textSecondary }]}>Loading installed apps…</Text>
                </View>
              )}
            </>
          }
          ListEmptyComponent={
            !loadingApps ? (
              <View style={styles.emptyContainer}>
                <Text style={styles.emptyText}>
                  {search ? 'No apps match your search.' : 'No user-installed apps found.'}
                </Text>
              </View>
            ) : null
          }
          ListFooterComponent={
            selected.size > 0 && !locked ? (
              <TouchableOpacity style={styles.clearBtn} onPress={handleClear}>
                <Ionicons name="trash-outline" size={16} color={COLORS.red} />
                <Text style={styles.clearBtnText}>Clear Block</Text>
              </TouchableOpacity>
            ) : null
          }
        />
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: SPACING.lg,
    paddingVertical: SPACING.md,
    backgroundColor: COLORS.card,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: COLORS.border,
  },
  headerBtn: {
    minWidth: 60,
    paddingVertical: SPACING.sm,
    paddingHorizontal: SPACING.xs,
  },
  title: {
    fontSize: FONT.md,
    fontWeight: '700',
    color: COLORS.text,
  },
  cancelText: {
    fontSize: FONT.md,
    color: COLORS.muted,
  },
  saveText: {
    fontSize: FONT.md,
    fontWeight: '700',
    color: COLORS.primary,
    textAlign: 'right',
  },
  expirySection: {
    backgroundColor: COLORS.card,
    paddingHorizontal: SPACING.lg,
    paddingVertical: SPACING.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: COLORS.border,
    gap: SPACING.xs,
  },
  expirySectionLabel: {
    fontSize: FONT.xs,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    color: COLORS.muted,
  },
  expiryRow: {
    flexDirection: 'row',
    gap: SPACING.sm,
  },
  expiryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.xs,
    backgroundColor: COLORS.primaryLight,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
    borderRadius: RADIUS.lg,
  },
  expiryBtnText: {
    fontSize: FONT.sm,
    fontWeight: '600',
    color: COLORS.primary,
  },
  expirySectionLocked: {
    opacity: 0.5,
  },
  expiryBtnLocked: {
    backgroundColor: COLORS.border,
  },
  lockedBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
    backgroundColor: COLORS.orange + '18',
    borderLeftWidth: 3,
    borderLeftColor: COLORS.orange,
    paddingHorizontal: SPACING.lg,
    paddingVertical: SPACING.sm,
  },
  lockedBannerText: {
    flex: 1,
    fontSize: FONT.xs,
    color: COLORS.orange,
    lineHeight: 16,
  },
  list: {
    paddingHorizontal: SPACING.lg,
    paddingBottom: SPACING.xl,
  },
  manualSection: {
    marginTop: SPACING.lg,
    gap: SPACING.sm,
  },
  manualSectionLabel: {
    fontSize: FONT.xs,
    fontWeight: '700',
    color: COLORS.muted,
    letterSpacing: 0.8,
    marginBottom: SPACING.xs,
  },
  manualHint: {
    fontSize: FONT.xs,
    color: COLORS.muted,
  },
  installerTip: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: SPACING.xs,
    backgroundColor: COLORS.surface,
    borderRadius: RADIUS.sm,
    padding: SPACING.sm,
  },
  installerTipText: {
    flex: 1,
    fontSize: FONT.xs,
    color: COLORS.muted,
    lineHeight: 16,
  },
  installerTipCode: {
    fontFamily: 'monospace',
    color: COLORS.text,
  },
  manualInputRow: {
    flexDirection: 'row',
    gap: SPACING.sm,
    alignItems: 'center',
  },
  manualInput: {
    flex: 1,
    backgroundColor: COLORS.card,
    borderRadius: RADIUS.md,
    borderWidth: 1.5,
    borderColor: COLORS.primary + '66',
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
    fontSize: FONT.md,
    color: COLORS.text,
  },
  addBtn: {
    backgroundColor: COLORS.primary,
    borderRadius: RADIUS.md,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  addBtnDisabled: {
    backgroundColor: COLORS.primaryLight,
  },
  addBtnText: {
    color: '#fff',
    fontWeight: '700',
    fontSize: FONT.sm,
  },
  searchContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.card,
    marginTop: SPACING.lg,
    borderRadius: RADIUS.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: COLORS.border,
    paddingHorizontal: SPACING.md,
  },
  searchIcon: {
    marginRight: SPACING.xs,
  },
  searchInput: {
    flex: 1,
    height: 40,
    fontSize: FONT.md,
    color: COLORS.text,
  },
  hint: {
    fontSize: FONT.xs,
    color: COLORS.muted,
    paddingTop: SPACING.sm,
    paddingBottom: SPACING.xs,
  },
  loadingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
    paddingVertical: SPACING.sm,
  },
  loadingText: {
    fontSize: FONT.sm,
    color: COLORS.muted,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.card,
    borderRadius: RADIUS.md,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
    gap: SPACING.sm,
  },
  icon: {
    width: 40,
    height: 40,
    borderRadius: RADIUS.sm,
  },
  iconPlaceholder: {
    width: 40,
    height: 40,
    borderRadius: RADIUS.sm,
    backgroundColor: COLORS.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  appInfo: {
    flex: 1,
  },
  appName: {
    fontSize: FONT.md,
    fontWeight: '600',
    color: COLORS.text,
  },
  packageName: {
    fontSize: FONT.xs,
    color: COLORS.muted,
    marginTop: 2,
  },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: RADIUS.sm,
    borderWidth: 2,
    borderColor: COLORS.border,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.surface,
  },
  checkboxBlocked: {
    backgroundColor: COLORS.red,
    borderColor: COLORS.red,
  },
  separator: {
    height: SPACING.xs,
  },
  rowWrap: {
    gap: 0,
  },
  dailyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: SPACING.md,
    paddingVertical: 5,
    marginTop: -2,
    backgroundColor: COLORS.surface,
    borderBottomLeftRadius: RADIUS.md,
    borderBottomRightRadius: RADIUS.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: COLORS.border,
  },
  dailyRowActive: {
    backgroundColor: COLORS.orange + '15',
    borderTopColor: COLORS.orange + '33',
  },
  dailyToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.xs,
    flex: 1,
  },
  dailyText: {
    fontSize: FONT.xs,
    color: COLORS.muted,
  },
  dailyTextActive: {
    color: COLORS.orange,
    fontWeight: '600',
  },
  dailyStepper: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.xs,
  },
  dailyCountText: {
    fontSize: FONT.xs,
    fontWeight: '700',
    color: COLORS.orange,
    minWidth: 40,
    textAlign: 'center',
  },
  emptyContainer: {
    paddingTop: SPACING.xl,
    alignItems: 'center',
  },
  emptyText: {
    fontSize: FONT.sm,
    color: COLORS.muted,
  },
  clearBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: SPACING.sm,
    marginTop: SPACING.xl,
    paddingVertical: SPACING.md,
    borderRadius: RADIUS.lg,
    borderWidth: 1.5,
    borderColor: COLORS.red + '44',
    backgroundColor: COLORS.redLight,
  },
  clearBtnText: {
    fontSize: FONT.sm,
    fontWeight: '600',
    color: COLORS.red,
  },
});
