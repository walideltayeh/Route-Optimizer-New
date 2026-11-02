// Progress tab: this-week snapshot, weekly trends, weight, records and badges, recent workouts.
// Pushed screens: #history, #weight, #records.
// Actions: logWeight(), openSession(id), logManualSession().
import * as store from '../core/store.js';
import { state } from '../core/store.js';
import {
  MODES, WEEKLY_TARGET, sessionActivityMin, currentWeek, phaseForWeek, weekSlots, slotSegments, planStats, bodyKg,
  SURFACES, activeSurface, usualSurface, effortFor, FREE_WALK_ID, vigorousExamples,
} from '../core/program.js';
import {
  activeKcalPerMin, mets, roundKcal, ewmaTrend, trendSlope, projectionBand, intakePlan, tdee, rmr, PACES, KMH_PER_MPH, paceCap,
} from '../core/science.js';
import {
  esc, ymd, parseYmd, addDays, startOfWeek, startOfDay, daysBetween, dateShort, dateLong, monthYear, dayName,
  fmt1, fmt2, fmtInt, toDist, distUnit, toElev, elevUnit, toWeight, fromWeight, weightUnit, toSpeed, speedUnit, duration, isMph, isLb,
} from '../core/format.js';
import { totals, weekStreak, records, catalogue, collectNew, nextSummit, SUMMITS } from '../core/achievements.js';
import { features, haptic, healthSaveWeight, healthReadWeights, healthSaveWorkout } from '../core/platform.js';
import { actions } from '../ui/actions.js';
import { icon, topo, toast, sheet, confirmSheet, segmented, bindSegmented, switchHtml, navBar, watchScroll, row } from '../ui/kit.js';
import { lineChart, barChart } from '../ui/charts.js';
import { surfaceTag, surfaceChart, chartLabel, surfacePicker } from './plan.js';

/* ---------------- shared helpers ---------------- */

const NB = '\u00a0'; // non-breaking space: a number never wraps away from its unit
const DAY = 864e5;
const has = (name) => name in actions; // only actions a module registered
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const sum = (arr, f) => arr.reduce((a, x) => a + (+f(x) || 0), 0);
const getS = (id) => state.sessions.find((s) => s.id === id) || null;
const fromDist = (v) => (isMph() ? v * KMH_PER_MPH : v);
const noNumbers = () => !!state.main.profile.noNumbers;
const plural = (n, one, many = one + 's') => (n === 1 ? one : many);

/** "Show weight" while profile.hideWeight is on lasts for this app run only. */
let reveal = false;
const weightHidden = () => !!state.main.profile.hideWeight && !reveal;

const wNum = (kg) => fmt1(toWeight(kg));
const wTxt = (kg) => `${wNum(kg)}${NB}${weightUnit()}`;
const wSigned = (kg) => (Math.abs(toWeight(kg)) < 0.05 ? `0.0${NB}${weightUnit()}` : `${kg > 0 ? '+' : '−'}${wTxt(Math.abs(kg))}`);
const distTxt = (km, dec = 2) => `${dec === 1 ? fmt1(toDist(km)) : fmt2(toDist(km))}${NB}${distUnit()}`;
const elevTxt = (m) => `${fmtInt(toElev(m))}${NB}${elevUnit()}`;
const kcalTxt = (k) => `≈${NB}${fmtInt(roundKcal(k))}${NB}kcal`;
const minOf = (sec) => Math.round((sec || 0) / 60);
/** Where a session was walked, or null (sessions saved before surfaces existed). */
const surfaceOf = (s) => (s && SURFACES[s.surface] ? s.surface : null);
/** Outdoors the app estimates distance from your paces (until matched to a watch or phone); logged sessions use what you entered. */
const distEstimated = (s) => surfaceOf(s) === 'outdoor' && s.source !== 'manual' && !s.consoleEdited;
const dayMonth = (d) => {
  const x = new Date(d);
  const o = { day: 'numeric', month: 'long' };
  if (x.getFullYear() !== new Date().getFullYear()) o.year = 'numeric';
  return x.toLocaleDateString(undefined, o);
};
const timeTxt = (d) => new Date(d).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
const weightUnitLong = () => (isLb() ? 'pounds' : 'kilograms');

/** Navigation bar for pushed screens; Back falls back to the Progress tab. */
const nav = (title, action = '') => navBar(title, { action }).replace('data-nav-back>', 'data-nav-back="progress">');

/** Talk-test anchors (same wording as the workout summary). */
const EFFORT = [
  { lo: 1, name: 'Very easy', talk: 'you could sing' },
  { lo: 3, name: 'Easy', talk: 'full sentences' },
  { lo: 5, name: 'Moderate', talk: 'short phrases only' },
  { lo: 7, name: 'Hard', talk: 'a few words at a time' },
  { lo: 9, name: 'Max effort', talk: 'you can’t talk' },
];
const effortOf = (n) => EFFORT[clamp(Math.floor((n - 1) / 2), 0, 4)];
const effortLine = (n) => (n ? `${n} of 10 · ${effortOf(n).name}: ${effortOf(n).talk}` : 'Not rated yet. Use the talk test: how much could you say?');

function rpeGrid(value, label = 'Effort from 1 to 10') {
  return `<div class="pg-rpe" role="group" aria-label="${esc(label)}">${Array.from({ length: 10 }, (_, i) => i + 1)
    .map((n) => `<button type="button" class="chip-toggle num" data-rpe="${n}" aria-pressed="${value === n}" aria-label="Effort ${n} of 10, ${esc(effortOf(n).name.toLowerCase())}">${n}</button>`)
    .join('')}</div>`;
}

