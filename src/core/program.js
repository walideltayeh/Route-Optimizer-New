// Workout library, interval maths, the 12-week calendar plan, effort-based adaptation and Quick Draft.
import { state, weighIns } from './store.js';
import { activeKcalPerMin, isVigorous, mets } from './science.js';
import { ymd, parseYmd, addDays, startOfWeek, startOfDay, isoDay, daysBetween, sameDay } from './format.js';

/* ---------------- modes ---------------- */

/** Interval modes, easiest to hardest. Colors come from CSS tokens --m-<id>. */
export const MODES = {
  walk: { name: 'Easy walk', short: 'Walk', say: 'easy walk', icon: 'flat' },
  brisk: { name: 'Brisk walk', short: 'Brisk', say: 'brisk walk', icon: 'stride' },
  power: { name: 'Power walk', short: 'Power', say: 'power walk', icon: 'climb' },
  jog: { name: 'Jog', short: 'Jog', say: 'jog', icon: 'jog' },
  run: { name: 'Run', short: 'Run', say: 'run', icon: 'run' },
};
export const MODE_IDS = Object.keys(MODES);

/* ---------------- where you walk ---------------- */

/** Walking surfaces. On 'flat' and 'outdoor' climbs become extra pace; outdoors the player coaches by effort, not numbers. */
export const SURFACES = {
  incline: { id: 'incline', name: 'Incline treadmill', short: 'Incline', icon: 'climb', blurb: 'Speed and incline targets for every interval.' },
  flat: { id: 'flat', name: 'Flat treadmill or walking pad', short: 'Flat', icon: 'flat', blurb: 'Speed targets only. Climbs become faster walking.' },
  outdoor: { id: 'outdoor', name: 'Outdoors', short: 'Outdoors', icon: 'route', blurb: 'Coached by effort and the talk test. Hills are a bonus.' },
};
export const SURFACE_IDS = Object.keys(SURFACES);

/** Where the user usually walks. */
export function usualSurface(p = state.main.profile) {
  return SURFACES[p.surface] ? p.surface : p.treadmill && p.treadmill.hasIncline === false ? 'flat' : 'incline';
}
/** Where they walk today: a just-for-today choice if they made one, else their usual surface. */
export function activeSurface(today = new Date()) {
  const t = state.main.todaySurface;
  return t && SURFACES[t.surface] && t.d === ymd(today) ? t.surface : usualSurface();
}
/** Set (or clear with null) today's surface. Mutates main; call inside store.update. */
export function setTodaySurface(main, surface, today = new Date()) {
  main.todaySurface = surface && SURFACES[surface] && surface !== usualSurface(main.profile) ? { d: ymd(today), surface } : null;
}
/** Set the usual surface and keep treadmill.hasIncline in step. Mutates main; call inside store.update. */
export function setUsualSurface(main, surface) {
  if (!SURFACES[surface]) return;
  main.profile.surface = surface;
  if (surface === 'incline') main.profile.treadmill.hasIncline = true;
  if (surface === 'flat') main.profile.treadmill.hasIncline = false;
  main.todaySurface = null;
}
/** Does today's surface use incline targets? */
export const usesIncline = (surface = activeSurface()) => surface === 'incline';

/** How each mode should feel: for outdoor coaching and for everyone's effort cues (talk test, RPE out of 10). */
export const EFFORT = {
  walk: { rpe: '2–3', feel: 'Easy', talk: 'You can talk in full sentences', say: 'Easy pace. You should be able to chat.' },
  brisk: { rpe: '4–5', feel: 'Brisk', talk: 'You can talk, but you couldn’t sing', say: 'Brisk pace. You can talk, but not sing.' },
  power: { rpe: '6–7', feel: 'Hard walking', talk: 'Short phrases only', say: 'Walk hard. Short phrases only. Pump your arms.' },
  jog: { rpe: '7–8', feel: 'Jog', talk: 'A few words at a time', say: 'Jog gently. A few words at a time.' },
  run: { rpe: '8–9', feel: 'Fast', talk: 'You can’t hold a conversation', say: 'Go fast. Too hard to talk.' },
};
export const effortFor = (type) => EFFORT[type] || EFFORT.brisk;

/** "Just walk": an open-ended walk. The player runs it in open mode (it never finishes on its own). */
export const FREE_WALK_ID = 'free';
export function freeWalkSegments({ surface = activeSurface(), type = 'brisk' } = {}) {
  const inc = surface === 'incline' ? Math.min(state.main.profile.treadmill.maxIncline ?? 15, 3) : 0;
  return [seg(type, 10, inc, 'Just walk', 'work')];
}

export const PHASES = [
  { id: 0, name: 'Foundation', weeks: [1, 4], blurb: 'Build the habit with moderate climbs and short efforts.' },
  { id: 1, name: 'Build', weeks: [5, 8], blurb: 'Steeper hills and longer jog intervals.' },
  { id: 2, name: 'Burn', weeks: [9, 12], blurb: 'Your highest inclines and longest efforts.' },
];

/** Weekly activity-minute targets (moderate + 2 × vigorous), per phase. */
export const WEEKLY_TARGET = [150, 200, 250];

/* ---------------- workout definitions ---------------- */

/** seg(mode, minutes, incline%, label, role, addKmh?) role: warm | work | rest | cool */
export const seg = (type, min, incline, label, role = 'work', add) => {
  const s = { type, dur: Math.round(min * 60), incline, label, role };
  if (add) s.add = add;
  return s;
};
const warm = (sh) => (sh ? [seg('walk', 2, 1, 'Warm-up', 'warm'), seg('brisk', 1, 2, 'Warm-up', 'warm')] : [seg('walk', 3, 1, 'Warm-up', 'warm'), seg('brisk', 2, 2, 'Warm-up', 'warm')]);
const cool = (sh) => (sh ? [seg('brisk', 1, 1, 'Cool-down', 'cool'), seg('walk', 1, 0, 'Cool-down', 'cool')] : [seg('brisk', 2, 1, 'Cool-down', 'cool'), seg('walk', 3, 0, 'Cool-down', 'cool')]);
const wrap = (sh, main) => [...warm(sh), ...main, ...cool(sh)];

/**
 * Built-in workouts. build(level 0-2, short) returns intervals totalling exactly 45 min (30 when short).
 * kind: 'interval-moderate' | 'interval-hard' | 'steady' | 'easy' | 'classic-hard'
 */
