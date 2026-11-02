# Hillpace: building the iPhone app

Step-by-step instructions for the owner, on a Mac, from a fresh checkout to TestFlight.

**No Mac?** GitHub's macOS machines compile the app on every push, and can upload a signed build to TestFlight for you.
See **"Build in the cloud (no Mac needed)"** right below. You still need an Apple Developer Program membership and an iPhone to test with.
Last updated 1 November 2026. Stack: Capacitor 8.6.0 (Swift Package Manager), iOS 17.0 minimum, iPhone only, portrait.

---

## 0. What is already done, and what is not

**Done in the repository (no Mac needed):**

| Item | Where |
|---|---|
| Exact-pinned Capacitor 8.6.0 and 9 plugins (see the table in section 9) | `package.json`, `package-lock.json` |
| Capacitor config: `appId`, `webDir: "www"`, `contentInset: "never"`, no link previews, splash 400 ms, `LocalNotifications.presentationOptions: []` (cue notifications never show while the app is open), no `server.url` | `capacitor.config.json` |
| Xcode project generated with `npx cap add ios` (this **worked on Linux** with CLI 8.6.0) and synced with `npx cap sync ios` | `ios/` |
| Apple Health plugin (local Capacitor plugin, `HKWorkoutBuilder`) | `native/HealthBridgePlugin.swift` |
| Root view controller that registers the plugin and paints the launch background in the app's light/dark colours | `native/MainViewController.swift` |
| Privacy manifest, entitlements (HealthKit, Time Sensitive), Info.plist keys | `native/PrivacyInfo.xcprivacy`, `native/App.entitlements`, `native/Info.plist-additions.xml` |
| A script that copies all of the above into `ios/App/App/`, adds them to the App target and sets build settings | `native/wire-ios.mjs` (already run; safe to re-run) |
| App icon (1024 px, opaque) and light/dark launch images in the asset catalog | from `assets/` |
| Privacy policy and support pages (also bundled in the app as `privacy.html` and `support.html`) | `legal/` |

**Not done, because it needs a Mac, Xcode or your Apple account:**

- Compiling. There is no Swift compiler in the container, so **the Swift files have never been built**. They are written against the Capacitor 8.6 and iOS 17 SDK APIs; expect at most small fixes on the first build (section 10 lists the likely ones).
- Signing (your Team), registering the bundle ID and its capabilities, device testing, archiving and uploading.

---

## Build in the cloud (no Mac needed)

This repository has three GitHub Actions workflows (`.github/workflows/`):

| Workflow | When it runs | What it does |
|---|---|---|
| **iOS build** | every push and pull request | Installs dependencies, builds the web app, runs `npx cap sync ios` and compiles the real Xcode project for the iOS Simulator with the newest Xcode on GitHub's macOS runner. A green tick means the Swift code (including the Apple Health plugin) compiles. The full log is attached to each run as `xcodebuild-log`. |
| **Tests** | every push and pull request | Runs the logic, end-to-end and migration tests. |
| **Pages** | pushes to `main` | Publishes `www/` to GitHub Pages: the web version of the app plus `privacy.html` and `support.html`, which App Store Connect needs as public URLs. One-time setup: **Settings → Pages → Source: GitHub Actions**. |

### Upload to TestFlight from GitHub (still no Mac)

