# Hillpace: App Store Connect metadata

Ready to paste. Last updated 1 November 2026. Character counts were checked with a script (counts are Unicode characters; keywords are counted in bytes, as Apple counts them).

Rules this copy follows: calories are always called estimates; no weight-loss or fat-burn outcome claims; no competitor or brand names; no "12-3-30"; Apple Health is mentioned (guideline 2.5.1) without Apple's Health icon.

---

## 0. Before you fill anything in: name and trademark checks

Do these the same day, then create the App Store Connect record immediately to reserve the name.

1. **Hillpace** (chosen). Search:
   - USPTO trademark search (<https://tmsearch.uspto.gov>): "Hillpace", and close variants "Hill Pace", "Hilpace", in classes **9** (software), **41** (fitness instruction), **44** (health) and **42** (software as a service).
   - EUIPO eSearch plus and the UK IPO search (same classes), and WIPO Global Brand Database.
   - App Store search on an iPhone and on the web ("Hillpace", "Hill Pace").
   - Domain (`hillpace.app`, `hillpace.com`) and social handles, if you want them.
   - "Incline" appears in the title only as a description of the activity. A live US registration "INCLINE RUNNING" (Reg. 5278311, class 41) exists, so do not style "Incline" as part of the brand (no "Hillpace Incline").
2. **Backups**, if Hillpace is taken: **Slopewise** (title: `Slopewise: Treadmill Coach`, 26 characters) and **Treadpeak** (title: `Treadpeak: Incline Walking`, 26 characters). Run the same searches. If you switch, change `appName` in `capacitor.config.json`, `CFBundleDisplayName`, the legal pages and this file.
3. Create the record: App Store Connect → Apps → + → New App → iOS, name, primary language, bundle ID (from Xcode), SKU `hillpace-ios-1`, Full Access.

---

## 1. App information

| Field | Value |
|---|---|
| **Name** (≤30) | `Hillpace: Incline Treadmill` (27) |
| **Subtitle** (≤30) | `Walk Intervals for Weight Loss` (30) |
| Alternative subtitle | `Incline Walking Plan & Coach` (28), if you prefer to avoid "weight loss" entirely |
| Primary language | English (U.S.). The copy below uses US spelling ("labeled"); add an English (U.K.) localization later if you want "labelled". |
| Bundle ID | your reverse-DNS ID (see `IOS_BUILD.md` 4.1) |
| SKU | `hillpace-ios-1` |
| **Primary category** | Health & Fitness |
| Secondary category | Sports (optional) |
| Content rights | "No, it does not contain, show, or access third-party content" |
| Copyright | `2026 [Your name]` |
| Price | Free (USD 0). No in-app purchases. |
| Availability | All countries you are comfortable supporting. For the **EU**, complete the Digital Services Act trader status first (a trader's address and phone are shown publicly), or leave EU storefronts out of v1. |
| iPhone and iPad apps on Apple Silicon Mac | **Untick** (Pricing and Availability). Apple Health and the treadmill use case are iPhone-only. |
| Apple Vision Pro | Untick ("Designed for iPhone" availability). |
| Support URL | `https://<your-github-user>.github.io/hillpace-site/support.html` |
| Privacy Policy URL | `https://<your-github-user>.github.io/hillpace-site/privacy.html` |
| Marketing URL | optional; leave empty or use the support page |

---

## 2. Promotional text (≤170, editable any time without review)

```
Your personal 12-week incline walking plan, coached interval by interval with voice cues. No account, no ads, and your data stays on your iPhone.
```
(145 characters)

---

## 3. Description (≤4000)

2,971 characters.

```
Hillpace turns your treadmill into a personal hill-walking coach. Answer a few questions about your goal, your week and your treadmill, and Hillpace builds a 12-week incline walking and jogging plan that fits. Then it coaches every session, interval by interval.

A PLAN THAT FITS YOU
• 12 weeks in three phases (Foundation, Build and Burn), with lighter recovery weeks built in
• Every workout stays within your treadmill's maximum speed and incline. No incline? Climbs become faster walking intervals instead
• Short on time? Switch any session to its 30-minute busy-day version and it still counts
• Rate how hard each session felt. After two very hard sessions Hillpace eases off or holds steady; after two easy ones it offers a step up, and you decide

COACHED INTERVAL BY INTERVAL
• Big, clear speed and incline targets you can read from the treadmill, with the change from the last interval
• Spoken cues before every change, countdown beeps and haptics
• The screen stays awake during your workout. If your phone locks, interval changes can arrive as notifications
• Pause, skip, add 30 seconds or nudge your speed at any time. The pause screen has an "I feel unwell" option that stops the workout and shows the stop signs

WORKOUTS FOR EVERY DAY
• Hill repeats, walk-jog ladders, steady climbs, incline pyramids and easy recovery walks
• Classic formats, including a steep steady walk, 3-minute fast and slow intervals, and 4×4 and sprint intervals that unlock when they are right for you
• Build your own interval workouts, or let Quick Draft create one on your iPhone in seconds

PROGRESS YOU CAN TRUST
• Workout history with notes, weekly activity minutes, distance and total climb
• A smoothed weight trend that looks past day-to-day swings, and a projection that is clearly labeled as a projection, never a promise
• Badges for real milestones and short lessons on incline walking, effort, recovery, sleep and habits
• Calorie figures are estimates based on published exercise equations and shown as net active energy. The app explains exactly how they are calculated
• Rather not see calories or weight? Train with minutes, distance and climb only

WORKS WITH APPLE HEALTH
Connect Apple Health to save your treadmill sessions as indoor walking or running workouts, save the weights you log, and read your weight from other apps and smart scales. Apple Health is optional, and Hillpace works fully without it.

PRIVATE BY DESIGN
• No account and no sign-in
• No ads, no analytics, no tracking
• Your data stays on your iPhone and the app works offline
• Export a backup or erase everything at any time

SAFETY FIRST
Hillpace starts with a short health check and keeps the early weeks moderate. Stop signs are shown before every workout and are always available in Me > Health & safety. Hillpace is a fitness app, not a medical device: talk to your doctor before starting a new exercise plan.

Hillpace is free, with no subscriptions and no in-app purchases.
```

---

## 4. Keywords (≤100 bytes)

```
hiit,hill,climb,jog,cardio,calorie,plan,coach,japanese,4x4,workout,run,uphill,slope,beginner,fitness
```
100 bytes, 16 terms, no spaces. Words already in the name or subtitle (hillpace, incline, treadmill, walk, intervals, weight, loss) are left out because Apple indexes those automatically.

- "japanese" is there because the app's 3-Minute Intervals workout is the fast/slow interval-walking method people search for by that name. Drop it if that workout is removed.
- Do not add "12-3-30", brand names or competitor names. Add "norwegian" only after a trademark check (swap it for "beginner").

---

## 5. What's New (version 1.0)

```
First release. A personal 12-week incline treadmill plan with spoken interval cues, effort-based adjustments, an honest weight trend and optional Apple Health.
```

---

## 6. Age rating questionnaire

Answer as follows (App Store Connect → App Information → Age Rating). Apple computes the rating; the expected result is a low rating (4+ or 9+).

| Question | Answer |
|---|---|
| Parental controls | No |
| Age assurance | No |
| Unrestricted web access | **No** (no browser; links to the bundled privacy and support pages only) |
| User-generated content shared with others | No |
| Messaging and chat | No |
| Advertising | No |
| Violence (cartoon, realistic, graphic), horror or fear themes | None |
| Profanity or crude humor | None |
| Mature or suggestive themes, sexual content or nudity | None |
| Alcohol, tobacco or drug use or references | None |
| Simulated gambling, contests, loot boxes | None / No |
| Medical or treatment information | None (it gives general exercise guidance and safety stop signs, not medical treatment information). If you prefer to be conservative, choose "Infrequent". |
| Health or wellness topics | **Yes** |
| Guns or other weapons | None |

**Regulated medical device** (App Information, EU/UK declaration): **No**. Only the Account Holder or an Admin can set this.

---

## 7. App Privacy ("nutrition label")

App Store Connect → App Privacy → Get Started:

1. "Do you or your third-party partners collect data from this app?" → **No, we do not collect data from this app.**
2. Publish. The label then reads **Data Not Collected**.

This is accurate because the app has no account, no analytics, crash-reporting or ad SDKs, makes no network requests, and keeps Apple Health data on the device ("collect" in Apple's sense means transmitting data off the device). Re-check before every release; adding any SDK or server call changes the answer.

Privacy Policy URL: see section 1. Tracking: none (no App Tracking Transparency prompt is needed).

Optional: **Accessibility Nutrition Labels** (App Store Connect → App Accessibility). Only claim what you tested on a device: VoiceOver, Larger Text, Dark Interface, Sufficient Contrast, Reduced Motion. Interface text follows the iOS text-size setting (Dynamic Type) and pinch-zoom is enabled; claim Larger Text only after the "Look and accessibility" checks in `IOS_BUILD.md` pass at the large accessibility sizes.

---

## 8. App Review information

- **Sign-in required:** No (uncheck; there is no account).
- **Contact:** your name, phone and email.
- **Notes** (paste):

```
Hillpace is a coaching app for incline treadmill walking and jogging. No account is needed and all data stays on the device; the app makes no network requests.

Suggested walkthrough (about 6 minutes):
1. Onboarding (about 3 minutes): tap "Build my plan" and answer the questions about goal, body, treadmill limits, schedule and a short health check. Notification and Apple Health permissions are offered on their own step; both are optional and "Not now" works.
2. Plan reveal: the personal 12-week plan (Foundation, Build, Burn), the weekly schedule and, for a weight goal, a projection labeled as a projection, not a promise. Calorie figures are estimates.
3. Today tab: the week strip and today's plan session. Tap "Start", then "Start workout" on the pre-run sheet. After the 5-second get-ready, the run screen shows the target speed and incline. Voice cues and beeps play while the screen is on, and the app keeps the screen awake.
4. Skip to the end: tap "Skip" repeatedly to move through the intervals (or press and hold "End"). Sessions shorter than one minute ask whether to discard; choose "Save anyway".
5. Summary: because intervals were skipped, it shows the session as "Saved as partial" (expected). Rate "How hard did that feel?" (choose 9), then tap Done.
6. Adaptation: start today's session again (Today > "Start", then "Start workout"), skip to the end, choose "Save anyway" and rate 9 again. The second summary then shows "We eased your next sessions": work intervals are 1% less steep and jogs a little slower.
7. Progress tab: open the weight card, tap "Log weight" and add a few entries to see the smoothed weight trend.

Other features: Workouts tab (plan workouts, classics, custom workout builder, on-device Quick Draft), history with notes, badges, lessons, and "Match your treadmill" on the summary.

Optional system features: Apple Health (Me > Apple Health) writes indoor walking or running workouts with estimated active energy and distance, writes logged weights, and reads body weight. Notifications are local only: training reminders and, if the phone locks during a workout, interval-change notifications (a banner with the default sound, or vibration when the phone is on silent). The app works fully with both declined.

Calorie figures are estimates from the ACSM metabolic equations (net active energy); the method is in Me > How we calculate. Hillpace is not a medical device; it includes a readiness check, a doctor reminder and stop signs.
```

- **Attachment:** none needed. Optionally a 30-second screen recording of steps 3 to 6.

---

## 9. Screenshots

**Sizes to upload** (portrait PNG or JPEG, no transparency, 6 to 8 images each):
- 6.9-inch display: **1320 × 2868** (iPhone 17 Pro Max / 16 Pro Max simulator)
- 6.3-inch display: **1206 × 2622** (iPhone 17 Pro / 16 Pro simulator)

No iPad set (iPhone-only build).

**How to capture:** run the app in the Xcode simulator for each size with realistic data (for example a TestFlight backup restored with "Restore from a backup"), set a clean status bar, then save:

```bash
xcrun simctl status_bar booted override --time 9:41 --batteryState charged --batteryLevel 100 --cellularBars 4 --wifiBars 3
xcrun simctl io booted screenshot ~/Desktop/hillpace-01.png
```

Screens must show the real app. Captions may sit above the screenshot on a plain background in the app's colours (deep slate `#0F1E21` with off-white text, or mist `#EEF1EF` with ink `#0D1A1C`). Use 3 to 7 words, no claims, no Apple Health icon.

| # | Screen to capture | Caption |
|---|---|---|
| 1 | **Today**: greeting, plan meter (Foundation / Build / Burn, week marked), today's session card with its interval chart and Start button | **Your 12-week incline plan** |
| 2 | **Run screen** mid-climb: big speed and incline targets in the power-walk colour, "Climb ends in" countdown, timeline | **Big targets. Spoken cues.** |
| 3 | **Plan reveal** or the Plan tab: phases, weekly schedule, session lengths | **Built around your treadmill** |
| 4 | **Summary** after a workout: stats with "≈ … kcal" estimate label, "How hard did that feel?" effort picker | **Plans that adapt to effort** |
| 5 | **Workout builder** or the Workouts tab with Quick Draft | **Build any interval workout** |
| 6 | **Weight** screen: smoothed trend line, entries, projection band labeled as a projection | **See your real weight trend** |
| 7 | **Me** tab: Apple Health and Back up & restore rows (or the privacy summary) | **Saves to Apple Health. No account.** |
| 8 (optional) | **Progress**: weekly activity minutes, total climb, badges | **Every climb adds up** |

Do not show calorie numbers without the "≈" and "estimate" wording, and do not show a weight figure next to words like "lost" in captions.

**App preview video** (optional, later): 886 × 1920, 15–30 seconds, real screen recording of steps 3–5 above.

---

## 10. Final pre-submission checklist

- [ ] Trademark searches done; record created (section 0)
- [ ] Privacy and support URLs live and show your real name and a working email (no placeholders left anywhere: search the repo for `[Your name]`, `com.example` and `hillpace.app`, and set the in-app support address in `package.json` → `config.supportEmail`; production builds warn while it is still `support@hillpace.app`)
- [ ] Build uploaded from Xcode 26+, processed with no ITMS errors; TestFlight week done (`IOS_BUILD.md` sections 6 and 7)
- [ ] App Privacy published as Data Not Collected; age rating completed; medical device = No
- [ ] Screenshots uploaded for both sizes; captions free of outcome claims
- [ ] Review notes pasted; contact details filled; "Sign-in required" off
- [ ] Price Free; availability and EU trader status decided
- [ ] Submit for review with "Manually release this version" so you can choose the launch day