/** Small decorative hill line for empty states. */
const emptyArt = () => `<svg class="empty-art" viewBox="0 0 120 64" aria-hidden="true" focusable="false"><path d="M4 56h112" stroke="currentColor" stroke-width="2" stroke-linecap="round" opacity=".5"/><path d="M8 56c14 0 18-26 32-26s16 14 26 14 14-30 28-30 16 42 22 42" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-dasharray="3 5"/><path d="M94 14V2l9 3.5-9 3.5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

const howLink = (txt = 'How we calculate') => (has('openHowWeCalculate') ? `<button type="button" class="pg-link hit44" data-act="how">${esc(txt)}</button>` : '');

/* ---------------- Apple Health weigh-ins (memory only) ---------------- */
// Spec 6.7 (a conservative reading of guideline 5.1.3): weigh-ins read from Apple Health are re-read from HealthKit
// when the app starts and on "Sync from Apple Health". They are never copied into Hillpace's data file, iCloud device
// backups or exported backups; they live in this map for the current app run and show only while Health is connected.

const byDay = (a, b) => (a.d < b.d ? -1 : a.d > b.d ? 1 : 0);
const healthWs = new Map(); // 'YYYY-MM-DD' -> {d, kg, source: 'health'}
let healthRead = null; // the start-up read, once per app run
const healthOn = () => !!(features.health && state.main.profile.health && state.main.profile.health.enabled);

/** Weigh-ins read from Apple Health during this app run (not saved anywhere), oldest first. */
export function healthWeighIns() { return healthOn() ? [...healthWs.values()].sort(byDay) : []; }
store.setHealthWeights(healthWeighIns); // Today's weight card, bodyKg() and the weight badges read them through store.weighIns()

/** The user's own weigh-ins plus this run's Health weigh-ins for days without one of their own. */
function mergeHealth(own) {
  const list = (Array.isArray(own) ? own : []).filter(Boolean);
  if (!healthWs.size || !healthOn()) return [...list].sort(byDay);
  const have = new Set(list.map((w) => w.d));
  return [...list, ...[...healthWs.values()].filter((h) => !have.has(h.d))].sort(byDay);
}

/**
 * Run fn (catalogue, collectNew, bodyKg …) as if this run's Health weigh-ins were in state.main.weights.
 * Synchronous swap: nothing can save state while it runs. Never wrap store.update in it; put it inside the mutator.
 */
function withHealth(fn) {
  if (!healthWs.size || !healthOn()) return fn();
  const m = state.main, own = m.weights;
  m.weights = mergeHealth(own);
  try { return fn(); } finally { m.weights = own; }
}

/** Earlier versions saved Health weigh-ins in the data file. Keep them for this run only and remove the stored copies. */
function dropStoredHealthCopies() {
  const ws = state.main.weights || [];
  if (!ws.some((w) => w && w.source === 'health')) return;
  for (const w of ws) if (w && w.source === 'health' && w.kg > 0 && !healthWs.has(w.d)) healthWs.set(w.d, { d: w.d, kg: w.kg, source: 'health' });
  store.update((m) => { m.weights = (m.weights || []).filter((w) => !(w && w.source === 'health')); }, { silent: true });
}

/** Stamp badges that this run's Health weigh-ins complete (only the unlock date is saved, never the weights). */
function stampHealthBadges() {
  const got = state.main.achievements || {};
  if (withHealth(() => catalogue().some((a) => a.progress >= 1 && !got[a.id]))) store.update((m) => { withHealth(() => collectNew(m)); });
}

/** Read Apple Health weigh-ins into memory. Returns how many days are new to the weight screen. */
async function readHealthWeights() {
  let got = [];
  try { got = await healthReadWeights(ymd(addDays(new Date(), -730))); } catch { got = []; }
  const next = new Map();
  for (const x of Array.isArray(got) ? got : []) if (x && x.kg >= 30 && x.kg <= 300 && /^\d{4}-\d{2}-\d{2}$/.test(x.d)) next.set(x.d, { d: x.d, kg: x.kg, source: 'health' });
  if (!next.size) return 0; // nothing came back (or the read failed): keep what this run already has
  const shown = new Set(weightsAsc().map((w) => w.d));
  healthWs.clear();
  for (const [d, w] of next) healthWs.set(d, w);
  return [...next.keys()].filter((d) => !shown.has(d)).length;
}

/** Start-up read (also runs the first time a Progress screen opens after Health is connected). */
function ensureHealthRead() {
  if (healthRead || !healthOn()) return;
  healthRead = readHealthWeights().then((added) => {
    if (!added) return;
    stampHealthBadges();
    if (!document.body.classList.contains('immersive')) actions.refresh(); // Progress and Today's weight card show them
  }).catch(() => {});
}

store.subscribe((reason) => {
  if (reason === 'erase') { healthWs.clear(); healthRead = null; return; }
  if (reason !== 'load' && reason !== 'remote') return;
  dropStoredHealthCopies();
  ensureHealthRead();
});

/* ---------------- weights ---------------- */

function weightsAsc() {
  return mergeHealth(state.main.weights).filter((w) => w && w.d && w.kg > 0);
}
/** Start weight and the date it refers to (earliest of the first weigh-in and the plan start). */
function startInfo(ws = weightsAsc()) {
  const p = state.main.profile;
  const first = ws[0] || null;
  const kg = p.startWeight || (first && first.kg) || null;
  const dates = [first && first.d, state.main.plan.startDate].filter(Boolean).sort();
  return { kg, d: dates[0] || null };
}
const goalKg = (startKg) => {
  const g = state.main.profile.goalWeight;
  return g > 0 && startKg && g < startKg ? g : null;
};
const toPoints = (ws) => ws.map((w) => ({ t: parseYmd(w.d).getTime(), kg: w.kg }));
const paceKg = () => (PACES.find((x) => x.id === state.main.profile.pace) || PACES[1]).kgPerWeek;

/** Projections are only shown for weight-loss goals, adults, and not during pregnancy. */
function projectionAllowed() {
  const p = state.main.profile;
  return p.goal === 'lose' && !noNumbers() && !state.main.readiness.pregnant && !(p.age && p.age < 18);
}

/** Planned daily deficit (kcal/day) behind the plan's projection, or null when inputs are missing. */
function planDeficit(startKg) {
  const p = state.main.profile;
  if (!projectionAllowed() || !(startKg > 0)) return null;
  const r = rmr({ sex: p.sex || 'unspecified', kg: startKg, cm: p.heightCm, age: p.age });
  if (!r) return null;
  let weekKcal = 0;
  try { weekKcal = weekSlots(1).reduce((a, slot) => a + planStats(slotSegments(slot), 0, startKg).kcal, 0); } catch { weekKcal = 0; }
  const ip = intakePlan({ tdeeKcal: tdee(r, p.activity, weekKcal / 7), sex: p.sex, kgPerWeek: paceKg() });
  return ip && ip.deficit > 0 ? ip.deficit : null;
}

function trendAt(tr, t) {
  if (!tr.length || t < tr[0].t) return null;
  for (let i = tr.length - 1; i >= 0; i--) {
    if (tr[i].t <= t) {
      const a = tr[i], b = tr[i + 1];
      return b ? a.trend + ((b.trend - a.trend) * (t - a.t)) / (b.t - a.t) : a.trend;
    }
  }
  return null;
}
/** True when the trend dropped by more than 1% of body weight in each of the last 3 weeks. */
function fastLoss(tr) {
  if (tr.length < 4) return false;
  const last = tr[tr.length - 1].t;
  if ((last - tr[0].t) / DAY < 21) return false;
  for (let k = 0; k < 3; k++) {
    const a = trendAt(tr, last - 7 * k * DAY), b = trendAt(tr, last - 7 * (k + 1) * DAY);
    if (a == null || b == null || !(b - a > 0.01 * b)) return false;
  }
  return true;
}

/** Everything the weight views need, in kg. */
function weightModel() {
  const ws = weightsAsc();
  const st = startInfo(ws);
  const pts = toPoints(ws);
  const tr = ewmaTrend(pts);
  const ts = trendSlope(pts);
  const goal = goalKg(st.kg);
  const latest = ws.length ? ws[ws.length - 1] : null;
  return { ws, st, tr, ts, goal, latest, current: latest ? latest.kg : st.kg };
}

/** Pace tag: {cls, text} or null. */
function paceTag(m) {
  if (m.goal && m.current && m.current <= m.goal) return { cls: 'good', text: 'Goal reached' };
  if (state.main.profile.goal !== 'lose' || !m.ts.ready) return null;
  const rate = -m.ts.perWeek;
  if (fastLoss(m.tr)) return { cls: 'warn', text: 'Faster than planned' };
  if (rate > paceCap(m.current)) return { cls: 'warn', text: 'Faster than planned' }; // same cap as Today's weight card
  if (rate <= 0.02) return { cls: 'warn', text: 'Behind pace' };
  const r = rate / paceKg();
  return r >= 1.2 ? { cls: 'good', text: 'Ahead of pace' } : r >= 0.7 ? { cls: 'good', text: 'On pace' } : { cls: 'warn', text: 'Behind pace' };
}

/** Days from the last trend point until the trend reaches the goal, or null when it isn't heading there. */
function trendGoalDays(m) {
  if (!m.goal || !m.ts.ready || !m.tr.length || !(m.ts.perWeek < 0) || !(m.ts.current > m.goal)) return null;
  return ((m.ts.current - m.goal) / -m.ts.perWeek) * 7;
}
const PROJ_WEEKS = { min: 8, max: 26 };

/** Projection series in display units: {center?, upper, lower, kind: 'plan'|'trend', endT} or null. */
function projection(m) {
  if (!projectionAllowed()) return null;
  const disp = (kg) => toWeight(kg);
  if (m.ts.ready && m.tr.length) {
    const last = m.tr[m.tr.length - 1];
    const slope = m.ts.perWeek, half = Math.max(2 * (m.ts.se || 0), 0.05);
    const clip = (v) => (m.goal && slope < 0 ? Math.max(m.goal, v) : v);
    // Run the projection to (just past) the projected goal date, so the chart meets the goal where the text says.
    const gd = trendGoalDays(m);
    const weeks = gd == null ? PROJ_WEEKS.min : clamp(Math.ceil(gd / 7 + 1), PROJ_WEEKS.min, PROJ_WEEKS.max);
    const center = [], upper = [], lower = [];
    for (let i = 0; i <= weeks * 2; i++) {
      const wk = i / 2, t = last.t + wk * 7 * DAY;
      center.push({ t, v: disp(clip(last.trend + slope * wk)) });
      upper.push({ t, v: disp(clip(last.trend + (slope + half) * wk)) });
      lower.push({ t, v: disp(clip(last.trend + (slope - half) * wk)) });
    }
    return { kind: 'trend', center, upper, lower, endT: last.t + weeks * 7 * DAY };
  }
  const D = planDeficit(m.st.kg);
  if (!D || !m.st.d) return null;
  const t0 = parseYmd(m.st.d);
  const horizon = Math.max(84, daysBetween(t0, new Date()) + 28);
  const upper = [], lower = [];
  for (let i = 0; i <= 28; i++) {
    const days = (horizon * i) / 28, b = projectionBand(m.st.kg, D, days, m.goal);
    const t = t0.getTime() + days * DAY;
    upper.push({ t, v: disp(b.heavy) });
    lower.push({ t, v: disp(b.light) });
  }
  return { kind: 'plan', upper, lower, deficit: D };
}

/* ---------------- sessions: weeks and rows ---------------- */

function weekAgg(list) {
  return { n: list.length, min: sum(list, sessionActivityMin), km: sum(list, (s) => s.distanceKm), elev: sum(list, (s) => s.elevM), sec: sum(list, (s) => s.durationSec) };
}
function between(a, b) { return state.sessions.filter((s) => { const t = new Date(s.date); return t >= a && t < b; }); }

/**
 * This week so far vs last week up to the same moment (same weekday and time of day), so a Monday morning
 * before training isn't compared with all of last Monday.
 */
function snapshot(now = new Date()) {
  const ws = startOfWeek(now);
  const end = addDays(startOfDay(now), 1);
  return { ws, cur: weekAgg(between(ws, end)), prev: weekAgg(between(addDays(ws, -7), addDays(now, -7))) };
}

const METRICS = [
  { id: 'min', label: 'Activity', long: 'Activity minutes', unit: () => 'min', val: (s) => sessionActivityMin(s), conv: (v) => v, dec: 0 },
  { id: 'time', label: 'Time', long: 'Workout time', unit: () => 'min', val: (s) => (s.durationSec || 0) / 60, conv: (v) => v, dec: 0 },
  { id: 'dist', label: 'Distance', long: 'Distance', unit: distUnit, val: (s) => s.distanceKm, conv: toDist, dec: 1 },
  { id: 'climb', label: 'Climb', long: 'Climb', unit: elevUnit, val: (s) => s.elevM, conv: toElev, dec: 0 },
  { id: 'n', label: 'Sessions', long: 'Sessions', unit: () => '', val: () => 1, conv: (v) => v, dec: 0 },
];
let metricId = 'min';
let rangeId = '1M';

/** Weekly totals for the last n weeks (oldest first). */
function weeklyTotals(metric, n, now = new Date()) {
  const ws0 = startOfWeek(now);
  const weeks = Array.from({ length: n }, (_, i) => addDays(ws0, -7 * (n - 1 - i)));
  const idx = new Map(weeks.map((w, i) => [ymd(w), i]));
  const vals = weeks.map(() => 0);
  for (const s of state.sessions) {
    const i = idx.get(ymd(startOfWeek(new Date(s.date))));
    if (i != null) vals[i] += +metric.val(s) || 0;
  }
  return weeks.map((w, i) => ({ week: w, v: metric.conv(vals[i]) }));
}

function sessionMeta(s) {
  return [
    `${minOf(s.durationSec)}${NB}min`,
    s.distanceKm > 0 ? `${distEstimated(s) ? `≈${NB}` : ''}${distTxt(s.distanceKm)}` : '',
    !noNumbers() && s.kcal > 0 ? kcalTxt(s.kcal) : '',
    s.elevM > 0 ? elevTxt(s.elevM) : '',
  ].filter(Boolean).join(' · ');
}
function sessionChips(s) {
  const out = [];
  const wk = /^w(\d+)d/.exec(s.planSlot || '');
  if (wk) out.push(`<span class="tag">Week ${esc(wk[1])}</span>`);
  // where it was walked: only flat and outdoor sessions get a tag (incline is the default, so those rows stay calm)
  const surf = surfaceOf(s);
  if (surf && surf !== 'incline') out.push(surfaceTag(surf));
  if (s.source === 'manual') out.push('<span class="tag">Manual</span>');
  else if (!s.completed && (s.completion ?? 1) < 1) out.push(`<span class="tag warn">Partial · ${Math.round(clamp(s.completion || 0, 0, 1) * 100)}%</span>`);
  return out.join('');
}
function sessionRow(s) {
  const d = new Date(s.date);
  const chips = sessionChips(s);
  const eff = s.rpe ? `<span class="pg-eff"><span class="sr-only">Effort </span><b class="num">${esc(s.rpe)}</b><small>/10</small></span>` : '';
  return `<button type="button" class="row pg-srow" data-session="${esc(s.id)}">
    <span class="pg-dateblk" aria-hidden="true"><span class="pg-dateblk-d num">${d.getDate()}</span><span class="pg-dateblk-w">${esc(dayName(d))}</span></span>
    <span class="row-main"><span class="sr-only">${esc(dateLong(d))}. </span><span class="pg-srow-top"><span class="row-title">${esc(s.name || 'Workout')}</span>${eff}</span>${chips ? `<span class="pg-chips">${chips}</span>` : ''}<span class="row-sub">${esc(sessionMeta(s))}</span></span>
    ${icon('chevR', 'chev')}</button>`;
}

/* ---------------- badges ---------------- */

function visibleBadge(a) {
  if (a.group === 'Energy' && noNumbers()) return false;
  if (a.group === 'Weight' && (noNumbers() || weightHidden())) return false;
  return true;
}
function badgeProgressText(a, t, st) {
  const of = (cur, total, unit) => `${fmtInt(Math.min(cur, total))} of ${fmtInt(total)} ${unit}`;
  const n = { s10: 10, s25: 25, s50: 50, s100: 100, first: 1 }[a.id];
  if (n) return of(t.count, n, plural(n, 'workout'));
  if (a.id === 'streak3' || a.id === 'streak8') return of(st.weeks, a.id === 'streak3' ? 3 : 8, 'weeks');
  if (a.id === 'km50' || a.id === 'km200') return `${fmt1(Math.min(t.km, a.id === 'km50' ? 50 : 200))} of ${a.id === 'km50' ? 50 : 200} km`;
  if (a.id === 'kcal10k' || a.id === 'kcal30k') return `≈${NB}${of(roundKcal(t.kcal), a.id === 'kcal10k' ? 10000 : 30000, 'kcal')}`;
  if (/^p\d$/.test(a.id)) return of(Math.round(a.progress * 4), 4, 'weeks');
  if (a.id === 'week1') return 'Not yet';
  return `${Math.round(a.progress * 100)}% there`;
}
function recentBadges(cat) {
  // Newest first. Reached but not yet stamped counts as newest; ties go to the later (harder) catalogue entry.
  const key = (a) => a.date || '9999';
  return cat.map((a, i) => ({ a, i })).filter((x) => x.a.unlocked && visibleBadge(x.a))
    .sort((x, y) => (key(x.a) < key(y.a) ? 1 : key(x.a) > key(y.a) ? -1 : y.i - x.i)).slice(0, 3).map((x) => x.a);
}
const ICON_ALIAS = { calendar: 'plan' }; // kit.js has no 'calendar' glyph
/** Ids of badges unlocked right now (stamped or reached). */
const unlockedIds = () => new Set(badgeCatalogue().filter((a) => a.unlocked).map((a) => a.id));
/** Stamp new achievements and return the visible ones this change unlocked (not ones that were already reached). */
function stampNew(before) {
  store.update((m) => { withHealth(() => collectNew(m)); });
  return badgeCatalogue().filter((a) => a.unlocked && !before.has(a.id) && visibleBadge(a));
}
/** Badge catalogue that also counts this run's Apple Health weigh-ins. */
function badgeCatalogue() { return withHealth(catalogue); }
function badgeIcon(a) { return `<span class="pg-bico${a.unlocked ? ' on' : ''}">${icon(ICON_ALIAS[a.icon] || a.icon)}</span>`; }

/* =====================================================================
   Progress tab
   ===================================================================== */

function headHtml() {
  const n = state.sessions.length;
  let eyebrow = 'Your training at a glance';
  if (n) {
    const first = state.sessions.reduce((a, s) => (s.date < a ? s.date : a), state.sessions[0].date);
    eyebrow = `${n} ${plural(n, 'workout')} since ${dateShort(first)}`;
  }
  return `<header class="screen-head pg-head"><div class="head-text"><p class="eyebrow">${esc(eyebrow)}</p><h1 class="title-xl">Progress</h1></div></header>`;
}

function deltaHtml(cur, prev, f, unit) {
  const d = cur - prev;
  const shown = f(Math.abs(d));
  if (shown === f(0)) return '<span class="pg-delta same">Same as last week</span>';
  const up = d > 0;
  return `<span class="pg-delta ${up ? 'up' : 'down'}"><span class="sr-only">${esc(shown)}${unit ? ' ' + esc(unit) : ''} ${up ? 'more' : 'less'} than last week</span><span aria-hidden="true"><span class="pg-arrow">${up ? '▲' : '▼'}</span> ${esc(shown)}</span></span>`;
}

function heroHtml(now) {
  const sn = snapshot(now);
  const any = state.sessions.length > 0;
  const deltas = any && sn.cur.n > 0; // no wall of down arrows before this week's first workout
  const i = (v) => String(Math.round(v));
  const cells = [
    ['Sessions', i(sn.cur.n), '', deltaHtml(sn.cur.n, sn.prev.n, i, '')],
    ['Activity minutes', i(sn.cur.min), 'min', deltaHtml(sn.cur.min, sn.prev.min, i, 'min')],
    ['Distance', fmt1(toDist(sn.cur.km)), distUnit(), deltaHtml(toDist(sn.cur.km), toDist(sn.prev.km), fmt1, distUnit())],
    // Walkers without an incline see their walking time instead of a climb that stays at 0 m.
    usualSurface() !== 'incline' && !(sn.cur.elev > 0) && !(sn.prev.elev > 0)
      ? ['Walking time', i(sn.cur.sec / 60), 'min', deltaHtml(sn.cur.sec / 60, sn.prev.sec / 60, i, 'min')]
      : ['Climb', fmtInt(toElev(sn.cur.elev)), elevUnit(), deltaHtml(toElev(sn.cur.elev), toElev(sn.prev.elev), fmtInt, elevUnit())],
  ];
  const foot = !any ? 'Finish your first workout and this week starts filling in.'
    : deltas ? `Arrows compare with last week up to this time on ${dayName(now, 'long')}. Vigorous minutes count double.`
    : 'Arrows comparing this week with last week appear after your first workout. Vigorous minutes count double.';
  return `
  <section class="hero-card pg-hero" aria-labelledby="pg-hero-title">
    ${topo({ seed: 11, lines: 15, cx: 0.92, cy: 0.05 })}
    <div class="pg-hero-top"><h2 class="eyebrow pg-hero-eyebrow" id="pg-hero-title">This week</h2><span class="pg-hero-range">${esc(dateShort(sn.ws))} – ${esc(dateShort(addDays(sn.ws, 6)))}</span></div>
    <div class="pg-snap">${cells.map((c) => `<div class="pg-snap-cell"><span class="stat-label">${c[0]}</span><span class="pg-snap-val"><span class="display-num num">${esc(c[1])}</span>${c[2] ? `<small>${esc(c[2])}</small>` : ''}</span>${deltas ? c[3] : ''}</div>`).join('')}</div>
    <p class="pg-hero-foot">${esc(foot)}</p>
  </section>`;
}

/* ---- trends ---- */

function trendsHtml() {
  return `
  <section class="section pg-trends" aria-labelledby="pg-trends-title">
    <div class="section-head"><h2 class="section-title" id="pg-trends-title">Trends</h2>${segmented('range', [{ value: '1M', label: '1M' }, { value: '3M', label: '3M' }], rangeId, { label: 'Chart range: 1 or 3 months' })}</div>
    <div class="card pg-chart-card">
      ${segmented('metric', METRICS.map((m) => ({ value: m.id, label: m.label })), metricId, { block: true, label: 'Chart metric' })}
      <div class="pg-chart-body"></div>
    </div>
  </section>`;
}

function chartBodyHtml() {
  const m = METRICS.find((x) => x.id === metricId) || METRICS[0];
  const n = rangeId === '3M' ? 13 : 5;
  const data = weeklyTotals(m, n);
  if (!state.sessions.length) {
    return `<p class="pg-chart-empty">${icon('progress')}<span>Your weekly totals build up here after your first workout.</span></p>`;
  }
  const firstWeek = startOfWeek(new Date(state.sessions.reduce((a, s) => (s.date < a ? s.date : a), state.sessions[0].date)));
  const done = data.slice(0, -1).filter((x) => x.week >= firstWeek);
  const unit = m.unit();
  const f = (v) => (m.id === 'n' ? fmt1(v) : m.dec ? fmt1(v) : fmtInt(v));
  let big, cap;
  if (done.length) {
    big = f(done.reduce((a, x) => a + x.v, 0) / done.length);
    cap = `a week on average over the last ${done.length} full ${plural(done.length, 'week')}`;
  } else {
    big = m.dec ? fmt1(data[data.length - 1].v) : fmtInt(data[data.length - 1].v);
    cap = 'so far this week';
  }
  if (m.id === 'n') cap = `${plural(+big === 1 ? 1 : 2, 'session')} ${cap}`;
  let note = '';
  if (m.id === 'min') {
    const wk = currentWeek();
    const target = WEEKLY_TARGET[wk >= 1 && wk <= 12 ? phaseForWeek(wk).id : 0];
    note = `<p class="pg-chart-note"><i class="pg-lg-dash" aria-hidden="true"></i>Weekly target: ${target} activity minutes. Vigorous minutes, ${esc(vigorousExamples())}, count double.</p>`;
  } else if (m.id === 'time') note = '<p class="pg-chart-note">Time walking, including warm-up and cool-down.</p>';
  else if (m.id === 'climb') note = `<p class="pg-chart-note">Vertical ${elevUnit() === 'ft' ? 'feet' : 'metres'} climbed: distance × incline.</p>`;
  return `
    <div class="pg-chart-sum"><span class="pg-chart-big num">${esc(big)}</span>${unit && m.id !== 'n' ? `<span class="pg-chart-unit">${esc(unit)}</span>` : ''}<span class="pg-chart-cap">${esc(cap)}</span></div>
    <div class="chart pg-bars" data-n="${n}"></div>
    ${note}`;
}

function drawBars(root) {
  const box = root.querySelector('.pg-bars');
  if (!box) return;
  const m = METRICS.find((x) => x.id === metricId) || METRICS[0];
  const n = rangeId === '3M' ? 13 : 5;
  const data = weeklyTotals(m, n);
  const compact = (v) => (v >= 1000 ? `${fmt1(v / 1000)}k` : m.dec && n <= 5 ? fmt1(v) : fmtInt(v));
  const bars = data.map((x, i) => {
    const last = i === n - 1;
    const show = n <= 5 || (n - 1 - i) % 4 === 0;
    return { label: show ? (last ? 'This week' : dateShort(x.week)) : '', v: x.v, highlight: last, title: `Week of ${dateShort(x.week)}: ${compact(x.v)} ${m.unit()}` };
  });
  let target = null;
  if (m.id === 'min') { const wk = currentWeek(); target = WEEKLY_TARGET[wk >= 1 && wk <= 12 ? phaseForWeek(wk).id : 0]; }
  const label = `${m.long} per week, last ${n} weeks: ` + data.map((x) => `week of ${dateShort(x.week)} ${compact(x.v)}`).join(', ');
  box.innerHTML = barChart({ bars, w: Math.max(260, box.clientWidth || 320), h: 190, target, yFmt: (v) => compact(v), label });
}

/* ---- weight card ---- */

function weightCardHtml() {
  if (noNumbers()) return '';
  const logBtn = `<button type="button" class="btn btn-sm" data-act="log-weight">${icon('plus')}Log weight</button>`;
  const head = `<div class="section-head"><h2 class="section-title" id="pg-w-title">Weight</h2><a class="section-link" href="#weight">Details${icon('chevR')}</a></div>`;
  if (weightHidden()) {
    return `<section class="section" aria-labelledby="pg-w-title">${head}
      <div class="card pg-wcard pg-whidden">
        <p class="pg-whidden-text">${icon('eyeOff')}<span><b>Weight is hidden</b>Your weigh-ins are still saved. Showing them lasts until you close the app.</span></p>
        <div class="pg-wfoot"><button type="button" class="btn btn-sm btn-ghost" data-act="reveal">Show weight</button>${logBtn}</div>
      </div></section>`;
  }
  const m = weightModel();
  if (!m.current) {
    return `<section class="section" aria-labelledby="pg-w-title">${head}
      <div class="card pg-wcard"><p class="body-s">Log your first weigh-in to start a trend line. Once or twice a week, at the same time of day, is plenty.</p><div class="pg-wfoot">${logBtn}</div></div></section>`;
  }
  const tag = paceTag(m);
  const change = m.st.kg && m.latest ? m.latest.kg - m.st.kg : null;
  const since = m.st.d ? `since ${dateShort(parseYmd(m.st.d))}` : 'since you started';
  return `<section class="section" aria-labelledby="pg-w-title">${head}
    <div class="card pg-wcard">
      <div class="pg-w-top">
        <div class="pg-w-nums">
          <span class="stat-label">${m.latest ? `Latest · ${esc(dateShort(parseYmd(m.latest.d)))}` : 'Start weight'}</span>
          <p class="pg-w-big"><span class="display-num num">${esc(wNum(m.current))}</span><small>${esc(weightUnit())}</small></p>
          ${change != null && m.ws.length > 1 ? `<p class="pg-w-change"><b class="num">${esc(wSigned(change))}</b> ${esc(since)}</p>` : ''}
        </div>
        ${tag ? `<span class="tag ${tag.cls}">${esc(tag.text)}</span>` : ''}
      </div>
      ${m.tr.length >= 2 ? '<div class="pg-spark" aria-hidden="true"></div>' : ''}
      <div class="pg-wfoot">${m.goal ? `<span class="pg-wgoal">Goal <b class="num">${esc(wTxt(m.goal))}</b></span>` : '<span></span>'}${logBtn}</div>
    </div></section>`;
}

function drawSpark(root) {
  const box = root.querySelector('.pg-spark');
  if (!box) return;
  const m = weightModel();
  const recent = m.tr.slice(-30);
  const w = (box.clientWidth || 300) + 38;
  const raw = recent.map((p) => ({ t: p.t, v: toWeight(p.kg) }));
  box.innerHTML = lineChart({
    series: m.ts.ready
      ? [{ points: raw, color: 'var(--ink-3)', line: false, dots: true, dotR: 2.6, dotOpacity: 0.5 }, { points: recent.map((p) => ({ t: p.t, v: toWeight(p.trend) })), color: 'var(--ink)', width: 2.6 }]
      : [{ points: raw, color: 'var(--ink-3)', width: 1.6, opacity: 0.6, dots: true, dotR: 3, dotFill: 'var(--ink)' }],
    w, h: 96, label: 'Weight trend',
  });
}

/* ---- records & badges card ---- */

function recordsCardHtml() {
  const cat = badgeCatalogue();
  const vis = cat.filter(visibleBadge);
  const earned = vis.filter((a) => a.unlocked).length;
  const recent = recentBadges(cat);
  const t = totals();
  const ns = nextSummit(t.elev);
  const pct = ns.next ? clamp(t.elev / ns.next.m, 0, 1) : 1;
  const summit = ns.next
    ? `<b class="num">${esc(elevTxt(t.elev))}</b> of ${esc(elevTxt(ns.next.m))} to ${esc(ns.next.name)}`
    : `<b class="num">${esc(elevTxt(t.elev))}</b> climbed. That’s higher than Everest.`;
  const badges = recent.length
    ? `<div class="pg-b3">${recent.map((a) => `<span class="pg-b3-item">${badgeIcon(a)}<span class="pg-b3-title">${esc(a.title)}</span><span class="pg-b3-date">${a.date ? `Earned ${esc(dateShort(a.date))}` : 'Earned'}</span></span>`).join('')}</div>`
    : '<p class="body-s">Finish your first workout to earn <b>First steps</b>.</p>';
  return `
  <section class="section" aria-labelledby="pg-rb-title">
    <div class="section-head"><h2 class="section-title" id="pg-rb-title">Records &amp; badges</h2><span class="pg-count">${earned} of ${vis.length} earned</span></div>
    <a class="card pg-rb pressable" href="#records">
      ${badges}
      <span class="pg-summit">
        <span class="pg-summit-line"><span class="pg-summit-ico">${icon('mountain')}</span><span>${summit}</span></span>
        <span class="pbar" aria-hidden="true"><i style="width:${(pct * 100).toFixed(1)}%"></i></span>
      </span>
      <span class="pg-rb-more">All records and badges${icon('chevR')}</span>
    </a>
  </section>`;
}

/* ---- history preview ---- */

function historyPreviewHtml() {
  const last = state.sessions.slice(0, 3);
  const head = `<div class="section-head"><h2 class="section-title" id="pg-h-title">History</h2>${last.length ? `<a class="section-link" href="#history">See all${icon('chevR')}</a>` : ''}</div>`;
  const logRow = `<button type="button" class="row has-icon pg-logrow" data-act="log-session"><span class="row-icon">${icon('plus')}</span><span class="row-main"><span class="row-title">Log a session</span><span class="row-sub">For a walk or jog you did without the app</span></span>${icon('chevR', 'chev')}</button>`;
  if (!last.length) {
    return `<section class="section" aria-labelledby="pg-h-title">${head}<div class="group"><p class="pg-none">No workouts yet. Finished workouts show up here.</p>${logRow}</div></section>`;
  }
  return `<section class="section" aria-labelledby="pg-h-title">${head}<div class="group">${last.map(sessionRow).join('')}</div><div class="group">${logRow}</div></section>`;
}

function footHtml() {
  if (noNumbers()) return '';
  return `<p class="pg-foot">Calories (≈ kcal) are estimates of active energy from standard exercise equations. ${howLink()}</p>`;
}

/** Every Progress screen: move old stored Health copies to memory, and read Health once per run. */
function prepHealth() { dropStoredHealthCopies(); ensureHealthRead(); }

function renderProgress(root) {
  prepHealth();
  root.classList.add('pg');
  const now = new Date();
  root.innerHTML = headHtml() + heroHtml(now) + trendsHtml() + weightCardHtml() + recordsCardHtml() + historyPreviewHtml() + footHtml();
  const body = root.querySelector('.pg-chart-body');
  const redrawChart = () => { body.innerHTML = chartBodyHtml(); drawBars(root); };
  redrawChart();
  drawSpark(root);
  bindSegmented(root, (name, value) => {
    if (name === 'metric') metricId = value;
    if (name === 'range') rangeId = value;
    redrawChart();
  });
  wireCommon(root);
}

/* =====================================================================
   #history
   ===================================================================== */

function renderHistory(root) {
  prepHealth();
  root.classList.add('pg', 'pg-push');
  const list = state.sessions;
  const action = `<button type="button" class="icon-btn plain" data-act="log-session" aria-label="Log a session">${icon('plus')}</button>`;
  let body;
  if (!list.length) {
    body = `<div class="empty">${emptyArt()}<p class="title-m">No workouts yet</p><p>Finished workouts appear here, newest first. Walked or jogged without the app? Log it so it counts toward your weekly minutes.</p><button type="button" class="btn btn-primary" data-act="log-session">${icon('plus')}Log a session</button></div>`;
  } else {
    const t = totals(list);
    const months = new Map();
    for (const s of list) {
      const d = new Date(s.date);
      const k = d.getFullYear() + '-' + d.getMonth();
      if (!months.has(k)) months.set(k, { d, items: [] });
      months.get(k).items.push(s);
    }
    body = (months.size > 1 ? `<p class="pg-push-sub">${list.length} ${plural(list.length, 'workout')} in total · ${esc(duration(t.sec))} · ${esc(distTxt(t.km, 1))}</p>` : '') +
      [...months.values()].map((mo, i) => {
        const mt = totals(mo.items);
        return `<section class="section pg-month" aria-labelledby="pg-mo-${i}">
          <div class="pg-month-head"><h2 class="pg-month-title" id="pg-mo-${i}">${esc(monthYear(mo.d))}</h2><p class="pg-month-sum">${mo.items.length} ${plural(mo.items.length, 'session')} · ${esc(duration(mt.sec))} · ${esc(distTxt(mt.km, 1))}</p></div>
          <div class="group">${mo.items.map(sessionRow).join('')}</div>
        </section>`;
      }).join('') +
      `<button type="button" class="btn btn-ghost btn-block" data-act="log-session">${icon('plus')}Log a session</button>` +
      (noNumbers() ? '' : `<p class="pg-foot">≈ kcal values are estimates of active energy. ${howLink()}</p>`);
  }
  root.innerHTML = nav('History', action) + `<h1 class="title-l pg-push-title">History</h1>` + body;
  wireCommon(root);
  return watchScroll(root.querySelector('.nav-bar'));
}

/* =====================================================================
   #weight
   ===================================================================== */

let showAllEntries = false;

function weightStatus(m, proj) {
  const u = weightUnit();
  if (!m.ts.ready) {
    const n = m.ws.length;
    const span = n > 1 ? daysBetween(parseYmd(m.ws[0].d), parseYmd(m.ws[n - 1].d)) : 0;
    const needs = [];
    if (n < 4) needs.push(`${4 - n} more ${plural(4 - n, 'weigh-in')}`);
    if (span < 14) needs.push(`${14 - span} more ${plural(14 - span, 'day')} of data`);
    let txt = `Your trend line appears after 14 days and at least 4 weigh-ins${needs.length ? ` (${needs.join(' and ')})` : ''}.`;
    if (proj && proj.kind === 'plan') txt += ' Until then, the shaded band shows where following the plan and suggested intake could take you. Projection, not a promise.';
    return txt;
  }
  const per = m.ts.perWeek;
  const rate = `${per > 0 ? '+' : '−'}${fmt1(toWeight(Math.abs(per)))}${NB}${u}/week`;
  const cur = m.ts.current;
  if (Math.abs(per) < 0.05) return `Your trend is steady at about ${wTxt(cur)}. Day-to-day swings of water and food are normal; the trend smooths them out.`;
  if (per > 0) return `Trend ${rate}. Daily swings are normal, so give it a couple of weeks before reading much into it.`;
  if (m.goal && cur <= m.goal) return `Trend ${rate}. You’re at or below your goal of ${wTxt(m.goal)}.`;
  if (!m.goal || !projectionAllowed()) return `Trend ${rate}.`;
  const days = trendGoalDays(m);
  if (days > 730) return `Trend ${rate}. At this rate your goal is more than two years away. A projection, not a promise.`;
  const goalT = m.tr[m.tr.length - 1].t + days * DAY;
  const past = proj && proj.endT && goalT > proj.endT ? ', after the end of the chart' : '';
  return `Trend ${rate}. At this rate you reach ${wTxt(m.goal)} around ${dayMonth(new Date(goalT))}${past} — a projection, not a promise.`;
}

function weightBody() {
  const m = weightModel();
  const logBtn = `<button type="button" class="btn btn-primary btn-block" data-act="log-weight">${icon('plus')}Log weight</button>`;
  const healthRow = features.health && state.main.profile.health.enabled
    ? `<div class="group"><button type="button" class="row has-icon" data-act="health-sync"><span class="row-icon">${icon('heart')}</span><span class="row-main"><span class="row-title">Sync from Apple Health</span><span class="row-sub">Shows weigh-ins from other apps and scales, one per day. Read from Health each time, not copied into Hillpace.</span></span>${icon('refresh', 'chev')}</button></div>`
    : '';
  const hideRow = `<div class="group"><label class="row pg-switchrow" for="pg-hidew"><span class="row-main"><span class="row-title">Hide weight figures</span><span class="row-sub">On Today and Progress. Weigh-ins are still saved.</span></span>${switchHtml('pg-hidew', !!state.main.profile.hideWeight, 'Hide weight figures')}</label></div>`;
  if (!m.current) {
    return `<div class="empty">${emptyArt()}<p class="title-m">No weigh-ins yet</p><p>Weigh yourself once or twice a week, at the same time of day. Your trend line appears after two weeks.</p></div>${logBtn}${healthRow}${hideRow}`;
  }
  const proj = projection(m);
  const tag = paceTag(m);
  const change = m.latest && m.st.kg ? m.latest.kg - m.st.kg : null;
  const toGo = m.goal ? Math.max(0, m.current - m.goal) : null;
  // A null value shows a dash with no unit next to it.
  const stats = [
    ['Latest', wNum(m.current), m.latest ? dateShort(parseYmd(m.latest.d)) : 'start weight'],
    change != null
      ? ['Change', wSigned(change).replace(/\s?(kg|lb)$/, ''), m.st.d ? `since ${dateShort(parseYmd(m.st.d))}` : '']
      : ['Change', null, 'no weigh-ins'],
    m.goal ? ['To goal', fmt1(toWeight(toGo)), `goal ${wNum(m.goal)}`] : ['Trend', m.ts.ready ? wNum(m.ts.current) : null, m.ts.ready ? 'smoothed' : 'after 2 weeks'],
  ];
  const statVal = (v) => (v == null ? '<span aria-hidden="true">—</span><span class="sr-only">Not yet</span>' : `${esc(v)}<small>${esc(weightUnit())}</small>`);
  const legend = [
    '<span><i class="pg-lg-dot" aria-hidden="true"></i>Weigh-ins</span>',
    m.ts.ready ? '<span><i class="ln" aria-hidden="true"></i>Trend</span>' : '',
    m.goal ? '<span><i class="pg-lg-dash" aria-hidden="true"></i>Goal</span>' : '',
    proj ? '<span><i class="pg-lg-band" aria-hidden="true"></i>Projection, not a promise</span>' : '',
  ].join('');
  const fast = fastLoss(m.tr)
    ? `<div class="banner warn" role="note"><span class="banner-icon">${icon('alert')}</span><div class="banner-body"><b>Faster than we recommend</b>For three weeks your trend has dropped more than 1% of your body weight each week. Make sure you eat enough to fuel your workouts, and talk to your doctor if it keeps up.</div></div>`
    : '';
  const desc = [...m.ws].reverse();
  const shown = showAllEntries ? desc : desc.slice(0, 12);
  const rows = shown.map((w) => {
    const i = m.ws.indexOf(w);
    const prev = i > 0 ? m.ws[i - 1] : null;
    const sub = [w.source === 'health' ? 'From Apple Health' : '', prev ? `${wSigned(w.kg - prev.kg)} from ${dateShort(parseYmd(prev.d))}` : 'First weigh-in'].filter(Boolean).join(' · ');
    return row({ title: dateLong(parseYmd(w.d)), sub, value: wTxt(w.kg), attrs: `data-wday="${esc(w.d)}" aria-label="${esc(`${dateLong(parseYmd(w.d))}, ${wTxt(w.kg)}. Edit`)}"` });
  }).join('');
  const more = desc.length > shown.length ? `<button type="button" class="btn btn-text pg-more" data-act="all-entries">Show all ${desc.length} weigh-ins</button>` : '';
  return `
  <section class="card pg-wchart-card" aria-label="Weight chart">
    <div class="stat-grid pg-wstats" style="--cols:3">${stats.map((s) => `<div><span class="stat-label">${esc(s[0])}</span><span class="stat-value num">${statVal(s[1])}</span><span class="pg-stat-sub">${esc(s[2])}</span></div>`).join('')}</div>
    <div class="chart pg-wchart"></div>
    <div class="legend pg-wlegend">${legend}</div>
  </section>
  <div class="pg-wstatus">${tag ? `<span class="tag ${tag.cls}">${esc(tag.text)}</span>` : ''}<p>${esc(weightStatus(m, proj))}</p></div>
  ${fast}
  ${logBtn}
  ${healthRow}
  <section class="section" aria-labelledby="pg-entries-title">
    <div class="section-head"><h2 class="section-title" id="pg-entries-title">Weigh-ins</h2><span class="pg-count">${m.ws.length} ${plural(m.ws.length, 'entry', 'entries')}</span></div>
    ${m.ws.length ? `<div class="group">${rows}</div>${more}` : `<div class="group"><p class="pg-none">Your start weight is ${esc(wTxt(m.st.kg))}. Log a weigh-in to start your trend.</p></div>`}
  </section>
  ${hideRow}
  <p class="pg-foot">The trend smooths daily swings (an exponentially weighted average). ${proj ? 'Projections use your plan’s energy deficit with the Hall (2011) model and the 7,700 kcal/kg rule, or your own trend once there’s enough data. ' : ''}${howLink()}</p>`;
}

/**
 * lineChart pads the y range by max(0.5, 12%) and draws 5 ticks. Pick yMin/yMax so the padded range lands on
 * round tick values. Returns {yMin, yMax, yFmt}.
 */
function niceY(values) {
  const lo0 = Math.min(...values), hi0 = Math.max(...values);
  let s = 0.5, L = 0, H = 0;
  for (s of [0.5, 1, 2, 2.5, 4, 5, 10, 20, 25, 50]) {
    L = Math.floor((lo0 - 0.15 * s) / s) * s; H = L + 4 * s;
    if (H >= hi0 + 0.15 * s) break;
  }
  const span = H - L;
  let yMin, yMax;
  if (span / 1.24 * 0.12 >= 0.5) { const R = span / 1.24, pad = 0.12 * R; yMin = L + pad; yMax = H - pad; }
  else { yMin = L + 0.5; yMax = H - 0.5; }
  return { yMin, yMax, yFmt: (v) => (Math.abs(v - Math.round(v)) < 0.01 ? String(Math.round(v)) : v.toFixed(1)) };
}

function drawWeightChart(root) {
  const box = root.querySelector('.pg-wchart');
  if (!box) return;
  const m = weightModel();
  const proj = projection(m);
  const series = [];
  if (proj) {
    series.push({ points: proj.upper, color: 'var(--m-walk-ink)', width: 1.2, opacity: 0.5 });
    series.push({ points: proj.lower, color: 'var(--m-walk-ink)', width: 1.2, opacity: 0.5 });
    if (proj.center) series.push({ points: proj.center, color: 'var(--m-walk-ink)', width: 2, dash: '5 5' });
  }
  const raw = m.tr.map((p) => ({ t: p.t, v: toWeight(p.kg) }));
  if (!raw.length && m.st.kg && m.st.d) raw.push({ t: parseYmd(m.st.d).getTime(), v: toWeight(m.st.kg) });
  series.push({ points: raw, color: 'var(--ink-3)', line: false, dots: true, dotR: 3.2, dotOpacity: 0.6 });
  if (m.ts.ready) series.push({ points: m.tr.map((p) => ({ t: p.t, v: toWeight(p.trend) })), color: 'var(--ink)', width: 2.6 });
  const last = m.ts.ready ? m.tr[m.tr.length - 1] : null;
  const label = `Weight chart: ${m.ws.length} weigh-ins${m.ts.ready ? `, trend ${wTxt(m.ts.current)}` : ''}${m.goal ? `, goal ${wTxt(m.goal)}` : ''}${proj ? '. The shaded band is a projection, not a promise' : ''}.`;
  const hlines = m.goal ? [{ v: toWeight(m.goal), label: `Goal ${wNum(m.goal)}`, color: 'var(--ink-2)', dash: '6 5' }] : [];
  const ys = [...series.flatMap((x) => x.points.map((p) => p.v)), ...hlines.map((h) => h.v)];
  if (!ys.length) return;
  const ny = niceY(ys);
  const CH = 220;
  box.innerHTML = lineChart({
    series,
    band: proj ? { upper: proj.upper, lower: proj.lower, color: 'var(--m-walk)' } : null,
    hlines,
    w: Math.max(260, box.clientWidth || 320), h: CH,
    yMin: ny.yMin, yMax: ny.yMax, yFmt: ny.yFmt, xFmt: (t) => dateShort(t),
    marker: last ? { t: last.t, v: toWeight(last.trend), color: 'var(--ink)' } : null,
    label,
  });
  // The projection runs down to the goal line, so its label goes under the line (when there's room above the x axis).
  if (proj && hlines.length && m.current > m.goal) {
    const t = [...box.querySelectorAll('svg text')].find((x) => x.textContent === hlines[0].label);
    const y = t ? +t.getAttribute('y') + 5 : NaN; // lineChart draws the label 5 px above the line
    if (Number.isFinite(y) && y + 16 <= CH - 22) t.setAttribute('y', String(y + 15));
  }
}

function renderWeight(root) {
  prepHealth();
  root.classList.add('pg', 'pg-push');
  const p = state.main.profile;
  let action = '', body;
  if (noNumbers()) {
    body = `<div class="empty">${emptyArt()}<p class="title-m">Weight numbers are off</p><p>You chose to train without calorie and weight numbers. Minutes, distance and climb still show your progress.</p>${has('go') ? '<a class="btn" href="#me-goal">Change this in Me</a>' : ''}</div>`;
  } else if (weightHidden()) {
    body = `<div class="empty"><span class="pg-empty-ico">${icon('eyeOff')}</span><p class="title-m">Weight is hidden</p><p>Your weigh-ins are saved but not shown. Showing them lasts until you close the app.</p><div class="btn-row pg-empty-btns"><button type="button" class="btn" data-act="reveal">Show weight</button><button type="button" class="btn btn-primary" data-act="log-weight">${icon('plus')}Log weight</button></div></div>
      <div class="group"><label class="row pg-switchrow" for="pg-hidew"><span class="row-main"><span class="row-title">Hide weight figures</span><span class="row-sub">Turn off to show your weight everywhere again.</span></span>${switchHtml('pg-hidew', true, 'Hide weight figures')}</label></div>`;
  } else {
    if (p.hideWeight && reveal) action = '<button type="button" class="btn-text pg-navbtn" data-act="conceal">Hide</button>';
    body = weightBody();
  }
  root.innerHTML = nav('Weight', action) + '<h1 class="title-l pg-push-title">Weight</h1>' + body;
  drawWeightChart(root);
  wireCommon(root);
  const sw = root.querySelector('#pg-hidew');
  if (sw) {
    sw.addEventListener('change', () => {
      const on = sw.checked;
      sw.blur(); // the shell skips re-rendering while an input has focus
      reveal = false;
      store.update((m) => { m.profile.hideWeight = on; });
      toast(on ? 'Weight figures hidden' : 'Weight figures shown');
    });
  }
  return watchScroll(root.querySelector('.nav-bar'));
}

async function syncFromHealth(btn) {
  if (btn) btn.setAttribute('aria-busy', 'true');
  dropStoredHealthCopies();
  const added = await readHealthWeights();
  if (btn) btn.removeAttribute('aria-busy');
  if (!healthRead) healthRead = Promise.resolve(); // counts as this run's start-up read
  if (!added) { toast('No new weigh-ins in Apple Health'); return; }
  stampHealthBadges();
  actions.refresh();
  haptic('success');
  toast(`Showing ${added} ${plural(added, 'weigh-in')} from Apple Health`);
}

/* =====================================================================
   #records
   ===================================================================== */

function renderRecords(root) {
  prepHealth();
  root.classList.add('pg', 'pg-push');
  const t = totals();
  const ns = nextSummit(t.elev);
  const cat = badgeCatalogue();
  const st = weekStreak();
  const pct = ns.next ? clamp(t.elev / ns.next.m, 0, 1) : 1;

  const hero = `
  <section class="hero-card pg-shero" aria-labelledby="pg-sh-title">
    ${topo({ seed: 5, lines: 16, cx: 0.86, cy: 0.12 })}
    <h2 class="eyebrow pg-hero-eyebrow" id="pg-sh-title">Total climb</h2>
    <p class="pg-sh-big"><span class="display-num num">${esc(fmtInt(toElev(t.elev)))}</span><small>${esc(elevUnit())}</small></p>
    <p class="pg-sh-sub">${!ns.next ? 'Higher than Everest. Every metre from here is a bonus.' : t.elev < 1 ? `Every workout adds height. First stop: <b>${esc(ns.next.name)}</b> at ${esc(elevTxt(ns.next.m))}.` : `${esc(elevTxt(ns.next.m - t.elev))} to go to <b>${esc(ns.next.name)}</b> at ${esc(elevTxt(ns.next.m))}.`}</p>
    <div class="pbar pg-sh-bar" role="progressbar" aria-label="Climb toward ${esc(ns.next ? ns.next.name : 'Everest')}" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(pct * 100)}"><i style="width:${(pct * 100).toFixed(1)}%"></i></div>
    <p class="pg-sh-meta num">${t.count} ${plural(t.count, 'workout')} · ${esc(distTxt(t.km, 1))} · ${esc(duration(t.sec))}</p>
  </section>`;

  const climbBadges = new Map(cat.filter((a) => a.group === 'Climbing').map((a) => [a.id, a]));
  const ladder = `
  <section class="section" aria-labelledby="pg-ladder-title">
    <div class="section-head"><h2 class="section-title" id="pg-ladder-title">Summit ladder</h2><span class="pg-count">${SUMMITS.filter((s) => t.elev >= s.m).length} of ${SUMMITS.length} reached</span></div>
    <div class="group pg-ladder">${SUMMITS.map((s, i) => {
      const a = climbBadges.get('climb' + i);
      const done = t.elev >= s.m || (a && a.unlocked);
      const isNext = ns.next && ns.next.m === s.m;
      const sub = done ? (a && a.date ? `Reached ${dateShort(a.date)}` : 'Reached') : isNext ? `${fmtInt(toElev(t.elev))} of ${elevTxt(s.m)}` : 'Keep climbing';
      return `<div class="row has-icon pg-lrow${done ? ' done' : ''}${isNext ? ' next' : ''}">
        <span class="row-icon">${icon(done ? 'check' : isNext ? 'mountain' : 'lock')}</span>
        <span class="row-main"><span class="row-title">${esc(s.name)}</span><span class="row-sub">${esc(sub)}</span>${isNext ? `<span class="pbar pg-lbar" aria-hidden="true"><i style="width:${(pct * 100).toFixed(1)}%"></i></span>` : ''}</span>
        <span class="row-value num">${esc(elevTxt(s.m))}</span></div>`;
    }).join('')}</div>
  </section>`;

  const thisWeek = between(startOfWeek(new Date()), addDays(startOfDay(new Date()), 1)).length;
  const left = Math.max(0, st.target - thisWeek);
  const streakLine = st.thisWeekMet ? `This week counts: ${thisWeek} ${plural(thisWeek, 'session')} done.` : `${left} more ${plural(left, 'session')} this week ${st.weeks ? 'keeps it going' : 'starts a streak'}.`;
  const streak = `
  <section class="section" aria-labelledby="pg-streak-title">
    <h2 class="section-title" id="pg-streak-title">Weekly streak</h2>
    <div class="card pg-streak">
      <span class="pg-streak-ico">${icon('flame')}</span>
      <div class="pg-streak-main">
        <p class="pg-streak-big"><span class="display-num num">${st.weeks}</span><small>${plural(st.weeks, 'week')} in a row</small></p>
        <p class="body-s">Weeks with at least ${st.target} sessions. ${esc(streakLine)}</p>
      </div>
    </div>
  </section>`;

  const r = records();
  const pbDefs = [
    { k: 'durationSec', title: 'Longest workout', icon: 'clock', val: (s) => duration(s.durationSec) },
    { k: 'distanceKm', title: 'Farthest', icon: 'route', val: (s) => distTxt(s.distanceKm) },
    { k: 'elevM', title: 'Most climb', icon: 'mountain', val: (s) => elevTxt(s.elevM) },
    ...(noNumbers() ? [] : [{ k: 'kcal', title: 'Most energy (estimate)', icon: 'bolt', val: (s) => kcalTxt(s.kcal) }]),
  ];
  const pbRows = pbDefs.filter((d) => r[d.k] && +r[d.k][d.k] > 0).map((d) => {
    const s = r[d.k];
    return row({ title: d.title, sub: `${dateShort(s.date)} · ${s.name || 'Workout'}`, value: d.val(s), iconName: d.icon, attrs: `data-session="${esc(s.id)}"` });
  }).join('');
  const bests = `
  <section class="section" aria-labelledby="pg-pb-title">
    <h2 class="section-title" id="pg-pb-title">Personal bests</h2>
    <div class="group">${pbRows || '<p class="pg-none">Your bests appear after your first workout: longest, farthest and most climb.</p>'}</div>
  </section>`;

  const vis = cat.filter(visibleBadge);
  const grid = vis.filter((a) => a.group !== 'Climbing');
  const groups = [...new Set(grid.map((a) => a.group))];
  const badges = `
  <section class="section" aria-labelledby="pg-badges-title">
    <div class="section-head"><h2 class="section-title" id="pg-badges-title">Badges</h2><span class="pg-count">${vis.filter((a) => a.unlocked).length} of ${vis.length} earned</span></div>
    ${groups.map((g) => `<div class="pg-bgroup"><h3 class="pg-bgroup-title">${esc(g)}</h3><div class="pg-bgrid">${grid.filter((a) => a.group === g).map((a) => `
      <div class="pg-badge${a.unlocked ? ' on' : ''}">
        ${badgeIcon(a)}
        <span class="pg-badge-title">${esc(a.title)}</span>
        <span class="pg-badge-desc">${esc(a.desc)}</span>
        ${a.unlocked
          ? `<span class="pg-badge-prog done">${icon('check')}${a.date ? `Earned ${esc(dateShort(a.date))}` : 'Earned'}</span>`
          : `<span class="pbar pg-badge-bar" aria-hidden="true"><i style="width:${(a.progress * 100).toFixed(1)}%"></i></span><span class="pg-badge-prog">${esc(badgeProgressText(a, t, st))}</span>`}
      </div>`).join('')}</div></div>`).join('')}
    <p class="pg-foot">Climbing badges are the summits above.${noNumbers() ? '' : ' Energy badges use estimated active kcal.'}</p>
  </section>`;

  root.innerHTML = nav('Records & badges') + '<h1 class="title-l pg-push-title">Records &amp; badges</h1>' + hero + streak + bests + ladder + badges;
  wireCommon(root);
  return watchScroll(root.querySelector('.nav-bar'));
}

/* ---------------- shared screen events ---------------- */

function wireCommon(root) {
  root.addEventListener('click', (e) => {
    const sess = e.target.closest('[data-session]');
    if (sess && root.contains(sess)) { actions.openSession(sess.dataset.session); return; }
    const wd = e.target.closest('[data-wday]');
    if (wd && root.contains(wd)) { openWeightSheet(wd.dataset.wday); return; }
    const b = e.target.closest('[data-act]');
    if (!b || !root.contains(b)) return;
    switch (b.dataset.act) {
      case 'log-weight': actions.logWeight(); break;
      case 'log-session': actions.logManualSession(); break;
      case 'how': actions.openHowWeCalculate(); break;
      case 'reveal': reveal = true; haptic('selection'); actions.refresh(); break;
      case 'conceal': reveal = false; haptic('selection'); actions.refresh(); break;
      case 'all-entries': showAllEntries = true; actions.refresh(); break;
      case 'health-sync': syncFromHealth(b); break;
      default: break;
    }
  });
}

/* =====================================================================
   Sheet: log or edit a weigh-in
   ===================================================================== */

function openWeightSheet(editDay = null) {
  const hidden = weightHidden() || noNumbers();
  const todayKey = ymd();
  const ws = weightsAsc();
  const editing = editDay ? ws.find((w) => w.d === editDay) || null : null;
  const u = weightUnit();
  const latest = ws.length ? ws[ws.length - 1].kg : state.main.profile.startWeight || null;
  const sameDay = ws.find((w) => w.d === todayKey);
  const initKg = editing ? editing.kg : sameDay ? sameDay.kg : latest;
  const initTxt = hidden && !editing ? '' : initKg ? wNum(initKg) : '';
  const lo = toWeight(30), hi = toWeight(300);
  const body = `
    <div class="field"><label for="pg-wdate">Date</label><input class="input" type="date" id="pg-wdate" value="${esc(editing ? editing.d : todayKey)}" max="${todayKey}" required></div>
    <div class="field">
      <label for="pg-wval">Weight in ${weightUnitLong()}</label>
      <div class="stepper pg-wstep">
        <button type="button" data-step="-1" aria-label="0.1 ${u} less">${icon('minus')}</button>
        <span class="pg-wstep-mid"><input class="pg-wstep-input num" id="pg-wval" type="text" inputmode="decimal" enterkeyhint="done" autocomplete="off" spellcheck="false" placeholder="${isLb() ? '000.0' : '00.0'}" value="${esc(initTxt)}" aria-describedby="pg-wnote"><span class="pg-wstep-unit" aria-hidden="true">${u}</span></span>
        <button type="button" data-step="1" aria-label="0.1 ${u} more">${icon('plus')}</button>
      </div>
      <p class="hint pg-wnote" id="pg-wnote" aria-live="polite"></p>
    </div>
    <p class="body-xs">Weigh in at the same time of day, ideally in the morning before breakfast. Day-to-day swings are normal; your trend smooths them out.</p>`;
  const footer = `${editing ? '<button type="button" class="btn btn-danger" data-act="w-del">Delete</button>' : ''}<button type="button" class="btn btn-primary" data-act="w-save">Save weight</button>`;
  const sh = sheet(body, { title: editing ? 'Edit weigh-in' : 'Log weight', footer });
  const el = sh.el;
  el.classList.add('pg-sheet');
  const dateInp = el.querySelector('#pg-wdate'), inp = el.querySelector('#pg-wval'), note = el.querySelector('#pg-wnote');

  const setNote = (txt, err = false) => { note.textContent = txt; note.classList.toggle('err', err); note.setAttribute('role', err ? 'alert' : 'status'); };
  const dayNote = () => {
    const d = dateInp.value;
    const other = weightsAsc().find((w) => w.d === d && (!editing || w.d !== editing.d));
    if (other) setNote(hidden ? 'You already logged a weight on this day. Saving replaces it.' : `You already logged ${wTxt(other.kg)} on this day. Saving replaces it.`);
    else setNote('');
  };
  dayNote();
  dateInp.addEventListener('change', dayNote);
  dateInp.addEventListener('input', dayNote);

  const parse = () => parseFloat(String(inp.value).replace(',', '.').trim());
  const step = (dir) => {
    let v = parse();
    if (!Number.isFinite(v)) {
      if (hidden) { setNote('Type your weight first, then fine-tune it with − and +.'); return; }
      v = toWeight(latest || (isLb() ? 75 : 75));
    }
    v = clamp(Math.round((v + dir * 0.1) * 10) / 10, lo, hi);
    inp.value = v.toFixed(1);
    haptic('selection');
  };
  let holdT = null, holdI = null;
  const stopHold = () => { clearTimeout(holdT); clearInterval(holdI); holdT = holdI = null; };
  el.querySelectorAll('[data-step]').forEach((b) => {
    const dir = +b.dataset.step;
    b.addEventListener('pointerdown', (e) => { if (e.button > 0) return; step(dir); stopHold(); holdT = setTimeout(() => { holdI = setInterval(() => step(dir), 90); }, 450); });
    ['pointerup', 'pointerleave', 'pointercancel'].forEach((ev) => b.addEventListener(ev, stopHold));
    b.addEventListener('click', (e) => { if (e.detail === 0) step(dir); }); // keyboard activation
  });
  inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); save(); } });

  let saved = false; // ignore a second tap while the sheet closes
  function save() {
    if (saved) return;
    const d = dateInp.value;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d) || d > todayKey) { setNote('Choose today or an earlier date.', true); dateInp.focus(); return; }
    const v = parse();
    const kg = fromWeight(v);
    if (!Number.isFinite(v) || !(kg >= 29.95 && kg <= 300.05)) { setNote(`Enter a weight between ${fmtInt(lo)} and ${fmtInt(hi)} ${u}.`, true); inp.focus(); return; }
    const kgR = Math.round(clamp(kg, 30, 300) * 100) / 100;
    saved = true;
    el.querySelectorAll('[data-act="w-save"], [data-act="w-del"]').forEach((x) => { x.disabled = true; });
    const isNewDay = !weightsAsc().some((w) => w.d === d); // includes Health weigh-ins, so they aren't written back
    const before = unlockedIds();
    store.update((m) => {
      m.weights = m.weights.filter((w) => w.d !== d && !(editing && w.d === editing.d));
      m.weights.push({ d, kg: kgR });
      m.weights.sort((a, b) => (a.d < b.d ? -1 : a.d > b.d ? 1 : 0));
    }, { silent: true });
    const badge = stampNew(before)[0];
    if (isNewDay) healthSaveWeight(kgR, d);
    haptic('success');
    toast(badge ? `Weight saved. New badge: ${badge.title}` : 'Weight saved');
    sh.close();
  }

  el.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-act]');
    if (!b) return;
    if (b.dataset.act === 'w-save') save();
    if (b.dataset.act === 'w-del' && editing) {
      const ok = await confirmSheet({
        title: 'Delete this weigh-in?',
        body: `${esc(dateLong(parseYmd(editing.d)))}: <b>${esc(wTxt(editing.kg))}</b>. ${editing.source === 'health' ? 'This hides it until Hillpace next reads Apple Health. To remove it for good, delete it in the Health app.' : 'This can’t be undone.'}`,
        confirm: 'Delete', danger: true,
      });
      if (!ok) return;
      if (editing.source === 'health') { healthWs.delete(editing.d); actions.refresh(); }
      else store.update((m) => { m.weights = m.weights.filter((w) => w.d !== editing.d); });
      toast('Weigh-in deleted');
      sh.close();
    }
  });
}

/* =====================================================================
   Sheet: session detail
   ===================================================================== */

function sessionSegs(s) {
  return (s.splits || []).filter((x) => x && x.sec > 0).map((x) => ({ type: MODES[x.type] ? x.type : 'walk', dur: x.sec, incline: x.incline || 0, speed: x.speed > 0 ? x.speed : undefined, label: x.label || '' }));
}

function healthStatusHtml(s) {
  if (!features.health) return '';
  const h = state.main.profile.health;
  let title, sub, btn = '', ico = 'heart';
  if (s.source === 'manual') { title = 'Kept in Hillpace only'; sub = 'Logged sessions aren’t saved to Apple Health, so nothing is counted twice.'; }
  else if (s.healthUUID) { title = 'Saved to Apple Health'; sub = h.watch ? 'Saved without energy and distance, because your Apple Watch records those.' : surfaceOf(s) === 'outdoor' ? 'Saved as a walking workout.' : 'Saved as an indoor workout.'; ico = 'checkCircle'; }
  else if (!h.enabled) { title = 'Apple Health is off'; sub = 'Turn it on in Me to save workouts.'; }
  else if ((s.durationSec || 0) < 60) { title = 'Not saved to Apple Health'; sub = 'Workouts under a minute aren’t saved.'; }
  else { title = 'Not in Apple Health'; sub = 'Save this workout to Apple Health.'; btn = '<button type="button" class="btn btn-sm" data-act="s-health">Save</button>'; }
  return `<div class="group pg-ss-health"><div class="row has-icon" role="status"><span class="row-icon">${icon(ico)}</span><span class="row-main"><span class="row-title">${esc(title)}</span><span class="row-sub">${esc(sub)}</span></span>${btn}</div></div>`;
}

const MANUAL_TYPES = { walk: 'Walk', mix: 'Walk and jog', jog: 'Jog' };

function sessionSheetHtml(s) {
  const d = new Date(s.date);
  const manual = s.source === 'manual';
  const chips = sessionChips(s);
  const surf = surfaceOf(s);
  const approx = distEstimated(s) ? '≈' : '';
  const hours = (s.durationSec || 0) / 3600;
  const avgKmh = hours > 0 ? (s.distanceKm || 0) / hours : 0;
  // No incline (flat treadmill or outdoors) and no climb: average speed says more than "0 m". Outdoors, until it is
  // matched to a watch, that speed only echoes the usual paces, so the minutes of hard effort show instead.
  const sp = s.splits || [];
  const effMin = (types) => Math.round(sp.filter((x) => types.includes(x.type)).reduce((a, x) => a + (x.sec || 0), 0) / 60);
  const hardMin = effMin(['power', 'jog', 'run']);
  const third = distEstimated(s) && sp.length
    ? (hardMin > 0 ? ['Hard effort', String(hardMin), 'min'] : ['Brisk or harder', String(effMin(['brisk', 'power', 'jog', 'run'])), 'min'])
    : surf && surf !== 'incline' && !(s.elevM > 0) && avgKmh > 0
      ? ['Avg speed', `${approx}${fmt1(toSpeed(avgKmh))}`, speedUnit()]
      : ['Climb', fmtInt(toElev(s.elevM || 0)), elevUnit()];
  const stats = [
    ['Time', String(minOf(s.durationSec)), 'min'],
    ['Distance', `${approx}${fmt2(toDist(s.distanceKm || 0))}`, distUnit()],
    third,
    ...(noNumbers() ? [] : [['Energy', `≈${fmtInt(roundKcal(s.kcal))}`, 'kcal']]),
  ];
  const segs = sessionSegs(s);
  let profile = '';
  if (segs.length) {
    const types = ['walk', 'brisk', 'power', 'jog', 'run'].filter((t) => segs.some((x) => x.type === t));
    const where = surf || 'incline';
    const free = s.workoutId === FREE_WALK_ID; // Just walk names its hardest pace "Hard walking", as the player did
    profile = `<div class="card tight pg-ss-chart">${surfaceChart(segs, where, { h: 104, label: chartLabel(s.name || 'Workout', where) })}
      <div class="legend">${types.map((t) => `<span class="mode-${t}"><i class="mode-dot" aria-hidden="true"></i>${esc(free && t === 'power' ? effortFor('power').feel : MODES[t].name)}</span>`).join('')}${where === 'incline' ? '<span><i class="ln" aria-hidden="true"></i>Incline</span>' : ''}</div></div>`;
  } else {
    const hours = (s.durationSec || 0) / 3600;
    const kmh = hours > 0 ? (s.distanceKm || 0) / hours : 0;
    const items = [
      manual ? ['Type', MANUAL_TYPES[s.manualType] || 'Walk'] : null,
      kmh > 0 ? ['Average speed', `${fmt1(toSpeed(kmh))} ${speedUnit()}`] : null,
      s.avgIncline != null ? ['Average incline', `${fmt1(s.avgIncline)}%`] : null,
    ].filter(Boolean);
    if (items.length) profile = `<div class="group">${items.map((x) => `<div class="row"><span class="row-main"><span class="row-title">${esc(x[0])}</span></span><span class="row-value num">${esc(x[1])}</span></div>`).join('')}</div>`;
  }
  const estNote = noNumbers()
    ? approx ? 'Outdoors, distance is estimated from your usual walking paces.' : ''
    : `${approx ? 'Outdoors, distance is estimated from your usual walking paces. ' : ''}Energy is an estimate of active calories, not a measurement.`;
  return `
    <p class="pg-ss-when">${esc(dateLong(d))}${manual ? '' : ` · ${esc(timeTxt(d))}`}</p>
    ${chips ? `<div class="pg-chips">${chips}</div>` : ''}
    <div class="card tight"><div class="stat-grid pg-2x2" style="--cols:2">${stats.map((x) => `<div><span class="stat-label">${x[0]}</span><span class="stat-value num">${esc(x[1])}<small>${esc(x[2])}</small></span></div>`).join('')}</div>
    ${estNote ? `<p class="body-xs pg-ss-est">${esc(estNote)}</p>` : ''}</div>
    ${profile}
    <div class="field"><span class="label" id="pg-ss-eff">Effort</span>${rpeGrid(s.rpe || null)}<p class="hint pg-rpe-line" aria-live="polite">${esc(effortLine(s.rpe))}</p></div>
    <div class="field"><label for="pg-ss-notes">Notes</label><textarea class="input" id="pg-ss-notes" maxlength="600" placeholder="How did it feel? Anything to remember next time?">${esc(s.notes || '')}</textarea></div>
    <div class="pg-ss-health-wrap">${healthStatusHtml(s)}</div>
    ${s.source !== 'manual' && has('openSummary') ? `<div class="group"><button type="button" class="row has-icon" data-act="s-summary"><span class="row-icon">${icon('sparkline')}</span><span class="row-main"><span class="row-title">View full summary</span><span class="row-sub">${s.workoutId === FREE_WALK_ID ? 'Your paces, effort and sharing' : 'Every interval, plan position and sharing'}</span></span>${icon('chevR', 'chev')}</button></div>` : ''}
    <button type="button" class="btn btn-danger btn-block" data-act="s-del">${icon('trash')}Delete workout</button>`;
}

actions.openSession = (id) => {
  const s0 = getS(id);
  if (!s0) { toast('That workout couldn’t be found'); return; }
  let notesT = null;
  const flushNotes = () => {
    clearTimeout(notesT); notesT = null;
    const ta = sh && sh.el.querySelector('#pg-ss-notes');
    const s = getS(id);
    if (ta && s && (s.notes || '') !== ta.value) store.updateSession(id, { notes: ta.value });
  };
  const footer = '<button type="button" class="btn btn-primary" data-close>Done</button>';
  const sh = sheet(sessionSheetHtml(s0), { title: s0.name || 'Workout', footer, onClose: () => flushNotes() });
  const el = sh.el;
  el.classList.add('pg-sheet');
  const ta = el.querySelector('#pg-ss-notes');
  ta.addEventListener('input', () => { clearTimeout(notesT); notesT = setTimeout(flushNotes, 600); });
  ta.addEventListener('blur', flushNotes);

  el.addEventListener('click', async (e) => {
    const r = e.target.closest('[data-rpe]');
    if (r) {
      const n = +r.dataset.rpe;
      store.updateSession(id, { rpe: n });
      haptic('selection');
      el.querySelectorAll('[data-rpe]').forEach((b) => b.setAttribute('aria-pressed', String(+b.dataset.rpe === n)));
      el.querySelector('.pg-rpe-line').textContent = effortLine(n);
      return;
    }
    const b = e.target.closest('[data-act]');
    if (!b) return;
    if (b.dataset.act === 's-summary') { flushNotes(); sh.close(); actions.openSummary(id, { fresh: false }); }
    if (b.dataset.act === 's-health') {
      b.disabled = true; b.textContent = 'Saving…';
      const uuid = await healthSaveWorkout(getS(id));
      if (uuid) { store.updateSession(id, { healthUUID: uuid }); haptic('success'); toast('Saved to Apple Health'); }
      else toast('Couldn’t save to Apple Health. Check Hillpace’s access in the Health app.');
      const s = getS(id);
      const wrap = el.querySelector('.pg-ss-health-wrap');
      if (s && wrap) wrap.innerHTML = healthStatusHtml(s);
    }
    if (b.dataset.act === 's-del') {
      const s = getS(id);
      if (!s) { sh.close(); return; }
      const ok = await confirmSheet({
        title: 'Delete this workout?',
        body: `<b>${esc(s.name || 'Workout')}</b> on ${esc(dateLong(s.date))} will be removed from your history, totals${s.planSlot ? ' and plan progress' : ''}. This can’t be undone.${s.healthUUID ? ' The copy in Apple Health stays; you can delete it in the Health app.' : ''}`,
        confirm: 'Delete workout', danger: true,
      });
      if (!ok) return;
      clearTimeout(notesT); notesT = null;
      store.deleteSession(id);
      sh.close();
      toast('Workout deleted');
    }
  });
};

/* =====================================================================
   Sheet: log a session done without the app
   ===================================================================== */

/** Hint under the manual-entry numbers, by where the walk happened. */
const MANUAL_HINT = {
  incline: 'Use the average incline for the whole session.',
  flat: 'Use the time and distance on your treadmill or walking pad.',
  outdoor: 'If a watch or phone app tracked it, use its time and distance.',
};

actions.logManualSession = () => {
  const p = state.main.profile;
  const todayKey = ymd();
  // walking-only: nothing to choose, it was a walk
  let type = 'walk', rpe = null, distTouched = false, surface = activeSurface();
  const inclineOn = () => surface === 'incline';
  const speedFor = (t) => (t === 'jog' ? p.paces.jog : t === 'mix' ? (p.paces.power + p.paces.jog) / 2 : p.paces.brisk) || 5;
  const suggestDist = (min) => toDist((speedFor(type) * min) / 60);
  const body = `
    <div class="field"><label for="pg-mdate">Date</label><input class="input" type="date" id="pg-mdate" value="${todayKey}" max="${todayKey}" required></div>
    <div class="field"><span class="label" id="pg-mwhere">Where</span>${surfacePicker('msurf', surface, { label: 'Where you walked' })}</div>
    ${p.walkOnly ? '' : `<div class="field"><span class="label">Workout</span>${segmented('mtype', Object.entries(MANUAL_TYPES).map(([value, label]) => ({ value, label })), type, { block: true, label: 'Workout type' })}</div>`}
    <div class="pg-mgrid${inclineOn() ? '' : ' pg-mgrid-2'}">
      <div class="field"><label for="pg-mmin">Duration</label><div class="input-unit"><input class="input num" id="pg-mmin" type="text" inputmode="numeric" autocomplete="off" value="30"><span class="unit">min</span></div></div>
      <div class="field"><label for="pg-mdist">Distance</label><div class="input-unit"><input class="input num" id="pg-mdist" type="text" inputmode="decimal" autocomplete="off" value="${fmt2(suggestDist(30))}"><span class="unit">${distUnit()}</span></div></div>
      <div class="field pg-minc-field"${inclineOn() ? '' : ' hidden'}><label for="pg-minc">Incline</label><div class="input-unit"><input class="input num" id="pg-minc" type="text" inputmode="decimal" autocomplete="off" value="3"><span class="unit">%</span></div></div>
    </div>
    <p class="pg-mhint">${esc(MANUAL_HINT[surface])}</p>
    <p class="pg-mest" aria-live="polite"></p>
    <div class="field"><span class="label">Effort <span class="faint">(optional)</span></span>${rpeGrid(null)}<p class="hint pg-rpe-line" aria-live="polite">${esc(effortLine(null))}</p></div>
    <div class="field"><label for="pg-mnotes">Notes <span class="faint">(optional)</span></label><textarea class="input" id="pg-mnotes" maxlength="600" placeholder="Where you went, how it felt"></textarea></div>
    <p class="body-xs">Logged sessions count toward your weekly minutes, streak and totals. They don’t complete plan sessions.</p>
    <p class="hint pg-merr" role="alert"></p>`;
  const sh = sheet(body, { title: 'Log a session', footer: '<button type="button" class="btn" data-close>Cancel</button><button type="button" class="btn btn-primary" data-act="m-save">Save session</button>' });
  const el = sh.el;
  el.classList.add('pg-sheet');
  const $ = (s) => el.querySelector(s);
  const num = (sel) => parseFloat(String($(sel).value).replace(',', '.').trim());
  const errEl = $('.pg-merr');

  function calc() {
    const min = num('#pg-mmin'), dist = num('#pg-mdist'), inc = inclineOn() ? num('#pg-minc') : 0;
    if (!(min > 0) || !(dist > 0) || !Number.isFinite(inc)) return null;
    const km = fromDist(dist), kmh = km / (min / 60), incl = clamp(inc, 0, 30);
    const kg = withHealth(bodyKg), hf = surface === 'outdoor' || p.treadmill.handsFree !== false; // no rails outdoors
    const per = type === 'mix' ? (activeKcalPerMin(kmh, incl, kg, 'walk', hf) + activeKcalPerMin(kmh, incl, kg, 'jog', hf)) / 2 : activeKcalPerMin(kmh, incl, kg, type === 'jog' ? 'jog' : 'walk', hf);
    const met = type === 'mix' ? (mets(kmh, incl, 'walk', hf) + mets(kmh, incl, 'jog', hf)) / 2 : mets(kmh, incl, type === 'jog' ? 'jog' : 'walk', hf);
    return { min, km, kmh, incl, kcal: per * min, elev: (km * 1000 * incl) / 100, met };
  }
  function updateEstimate() {
    const c = calc();
    const box = $('.pg-mest');
    if (!c) { box.textContent = inclineOn() ? 'Enter duration, distance and incline to see the estimate.' : 'Enter duration and distance to see the estimate.'; return; }
    const meta = `${inclineOn() ? `${elevTxt(c.elev)} climb · ` : ''}${fmt1(toSpeed(c.kmh))}${NB}${speedUnit()} average`;
    box.innerHTML = noNumbers()
      ? `<span class="pg-mest-main">${esc(meta)}</span>`
      : `<span class="pg-mest-main">${esc(kcalTxt(c.kcal))} <span class="pg-mest-tag">estimate</span></span><span class="pg-mest-meta">${esc(meta)}</span>`;
  }
  updateEstimate();

  bindSegmented(el, (name, value) => {
    if (name === 'msurf') {
      surface = value;
      $('.pg-minc-field').hidden = !inclineOn();
      $('.pg-mgrid').classList.toggle('pg-mgrid-2', !inclineOn());
      $('.pg-mhint').textContent = MANUAL_HINT[surface];
      updateEstimate();
      return;
    }
    if (name !== 'mtype') return;
    type = value;
    const min = num('#pg-mmin');
    if (!distTouched && min > 0) $('#pg-mdist').value = fmt2(suggestDist(min));
    updateEstimate();
  });
  $('#pg-mmin').addEventListener('input', () => { const min = num('#pg-mmin'); if (!distTouched && min > 0) $('#pg-mdist').value = fmt2(suggestDist(min)); updateEstimate(); });
  $('#pg-mdist').addEventListener('input', () => { distTouched = true; updateEstimate(); });
  $('#pg-minc').addEventListener('input', updateEstimate);

  el.addEventListener('click', (e) => {
    const r = e.target.closest('[data-rpe]');
    if (r) {
      const n = +r.dataset.rpe;
      rpe = rpe === n ? null : n;
      haptic('selection');
      el.querySelectorAll('[data-rpe]').forEach((b) => b.setAttribute('aria-pressed', String(+b.dataset.rpe === rpe)));
      $('.pg-rpe-line').textContent = effortLine(rpe);
      return;
    }
    const b = e.target.closest('[data-act="m-save"]');
    if (b) save();
  });

  function fail(msg, sel) { errEl.textContent = msg; if (sel) $(sel).focus(); }
  let saved = false; // a double tap must not log the session twice (the closing sheet stays tappable for ~200 ms)
  function save() {
    if (saved) return;
    const d = $('#pg-mdate').value;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d) || d > todayKey) return fail('Choose today or an earlier date.', '#pg-mdate');
    const min = num('#pg-mmin'), dist = num('#pg-mdist'), inc = inclineOn() ? num('#pg-minc') : 0;
    if (!(min >= 5 && min <= 300)) return fail('Enter a duration between 5 and 300 minutes.', '#pg-mmin');
    if (!(dist > 0)) return fail(`Enter the distance in ${distUnit() === 'mi' ? 'miles' : 'kilometres'}.`, '#pg-mdist');
    if (!(inc >= 0 && inc <= 30)) return fail('Enter an average incline between 0 and 30%.', '#pg-minc');
    const c = calc();
    if (!c || c.kmh < 1 || c.kmh > 25) return fail(`That works out to ${c ? fmt1(toSpeed(c.kmh)) : '–'} ${speedUnit()}. Check the duration and distance.`, '#pg-mdist');
    const sec = Math.round(min * 60);
    let start;
    if (d === todayKey) start = new Date(Date.now() - sec * 1000);
    else { start = parseYmd(d); start.setHours(12, 0, 0, 0); }
    const s = {
      id: store.uid('m'), date: start.toISOString(), endedAt: new Date(start.getTime() + sec * 1000).toISOString(),
      workoutId: null, name: MANUAL_TYPES[type], planSlot: null, level: null, length: Math.round(min), surface,
      durationSec: sec, plannedSec: sec, completion: 1, completed: true,
      distanceKm: Math.round(c.km * 1000) / 1000, kcal: Math.round(c.kcal), elevM: Math.round(c.elev), avgMETs: Math.round(c.met * 10) / 10,
      rpe, notes: $('#pg-mnotes').value.trim(), splits: [], nudgeKmh: 0, source: 'manual', healthUUID: null,
      manualType: type, avgIncline: inclineOn() ? Math.round(c.incl * 10) / 10 : null,
    };
    saved = true;
    el.querySelectorAll('[data-act="m-save"]').forEach((x) => { x.disabled = true; });
    const before = unlockedIds();
    store.addSession(s);
    const badge = stampNew(before)[0];
    haptic('success');
    toast(badge ? `Session logged. New badge: ${badge.title}` : 'Session logged');
    sh.close();
  }
};

actions.logWeight = () => openWeightSheet(null);

/* ---------------- screen definitions ---------------- */

const progress = { route: 'progress', tab: 'progress', title: 'Progress', render: renderProgress };
progress.routes = [
  progress,
  { route: 'history', tab: 'progress', title: 'History', render: renderHistory },
  { route: 'weight', tab: 'progress', title: 'Weight', render: renderWeight },
  { route: 'records', tab: 'progress', title: 'Records', render: renderRecords },
];
export default progress;