1. **Join the Apple Developer Program** and wait for it to be approved.
2. **Create the app in App Store Connect** (My Apps → + → New App) with your bundle ID, e.g. `com.yourname.hillpace`. Xcode's automatic signing registers the ID and its HealthKit capability on the first upload; if App Store Connect asks for the ID first, register it at developer.apple.com → Certificates, IDs & Profiles → Identifiers with **HealthKit** and **Time Sensitive Notifications** ticked.
3. **Create an App Store Connect API key:** App Store Connect → Users and Access → Integrations → App Store Connect API → Team Keys → +. Give it the **Admin** role (automatic signing in the cloud needs it to create the distribution certificate). Download the `.p8` file (you can only download it once) and note the **Key ID** and the **Issuer ID** shown above the list.
4. **Find your Team ID:** developer.apple.com → Account → Membership details.
5. **Add five repository secrets** (GitHub → Settings → Secrets and variables → Actions → New repository secret):

   | Secret | Value |
   |---|---|
   | `ASC_KEY_ID` | the key's Key ID |
   | `ASC_ISSUER_ID` | the Issuer ID |
   | `ASC_KEY_P8_BASE64` | the `.p8` file base64-encoded. On any computer: `base64 -i AuthKey_XXXX.p8` (macOS) or `base64 -w0 AuthKey_XXXX.p8` (Linux); on Windows PowerShell: `[Convert]::ToBase64String([IO.File]::ReadAllBytes("AuthKey_XXXX.p8"))` |
   | `APPLE_TEAM_ID` | your 10-character Team ID |
   | `IOS_BUNDLE_ID` | the bundle ID from step 2 |

6. **Run it:** GitHub → Actions → **iOS build** → Run workflow → tick **Upload a signed build to TestFlight** → Run. The build number is the workflow run number, so every upload is unique.
7. After Apple processes the build (usually 10–30 minutes) it appears in App Store Connect → TestFlight. Install the **TestFlight** app on your iPhone, add yourself as an internal tester, and install Hillpace.
8. Do the device checklist in section 6 using that TestFlight build, then submit for review from App Store Connect in your browser. Submission itself never needs a Mac.

Notes:
- The upload job has not been run yet (it needs your Apple account), so the first run may need a small fix; the job's logs are attached to the run.
- Keep the repository's secrets private; never commit the `.p8` file (`.gitignore` blocks `*.p8`).
- This repository is public, so its source code is visible to anyone. If you'd rather keep it private, switch it in Settings → General → Danger Zone; macOS build minutes are then billed against your account's quota.

---

## 1. Prerequisites

- **Apple Developer Program** membership (Individual or Organization). The seller name on the App Store comes from this enrolment.
- A Mac with **macOS 26 (Tahoe) or later** and **Xcode 26 or later** (App Store uploads require the iOS 26 SDK). Open Xcode once and let it install its components.
- **Node.js 22 or later** (`node -v`). Install from nodejs.org or with `brew install node@22`.
- A **real iPhone on iOS 17 or later**, with **Developer Mode** on (Settings → Privacy & Security → Developer Mode). The simulator cannot reproduce screen-lock behaviour, notifications timing or Apple Health on a real device.
- Git.

---

## 2. Get the code and build the web app

```bash
git clone <your repository URL> hillpace
cd hillpace
npm ci                         # installs the exact pinned versions from package-lock.json
node scripts/build.mjs         # writes www/index.html, www/fonts/, www/privacy.html, www/support.html
```

`www/index.html` carries a Content-Security-Policy: only the bundled script (by its hash) runs, and fonts, the legal pages and images load from the app itself. It is regenerated on every build; if you ever add a remote resource or a second script, extend the policy in `scripts/build.mjs`.

Then bring the iOS project up to date:

```bash
# If ios/ is in the repository (recommended: commit it):
npx cap sync ios               # copies www/ into ios/App/App/public and refreshes the plugin list

# Only if ios/ is missing (fresh project, or you deleted it):
npx cap add ios
node native/wire-ios.mjs       # copies native/ files into the project and applies all settings
npx cap sync ios
```

`npx cap sync` never touches the native files, so the wiring survives. Re-run `node native/wire-ios.mjs` whenever you change a file in `native/` (the copies in `ios/App/App/` are overwritten from `native/`) or after regenerating `ios/`. Shortcut: `npm run ios:sync`.

---

## 3. Open the project

Capacitor 8 uses **Swift Package Manager**, not CocoaPods. There is **no `.xcworkspace`**: open the project file.

```bash
npx cap open ios               # same as: open ios/App/App.xcodeproj
```

Wait for Xcode to finish "Resolving Package Graph" (bottom of the navigator). The packages come from `node_modules/` (the plugins) and from GitHub (`capacitor-swift-pm` 8.6.0), so the first resolve needs a network connection and `npm ci` must have run.

---

