/**
 * ImportFromOtherAppModal.tsx
 *
 * Lets the user import a blocked-app list from any popular app-blocker.
 * Supported formats (auto-detected):
 *   - Plain text:  one Android package name per line (.txt)
 *   - CSV:         any column containing valid package names (.csv)
 *   - JSON:        arrays / objects with packageName / package / appId keys (.json)
 *                  Covers: AppBlock, StayFree, ActionDash, Digital Wellbeing Takeout, etc.
 *   - Mixed:       anything else — scanned line-by-line for package name patterns
 *
 * After picking a file the user sees a preview of matched installed apps and
 * taps "Add to Block List" to merge them into the standalone block list.
 */

import React, { useState, useMemo, useCallback } from 'react';
import {
  View,
  Text,
  Modal,
  ScrollView,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  SafeAreaView,
  Image,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, FONT, RADIUS, SPACING } from '@/styles/theme';
import { NativeFilePickerModule } from '@/native-modules/NativeFilePickerModule';
import { InstalledAppsModule, type InstalledApp } from '@/native-modules/InstalledAppsModule';

// ─── Package-name detector ────────────────────────────────────────────────────

const PKG_RE = /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/i;
function looksLikePkg(s: string): boolean {
  const t = s.trim();
  return t.length >= 5 && t.length <= 200 && PKG_RE.test(t) && t.includes('.');
}

function extractPackages(content: string, filename: string): string[] {
  const ext = filename.split('.').pop()?.toLowerCase() ?? '';
  const first = content.trimStart()[0];

  if (ext === 'json' || first === '{' || first === '[') {
    const pkgs = extractFromJson(content);
    if (pkgs.length > 0) return pkgs;
  }

  if (ext === 'csv' || (content.includes(',') && content.includes('\n'))) {
    const pkgs = extractFromCsv(content);
    if (pkgs.length > 0) return pkgs;
  }

  return extractFromText(content);
}

