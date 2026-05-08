<<<<<<< HEAD
# Workspace

## Overview

pnpm workspace monorepo using TypeScript. Each package manages its own dependencies.

## Stack

- **Monorepo tool**: pnpm workspaces
- **Node.js version**: 24
- **Package manager**: pnpm
- **TypeScript version**: 5.9
- **API framework**: Express 5
- **Database**: PostgreSQL + Drizzle ORM
- **Validation**: Zod (`zod/v4`), `drizzle-zod`
- **API codegen**: Orval (from OpenAPI spec)
- **Build**: esbuild (CJS bundle)

## Key Commands

- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- `pnpm --filter @workspace/api-server run dev` — run API server locally

See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details.

## FocusFlow Android App

The React Native / Expo source lives at `./FocusFlow/` (not a pnpm workspace package — it has its own package manager setup).

- **Source**: `FocusFlow/artifacts/focusflow/`
- **Git remotes**: `origin` → `TITANICBHAI/FocusFlow`, `native` → `TITANICBHAI/focusflow-native`
- **Push script**: `scripts/src/github-push.mjs` — commits + force-pushes `FocusFlow/` HEAD to `focusflow-native` main
- **Trigger**: run the "Push to GitHub" workflow
=======
# FocusFlow JVM — by TBTechs

A real-enforcement productivity & focus app for Windows, built with Kotlin + Compose Multiplatform Desktop.

## Architecture

- **Language**: Kotlin 1.9.22
- **UI**: Compose Multiplatform Desktop 1.6.1 (Material 3)
- **Database**: SQLite via org.xerial:sqlite-jdbc
- **Native Interop**: JNA 5.14 (Win32 APIs — Windows-only enforcement)
- **Async**: kotlinx.coroutines-swing
- **Build**: Gradle 8.14.2 (Kotlin DSL)

## Theme Variables

All UI colours come from `com.focusflow.ui.theme.*`:
`Purple80`, `Purple60`, `PurpleGrey`, `Surface`, `Surface2`, `Surface3`,
`OnSurface`, `OnSurface2`, `Success`, `Warning`, `Error`

**Never use**: `Primary`, `OnSurfaceVariant` — these don't exist in our theme.

## Project Structure

```
src/main/kotlin/com/focusflow/
├── Main.kt                          Entry point; wires all services + tray
├── App.kt                           Root composable; onboarding check + nav
├── ui/
│   ├── theme/Theme.kt               Material 3 dark theme
│   ├── screens/
│   │   ├── DashboardScreen.kt
│   │   ├── TasksScreen.kt
│   │   ├── FocusScreen.kt
│   │   ├── AppBlockerScreen.kt
│   │   ├── StatsScreen.kt
│   │   ├── SettingsScreen.kt
│   │   ├── HabitsScreen.kt
│   │   ├── ReportsScreen.kt
│   │   ├── DailyNotesScreen.kt
│   │   ├── ProfileScreen.kt
│   │   ├── ActiveScreen.kt          Live block status dashboard
│   │   ├── BlockDefenseScreen.kt    Enforcement layer configuration
│   │   ├── KeywordBlockerScreen.kt  Keyword blocking management
│   │   ├── WindowsSetupScreen.kt    Admin/permissions setup
│   │   └── PrivacyPermissionsScreen.kt
│   └── components/
│       ├── SideNav.kt
│       ├── TaskCard.kt
│       ├── BlockOverlay.kt
│       ├── AppLogo.kt
│       ├── EmptyStateCard.kt
│       ├── ScrollUtils.kt
│       ├── OsBanner.kt
│       └── OnboardingScreen.kt
├── data/
│   ├── Database.kt                  SQLite via sqlite-jdbc
│   └── models/Models.kt             Data classes
├── enforcement/                     Windows-only enforcement engine
│   ├── WinApiBindings.kt            JNA Win32 bindings (getForegroundProcessName, killProcessByName)
│   ├── ProcessMonitor.kt            Dual-mode: WinEventHook + 500ms polling; UWP host resolution
│   ├── AppBlocker.kt                Kill + overlay bridge
│   ├── NetworkBlocker.kt            netsh advfirewall rules
│   ├── NuclearMode.kt               Nuclear blocking mode (escape routes: 30+ processes)
│   ├── WinEventHook.kt              Instant foreground event detection (WINEVENT_OUTOFCONTEXT)
│   ├── InstalledAppsScanner.kt      Curated + live running process scanner
│   └── WindowsStartupManager.kt     HKCU Run key auto-start
└── services/
    ├── FocusSessionService.kt
    ├── TemptationLogger.kt
    ├── SessionPin.kt
    ├── SoundAversion.kt
    ├── SystemTrayManager.kt
    ├── NotificationService.kt
    ├── TaskAlarmService.kt
    ├── RecurringTaskService.kt
    ├── BlockScheduleService.kt
    ├── StandaloneBlockService.kt
    ├── DailyAllowanceTracker.kt
    ├── WeeklyReportService.kt
    ├── BreakEnforcer.kt
    ├── FocusInsightsService.kt
    ├── BackupService.kt
    ├── AutoBackupService.kt
    ├── HostsBlocker.kt
    └── PrivacyPolicyService.kt
```

