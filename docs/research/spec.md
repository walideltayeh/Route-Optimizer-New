# Product Spec: App Store version of the "Incline" treadmill coach

**Date:** 1 Nov 2026. **Owner build target:** a Capacitor 8 iOS app plus a single-file web page, built from one codebase.

**Research track tags used below:**
- [TA] treadmill-apps
- [WL] walking-weightloss-apps
- [RC] running-coach-apps
- [AS] app-store-rules
- [CS] capacitor-stack
- [SA] store-assets
- [ES] exercise-science

**Labels:**
- "(our rule)" means a product decision with no source in the research.
- "(unverified)" means the claim could not be checked.

---

## 1. Positioning and name

### 1a. Positioning

This is an original iPhone coach for people who want to lose weight by walking and jogging on an incline treadmill. It builds a personal 12-week plan from the user's goal, schedule and the limits of their treadmill. It coaches each session with a big target screen and voice cues. It changes later weeks based on how hard sessions felt (RPE). It ties everything to an honest weight trend and projection.

The niche is open. Indie treadmill apps (Kuta, Klemy) offer presets, builders and voice cues, but none combines a progressive plan, a weight goal with a projection, and effort-based adaptation [TA]. Walking-for-weight-loss apps (WalkFit, Slimkit) have plans and projections but shallow treadmill coaching, and their reviews are dominated by billing complaints [WL].

We compete on three things:
- **Depth:** incline and speed targets, safe progression, and RPE adaptation.
- **Trust:** no account, data stays on the device, no subscription in v1, and calories clearly labelled as estimates.
- **Reliability:** cues and the timer keep working when the screen locks. This is the top 1-star complaint in the category [TA].

### 1b. Recommended names

"Incline" cannot be used. "Incline" by Flex innovations AB is a live app (id6737978177), and "INCLINE RUNNING" is a live USPTO registration (Reg. 5278311, class 41) [TA][SA].

| Rank | Name | Suggested store title (≤30 chars) | Conflict notes |
|---|---|---|---|
| **1 (chosen)** | **Hillpace** | `Hillpace: Incline Treadmill` (27) | No App Store match and no web or trademark hit. The only use found is a 2015 Ruby gem [SA]. "Incline" in the title is used descriptively; still confirm it does not clash with the INCLINE RUNNING mark (unverified). |
| 2 | **Slopewise** | `Slopewise: Treadmill Coach` | No App Store, web or trademark hits [SA] |
| 3 | **Treadpeak** | `Treadpeak: Incline Walking` | No App Store, web or trademark hits [SA] |

Names rejected:
- **Hillstride, Stride Climb:** STRIDE marks cover treadmills and class 41 [SA].
- **Peakpace, Steeply, Uphill, Upslope:** apps or brands already use them [SA].
- **Treadwise:** close to "Tread Wisely" [SA].

The USPTO was not queried directly, and names held by unpublished App Store Connect records are invisible to every search used [SA]. The owner must run USPTO (classes 9, 41, 44) and EUIPO searches, then create the App Store Connect record the same day to reserve the name.

### 1c. Where the research disagreed, and what we chose

| Topic | Conflict | Decision |
|---|---|---|
| Monetization | [WL]: paywall after the plan reveal with an annual plan and 7-day trial. [TA]: fair one-time pricing stands out against subscription complaints. [AS]: in-app purchase rules are complex. | **v1 is free, with no IAP, no ads and no account.** A one-time "Pro" unlock (no subscription) comes later (P2). This removes the paywall, StoreKit and EULA risk from the first review and answers the main category complaint. |
| AI workout drafting | The current app has AI drafting. Guideline 5.1.2(i) (Nov 2025) requires explicit consent for third-party AI, no API key may sit in the app, and a cloud call changes the privacy label [AS]. | **v1 ships "Quick Draft", a rule-based generator that runs on the device with no network.** Cloud or Foundation Models drafting moves to P2, behind a backend proxy and a consent sheet. The v1 binary must not contain the cloud feature, not even switched off (2.5.19). |
| Cues while locked | [RC]: the TTS plugin's `category:'playback'` speaks in the background. [CS]: the 8.0.2 iOS source ignores that option, and native speech stalls when locked. | **The screen-on path is primary:** keep-awake plus native TTS. **The locked-screen safety net is pre-scheduled time-sensitive local notifications with bundled voice-clip sounds.** No `UIBackgroundModes` audio in v1, because 2.5.4 limits background audio to real playback. |
| HealthKit plugin | [RC]: the capgo plugin cannot write workouts. [AS]: capawesome writes them but needs a paid licence. [CS]: Flomentum 0.8.3 is the only free plugin that writes, and it uses a deprecated API. | **We write a local Swift plugin, `HealthBridge`, using `HKWorkoutBuilder` (about 150 lines).** Flomentum 0.8.3 is the documented fallback. |
| Live Activity plugin | [RC]: `@capgo/capacitor-live-activities` 1.2.5. [CS]: `capacitor-live-activity` 8.2.0. | **`@capgo/capacitor-live-activities` 1.2.5,** because it has `startTimerSequence()` with pause, resume and skip. P1. |
| Weight projection | [WL]: deficit ÷ 7,700 kcal/kg. [ES]: the 7,700 rule overestimates badly (Thomas 2013). | **Show a band.** The lower edge uses the Hall 2011 model and the upper edge uses the static 7,700 rule. After 14 days of weigh-ins, switch to the user's smoothed trend. |
| RPE adaptation | [WL]: RPE ≥8 twice means hold; ≤4 means step up. [RC]: RPE ≥9 twice means repeat the week. | **Tiered:** ≥8 twice = hold progression; ≥9 twice = repeat the week and ease one step; ≤4 twice = offer a step up, which the user must confirm. |
| Pre-announce lead | [RC]: 10 s. [ES]: 5–10 s. | **10 s by default,** with 5/10/15 s as options. |
| Daily rings | The current app has animated rings. The Activity rings HIG forbids ring-like Move/Exercise/Stand displays [RC]. | **Replace with a "Weekly Summit" gauge:** a single open arc in our own colours, plus labelled bars. No concentric rings anywhere. |
| Safety screen | PAR-Q+ must be used in full and unchanged [ES]. | **Nine original questions.** We never call them PAR-Q+. |
| Capacitor version | 8.6.0 stable vs the 9.0 beta [CS] | **8.6.0, pinned.** |
| iOS minimum | Capacitor 8 needs 15.0 [CS]; the template may move to 16 [AS] | **Deployment target 17.0 (our rule).** Interactive Live Activity buttons need iOS 17, and a single floor halves the test matrix. |
| Storage | localStorage vs Preferences vs SQLite [CS] | **Preferences for settings and a Filesystem JSON file for records.** SQLite is too heavy for this data. |
| Screenshot sizes | Apple's fallback notes contradict each other [SA] | **Upload both 1206×2622 and 1320×2868.** iPhone-only, so no iPad set. |
| Caption copy | [SA] example caption "burn fat" vs 2.3.14, which bans unverifiable claims [AS] | **No fat-burn or weight-loss outcome claims** in any store asset. |
| Classic workout names | Trademark status of "12-3-30" is unknown [AS][SA] | In the app: "Steep Steady Walk (12% · 4.8 km/h · 30 min)". "12-3-30" stays out of all metadata and keywords. |

---

## 2. Feature list

### P0: must ship in v1 to look professional and pass review

**Plan and training**

