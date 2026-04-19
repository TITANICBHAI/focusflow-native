# Project Notes

## Artifacts
- FocusFlow: Expo mobile app in `artifacts/focusflow`, preview path `/`.
- FocusFlow Commercial Ad: video artifact in `artifacts/focusflow-ad`, preview path `/focusflow-ad/`.
- Canvas mockup sandbox in `artifacts/mockup-sandbox`.

## Recent Changes
- FocusFlow security hardening pass: added PackageInstallReceiver (auto-blocks newly installed apps mid-session + AversiveActionsManager vibration deterrent), SessionPinModule (SHA-256 PIN gates on stopService / stopNetworkBlock / setFocusActive(false)), FLAG_SECURE on BlockOverlayActivity (prevents screenshot / recents thumbnail), TRUSTED_FOCUSFLOW_CLASSES allowlist (closes self-package loophole where FocusFlow's own activity could close the overlay), isRecentsScreen() detection (sends HOME when Android overview appears during a session), clock-tamper defense in BootReceiver (dual primary+secondary validity check using task_duration_ms + task_last_written_ms), IME detection in InstalledAppsModule (isIme field on each app), and postHomeScreenReminder() in AccessibilityService (high-priority peek notification shown after overlay dismiss). All native-module TypeScript wrappers updated with PIN-aware signatures; new SessionPinModule.ts and NetworkBlockModule.ts wrappers created.
- FocusFlow c1.0.4 narrows SystemUI protection to accessibility class/text matching only, adds native clock/alarm packages to the never-blocked list, removes the broad SystemUI window-event fallback that could interrupt Samsung alarms while the screen is off, and separates blocked keyword enforcement from the System Protection toggle.
- Fixed the GitHub sync script to mirror the workspace instead of only adding/updating files, preventing stale deleted files on GitHub from breaking APK builds; preserved GitHub Actions workflow files locally under `.github/workflows` and included `pnpm-lock.yaml` for frozen CI installs.
- Updated the debug APK workflow to upload all debug APK outputs with a wildcard, because ABI splits produce filenames other than `app-debug.apk`.
- Added a manual "Push to GitHub" workflow backed by `scripts/github-push.mjs`, using the `GITHUB_PERSONAL_ACCESS_TOKEN` secret to sync the workspace to `https://github.com/TITANICBHAI/FocusFlow`.
- FocusFlow c1.0.3 adds the requested never-blocked packages and a System Protection settings toggle that stays locked on during active Focus Mode or standalone app blocks.
- Hardened FocusFlow onboarding and settings sync paths so optional Android native modules or Samsung battery settings failures do not crash first-run onboarding.
- Daily allowance supports three per-app modes: count, time budget, and interval, enforced by the Android accessibility service through SharedPreferences config.