export const WORKOUTS = {
  hills: {
    category: 'plan', kind: 'interval-moderate', name: 'Hill Repeats', focus: 'Incline power walking', intensity: 2,
    desc: 'Three-minute power-walk climbs with two-minute flat recoveries. Hard work for your legs and lungs, easy on your joints.',
    build(L, sh) { const c = [6, 8, 10][L], n = sh ? 5 : 7, s = []; for (let i = 1; i <= n; i++) s.push(seg('power', 3, c, `Climb ${i} of ${n}`), seg('walk', 2, 2, 'Recover', 'rest')); return wrap(sh, s); },
  },
  walkjog: {
    category: 'plan', kind: 'interval-hard', name: 'Walk–Jog Ladder', focus: 'Jog intervals', intensity: 3,
    desc: 'Four-minute rounds of jogging then power walking. The jog grows from one to two minutes as the plan moves on.',
    build(L, sh) { const j = [1, 1.5, 2][L], n = sh ? 6 : 8, s = []; for (let i = 1; i <= n; i++) s.push(seg('jog', j, 1, `Jog ${i} of ${n}`), seg('power', 4 - j, 3, 'Power walk', 'rest')); s.push(seg('power', sh ? 1 : 3, 5, 'Finisher climb')); return wrap(sh, s); },
  },
  steady: {
    category: 'plan', kind: 'steady', name: 'Steady Climb', focus: 'Steady, conversational pace', intensity: 1,
    desc: 'Continuous power walking on a rolling incline. You should be able to talk in short sentences the whole way.',
    build(L, sh) { const b = [5, 6, 7][L], o = sh ? [0, 1, 2, 1, 2] : [0, 1, 2, 1, 0, 1, 2]; return wrap(sh, o.map((x, i) => seg('power', 5, b + x, `Block ${i + 1} of ${o.length}`))); },
  },
  mixed: {
    category: 'plan', kind: 'interval-hard', name: 'Mixed Climb', focus: 'Climbs and jogs', intensity: 3,
    desc: 'Seven-minute circuits of a steep climb, a short recovery, a jog and a moderate hill walk.',
    build(L, sh) { const c = [8, 10, 12][L], jg = [1, 1, 1.5][L], n = sh ? 3 : 5, s = []; for (let i = 1; i <= n; i++) s.push(seg('power', 2, c, `Circuit ${i} · Steep climb`), seg('walk', 1, 2, `Circuit ${i} · Recover`, 'rest'), seg('jog', jg, 1, `Circuit ${i} · Jog`), seg('brisk', 4 - jg, 4, `Circuit ${i} · Hill walk`, 'rest')); if (sh) s.push(seg('power', 4, c - 2, 'Final climb')); return wrap(sh, s); },
  },
  pyramid: {
    category: 'plan', kind: 'interval-moderate', name: 'Incline Pyramid', focus: 'Up the hill and back down', intensity: 2,
    desc: 'The incline steps up to a peak and back down, then a short push to finish.',
    build(L, sh) { const p = [8, 10, 12][L], d = sh ? 2 : 3, s = []; [0, 1, 2, 3, 4, 5, 4, 3, 2, 1, 0].forEach((k, i) => s.push(seg('power', d, Math.round(1 + ((p - 1) * k) / 5), k === 5 ? 'Peak' : i < 5 ? 'Climbing' : 'Descending'))); s.push(seg(L === 0 ? 'power' : 'jog', 2, 1, 'Final push')); if (sh) s.push(seg('walk', 1, 1, 'Recover', 'rest')); return wrap(sh, s); },
  },
  easy: {
    category: 'plan', kind: 'easy', name: 'Easy Walk', focus: 'Recovery day', intensity: 1,
    desc: 'An easy walk on a gentle incline. It adds minutes without adding strain. Use it on lighter weeks or when you feel sore.',
    build(L, sh) { const n = sh ? 5 : 7; return wrap(sh, Array.from({ length: n }, (_, i) => seg(i % 2 ? 'walk' : 'brisk', 5, [2, 3, 3][L] + (i % 2), i % 2 ? 'Easy walk' : 'Brisk walk', 'rest'))); },
  },
  steep: {
    category: 'classic', kind: 'interval-moderate', name: 'Steep Steady Walk', focus: 'One long climb', intensity: 2,
    desc: 'A steady walk at 4.8 km/h (3 mph) on a steep incline that builds to 12% in the Burn phase. It uses a fixed speed instead of your paces (without incline, your power-walk pace with a little extra speed). Keep your hands off the rails.',
    build(L, sh) { const inc = [6, 9, 12][L], n = sh ? 5 : 7, s = []; for (let i = 1; i <= n; i++) s.push({ ...seg('power', 5, Math.min(inc, 4 + i * 2), `Climb block ${i} of ${n}`), speed: 4.83 }); return wrap(sh, s); },
  },
  fourx4: {
    category: 'classic', kind: 'classic-hard', name: '4×4 Intervals', focus: 'Aerobic power', intensity: 3, gated: true,
    desc: 'Four-minute hard efforts (effort 7–8 out of 10) at a jog you can only just hold, each followed by three easy minutes. The starter version has fewer rounds.',
    build(L, sh) { const a = [0, 0.5, 1][L], inc = [1, 2, 3][L], n = sh ? 2 : [3, 4, 4][L], s = []; for (let i = 1; i <= n; i++) s.push(seg('jog', 4, inc, `Hard ${i} of ${n}`, 'work', a), seg('brisk', 3, 2, 'Easy', 'rest')); const used = n * 7; const left = (sh ? 25 : 35) - used; if (left > 0) s.push(seg('power', left, 4, 'Steady climb')); return wrap(sh, s); },
  },
  hiit: {
    category: 'classic', kind: 'classic-hard', name: 'Sprint Intervals', focus: 'Short fast bursts', intensity: 3, gated: true,
    desc: 'Thirty-second fast runs with ninety-second walking recoveries, then a long steady climb. Straddle the belt or hold the rail while the speed changes if that feels safer.',
    build(L, sh) { const a = [1, 1.5, 2][L], n = sh ? 8 : 10, s = []; for (let i = 1; i <= n; i++) s.push(seg('run', 0.5, 1, `Sprint ${i} of ${n}`, 'work', a - 1.5), seg('walk', 1.5, 2, 'Walk it off', 'rest')); s.push(seg('power', sh ? 9 : 15, 6, 'Steady climb')); return wrap(sh, s); },
  },
  threes: {
    category: 'classic', kind: 'interval-moderate', name: '3-Minute Intervals', focus: 'Fast and slow walking', intensity: 2,
    desc: 'Alternate three minutes of fast walking with three minutes of easy walking. A well-studied walking routine that suits any fitness level.',
    // 6 rounds = 36 min > 35, so the 45-minute version trims the last easy block to 2 minutes.
    build(L, sh) {
      const n = sh ? 4 : 6, inc = [1, 2, 3][L], s = [];
      for (let i = 1; i <= n; i++) s.push(seg('power', 3, inc, `Fast ${i} of ${n}`), seg('walk', i === n && !sh ? 2 : 3, inc, 'Easy', 'rest'));
      if (sh) s.push(seg('brisk', 1, inc, 'Steady'));
      return wrap(sh, s);
    },
  },
};