1. **Onboarding quiz and plan builder.** About 12 screens (section 3) produce a personal 12-week plan, a goal date and a suggested daily intake. A short quiz followed by a plan reveal is the genre standard, and a long quiz is a known drop-off risk. [WL][RC]
2. **12-week progressive plan.** Three phases: Foundation (weeks 1–4), Build (5–8) and Burn (9–12).
   - Weeks 4, 8 and 12 are deload weeks with 25% less volume.
   - Weekly volume rises by at most 10–15%, and by at most 30% over 2 weeks.
   - Change one thing at a time, in this order: duration, then incline, then speed. Incline rises at most 1–2 points per week.
   - At least 1 rest day per week.
   - HIIT and 4×4 at most twice a week, 48 h apart.
   - No 10%+ incline sessions on consecutive days.
   - A plan tied to weight is the gap no indie treadmill app fills. [ES][TA]
3. **Busy-day switch.** One tap on Today swaps the session for its 30-minute version (4–5 min warm-up, 3–4 min cool-down), and it still counts toward the week. This is the owner's 45/30-minute need turned into a feature. [RC][ES]
4. **RPE adaptation.** After each workout the user rates effort 1–10. The picker has talk-test anchors:
   - 3–4: can talk in full sentences
   - 5–6: short phrases only
   - 7–8: a few words
   - 9–10: can't talk

   Next week's targets follow the tiered rule in section 3.7. A banner explains every change ("Holding steady this week: your last two sessions felt very hard"). [WL][RC][ES]
5. **Workout library.**
   - The 5 plan workouts: Hill Repeats, Walk-Jog Ladder, Steady Climb, Mixed Burn, Incline Pyramid.
   - Classics:
     - **Steep Steady Walk:** levels from 5%/20 min up to 12%/30 min. Beginners start at 4–6% [ES].
     - **4×4 Intervals:** 10 min warm-up, 4 × 4 min hard (RPE 7–8) with 3 min easy, 5 min cool-down. A starter version has 2–3 intervals.
     - **HIIT Sprints.**
   - 4×4 and HIIT are locked by the gating rules (section 3.6).
   - Every workout is clamped to the user's treadmill maximum speed and incline. A detail sheet shows the segment chart, duration, ≈net kcal, vertical metres and the peak speed and incline. [TA][ES]
6. **Custom builder.** Steps have a type (warm-up, walk, brisk, climb, jog, run, recover, cool-down), speed, incline and duration. Repeat blocks (×N) are supported, plus reorder, duplicate and delete, a live total time and a live ≈kcal estimate. Values above treadmill limits are rejected. A builder is table stakes [TA].
7. **Quick Draft (on the device).**
   - Inputs: duration (20/30/45/60), focus (climb, intervals, steady, mixed), intensity (easy, moderate, hard) and an optional maximum incline.
   - Output: an editable draft with warm-up, main set and cool-down built from the user's paces and treadmill limits.
   - No network and no consent needed.
   - This replaces cloud AI in v1 for compliance. Kuta's rule-based fallback shows the pattern works. [TA][AS]

**In-workout** (section 5 has the full requirements)

8. **Run screen in "workout mode".** A dark full-bleed screen in either theme. No tab bar.
   - Huge target speed and incline.
   - The segment name with "n of N".
   - A countdown to the next change and a strip chart of upcoming segments.
   - Elapsed and remaining time, ≈kcal, distance and vertical metres.
   - Pause and Stop are the largest controls. Also +30 s extend, skip, and a ±0.1 speed nudge within limits. [TA][RC]
9. **Native voice cues.** Spoken cues ("In 10 seconds: jog, 8.0 km/h, 2% incline"), then 3-2-1 beeps and "Go". Halfway and last-interval cues. Cues queue rather than cut each other off. They play over the user's music. [RC][CS]
10. **Wall-clock timer.** Time is computed as now − start − total paused time, never by counting ticks. On resume the app reconciles: it skips missed cues and says where you are. [CS]
11. **Locked-screen safety net.** Up to 56 time-sensitive local notifications are pre-scheduled, plus a "finished" notification. Each has a spoken-clip sound. They are rescheduled on pause, resume, skip and extend. The timer pausing when the phone locks is the top 1-star complaint [TA][CS].
12. **Keep-awake** during workouts only. [CS]
13. **Haptics.**
    - Medium impact at each segment change.
    - Success notification at the finish.
    - Selection feedback on pickers.
    - Light impact on 3-2-1.
    - A setting turns them off. [RC][AS]
14. **Workout summary.**
    - Time, distance, vertical metres and ≈net kcal.
    - A per-interval table and plan position ("Week 4 · 2 of 3 done").
    - Weekly goal progress.
    - RPE, notes and the Apple Health save status.
    - Sessions under 60 s ask "Discard?"; sessions ended early save as partial with a completion %. Missing notes are a review complaint against competitors [TA][RC].

**Tracking**

15. **History.** A reverse-chronological list. A detail view lets the user edit RPE and notes, and delete with confirmation. [TA]
16. **Progress dashboard.**
    - A weekly snapshot against the same point last week.
    - A chart with a metric switch (activity minutes, time, distance, elevation, sessions) and 1W/1M/3M/6M ranges. [RC]
17. **Weight tracking.** Manual entry in kg or lb. The chart shows the EWMA trend line, raw entries as faint dots, the goal line and the projection band (section 3.5). A "Hide weight everywhere" switch is available. [ES][WL]
18. **Weekly Summit gauge.** Activity minutes against the weekly target (vigorous minutes count double) and sessions x/y. It replaces the animated rings to comply with the HIG [RC][ES].

**Apple integration**

19. **Apple Health (opt-in).**
    - Writes indoor walking or running workouts with net active energy, distance and elevation metadata.
    - Writes each weigh-in as body mass.
    - Reads body mass to fill in the trend.
    - The app works fully if access is denied, and the description must mention the integration (2.5.1). [AS][CS][TA]
20. **Training reminders.** Local notifications on the user's chosen days and time. Editable in Profile. They help show 4.2 "app-like" value [WL][AS].

**Trust, safety and compliance**

21. **Readiness check, doctor reminder and gating.** See section 3.6. Before the first workout a stop-signs sheet appears ("Stop and seek care if: chest pain or pressure, unusual breathlessness, dizziness, palpitations, nausea, sharp calf, Achilles or shin pain"). It can be reopened from the run screen's "i" button. [ES][AS]
22. **"How we calculate" page.**
    - Formulas cited: ACSM metabolic equations, Mifflin-St Jeor, Tanaka, the Hall 2011 model vs the 7,700 rule, and the handrail effect.
    - States an accuracy of roughly ±15–20% (our estimate).
    - Reachable from the plan reveal, the summary and Profile.
    - Guideline 1.4.1 requires this disclosure. [AS][ES]
23. **Honest calorie display.** Always "≈ 285 kcal (estimate)", net of resting cost, rounded to 5. A "hands-free" toggle applies the handrail correction. [ES]
24. **Privacy by design.**
    - No account.
    - All data on the device.
    - A bundled privacy policy page plus a link to the hosted copy.
    - Profile → Data → Export (JSON, CSV) and Erase all data.
    - App Privacy label: Data Not Collected. [AS][WL]
25. **Durable storage and migration.**
    - Preferences holds settings; an atomic Filesystem JSON file holds records.
    - The schema is versioned.
    - Any localStorage data is migrated on first launch.
    - **Import backup** accepts a JSON file exported from the current web app (via `<input type="file">`), so the owner's history comes across. [CS]

**Polish**

26. **iOS-native shell.**
    - A 5-tab bar and large titles.
    - Sheets for details and edge swipe-back.
    - Safe areas (`viewport-fit=cover`, `env(safe-area-inset-*)`).
    - Light and dark themes, Dynamic Type and VoiceOver labels.
    - `prefers-reduced-motion`, `tabular-nums` timer digits and the system font stack.
    - No browser chrome and no external links for core features. [RC][AS]
