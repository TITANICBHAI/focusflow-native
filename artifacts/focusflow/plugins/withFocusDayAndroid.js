/**
 * withFocusDayAndroid.js
 *
 * Expo Config Plugin that automates every Android build step:
 *   1. Patches settings.gradle for pnpm monorepo compatibility
 *   2. Injects permissions into AndroidManifest.xml
 *   3. Declares ForegroundTaskService
 *   4. Declares AppBlockerAccessibilityService
 *   5. Declares BootReceiver
 *   6. Declares DeviceAdminReceiver (FocusDayDeviceAdminReceiver)
 *   7. Declares NotificationActionReceiver with COMPLETE / EXTEND / SKIP intent-filters
 *   8. Declares FocusFlowWidget (AppWidgetProvider) with APPWIDGET_UPDATE intent-filter
 *   9. Adds <queries> block for Android 11+ package visibility
 *  10. Registers FocusDayPackage via withMainApplication (reliable for RN 0.76+)
 *  11. Copies all Kotlin source files from android-native/ into the project
 *
 * Applied automatically during `npx expo prebuild --platform android`.
 * No manual XML or Kotlin editing required.
 */

const path = require('path');
const fs   = require('fs');

// Use expo/config-plugins (the official re-export) so we never need
// @expo/config-plugins as a direct dependency.
const { withAndroidManifest, withDangerousMod, withMainApplication } = require('expo/config-plugins');

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
      // Required on Android 11+ (API 30+) for PackageManager.getInstalledApplications()
      // to return all installed apps including user-installed ones. Without this, only
      // packages with matching <queries> entries are visible. This is how Stay Focused,
      // Google Family Link, and other app-blocker apps enumerate the installed app list.
      'android.permission.QUERY_ALL_PACKAGES',
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
      (s) => s.$['android:name'] === 'com.tbtechs.focusflow.services.ForegroundTaskService'
    );
    if (!serviceExists) {
      if (!app.service) app.service = [];
      app.service.push({
        $: {
          'android:name':                'com.tbtechs.focusflow.services.ForegroundTaskService',
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
      (s) => s.$['android:name'] === 'com.tbtechs.focusflow.services.AppBlockerAccessibilityService'
    );
    if (!a11yExists) {
      if (!app.service) app.service = [];
      app.service.push({
        $: {
          'android:name':       'com.tbtechs.focusflow.services.AppBlockerAccessibilityService',
          'android:enabled':    'true',
          'android:exported':   'true',
          'android:label':      'FocusFlow Focus Mode',
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
      (r) => r.$['android:name'] === 'com.tbtechs.focusflow.services.BootReceiver'
    );
    if (!bootExists) {
      if (!app.receiver) app.receiver = [];
      app.receiver.push({
        $: {
          'android:name':     'com.tbtechs.focusflow.services.BootReceiver',
          'android:enabled':  'true',
          'android:exported': 'true',
        },
        'intent-filter': [{
          action: [
            { $: { 'android:name': 'android.intent.action.BOOT_COMPLETED' } },
            { $: { 'android:name': 'android.intent.action.QUICKBOOT_POWERON' } },
            // USER_UNLOCKED is required on FBE (file-based encryption) devices — which is
            // virtually all modern Android phones. BOOT_COMPLETED fires before user data is
            // decrypted on these devices, so SharedPreferences cannot be read. USER_UNLOCKED
            // fires after the user enters their PIN/pattern and data is accessible.
            { $: { 'android:name': 'android.intent.action.USER_UNLOCKED' } },
            // MY_PACKAGE_REPLACED fires when the app is updated — ensures the service
            // restarts with the new binary after an OTA update without requiring a reboot.
            { $: { 'android:name': 'android.intent.action.MY_PACKAGE_REPLACED' } },
          ],
        }],
      });
    }

    // ── Device Admin Receiver ─────────────────────────────────────────────────
    const adminExists = (app.receiver || []).some(
      (r) => r.$['android:name'] === 'com.tbtechs.focusflow.services.FocusDayDeviceAdminReceiver'
    );
    if (!adminExists) {
      if (!app.receiver) app.receiver = [];
      app.receiver.push({
        $: {
          'android:name':       'com.tbtechs.focusflow.services.FocusDayDeviceAdminReceiver',
          'android:enabled':    'true',
          'android:exported':   'true',
          'android:permission': 'android.permission.BIND_DEVICE_ADMIN',
          'android:label':      'FocusFlow',
        },
        'meta-data': [{
          $: {
            'android:name':     'android.app.device_admin',
            'android:resource': '@xml/device_admin',
          },
        }],
        'intent-filter': [{
          action: [
            { $: { 'android:name': 'android.app.action.DEVICE_ADMIN_ENABLED' } },
          ],
        }],
      });
    }

    // ── Notification Action Receiver ──────────────────────────────────────────
    // NotificationActionReceiver is a static BroadcastReceiver that handles taps
    // on the foreground notification action buttons (Done / +15m / +30m / Skip).
    // Static receivers MUST be declared in the manifest — without this entry,
    // PendingIntent.getBroadcast() sends the broadcast but Android silently drops
    // it because no manifest-registered class exists to handle it.
    // android:exported="false" is correct: all intents are sent with `package` set,
    // making them explicit intra-app broadcasts only.
    const notifActionExists = (app.receiver || []).some(
      (r) => r.$['android:name'] === 'com.tbtechs.focusflow.services.NotificationActionReceiver'
    );
    if (!notifActionExists) {
      if (!app.receiver) app.receiver = [];
      app.receiver.push({
        $: {
          'android:name':     'com.tbtechs.focusflow.services.NotificationActionReceiver',
          'android:enabled':  'true',
          'android:exported': 'false',
        },
        // Intent-filters are required even for exported=false receivers when the
        // PendingIntent is created with setPackage() rather than setComponent().
        // Without these, Android cannot match the broadcast action to the receiver
        // and the broadcast is silently dropped — notification buttons stop working.
        'intent-filter': [{
          action: [
            { $: { 'android:name': 'com.tbtechs.focusflow.notif.COMPLETE' } },
            { $: { 'android:name': 'com.tbtechs.focusflow.notif.EXTEND'  } },
            { $: { 'android:name': 'com.tbtechs.focusflow.notif.SKIP'    } },
          ],
        }],
      });
    }

    // ── FocusFlow Home Screen Widget ──────────────────────────────────────────
    // AppWidgetProvider subclass that shows the active focus session and time
    // remaining on the home screen.
    // Must be declared in the manifest with APPWIDGET_UPDATE intent-filter and
    // the appwidget.provider meta-data pointing to res/xml/widget_info.xml.
    const widgetExists = (app.receiver || []).some(
      (r) => r.$['android:name'] === 'com.tbtechs.focusflow.widget.FocusFlowWidget'
    );
    if (!widgetExists) {
      if (!app.receiver) app.receiver = [];
      app.receiver.push({
        $: {
          'android:name':     'com.tbtechs.focusflow.widget.FocusFlowWidget',
          'android:exported': 'true',
        },
        'intent-filter': [{
          action: [
            { $: { 'android:name': 'android.appwidget.action.APPWIDGET_UPDATE' } },
          ],
        }],
        'meta-data': [{
          $: {
            'android:name':     'android.appwidget.provider',
            'android:resource': '@xml/widget_info',
          },
        }],
      });
    }

    // ── <queries> block for Android 11+ package visibility ────────────────────
    // Without this, PackageManager.getInstalledPackages() returns an empty list
    // on API 30+ for user-installed apps (package visibility restrictions).
    if (!manifest.manifest['queries']) {
      manifest.manifest['queries'] = [{
        'intent': [{
          'action': [{ $: { 'android:name': 'android.intent.action.MAIN' } }],
        }],
      }];
    }

    return cfg;
  });
}

// ─── 3. Register FocusDayPackage via withMainApplication ─────────────────────
//
// Uses Expo's withMainApplication modifier (available in expo/config-plugins)
// which provides the Kotlin source as a string with a reliable hook. This
// replaces the previous fragile regex-based patching approach.
//
// If the injection point cannot be found (e.g. unexpected template format),
// an error is thrown so the build fails loudly instead of producing a silently
// broken APK.

function withFocusDayPackageRegistration(config) {
  return withMainApplication(config, (cfg) => {
    let src = cfg.modResults.contents;

    // Check if already registered to avoid double-patching on re-runs
    if (/add\(\s*FocusDayPackage\s*\(\s*\)\s*\)/.test(src)) {
      console.log('[withFocusDayAndroid] MainApplication.kt already registers FocusDayPackage — skipping patch.');
      cfg.modResults.contents = src;
      return cfg;
    }

    // ── Inject import if not already present ─────────────────────────────────
    if (!src.includes('com.tbtechs.focusflow.modules.FocusDayPackage')) {
      if (src.includes('import com.facebook.react.ReactApplication')) {
        src = src.replace(
          'import com.facebook.react.ReactApplication',
          'import com.facebook.react.ReactApplication\nimport com.tbtechs.focusflow.modules.FocusDayPackage'
        );
      } else if (/^package\s+[\w.]+/m.test(src)) {
        src = src.replace(
          /^(package\s+[\w.]+)/m,
          '$1\nimport com.tbtechs.focusflow.modules.FocusDayPackage'
        );
      } else {
        throw new Error(
          '[withFocusDayAndroid] ERROR: Cannot inject FocusDayPackage import — no known import anchor found in MainApplication.kt. ' +
          'This is a fatal build error; the generated MainApplication.kt has an unexpected structure.'
        );
      }
    }

    // ── Strategy A: RN 0.76+ / Expo SDK 52+ expression-body format ───────────
    // Matches:  PackageList(this).packages.apply {
    // Injects:  add(FocusDayPackage()) as first line inside apply block
    const modernRegex = /(PackageList\(this\)\.packages\.apply\s*\{)/;
    if (modernRegex.test(src)) {
      src = src.replace(modernRegex, '$1\n              add(FocusDayPackage())');
      console.log('[withFocusDayAndroid] Patched MainApplication.kt (modern expression-body format).');
      cfg.modResults.contents = src;
      return cfg;
    }

    // ── Strategy B: Old block-body format (RN < 0.76) ────────────────────────
    // Matches:  val packages = PackageList(this).packages
    const legacyRegex = /(val packages = PackageList\(this\)\.packages)/;
    if (legacyRegex.test(src)) {
      src = src.replace(
        legacyRegex,
        `$1\n        packages.add(FocusDayPackage())`
      );
      console.log('[withFocusDayAndroid] Patched MainApplication.kt (legacy block-body format).');
      cfg.modResults.contents = src;
      return cfg;
    }

    // ── Strategy C: getPackages() return expression fallback ─────────────────
    // Handles any Expo SDK 54 / RN 0.76 template variation where the
    // function body uses a different local variable name or structure.
    const getPackagesReturnRegex = /(override\s+fun\s+getPackages[\s\S]*?)(return\s+PackageList\(this\)\.packages(?:\.apply\s*\{[^}]*\})?)/;
    if (getPackagesReturnRegex.test(src)) {
      src = src.replace(
        getPackagesReturnRegex,
        (match, prefix, returnStmt) => {
          const pkgsExpr = returnStmt.replace(/^return\s+/, '');
          return `${prefix}val _focusDayPkgs = ${pkgsExpr}\n        _focusDayPkgs.add(FocusDayPackage())\n        return _focusDayPkgs`;
        }
      );
      console.log('[withFocusDayAndroid] Patched MainApplication.kt (getPackages() regex fallback).');
      cfg.modResults.contents = src;
      return cfg;
    }

    // ── No strategy matched — throw so EAS build fails loudly ────────────────
    throw new Error(
      '[withFocusDayAndroid] ERROR: Could not find a known getPackages() pattern in MainApplication.kt. ' +
      'FocusDayPackage was NOT registered. This is a fatal build error — check the generated MainApplication.kt ' +
      'and update the plugin to match its structure.'
    );
  });
}

// ─── 4. Copy Kotlin source files + resource files ────────────────────────────

function withFocusDayKotlin(config) {
  return withDangerousMod(config, [
    'android',
    (cfg) => {
      const projectRoot  = cfg.modRequest.projectRoot;
      const platformRoot = cfg.modRequest.platformProjectRoot;

      const pkg        = 'com/tbtechs/focusflow';
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
            `    <string name="accessibility_service_description">FocusFlow uses Accessibility to detect and block distracting apps during your scheduled focus sessions. No personal data, messages, or browsing history are read.</string>\n</resources>`
          );
          fs.writeFileSync(stringsPath, content, 'utf8');
        }
      }

      return cfg;
    },
  ]);
}