export const INTENSITY = ['', 'Easy', 'Moderate', 'Hard'];

/* ---------------- words that match where they walk ---------------- */
// WORKOUTS and PHASES are written for an incline treadmill with jogs. These reword them for a flat treadmill,
// outdoors and walking-only plans, so every screen (and the voice coach) describes the session that is really done.

/** Built-in interval labels without an incline: climbs become pushes ("Climb 2 of 7" → "Push 2 of 7"). */
const FLAT_LABELS = [
  [/Steep climb/g, 'Hard push'], [/Hill walk/g, 'Brisk walk'], [/Climb block/g, 'Block'], [/Finisher climb/g, 'Finisher'],
  [/\bclimb\b/g, 'push'], [/^Climbing$/, 'Building'], [/^Descending$/, 'Easing off'], [/\bClimb\b/g, 'Push'],
];
export const flatLabel = (label) => FLAT_LABELS.reduce((t, [re, to]) => t.replace(re, to), String(label ?? ''));

const hasJog = (segs) => (segs || []).some((x) => x.type === 'jog' || x.type === 'run');

/**
 * A workout's one-line focus as it will be done on this surface. w: a workout id or a getWorkout() result.
 * segs (optional): the intervals as they will be done (decides whether jogs are in); else the user's jog settings.
 */
export function workoutFocus(w, { surface = activeSurface(), segs = null } = {}) {
  const wk = typeof w === 'string' ? getWorkout(w) : w;
  if (!wk) return '';
  const inc = surface === 'incline';
  const jog = segs ? hasJog(segs) : !(state.main.profile.walkOnly || state.main.profile.canJog !== 'yes' || restrictedToModerate());
  switch (wk.id) {
    case 'hills': return inc ? wk.focus : 'Power-walk intervals';
    case 'walkjog': return jog ? wk.focus : 'Power-walk intervals';
    case 'mixed': return inc ? (jog ? wk.focus : 'Climbs and power-walk pushes') : jog ? 'Fast walking and jogs' : 'Pace changes and pushes';
    case 'pyramid': return inc ? wk.focus : 'Pace builds up and back down';
    case 'steep': return inc ? wk.focus : 'One long, steady effort';
    default: return wk.focus || '';
  }
}

/**
 * A built-in workout's description as it will be done on this surface (and with or without jogs), so a flat-treadmill
 * or outdoor walker isn't told about inclines and a walking-only plan isn't told about jogs. Same arguments as workoutFocus.
 */
export function workoutDesc(w, { surface = activeSurface(), segs = null } = {}) {
  const wk = typeof w === 'string' ? getWorkout(w) : w;
  if (!wk) return '';
  const inc = surface === 'incline', out = surface === 'outdoor';
  const jog = segs ? hasJog(segs) : !(state.main.profile.walkOnly || state.main.profile.canJog !== 'yes' || restrictedToModerate());
  switch (wk.id) {
    case 'hills': return inc ? wk.desc : 'Three-minute power-walk pushes with two-minute easy recoveries. Hard work for your legs and lungs, easy on your joints.';
    case 'walkjog': return jog ? wk.desc : `Four-minute rounds of a hard ${inc ? 'climb' : 'push'} then power walking. The hard part grows from one to two minutes as the plan moves on.`;
    case 'steady': return inc ? wk.desc : `Continuous power walking${out ? '; gentle hills on your route are welcome' : ' at a steady, slightly rising pace'}. You should be able to talk in short sentences the whole way.`;
    case 'mixed': return inc
      ? (jog ? wk.desc : 'Seven-minute circuits of a steep climb, a short recovery, a power-walk push and a moderate hill walk.')
      : `Seven-minute circuits of a hard push, a short recovery, ${jog ? 'a jog' : 'a second push'} and a brisk walk.`;
    case 'pyramid': return inc ? wk.desc : 'The pace steps up to a peak and back down, then a short push to finish.';
    case 'easy': return inc ? wk.desc : 'An easy walk at a comfortable pace. It adds minutes without adding strain. Use it on lighter weeks or when you feel sore.';
    case 'steep': return inc ? wk.desc : out
      ? 'One long, steady power walk. A route with a long hill suits it well: let your effort, not your speed, guide you.'
      : 'One long, steady walk at your power-walk pace plus a little extra speed, which grows through the plan’s phases.';
    case 'fourx4': return jog ? wk.desc : `Four-minute hard efforts (effort ${EFFORT.power.rpe} out of 10) at a ${inc ? 'steep' : 'fast'} power walk, each followed by three easy minutes. The starter version has fewer rounds.`;
    case 'hiit': {
      const end = inc ? 'climb' : 'power walk';
      const belt = out ? '' : ' Straddle the belt or hold the rail while the speed changes if that feels safer.';
      return jog ? `Thirty-second fast runs with ninety-second walking recoveries, then a long steady ${end}.${belt}`
        : `Thirty-second all-out power-walk bursts with ninety-second easy recoveries, then a long steady ${end}.`;
    }
    default: return wk.desc || '';
  }
}

/**
 * A built-in workout's name as it will be done: hill and jog names only when there are hills (incline treadmill, or
 * real hills outdoors) and jogs in the plan. e.g. a walking-pad user sees "Pace Pyramid", a walking-only user "Power Walk Ladder".
 */
export function workoutName(id, { surface = activeSurface() } = {}) {
  const base = WORKOUTS[id] && WORKOUTS[id].name;
  if (!base) return '';
  const p = state.main.profile, inc = surface === 'incline';
  const jog = !(p.walkOnly || p.canJog !== 'yes' || restrictedToModerate());
  switch (id) {
    case 'hills': return inc || surface === 'outdoor' ? base : 'Pace Repeats';
    case 'walkjog': return jog ? base : 'Power Walk Ladder';
    case 'steady': return inc ? base : 'Steady Power Walk';
    case 'mixed': return inc ? base : 'Mixed Pace';
    case 'pyramid': return inc ? base : 'Pace Pyramid';
    case 'steep': return inc ? base : 'Long Power Walk';
    case 'fourx4': return jog ? base : '4×4 Power Walk';
    case 'hiit': return jog ? base : 'Fast Walk Bursts';
    default: return base;
  }
}