## 4. Configure the App target in Xcode

Select the blue **App** project in the navigator, then the **App** target.

### 4.1 Signing & Capabilities

1. **Team:** choose your developer team. Leave "Automatically manage signing" on.
2. **Bundle Identifier:** replace `com.example.hillpace` with your own reverse-DNS ID, for example `com.yourname.hillpace`. Also change `appId` in `capacitor.config.json` to the same value and run `npx cap sync ios` (keeps the two in step; the bundle ID in Xcode is the one that counts).
3. **Capabilities:** the entitlements file `App/App.entitlements` is already linked (build setting `CODE_SIGN_ENTITLEMENTS`), so you should see:
   - **HealthKit**: leave "Clinical Health Records" and "Background Delivery" **unchecked**.
   - **Time Sensitive Notifications.**

   If either is missing, click **+ Capability** and add it; Xcode reuses `App.entitlements`. With automatic signing, Xcode registers both capabilities on your App ID. Do **not** add Push Notifications, Background Modes or App Groups.

### 4.2 General

- **Supported Destinations:** iPhone only. Remove iPad, "Mac (Designed for iPhone)" and "Apple Vision (Designed for iPhone)" if listed (the wiring script already sets `TARGETED_DEVICE_FAMILY = 1` and turns the Mac/Vision options off).
- **Minimum Deployments:** iOS **17.0** (already set for the project and the target).
- **Display Name:** Hillpace. **Version:** 1.0. **Build:** 1 (increase the build for every upload).
- **Device Orientation:** Portrait only (already set in Info.plist).
- **App Icons and Launch Screen:** App Icon source = `AppIcon` (already contains `assets/icon-only.png`, 1024×1024, no transparency). The launch screen uses the `Splash` image set (light and dark variants from `assets/splash.png` and `assets/splash-dark.png`).

### 4.3 Check the wiring (one minute)

