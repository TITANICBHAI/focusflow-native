/**
 * blockListImport.ts
 *
 * Shared helper that merges a list of newly-imported package names
 * into the user's standalone block list, preserving any active timed
 * session and daily-allowance entries.
 *
 * Used by both the settings screen and the onboarding screen so the
 * "Import from another blocker" flow behaves identically wherever the
 * user enters it.
 */

import type { AppSettings, DailyAllowanceEntry } from '@/data/types';

export interface MergeBlockListResult {
  /** Number of packages that were not already in the block list. */
  added: number;
  /** Number of packages that were already in the block list. */
  duplicates: number;
  /** The full merged package list that was persisted. */
  merged: string[];
}

/**
 * Merge `incoming` into the user's standalone block list.
 *
 * Preserves an active timed standalone-block session if one is in
 * progress; otherwise enforcement falls back to the always-on path.
 * Daily-allowance entries are passed through unchanged.
 *
 * Returns counts so the caller can show a confirmation message.
 */
export async function mergeIntoStandaloneBlockList(
  incoming: string[],
  settings: AppSettings,
  setStandaloneBlockAndAllowance: (
    packages: string[],
    untilMs: number | null,
    allowanceEntries: DailyAllowanceEntry[],
  ) => Promise<void>,
): Promise<MergeBlockListResult> {
  const existing = new Set(settings.standaloneBlockPackages ?? []);
  const newPkgs = incoming.filter((p) => !existing.has(p));

  if (newPkgs.length === 0) {
    return { added: 0, duplicates: incoming.length, merged: Array.from(existing) };
  }

  const merged = [...Array.from(existing), ...newPkgs];

  const existingUntilMs = settings.standaloneBlockUntil
    ? new Date(settings.standaloneBlockUntil).getTime()
    : null;
  const untilMs = existingUntilMs && existingUntilMs > Date.now() ? existingUntilMs : null;

  await setStandaloneBlockAndAllowance(merged, untilMs, settings.dailyAllowanceEntries ?? []);

  return {
    added: newPkgs.length,
    duplicates: incoming.length - newPkgs.length,
    merged,
  };
}