/** A phase's blurb for where they usually walk and whether jogs are in the plan. phase: a PHASES entry or its id. */
export function phaseBlurbFor(phase, { surface = usualSurface(), walkOnly = !!state.main.profile.walkOnly } = {}) {
  const ph = typeof phase === 'number' ? PHASES[phase] : phase;
  if (!ph) return '';
  const inc = surface === 'incline', jogs = !walkOnly;
  if (ph.id === 0) return inc ? ph.blurb : 'Build the habit with steady walking and short efforts.';
  if (ph.id === 1) return inc ? (jogs ? ph.blurb : 'Steeper hills and longer power walks.') : jogs ? 'Faster walking and longer jog intervals.' : 'Faster, longer power-walking efforts.';
  return inc ? ph.blurb : 'Your fastest and longest efforts.';
}

/** Examples of vigorous minutes (they count double toward the weekly target) that fit where they usually walk and
 *  whether jogs are in their plan: "like jogs and steep climbs" … "when you can only say a few words". */
export function vigorousExamples({ surface = usualSurface() } = {}) {
  const p = state.main.profile;
  const jogs = !(p.walkOnly || p.canJog !== 'yes' || restrictedToModerate());
  if (surface === 'incline') return jogs ? 'like jogs and steep climbs' : 'like steep climbs';
  return jogs ? 'like jogs' : 'when you can only say a few words';
}

/* ---------------- custom workouts ---------------- */

export const customs = () => state.main.customs || [];

/** Resolve any workout id to { id, name, focus, desc, category, kind, intensity, custom, build(L, short) }. */
export function getWorkout(id) {
  if (id === FREE_WALK_ID) return { id, free: true, category: 'free', kind: 'easy', name: 'Just walk', focus: 'Open-ended walk', intensity: 1, desc: 'Walk for as long as you like. Change your pace as you go; Walking Companion keeps time, distance and an estimate of your effort.', build: () => freeWalkSegments() };
  if (WORKOUTS[id]) return { id, ...WORKOUTS[id], name: workoutName(id) };
  const c = customs().find((x) => x.id === id);
  if (!c) return null;
  const segs = c.segs.map((x) => ({ role: 'work', ...x }));
  const total = segs.reduce((a, x) => a + x.dur, 0);
  return {
    id, custom: true, category: 'custom', kind: 'custom', name: c.name, intensity: c.intensity || 2,
    focus: `Your workout · ${Math.round(total / 60)} min`,
    desc: c.desc || `${segs.length} intervals you built.`,
    build: () => segs.map((x) => ({ ...x })),
  };
}

/* ---------------- safety gating ---------------- */

/** Returns null when allowed, or a short reason why a workout is locked. */
export function lockReason(id, week = currentWeek()) {
  const w = WORKOUTS[id];
  if (!w || !w.gated) return null;
  const p = state.main.profile, r = state.main.readiness;
  if (r.pregnant) return 'Not suggested during pregnancy.';
  if (r.doctorFlag && !r.doctorAck) return 'Unlocks after you confirm you have checked with your doctor (Me → Health & safety).';
  if ((p.age || 0) >= 45 && !p.hardExercise) return 'Unlocks once you have built up to regular hard exercise. Ask your doctor before high-intensity work.';
  if (state.main.plan.startDate && week <= 4 && (state.main.plan.block || 1) === 1) return 'Unlocks after the Foundation phase (week 5).';
  return null;
}
/** Light/moderate only until a doctor flag is acknowledged. */
export const restrictedToModerate = () => state.main.readiness.doctorFlag && !state.main.readiness.doctorAck;

/** A session that counts as finished: completed, at least 70% done, or logged by hand. */
export const sessionDone = (s) => !!s && (s.completed || (s.completion || 0) >= 0.7 || s.source === 'manual');

/** METs ceiling for users limited to light and moderate work (vigorous starts at 6 METs; keep a small margin). */
export const MODERATE_METS = 5.8;

/* ---------------- resolving intervals for the user ---------------- */

export function bodyKg() {
  const w = weighIns(); // own weigh-ins plus this run's Apple Health ones, oldest first
  return (w.length ? w[w.length - 1].kg : state.main.profile.startWeight) || 75;
}

/** Target treadmill speed (km/h) for an interval, clamped to the treadmill's maximum. */
export function speedFor(x, nudge = 0) {
  const p = state.main.profile;
  const base = typeof x === 'string' ? p.paces[x] || 5 : x.speed != null ? x.speed : (p.paces[x.type] || 5) + (x.add || 0);
  return Math.max(0.8, Math.min(p.treadmill.maxSpeed || 20, base + (nudge || 0)));
}

/**
 * Apply the user's situation to a raw interval list:
 *  - can't jog yet (canJog 'no' / 'unsure') → jog/run becomes a steeper power-walk push, until the user says yes
 *    (Today offers short jogs in Build after two comfortable sessions: jogOfferDue)
 *  - moderate-only restriction → no run/jog intervals, and every interval stays below 6 METs at the user's pace
 *  - effort adaptation (plan.adjust) on work intervals
 *  - treadmill limits (incline cap; on a treadmill without incline a work interval's climb becomes extra speed:
 *    +0.1 km/h per incline point above 2%, at most +1 km/h, so levels and effort adjustments still change the work)
 */
export function personalise(segs, { applyAdjust = true, surface = activeSurface() } = {}) {
  const p = state.main.profile, t = p.treadmill, adj = state.main.plan.adjust || { incline: 0, speed: 0 };
  const moderate = restrictedToModerate();
  const noJog = p.walkOnly || p.canJog !== 'yes' || moderate;
  const incline = surface === 'incline';
  return segs.map((s0) => {
    const s = { ...s0 };
    if (noJog && (s.type === 'jog' || s.type === 'run')) { s.type = 'power'; s.incline = Math.max((s.incline || 0) + 4, 5); delete s.add; delete s.speed; s.label = String(s.label || '').replace(/Jog|Sprint/g, 'Push'); }
    if (applyAdjust && s.role === 'work' && s.speed == null) {
      s.incline = (s.incline || 0) + (adj.incline || 0);
      if (s.type === 'jog' || s.type === 'run') s.add = (s.add || 0) + (adj.speed || 0);
    }
    if (!incline) {
      // flat treadmill or outdoors: the climb becomes extra pace (outdoors this only feeds estimates; cues are by effort)
      if (s.role === 'work' && s.speed == null && (s.incline || 0) > 2) s.add = Math.round(((s.add || 0) + Math.min(1, ((s.incline || 0) - 2) * 0.1)) * 100) / 100;
      s.incline = 0;
    }
    s.incline = incline ? Math.max(0, Math.min(t.maxIncline ?? 15, Math.round((s.incline || 0) * 2) / 2)) : 0;
    if (moderate) keepModerate(s);
    return s;
  });
}

/** Light/moderate only: walking pace below running gait, and the incline lowered (0.5% steps) until the interval is under 6 METs. */
function keepModerate(s) {
  if (speedFor(s) >= 8) { s.speed = 7.5; delete s.add; }
  const v = speedFor(s);
  while (s.incline > 0 && mets(v, s.incline, s.type) >= MODERATE_METS) s.incline = Math.max(0, s.incline - 0.5);
}