27. **Original brand.**
    - The name Hillpace.
    - A contour-line or slope motif with our own palette (deep slate, summit amber, trail teal).
    - No red/green/blue concentric circles, and nothing copied from Kuta, Klemy, Peloton or Apple Fitness. [AS][SA]
28. **Settings.**
    - Units (km/h or mph, kg or lb, cm or ft-in).
    - Paces: easy walk, brisk walk, power walk, jog and run.
    - Treadmill: maximum speed and incline, whether it has incline, hands-free default.
    - Voice: voice picker, rate, cue frequency, lead time, beeps on/off.
    - Haptics on/off. [RC]
29. **Confetti only for personal records and phase or plan milestones,** so it keeps its impact. Not on every finish. [RC]

### P1: strong additions for v1 (ship if ready, otherwise v1.1)

1. **Live Activity and Dynamic Island.** Shows the segment, targets, a system countdown and the next segment. Pause and resume buttons work on iOS 17 and later. Tapping opens the run screen. Needs a Widget Extension and an App Group in Xcode. [RC][TA]
2. **Coach styles** (Calm, Energetic, Minimal) as our own TTS scripts. A coach with personality keeps people coming back [RC].
3. **Plan calendar actions.**
   - Drag a workout within ±1 week, one per day, with a warning on clashes and undo.
   - A missed-workout prompt offers reschedule, skip or do shorter. [RC]
4. **"Not feeling 100%".** Pick a reason (ill, sore, busy), a length of 3–14 days and a mode (easier, shorter, rest). The plan resumes in place, with a "never push through pain" message. [RC]
5. **Swap today's workout** for another of the same phase and intensity. [WL]
6. **Quick workouts** count toward minutes and streaks but not toward plan progression. [RC]
7. **Weekly streak** ("3 of 3 sessions this week") with one free rest token per week. No daily-streak shame. [WL][RC]
8. **Badges and best efforts.**
   - First workout, first jog interval, phase complete.
   - Totals of km and vertical metres.
   - First kg lost, 5% of body weight lost.
   - Longest session, most vertical metres, highest incline, longest jog, fastest equivalent 1 km.
   - A trophy case, with badges shown on the summary. [RC][WL]
9. **Share cards** in 9:16, square and transparent-sticker formats. Rendered with canvas, saved with Filesystem, sent with Share. Hidden stats are left off. [RC]
10. **Lessons.** 2-minute cards, one unlocked per completed session and matched to the phase.
    - Topics: why incline burns more, RPE, the talk test, NEAT, protein, plateaus and water weight, sleep, form and handrails, warm-up and cool-down.
    - Each cites CDC or ACSM. [WL]
11. **More reminders.** A 48-hour gentle nudge, a weekly weigh-in prompt and a Sunday "week ahead" card and notification. [WL][RC]
12. **Manual workout entry** for sessions done without the app. [WL]
13. **Trend recalibration.** "Your trend matches a deficit of about X kcal/day", with an offer to adjust suggested intake. [ES]
14. **Trend arrows** comparing the last 28 days with the last 90. [RC]
15. **Monthly challenges** that need no backend, such as "Climb 1,000 m in November" and "Everest month: 8,849 m". [WL][RC]
16. **Copy summary for Strava** (plain text). [TA]
17. **Interval Walk 3/3** preset (3 min brisk, 3 min easy, × 5). It backs the "japanese" keyword, which has search demand [SA]; the protocol details were not researched (unverified).
18. **Accessibility Nutrition Labels** completed in App Store Connect. They are optional now and will become mandatory later [AS].
19. **App preview video,** 15–30 s. [SA]

### P2: later

1. **Bluetooth FTMS treadmill control** (automatic speed and incline) and heart-rate-zone auto-adjust. The strongest differentiator, but large scope [TA].
2. **Apple Watch.** WorkoutKit schedules plan intervals onto the Watch; live heart rate, Tanaka and Karvonen zones, and an ease-off prompt above 95% of HRmax. No Capacitor plugin exists for this [RC][ES].
3. **Home, Lock Screen and StandBy widgets** (week gauge, next workout, streak). They reuse the P1 extension. [WL][TA]
4. **iPhone `HKWorkoutSession`** (iOS 26) for background runtime and crash recovery. Its background behaviour on iPhone is unverified [CS].
5. **Natural-language AI drafting** (cloud via our own proxy, or Apple Foundation Models). Requires an explicit consent sheet naming the provider and data, withdrawable consent, and an updated privacy label. [TA][AS]
6. **One-time "Pro" unlock** via StoreKit: no subscription, Restore Purchases, the billed price shown most prominently, EULA and privacy links. [TA][WL][AS]
7. **Siri and Shortcuts,** FIT/TCX export, Strava upload, shoe mileage and treadmill service reminders. [TA]
8. iPad, localisation, audio "story walks". [WL]

---

## 3. Onboarding flow

A progress bar sits at the top. Every screen has Back. Answers can be edited later in Profile, and changes regenerate the plan from the current week. No paywall.

### 3.1 Screens

| # | Screen | Exact question and options | Logic |
|---|---|---|---|
| 1 | Welcome | "Incline interval plans built for your treadmill." Buttons: **Build my plan**, and a secondary "Restore from a backup file" | Restore leads to the import flow |
| 2 | Goal | "What's your main goal?" Options: Lose weight · Get fitter · Build a walking habit · Train for a hike | Any goal other than weight skips screens 5–6 and hides intake targets (can be turned on later) |
| 3 | You | "Sex (used for the calorie formula)": Male · Female · Prefer not to say. "Age": wheel picker | Age under 18: the weight-loss goal and intake targets are unavailable, with fitness goals only (our rule; Mifflin-St Jeor is an adult equation). Age ≥45 feeds HIIT gating. |
| 4 | Body | "Height" and "Current weight", with unit toggles (cm or ft-in, kg or lb) | Live BMI is computed but **never labelled** "overweight" or "obese" [WL] |
| 5 | Goal weight | "Goal weight". A live "Healthy range for your height: A–B kg" (BMI 18.5–24.9) | Goals below BMI 18.5 are blocked with neutral text: "Let's pick a goal inside the healthy range." [WL][ES] |
| 6 | Pace | "How fast?" Options: Gentle 0.25 kg/wk · Steady 0.5 kg/wk (default) · Ambitious 0.75 kg/wk, each with its projected date. Toggle "I have a date in mind" with a date picker | Pace is capped at min(1 kg, 1% of body weight) per week. If the event date needs a faster pace: "At a safe pace you'd reach ≈X kg by then, and your goal by [date]." [WL][ES] |
| 7 | Fitness | "Day to day, are you…": Mostly sitting · On my feet some of the day · On my feet most of the day. "Can you jog for 1 minute at 8 km/h (5 mph)?": Yes · Not yet · Not sure. "Do you regularly do hard exercise that leaves you breathing heavily?": Yes · No | Sets the activity factor, seeds paces and feeds gating |
| 8 | Treadmill | "Does your treadmill have incline?" Yes · No. "Max incline" (0–15%, default 12). "Max speed" (default 16 km/h). "Do you usually walk without holding the rails?" Yes · No | All workouts are clamped to these limits. No incline: plan uses speed-only variants. Rails answer sets the hands-free default. [WL][ES] |
| 9 | Schedule | "Days per week" (3–6). "Which days?" (chips). "Usual session" 30 · 45 · 60 min (default 45). "Busy-day session" 20 · 30 min (default 30). "Remind me at" (time) | Builds the week layout and reminder schedule [WL][RC] |
| 10 | Readiness | Section 3.6: nine yes/no questions, an optional eating-disorder question, and a required checkbox: "I understand Hillpace is not a medical device. I'll check with a doctor before starting and before making medical decisions." | Gating per section 3.6 [ES][AS] |
| 11 | Plan reveal | Phase strip (Foundation, Build, Burn, deloads marked); sessions × minutes this week; activity-minute target; "≈ A–B kcal per 45-min session (estimate)"; goal date; projection band chart; an honesty card (below); suggested intake range; "How we calculate" link; **Looks good** / Edit answers | No promises. Copy says "projection". [WL][ES][AS] |
| 12 | Permissions | Two cards, each with its own button and a clear **Not now**. Apple Health: "Save workouts and weigh-ins to Apple Health, and read your weight." Notifications: "Remind me on training days, and give interval cues if my phone locks." | The system prompt appears only when the user taps. The app works with both denied (5.1.2(i)). If notifications are denied, the pre-run sheet warns that cues need the screen on. [AS] |
| then | Today | "Your first session: Foundation · Week 1 · Day 1 (45 min)". **Start now** / Later | Straight into value |