// ─── 5. Patch app/build.gradle: R8 + shrinkResources + ABI splits ─────────────

function withFocusDayBuildConfig(config) {
  return withDangerousMod(config, [
    'android',
    (cfg) => {
      const platformRoot = cfg.modRequest.platformProjectRoot;
      const buildGradlePath = path.join(platformRoot, 'app', 'build.gradle');

      if (!fs.existsSync(buildGradlePath)) {
        console.warn('[withFocusDayAndroid] app/build.gradle not found — skipping build config patch.');
        return cfg;
      }

      let content = fs.readFileSync(buildGradlePath, 'utf8');

      // ── Enable R8 full minification for release ──────────────────────────
      // Expo default: minifyEnabled (findProperty('android.enableProguardInReleaseBuilds')?.toBoolean() ?: false)
      // We force it true so R8 runs unconditionally on release builds.
      const minifyPatched = content.replace(
        /minifyEnabled\s+\(findProperty\([^)]*\)\?\.toBoolean\(\)\s*\?:\s*false\)/,
        'minifyEnabled true'
      );
      if (minifyPatched !== content) {
        content = minifyPatched;
        console.log('[withFocusDayAndroid] Enabled minifyEnabled true for release.');
      } else if (!content.includes('minifyEnabled true')) {
        // Fallback: simple replacement if the pattern is slightly different
        content = content.replace(/minifyEnabled\s+false/, 'minifyEnabled true');
        console.log('[withFocusDayAndroid] Fallback: set minifyEnabled true for release.');
      }

      // ── Enable shrinkResources (requires minifyEnabled true) ─────────────
      if (!content.includes('shrinkResources')) {
        content = content.replace(
          /(minifyEnabled\s+true)/,
          '$1\n            shrinkResources true'
        );
        console.log('[withFocusDayAndroid] Enabled shrinkResources true for release.');
      }

      // ── ABI splits: arm64 + arm32 + universal fallback ───────────────────
      // Users get only the slice for their CPU. Play Store delivers the right
      // one automatically. Direct APK installs can use the universalApk.
      if (!content.includes('splits {')) {
        content = content.replace(
          /(\n\s*buildTypes\s*\{)/,
          `\n    splits {
        abi {
            enable true
            reset()
            include "arm64-v8a", "armeabi-v7a"
            universalApk true
        }
    }$1`
        );
        console.log('[withFocusDayAndroid] Added ABI splits (arm64-v8a, armeabi-v7a + universal).');
      }

      fs.writeFileSync(buildGradlePath, content, 'utf8');
      return cfg;
    },
  ]);
}

