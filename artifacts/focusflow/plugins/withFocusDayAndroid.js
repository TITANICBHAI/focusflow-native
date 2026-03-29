/**
 * withFocusDayAndroid.js
 *
 * Expo Config Plugin that automates every Android build step:
 *   1. Patches settings.gradle for pnpm monorepo compatibility
 *   2. Injects permissions into AndroidManifest.xml
 *   3. Declares ForegroundTaskService
 *   4. Declares AppBlockerAccessibilityService
 *   5. Declares BootReceiver
 *   6. Patches MainApplication.kt to register FocusDayPackage
 *   7. Copies all Kotlin source files from android-native/ into the project
 *
 * Applied automatically during `npx expo prebuild --platform android`.
 * No manual XML or Kotlin editing required.
 */

const path = require('path');
const fs   = require('fs');

// Use expo/config-plugins (the official re-export) so we never need
// @expo/config-plugins as a direct dependency.
const { withAndroidManifest, withDangerousMod } = require('expo/config-plugins');

// ─── 1. Patch settings.gradle for pnpm monorepo ───────────────────────────────
//
// The Expo-generated settings.gradle resolves @react-native/gradle-plugin by
// running a `node --print require.resolve(...)` command. By default that command
// runs from Gradle's working directory, which in settings.gradle context is the
// android/ folder. In a pnpm monorepo, node_modules lives in the focusday project
// root (one level above android/), not inside android/.
//
// Fix: replace every occurrence of `rootDir` used as a working directory with
// `settingsDir.parentFile`. `settingsDir` is a Gradle built-in always available
// in settings.gradle that points to the android/ directory; `.parentFile` is the
// focusday project root — exactly where pnpm/npm installs node_modules.
// We also add a .npmrc (node-linker=hoisted) so pnpm creates a flat node_modules
// structure that Gradle can traverse without following symlinks.

function withFocusDaySettings(config) {
  return withDangerousMod(config, [
    'android',
    (cfg) => {
      const platformRoot = cfg.modRequest.platformProjectRoot;
      const settingsPath = path.join(platformRoot, 'settings.gradle');

      if (!fs.existsSync(settingsPath)) return cfg;

      let content = fs.readFileSync(settingsPath, 'utf8');
      let patched = false;

      // Diagnostic: log first 40 lines so EAS build logs show the exact template
      // format being generated. If the patch still misses, this output tells us why.
      const preview = content.split('\n').slice(0, 40).join('\n');
      console.log('[withFocusDayAndroid] settings.gradle preview (first 40 lines):\n' + preview);

      // ── Regex-based patching (handles whitespace/quote variations) ───────
      // Strict string matching silently misses if the generated template has
      // a single extra space or quote. Regex with \s* is immune to that.
      const patterns = [
        {
          // workingDir(rootDir) or workingDir( rootDir )
          find: /workingDir\(\s*rootDir\s*\)/g,
          replace: 'workingDir(settingsDir.parentFile)',
        },
        {
          // rootDir.toString() — inside {paths: [rootDir.toString()]}
          // Without this fix Node.js resolves from "null" and returns no output
          find: /rootDir\.toString\(\)/g,
          replace: 'settingsDir.parentFile.toString()',
        },
        {
          // ].execute(null, rootDir) or .execute( null , rootDir )
          find: /\.execute\(\s*null\s*,\s*rootDir\s*\)/g,
          replace: '.execute(null, settingsDir.parentFile)',
        },
        {
          // Bare .execute() with no args — very old RN templates
          // Guard: skip if already patched with settingsDir
          find: /\]\.execute\(\s*\)\.text\.trim\(\)/g,
          replace: '].execute(null, settingsDir.parentFile).text.trim()',
        },
      ];

      for (const { find, replace } of patterns) {
        // NOTE: Do NOT call find.test(content) before replace — global regex (/g)
        // is stateful and .test() advances lastIndex, causing .replace() to start
        // mid-string and silently miss the match. Instead, compare before/after.
        const next = content.replace(find, replace);
        if (next !== content) {
          content = next;
          patched = true;
        }
      }

      if (patched) {
        fs.writeFileSync(settingsPath, content, 'utf8');
        console.log('[withFocusDayAndroid] Patched settings.gradle for pnpm workspace.');
      } else {
        console.warn('[withFocusDayAndroid] WARNING: No known pattern found in settings.gradle — patch not applied. Check the generated settings.gradle for the node resolution block.');
      }

      return cfg;
    },
  ]);
}

// ─── 2. AndroidManifest.xml ───────────────────────────────────────────────────

