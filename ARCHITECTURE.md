# Hillpace — architecture and build contract

Hillpace is an original iPhone app (Capacitor 8 wrapper around vanilla ES modules) that coaches incline-treadmill interval
workouts for weight loss: a personal 12-week plan, a big-number workout player with voice cues, history, weight trend and badges.
The same source also builds a single-file web page. Product research and decisions: `docs/research/spec.md` (+ `docs/research/critique.md`, which overrides the spec where they conflict).

**Read these files before writing code:** `src/core/*.js`, `src/ui/*.js`, `src/styles/*.css`, `src/main.js`. Do not change their public
APIs. If you need a small helper that belongs in core/ui, add it to your own screen file instead (or add a new export without changing existing ones).

## Build & run
- `node scripts/build.mjs --dev` → `dist/hillpace.html` (open with Playwright via `file://`) and `www/index.html`.
- **While several people work in parallel, build privately:** `node scripts/build.mjs --dev --out /tmp/hp-<yourname>` → `/tmp/hp-<yourname>/hillpace.html`.
  If the build fails because of a file you don't own, wait ~60 s and retry (another agent is mid-edit). Never edit files you don't own.
- Screenshots: `node scripts/shoot.mjs <hash> <outPrefix> --page /tmp/hp-<yourname>/hillpace.html [--fresh] [--js "<code run after load>"] [--full]`
  seeds `tests/fixture.json` (Sam, week 3 of the plan, 11 sessions, 10 weigh-ins; `--fresh` = brand-new user) and writes `<outPrefix>-light.png` / `-dark.png`
  and prints page errors. Look at the PNGs with the Read tool. Example to open an overlay: `--js "document.querySelector('[data-act=start]').click()"`.
- Tests: `node tests/logic.mjs` (core plan and safety rules in plain Node: doctor-flag moderate cap, restarts, skip-to-end,
  mid-week day changes, lighter weeks, no-jog users) and `node scripts/build.mjs --dev && node tests/e2e.mjs` (Playwright journeys).
- `www/index.html` carries a Content-Security-Policy (script by hash, no inline event handlers): bind events with `addEventListener`.
- Plain JS (ES modules, no TypeScript, no frameworks, no npm packages beyond what is installed). Target Safari 15+.
- Playwright is preinstalled: `require('playwright')` from any dir, `chromium.launch()` with no options. Use viewport 393×852, deviceScaleFactor 2 for screenshots.

## Layout of the source
```
src/main.js               app shell (tabs, router, boot, lifecycle) – owner: lead
src/core/store.js         state + persistence: state.main, state.sessions, update(fn), addSession, updateSession, deleteSession, subscribe, uid
src/core/format.js        units/format/dates: toSpeed/speedUnit/toDist/distUnit/toWeight/fromWeight/weightUnit/fmt1/fmt2/clock/duration/ymd/parseYmd/addDays/startOfWeek/isoDay/daysBetween/dateShort/dateLong/relativeDay/greeting/esc ...
src/core/science.js       formulas: activeKcalPerMin, roundKcal, rmr, tdee, ACTIVITY_LEVELS, PACES, paceCap, intakePlan, weeksToGoal, bmi, healthyRange, projectionBand, bandGoalDays, ewmaTrend, trendSlope
src/core/program.js       MODES, PHASES, WORKOUTS, getWorkout, customs, segmentsFor, slotSegments, speedFor, planStats, timeline, lockReason, planSlots, slotStatus, currentWeek, nextSlot, weekSlots, planProgress, levelForWeek, phaseForWeek, startPlanThisWeek, evaluateAdaptation, applyAdaptation, quickDraft, WEEKLY_TARGET, sessionActivityMin, DELOAD_WEEKS, bodyKg
src/core/engine.js        createEngine(segs, {kg, nudge, handsFree}) – wall-clock interval engine (events: segment, countdown, warn, milestone, finish, tick, state, nudge, extend)
src/core/achievements.js  totals, weekStreak, records, newRecords, catalogue, collectNew, nextSummit, SUMMITS
src/core/platform.js      isNative/isArtifact/env/features, haptic, keepAwake, speak, stopSpeaking, voices, unlockAudio, beep, notificationPermission, requestNotifications, scheduleCues, cancelCues, scheduleReminders, cancelReminders, healthAvailable, requestHealth, healthSaveWorkout, healthSaveWeight, healthReadWeights, exportFile, pickTextFile, onAppState, statusBar, copyText
src/ui/kit.js             icon(name), modeIcon(type), topo(), toast(), sheet(), confirmSheet(), segmented()/bindSegmented(), switchHtml(), stepperHtml(), countUp(), confetti(), navBar(), row(), watchScroll(), debounce, $, $$, esc, RM
src/ui/charts.js          intervalChart(segs, opts), modeLegend(segs, MODES), weekHills(days), hillGlyph, planMeter(weeks, current), gauge(v, target, {sub}), animateGauges(root), lineChart({...}), barChart({...})
src/ui/actions.js         cross-screen actions registry (see below)
src/ui/router.js          hash router: define(name, def), go(name, param), back(fallback), currentRoute()
src/screens/*.js|*.css    screens (one owner per file set)
```

