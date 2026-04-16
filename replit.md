# Project Notes

## Artifacts
- FocusFlow: Expo mobile app in `artifacts/focusflow`, preview path `/`.
- FocusFlow Commercial Ad: video artifact in `artifacts/focusflow-ad`, preview path `/focusflow-ad/`.
- Canvas mockup sandbox in `artifacts/mockup-sandbox`.

## Recent Changes
- Fixed the GitHub sync script to mirror the workspace instead of only adding/updating files, preventing stale deleted files on GitHub from breaking APK builds; preserved GitHub Actions workflow files locally under `.github/workflows` and included `pnpm-lock.yaml` for frozen CI installs.
- Updated the debug APK workflow to upload all debug APK outputs with a wildcard, because ABI splits produce filenames other than `app-debug.apk`.
- Added a manual "Push to GitHub" workflow backed by `scripts/github-push.mjs`, using the `GITHUB_PERSONAL_ACCESS_TOKEN` secret to sync the workspace to `https://github.com/TITANICBHAI/FocusFlow`.
- FocusFlow c1.0.3 adds the requested never-blocked packages and a System Protection settings toggle that stays locked on during active Focus Mode or standalone app blocks.
- Hardened FocusFlow onboarding and settings sync paths so optional Android native modules or Samsung battery settings failures do not crash first-run onboarding.
- Daily allowance supports three per-app modes: count, time budget, and interval, enforced by the Android accessibility service through SharedPreferences config.