function withFocusDayManifest(config) {
  return withAndroidManifest(config, (cfg) => {
    const manifest = cfg.modResults;
    const app = manifest.manifest.application[0];

    // ── Permissions (add if not already present) ──────────────────────────────
    const wantedPermissions = [
      'android.permission.PACKAGE_USAGE_STATS',
      'android.permission.SYSTEM_ALERT_WINDOW',
      'android.permission.FOREGROUND_SERVICE',
      'android.permission.FOREGROUND_SERVICE_SPECIAL_USE',
      'android.permission.RECEIVE_BOOT_COMPLETED',
      'android.permission.REQUEST_IGNORE_BATTERY_OPTIMIZATIONS',
      'android.permission.WAKE_LOCK',
      'android.permission.BIND_ACCESSIBILITY_SERVICE',
    ];

    const existing = (manifest.manifest['uses-permission'] || []).map(
      (p) => p.$['android:name']
    );

    for (const perm of wantedPermissions) {
      if (!existing.includes(perm)) {
        if (!manifest.manifest['uses-permission']) manifest.manifest['uses-permission'] = [];
        manifest.manifest['uses-permission'].push({
          $: { 'android:name': perm, 'tools:ignore': 'ProtectedPermissions' },
        });
      }
    }

    // ── tools namespace on <manifest> ─────────────────────────────────────────
    if (!manifest.manifest.$['xmlns:tools']) {
      manifest.manifest.$['xmlns:tools'] = 'http://schemas.android.com/tools';
    }

    // ── Foreground Task Service ───────────────────────────────────────────────
    const serviceExists = (app.service || []).some(
      (s) => s.$['android:name'] === 'com.tbtechs.focusday.services.ForegroundTaskService'
    );
    if (!serviceExists) {
      if (!app.service) app.service = [];
      app.service.push({
        $: {
          'android:name':                'com.tbtechs.focusday.services.ForegroundTaskService',
          'android:enabled':             'true',
          'android:exported':            'false',
          'android:foregroundServiceType': 'specialUse',
        },
        property: [{
          $: {
            'android:name':  'android.app.PROPERTY_SPECIAL_USE_FGS_SUBTYPE',
            'android:value': 'productivity',
          },
        }],
      });
    }

    // ── Accessibility Service ─────────────────────────────────────────────────
    const a11yExists = (app.service || []).some(
      (s) => s.$['android:name'] === 'com.tbtechs.focusday.services.AppBlockerAccessibilityService'
    );
    if (!a11yExists) {
      if (!app.service) app.service = [];
      app.service.push({
        $: {
          'android:name':       'com.tbtechs.focusday.services.AppBlockerAccessibilityService',
          'android:enabled':    'true',
          'android:exported':   'true',
          'android:label':      'FocusDay Focus Mode',
          'android:permission': 'android.permission.BIND_ACCESSIBILITY_SERVICE',
        },
        'intent-filter': [{ action: [{ $: { 'android:name': 'android.accessibilityservice.AccessibilityService' } }] }],
        'meta-data': [{
          $: {
            'android:name':     'android.accessibilityservice',
            'android:resource': '@xml/accessibility_service_config',
          },
        }],
      });
    }

    // ── Boot Receiver ─────────────────────────────────────────────────────────
    const bootExists = (app.receiver || []).some(
      (r) => r.$['android:name'] === 'com.tbtechs.focusday.services.BootReceiver'
    );
    if (!bootExists) {
      if (!app.receiver) app.receiver = [];
      app.receiver.push({
        $: {
          'android:name':     'com.tbtechs.focusday.services.BootReceiver',
          'android:enabled':  'true',
          'android:exported': 'true',
        },
        'intent-filter': [{
          action: [
            { $: { 'android:name': 'android.intent.action.BOOT_COMPLETED' } },
            { $: { 'android:name': 'android.intent.action.QUICKBOOT_POWERON' } },
          ],
        }],
      });
    }

    return cfg;
  });
}

// ─── 3. Copy Kotlin source files + patch MainApplication.kt ──────────────────

function withFocusDayKotlin(config) {
  return withDangerousMod(config, [
    'android',
    (cfg) => {
      const projectRoot  = cfg.modRequest.projectRoot;
      const platformRoot = cfg.modRequest.platformProjectRoot;

      const pkg        = 'com/tbtechs/focusday';
      const srcRoot    = path.join(projectRoot, 'android-native', 'app', 'src', 'main');
      const destRoot   = path.join(platformRoot, 'app', 'src', 'main');

      // ── Copy Kotlin files ─────────────────────────────────────────────────
      const kotlinSrc  = path.join(srcRoot, 'java', pkg);
      const kotlinDest = path.join(destRoot, 'java', pkg);
      copyDirSync(kotlinSrc, kotlinDest);

      // ── Copy resource files (XML configs) ────────────────────────────────
      const resSrc  = path.join(srcRoot, 'res');
      const resDest = path.join(destRoot, 'res');
      copyDirSync(resSrc, resDest);

      // ── Patch strings.xml ─────────────────────────────────────────────────
      const stringsPath = path.join(resDest, 'values', 'strings.xml');
      if (fs.existsSync(stringsPath)) {
        let content = fs.readFileSync(stringsPath, 'utf8');
        if (!content.includes('accessibility_service_description')) {
          content = content.replace(
            '</resources>',
            `    <string name="accessibility_service_description">FocusDay uses Accessibility to detect and block distracting apps during your focus sessions. No personal data or messages are read.</string>\n</resources>`
          );
          fs.writeFileSync(stringsPath, content, 'utf8');
        }
      }

      // ── Patch MainApplication.kt ──────────────────────────────────────────
      const mainAppPath = path.join(
        platformRoot, 'app', 'src', 'main', 'java', pkg, 'MainApplication.kt'
      );
      if (fs.existsSync(mainAppPath)) {
        let src = fs.readFileSync(mainAppPath, 'utf8');

        if (!src.includes('FocusDayPackage')) {
          src = src.replace(
            'import com.facebook.react.ReactApplication',
            'import com.facebook.react.ReactApplication\nimport com.tbtechs.focusday.modules.FocusDayPackage'
          );

          src = src.replace(
            /val packages = PackageList\(this\)\.packages/,
            `val packages = PackageList(this).packages\n        packages.add(FocusDayPackage())`
          );

          fs.writeFileSync(mainAppPath, src, 'utf8');
        }
      }

      return cfg;
    },
  ]);
}

// ─── Compose & export ─────────────────────────────────────────────────────────

module.exports = function withFocusDayAndroid(config) {
  config = withFocusDaySettings(config);
  config = withFocusDayManifest(config);
  config = withFocusDayKotlin(config);
  return config;
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function copyDirSync(src, dest) {
  if (!fs.existsSync(src)) return;
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const srcPath  = path.join(src,  entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDirSync(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}