## Screen contract
A tab screen module default-exports `{ route, tab, title, render(root, param, ctx), routes? }`.
- `render(root, param, {refresh})` fills `root` (a `div.screen` already in the DOM) with HTML and wires events on `root`. It may return a cleanup function.
  `ctx.refresh === true` when re-rendering the same screen because data changed (skip entrance animations then).
- The shell re-renders the current screen whenever store data changes (debounced). So screens are **pure renders of state**: read `state`, render, wire events, write with `store.update(m => ...)` / `addSession` etc. Never keep important state only in the DOM.
- `routes` (optional): array of extra route defs `{route, tab, render}` for pushed screens (e.g. progress owns `history`, `weight`, `records`; me owns `me` subpages via param `#me-<page>` and `lesson`).
- Pushed screens start with `navBar(title)` from kit (it renders a sticky bar with a back button wired by main.js) and call `watchScroll(root.querySelector('.nav-bar'))`.
- Hash routes use only ASCII letters, digits, hyphens: `#today #plan #library #progress #me #history #weight #records #me-goal #lesson-incline`. Never use `#settings`, `#sidebar`, `#customize`, `#upgrade`, `#downloads`, `#comment-*`.
- Full-screen flows (onboarding, player, summary, builder) are overlays: create `div.overlay` appended to `document.body`, add `body.immersive` while open (hides tab bar), remove on close.
- Sheets: `sheet(html, {title, footer})` → `{el, body, close}`. Confirmations: `await confirmSheet({title, body, confirm, danger})`. Never use alert/confirm/prompt.
- Files: each owner writes `src/screens/<name>.js` (+ optional `src/screens/<name>.css`, auto-included by the build, tokens only).