- In the navigator, under **App**: `HealthBridgePlugin.swift`, `MainViewController.swift`, `PrivacyInfo.xcprivacy`, `App.entitlements` are present. Click each Swift file and confirm **Target Membership → App** is ticked in the File inspector.
- **Build Phases → Copy Bundle Resources** lists `PrivacyInfo.xcprivacy` and `public`.
- `SceneDelegate.swift` contains `window?.rootViewController = MainViewController()`. This is the line that matters: the Capacitor 8 template builds its window in code. (`Main.storyboard` also names `MainViewController`, module App, for completeness. The scene's `UISceneStoryboardFile` entry was removed from Info.plist so only one bridge is ever created.)
- **Info** tab (Info.plist) contains:
  - `NSHealthShareUsageDescription`: "Hillpace reads your body weight from Apple Health to keep your weight trend up to date. Your data stays on your iPhone."
  - `NSHealthUpdateUsageDescription`: "Hillpace saves your treadmill workouts (time, estimated distance and estimated active energy) and the weights you log to Apple Health."
  - `ITSAppUsesNonExemptEncryption` = NO (no export-compliance question on upload)
  - `UISupportedInterfaceOrientations` = Portrait only
  - **No** `UIBackgroundModes` key.
- **Build Settings → Swift Language Version:** Swift 5. If Xcode offers "Update to recommended settings", accept everything **except** switching the Swift language mode to 6.

---

## 5. First run on your iPhone

1. Connect the iPhone with a cable (or pair it over Wi-Fi in Window → Devices and Simulators). Trust the Mac on the phone.
2. Choose the iPhone as the run destination at the top of the Xcode window and press **Run** (⌘R).
3. The first time, the phone may refuse to open the app: Settings → General → VPN & Device Management → trust your developer certificate.
4. In the Xcode console you should see `⚡️  Loading app at capacitor://localhost...` **once**, and no line saying `HealthBridge` "is not implemented".

**Optional plugin smoke test (Debug builds only).** On the Mac, Safari → Settings → Advanced → "Show features for web developers". With the app open on the phone: Safari → Develop → *your iPhone* → Hillpace. In the console:

```js
const H = Capacitor.registerPlugin('HealthBridge');
await H.isAvailable();            // → {available: true}
await H.authorizationStatus();    // → {available: true, workouts: 'notDetermined', weight: 'notDetermined'}
```

---

## 6. Device test checklist (do all of this before TestFlight)

Use a real iPhone, a release-like build (Product → Scheme → Edit Scheme → Run → Build Configuration: Release, if you want to rule out debug-only behaviour).

**Permissions are asked only when you tap**
- [ ] Fresh install → onboarding → on the permissions step tap **Not now** for both. Start a workout and save reminders later: **no system prompt appears** by itself. (Capacitor's LocalNotifications 8.3 asks for permission inside `schedule()`; the app checks permission first, this test proves it.)
- [ ] Me → Apple Health → Connect: the Health sheet lists **Workouts, Active Energy, Walking + Running Distance, Weight** to write and **Weight** to read.

**Locked-screen cue matrix** (start a workout with short intervals, e.g. a custom workout with 1-minute steps)

| Screen | Music playing | Ring/Silent switch | Focus | Expected |
|---|---|---|---|---|
| On (app open) | No | Ring | Off | Voice cues + beeps + haptics; screen never dims; **no** notification banners |
| On | Yes | Ring | Off | Voice cues play over the music |
| On | No | Silent | Off | Voice cues still audible (note the result: if they are muted, report it) |
| Locked | No | Ring | Off | A time-sensitive notification banner at each interval change, with the default notification sound (confirm on a real device) |
| Locked | No | Silent | Off | Notification banner + vibration, no sound (expected iOS behaviour; confirm on a real device) |
| Locked | Yes | Ring | Off | Notification arrives; music keeps playing |
| Locked | No | Ring | On (e.g. Fitness/Do Not Disturb) | Arrives only if Time Sensitive is allowed for that Focus |
| Unlock mid-workout | any | any | any | Timer shows the right interval (wall-clock), pending notifications are rescheduled, no burst of old cues |

**Workout flow**
- [ ] Pause, resume, skip, +30 s, speed nudge; End (press and hold) → summary.
- [ ] Force-quit mid-workout and reopen → "Resume your workout?" appears.
- [ ] Haptics at interval changes and on finish; the Haptics switch in Me turns them off.

**Apple Health** (check in the Health app, Browse → Activity → Workouts)
- [ ] A finished session of 1 minute or more appears as an **Indoor Walk** (or Indoor Run) with duration, active energy and distance; "Elevation Gain" shows in its details.
- [ ] Logging a weight in Hillpace adds it under Browse → Body Measurements → Weight. Changing the same day's weight in Hillpace **replaces** it (no duplicate).
- [ ] Add a weight in the Health app by hand: it appears in Hillpace's weight trend. Hillpace's own weights are not imported twice.
- [ ] With the Apple Watch option on, the workout is saved without energy and distance.
- [ ] Deny Health access in Settings → Health → Data Access & Devices → Hillpace: the app keeps working, manual weights still save.

**Notifications**
- [ ] Reminders: set one for 2 minutes from now, close the app: it arrives on time. With the app open, it does **not** show (by design: `presentationOptions: []`).

**Offline and data**
- [ ] Airplane mode on, Wi-Fi off: onboarding, a full workout, summary, history and weight all work.
- [ ] Me → Back up & restore → Export backup → save to Files. Erase all data → onboarding appears. "Restore from a backup" brings everything back.
- [ ] Me → Privacy policy shows the text of the bundled `privacy.html`, and Me → Support shows the FAQ from the bundled `support.html` (both copied from `legal/` into `www/` by the build, and hosted for the App Store listing). Editing `legal/` and rebuilding updates both.

**Look and accessibility**
- [ ] Launch in light and in dark mode: no white flash, correct status-bar colour.
- [ ] Settings → Accessibility → Display & Text Size → Larger Text: interface text grows with the slider (the app follows Dynamic Type). Turn on Larger Accessibility Sizes and check a middle and the largest size on Today, a bottom sheet, the tab bar, the player and the onboarding footer: text wraps and nothing important is cut off.
- [ ] Pinch-zoom works on any screen (the app does not block zooming); double-tapping a button does not zoom.
- [ ] VoiceOver: every button on Today, the player and the summary is announced with a meaningful name.

---

## 7. Archive, upload and TestFlight

1. Create the app record first (see `APP_STORE.md`, section 0): App Store Connect → Apps → + → New App, with your bundle ID.
2. In Xcode: set the run destination to **Any iOS Device (arm64)**. Bump **Build** if you uploaded before.
3. **Product → Archive.** When it finishes, the Organizer opens.
4. **Distribute App → App Store Connect → Upload.** Keep "Upload your app's symbols" on and automatic signing.
5. Wait for the processing email (10–30 minutes). Read any warnings: ITMS-91053 (missing required-reason API declaration) or ITMS-90683 (missing purpose string) need fixing before review (section 10).
6. **TestFlight → Internal Testing:** add yourself and up to 100 team members. Install the TestFlight app on the iPhone and accept.
7. Train with it for at least a week of real sessions before submitting for review. External testers need a short Beta App Review.

---

## 8. Host the privacy policy and support pages (GitHub Pages)

App Store Connect needs public HTTPS URLs for both pages.

1. Create a public GitHub repository, for example `hillpace-site`.
2. Add `legal/privacy.html`, `legal/support.html`, plus a `fonts/` folder with `assets/fonts/Archivo-latin.woff2` and `assets/fonts/HankenGrotesk-latin.woff2` (optional: without them the pages fall back to system fonts and log a harmless 404). Copy `support.html` to `index.html` as well, so the site root shows the support page.
3. Repository Settings → Pages → Deploy from branch → `main` / root. After a minute the pages are at
   `https://<your-github-user>.github.io/hillpace-site/privacy.html` and `.../support.html`.
4. Put these URLs into App Store Connect (Privacy Policy URL, Support URL). On iPhone, Me → Privacy policy shows the text of the bundled `privacy.html` and Me → Support shows the FAQ from the bundled `support.html` (both in `www/`, so they work offline). Editing `legal/` and rebuilding updates both.

---

## 9. Placeholders you must replace

| Placeholder | Where | Replace with |
|---|---|---|
| `[Your name]` | `legal/privacy.html` (sections 1 and 11, footer), `legal/support.html` (contact card, footer) | Your legal name or company name (must match your developer account seller name) |
| `support@hillpace.app` | `legal/privacy.html`, `legal/support.html`, `APP_STORE.md`, and `package.json` → `config.supportEmail` (the in-app address on Me → Support; `node scripts/build.mjs` warns while it is the placeholder) | A mailbox you read. Either register the `hillpace.app` domain and set up forwarding, or use your own address everywhere |
| `com.example.hillpace` | `capacitor.config.json` (`appId`), Xcode bundle identifier | Your reverse-DNS bundle ID |
| `© 2026 [Your name]` / Copyright | page footers, App Store Connect "Copyright" | "2026 Your Name" |
| `<your-github-user>` URLs | App Store Connect Support/Privacy URLs, `APP_STORE.md` | Your real GitHub Pages URLs |

If you change a page in `legal/`, run `node scripts/build.mjs && npx cap sync ios` so the bundled copy updates too.

**Pinned packages (do not upgrade casually):** `@capacitor/core`, `@capacitor/ios`, `@capacitor/cli` 8.6.0 · `@capacitor/app` 8.1.2 · `@capacitor/haptics` 8.0.2 · `@capacitor/local-notifications` 8.3.1 · `@capacitor/filesystem` 8.1.5 · `@capacitor/share` 8.0.3 · `@capacitor/status-bar` 8.0.4 · `@capacitor/splash-screen` 8.0.2 · `@capacitor-community/keep-awake` 8.0.1 · `@capacitor-community/text-to-speech` 8.0.2. All declare `@capacitor/core >= 8.0.0` and ship a `Package.swift` (checked with `npm view` on 1 November 2026). Not included on purpose: native-audio, Live Activities and other Health plugins.

---

## 10. Things to verify on the Mac (could not be checked in the container)

- [ ] **The Swift compiles.** Most likely first-build nits, if any: a renamed HealthKit completion-handler label, or an `open`/`public` modifier warning. The plugin uses only long-standing APIs: `HKWorkoutBuilder.beginCollection(withStart:)`, `add(_:completion:)`, `addMetadata(_:completion:)`, `endCollection(withEnd:)`, `finishWorkout(completion:)`, `HKHealthStore.save`, `deleteObjects(of:predicate:)`, `HKSampleQuery`.
- [ ] **Privacy manifest reason codes.** `PrivacyInfo.xcprivacy` declares UserDefaults **CA92.1** (data only this app can access; Capacitor's own key-value store) and File timestamp **C617.1** (metadata of files inside the app container; Filesystem plugin). Check both against Apple's current list: <https://developer.apple.com/documentation/bundleresources/describing-use-of-required-reason-api>. No tracking, no tracking domains, no collected data types (nothing leaves the device). Capacitor's own frameworks ship their own manifests; after archiving, Organizer → right-click the archive → **Generate Privacy Report** shows the merged result.
- [ ] Voice cues with the Silent switch on and with music playing (matrix above).
- [ ] Saving to Apple Health from the summary right after a workout (the phone is unlocked there, so it should work; one developer report says `finishWorkout` can fail while the phone is locked on iOS 26.4+).

---

## 11. Troubleshooting

| Symptom | Cause and fix |
|---|---|
| Console: `"HealthBridge" plugin is not implemented on ios` and Health buttons do nothing | `MainViewController` is not the root view controller or not compiled. Check `SceneDelegate.swift` uses `MainViewController()` and both Swift files have Target Membership → App. Re-run `node native/wire-ios.mjs`. |
| App crashes the moment you tap Connect Apple Health | Missing `NSHealthShareUsageDescription` / `NSHealthUpdateUsageDescription` in Info.plist, or the HealthKit capability. Re-run the wiring script; check section 4.1. |
| Build error: provisioning profile doesn't include `com.apple.developer.healthkit` or `...usernotifications.time-sensitive` | With automatic signing: remove and re-add the capability in Signing & Capabilities, or toggle "Automatically manage signing" off and on. In the developer portal, the App ID needs HealthKit and Time Sensitive Notifications enabled. |
| "Missing package product 'CapApp-SPM'" or a plugin package path not found | `node_modules/` is missing or stale. Run `npm ci`, then `npx cap sync ios`, then in Xcode File → Packages → Reset Package Caches. |
| White screen, or Xcode console says the app could not find `index.html` | `www/` was not built or not copied: `node scripts/build.mjs && npx cap sync ios`. If the Safari Web Inspector console shows "Refused to execute … Content Security Policy", `www/index.html` was edited by hand after the build: rebuild instead. |
| Notifications appear as banners while the app is open | `capacitor.config.json` must have `"LocalNotifications": {"presentationOptions": []}`; run `npx cap sync ios` (it writes `ios/App/App/capacitor.config.json`). |
| Interval notifications don't break through a Focus | Expected unless the user allows time-sensitive notifications for Hillpace in that Focus. Without the Time Sensitive entitlement they arrive as ordinary notifications. |
| Upload warning ITMS-91053 (missing API declaration) | Add the named API category and its reason code to `native/PrivacyInfo.xcprivacy`, re-run the wiring script, archive again. |
| Upload error ITMS-90717 (icon has transparency) | The icon must be opaque. `assets/icon-only.png` is RGB without alpha; if you replace it, export without alpha. |
| Swift 6 concurrency errors after accepting Xcode's recommended settings | Set Swift Language Version back to Swift 5 for the App target. |
| Two copies of the app seem to run (double voice cues, duplicate saves) | Info.plist regained `UISceneStoryboardFile` (for example after copying an old Info.plist). Remove it, or re-run the wiring script. |
| The app shows an old version of the web code | `npx cap sync ios` after every `node scripts/build.mjs`; then Product → Clean Build Folder. |
| You regenerated `ios/` and Health stopped working | `npx cap add ios` creates a fresh template. Run `node native/wire-ios.mjs` again. |