function extractFromText(content: string): string[] {
  const seen = new Set<string>();
  content.split(/\r?\n/).forEach((line) => {
    line.split(/[\s,;|]+/).forEach((tok) => {
      const t = tok.replace(/^["'`]|["'`]$/g, '');
      if (looksLikePkg(t)) seen.add(t);
    });
  });
  return Array.from(seen);
}

function extractFromCsv(content: string): string[] {
  const seen = new Set<string>();
  content.split(/\r?\n/).forEach((line) => {
    line.split(',').forEach((cell) => {
      const t = cell.trim().replace(/^"|"$/g, '');
      if (looksLikePkg(t)) seen.add(t);
    });
  });
  return Array.from(seen);
}

function extractFromJson(content: string): string[] {
  try {
    const parsed = JSON.parse(content);
    const seen = new Set<string>();
    const PKG_KEYS = [
      'packageName', 'package', 'pkg', 'appId',
      'bundleId', 'app_package', 'appPackage', 'id', 'name',
    ];

    function walk(v: unknown) {
      if (typeof v === 'string') {
        if (looksLikePkg(v)) seen.add(v);
      } else if (Array.isArray(v)) {
        v.forEach(walk);
      } else if (v && typeof v === 'object') {
        const obj = v as Record<string, unknown>;
        for (const key of PKG_KEYS) {
          if (typeof obj[key] === 'string' && looksLikePkg(obj[key] as string)) {
            seen.add(obj[key] as string);
          }
        }
        Object.values(obj).forEach(walk);
      }
    }
    walk(parsed);
    return Array.from(seen);
  } catch {
    return [];
  }
}

// ─── Supported source info ────────────────────────────────────────────────────

const SOURCES: { name: string; hint: string; icon: string }[] = [
  {
    name: 'AppBlock',
    hint: 'Settings → Backup → Export → share the .json file',
    icon: 'shield-checkmark-outline',
  },
  {
    name: 'StayFree – Screen Time',
    hint: 'Reports → Export → share the .csv or .json file',
    icon: 'time-outline',
  },
  {
    name: 'ActionDash',
    hint: 'Export weekly usage → share the .csv file',
    icon: 'analytics-outline',
  },
  {
    name: 'Digital Wellbeing (Google Takeout)',
    hint: 'takeout.google.com → select Digital Wellbeing → download & unzip → pick the JSON inside',
    icon: 'heart-outline',
  },
  {
    name: 'Plain text / any format',
    hint: 'Any file with Android package names — FocusFlow auto-detects them',
    icon: 'document-text-outline',
  },
];

// ─── Props ────────────────────────────────────────────────────────────────────

interface Props {
  visible: boolean;
  onClose: () => void;
  onImport: (packages: string[]) => Promise<void>;
}

type Step = 'sources' | 'preview';

// ─── Component ───────────────────────────────────────────────────────────────

export function ImportFromOtherAppModal({ visible, onClose, onImport }: Props) {
  const [step, setStep] = useState<Step>('sources');
  const [loading, setLoading] = useState(false);
  const [importing, setImporting] = useState(false);
  const [detectedPkgs, setDetectedPkgs] = useState<string[]>([]);
  const [installedApps, setInstalledApps] = useState<InstalledApp[]>([]);
  const [filename, setFilename] = useState('');

  const installedMap = useMemo(
    () => new Map(installedApps.map((a) => [a.packageName, a])),
    [installedApps],
  );

  const matchedApps = useMemo(
    () => detectedPkgs.map((pkg) => ({ pkg, app: installedMap.get(pkg) })).filter(({ app }) => !!app),
    [detectedPkgs, installedMap],
  );

  const unmatchedCount = detectedPkgs.length - matchedApps.length;

  const resetState = useCallback(() => {
    setStep('sources');
    setDetectedPkgs([]);
    setInstalledApps([]);
    setFilename('');
  }, []);

  const handleClose = useCallback(() => {
    resetState();
    onClose();
  }, [resetState, onClose]);

  const handleBrowse = useCallback(async () => {
    setLoading(true);
    try {
      const picked = await NativeFilePickerModule.pickFile('*/*');
      if (!picked) return;

      const pkgs = extractPackages(picked.content, picked.name);
      if (pkgs.length === 0) {
        Alert.alert(
          'No apps found',
          'Could not find any Android package names in this file.\n\nMake sure you exported the block list from your other app, then try again.',
        );
        return;
      }

      const apps = await InstalledAppsModule.getInstalledApps();
      setInstalledApps(apps);
      setDetectedPkgs(pkgs);
      setFilename(picked.name);
      setStep('preview');
    } catch (e) {
      Alert.alert('Error reading file', String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  const handleConfirmImport = useCallback(() => {
    const toImport = matchedApps.map(({ pkg }) => pkg);
    if (toImport.length === 0) {
      Alert.alert('Nothing to import', 'None of the detected apps are installed on this device.');
      return;
    }
    Alert.alert(
      `Add ${toImport.length} app${toImport.length !== 1 ? 's' : ''} to Block List?`,
      'These apps will be added to your Standalone Block list. You can review or remove them from Block Controls at any time.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Add to Block List',
          onPress: async () => {
            setImporting(true);
            try {
              await onImport(toImport);
              handleClose();
            } finally {
              setImporting(false);
            }
          },
        },
      ],
    );
  }, [matchedApps, onImport, handleClose]);

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={handleClose}
    >
      <SafeAreaView style={styles.container}>
        {/* Header */}
        <View style={styles.header}>
          {step === 'preview' ? (
            <TouchableOpacity onPress={() => setStep('sources')} style={styles.headerSide}>
              <Ionicons name="chevron-back" size={20} color={COLORS.primary} />
              <Text style={styles.backText}>Back</Text>
            </TouchableOpacity>
          ) : (
            <TouchableOpacity onPress={handleClose} style={styles.headerSide}>
              <Text style={styles.cancelText}>Cancel</Text>
            </TouchableOpacity>
          )}
          <Text style={styles.headerTitle}>Import Block List</Text>
          <View style={styles.headerSide} />
        </View>

        {step === 'sources' ? (
          <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
            {/* Intro banner */}
            <View style={styles.introBanner}>
              <Ionicons name="swap-horizontal-outline" size={32} color={COLORS.primary} />
              <Text style={styles.introTitle}>Import from another app</Text>
              <Text style={styles.introSub}>
                Pick an exported file from any app-blocker. FocusFlow auto-detects the format and pulls in the package list — no manual copy-pasting needed.
              </Text>
            </View>

            {/* Supported sources */}
            <Text style={styles.sectionLabel}>SUPPORTED SOURCES</Text>
            {SOURCES.map((src) => (
              <View key={src.name} style={styles.sourceCard}>
                <View style={styles.sourceIconWrap}>
                  <Ionicons name={src.icon as never} size={20} color={COLORS.primary} />
                </View>
                <View style={styles.sourceText}>
                  <Text style={styles.sourceName}>{src.name}</Text>
                  <Text style={styles.sourceHint}>{src.hint}</Text>
                </View>
              </View>
            ))}

            {/* Browse button */}
            <TouchableOpacity
              style={[styles.browseBtn, loading && styles.browseBtnDim]}
              onPress={handleBrowse}
              disabled={loading}
              activeOpacity={0.8}
            >
              {loading ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <Ionicons name="folder-open-outline" size={20} color="#fff" />
              )}
              <Text style={styles.browseBtnText}>{loading ? 'Reading file…' : 'Browse & Import'}</Text>
            </TouchableOpacity>

            <Text style={styles.footnote}>
              Only apps that are installed on this device will be imported. Uninstalled apps are automatically skipped.
            </Text>
          </ScrollView>
        ) : (
          /* ── Preview step ── */
          <View style={{ flex: 1 }}>
            {/* File meta */}
            <View style={styles.fileMeta}>
              <Ionicons name="document-outline" size={15} color={COLORS.muted} />
              <Text style={styles.fileMetaText} numberOfLines={1}>{filename}</Text>
            </View>

            {/* Stats bar */}
            <View style={styles.statsBar}>
              <StatPill label="Detected" value={detectedPkgs.length} color={COLORS.primary} />
              <StatPill label="Installed" value={matchedApps.length} color="#22c55e" />
              {unmatchedCount > 0 && (
                <StatPill label="Not installed" value={unmatchedCount} color={COLORS.muted} />
              )}
            </View>

            <FlatList
              data={matchedApps}
              keyExtractor={({ pkg }) => pkg}
              contentContainerStyle={styles.appList}
              ItemSeparatorComponent={() => <View style={styles.separator} />}
              ListHeaderComponent={
                matchedApps.length > 0 ? (
                  <Text style={[styles.sectionLabel, { marginBottom: SPACING.sm }]}>
                    APPS TO IMPORT ({matchedApps.length})
                  </Text>
                ) : null
              }
              renderItem={({ item }) => (
                <View style={styles.appRow}>
                  {item.app?.iconBase64 ? (
                    <Image
                      source={{ uri: `data:image/png;base64,${item.app.iconBase64}` }}
                      style={styles.appIcon}
                    />
                  ) : (
                    <View style={styles.appIconPlaceholder}>
                      <Ionicons name="apps-outline" size={20} color={COLORS.muted} />
                    </View>
                  )}
                  <View style={styles.appInfo}>
                    <Text style={styles.appName}>{item.app?.appName ?? item.pkg}</Text>
                    <Text style={styles.appPkg} numberOfLines={1}>{item.pkg}</Text>
                  </View>
                </View>
              )}
              ListEmptyComponent={
                <View style={styles.emptyState}>
                  <Ionicons name="alert-circle-outline" size={40} color={COLORS.muted} />
                  <Text style={styles.emptyText}>
                    None of the detected apps are installed on this device.
                  </Text>
                  <TouchableOpacity onPress={() => setStep('sources')} style={styles.retryBtn}>
                    <Text style={styles.retryText}>Try another file</Text>
                  </TouchableOpacity>
                </View>
              }
            />

            {matchedApps.length > 0 && (
              <View style={styles.importFooter}>
                <TouchableOpacity
                  style={[styles.importBtn, importing && styles.importBtnDim]}
                  onPress={handleConfirmImport}
                  disabled={importing}
                  activeOpacity={0.8}
                >
                  {importing ? (
                    <ActivityIndicator size="small" color="#fff" />
                  ) : (
                    <Ionicons name="add-circle-outline" size={20} color="#fff" />
                  )}
                  <Text style={styles.importBtnText}>
                    {importing
                      ? 'Importing…'
                      : `Add ${matchedApps.length} App${matchedApps.length !== 1 ? 's' : ''} to Block List`}
                  </Text>
                </TouchableOpacity>
              </View>
            )}
          </View>
        )}
      </SafeAreaView>
    </Modal>
  );
}

function StatPill({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <View style={styles.statPill}>
      <Text style={[styles.statValue, { color }]}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },

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
  headerSide: { minWidth: 60, flexDirection: 'row', alignItems: 'center' },
  headerTitle: { fontSize: FONT.md, fontWeight: '700', color: COLORS.text },
  cancelText: { fontSize: FONT.md, color: COLORS.muted },
  backText: { fontSize: FONT.md, color: COLORS.primary, marginLeft: 2 },

  content: { padding: SPACING.lg, paddingBottom: SPACING.xl * 2 },

  introBanner: {
    alignItems: 'center',
    backgroundColor: COLORS.card,
    borderRadius: RADIUS.lg,
    padding: SPACING.xl,
    marginBottom: SPACING.xl,
    gap: SPACING.sm,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  introTitle: { fontSize: FONT.lg, fontWeight: '700', color: COLORS.text, textAlign: 'center' },
  introSub: { fontSize: FONT.sm, color: COLORS.muted, textAlign: 'center', lineHeight: 20 },

  sectionLabel: {
    fontSize: FONT.xs,
    fontWeight: '700',
    color: COLORS.muted,
    letterSpacing: 0.8,
    marginBottom: SPACING.sm,
    marginTop: SPACING.lg,
  },

  sourceCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: COLORS.card,
    borderRadius: RADIUS.md,
    padding: SPACING.md,
    marginBottom: SPACING.sm,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  sourceIconWrap: {
    width: 36,
    height: 36,
    borderRadius: RADIUS.sm,
    backgroundColor: `${COLORS.primary}18`,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: SPACING.sm,
    flexShrink: 0,
  },
  sourceText: { flex: 1 },
  sourceName: { fontSize: FONT.sm, fontWeight: '600', color: COLORS.text, marginBottom: 2 },
  sourceHint: { fontSize: FONT.xs, color: COLORS.muted, lineHeight: 17 },

  browseBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: SPACING.sm,
    backgroundColor: COLORS.primary,
    borderRadius: RADIUS.md,
    paddingVertical: 14,
    marginTop: SPACING.xl,
  },
  browseBtnDim: { opacity: 0.6 },
  browseBtnText: { fontSize: FONT.md, fontWeight: '700', color: '#fff' },

  footnote: {
    fontSize: FONT.xs,
    color: COLORS.muted,
    textAlign: 'center',
    marginTop: SPACING.md,
    lineHeight: 17,
  },

  fileMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: SPACING.lg,
    paddingVertical: SPACING.sm,
    backgroundColor: COLORS.card,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: COLORS.border,
  },
  fileMetaText: { fontSize: FONT.xs, color: COLORS.muted, flex: 1 },

  statsBar: {
    flexDirection: 'row',
    gap: SPACING.sm,
    paddingHorizontal: SPACING.lg,
    paddingVertical: SPACING.md,
    backgroundColor: COLORS.card,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: COLORS.border,
  },
  statPill: { alignItems: 'center', paddingHorizontal: SPACING.md },
  statValue: { fontSize: FONT.xl, fontWeight: '800' },
  statLabel: { fontSize: FONT.xs, color: COLORS.muted },

  appList: { paddingHorizontal: SPACING.lg, paddingTop: SPACING.lg, paddingBottom: 120 },

  appRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: SPACING.sm },
  appIcon: { width: 40, height: 40, borderRadius: RADIUS.sm },
  appIconPlaceholder: {
    width: 40,
    height: 40,
    borderRadius: RADIUS.sm,
    backgroundColor: COLORS.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  appInfo: { flex: 1, marginLeft: SPACING.sm },
  appName: { fontSize: FONT.sm, fontWeight: '600', color: COLORS.text },
  appPkg: { fontSize: FONT.xs, color: COLORS.muted },

  separator: { height: StyleSheet.hairlineWidth, backgroundColor: COLORS.border },

  emptyState: {
    alignItems: 'center',
    paddingVertical: SPACING.xl * 2,
    gap: SPACING.md,
  },
  emptyText: { fontSize: FONT.sm, color: COLORS.muted, textAlign: 'center', lineHeight: 20 },
  retryBtn: {
    marginTop: SPACING.sm,
    paddingHorizontal: SPACING.lg,
    paddingVertical: SPACING.sm,
    backgroundColor: COLORS.card,
    borderRadius: RADIUS.md,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  retryText: { fontSize: FONT.sm, color: COLORS.primary, fontWeight: '600' },

  importFooter: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    padding: SPACING.lg,
    backgroundColor: COLORS.background,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: COLORS.border,
  },
  importBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: SPACING.sm,
    backgroundColor: COLORS.primary,
    borderRadius: RADIUS.md,
    paddingVertical: 14,
  },
  importBtnDim: { opacity: 0.6 },
  importBtnText: { fontSize: FONT.md, fontWeight: '700', color: '#fff' },
});