// ─── 6. Patch proguard-rules.pro: keep all custom focusflow classes ────────────

function withFocusDayProguard(config) {
  return withDangerousMod(config, [
    'android',
    (cfg) => {
      const platformRoot = cfg.modRequest.platformProjectRoot;
      const proguardPath = path.join(platformRoot, 'app', 'proguard-rules.pro');

      const rules = `
# FocusFlow custom Kotlin modules, services, and receivers
# Keep everything under the app package so R8 doesn't strip native bridge classes
-keep class com.tbtechs.focusflow.** { *; }
-keepclassmembers class com.tbtechs.focusflow.** { *; }
`;

      if (!fs.existsSync(proguardPath)) {
        fs.writeFileSync(proguardPath, rules, 'utf8');
        console.log('[withFocusDayAndroid] Created proguard-rules.pro with focusflow keep rules.');
      } else {
        const existing = fs.readFileSync(proguardPath, 'utf8');
        if (!existing.includes('com.tbtechs.focusflow')) {
          fs.writeFileSync(proguardPath, existing + rules, 'utf8');
          console.log('[withFocusDayAndroid] Appended focusflow keep rules to proguard-rules.pro.');
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
  config = withFocusDayPackageRegistration(config);
  config = withFocusDayBuildConfig(config);
  config = withFocusDayProguard(config);
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