/** Extend a 45-minute workout to 60 by adding a 15-minute climb block before the cool-down. */
function extendTo60(segs, level) {
  const i = segs.findIndex((s) => s.role === 'cool');
  const b = [4, 5, 6][level];
  const extra = [seg('power', 5, b, 'Extra climb 1 of 3'), seg('power', 5, b + 1, 'Extra climb 2 of 3'), seg('power', 5, b, 'Extra climb 3 of 3')];
  return [...segs.slice(0, i < 0 ? segs.length : i), ...extra, ...segs.slice(i < 0 ? segs.length : i)];
}

/** Session length (minutes) in a lighter week: about 25% shorter (60 → 45, 45 → 35, 30 → 23). */
export function deloadLength(len) {
  const n = +len || 45;
  return n >= 60 ? 45 : n >= 45 ? 35 : Math.max(15, Math.round(n * 0.75));
}

/** Shrink a main set to targetSec by scaling every interval (15 s steps, at least 30 s each). */
function fitMain(main, targetSec) {
  const total = main.reduce((a, s) => a + s.dur, 0);
  if (!main.length || total <= targetSec) return main;
  const f = targetSec / total;
  const out = main.map((s) => ({ ...s, dur: Math.max(30, Math.round((s.dur * f) / 15) * 15) }));
  let diff = targetSec - out.reduce((a, s) => a + s.dur, 0);
  const order = out.map((_, i) => i).sort((a, b) => out[b].dur - out[a].dur);
  for (let k = 0; diff !== 0 && k < 2000; k++) {
    const i = order[k % order.length], step = diff > 0 ? 15 : -15;
    if (out[i].dur + step >= 30) { out[i].dur += step; diff -= step; }
  }
  return out;
}

/** A built-in workout at any length. 30, 45 and 60 use the workout's own builders; other lengths (lighter weeks)
 *  wrap the closest main set in the full (≥ 34 min) or short warm-up and cool-down and fit it to the length. */
function builtinSegs(w, level, length) {
  const len = Math.round(+length || 45);
  if (len >= 60) return extendTo60(w.build(level, false), level);
  if (len === 45) return w.build(level, false);
  if (len === 30) return w.build(level, true);
  const mainOf = (segs) => segs.filter((s) => s.role !== 'warm' && s.role !== 'cool');
  const sh = len < 34;
  const wrapSec = [...warm(sh), ...cool(sh)].reduce((a, s) => a + s.dur, 0);
  const target = Math.max(5 * 60, len * 60 - wrapSec);
  const mains = [mainOf(w.build(level, true)), mainOf(w.build(level, false)), mainOf(extendTo60(w.build(level, false), level))];
  const main = mains.find((m) => m.reduce((a, s) => a + s.dur, 0) >= target) || mains[mains.length - 1];
  return wrap(sh, fitMain(main, target));
}

/**
 * Intervals for a workout as the user will do it.
 * length: minutes, usually 30 | 45 | 60; lighter weeks use deloadLength() (built-ins only; custom workouts keep their own length).
 */
export function segmentsFor(id, { level = 0, length = 45, applyAdjust = true, surface = activeSurface() } = {}) {
  if (id === FREE_WALK_ID) return freeWalkSegments({ surface });
  const w = getWorkout(id);
  if (!w) return [];
  let segs = w.custom ? w.build() : builtinSegs(w, level, length);
  // Fixed speeds (Steep Steady Walk) only make sense with incline; without it the workout uses the user's paces.
  // Built-in labels name climbs; without an incline they become pushes (custom workouts keep the user's own labels).
  if (!w.custom && surface !== 'incline') segs = segs.map((s) => { const x = { ...s, label: flatLabel(s.label) }; delete x.speed; return x; });
  return personalise(segs, { level, applyAdjust: applyAdjust && !w.custom, surface });
}

/** Estimated totals for a list of intervals (net kcal). */
export function planStats(segs, nudge = 0, kg = bodyKg()) {
  const hf = state.main.profile.treadmill.handsFree;
  let kcal = 0, km = 0, elev = 0, maxI = 0, sec = 0, maxS = 0, modMin = 0, vigMin = 0;
  for (const s of segs) {
    const v = speedFor(s, nudge);
    kcal += (activeKcalPerMin(v, s.incline, kg, s.type, hf) * s.dur) / 60;
    const d = (v * s.dur) / 3600;
    km += d; elev += (d * 1000 * s.incline) / 100;
    maxI = Math.max(maxI, s.incline); maxS = Math.max(maxS, v); sec += s.dur;
    if (isVigorous(v, s.incline, s.type)) vigMin += s.dur / 60; else modMin += s.dur / 60;
  }
  return { kcal, km, elev, maxI, maxS, sec, activityMin: modMin + 2 * vigMin, vigMin, modMin };
}

/** [{...seg, start, end, index}] */
export function timeline(segs) {
  let t = 0;
  return segs.map((s, index) => { const start = t; t += s.dur; return { ...s, start, end: t, index }; });
}

/** Activity minutes of a logged session (uses splits when present). */
export function sessionActivityMin(s) {
  if (Array.isArray(s.splits) && s.splits.length) return s.splits.reduce((a, x) => a + (x.sec / 60) * (x.vig ? 2 : 1), 0);
  return (s.durationSec || 0) / 60;
}

/* ---------------- the 12-week plan ---------------- */

export const DELOAD_WEEKS = [4, 8, 12];
const levelOf = (w) => (w <= 4 ? 0 : w <= 8 ? 1 : 2);

/** Phase of a plan week. Block 2+ runs every week at Burn level, so every week is Burn (target, labels, gates). */
export function phaseForWeek(week) {
  if ((state.main.plan.block || 1) > 1) return PHASES[2];
  return PHASES[levelOf(Math.min(12, Math.max(1, week)))];
}

/** Level of a week before lighter weeks and effort holds. Block 2+ keeps the Burn level. */
const baseLevel = (week) => ((state.main.plan.block || 1) > 1 ? 2 : levelOf(week));

export function levelForWeek(week) {
  // Until a doctor check is confirmed the plan stays at the starting level (personalise also keeps it moderate).
  if (restrictedToModerate()) return 0;
  const cap = state.main.plan.levelCap;
  let L = DELOAD_WEEKS.includes(week) ? Math.max(0, baseLevel(week) - 1) : baseLevel(week);
  if (cap) {
    const from = cap.fromWeek ?? cap.untilWeek - 1; // older caps (no fromWeek) were set in the week before untilWeek
    if (week >= from && week <= cap.untilWeek) L = Math.min(L, cap.level);
    else if (week === cap.untilWeek + 1) L = Math.min(L, cap.level + 1); // after a hold, climb one level at a time
  }
  return L;
}