**Honesty card** (screen 11), filled from the formulas below:

> "Your workouts alone burn about X kcal a week, roughly Y kg/week at best. Reaching your pace also needs a moderate food deficit. Suggested intake: about A–B kcal/day. These are estimates; your real weight trend will guide us after two weeks."

For the owner's case, 5 × 45 min at about 10 net kcal/min is about 2,250 kcal/week. That is under 0.3 kg/week even by the optimistic rule, so 7–8 kg in 12 weeks will not come from exercise alone [ES].

### 3.2 Units and basic quantities

- **BMI** = kg ÷ m². The healthy-range weights are 18.5·h² and 24.9·h².
- **Treadmill speed S** (m/min) = km/h × 16.667. **Grade G** = % ÷ 100. Negative grades count as 0 [ES].
- **Distance** (m) = Σ segment speed (m/min) × minutes. **Vertical gain** (m) = Σ segment distance × G (treadmill convention).

### 3.3 Energy

**Resting metabolic rate (Mifflin-St Jeor)** [ES]:
- RMR = 10·kg + 6.25·cm − 5·age + s
- s = +5 (male), −161 (female), or −78 (prefer not to say, the average of the two) [WL]

**Activity factor (AF), not counting planned workouts** (avoids double counting) [ES]:
- Mostly sitting = 1.2
- On my feet some of the day = 1.3
- On my feet most of the day = 1.4

**Workout cost (ACSM)** [ES]:
- Walk segments: VO2 = 0.1·S + 1.8·S·G′ + 3.5
- Jog and run segments: VO2 = 0.2·S + 0.9·S·G′ + 3.5
- Between 6 and 8 km/h, the segment type chooses the equation.
- **Handrails:** G′ = G, unless hands-free is off and G ≥ 0.08, in which case G′ = 0.75·G. The 25% is a heuristic.
- **Net kcal/min** = (VO2 − 3.5) × kg ÷ 1000 × 5. This is the value we display and write to Health.
- Displayed as "≈", rounded to 5.
- Check: 4.8 km/h at 12% for 75.4 kg gives 9.5 net kcal/min, about 285 kcal per 30 min.
- METs = VO2 ÷ 3.5.