## Replit Environment Setup

### Java / Gradle
- **Java**: GraalVM CE 19 (Java 19)
  - Path: `/nix/store/c8hr2f0b0dm685yx1dkp6bw24bpx495n-graalvm19-ce-22.3.1`
- **Gradle**: System Gradle 8.14.2 (installed via Nix)

### Key env vars (set in workflow command)
```bash
export JAVA_HOME=/nix/store/c8hr2f0b0dm685yx1dkp6bw24bpx495n-graalvm19-ce-22.3.1
export PATH=$JAVA_HOME/bin:$PATH
```

### Workflow
- **Name**: Start application
- **Type**: VNC (desktop GUI app)
- **Command**: `gradle run --no-daemon` (with JAVA_HOME set)

## Platform Notes

- **UI**: Cross-platform — Compose Desktop renders on Linux/Mac/Windows
- **Enforcement**: Windows-only — JNA calls to Win32 APIs are no-ops on Linux
- **Packaging**: Windows EXE/MSI via GitHub Actions (`windows-latest`); MSIX built manually in CI
- **Database**: SQLite at `~/.focusflow/focusflow.db`

## JVM Args (build.gradle.kts)

```
-Xms64m -Xmx512m -XX:+UseG1GC -XX:MaxGCPauseMillis=50
-Dfile.encoding=UTF-8 -Djava.awt.headless=false -Dskiko.renderApi=SOFTWARE
-Djava.nio.channels.spi.SelectorProvider=sun.nio.ch.PollSelectorProvider  ← MSIX AppContainer fix
```

## MSIX / Microsoft Store Identity (Partner Center values)

These values MUST match Partner Center exactly. They are hardcoded in `.github/workflows/build-windows.yml`:

| Field | Value |
|---|---|
| `Identity/@Name` | `TBTechs.FocusFlowDeepFocusAppBlocker` |
| `Identity/@Publisher` | `CN=E08824C8-6F22-4DC2-8025-DD8C707E2BE9` |
| `Identity/@Version` | `1.0.1.0` (4th digit must be 0 for Store) |
| `Properties/DisplayName` | `FocusFlow - Deep Focus App Blocker` |
| `Properties/PublisherDisplayName` | `TBTechs` |

> **Important:** If Partner Center shows a different reserved app name, update `Properties/DisplayName` in `.github/workflows/build-windows.yml` to match exactly.
> No code-signing certificate needed for Store submission — Microsoft re-signs MSIX during ingestion.

## CI/CD

GitHub Actions at `.github/workflows/build-windows.yml`:
- Runs on `windows-latest`
- Builds EXE + MSI (Gradle `packageExe`/`packageMsi`) + MSIX (`makeappx.exe`)
- All 3 Partner Center identity fields are verified before `makeappx` runs
- Auto-creates a GitHub Release on every push to `main`
- Watch CI: https://github.com/TITANICBHAI/FocusFlow-jvm/actions

## Pushing to GitHub

```bash
bash push_to_github.sh
```

Requires `GITHUB_PERSONAL_ACCESS_TOKEN` Replit Secret (already set).

## Recent Changes (May 2026)

### MSIX / Microsoft Store fixes
- Fixed `Identity/@Name` → `TBTechs.FocusFlowDeepFocusAppBlocker` (was `TBTechs.FocusFlow`)
- Fixed `Identity/@Publisher` → `CN=E08824C8-6F22-4DC2-8025-DD8C707E2BE9` (was `CN=TBTechs`)
- Fixed `Properties/DisplayName` → `FocusFlow - Deep Focus App Blocker` (was `FocusFlow`, not reserved)
- Added triple-field manifest verification before `makeappx` runs

### Code improvements
- `build.gradle.kts`: Added `-Djava.nio.channels.spi.SelectorProvider=sun.nio.ch.PollSelectorProvider` — prevents Java NIO failures inside MSIX AppContainer
- `ProcessMonitor.kt`: Added UWP/ApplicationFrameHost.exe resolution — when the UWP frame host is foreground, scans running processes to find the actual hosted blocked app
- `ProcessMonitor.kt`: Added system frame process ignore list (ApplicationFrameHost, ShellExperienceHost, StartMenuExperienceHost, SearchHost)
- `NuclearMode.kt`: Expanded escape-route list to 30+ processes (added WSL distros, WMI, script engines, package managers, perfmon, resource monitor)
>>>>>>> d9e9b96 (Update src/main/kotlin/com/focusflow/ui/components/OnboardingScreen.kt [2026-05-07 15:44 UTC])