export function planStart() {
  const p = state.main.plan;
  return p.startDate ? parseYmd(p.startDate) : startOfWeek(new Date());
}

/**
 * Begin (or restart) the plan at block 1: on this week's Monday while one of plan.days is still ahead this week,
 * otherwise next Monday, so a new plan never opens with a week that is already over. Set plan.days first.
 * Today counts only when nothing was trained today (never two workouts on one day).
 * newBlock: the plan that just ended still owns this calendar week, so the new block starts next Monday.
 * The caller raises plan.block afterwards for a new block.
 */
export function startPlanThisWeek(plan, today = new Date(), { newBlock = false } = {}) {
  const days = (Array.isArray(plan.days) && plan.days.length ? plan.days : [1, 3, 5, 6]).slice().sort((a, b) => a - b);
  const td = isoDay(today);
  const trainedToday = state.sessions.some((s) => sessionDone(s) && sameDay(s.date, today));
  const oldEnd = plan.startDate ? addDays(parseYmd(plan.startDate), (plan.weeks || 12) * 7) : null;
  const overlaps = newBlock && oldEnd && startOfDay(today) < oldEnd;
  const left = !overlaps && days.some((d) => d > td || (d === td && !trainedToday));
  plan.startDate = ymd(addDays(startOfWeek(today), left ? 0 : 7));
  plan.firstDay = ymd(left && trainedToday ? addDays(today, 1) : today); // see planBegan()
  plan.block = 1;
  plan.moved = {}; plan.skipped = {}; plan.busy = {}; plan.swap = {}; plan.daysHistory = [];
  plan.adjust = { incline: 0, speed: 0 }; plan.adaptLog = []; delete plan.levelCap; delete plan.jogAsked;
  // Starting mid-week: training days already behind us this week (and today, once trained) count as skipped, not missed.
  if (left) days.forEach((d, i) => { if (d < td || (d === td && trainedToday)) plan.skipped[`w1d${i}`] = true; });
}

/**
 * The day the current plan actually began (onboarding or a restart), or null.
 * Plan weeks always start on a Monday, so slots earlier in that first week were never really scheduled.
 */
export function planBegan() {
  const p = state.main.plan;
  if (!p.startDate) return null;
  const c = p.firstDay ? parseYmd(p.firstDay) : p.createdAt || state.main.readiness.acceptedAt;
  if (!c) return null;
  const d = startOfDay(new Date(c));
  return isNaN(d) ? null : d;
}

/**
 * slotStatus plus 'prestart': a slot dated before the plan began that was never done is not "missed".
 * Returns 'done' | 'skipped' | 'missed' | 'today' | 'upcoming' | 'prestart'.
 */
export function slotState(slot, today = new Date(), began = planBegan()) {
  const st = slotStatus(slot, today);
  if ((st === 'missed' || st === 'skipped') && began && startOfDay(slot.date) < began) return 'prestart';
  return st;
}

/**
 * Training days in force for a plan week (changes apply from the week they were made, past weeks keep theirs).
 * A change made mid-week keeps the old days that were already behind us in that week (entry.fromDate / entry.prev).
 */
export function daysForWeek(week, plan = state.main.plan) {
  const hist = Array.isArray(plan.daysHistory) ? plan.daysHistory : [];
  let days = null, entry = null;
  for (const h of hist) if (h.fromWeek <= week) { days = h.days; entry = h; }
  if (!days) days = hist.length && hist[0].fromWeek > week && hist[0].before ? hist[0].before : plan.days;
  if (!Array.isArray(days) || !days.length) days = [1, 3, 5, 6];
  if (entry && entry.fromWeek === week && entry.fromDate && Array.isArray(entry.prev)) {
    const cut = isoDay(parseYmd(entry.fromDate));
    days = [...entry.prev.filter((d) => d < cut), ...days.filter((d) => d >= cut)];
  }
  return [...new Set(days)].filter((d) => d >= 1 && d <= 7).sort((a, b) => a - b);
}

/**
 * When a change of training days takes effect: {week, date|null}. From today when nothing of this week is logged yet
 * (earlier days of this week keep their old days), from next Monday when a session of this week is already logged,
 * and from week 1 before the plan has started.
 */
export function daysChangeFrom(plan = state.main.plan, today = new Date()) {
  if (!plan.startDate || daysUntilStart(today) > 0) return { week: 1, date: null };
  const wk = Math.max(1, currentWeek(today));
  const doneThisWeek = state.sessions.some((s) => s.planSlot && +(/^w(\d+)d/.exec(s.planSlot) || [])[1] === wk);
  if (doneThisWeek) return { week: wk + 1, date: null };
  return { week: wk, date: isoDay(today) > 1 ? ymd(today) : null };
}

/**
 * Change training days without rewriting history (see daysChangeFrom). Pending edits (moved, skipped, busy, swap)
 * of the affected days are cleared because their slot keys now point at other days; edits of days already behind us stay.
 */
export function setTrainingDays(plan, days, today = new Date()) {
  const next = [...new Set(days)].sort((a, b) => a - b);
  const { week: from, date } = daysChangeFrom(plan, today);
  const prev = daysForWeek(from, plan); // days in force for that week before this change
  const before = daysForWeek(Math.max(1, from - 1), plan);
  plan.daysHistory = [...(plan.daysHistory || []).filter((h) => h.fromWeek < from)];
  if (!plan.daysHistory.length && from > 1) plan.daysHistory.push({ fromWeek: 1, days: before });
  const entry = { fromWeek: from, days: next };
  if (date) { entry.fromDate = date; entry.prev = prev; }
  plan.daysHistory.push(entry);
  plan.days = next;
  // Slots of days already behind us keep their keys (they sort first), so their edits stay.
  const kept = date ? prev.filter((d) => d < isoDay(parseYmd(date))).length : 0;
  const keep = (obj) => Object.fromEntries(Object.entries(obj || {}).filter(([k]) => {
    const m = /^w(\d+)d(\d+)/.exec(k) || [];
    const w = +m[1], i = +m[2];
    return w && (w < from || (w === from && i < kept));
  }));
  plan.moved = keep(plan.moved); plan.skipped = keep(plan.skipped); plan.busy = keep(plan.busy); plan.swap = keep(plan.swap);
  return from;
}

/** Days until the plan starts (0 once it has started). */
export function daysUntilStart(today = new Date()) {
  return state.main.plan.startDate ? Math.max(0, daysBetween(today, planStart())) : 0;
}