**Daily figures:**
- Planned exercise per day: Ex = Σ(net kcal of this week's planned sessions) ÷ 7
- **TDEE** = RMR × AF + Ex

### 3.4 Calorie target and goal date

- **Pace cap:** p ≤ min(1.0, 0.01 × weight) kg/week [ES]
- **Daily deficit:** D = p × 7700 ÷ 7, which is 275, 550 or 825 kcal for the three paces. We use the 7,700 rule only to *set* the deficit, by convention.
- **Suggested intake** = TDEE − D, shown as a ±10% range (Mifflin is within about 10% for most people [ES]), rounded to 50 kcal.
- **Floor:** intake never goes below max(RMR, 1,200 kcal) (our rule). If the floor applies, D shrinks and the goal date moves out.
- **Goal date** = today + (current weight − goal weight) ÷ p weeks.
- **Event check:** required pace = (current − goal) ÷ weeks until the event. If that is above the cap, show the realistic weight on the event date.
- **Hidden** when the goal is not weight, the user is under 18, they are pregnant, or they answered yes to the eating-disorder question.

### 3.5 Projection

**Before 14 days of weigh-ins**, show a band [ES]:
- Upper edge (optimistic): W_up(t) = W0 − D·t ÷ 7700
- Lower edge (Hall 2011): W_lo(t) = W0 − (D ÷ 24)·(1 − 2^(−t/365)), with t in days. The model says each 24 kcal/day of sustained change leads to about 1 kg of eventual change, half of it reached in about a year.
- Both edges are clipped at the goal weight.
- Example: with D = 550, after 12 weeks the band is about 3.4–6.0 kg of loss.
- A dashed line shows exercise alone (D = Ex).
- Label: "Projection if you follow the plan and suggested intake. Not a promise."

**After 14 days and at least 4 weigh-ins:**
- **Trend:** T_i = T_{i−1} + α′(w_i − T_{i−1}), with α′ = 1 − 0.9^Δdays (α ≈ 0.1 per day) [ES].
- **Slope:** least-squares slope of T over the last 14–28 days.
- **Projection:** T_now + slope·t, with a band of slope ± max(2·SE, 0.05 kg/wk).
- If observed loss stays above 1% of body weight per week for 3 weeks, show a gentle "faster than recommended" note [ES].

### 3.6 Readiness check and gating

These are original questions written for this app. They are not PAR-Q+, which may only be used in full and unchanged [ES].

| # | Question | If "yes" |
|---|---|---|
| 1 | Has a doctor ever told you that you have a heart condition or high blood pressure? | Doctor flag |
| 2 | Do you feel pain or pressure in your chest at rest, in daily life, or when you exercise? | Doctor flag |
| 3 | In the past 12 months, have you fainted, or lost your balance because of dizziness? | Doctor flag |
| 4 | Do you have another long-term condition (for example diabetes, or lung or kidney disease)? | Doctor flag |
| 5 | Do you take prescription medicine for a long-term condition? Follow-up: "Does it include a beta-blocker or another medicine that changes your heart rate?" | Doctor flag. A beta-blocker turns off all heart-rate targets (relevant once HR features exist) [ES]. |
| 6 | Do you have a bone, joint, tendon or muscle problem that more activity could make worse? Follow-up: "Achilles or calf?" | Doctor flag. An Achilles or calf answer adds a warning before 10%+ incline sessions [ES]. |
| 7 | Has a doctor said you should only exercise under medical supervision? | Doctor flag |
| 8 | Are you pregnant? | Doctor flag. HIIT and 4×4 hidden; weight-loss goal and intake hidden (our rule). |
| 9 | Are you ill right now, or recovering from an illness or injury? | Doctor flag. Suggests starting after recovery. |
| opt | "Have you ever been diagnosed with or treated for an eating disorder?" (Yes · No · Prefer not to say) | Yes: calorie targets, deficit numbers and projection are hidden, and fitness goals are suggested [WL] |

**What follows from the answers:**
- **Any doctor flag:** a "Check with a doctor before starting" card, with a link to eparmedx.com. The plan is limited to light and moderate workouts until the user taps "I've checked with my doctor" [ES].
- **HIIT and 4×4 stay locked** if any of these applies [ES]:
  - age ≥ 45 and answered "No" to regular hard exercise
  - any doctor flag that has not been acknowledged
  - the plan is in weeks 1–4
- **When they unlock,** the 4×4 starter (2–3 intervals) comes first.

### 3.7 Plan structure and length

- **Length:** a fixed 12-week block, which keeps the existing content and phases.
  - If the goal date is more than 12 weeks away, "Block 2" is generated at the end: Burn-level work continues under the same progression caps.
  - If the goal is reached early, the app offers maintenance (D = 0).
- **Weekly volume** is measured in activity minutes (moderate minutes + 2 × vigorous minutes) [ES]. A minute counts as vigorous if its segment is jog, run or HIIT, or if METs ≥ 6 (the METs cut-off is standard convention, unverified).

  | Phase | Weeks | Activity-minute target |
  |---|---|---|
  | Foundation | 1–4 | 150–180 |
  | Build | 5–8 | 200–225 |
  | Burn | 9–12 | 250–300 |

  If the user's schedule cannot reach the target, the plan uses what they have and says so. It never adds days on its own.
- **Week layout by days per week** (our rule; hard sessions and 10%+ incline sessions are never on consecutive days, and there is always at least 1 rest day):

  | Days per week | Sessions |
  |---|---|
  | 3 | 2 interval + 1 steady climb |
  | 4 | 2 interval + 1 steady climb + 1 easy walk |
  | 5 | 3 interval (at most 2 hard) + 1 steady climb + 1 easy |
  | 6 | as 5, plus 1 recovery walk |

- **Progression:**
  - Weekly change ≤ 10–15%, and ≤ 30% over 2 weeks.
  - The varied element rotates: duration of work intervals, then incline (+1 to 2 points), then speed (+0.2 to 0.3 km/h on jog segments).
  - Weeks 4, 8 and 12 drop volume by 25% [ES].
- **Starting paces** (our defaults, editable):

  | Pace | km/h |
  |---|---|
  | Easy walk | 4.5 |
  | Brisk walk | 5.5 |
  | Power walk | 6.0 |
  | Jog | 8.0 |
  | Run | 9.5 |

  If the jog check was "Not yet" or "Not sure", Foundation replaces jog segments with power walk at +2% incline. Jogging is introduced in Build after 2 brisk sessions at RPE ≤ 5.
- **RPE rules,** applied over the last two plan sessions:

  | Last two RPEs | Result |
  |---|---|
  | both ≥ 9 | Repeat the week and ease one step (−1% incline or −0.3 km/h on work segments) |
  | both ≥ 8 | Hold progression |
  | both ≤ 4 | Offer "Step it up?"; the user must confirm |

---

## 4. Information architecture

**Tab bar (5 tabs):** Today · Plan · Workouts · Progress · Me. The bar is subtle and translucent, not a heavy copy of iOS "Liquid Glass" [RC].

| Tab | Screens and content |
|---|---|
| **Today** | Week strip (Mon–Sun, planned, done, rest). Today's session card with **Start**, a **Busy day (30 min)** toggle and Swap (P1). Weekly Summit gauge. Weekly streak (P1). Quick "Log weight" button. Lesson card (P1). An RPE-adaptation banner when the plan changed. |
| **Plan** | Phase timeline (Foundation, Build, Burn, current week, deloads). Month calendar. Week detail list with each session's ≈kcal and minutes. Session detail sheet with **Start**. Plan settings (days, session length, regenerate). Reschedule and "Not feeling 100%" (P1). |
| **Workouts** | Sections: This week's plan · Plan workouts (5) · Classics (3) · My workouts · **Quick Draft** · **+ New workout**. Workout detail sheet (segment chart, stats, Start, Edit or Duplicate). Builder as a full-screen sheet. |
| **Progress** | Weekly snapshot. Metric chart (1W/1M/3M/6M). Weight card leading to the weight screen (trend, band, goal, entries list, add, edit, delete). History list leading to session detail (edit RPE and notes, delete, manual entry in P1). Records and badges (P1). |
| **Me** | Profile and goal (re-run any onboarding answer). Treadmill. Paces and units. Voice and cues (voice, rate, coach style in P1, cue frequency, lead time, beeps). Haptics. Reminders. Apple Health (status, connect, what we write). Data (Export JSON, Export CSV, Import backup, Erase all data). About (How we calculate, Health and safety, Privacy policy, Terms (Apple standard EULA), Contact support (mailto), version). |

**Modals and flows (no tab bar):** onboarding · pre-run sheet · run screen · summary sheet · weight entry sheet · import preview · stop-signs sheet.

**Navigation rules:**
- Push for drill-down, with edge swipe-back.
- Sheets for detail and edit, with a drag handle and swipe to dismiss.
- A hash router (`#/today`, `#/workout/:id`) so the web build gets deep links.
- Run state is kept so the app can re-enter the run screen if it is killed mid-workout: on launch, offer "Resume your 6:14 workout?".

---

## 5. In-workout experience requirements

**Pre-run sheet**
- Shows treadmill-safety tips: clip on the safety key, start the belt while standing on the side rails, and don't hold the rails if you are hands-free.
- Shows a "Keep your phone on the console with the screen on for spoken cues" tip.
- Shows a notifications status line. If notifications are denied: "If your phone locks you won't get cues."
- Health save status.
- **Start** leads to a 5-second get-ready countdown with beeps.

**Display** [TA][RC]
- Target speed and incline at 96–120 pt, in tabular numerals.
- The segment type is shown by both colour and a text label, never colour alone.
- Countdown to the next change.
- A scrolling strip chart of the next segments.
- A secondary row with elapsed, remaining, ≈kcal, distance and vertical metres.
- Pause and Stop are at least 72 pt (our rule). Stop is hold-to-end (1 s) to prevent accidental taps.
- +30 s, Skip, and speed nudge ±0.1. The nudge stays within the treadmill maximum, and the app never raises intensity above the plan by itself [ES].

**Voice cue timeline** [RC][CS]
- T−10 s (5/10/15 configurable): "In 10 seconds: jog, 8.0 kilometres per hour, 2 percent."
- T−3, T−2, T−1: beep plus light haptic.
- T0: "Go, jog" plus medium haptic.
- When only incline changes: "Incline to 8 percent."
- Cue frequency setting:
  1. Changes only
  2. Changes plus halfway, "1 minute left" and "Last interval" (default)
  3. Option 2 plus time splits every 5 or 10 min
- Finish: "Workout complete" plus success haptic.
- TTS uses `queueStrategy: Add` and a user-chosen voice (from `getSupportedVoices`) and rate.

**Audio mixing**
- The TTS plugin uses the system-managed speech session (`usesApplicationAudioSession = false`), so music should duck automatically.
- Beeps use native-audio with `focus:true` (ambient category with duckOthers).
- Unverified on device: ducking, behaviour with the Silent switch (ambient is muted by it), and how notification sounds mix with music. Haptics fire regardless, as a backup.

**Timing and the locked screen** [CS]
- **Wall-clock state** is `{startTs, pausedTotalMs, pauseStartedTs, segments[]}`, saved to Preferences on every state change. The current segment is derived; the timer never counts ticks.
- **On `appStateChange` active and `resume`:** recompute, skip stale cues, clear delivered notifications, and speak "You're in jog 3 of 6, 1:12 left."
- **Notification safety net:**
  - On start, resume, skip and extend: cancel everything, then schedule the next N segment changes plus "finished".
  - N = min(56, 64 − pending reminders − 1). iOS silently drops anything over 64 pending.
  - Uses `schedule.at` with absolute dates.
  - Title: "Next: Jog (3 of 6)". Body: "8.0 km/h · 2%".
  - `sound` is a bundled clip: `walk.caf`, `brisk.caf`, `climb.caf`, `jog.caf`, `recover.caf`, `cooldown.caf`, `halfway.caf`, `done.caf`. Each is under 30 s, Linear PCM or IMA4, placed in `www/sounds/`.
  - `interruptionLevel: 'timeSensitive'` and `presentationOptions: []`, so nothing doubles up while the app is in the foreground.
  - Cancel everything on pause, stop and finish.
- **Keep-awake** on at start, off at finish, pause over 5 min, or discard.
- **No silent-audio keep-alive** (2.5.4) and no AlarmKit.

**Live Activity (P1)** [RC]
- Starts with the workout; a setting "Show on Lock Screen" defaults on.
- Shows the segment, targets, a system timer counting to the next change, and the next segment.
- Pause and Resume buttons on iOS 17 and later.
- Tapping opens the run screen.
- Ends on finish or discard. The user can turn it off.

**Pause, interruptions and ending**
- Pause speaks "Paused" and shows "Slow the belt before stepping off" [ES]. Resume runs a 3-second countdown.
- Phone calls: the system pauses TTS; reconciliation takes over on return.
- Sessions under 60 s ask "Discard?" and are never written to Health [RC].
- Early stop saves a partial session. It earns plan credit at ≥70% completion (our rule).

**Apple Health write on Save** [AS][CS][ES]
- Only if the user enabled Health.
- One `HKWorkout` built with `HKWorkoutBuilder`.
  - `activityType`: `.running` if jog and run time is ≥50% of the session, otherwise `.walking`.
  - `locationType: .indoor`, plus metadata `HKMetadataKeyIndoorWorkout = true`, `HKMetadataKeyElevationAscended` and `HKMetadataKeyAverageMETs`.
  - Per-segment `activeEnergyBurned` samples (net kcal only) and `distanceWalkingRunning` samples are added to the builder.
- Failed writes go into a retry queue. Each session stores its Health UUID to prevent duplicates.
- **Never write gross calories** (5.1.3(ii)).

**Accessibility**
- VoiceOver reads "Target: 8.0 kilometres per hour, 2 percent incline, 0:42 to next change."
- Reduce Motion turns off the strip-chart animation and confetti.

---

## 6. Technical stack

### 6.1 Versions

Pin exact versions with `npm i -E`. Read from the npm registry on 1 Nov 2026 [CS].

| Package | Version | Purpose |
|---|---|---|
| `@capacitor/core` | 8.6.0 | Runtime |
| `@capacitor/ios` | 8.6.0 | iOS platform |
| `@capacitor/cli` (dev) | 8.6.0 | CLI (Node 22+) |
| `@capacitor/app` | 8.1.2 | `appStateChange`, `pause` and `resume` |
| `@capacitor/haptics` | 8.0.2 | Haptics |
| `@capacitor/local-notifications` | 8.3.1 | Reminders and locked-screen cues (`interruptionLevel`, `presentationOptions`) |
| `@capacitor/preferences` | 8.0.1 | Settings and run state (UserDefaults) |
| `@capacitor/filesystem` | 8.1.5 | `Library/hillpace/data.json`, exports, share images |
| `@capacitor/share` | 8.0.3 | Exports and share cards |
| `@capacitor/status-bar` | 8.0.4 | Light status bar on the run screen |
| `@capacitor/splash-screen` | 8.0.2 | Launch screen |
| `@capacitor-community/keep-awake` | 8.0.1 | Screen awake during workouts |
| `@capacitor-community/text-to-speech` | 8.0.2 | Native voice cues |
| `@capgo/capacitor-native-audio` | 8.4.38 | Beeps with ducking |
| `@capacitor/assets` (dev) | 4.0.0 | Icon and splash generation |
| `@capgo/capacitor-live-activities` (P1) | 1.2.5 | Live Activity (needs core ≥8, iOS 16.1+, Widget Extension and App Group) |
| Fallback only: `@flomentumsolutions/capacitor-health-extended` | 0.8.3 | Only if the local Health plugin slips |

**Rejected:**
- `@capacitor-community/sqlite`: too heavy.
- `@perfood/capacitor-healthkit`: stale; needs Capacitor 4.
- `@capgo/capacitor-health`, mley `capacitor-health`, `@capacitor/health-fitness`: none can write a workout.
- Silent-audio keep-alive plugins: 2.5.4 risk.
- `@capgo/capacitor-alarm`: clock-time alarms only, so it does not fit interval cues.
- Capacitor 9 beta.

### 6.2 Native code we write

- **`ios/App/App/HealthBridgePlugin.swift`** (about 150 lines, our estimate). Methods:
  - `isAvailable()`
  - `requestAuthorization({share:[workout, activeEnergyBurned, distanceWalkingRunning, bodyMass], read:[bodyMass]})`
  - `saveWorkout({start, end, activityType, segments:[{start,end,kcal,distanceM}], elevationM, avgMETs})`, using `HKWorkoutBuilder` (iOS 12+), which replaces the initializer deprecated in iOS 17
  - `saveBodyMass({date, kg})`
  - `readBodyMass({sinceISO})`, excluding our own samples
- **`ios/App/App/MainViewController.swift`**: subclass `CAPBridgeViewController` and override `capacitorDidLoad()` to call `bridge?.registerPluginInstance(HealthBridgePlugin())`. Set it as the custom class in `Main.storyboard`. This is the standard way to register a local plugin; the owner must confirm the files are in the App target in Xcode.
- **P1:** a Widget Extension target for the Live Activity UI, plus App Group `group.<bundleid>`.
- None of this can be compiled in our container. The owner builds and verifies it on the Mac.

### 6.3 `capacitor.config.json`

```json
{
  "appId": "<owner reverse-DNS>.hillpace",
  "appName": "Hillpace",
  "webDir": "www",
  "ios": { "contentInset": "never", "backgroundColor": "#0F1720" },
  "plugins": { "SplashScreen": { "launchAutoHide": true, "launchShowDuration": 500 } }
}
```

There is no `server.url`. All assets are bundled, the app runs fully offline, and nothing is updated over the air (2.5.2) [AS].

### 6.4 Info.plist keys

| Key | Value |
|---|---|
| `CFBundleDisplayName` | Hillpace |
| `NSHealthShareUsageDescription` | "Hillpace reads your body weight from Apple Health to keep your weight trend up to date. Your data stays on your iPhone." |
| `NSHealthUpdateUsageDescription` | "Hillpace saves your treadmill workouts (time, estimated distance and estimated active energy) and the weights you log to Apple Health." |
| `NSPhotoLibraryAddUsageDescription` | "Lets you save workout share cards to Photos." (The share sheet's "Save Image" crashes without it [CS].) |
| `ITSAppUsesNonExemptEncryption` | NO |
| `UISupportedInterfaceOrientations` | Portrait only |
| `NSSupportsLiveActivities` (P1) | YES |
| `UIBackgroundModes` | **Leave out** in v1 [CS] |

Both Health strings are required, or the app crashes when it asks for permission [AS].

### 6.5 Capabilities and project settings

**Capabilities:**
- **HealthKit** (`com.apple.developer.healthkit`). No Clinical Records, no Background Delivery.
- **Time Sensitive Notifications.**
- **App Groups** (P1).
- No Push Notifications.

**Project settings:**
- Deployment target **iOS 17.0**.
- `TARGETED_DEVICE_FAMILY = 1` (iPhone only).
- Swift Package Manager, the Capacitor 8 default.
- Build with Xcode 26+ and the iOS 26 SDK [AS][SA].

### 6.6 `PrivacyInfo.xcprivacy`

- `NSPrivacyTracking = false`, with empty tracking domains.
- `NSPrivacyCollectedDataTypes` empty.
- Accessed APIs:
  - UserDefaults with reason **CA92.1** (Preferences) [AS][CS].
  - File timestamp with reason **C617.1** (files inside the app container). This reason code is unverified in the research; confirm it against Apple's list.
- Run Capacitor's privacy-manifest guidance over all plugins before archiving.

### 6.7 Storage

**Settings, profile flags and live run state** go in Preferences, under `hp.settings`, `hp.profile` and `hp.run`.

**Records** go in a Filesystem JSON file, `Directory.Library` → `hillpace/data.json`:

```json
{ "schemaVersion": 2, "plan": {}, "sessions": [], "weights": [], "customWorkouts": [], "records": {}, "healthQueue": [] }
```

**Saving:**
- Atomic writes: write `data.json.tmp`, then `rename` it over `data.json`. Keep `data.prev.json` as the last good copy.
- Saves are debounced (1 s) and flushed on `pause`.

**Migration:** on first launch, read any old localStorage keys, convert them, and set `hp.migrated=1`. Keep the localStorage data until the next launch confirms the file reads correctly. iOS can reclaim WebView storage when space is low [CS].

**Health data:**
- Weights read from Health are re-read from HealthKit on launch rather than copied into our file. This is a conservative reading of 5.1.3; whether iCloud device backups count is unverified.
- No CloudKit or iCloud Drive sync of any kind [AS].

### 6.8 One codebase, also a single-file web page

**Source layout:**
- `src/index.html`, `src/styles.css`, and ES modules under `src/js/`:
  - `engine/` (plan, calories, timer, cues)
  - `ui/`
  - `platform.js` (the only file that touches native APIs)

**Build:**
- `node scripts/build.mjs` (Node 22, no bundler dependency) inlines CSS and JS into **`dist/hillpace.html`**, a fully self-contained single file.
- It then copies that file to `www/index.html` and adds `www/sounds/*.caf` and `www/audio/beep.wav` for the native build.
- `npx cap sync ios` follows.

**How native APIs are reached:**
- `platform.js` detects `window.Capacitor?.isNativePlatform?.()` at runtime and calls plugins through `window.Capacitor.Plugins.<Name>`. No npm imports are needed in the web file; the npm packages exist only so `cap sync` links the native code.
- Unverified: that every listed plugin is exposed on `Capacitor.Plugins` in Capacitor 8. Smoke-test each on device. Plugins that are not exposed get a tiny shim.

**Fallbacks:**

| Capability | iOS app | Web page fallback |
|---|---|---|
| Voice | TextToSpeech plugin | `speechSynthesis`; captions on screen if unavailable |
| Screen awake | KeepAwake | `navigator.wakeLock`, re-acquired on `visibilitychange`; "Keep this tab visible" banner if unsupported |
| Beeps | NativeAudio | Web Audio oscillator |
| Haptics | Haptics | `navigator.vibrate` where supported; otherwise nothing |
| Locked-screen cues | LocalNotifications | None. Pre-run banner: "Keep this page open and the screen on." |
| Reminders | LocalNotifications | Hidden ("Available in the iPhone app") |
| Storage | Preferences + Filesystem | localStorage (`hp.v2`), wrapped in try/catch; monthly "Back up your data" prompt; in-memory with a warning if storage throws |
| Export and share | Filesystem + Share | `navigator.share({files})`, otherwise a file download |
| Import | `<input type="file">` | Same |
| Apple Health, Live Activity | Native | Hidden |
| Lifecycle | App plugin | `visibilitychange` and `pageshow` |
| Status bar | StatusBar | `<meta name="theme-color">` |

**Rule:** the web page never shows a control that cannot work. Native-only features are left out of the UI, not shown disabled. Native builds always show every feature: there are no remote flags (2.5.19).

**Testing in our container:**
- Run the engine modules (plan, calories, projection, timer reconciliation, notification scheduling) under Node's test runner.
- Run the UI in a headless browser against `dist/hillpace.html`.
- Whether `npx cap add ios` works on Linux is unverified. If it fails, the owner runs it on the Mac.

---

## 7. App Store compliance checklist and required assets

### 7.1 Checklist (each item is actionable)

**Build and binary**
- [ ] Archive with Xcode 26+ and the iOS 26 SDK, on Capacitor 8.6.0 [AS]
- [ ] Bundle all web assets. No `server.url`, no over-the-air code. Test in airplane mode end to end (2.5.2, 4.2) [AS]
- [ ] Add `PrivacyInfo.xcprivacy` (6.6) to the App target. Fix any ITMS privacy warnings on upload [AS][CS]
- [ ] Info.plist purpose strings exactly as in 6.4. No `UIBackgroundModes` audio [CS]
- [ ] HealthKit and Time Sensitive capabilities enabled on the App ID and in Xcode [CS]
- [ ] iPhone only, portrait, deployment target 17.0 [SA]
- [ ] No feature flags, dormant code or cloud-AI code in the binary (2.5.19) [AS]
- [ ] Test on a real iPhone: locked-screen cue matrix (screen on or locked × music on or off × Silent on or off × Focus on or off). No crashes, no timer drift (2.1) [AS][CS]

**In-app content**
- [ ] Readiness check, doctor reminder, "Not a medical device" checkbox, stop-signs sheet (1.4.1) [AS][ES]
- [ ] "How we calculate" page citing ACSM, Mifflin-St Jeor, Tanaka and Hall, reachable in 2 taps from any calorie or projection number (1.4.1) [AS]
- [ ] Every calorie shown as "≈ … (estimate)". Projection labelled "not a promise". No "lose X kg" text anywhere (1.4.1, 2.3.14) [AS]
- [ ] No Move/Exercise/Stand data and no ring-like gauges (Activity rings HIG) [RC]
- [ ] Privacy policy bundled in the app and linked to the hosted URL from Me → About (5.1.1) [AS][SA]
- [ ] Health and notification permissions asked only in context, each with "Not now"; app fully usable when denied (5.1.1, 5.1.2(i)) [AS]
- [ ] Manual weight entry works with Health denied [AS]
- [ ] HealthKit: only net active energy, indoor flag, sessions over 60 s, nothing used for ads, nothing in iCloud (5.1.3) [AS][ES]
- [ ] Export data and Erase all data work [AS]
- [ ] No embedded web browser. External links open in Safari, which keeps the age rating off 16+ [AS]
- [ ] No placeholder text, every URL resolves, a support contact works (2.1) [AS]
- [ ] Native feel: tab bar, safe areas, haptics, reminders, Health, Dynamic Type, VoiceOver labels on every control (4.2) [AS]
- [ ] Screens and copy show it is more than a timer: plan, adaptation, progress (4.3(b): "simple timers" are a saturated category) [AS]

**App Store Connect**
- [ ] Create the app record immediately after trademark checks, to reserve the name [SA]
- [ ] Primary category Health & Fitness; secondary Sports (optional) [SA]
- [ ] Answer the new age-rating questionnaire: Health or Wellness Topics = Yes, Unrestricted Web Access = No. Expect 9+ (unverified) [AS]
- [ ] Regulated medical device declaration: **No**. Only the Account Holder or an Admin can set this [AS]
- [ ] App Privacy: **Data Not Collected**. This is true only because there are no analytics, crash SDKs or network calls; re-check before every release [AS]
- [ ] Export compliance: no non-exempt encryption [CS]
- [ ] Price: Free. No IAP in v1 [our decision]
- [ ] EU distribution: complete DSA trader status, or leave the EU out of availability [AS]
- [ ] Description mentions Apple Health integration and that calories are estimates (2.5.1, 1.4.1) [AS][CS]
- [ ] Keywords contain no brand or competitor names and no "12-3-30"; "norwegian" only after a trademark check (2.3.7) [SA][AS]
- [ ] Screenshots show the real app in use, with no outcome claims (2.3, 2.3.14) [AS]
- [ ] Optional: Accessibility Nutrition Labels [AS]
- [ ] Review notes (below) [AS]

**Review notes draft**

> "No account is needed; all data stays on the device. Onboarding takes about 2 minutes. To test a workout: Workouts → Classics → Steep Steady Walk → Start. Voice cues play while the screen is on; the app keeps the screen awake during workouts. If the phone is locked, interval changes arrive as time-sensitive notifications with a spoken sound. Apple Health is optional (Me → Apple Health). It writes indoor walking or running workouts with estimated active energy and distance, and reads and writes body weight. Calorie figures are ACSM-equation estimates; the method is in Me → About → How we calculate. The app is not a medical device."

### 7.2 Required assets

| Asset | Spec | Notes |
|---|---|---|
| App icon | **1024×1024 PNG**, sRGB or Display P3, **opaque (no alpha)**, square with no drawn rounded corners | Dark and tinted variants are optional; the system generates them. If using an Icon Composer `.icon` file, check exports for alpha (ITMS-90717) [SA] |
| Icon and splash sources for `@capacitor/assets` 4.0.0 | `assets/icon-only.png` (1024), `assets/splash.png` and `assets/splash-dark.png` (2732×2732) | File names and sizes follow the tool's convention (verify) |
| iPhone screenshots, required set | **1206×2622** (or 1179×2556), portrait, PNG or JPEG, no alpha, 6–8 images (limit 1–10) | "iPhone with Dynamic Island (medium)" is now the required set [SA] |
| iPhone screenshots, 6.9" set | **1320×2868** (or 1290×2796, 1260×2736) | Upload as well, because Apple's fallback notes contradict each other [SA] |
| iPad screenshots | Not needed | iPhone-only build |
| App preview video (P1) | 886×1920, 15–30 s, H.264 .mp4/.mov/.m4v, ≤30 fps, ≤500 MB, up to 3 | [SA] |
| Name | ≤30 chars: `Hillpace: Incline Treadmill` | Unique store-wide [SA] |
| Subtitle | ≤30 chars: `Walk Intervals for Weight Loss` (30) | A goal, not an outcome claim |
| Keywords | ≤100 bytes: `hiit,hill,climb,jog,cardio,fat,burn,calorie,timer,plan,coach,japanese,4x4,norwegian,zone,pad,workout` (exactly 100) | Keep "japanese" only if the P1 3/3 Interval Walk ships. If "norwegian" fails the trademark check, replace it with `walk,steps` [SA] |
| Promotional text | ≤170 chars | Editable without review |
| Description | ≤4000 chars, plain text | Must mention Apple Health and estimates |
| Support URL | Required; must show real contact information | Owner hosts it |
| Privacy Policy URL | Required; also reachable in the app | Owner hosts it |
| Marketing URL | Optional | |
| Copyright | "2026 <owner legal name>" | |
| Notification sounds | 8 × `.caf`, under 30 s, Linear PCM or IMA4, in `www/sounds/` | Internal asset [CS] |

**Screenshot plan** (captions 3–7 words, no claims):
1. "Your 12-week incline plan" (Today and plan)
2. "Big targets. Spoken cues." (run screen)
3. "Build any interval workout" (builder)
4. "Plans that adapt to effort" (summary with RPE)
5. "See your real weight trend" (trend and band)
6. "Works with Apple Health. No account." (Health and privacy)

---

## 8. Risks, and what the owner must do

### 8.1 Risks

| Risk | Impact | Mitigation |
|---|---|---|
| Name taken by an unpublished App Store Connect record, or a trademark conflict | Rename late | Run USPTO and EUIPO checks, then reserve the record at once. Slopewise and Treadpeak are backups [SA] |
| **No Xcode in our container.** Swift plugin, extension, capabilities and signing are unbuilt until the owner builds them | Build errors found late | Keep native code minimal and isolated. We supply files plus step-by-step Xcode instructions. Flomentum 0.8.3 is the Health fallback [CS] |
| Locked-screen behaviour (notification sound with the Silent switch, mixing with music, TTS ducking, native-audio muted by Silent) | 1-star reviews or a 2.1 rejection | Device test matrix before submission. Haptics as a backup. Copy that sets expectations [CS] |
| Rejected as a "repackaged website" (4.2) or a "simple timer" (4.3(b)) | Rejection | Health, notifications, haptics, keep-awake, offline use, native shell. Screenshots lead with plan and progress [AS] |
| Overlap with Kuta (presets, builder, voice) | Weak positioning | Lead with weight-goal plan, adaptation, honest projection, and locked-screen reliability [TA] |
| Calorie estimates off by ±15–20%; 7,700 rule overstates loss | Accuracy complaints, 1.4.1 | Net kcal, "≈", methodology page, projection band, trend-based recalibration [ES] |
| Owner expects 7–8 kg in 12 weeks from exercise alone | Disappointment | The plan reveal states the gap and suggests an intake [ES] |
| PAR-Q+ copyright | Legal | Original questions only, never named PAR-Q+ [ES] |
| Trademarks for "12-3-30" or "Norwegian 4x4" | 2.3.7 or 5.2 | Descriptive names in the app; check before using in metadata [AS][SA] |
| `Capacitor.Plugins` global access untested on Capacitor 8 | Native features dead in the build | Smoke-test screen in a debug build; shims if needed |
| Young or single-maintainer plugins (capgo live-activities 1.2.5, Flomentum 0.x) | Breakage on updates | Exact version pins. Health handled by our own code |
| Licence for voice clips (macOS `say` output may not be licensed for redistribution, unverified) | Legal | Owner records the 8 clips on an iPhone, or uses a TTS whose licence allows redistribution |
| iOS 17 floor excludes iOS 15 and 16 users | Smaller audience | Accepted; the share of those users is unverified and likely small |
| Upcoming: iPhone Duo screenshots required from April 2027 for iOS 27.1 SDK builds | Blocks future updates | Plan the asset work for v1.2 [SA] |
| DSA trader status publishes contact details if the owner is a trader | Privacy of an individual owner | Decide trader status deliberately, or leave the EU out of v1 availability [AS] |

### 8.2 What the owner must do

1. **Join the Apple Developer Program** as an Individual or an Organization. The standard fee is US$99/year and Organization enrolment needs a D-U-N-S number; both come from general knowledge, not the research. The seller name shown on the App Store comes from this enrolment.
2. **Get a Mac** with macOS Tahoe 26.2+ and Xcode 26.4+ (the macOS requirement is from a secondary source), Node 22+, and a **real iPhone on iOS 17 or later** for testing. The simulator does not reproduce background suspension [AS][CS].
3. **Check trademarks** (USPTO classes 9, 41, 44 and EUIPO) for "Hillpace". Then, the same day, register the bundle ID and create the App Store Connect record.
4. **Host two pages on stable HTTPS URLs** (for example GitHub Pages): a privacy policy covering on-device storage, HealthKit use, no third parties and no AI, and a support page with a contact email. We will draft the text.
5. **In Xcode:**
   - Open `ios/App` and set Team and signing.
   - Add the HealthKit and Time Sensitive capabilities.
   - Check that `HealthBridgePlugin.swift` and `MainViewController.swift` are in the App target, and set the storyboard class.
   - Add `PrivacyInfo.xcprivacy`.
   - Set deployment target 17.0, iPhone only, portrait.
   - Add the icon.
   - For P1: add the Widget Extension and App Group.
6. **Record or license the 8 voice clips** and convert them to `.caf`.
7. **Device testing:** run the locked-screen matrix, test Health writes (check them in the Health app), and use TestFlight for at least a week of real sessions.
8. **Fill in App Store Connect:**
   - Category, age rating questionnaire.
   - Medical device = No (Account Holder or Admin).
   - App Privacy = Data Not Collected, export compliance.
   - Price Free, availability, DSA status.
   - Screenshots (both sizes), metadata, review notes.
9. **Submit and reply to App Review** from App Store Connect. Keep Xcode current, renew the membership each year, and re-check the privacy label whenever a network feature is added (cloud AI or IAP in P2).