## Actions registry (src/ui/actions.js)
Owners register at module load: `actions.startWorkout = (opts) => {...}`. Callers just call `actions.X(...)`.
| action | owner | purpose |
|---|---|---|
| refresh(), go(name, param), back(fallback) | main.js | navigation |
| startWorkout({workoutId, slotKey, level, length, segs, name}) | player.js | pre-run sheet → get-ready → player |
| resumeWorkout(snapshot) | player.js | resume a run saved in localStorage `hp.run` |
| openSummary(sessionId, {fresh}) | summary.js | post-workout summary (fresh=true right after a run) |
| openWorkout(workoutId, {slotKey, level, length}) | library.js | workout detail sheet with Start/Edit/Duplicate |
| openBuilder({id, draft}), openQuickDraft() | builder.js | custom workout builder overlay; Quick Draft sheet |
| logWeight(), openSession(id), logManualSession() | progress.js | weight entry sheet; session detail sheet; manual entry sheet |
| openOnboarding({edit, step}), closeOnboarding() | onboarding.js | onboarding overlay |
| openStopSigns(), openHowWeCalculate(), openLesson(id) | me.js | safety sheet; methodology page; lesson card |
| openSlot(slotKey) | plan.js | plan session sheet (start / move to today / skip / swap / busy-day) |
| importBackup(), exportBackup() | me.js | restore from / save a JSON backup (used by onboarding's "Restore from a backup") |

## Data model (see store.js for defaults)
- `state.main.profile`: name, goal ('lose'|'fitter'|'habit'|'hike'), sex ('male'|'female'|'unspecified'), age, heightCm, startWeight (kg), goalWeight (kg), pace ('gentle'|'steady'|'ambitious'), targetDate, activity ('sitting'|'some'|'most'), canJog ('yes'|'no'|'unsure'), hardExercise, noNumbers, hideWeight, units {speed:'kmh'|'mph', weight:'kg'|'lb', height:'cm'|'ftin'}, paces {walk, brisk, power, jog, run} (km/h), treadmill {hasIncline, maxIncline, maxSpeed, handsFree}, sessionLength (30|45|60), busyLength (30), cues {voice, beeps, lead (5|10|15 s), detail (1|2|3), rate, voiceId}, haptics, health {enabled, watch}, reminders {enabled, time 'HH:MM'}, appearance ('system'|'light'|'dark').
- `state.main.plan`: startDate (Monday 'YYYY-MM-DD'), days (ISO 1=Mon..7=Sun), weeks 12, block, moved {slotKey: date}, skipped {slotKey:true}, busy {slotKey:true}, swap {slotKey: workoutId}, adjust {incline, speed}, levelCap, adaptLog [{date, kind, reason}].
- `state.main.readiness`: answers {id: bool}, doctorFlag, doctorAck, achilles, betaBlocker, pregnant, acceptedAt.
- `state.main.weights`: [{d:'YYYY-MM-DD', kg}] (one per day, keep sorted). `measurements`, `customs` [{id, name, segs, intensity, updated}], `achievements` {id: ISO}, `lessonsRead` {id: ISO}, `onboarded`, `lastBackup`.
- `state.sessions` (newest first): {id, date (ISO start), endedAt, workoutId, name, planSlot|null, level, length, durationSec, plannedSec, completion 0..1, completed (bool), distanceKm, kcal (NET active, number), elevM, avgMETs, rpe (1–10|null), notes, splits [{idx,type,label,incline,speed,sec,km,kcal,vig}], nudgeKmh, source ('app'|'manual'), healthUUID, consoleEdited}.
- Store weights in kg, speeds in km/h, distance in km, elevation in m; convert only for display with format.js.
- Custom workout ids: `store.uid('c')` (letters/digits only).

## Design rules (Hillside direction — see `docs/design/hillside-*.png` and `docs/design/judging.json`)
- Use tokens only (`var(--ink)`, `--surface`, `--m-power` …). No hard-coded colors except inside tokens.css. Both light and dark must work.
- Mode colors are data: charts, `.mode-chip`, the player's target panel, a workout's Start button (`.btn-mode` + `mode-<type>` class of the workout's main work mode). All other primary actions use `.btn-primary` (ink). Selection/progress states use ink, never amber.
- Every mode shown with color also shows its name or icon (`modeIcon(type)`), never color alone.
- Display type: Archivo (expanded for titles `.title-xl/.title-l`, condensed for big numbers `.display-num`). Text: Hanken Grotesk. Numbers use `.num`.
- Left-aligned layouts, generous spacing, iOS inset-grouped lists (`.group` + `row()`) for settings-like screens. Dark `.hero-card` with `topo()` contour background for the one hero element per screen. No emoji. No concentric rings (Apple Activity rings look-alikes are banned).
- Touch targets ≥ 44 px. Every icon-only button has `aria-label`. Respect `RM` (reduced motion). Dynamic content uses `esc()`.
- Microcopy: plain, specific, active voice, sentence case. Buttons say exactly what happens ("Start workout", "Save weight").

## Compliance copy rules (App Store 1.4.1 / 2.3) — mandatory
- Calories are always shown as estimates: `≈ 285 kcal` with the word "estimate" nearby at least once per screen, rounded with `roundKcal`. They are NET active kcal.
- Never promise outcomes ("lose X kg", "burn fat"). Projections say "projection" and "not a promise".
- No accuracy percentages. Methodology lives on "How we calculate" (actions.openHowWeCalculate()).
- When `profile.noNumbers` is true: hide calories, deficits, intake, weight projections and weight figures everywhere (show minutes, distance, climb instead).
- When `profile.hideWeight` is true: hide weight figures (keep the weight screen reachable from Progress with a "Show weight" control).
- Safety: workouts never exceed treadmill limits (segmentsFor/personalise already clamp). Locked workouts show `lockReason(id)`.

## Platform rules
- Call native features only through platform.js. Hide controls whose `features.X` is false (don't show disabled native-only controls on the web).
- Notification and Health permission prompts appear only after an explicit tap on a button that says what will happen.
- Persist with store functions only.

## Lessons (P1, content owned by me.js)
Short cards (≈120–180 words each) unlocked one per completed session: why incline works, effort and the talk test, warm-up and cool-down, handrails and form, NEAT and daily steps, protein and appetite, plateaus and water weight, sleep and recovery, treadmill safety, building the habit. Each ends with a one-line source (CDC, ACSM, WHO, NHS). Ids: letters/digits/hyphens.

## Walking surfaces, walking-only and "Just walk" (v1.1)
Core APIs (src/core/program.js, src/core/engine.js) — use these, never `treadmill.hasIncline` directly for display decisions:
- `SURFACES` {incline, flat, outdoor} with `name`, `short`, `icon` (kit icon name), `blurb`; `SURFACE_IDS`.
- `usualSurface()` (profile.surface, or derived from treadmill.hasIncline), `activeSurface()` (a just-for-today choice in `main.todaySurface` {d, surface} if set today, else usual), `usesIncline(surface = activeSurface())`.
- `setTodaySurface(main, surface|null)` and `setUsualSurface(main, surface)` mutate main — call inside `store.update`. `setUsualSurface` keeps `treadmill.hasIncline` in step (incline → true, flat → false).
- `segmentsFor(id, {level, length, surface})` and `personalise(segs, {surface})` default to `activeSurface()`. On flat/outdoor every incline is 0 and climbs become extra pace (+0.1 km/h per point above 2%, max +1). Outdoors the numbers only feed estimates: the player coaches by effort.
- `EFFORT[type]` / `effortFor(type)` → {rpe: '6–7', feel: 'Hard walking', talk: 'Short phrases only', say: '<voice cue>'}.
- `profile.walkOnly` (bool): jogs/runs always become walking pushes; `jogOfferDue()` never fires; Quick Draft uses no jogs.
- `FREE_WALK_ID = 'free'`: `getWorkout('free')` → {free: true, name: 'Just walk', category: 'free'}; `segmentsFor('free', {surface})` → one 10-minute brisk interval. Run it with `createEngine(segs, {open: true})`: the last interval extends by 10 minutes whenever it runs out, so it never finishes on its own; `engine.end()` finishes it as completed; `engine.completion()` is 1.
- `engine.changeCurrent({type?, speed?, incline?, label?})` splits the current interval and applies the change from now on (for logging pace/speed/incline changes during an open walk).
- Session records gain `surface` ('incline' | 'flat' | 'outdoor'). Free walks: `workoutId: 'free'`, `name: 'Just walk'`, `planSlot: null`, `completed: true`.