/** The workout's main work mode (most intense mode among work intervals): used for the Start button color everywhere. */
export const MODE_RANK = { walk: 0, brisk: 1, power: 2, jog: 3, run: 4 };
export function mainMode(segs) {
  const work = (segs || []).filter((s) => s.role !== 'warm' && s.role !== 'cool');
  return (work.length ? work : segs || []).reduce((m, s) => (MODE_RANK[s.type] > MODE_RANK[m] ? s.type : m), 'walk');
}

/** Workout kinds for a week with n training days (never more than two hard sessions). */
function weekKinds(n, week) {
  const odd = week % 2 === 1;
  const modA = odd ? 'hills' : 'pyramid';
  const hardA = odd ? 'walkjog' : 'mixed';
  const third = odd ? 'steep' : 'threes';
  switch (n) {
    case 1: return [modA];
    case 2: return [modA, 'steady'];
    case 3: return [modA, hardA, 'steady'];
    case 4: return [modA, hardA, 'steady', 'easy'];
    case 5: return [modA, hardA, third, 'steady', 'easy'];
    default: return [modA, hardA, third, 'steady', 'easy', 'easy'];
  }
}
const isHard = (id) => WORKOUTS[id] && (WORKOUTS[id].kind === 'interval-hard' || WORKOUTS[id].kind === 'classic-hard');
const isSteep = (id, level) => ['hills', 'pyramid', 'mixed', 'steep'].includes(id) && level >= 1;

function permutations(arr) {
  if (arr.length <= 1) return [arr.slice()];
  const out = [];
  arr.forEach((x, i) => { for (const p of permutations([...arr.slice(0, i), ...arr.slice(i + 1)])) out.push([x, ...p]); });
  return out;
}

/** Arrange kinds over the chosen days so hard / steep sessions are never on consecutive days (when possible). */
function arrange(kinds, days, level) {
  let best = kinds, bestScore = Infinity;
  const seen = new Set();
  for (const p of permutations(kinds)) {
    const k = p.join(); if (seen.has(k)) continue; seen.add(k);
    let score = 0;
    for (let i = 0; i < p.length; i++) {
      const j = (i + 1) % p.length;
      const gap = j === 0 ? days[0] + 7 - days[i] : days[j] - days[i];
      if (gap === 1) {
        if (isHard(p[i]) && isHard(p[j])) score += 10;
        if (isSteep(p[i], level) && isSteep(p[j], level)) score += 4;
        if ((isHard(p[i]) || isSteep(p[i], level)) && (isHard(p[j]) || isSteep(p[j], level))) score += 2;
      }
    }
    // prefer the moderate interval first in the week and the easy walk last
    score += p.indexOf(kinds[0]) * 0.01 + (p.length - 1 - p.lastIndexOf('easy')) * 0.001;
    if (score < bestScore) { bestScore = score; best = p; }
  }
  return best;
}

/** All plan slots: [{key, week, index, workoutId, level, deload, date, planned, moved, length}] */
export function planSlots() {
  const p = state.main.plan, prof = state.main.profile;
  const start = planStart();
  const out = [];
  for (let w = 1; w <= (p.weeks || 12); w++) {
    const useDays = daysForWeek(w, p).slice(0, 6);
    if (!useDays.length) continue; // a mid-week change can leave a week with no training days
    const deload = DELOAD_WEEKS.includes(w);
    const level = levelForWeek(w);
    let kinds = weekKinds(useDays.length, w);
    if (deload) kinds = kinds.map((k) => (isHard(k) ? 'steady' : k === 'steady' ? 'easy' : k));
    if (restrictedToModerate()) kinds = kinds.map((k) => (isHard(k) ? 'steady' : k));
    const order = arrange(kinds, useDays, level);
    useDays.forEach((d, i) => {
      const key = `w${w}d${i}`;
      const planned = addDays(start, (w - 1) * 7 + (d - 1));
      const moved = p.moved && p.moved[key] ? parseYmd(p.moved[key]) : null;
      const len = p.busy && p.busy[key] ? prof.busyLength || 30 : prof.sessionLength || 45;
      const length = deload ? deloadLength(len) : len; // lighter weeks: about 25% less volume
      out.push({ key, week: w, index: i, workoutId: (p.swap && p.swap[key]) || order[i], level, deload, planned, date: moved || planned, moved: !!moved, length });
    });
  }
  return out;
}

export function slotStatus(slot, today = new Date()) {
  if (state.sessions.some((s) => s.planSlot === slot.key && (s.completed || (s.completion || 0) >= 0.7))) return 'done';
  if (state.main.plan.skipped && state.main.plan.skipped[slot.key]) return 'skipped';
  const diff = daysBetween(today, slot.date);
  if (diff < 0) return 'missed';
  if (diff === 0) return 'today';
  return 'upcoming';
}

/** Current plan week (1-based; 0 before start; > weeks when finished). */
export function currentWeek(today = new Date()) {
  if (!state.main.plan.startDate) return 1;
  const d = daysBetween(planStart(), today);
  return d < 0 ? 0 : Math.floor(d / 7) + 1;
}

/** The slot to do next: today's, else a missed one from this week, else the next upcoming. */
export function nextSlot(today = new Date()) {
  const slots = planSlots();
  const st = (s) => slotStatus(s, today);
  const todays = slots.find((s) => st(s) === 'today');
  if (todays) return todays;
  const ws = startOfWeek(today);
  const missed = slots.find((s) => st(s) === 'missed' && s.date >= ws);
  if (missed) return missed;
  return slots.find((s) => st(s) === 'upcoming') || null;
}

export const weekSlots = (week) => planSlots().filter((s) => s.week === week);

export function planProgress() {
  const slots = planSlots();
  const done = slots.filter((s) => slotStatus(s) === 'done').length;
  return { done, total: slots.length, pct: slots.length ? done / slots.length : 0 };
}

export const isTrainingDay = (d = new Date()) => (state.main.plan.days || []).includes(isoDay(d));

/** Intervals for a plan slot (respects busy-day length and adaptation). */
export function slotSegments(slot) {
  return segmentsFor(slot.workoutId, { level: slot.level, length: slot.length });
}

/* ---------------- effort-based adaptation ---------------- */

/**
 * Look at the last two plan sessions with an effort rating that came after the last adaptation.
 * Returns {kind:'ease'|'hold'|'offer', reason} or null. Call after saving a session; apply with applyAdaptation().
 */
export function evaluateAdaptation() {
  const log = state.main.plan.adaptLog || [];
  const since = log.length ? log[log.length - 1].date : '';
  const rated = state.sessions
    .filter((s) => s.planSlot && s.rpe && s.date > since)
    .sort((a, b) => (a.date < b.date ? 1 : -1))
    .slice(0, 2);
  if (rated.length < 2) return null;
  const [a, b] = rated.map((s) => s.rpe);
  if (a >= 9 && b >= 9) return { kind: 'ease', reason: 'Your last two sessions felt very hard, so work intervals are 1% less steep and jogs a little slower.' };
  if (a >= 8 && b >= 8) return { kind: 'hold', reason: 'Your last two sessions felt hard, so next week stays at this week’s level.' };
  if (a <= 4 && b <= 4) return { kind: 'offer', reason: 'Your last two sessions felt easy. Want slightly steeper work intervals?' };
  return null;
}

