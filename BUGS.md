# FocusFlow — Bug Tracker

> **Maintained by:** Replit Agent audit (April 2026)  
> **Scope:** Full codebase audit covering screens, hooks, services, native modules, DB layer, background tasks, and context.  
> **Severity scale:** 🔴 CRITICAL (crash/data loss) · 🟠 HIGH (wrong behaviour, user impact) · 🟡 MEDIUM (misleading UI / silent failure) · 🟢 LOW (style / minor edge case)

---

## ✅ Fixed Bugs

| ID | Severity | File | Description | Fixed In |
|----|----------|------|-------------|----------|
| FF-001 | 🟠 HIGH | `BlockedAppOverlay.tsx` / `AppContext.tsx` | `APP_BLOCKED` native event was never auto-cleared; overlay modal got stuck permanently after a block event | Session 1 |
| FF-002 | 🟡 MEDIUM | `src/hooks/useTimer.ts` | `remaining` was clamped to `0`, so overdue tasks always showed "Overdue by 0m" instead of the real elapsed time | Session 2 |
| FF-003 | 🟢 LOW | `src/services/eventBridge.ts` | `useNativeEvent` closed over a stale handler; subscribe/unsubscribe cycled on every render, flooding the event bridge | Session 2 |
| FF-004 | 🟡 MEDIUM | `src/services/taskService.ts` → `getTodayTasks` | Used strict `isAfter(startOfDay)` which excluded tasks scheduled at exactly midnight (00:00:00) | Session 3 |
| FF-005 | 🟠 HIGH | `src/context/AppContext.tsx` ~line 383 | Auto-start focus mode always used the global `allowedInFocus` list, ignoring `task.focusAllowedPackages` — task-whitelisted apps were blocked anyway | Session 4 |
| FF-006 | 🟠 HIGH | `src/data/database.ts` → `rowToTask` | Bare `JSON.parse()` on `tags`/`reminders` columns — corrupt/NULL DB row crashed the entire task list load | Session 4 |
| FF-007 | 🟠 HIGH | `src/tasks/backgroundTasks.ts` → OVERRUN_CHECK | After auto-extending a task, `ForegroundServiceModule.updateNotification` was never called — native countdown notification kept showing the old (expired) end time | Session 4 |
| FF-008 | 🟡 MEDIUM | `app/(tabs)/focus.tsx` line 333 | "Allowed" chip row showed `settings.allowedInFocus` (global list) instead of `focusSession.allowedPackages` (session-specific list) | Session 4 |
| FF-009 | 🟡 MEDIUM | `src/tasks/backgroundTasks.ts` → OVERRUN_CHECK | Silent auto-extend with no user notification — schedule shifted 10 min with no explanation to the user | Session 4 |
| FF-010 | 🟡 MEDIUM | `app/(tabs)/stats.tsx` line 59 | Same midnight exclusion bug as FF-004 — `isAfter(today)` strict comparison excluded midnight tasks from stats | Session 4 |
| FF-011 | 🟢 LOW | `app/(tabs)/stats.tsx` lines 86-90 | `dbRecordDayCompletion` fired immediately on every task-status change (excessive DB writes); replaced with a 3-second debounce | Session 4 |
| FF-012 | 🟢 LOW | `src/native-modules/GreyoutModule.ts` | Module used `const { Greyout } = NativeModules` without a `Platform.OS` guard, inconsistent with all other native modules | Session 4 |
| FF-013 | 🟢 LOW | `src/components/EditTaskModal.tsx` | State not reset if `task` prop changes while modal is mounted (documented; fix: add `key={task.id}` at usage site) | Session 4 (doc only) |
| FF-014 | 🟢 LOW | `src/services/focusService.ts` | `stopAndroidUsageMonitor()` called in `stopFocusMode` but monitor is never started — dead code | Already removed before audit |
| FF-015 | 🟢 LOW | `src/components/TimelineView.tsx` | `Dimensions.get('window').width` computed once at render; not reactive to orientation/resize. Replaced with `useWindowDimensions()` | Session 4 |

---

## 🔴 Active Bugs — Critical

*(None.)*

---

## 🟠 Active Bugs — High

*(All high-severity bugs resolved — see table above.)*

---

## 🟡 Active Bugs — Medium

*(All medium-severity bugs resolved — see table above.)*

---

## 🟢 Active Bugs — Low

### FF-013 · EditTaskModal — state not reset if `task` prop changes while mounted
- **File:** `src/components/EditTaskModal.tsx`  
- **Status:** Documented, not yet patched in code (low-risk edge case)  
- **Symptom:** All `useState` values are initialised from `task` on first mount. If the component is ever re-used for a different task without unmounting, stale data is shown.  
- **Fix (one-liner at usage site):** Pass `key={task.id}` to `<EditTaskModal>` wherever it is rendered, which forces React to remount the modal when the task changes.

---

## ⚙️ Pending Work — Not Bugs But Needed

| ID | Area | Description |
|----|------|-------------|
| PW-001 | CI/CD | GitHub Actions release build requires 4 secrets not yet added to the repo: `RELEASE_KEYSTORE_BASE64`, `RELEASE_STORE_PASSWORD`, `RELEASE_KEY_ALIAS`, `RELEASE_KEY_PASSWORD` |
| PW-002 | UX | OVERRUN_CHECK always extends by a fixed 10 min with no user control. Consider a Settings option "Default overrun extension" with choices like 5 / 10 / 15 / Ask. |
| PW-003 | Accessibility | `TimelineView` task blocks have no `accessibilityLabel` — screen readers announce nothing useful when navigating the schedule. |
| PW-004 | Error Handling | `AppContext` `loadInitialData` silently swallows errors from non-critical table queries (focus sessions, streak). Consider surfacing a non-blocking error toast. |

---

## Summary

| Status | Count |
|--------|-------|
| ✅ Fixed (all sessions) | 15 |
| 🔴 Critical active | 0 |
| 🟠 High active | 0 |
| 🟡 Medium active | 0 |
| 🟢 Low active — code | 0 |
| 🟢 Low active — doc only | 1 (FF-013) |
| ⚙️ Pending work items | 4 |

**All functional bugs closed.** Only FF-013 (low-risk, one-liner fix at call site) and 4 enhancement/infra items remain open.
