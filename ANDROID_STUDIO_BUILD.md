# Building FocusFlow in Android Studio (Fresh Install)

## Prerequisites — Install These First

1. **Android Studio** — download from https://developer.android.com/studio  
   During setup, let it install the default SDK (API 35) and emulator components.

2. **Node.js 20** — download from https://nodejs.org (choose the LTS version)

3. **pnpm** — open a terminal after Node is installed and run:
   ```
   npm install -g pnpm@9
   ```

---

## Step 1 — Download the Repository

Open a terminal (Command Prompt / PowerShell on Windows, Terminal on Mac/Linux):

```bash
git clone https://github.com/TITANICBHAI/FocusFlow.git
cd FocusFlow
```

---

## Step 2 — Install JavaScript Dependencies

Still inside the `FocusFlow` folder:

```bash
pnpm install
```

This downloads all JS packages. It may take 2–3 minutes the first time.

---

## Step 3 — Generate the Android Project

```bash
cd artifacts/focusflow
npx expo prebuild --platform android --clean
```

This generates the `android/` folder with all native code wired up.  
It will take 1–2 minutes. You will see `[withFocusDayAndroid] Patched ...` messages — those are expected.

---

## Step 4 — Open in Android Studio

1. Open **Android Studio**
2. Click **"Open"** (not "New Project")
3. Navigate to:  
   `FocusFlow/artifacts/focusflow/android`  
   Select that `android` folder and click **OK**
4. Android Studio will sync Gradle automatically — wait for it to finish (may take 3–5 minutes on first open)

---

## Step 5 — Build the APK

### Option A — Build from Android Studio UI (easiest)

1. In the top menu: **Build → Build Bundle(s) / APK(s) → Build APK(s)**
2. Wait for the build to finish (look for "Build: Analyze | Locate" in the bottom bar)
3. Click **"Locate"** in the notification that appears — it opens the folder with your APK

### Option B — Build from Terminal (faster)

Inside `FocusFlow/artifacts/focusflow/android`:

```bash
# Windows
.\gradlew.bat assembleDebug

# Mac / Linux
./gradlew assembleDebug
```

The APK will be at:
```
artifacts/focusflow/android/app/build/outputs/apk/debug/app-debug.apk
```

---

## Step 6 — Install on Your Phone

Enable **USB Debugging** on your Android device:
- Settings → About Phone → tap "Build Number" 7 times
- Settings → Developer Options → enable "USB Debugging"

Connect your phone via USB, then in Android Studio click the **▶ Run** button (green triangle) and select your device.

Or drag-and-drop the APK file from your PC onto the phone via USB.

---

## Common Issues

| Problem | Fix |
|---------|-----|
| `JAVA_HOME not set` | Android Studio bundles JDK 17 — point Gradle to it: File → Project Structure → SDK Location → JDK Location → use the Android Studio bundled JDK |
| `SDK location not found` | Open `local.properties` in the `android/` folder and set `sdk.dir=C\:\\Users\\YourName\\AppData\\Local\\Android\\Sdk` (Windows) or `sdk.dir=/Users/YourName/Library/Android/sdk` (Mac) |
| `pnpm: command not found` | Run `npm install -g pnpm@9` in a fresh terminal |
| Gradle sync fails on first open | Let it retry once; if it fails again, File → Invalidate Caches → Restart |
| `expo: command not found` | Run `npx expo prebuild ...` (with `npx` prefix) instead of `expo prebuild` |

---

## Notes

- You need a fresh `expo prebuild` every time you change `app.json` or the native plugin.
- The `android/` folder is auto-generated — do **not** edit files inside it directly.
- All native Kotlin code lives in `artifacts/focusflow/android-native/` and is copied automatically during prebuild.
- Debug builds are unsigned and for testing only. For a signed release build, see `build-release.yml`.