/** Mutates plan (call inside store.update). kind 'step' = the user accepted an 'offer'. */
export function applyAdaptation(plan, kind, reason) {
  plan.adjust = plan.adjust || { incline: 0, speed: 0 };
  const wk = currentWeek();
  if (kind === 'ease') { plan.adjust.incline = Math.max(-3, plan.adjust.incline - 1); plan.adjust.speed = Math.max(-1, Math.round((plan.adjust.speed - 0.3) * 10) / 10); }
  if (kind === 'hold') {
    // "This week's level" is the last full week's: a hold in a lighter week must not pin next week to the lighter level.
    let ref = Math.max(1, wk);
    while (ref > 1 && DELOAD_WEEKS.includes(ref)) ref--;
    plan.levelCap = { level: levelForWeek(ref), fromWeek: Math.max(1, wk), untilWeek: Math.max(1, wk) + 1 };
  }
  if (kind === 'step') { plan.adjust.incline = Math.min(3, plan.adjust.incline + 1); plan.adjust.speed = Math.min(1, Math.round((plan.adjust.speed + 0.2) * 10) / 10); }
  plan.adaptLog = [...(plan.adaptLog || []), { date: new Date().toISOString(), kind, reason }].slice(-20);
}

/**
 * Jogging is introduced in Build after two comfortable sessions: true when a user who said "Not yet" / "Not sure" to
 * jogging is in Build (or block 2+), and their last two rated plan sessions (after any earlier "Not yet") were RPE ≤ 5
 * within the last two weeks. Today offers short jogs; yes sets profile.canJog = 'yes', no stores plan.jogAsked (ISO).
 */
export function jogOfferDue(today = new Date()) {
  const p = state.main.profile, plan = state.main.plan, r = state.main.readiness;
  if (p.canJog === 'yes' || p.walkOnly || restrictedToModerate() || r.pregnant || !plan.startDate) return false;
  const wk = currentWeek(today);
  if (wk < 1 || ((plan.block || 1) === 1 && wk < 5)) return false;
  const since = plan.jogAsked || '';
  const recent = ymd(addDays(today, -14));
  const rated = state.sessions
    .filter((s) => s.planSlot && s.rpe && s.date > since && sessionDone(s))
    .sort((a, b) => (a.date < b.date ? 1 : -1))
    .slice(0, 2);
  return rated.length === 2 && rated.every((s) => s.rpe <= 5 && ymd(s.date) >= recent);
}

/* ---------------- Quick Draft (on-device generator) ---------------- */

/**
 * Build an editable workout from a few choices. No network.
 * focus: 'climb' | 'intervals' | 'steady' | 'mixed'; intensity: 'easy' | 'moderate' | 'hard'; minutes: 20 | 30 | 45 | 60
 */
export function quickDraft({ minutes = 30, focus = 'climb', intensity = 'moderate', maxIncline = null }) {
  const t = state.main.profile.treadmill;
  const cap = Math.min(maxIncline ?? 15, usesIncline() ? t.maxIncline ?? 15 : 0);
  const lvl = intensity === 'easy' ? 0 : intensity === 'moderate' ? 1 : 2;
  const canJog = state.main.profile.canJog === 'yes' && !state.main.profile.walkOnly && !restrictedToModerate();
  const wu = minutes <= 20 ? 3 : 5, cd = minutes <= 20 ? 2 : minutes <= 30 ? 3 : 5;
  let main = minutes - wu - cd;
  const segs = [seg('walk', Math.ceil(wu / 2), 1, 'Warm-up', 'warm'), seg('brisk', Math.floor(wu / 2), 2, 'Warm-up', 'warm')];
  const climb = Math.min(cap, [5, 8, 11][lvl]);
  const push = canJog ? 'jog' : 'power';
  if (focus === 'steady') {
    const blocks = Math.max(1, Math.round(main / 5));
    for (let i = 0; i < blocks; i++) segs.push(seg('power', main / blocks, Math.min(cap, climb - 2 + (i % 3)), `Block ${i + 1} of ${blocks}`));
  } else if (focus === 'climb') {
    const r = 5, n = Math.floor(main / r), extra = main - n * r;
    for (let i = 1; i <= n; i++) segs.push(seg('power', 3, climb, `Climb ${i} of ${n}`), seg('walk', 2, Math.min(cap, 2), 'Recover', 'rest'));
    if (extra > 0) segs.push(seg('brisk', extra, Math.min(cap, 3), 'Steady'));
  } else if (focus === 'intervals') {
    const work = [1, 1.5, 2][lvl], r = 4, n = Math.floor(main / r), extra = main - n * r;
    for (let i = 1; i <= n; i++) segs.push(seg(push, work, canJog ? 1 : Math.min(cap, climb), `${canJog ? 'Jog' : 'Push'} ${i} of ${n}`), seg('brisk', r - work, Math.min(cap, 3), 'Recover', 'rest'));
    if (extra > 0) segs.push(seg('power', extra, Math.min(cap, 4), 'Steady'));
  } else {
    const r = 7, n = Math.floor(main / r), extra = main - n * r;
    for (let i = 1; i <= n; i++) segs.push(seg('power', 2, climb, `Round ${i} · Climb`), seg('walk', 1, Math.min(cap, 2), `Round ${i} · Recover`, 'rest'), seg(push, 1, canJog ? 1 : Math.min(cap, 4), `Round ${i} · ${canJog ? 'Jog' : 'Push'}`), seg('brisk', 3, Math.min(cap, 4), `Round ${i} · Hill walk`, 'rest'));
    if (extra > 0) segs.push(seg('power', extra, Math.min(cap, climb - 2), 'Final climb'));
  }
  segs.push(seg('brisk', Math.ceil(cd / 2), 1, 'Cool-down', 'cool'), seg('walk', Math.floor(cd / 2), 0, 'Cool-down', 'cool'));
  const inc = usesIncline();
  const names = { climb: inc ? 'Hill' : 'Push', intervals: 'Interval', steady: 'Steady', mixed: 'Mixed' };
  return {
    name: `${names[focus]} ${minutes}`,
    intensity: lvl + 1,
    segs: segs.filter((s) => s.dur > 0).map((s) => ({ ...s, label: inc ? s.label : flatLabel(s.label), incline: Math.max(0, Math.min(cap, s.incline)) })),
  };
}
