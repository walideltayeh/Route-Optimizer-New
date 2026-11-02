# Hillpace

An iPhone app for incline-treadmill walking and jogging intervals. It builds a personal 12-week plan from your goal, schedule and treadmill, coaches each session with big speed and incline targets and voice cues, and tracks history, weight trend and badges. No account, no ads, no tracking: data stays on the device.

Built with Capacitor 8 around plain JavaScript modules. The same source also builds a single-file web page.

## Start here

| You want to… | Read |
|---|---|
| Build and run it on your iPhone, then upload to TestFlight | `IOS_BUILD.md` |
| Build without a Mac (GitHub compiles it and can upload to TestFlight) | `IOS_BUILD.md` → "Build in the cloud" |
| Fill in App Store Connect (name, description, keywords, privacy answers, review notes) | `APP_STORE.md` |
| Understand or change the code | `ARCHITECTURE.md` |
| Host the privacy policy and support pages | `legal/` + `IOS_BUILD.md` §8 |

## Commands

```bash
npm ci                     # install exact dependency versions
npm test                   # 74 logic checks + 7 end-to-end journeys + data migration test
node scripts/build.mjs     # production build → www/ (iOS app) and dist/hillpace.html (web page)
npx cap sync ios           # copy www/ and plugins into the Xcode project
npx cap open ios           # open in Xcode (on a Mac)
node scripts/store-shots.mjs   # regenerate App Store screenshots → store/screenshots/{6.9,6.3}/
```

## What's in the box

```
src/            app source (core logic, UI kit, screens, styles)
native/         Swift: Apple Health plugin, view controller, privacy manifest, Info.plist keys
ios/            generated Xcode project (already wired with the native files)
assets/         app icon (1024 px, no alpha), splash screens, bundled fonts
store/          App Store screenshots: 6.9" (1320×2868) and 6.3" (1206×2622)
legal/          privacy.html and support.html, ready for GitHub Pages
tests/          logic, end-to-end and migration tests (Playwright)
scripts/        build, screenshot and fixture scripts
```

## Before you submit

1. Replace the placeholders listed in `IOS_BUILD.md` §9: bundle ID (`com.example.hillpace`), support email (`package.json` → `config.supportEmail`), your name, and the hosted page URLs.
2. Check the name "Hillpace" is free (App Store, USPTO, EUIPO), then create the App Store Connect record the same day (`APP_STORE.md` §0).
3. Install it on a real iPhone (from Xcode, or through TestFlight using the cloud workflow) and run the device checklist in `IOS_BUILD.md` §6. The project compiles on GitHub's macOS runners (Xcode 26.6), but iOS-only features (Apple Health, lock-screen notifications, voice cues with music, haptics) can only be checked on a device.
4. Run TestFlight for at least a week of real sessions before submitting.

Calories are estimates from published equations (ACSM), and the app says so wherever they appear. The app is not a medical device.
