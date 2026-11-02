// Onboarding: a full-screen overlay of short questions that builds the profile and the 12-week plan.
// Registers actions.openOnboarding({ edit, step }) and actions.closeOnboarding().
//
// Answers live in a draft object (never only in the DOM). A first-run draft is saved to localStorage so an
// interrupted setup resumes where it stopped. Nothing is written to the store until the final "Looks good".
// The plan reveal is computed by the same program/science code the app uses, run against a draft-applied copy
// of the state (see withDraft), so what the user sees here is exactly what Today and Plan will show.
import * as store from '../core/store.js';
import { state, DEFAULT_PROFILE } from '../core/store.js';
import * as sci from '../core/science.js';
import { PHASES, WEEKLY_TARGET, weekSlots, slotSegments, slotStatus, planStats, startPlanThisWeek, currentWeek, planStart, getWorkout, segmentsFor, setTrainingDays } from '../core/program.js';
import { ymd, parseYmd, addDays, startOfDay, daysBetween, isoDay, DAY_SHORT, esc, fmt1, fmtInt } from '../core/format.js';
import { features, requestHealth, requestNotifications, scheduleReminders, healthSaveWeight, haptic } from '../core/platform.js';
import { actions } from '../ui/actions.js';
import { icon, topo, toast, sheet, confirmSheet, switchHtml, RM } from '../ui/kit.js';
import { intervalChart, planMeter, lineChart } from '../ui/charts.js';
import { detachPlanSessions } from './plan.js';

const LB = sci.LB_PER_KG;
const MPH = sci.KMH_PER_MPH;
const DRAFT_KEY = 'hp.onb.draft';
const DAY_LONG = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const PRESET_DAYS = { 3: [1, 3, 5], 4: [1, 3, 5, 6], 5: [1, 2, 4, 5, 6], 6: [1, 2, 3, 4, 5, 6] };
const ORDER = ['welcome', 'goal', 'about', 'body', 'goalweight', 'pace', 'fitness', 'treadmill', 'schedule', 'readiness', 'reveal', 'permissions'];
const ACCEPT_TEXT = 'I understand Hillpace is not a medical device. I’ll check with a doctor before starting and before making medical decisions.';

const GOALS = [
  { value: 'lose', label: 'Lose weight', sub: 'Workouts plus a goal date range and a suggested daily intake', icon: 'trendDown' },
  { value: 'fitter', label: 'Get fitter', sub: 'More stamina for steeper hills and longer jogs', icon: 'pulse' },
  { value: 'habit', label: 'Build a walking habit', sub: 'Regular sessions that fit around your week', icon: 'repeat' },
  { value: 'hike', label: 'Train for a hike', sub: 'Climbing strength for trails and long days out', icon: 'mountain' },
];

/** Original readiness questions (written for Hillpace; not a standard questionnaire). me.js may import these. */
export const READINESS_QUESTIONS = [
  { id: 'heart', text: 'Has a doctor ever told you that you have a heart condition or high blood pressure?' },
  { id: 'chest', text: 'Do you feel pain or pressure in your chest at rest, in daily life, or when you exercise?' },
  { id: 'faint', text: 'In the past 12 months, have you fainted, or lost your balance because of dizziness?' },
  { id: 'condition', text: 'Do you have another long-term condition (for example diabetes, or lung or kidney disease)?' },
  { id: 'meds', text: 'Do you take prescription medicine for a long-term condition?' },
  { id: 'joints', text: 'Do you have a bone, joint, tendon or muscle problem that more activity could make worse?' },
  { id: 'supervised', text: 'Has a doctor said you should only exercise under medical supervision?' },
  { id: 'pregnant', text: 'Are you pregnant?' },
  { id: 'ill', text: 'Are you ill right now, or recovering from an illness or injury?' },
];

/* ---------------- module state ---------------- */

let ov = null; // overlay element
let d = null; // draft answers
let edit = false;
let cur = null; // current step id
let orig = ''; // JSON of the draft when opened (edit-mode dirty check)
let origFit = ''; // fitness answers when opened (re-seed paces only if they change)
let finishing = false;
let unsub = null;
let prevFocus = null;
let saveT = 0;
let lastNav = 0;
const cache = new Map();

/* ---------------- small helpers ---------------- */

const r1 = (x) => Math.round(x * 10) / 10;
const r2 = (x) => Math.round(x * 100) / 100;
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const numStr = (v, dec) => (v == null || Number.isNaN(v) ? '' : String(+(+v).toFixed(dec)));
function parseNum(s) {
  const t = String(s ?? '').trim().replace(',', '.');
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : NaN;
}
const DF = (o) => new Intl.DateTimeFormat(undefined, o);
const dateMed = (t) => DF({ day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(t));
const monthShort = (t) => DF({ month: 'short', year: 'numeric' }).format(new Date(t));
function dateRange(a, b) {
  const f = DF({ day: 'numeric', month: 'short', year: 'numeric' });
  try { if (typeof f.formatRange === 'function') return f.formatRange(new Date(a), new Date(b)); } catch { /* older engines */ }
  return `${f.format(new Date(a))} – ${f.format(new Date(b))}`;
}
function listJoin(items) {
  try { return new Intl.ListFormat(undefined, { style: 'long', type: 'conjunction' }).format(items); } catch { /* older engines */ }
  return items.length < 2 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}
const dayAt = (n) => startOfDay(addDays(new Date(), n)).getTime();

/* units: the draft has its own units until the profile is saved, so format.js can't be used for these */
const isLb = () => d.units.weight === 'lb';
const isMph = () => d.units.speed === 'mph';
const wDisp = (kg) => (isLb() ? kg * LB : kg);
const wFrom = (v) => (isLb() ? v / LB : v);
const wUnit = () => (isLb() ? 'lb' : 'kg');
const wStr = (kg) => fmt1(wDisp(kg));
const sDisp = (kmh) => (isMph() ? kmh / MPH : kmh);
const sFrom = (v) => (isMph() ? v * MPH : v);
const sUnit = () => (isMph() ? 'mph' : 'km/h');
const distStr = (km) => (isMph() ? `${fmt1(km / MPH)} mi` : `${fmt1(km)} km`);
const elevStr = (m) => (isMph() ? `${fmtInt(m * 3.28084)} ft` : `${fmtInt(m)} m`);
const paceNum = (kg) => (isLb() ? fmt1(kg * LB) : String(kg));
const paceStr = (kg) => `${paceNum(kg)} ${wUnit()}`;
const kcalStr = (k) => fmtInt(sci.roundKcal(k));

function localeUnits() {
  let lang = 'en-US';
  try { lang = (navigator.languages && navigator.languages[0]) || navigator.language || lang; } catch { /* ignore */ }
  const region = (String(lang).split(/[-_]/)[1] || '').toUpperCase();
  const imperial = ['US', 'LR', 'MM'].includes(region);
  return { speed: imperial ? 'mph' : 'kmh', weight: imperial ? 'lb' : 'kg', height: imperial || region === 'GB' ? 'ftin' : 'cm' };
}
const defaultMaxSpeed = (u) => (u === 'mph' ? 10 * MPH : 16);

/* ---------------- draft ---------------- */

function newDraft() {
  const units = localeUnits();
  return {
    v: 1, name: '', goal: null, sex: null, age: null, heightCm: null, weightKg: null, goalWeight: null,
    pace: 'steady', targetOn: false, targetDate: null,
    activity: null, canJog: null, hardExercise: null, noNumbers: false,
    units,
    treadmill: { hasIncline: true, maxIncline: 12, maxSpeed: defaultMaxSpeed(units.speed), handsFree: null },
    days: PRESET_DAYS[4].slice(), sessionLength: 45, reminderTime: '18:00',
    answers: {}, betaBlocker: null, achilles: null, accepted: false,
    perm: { health: null, notif: null },
  };
}

function latestWeight() {
  const w = (state.main.weights || []).filter((x) => x && x.kg > 0).sort((a, b) => (a.d < b.d ? -1 : a.d > b.d ? 1 : 0));
  return w.length ? w[w.length - 1].kg : state.main.profile.startWeight || null;
}

function draftFromState() {
  const p = state.main.profile, r = state.main.readiness, pl = state.main.plan;
  const lw = latestWeight();
  return {
    ...newDraft(),
    name: p.name || '', goal: p.goal || 'lose', sex: p.sex || null, age: p.age || null, heightCm: p.heightCm || null,
    weightKg: lw ? r2(lw) : null, goalWeight: p.goalWeight || null, pace: p.pace || 'steady',
    targetOn: !!p.targetDate, targetDate: p.targetDate || null,
    activity: p.activity || null, canJog: p.canJog || null, hardExercise: typeof p.hardExercise === 'boolean' ? p.hardExercise : null,
    noNumbers: !!p.noNumbers,
    units: { ...DEFAULT_PROFILE.units, ...p.units },
    treadmill: { ...DEFAULT_PROFILE.treadmill, ...p.treadmill },
    days: [...(pl.days && pl.days.length ? pl.days : PRESET_DAYS[4])].sort((a, b) => a - b),
    sessionLength: p.sessionLength || 45, reminderTime: (p.reminders && p.reminders.time) || '18:00',
    answers: { ...(r.answers || {}) },
    betaBlocker: r.answers && r.answers.meds ? !!r.betaBlocker : null,
    achilles: r.answers && r.answers.joints ? !!r.achilles : null,
    accepted: !!r.acceptedAt,
  };
}

function writeDraft() {
  clearTimeout(saveT);
  if (edit || !ov || !d) return;
  try {
    const { perm, hft, hin, ...rest } = d; // permissions are never resumed
    localStorage.setItem(DRAFT_KEY, JSON.stringify({ at: Date.now(), step: cur, d: rest }));
  } catch { /* storage blocked */ }
}
/** Save the first-run draft: immediately on step changes, debounced while typing. */
function saveDraft(now = false) {
  if (edit || !ov) return;
  clearTimeout(saveT);
  if (now) writeDraft();
  else saveT = setTimeout(writeDraft, 250);
}
function onHide() { if (document.visibilityState === 'hidden') writeDraft(); }
function loadDraft() {
  try {
    const x = JSON.parse(localStorage.getItem(DRAFT_KEY) || 'null');
    if (!x || !x.d || Date.now() - (x.at || 0) > 14 * 864e5) return null;
    const base = newDraft();
    return {
      step: x.step,
      d: { ...base, ...x.d, units: { ...base.units, ...(x.d.units || {}) }, treadmill: { ...base.treadmill, ...(x.d.treadmill || {}) }, answers: { ...(x.d.answers || {}) }, perm: { health: null, notif: null } },
    };
  } catch { return null; }
}
function clearDraft() { clearTimeout(saveT); try { localStorage.removeItem(DRAFT_KEY); } catch { /* ignore */ } }

/* ---------------- derived answers ---------------- */

const adult = () => !(d.age != null && d.age < 18);
const ageOk = () => d.age != null && d.age >= 13 && d.age <= 100;
const pregnantNow = () => d.sex !== 'male' && d.answers.pregnant === true;
const wantsGoalWeight = () => d.goal === 'lose' && adult();
const effectiveLose = () => wantsGoalWeight() && !pregnantNow();
const permStep = () => !edit && (features.health || features.notifications);
const fitKey = () => JSON.stringify([d.activity, d.canJog, d.hardExercise]);

function stepList() {
  const s = edit ? [] : ['welcome'];
  s.push('goal', 'about', 'body');
  if (wantsGoalWeight() && !d.noNumbers) s.push('goalweight', 'pace');
  s.push('fitness', 'treadmill', 'schedule', 'readiness', 'reveal');
  if (permStep()) s.push('permissions');
  return s;
}
function resolveStep(step) {
  if (step == null || step === '') return null;
  if (typeof step === 'number') return ORDER[step - 1] || null;
  return ORDER.includes(step) ? step : null;
}

const paceDef = (id) => sci.PACES.find((p) => p.id === id) || sci.PACES[1];
const capKg = () => sci.paceCap(d.weightKg || 0);
const paceAllowed = (id) => paceDef(id).kgPerWeek <= capKg() + 1e-9;
function allowedPace(id = d.pace) {
  if (paceAllowed(id)) return id;
  const ok = sci.PACES.filter((p) => paceAllowed(p.id));
  return ok.length ? ok[ok.length - 1].id : 'gentle';
}

function visibleQs() { return READINESS_QUESTIONS.filter((q) => !(q.id === 'pregnant' && d.sex === 'male')); }
function visibleAnswers() {
  const out = {};
  for (const q of visibleQs()) if (typeof d.answers[q.id] === 'boolean') out[q.id] = d.answers[q.id];
  return out;
}
const anyYes = () => Object.values(visibleAnswers()).some(Boolean);

function seedPaces() {
  const P = { ...DEFAULT_PROFILE.paces };
  if (d.canJog !== 'yes') { P.jog = 7.5; P.run = 9.0; } else if (d.hardExercise) { P.jog = 8.5; P.run = 10.0; }
  if (d.hardExercise) { P.brisk = 5.7; P.power = 6.2; }
  const max = d.treadmill.maxSpeed || 16;
  for (const k of Object.keys(P)) P[k] = Math.min(P[k], max);
  return P;
}

/* ---------------- applying the draft ---------------- */

/** Write the draft's profile fields into a main document. mode: 'new' | 'keep' | 'restart' | 'preview'. */
function applyProfile(m, mode) {
  const p = m.profile, lose = effectiveLose();
  p.name = String(d.name || '').trim().slice(0, 40);
  p.goal = d.goal === 'lose' && !lose ? 'fitter' : d.goal || 'lose';
  p.sex = d.sex || 'unspecified';
  p.age = d.age;
  p.heightCm = d.heightCm ? r1(d.heightCm) : null;
  if (mode !== 'keep' || !p.startWeight) p.startWeight = d.weightKg ? r2(d.weightKg) : p.startWeight;
  p.goalWeight = lose && d.goalWeight ? r2(d.goalWeight) : null;
  if (lose) p.pace = allowedPace();
  p.targetDate = lose && d.targetOn && d.targetDate ? d.targetDate : null;
  p.activity = d.activity || 'sitting';
  p.canJog = d.canJog || 'unsure';
  p.hardExercise = !!d.hardExercise;
  p.noNumbers = !!d.noNumbers;
  p.units = { ...d.units };
  if (!edit || fitKey() !== origFit) p.paces = seedPaces();
  p.treadmill = {
    hasIncline: d.treadmill.hasIncline !== false,
    maxIncline: clamp(d.treadmill.maxIncline ?? 12, 0, 15),
    maxSpeed: r2(d.treadmill.maxSpeed || 16),
    handsFree: d.treadmill.handsFree !== false,
  };
  p.sessionLength = d.sessionLength || 45;
  p.busyLength = 30;
  p.reminders = { ...p.reminders, time: d.reminderTime || p.reminders.time || '18:00' };
  if (d.perm.notif === 'on') p.reminders.enabled = !!features.reminders;
  if (d.perm.health === 'on') p.health = { ...p.health, enabled: true };
}

function applyReadiness(m) {
  const prev = m.readiness || {};
  const ans = visibleAnswers();
  const flag = Object.values(ans).some(Boolean);
  const prevYes = Object.keys(prev.answers || {}).filter((k) => prev.answers[k]);
  const acked = edit && !!prev.doctorAck && Object.keys(ans).filter((k) => ans[k]).every((k) => prevYes.includes(k));
  m.readiness = {
    ...prev,
    answers: ans,
    doctorFlag: flag,
    doctorAck: flag ? acked : false,
    achilles: !!(ans.joints && d.achilles),
    betaBlocker: !!(ans.meds && d.betaBlocker),
    pregnant: !!ans.pregnant,
    acceptedAt: prev.acceptedAt || new Date().toISOString(),
  };
}

/** Run fn against a copy of the state with the draft applied (synchronous; nothing is emitted or saved). */
function withDraft(fn) {
  const saved = state.main;
  const m = structuredClone(saved);
  applyProfile(m, 'preview');
  m.plan.days = [...d.days].sort((a, b) => a - b);
  if (!edit || !m.plan.startDate) startPlanThisWeek(m.plan);
  applyReadiness(m);
  if (d.weightKg) m.weights = [...m.weights.filter((w) => w.d !== ymd()), { d: ymd(), kg: d.weightKg }].sort((a, b) => (a.d < b.d ? -1 : 1));
  state.main = m;
  try { return fn(); } finally { state.main = saved; }
}

/* ---------------- plan and energy estimates ---------------- */

function planInfo() {
  const key = JSON.stringify([d.days, d.sessionLength, d.weightKg, d.canJog, d.hardExercise, d.treadmill, d.units.speed, visibleAnswers(), edit]);
  if (cache.has(key)) return cache.get(key);
  const info = withDraft(() => {
    const wk = edit && state.main.plan.startDate ? clamp(currentWeek(), 1, 12) : 1;
    const kg = d.weightKg || 75;
    const sessions = weekSlots(wk).map((slot) => {
      const segs = slotSegments(slot);
      const w = getWorkout(slot.workoutId);
      return { slot, name: w ? w.name : 'Workout', focus: w ? w.focus : '', st: planStats(segs, 0, kg), chart: intervalChart(segs, { mini: true, h: 34, label: `${w ? w.name : 'Workout'} profile: bars show speed, the line shows incline` }) };
    });
    const sum = (k) => sessions.reduce((a, s) => a + s.st[k], 0);
    const startsOn = !edit && currentWeek() < 1 ? planStart() : null;
    return { wk, sessions, startsOn, weekKcal: sum('kcal'), weekMin: sum('activityMin'), weekKm: sum('km'), weekElev: sum('elev'), target: WEEKLY_TARGET[wk <= 4 ? 0 : wk <= 8 ? 1 : 2], phase: PHASES[wk <= 4 ? 0 : wk <= 8 ? 1 : 2] };
  });
  cache.set(key, info);
  return info;
}

function energy(paceId = d.pace) {
  const rmr = sci.rmr({ sex: d.sex || 'unspecified', kg: d.weightKg, cm: d.heightCm, age: d.age });
  if (!rmr) return null;
  const lvl = sci.ACTIVITY_LEVELS.find((a) => a.id === d.activity) || sci.ACTIVITY_LEVELS[0];
  const ex = planInfo().weekKcal / 7;
  const tdee = sci.tdee(rmr, lvl.id, ex);
  const ip = sci.intakePlan({ tdeeKcal: tdee, sex: d.sex, kgPerWeek: paceDef(paceId).kgPerWeek });
  return ip ? { rmr, ex, tdee, ip } : null;
}

/**
 * Goal-date window for a pace. pure=true uses the pace's own deficit (pace step: activity and schedule aren't known
 * yet); otherwise the deficit after the intake floor (plan reveal), which is what the plan really uses.
 */
function goalWindow(paceId = d.pace, { pure = false } = {}) {
  if (!(d.weightKg > 0 && d.goalWeight > 0 && d.weightKg > d.goalWeight)) return null;
  const e = pure ? null : energy(paceId);
  if (!pure && !e) return null;
  const D = pure ? (paceDef(paceId).kgPerWeek * sci.KCAL_PER_KG) / 7 : e.ip.deficit;
  const b = D > 0 ? sci.bandGoalDays(d.weightKg, D, d.goalWeight) : { light: Infinity, heavy: Infinity };
  return { light: b.light, heavy: b.heavy, e };
}
function windowText(win) {
  if (!win) return '';
  if (!Number.isFinite(win.light)) return 'More than 3 years away at this pace';
  if (!Number.isFinite(win.heavy)) return `Projected goal: after ${dateMed(dayAt(win.light))}`;
  return `Projected goal: ${dateRange(dayAt(win.light), dayAt(win.heavy))}`;
}

/* ---------------- number fields ---------------- */

const NUM = {
  age: { dec: 0, step: 1, start: 35, min: () => 13, max: () => 100, get: () => d.age, set: (v) => { d.age = v == null ? null : Math.round(v); },
    err: (v) => (v < 13 ? 'Hillpace is made for ages 13 and up.' : v > 100 ? 'Enter an age up to 100.' : null) },
  heightCm: { dec: 0, min: () => 120, max: () => 230, get: () => d.heightCm, set: (v) => { d.heightCm = v; } },
  ft: { dec: 0, min: () => 3, max: () => 7, get: () => d.hft, set: (v) => { d.hft = v; syncFtIn(); } },
  inch: { dec: 0, min: () => 0, max: () => 11, get: () => d.hin, set: (v) => { d.hin = v; syncFtIn(); } },
  weight: { dec: 1, min: () => wDisp(35), max: () => wDisp(300), get: () => (d.weightKg == null ? null : wDisp(d.weightKg)), set: (v) => { d.weightKg = v == null ? null : r2(wFrom(v)); } },
  goal: { dec: 1, get: () => (d.goalWeight == null ? null : wDisp(d.goalWeight)), set: (v) => { d.goalWeight = v == null ? null : r2(wFrom(v)); } },
  maxIncline: { dec: 1, step: 0.5, start: 12, min: () => 0, max: () => 15, get: () => d.treadmill.maxIncline, set: (v) => { d.treadmill.maxIncline = v; } },
  maxSpeed: { dec: 1, step: 0.5, start: 16, min: () => (isMph() ? 4 : 6), max: () => (isMph() ? 15.5 : 25), get: () => (d.treadmill.maxSpeed == null ? null : sDisp(d.treadmill.maxSpeed)), set: (v) => { d.treadmill.maxSpeed = v == null ? null : sFrom(v); } },
};
function syncFtIn() {
  if (d.hft == null || Number.isNaN(d.hft)) { d.heightCm = null; return; }
  const inch = d.hin == null || Number.isNaN(d.hin) ? 0 : d.hin;
  d.heightCm = r1((d.hft * 12 + inch) * 2.54);
}
function primeFtIn() {
  if (d.heightCm) { const t = Math.round(d.heightCm / 2.54); d.hft = Math.floor(t / 12); d.hin = t % 12; } else { d.hft = null; d.hin = null; }
}

const heightRange = () => (d.units.height === 'ftin' ? 'Enter a height between 3′ 11″ and 7′ 6″.' : 'Enter a height between 120 and 230 cm.');
function fieldErr(group) {
  switch (group) {
    case 'age': return d.age == null ? null : NUM.age.err(d.age);
    case 'height':
      if (d.units.height === 'ftin' && d.hin != null && (d.hin < 0 || d.hin > 11)) return 'Inches should be between 0 and 11.';
      return d.heightCm == null ? null : d.heightCm < 120 || d.heightCm > 230 ? heightRange() : null;
    case 'weight': return d.weightKg == null ? null : d.weightKg < 35 || d.weightKg > 300 ? `Enter a weight between ${fmtInt(wDisp(35))} and ${fmtInt(wDisp(300))} ${wUnit()}.` : null;
    case 'goal': return goalErr();
    case 'maxIncline': return d.treadmill.maxIncline == null ? null : d.treadmill.maxIncline < 0 || d.treadmill.maxIncline > 15 ? 'Enter a max incline between 0 and 15%.' : null;
    case 'maxSpeed': { const v = NUM.maxSpeed.get(); return v == null ? null : v < NUM.maxSpeed.min() - 1e-9 || v > NUM.maxSpeed.max() + 1e-9 ? `Enter a max speed between ${NUM.maxSpeed.min()} and ${NUM.maxSpeed.max()} ${sUnit()}.` : null; }
    default: return null;
  }
}
const groupOf = (key) => (key === 'ft' || key === 'inch' || key === 'heightCm' ? 'height' : key);

function numInput(key, unit, label, { cls = '' } = {}) {
  const f = NUM[key];
  return `<div class="input-unit ${cls}"><input class="input num" id="onb-${key}" data-num="${key}" type="text" inputmode="${f.dec ? 'decimal' : 'numeric'}" autocomplete="off" autocorrect="off" spellcheck="false" enterkeyhint="next" aria-label="${esc(label)}" aria-describedby="err-${groupOf(key)}" value="${esc(numStr(f.get(), f.dec))}"><span class="unit">${esc(unit)}</span></div>`;
}
function stepper(key, unit, label) {
  const f = NUM[key];
  return `<div class="stepper onb-stepper" role="group" aria-label="${esc(label)}">
    <button type="button" data-stepbtn="${key}" data-dir="-1" aria-label="Decrease ${esc(label.toLowerCase())}">${icon('minus')}</button>
    <span class="onb-stepper-val"><input class="num" id="onb-${key}" data-num="${key}" type="text" inputmode="${f.dec ? 'decimal' : 'numeric'}" autocomplete="off" enterkeyhint="next" aria-label="${esc(label)} in ${esc(unit === '%' ? 'percent' : unit)}" aria-describedby="err-${key}" value="${esc(numStr(f.get(), f.dec))}" placeholder="–"><small>${esc(unit)}</small></span>
    <button type="button" data-stepbtn="${key}" data-dir="1" aria-label="Increase ${esc(label.toLowerCase())}">${icon('plus')}</button>
  </div>${errP(key)}`;
}
const errP = (group) => `<p class="onb-err" id="err-${group}" data-err="${group}">${esc(fieldErr(group) && ov && ov.dataset['shown' + group] ? fieldErr(group) : '')}</p>`;

/* ---------------- shared markup ---------------- */

function head(eyebrow, title, lede = '') {
  return `<header class="onb-head"><p class="eyebrow">${eyebrow}</p><h1 class="title-xl" tabindex="-1">${title}</h1>${lede ? `<p class="onb-lede">${lede}</p>` : ''}</header>`;
}
function choices(name, options, value, label) {
  return `<div class="choices" role="radiogroup" aria-label="${esc(label)}">${options.map((o) => `
    <button type="button" class="choice" role="radio" aria-checked="${String(o.value) === String(value)}" data-pick="${name}" data-value="${esc(o.value)}"${o.disabled ? ' disabled aria-disabled="true"' : ''}>
      ${o.icon ? `<span class="onb-choice-ico">${o.icon === 'trendDown' ? trendDown() : icon(o.icon)}</span>` : ''}
      <span class="choice-main"><span class="choice-title">${esc(o.label)}</span>${o.sub ? `<span class="choice-sub">${esc(o.sub)}</span>` : ''}</span>
      <span class="radio" aria-hidden="true"></span>
    </button>`).join('')}</div>`;
}
function seg(name, options, value, label, { mini = false, labelledby = '' } = {}) {
  const lab = labelledby ? `aria-labelledby="${labelledby}"` : `aria-label="${esc(label)}"`;
  return `<div class="seg ${mini ? 'onb-seg-mini' : 'block onb-seg'}" role="group" ${lab}>${options.map((o) => `<button type="button" data-pick="${name}" data-value="${esc(o.value)}" aria-pressed="${value != null && String(o.value) === String(value)}">${esc(o.label)}</button>`).join('')}</div>`;
}
const yn = (v) => (v === true ? 'yes' : v === false ? 'no' : null);
const YES_NO = [{ value: 'yes', label: 'Yes' }, { value: 'no', label: 'No' }];
function switchRow(id, on, title, sub) {
  return `<label class="onb-switch-row" for="${id}"><span class="onb-sw-text"><b>${esc(title)}</b>${sub ? `<span>${esc(sub)}</span>` : ''}</span>${switchHtml(id, on, title)}</label>`;
}
const banner = (kind, ico, title, body) => `<div class="banner ${kind}"><span class="banner-icon">${icon(ico)}</span><div class="banner-body">${title ? `<b>${title}</b>` : ''}${body}</div></div>`;
const trendDown = () => '<svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M4 4v16h16"/><path d="m7.5 8 3.5 4 3-2.5 5 6"/><path d="M19 12.5v3h-3"/></svg>';
const hillMark = () => `<svg viewBox="0 0 40 40" aria-hidden="true" focusable="false"><path d="M4 31 14.5 15l6 8.5 4.5-6L36 31Z" fill="currentColor" opacity=".9"/><path d="M4 34.5h32" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/><circle cx="29" cy="9.5" r="3.2" fill="currentColor" opacity=".55"/></svg>`;

/* ---------------- steps ---------------- */

const STEPS = {
  welcome: {
    html() {
      let chart = '';
      try { chart = intervalChart(segmentsFor('hills', { level: 1, length: 45 }), { mini: true, h: 60, label: 'Example workout, Hill Repeats: bars show speed, the line shows incline' }); } catch { chart = ''; }
      return `
      <div class="hero-card onb-hero">
        ${topo({ w: 400, h: 460, seed: 7, lines: 18, cx: 0.8, cy: 0.16 })}
        <span class="onb-mark">${hillMark()}</span>
        <div class="onb-hero-text">
          <p class="eyebrow">Incline treadmill coach</p>
          <h1 class="onb-brand" tabindex="-1">Hillpace</h1>
          <p class="onb-promise">Incline interval plans built for your treadmill.</p>
        </div>
        ${chart ? `<div class="onb-hero-chart">${chart}<div class="onb-hero-cap"><span>Hill Repeats</span><span class="num">45 min · 7 climbs</span></div></div>` : ''}
      </div>
      <ul class="onb-props">
        <li><span class="onb-prop-ico">${icon('plan')}</span><span><b>A 12-week plan that adapts</b><span>Three phases that adjust to how each session felt.</span></span></li>
        <li><span class="onb-prop-ico">${icon('voice')}</span><span><b>Coached interval by interval</b><span>Voice cues for every speed and incline change.</span></span></li>
        <li><span class="onb-prop-ico">${icon('shield')}</span><span><b>Honest numbers</b><span>Calories shown as estimates, and no promises.</span></span></li>
      </ul>`;
    },
    foot: () => `<button type="button" class="btn btn-primary btn-lg btn-block" data-act="next">Build my plan</button>
      <button type="button" class="btn btn-text btn-block" data-act="restore">${icon('upload')}Restore from a backup</button>
      <p class="onb-fine">Takes about three minutes.</p>`,
    valid: () => null,
  },

  goal: {
    html() {
      const kid = !adult();
      return head('Your goal', 'What’s your main goal?', 'We’ll shape your plan around it. You can change it later.') +
        choices('goal', GOALS.map((g) => (kid && g.value === 'lose' ? { ...g, disabled: true, sub: 'Weight-loss plans are for adults 18 and over' } : g)), d.goal, 'Main goal');
    },
    valid: () => (d.goal && !(d.goal === 'lose' && !adult()) ? null : 'Choose a goal to continue.'),
  },

  about: {
    html() {
      return head('About you', 'A little about you', 'Your answers set your starting level and personalise the energy estimates.') + `
      <div class="onb-field">
        <label class="onb-label" for="onb-name">What should we call you? <span class="onb-opt">Optional</span></label>
        <input class="input" id="onb-name" data-text="name" type="text" autocomplete="given-name" autocapitalize="words" maxlength="40" enterkeyhint="next" placeholder="First name" value="${esc(d.name)}">
      </div>
      <div class="onb-field">
        <span class="onb-label" id="lbl-sex">Sex</span>
        ${seg('sex', [{ value: 'male', label: 'Male' }, { value: 'female', label: 'Female' }, { value: 'unspecified', label: 'Prefer not to say' }], d.sex, 'Sex', { labelledby: 'lbl-sex' })}
        <p class="onb-note">Used only for the calorie formula.</p>
      </div>
      <div class="onb-field">
        <label class="onb-label" for="onb-age">Age</label>
        ${stepper('age', 'years', 'Age')}
      </div>
      <div data-live="kid">${kidNote()}</div>`;
    },
    live: () => ({ kid: kidNote() }),
    valid() {
      if (!d.sex) return 'Choose an option for sex to continue.';
      if (d.age == null) return 'Enter your age to continue.';
      if (!ageOk()) return 'Enter an age between 13 and 100.';
      return null;
    },
  },

  body: {
    html() {
      const ft = d.units.height === 'ftin';
      if (ft) primeFtIn();
      return head('Your body', 'Height and weight', 'Used to estimate the energy each workout takes.') + `
      <div class="onb-field">
        <div class="onb-label"><label for="${ft ? 'onb-ft' : 'onb-heightCm'}">Height</label>${seg('hunit', [{ value: 'cm', label: 'cm' }, { value: 'ftin', label: 'ft, in' }], d.units.height, 'Height unit', { mini: true })}</div>
        ${ft ? `<div class="onb-pair">${numInput('ft', 'ft', 'Height, feet')}${numInput('inch', 'in', 'Height, inches')}</div>` : numInput('heightCm', 'cm', 'Height in centimetres')}
        ${errP('height')}
      </div>
      <div class="onb-field">
        <div class="onb-label"><label for="onb-weight">Current weight</label>${seg('wunit', [{ value: 'kg', label: 'kg' }, { value: 'lb', label: 'lb' }], d.units.weight, 'Weight unit', { mini: true })}</div>
        ${numInput('weight', wUnit(), `Current weight in ${wUnit() === 'kg' ? 'kilograms' : 'pounds'}`)}
        ${errP('weight')}
        <p class="onb-note">For the most consistent readings, weigh yourself in the morning before breakfast.</p>
      </div>`;
    },
    valid() {
      if (d.heightCm == null) return 'Enter your height to continue.';
      if (fieldErr('height')) return fieldErr('height');
      if (d.weightKg == null) return 'Enter your weight to continue.';
      if (fieldErr('weight')) return fieldErr('weight');
      return null;
    },
  },

  goalweight: {
    html() {
      const g = goalLimits();
      if (!g) {
        return head('Your goal', 'Goal weight') + banner('', 'info', 'Let’s focus on fitness instead',
          'Your weight is already in the lower part of the healthy range for your height, so Hillpace won’t set a weight-loss goal. You’ll still get the full 12-week plan.') +
          `<div class="stack"><button type="button" class="btn btn-primary btn-block" data-act="to-fitter">Build a fitness plan instead</button><button type="button" class="btn btn-text btn-block" data-act="to-goal">Choose a different goal</button></div>`;
      }
      if (d.goalWeight == null) d.goalWeight = suggestGoal(g);
      const step = isLb() ? 0.2 : 0.1;
      return head('Your goal', 'What’s your goal weight?', 'Pick a weight you’d be happy to reach. You can change it at any time.') + `
      <div class="onb-wt-pair">
        <div class="onb-wt"><span class="stat-label">Current</span><span class="onb-wt-v num">${wStr(d.weightKg)}<small>${wUnit()}</small></span><span class="onb-wt-sub">From the last screen</span></div>
        <span class="onb-wt-arrow" aria-hidden="true">${icon('chevR')}</span>
        <label class="onb-wt is-goal" for="onb-goal"><span class="stat-label">Goal</span><span class="onb-wt-v"><input id="onb-goal" class="num" data-num="goal" type="text" inputmode="decimal" autocomplete="off" enterkeyhint="done" aria-describedby="err-goal onb-togo" value="${esc(NUM.goal.get() == null ? '' : fmt1(NUM.goal.get()))}"><small>${wUnit()}</small></span><span class="onb-wt-sub">Tap to type</span></label>
      </div>
      <div class="onb-range-wrap">
        <input type="range" class="range" data-range="goal" min="${fmt1(wDisp(g.min))}" max="${fmt1(wDisp(g.max))}" step="${step}" value="${fmt1(wDisp(clamp(d.goalWeight, g.min, g.max)))}" aria-label="Goal weight in ${wUnit()}">
        <div class="onb-range-ends num"><span>${wStr(g.min)}</span><span>${wStr(g.max)}</span></div>
      </div>
      <p class="onb-err" id="err-goal" data-live="goalerr" role="status">${esc(goalErr() || '')}</p>
      <p class="onb-togo" id="onb-togo" data-live="togo">${togoText()}</p>
      <div class="onb-healthy"><p>Healthy range for your height: <b class="num">${wStr(g.low)}–${wStr(g.high)} ${wUnit()}</b></p><p class="onb-note">That’s a BMI of 18.5 to 24.9. Goals are kept inside or above it.</p></div>`;
    },
    live: () => ({ goalerr: esc(goalErr() || ''), togo: togoText() }),
    valid() {
      if (!goalLimits()) return 'Choose a fitness goal to continue.';
      if (d.goalWeight == null) return 'Enter a goal weight to continue.';
      return goalErr();
    },
  },

  pace: {
    html() {
      const cap = capKg();
      const minDate = ymd(addDays(new Date(), 14)), maxDate = ymd(addDays(new Date(), 1095));
      return head('Your pace', 'How fast do you want to go?', 'A gentler pace is easier to keep up. You can change it at any time.') + `
      <div class="choices" role="radiogroup" aria-label="Weekly pace">${sci.PACES.map((p) => paceCard(p, cap)).join('')}</div>
      <p class="onb-note">Dates are projections, not promises. The range allows for your body adapting as you lose weight.</p>
      ${switchRow('onb-sw-target', d.targetOn, 'I have a date in mind', 'A wedding, a holiday or a hike')}
      ${d.targetOn ? `<div class="onb-field">
        <label class="onb-label" for="onb-date">Target date</label>
        <input class="input" id="onb-date" type="date" data-date="target" min="${minDate}" max="${maxDate}" value="${esc(d.targetDate || '')}">
        <div data-live="target">${targetText()}</div>
      </div>` : ''}`;
    },
    live: () => ({ target: targetText() }),
    valid() {
      if (!paceAllowed(d.pace)) return 'Choose a pace to continue.';
      if (d.targetOn) {
        if (!d.targetDate) return 'Pick a target date, or turn off “I have a date in mind”.';
        if (daysBetween(new Date(), parseYmd(d.targetDate)) < 14) return 'Pick a target date at least two weeks away.';
      }
      return null;
    },
  },

  fitness: {
    html() {
      const jog = isMph() ? '5 mph (8 km/h)' : '8 km/h (5 mph)';
      return head('Your fitness', 'Where are you starting from?', 'Your answers set your starting paces. You can change speed during any workout.') + `
      <div class="onb-field">
        <span class="onb-label" id="lbl-act">Day to day, are you…</span>
        ${choices('activity', sci.ACTIVITY_LEVELS.map((a) => ({ value: a.id, label: a.label, sub: a.detail })), d.activity, 'Daily activity')}
      </div>
      <div class="onb-field">
        <span class="onb-label" id="lbl-jog">Can you jog for 1 minute at ${jog}?</span>
        ${seg('canJog', [{ value: 'yes', label: 'Yes' }, { value: 'no', label: 'Not yet' }, { value: 'unsure', label: 'Not sure' }], d.canJog, '', { labelledby: 'lbl-jog' })}
        <p class="onb-note">If not, your plan swaps jogs for steeper power walking. From week 5, after two sessions that feel comfortable, we’ll ask if you’d like to try short jogs.</p>
      </div>
      <div class="onb-field">
        <span class="onb-label" id="lbl-hard">Do you regularly do exercise that leaves you breathing hard?</span>
        ${seg('hard', YES_NO, yn(d.hardExercise), '', { labelledby: 'lbl-hard' })}
      </div>
      <div data-live="paces">${pacesPreview()}</div>`;
    },
    live: () => ({ paces: pacesPreview() }),
    valid() {
      if (!d.activity) return 'Choose how active you are day to day.';
      if (!d.canJog) return 'Answer the jogging question to continue.';
      if (typeof d.hardExercise !== 'boolean') return 'Answer the hard-exercise question to continue.';
      return null;
    },
  },

  treadmill: {
    html() {
      const t = d.treadmill;
      return head('Your treadmill', 'Tell us about your treadmill', 'Every workout stays within these limits, so you’re never asked for more than it can do.') + `
      <div class="onb-field">
        <span class="onb-label" id="lbl-inc">Does it have incline?</span>
        ${seg('incline', YES_NO, t.hasIncline === false ? 'no' : 'yes', '', { labelledby: 'lbl-inc' })}
      </div>
      ${t.hasIncline === false
        ? banner('good', 'speed', 'No incline? No problem.', 'Climbs become slightly faster walking intervals on the flat.')
        : `<div class="onb-field"><label class="onb-label" for="onb-maxIncline">Max incline</label>${stepper('maxIncline', '%', 'Max incline')}<p class="onb-note">Most home treadmills go up to 10–15%.</p></div>`}
      <div class="onb-field">
        <div class="onb-label"><label for="onb-maxSpeed">Max speed</label>${seg('sunit', [{ value: 'kmh', label: 'km/h' }, { value: 'mph', label: 'mph' }], d.units.speed, 'Speed unit', { mini: true })}</div>
        ${stepper('maxSpeed', sUnit(), 'Max speed')}
      </div>
      <div class="onb-field">
        <span class="onb-label" id="lbl-rails">Do you usually walk without holding the rails?</span>
        ${seg('hands', YES_NO, yn(t.handsFree), '', { labelledby: 'lbl-rails' })}
        <p class="onb-note">Holding the rails on a steep incline takes some of the work out of climbing, so we lower the energy estimate when you do.</p>
      </div>`;
    },
    valid() {
      const t = d.treadmill;
      if (t.hasIncline !== false && (t.maxIncline == null || fieldErr('maxIncline'))) return fieldErr('maxIncline') || 'Enter your treadmill’s max incline.';
      if (t.maxSpeed == null) return 'Enter your treadmill’s max speed.';
      if (fieldErr('maxSpeed')) return fieldErr('maxSpeed');
      if (typeof t.handsFree !== 'boolean') return 'Answer the handrail question to continue.';
      return null;
    },
  },

  schedule: {
    html() {
      const n = d.days.length;
      return head('Your week', 'When will you train?', 'Pick the days that usually work. You can move a session whenever you need to.') + `
      <div class="onb-field">
        <span class="onb-label" id="lbl-n">Days per week</span>
        ${seg('ndays', [3, 4, 5, 6].map((v) => ({ value: v, label: String(v) })), n >= 3 && n <= 6 ? n : null, '', { labelledby: 'lbl-n' })}
      </div>
      <div class="onb-field">
        <span class="onb-label" id="lbl-days">Which days?</span>
        <div class="onb-days" role="group" aria-labelledby="lbl-days">${DAY_SHORT.map((x, i) => `<button type="button" class="chip-toggle" data-pick="day" data-value="${i + 1}" aria-pressed="${d.days.includes(i + 1)}" aria-label="${DAY_LONG[i]}">${x}</button>`).join('')}</div>
        <p class="onb-note" data-live="days">${daysNote()}</p>
      </div>
      <div class="onb-field">
        <span class="onb-label" id="lbl-len">Usual session</span>
        ${seg('len', [30, 45, 60].map((v) => ({ value: v, label: `${v} min` })), d.sessionLength, '', { labelledby: 'lbl-len' })}
        <p class="onb-note">Short on time? Any session can switch to a 30-minute version on the day.</p>
      </div>
      ${features.reminders ? `<div class="onb-field">
        <label class="onb-label" for="onb-time">Remind me at</label>
        <input class="input" id="onb-time" type="time" data-time="reminder" value="${esc(d.reminderTime)}">
        <p class="onb-note">You can allow reminders on the last screen.</p>
      </div>` : ''}`;
    },
    live: () => ({ days: daysNote() }),
    valid() {
      const n = d.days.length;
      if (n < 3) return 'Pick at least 3 days to continue.';
      if (n > 6) return 'Keep at least one rest day each week.';
      return null;
    },
  },

  readiness: {
    html() {
      const qs = visibleQs();
      return head('Health check', 'A quick health check', `${qs.length === 9 ? 'Nine' : 'Eight'} yes-or-no questions, so your plan starts at the right level. Your answers are only used to set up your plan.`) + `
      <div class="group onb-qs">${qs.map(qRow).join('')}</div>
      <div data-live="doctor">${doctorCard()}</div>
      <div class="onb-field">
        ${switchRow('onb-sw-nonumbers', d.noNumbers, 'Train without calorie and weight numbers', 'Hide calories, intake targets and weight projections. You’ll see minutes, distance and climb instead.')}
        <p class="onb-note onb-support">Finding food or weight hard to think about? You’re not alone. Your doctor can help, and eating disorder charities such as Beat (UK) and NEDA (US) offer free, confidential support.</p>
      </div>
      <label class="onb-check" for="onb-accept">
        <input type="checkbox" id="onb-accept" data-accept ${d.accepted ? 'checked' : ''}>
        <span class="onb-check-box" aria-hidden="true">${icon('check')}</span>
        <span>${ACCEPT_TEXT}</span>
      </label>`;
    },
    live: () => ({ doctor: doctorCard() }),
    valid() {
      const qs = visibleQs();
      const open = qs.filter((q) => typeof d.answers[q.id] !== 'boolean').length;
      if (open) return open === qs.length ? `Answer the ${qs.length} questions to continue.` : `${open} question${open > 1 ? 's' : ''} left to answer.`;
      if (d.answers.meds && typeof d.betaBlocker !== 'boolean') return 'Answer the follow-up about your medicine.';
      if (d.answers.joints && typeof d.achilles !== 'boolean') return 'Answer the follow-up about your Achilles or calf.';
      if (!d.accepted) return 'Tick the statement above to continue.';
      return null;
    },
  },

  reveal: {
    html: revealHtml,
    after(page) {
      const box = page.querySelector('[data-chart="proj"]');
      if (box) box.innerHTML = projChart(Math.max(260, box.clientWidth || 320));
    },
    foot: () => `<div class="btn-row"><button type="button" class="btn btn-ghost btn-lg" data-act="edit-answers">Edit answers</button><button type="button" class="btn btn-primary btn-lg" data-act="next">${edit ? 'Save plan' : 'Looks good'}</button></div>`,
    valid: () => null,
  },

  permissions: {
    html() {
      const cards = [];
      if (features.health) {
        cards.push(permCard('health', 'heart', 'Apple Health', 'Save workouts and weigh-ins to Apple Health, and read your weight from it.', 'Connect Apple Health',
          { on: 'Connected. Workouts and weigh-ins will be saved to Apple Health.', off: 'Not connected. You can turn this on later in Me, under Apple Health.', later: 'Skipped. You can connect later in Me, under Apple Health.' }));
      }
      if (features.notifications) {
        cards.push(permCard('notif', 'bell', 'Notifications', 'A reminder on training days, and a banner at each interval change if your phone locks. Voice cues need the screen on.', 'Allow notifications',
          { on: `Allowed. We’ll remind you at ${esc(d.reminderTime)} on training days.`, off: 'Not allowed. You can change this later in the Settings app.', later: 'Skipped. You can turn reminders on later in Me.' }));
      }
      return head('Optional', 'Two optional extras', 'Hillpace works fully without these. Nothing is asked until you tap a button.') + `<div class="stack">${cards.join('')}</div>`;
    },
    foot: () => `<button type="button" class="btn btn-primary btn-lg btn-block" data-act="next">Go to my plan</button>`,
    valid: () => null,
  },
};

/* ---------------- step-specific helpers ---------------- */

function kidNote() {
  if (!(d.age != null && d.age >= 13 && d.age < 18)) return '';
  const body = d.goal === 'lose'
    ? 'Weight-loss targets and calorie intake are for adults, so your plan will focus on getting fitter instead. Everything else works the same.'
    : 'Calorie intake targets are for adults, so your plan focuses on fitness. Everything else works the same.';
  return banner('', 'info', 'Your plan is built for fitness', body + (d.goal === 'lose' ? '<button type="button" class="onb-inline-link" data-act="to-goal">Choose a different goal</button>' : ''));
}

function goalLimits() {
  const hr = sci.healthyRange(d.heightCm);
  if (!hr || !d.weightKg) return null;
  const min = Math.ceil(hr.low * 10) / 10;
  const max = r1(d.weightKg - 0.5);
  if (max - min < 0.5) return null;
  return { low: hr.low, high: hr.high, min, max };
}
function suggestGoal(g) {
  const five = d.weightKg * 0.95;
  const unit = isLb() ? 1 / LB : 0.5; // round to 1 lb or 0.5 kg
  return r2(clamp(Math.round(five / unit) * unit, g.min, g.max));
}
function goalErr() {
  const g = goalLimits();
  if (!g || d.goalWeight == null) return null;
  if (d.goalWeight < g.low - 0.05) return `Let’s pick a goal inside the healthy range. For your height, that starts at ${wStr(g.low)} ${wUnit()}.`;
  if (d.goalWeight > d.weightKg - 0.45) return `Your goal should be below your current weight of ${wStr(d.weightKg)} ${wUnit()}.`;
  return null;
}
function togoText() {
  if (goalErr() || d.goalWeight == null || !d.weightKg) return '';
  const diff = d.weightKg - d.goalWeight;
  const pct = Math.round((diff / d.weightKg) * 100);
  let extra = '';
  if (pct >= 5 && pct <= 10) extra = ' Many people start with a goal in this range.';
  else if (pct > 10) extra = ' That’s a big goal. Many people reach it in stages, one 12-week block at a time.';
  return `<b class="num">${wStr(diff)} ${wUnit()} to go</b>, about ${Math.max(1, pct)}% of your weight.${extra}`;
}

function paceCard(p, cap) {
  const ok = p.kgPerWeek <= cap + 1e-9;
  let sub;
  if (!ok) sub = `Faster than the safe maximum for you of ${paceStr(cap)} a week (1% of your weight)`;
  else sub = windowText(goalWindow(p.id, { pure: true }));
  return `<button type="button" class="choice onb-pace" role="radio" aria-checked="${ok && d.pace === p.id}" data-pick="pace" data-value="${p.id}"${ok ? '' : ' disabled aria-disabled="true"'}>
    <span class="onb-pace-num"><b class="num">${paceNum(p.kgPerWeek)}</b><small>${wUnit()} / week</small></span>
    <span class="choice-main"><span class="choice-title">${esc(p.label)}${p.id === 'steady' && ok ? ' <span class="tag good">Recommended</span>' : ''}</span><span class="choice-sub">${esc(sub)}</span></span>
    <span class="radio" aria-hidden="true"></span>
  </button>`;
}

function targetText() {
  if (!d.targetOn || !d.targetDate) return '';
  const days = daysBetween(new Date(), parseYmd(d.targetDate));
  if (days < 14) return `<p class="onb-err">Pick a date at least two weeks away.</p>`;
  const weeks = days / 7, W0 = d.weightKg, G = d.goalWeight;
  if (!(W0 > G)) return '';
  const p = paceDef(d.pace).kgPerWeek;
  const need = (W0 - G) / weeks, cap = capKg();
  const when = dateMed(parseYmd(d.targetDate));
  const goalStr = `${wStr(G)} ${wUnit()}`;
  const reach = `${wStr(Math.max(G, W0 - p * weeks))} ${wUnit()}`;
  const goalDate = dateMed(dayAt(Math.ceil(((W0 - G) / p) * 7)));
  let txt;
  if (need <= p + 1e-9) txt = `Your date fits this pace. At about ${paceStr(p)} a week, you could reach ${goalStr} by ${when}.`;
  else if (need <= cap + 1e-9) txt = `Reaching ${goalStr} by ${when} needs about ${paceStr(r2(need))} a week. At this pace you’d reach about ${reach} by then, and your goal around ${goalDate}.`;
  else txt = `Reaching ${goalStr} by ${when} would need about ${paceStr(r2(need))} a week, which is faster than is safe for you. At this pace you’d reach about ${reach} by then, and your goal around ${goalDate}.`;
  return `<div class="onb-target"><p>${txt}</p><p class="onb-note">A projection, not a promise.</p></div>`;
}

function pacesPreview() {
  if (!d.canJog || typeof d.hardExercise !== 'boolean') return '';
  const P = seedPaces();
  const item = (t, label) => `<span class="mode-${t}"><i class="mode-dot"></i>${label} <b class="num">${fmt1(sDisp(P[t]))}</b></span>`;
  return `<div class="card tight onb-paces"><span class="stat-label">Your starting paces</span><div class="legend">${item('walk', 'Easy walk')}${item('power', 'Power walk')}${item('jog', 'Jog')}<span class="faint">${sUnit()}</span></div></div>`;
}

function daysNote() {
  const n = d.days.length;
  if (n < 3) return 'Pick at least 3 days.';
  if (n > 6) return 'Keep at least one rest day each week.';
  const names = listJoin([...d.days].sort((a, b) => a - b).map((x) => DAY_SHORT[x - 1]));
  return `${n} days: ${names}. Harder sessions are spaced out so your legs can recover.`;
}

function qRow(q) {
  const v = d.answers[q.id];
  let h = `<div class="onb-q"><p id="q-${q.id}">${esc(q.text)}</p>${seg('q', [{ value: `${q.id}:yes`, label: 'Yes' }, { value: `${q.id}:no`, label: 'No' }], v === true ? `${q.id}:yes` : v === false ? `${q.id}:no` : null, '', { mini: true, labelledby: `q-${q.id}` })}</div>`;
  if (q.id === 'meds' && v === true) h += `<div class="onb-q follow"><p id="q-beta">Does it include a beta-blocker or another medicine that changes your heart rate?</p>${seg('beta', YES_NO, yn(d.betaBlocker), '', { mini: true, labelledby: 'q-beta' })}</div>`;
  if (q.id === 'joints' && v === true) h += `<div class="onb-q follow"><p id="q-ach">Is it your Achilles tendon or calf?</p>${seg('achilles', YES_NO, yn(d.achilles), '', { mini: true, labelledby: 'q-ach' })}</div>`;
  return h;
}

function doctorCard() {
  if (!anyYes()) return '';
  let body = 'Tell them about your answers and that you plan to start incline walking. Until you confirm you’ve checked, your plan sticks to light and moderate workouts. You can confirm any time in Me, under Health & safety.';
  if (d.answers.ill) body += ' If you’re unwell or recovering, start once you feel better.';
  return banner('onb-doctor', 'heart', 'Check with your doctor before starting', body);
}

function permCard(key, ico, title, body, cta, msgs) {
  const st = d.perm[key];
  const done = st ? `<p class="onb-perm-state ${st === 'on' ? 'on' : ''}">${st === 'on' ? icon('checkCircle') : ''}${msgs[st]}</p>` : '';
  return `<div class="card onb-perm">
    <div class="onb-perm-head"><span class="onb-perm-ico">${icon(ico)}</span><div><h2 class="title-m">${esc(title)}</h2><p class="body-s">${esc(body)}</p></div></div>
    ${st ? done : `<div class="onb-perm-actions"><button type="button" class="btn btn-block onb-perm-cta" data-act="perm-ask" data-perm="${key}">${esc(cta)}</button><button type="button" class="btn btn-text btn-block" data-act="perm-later" data-perm="${key}">Not now</button></div>`}
  </div>`;
}

/* ---------------- plan reveal ---------------- */

function revealHtml() {
  const info = planInfo();
  const nums = !d.noNumbers;
  const lose = effectiveLose();
  const days = [...d.days].sort((a, b) => a - b);
  const n = days.length;
  const greet = d.name && d.name.trim() ? `, ${esc(d.name.trim())}` : '';
  const title = edit ? 'Your updated plan' : `Your plan is ready${greet}`;
  const goalId = d.goal === 'lose' && !lose ? 'fitter' : d.goal;
  const lede = `${n} sessions a week, ${d.sessionLength} minutes each, on ${listJoin(days.map((x) => DAY_SHORT[x - 1]))}.${GOAL_LINE[goalId] && !pregnantNow() ? ' ' + GOAL_LINE[goalId] : ''}`;

  const weeks = Array.from({ length: 12 }, (_, i) => ({ week: i + 1, pct: i + 1 < info.wk ? weekDone(i + 1) : 0 }));
  const hero = `<div class="hero-card onb-reveal-hero">
    ${topo({ w: 400, h: 300, seed: 11, lines: 14, cx: 0.86, cy: 0.1 })}
    <div class="onb-rh-top"><p class="eyebrow">Week ${info.wk} of 12</p><span class="tag onb-rh-tag">${esc(info.phase.name)}</span></div>
    <h2 class="title-l">${edit && info.wk > 1 ? `You’re in the ${esc(info.phase.name)} phase` : `Starts with ${esc(info.phase.name)}`}</h2>
    <p class="body-s">${esc(info.phase.blurb)}</p>
    ${planMeter(weeks, info.wk)}
    <p class="onb-deload-key"><i aria-hidden="true"></i>Weeks 4, 8 and 12 are lighter, so your body can adapt.</p>
  </div>`;

  const sess = info.sessions.map((s) => {
    const dname = DAY_SHORT[isoDay(s.slot.planned) - 1];
    return `<div class="onb-sess"><span class="onb-sess-day">${dname}</span><span class="onb-sess-main"><b>${esc(s.name)}</b><span>${esc(s.focus)}</span></span><span class="onb-sess-min num">${Math.round(s.st.sec / 60)} min</span>${s.chart}</div>`;
  }).join('');

  const today0 = startOfDay(new Date()).getTime();
  const started = !edit && info.wk === 1 && info.sessions.some((s) => startOfDay(s.slot.date).getTime() < today0);
  const kc = info.sessions.map((s) => sci.roundKcal(s.st.kcal));
  const kLo = Math.min(...kc), kHi = Math.max(...kc);
  const kcalCell = kLo === kHi ? `≈&#8239;${fmtInt(kLo)}` : `≈&#8239;${fmtInt(kLo)}–${fmtInt(kHi)}`;
  const minutes = Math.round(info.weekMin);
  const stats = `<div class="card onb-stats">
    <div class="stat-grid" style="--cols:3">
      <div><span class="stat-label">Activity</span><span class="stat-value">${minutes}<small>min</small></span><span class="onb-stat-sub">Target ${info.target}</span></div>
      <div><span class="stat-label">Distance</span><span class="stat-value">${distStr(info.weekKm).split(' ')[0]}<small>${isMph() ? 'mi' : 'km'}</small></span><span class="onb-stat-sub">A week</span></div>
      ${nums
        ? `<div><span class="stat-label">Per session</span><span class="stat-value onb-kcal">${kcalCell}</span><span class="onb-stat-sub">kcal, estimate</span></div>`
        : `<div><span class="stat-label">Climb</span><span class="stat-value">${elevStr(info.weekElev).split(' ')[0]}<small>${isMph() ? 'ft' : 'm'}</small></span><span class="onb-stat-sub">A week</span></div>`}
    </div>
    <p class="onb-note">${minutes >= info.target
      ? `Activity minutes count vigorous minutes twice. This week reaches the ${info.target}-minute target.`
      : `Activity minutes count vigorous minutes twice. Your schedule gives about ${minutes} of the ${info.target}-minute target, and that’s fine: every week counts.`}${nums ? ' Calories are net active estimates.' : ''}</p>
  </div>`;

  let goalBlock = '';
  if (lose && nums && !(d.goalWeight > 0)) goalBlock = banner('', 'flag', 'Set a goal weight', 'Add a goal weight and pace to see a projected goal date and a suggested daily intake.<button type="button" class="onb-inline-link" data-act="to-goalweight">Set a goal weight</button>');
  else if (lose && nums) goalBlock = goalSection();
  else if (lose && !nums) goalBlock = banner('', 'eyeOff', 'Numbers are hidden', 'Calories, intake and weight projections are turned off. Your plan tracks minutes, distance and climb. You can turn numbers back on in Me.');
  else if (d.goal === 'lose' && !adult()) goalBlock = banner('', 'info', 'Built for fitness', 'Calorie and weight targets are for adults, so your plan focuses on getting fitter.');
  else if (d.goal === 'lose' && pregnantNow()) goalBlock = banner('', 'heart', 'Built for staying active', 'During pregnancy, Hillpace doesn’t set weight-loss targets, and the hardest interval workouts stay locked. Your plan is set to Get fitter.');

  const safety = anyYes() ? banner('', 'heart', 'Light and moderate to start', 'Until you confirm you’ve checked with your doctor, your plan uses light and moderate workouts only. Confirm any time in Me, under Health & safety.') : '';

  return head(edit ? 'Your plan' : 'Your 12-week plan', title, lede) + hero + `
    <section class="section">
      <div class="section-head"><h2 class="section-title">Week ${info.wk}</h2><span class="onb-note">Hard days are spaced apart</span></div>
      <div class="group onb-sessions">${sess}</div>
      ${started ? `<p class="onb-note">This week has already started, so training days that have passed are left out and won’t count as missed. Week 1 carries on from today.</p>` : ''}
      ${info.startsOn ? `<p class="onb-note">Your training days this week have passed, so week 1 starts on ${esc(new Date(info.startsOn).toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' }))}. Until then, an easy walk is a good way to get to know your treadmill.</p>` : ''}
    </section>
    ${stats}
    ${safety}
    ${goalBlock}
    ${switchRow('onb-sw-nonumbers', d.noNumbers, 'Train without calorie and weight numbers', 'Show minutes, distance and climb only.')}
    <button type="button" class="btn btn-text onb-how" data-act="how">${icon('book')}How we calculate${icon('chevR')}</button>`;
}

/** Share of a past plan week's sessions that were done (real state, edit mode only). */
function weekDone(w) {
  if (!edit) return 0;
  try {
    const sl = weekSlots(w);
    return sl.length ? sl.filter((x) => slotStatus(x) === 'done').length / sl.length : 0;
  } catch { return 0; }
}

const GOAL_LINE = {
  fitter: 'Hills get steeper and efforts get longer as your fitness grows.',
  habit: 'Regular sessions with lighter weeks built in, so the habit sticks.',
  hike: 'Steep, steady climbs build the leg strength that trails ask for.',
};

function goalSection() {
  const paceId = allowedPace();
  const win = goalWindow(paceId);
  if (!win) return '';
  const e = win.e, ip = e.ip, pd = paceDef(paceId);
  const weekKcal = e.ex * 7;
  const exKg = weekKcal / sci.KCAL_PER_KG;
  const D = ip.deficit;
  const fromSessions = Math.min(D, e.ex);
  const food = Math.max(0, D - e.ex);
  const range = !Number.isFinite(win.light) ? 'More than 3 years away' : !Number.isFinite(win.heavy) ? `After ${dateMed(dayAt(win.light))}` : dateRange(dayAt(win.light), dayAt(win.heavy));
  const toGo = d.weightKg - d.goalWeight;
  const floorNote = ip.floorApplied
    ? `<p>We never suggest eating less than ${fmtInt(sci.intakeFloor(d.sex))} kcal a day, so your pace works out at about ${paceStr(r2(Math.max(0, ip.effectiveKgPerWeek)))} a week rather than ${paceStr(pd.kgPerWeek)}.</p>`
    : '';
  const split = food > 0
    ? `Your ${pd.label} pace needs a deficit of about ${kcalStr(D)} kcal a day: around ${kcalStr(fromSessions)} from your sessions and the rest from eating a little less.`
    : `Your ${pd.label} pace needs a deficit of about ${kcalStr(D)} kcal a day, which your sessions could cover on their own.`;
  return `
  <section class="section">
    <div class="section-head"><h2 class="section-title">Your goal</h2></div>
    <div class="card onb-proj">
      <span class="stat-label">Projected goal date</span>
      <p class="onb-proj-range">${range}</p>
      <p class="body-s">${wStr(d.goalWeight)} ${wUnit()}, ${wStr(toGo)} ${wUnit()} to go at the ${pd.label} pace.</p>
      <div class="chart onb-proj-chart" data-chart="proj"></div>
      <div class="onb-proj-legend"><span><i class="band"></i>Projected range</span><span><i class="ex"></i>Workouts alone</span><span><i class="goal"></i>Goal</span></div>
      <p class="onb-proj-cap"><b>Projection, not a promise.</b> The shaded range assumes you follow the plan and the suggested intake; the dotted line is the plan with no change in eating. After two weeks of weigh-ins, your real trend takes over.</p>
    </div>
    <div class="card onb-honest">
      <div class="onb-honest-head"><span class="onb-perm-ico">${icon('info')}</span><h3 class="title-s">What your workouts can do</h3></div>
      <p>Your workouts burn about <b>${kcalStr(weekKcal)} kcal a week</b> (estimate). On their own, that’s roughly ${paceStr(r2(exKg))} a week at best.</p>
      <p>${split}</p>
      ${floorNote}
      <div class="onb-intake"><span class="stat-label">Suggested intake</span><span class="onb-intake-v num">${fmtInt(ip.low)}–${fmtInt(ip.high)}<small>kcal a day</small></span></div>
      <p class="onb-note">These are estimates. Your real weight trend will guide the plan after two weeks.</p>
    </div>
  </section>`;
}

function projChart(w) {
  const win = goalWindow(allowedPace());
  if (!win) return '';
  const W0 = d.weightKg, G = d.goalWeight, D = win.e.ip.deficit, ex = win.e.ex;
  let T = Number.isFinite(win.heavy) ? win.heavy : Number.isFinite(win.light) ? win.light * 2 : 730;
  T = clamp(Math.round(T * 1.3) + 7, 84, 1095);
  const t0 = startOfDay(new Date()).getTime(), N = 48;
  const heavy = [], light = [], alone = [];
  for (let i = 0; i <= N; i++) {
    const t = (T * i) / N, b = sci.projectionBand(W0, D, t, G), a = sci.projectionBand(W0, ex, t, G);
    const tt = t0 + t * 864e5;
    heavy.push({ t: tt, v: wDisp(b.heavy) });
    light.push({ t: tt, v: wDisp(b.light) });
    alone.push({ t: tt, v: wDisp(a.heavy) });
  }
  return lineChart({
    series: [
      { points: alone, color: 'var(--ink-3)', width: 2, dash: '2 5' },
      { points: heavy, color: 'var(--m-walk-ink)', width: 2 },
      { points: light, color: 'var(--m-walk-ink)', width: 2 },
    ],
    band: { upper: heavy, lower: light, color: 'var(--m-walk)' },
    hlines: [{ v: wDisp(G), label: `Goal ${fmt1(wDisp(G))}`, color: 'var(--ink-2)', dash: '6 5' }],
    w, h: 196,
    yFmt: (v) => v.toFixed(0),
    xFmt: (t) => monthShort(t),
    label: `Weight projection from ${wStr(W0)} to ${wStr(G)} ${wUnit()}. A projection, not a promise.`,
  });
}

/* ---------------- "How we calculate" ---------------- */

// me.js opens it as a sheet while a full-screen flow is open, so it appears above this overlay.
function openHow() { actions.openHowWeCalculate(); }

/* ---------------- rendering ---------------- */

const page = () => (ov ? ov.querySelector('.onb-page:not(.leaving)') : null);

function progressHtml() {
  const list = stepList().filter((s) => s !== 'welcome');
  const i = Math.max(0, list.indexOf(cur));
  return `<div class="onb-progress" role="progressbar" aria-label="Setup progress" aria-valuemin="1" aria-valuemax="${list.length}" aria-valuenow="${i + 1}" aria-valuetext="Step ${i + 1} of ${list.length}">${list.map((_, k) => `<i class="${k <= i ? 'on' : ''}"></i>`).join('')}</div><span class="onb-count num"><b>${i + 1}</b> of ${list.length}</span>`;
}

function renderTop() {
  const top = ov.querySelector('.onb-top');
  top.classList.toggle('is-welcome', cur === 'welcome');
  if (cur === 'welcome') { top.innerHTML = ''; return; }
  const first = stepList().indexOf(cur) === 0;
  const lead = first && edit
    ? `<button type="button" class="icon-btn" data-act="cancel" aria-label="Cancel and keep your plan">${icon('close')}</button>`
    : `<button type="button" class="icon-btn" data-act="back" aria-label="Back">${icon('chevL')}</button>`;
  top.innerHTML = `${lead}<div class="onb-prog-wrap">${progressHtml()}</div>${edit && !first ? `<button type="button" class="icon-btn plain" data-act="cancel" aria-label="Cancel and keep your plan">${icon('close')}</button>` : ''}`;
}
function updateTop() {
  const w = ov && ov.querySelector('.onb-prog-wrap');
  if (w) w.innerHTML = progressHtml();
}

function renderFoot() {
  const s = STEPS[cur];
  const foot = ov.querySelector('.onb-foot');
  foot.innerHTML = s.foot ? s.foot() : `<p class="onb-hint" id="onb-hint"></p><button type="button" class="btn btn-primary btn-lg btn-block" data-act="next" aria-describedby="onb-hint">Continue</button>`;
  updateFoot();
}
function updateFoot() {
  const s = STEPS[cur];
  const msg = s.valid();
  const btn = ov.querySelector('.onb-foot [data-act="next"]');
  // Dimmed but still tappable: a tap on an unfinished step scrolls to the first unanswered question (showMissing).
  if (btn) { btn.disabled = false; if (msg) btn.setAttribute('aria-disabled', 'true'); else btn.removeAttribute('aria-disabled'); }
  const hint = ov.querySelector('#onb-hint');
  if (hint && hint.textContent !== (msg || '')) { hint.textContent = msg || ''; hint.classList.remove('is-nudged'); }
}

/** First control on the current step that still needs an answer (same order as the step's valid()). */
const MISSING = {
  goal: () => '[data-pick="goal"]:not([disabled])',
  about: () => (!d.sex ? '[data-pick="sex"]' : '#onb-age'),
  body: () => (d.heightCm == null || fieldErr('height') ? (d.units.height === 'ftin' ? '#onb-ft' : '#onb-heightCm') : '#onb-weight'),
  goalweight: () => (goalLimits() ? '#onb-goal' : '[data-act="to-fitter"]'),
  pace: () => (paceAllowed(d.pace) ? '#onb-date' : '[data-pick="pace"]:not([disabled])'),
  fitness: () => (!d.activity ? '[data-pick="activity"]' : !d.canJog ? '[data-pick="canJog"]' : '[data-pick="hard"]'),
  treadmill: () => {
    const t = d.treadmill;
    if (t.hasIncline !== false && (t.maxIncline == null || fieldErr('maxIncline'))) return '#onb-maxIncline';
    return t.maxSpeed == null || fieldErr('maxSpeed') ? '#onb-maxSpeed' : '[data-pick="hands"]';
  },
  schedule: () => `[data-pick="day"][aria-pressed="${d.days.length < 3 ? 'false' : 'true'}"]`,
  readiness: () => {
    const q = visibleQs().find((x) => typeof d.answers[x.id] !== 'boolean');
    if (q) return `[data-pick="q"][data-value="${q.id}:yes"]`;
    if (d.answers.meds && typeof d.betaBlocker !== 'boolean') return '[data-pick="beta"]';
    if (d.answers.joints && typeof d.achilles !== 'boolean') return '[data-pick="achilles"]';
    return '#onb-accept';
  },
};

/** Continue was tapped on an unfinished step: bring the first unanswered question into view and focus it. */
function showMissing() {
  const el = page();
  const hint = ov.querySelector('#onb-hint');
  if (hint) hint.classList.add('is-nudged');
  const sel = MISSING[cur] && MISSING[cur]();
  const t = el && sel ? el.querySelector(sel) : null;
  if (!t) return;
  if (t.dataset.num) showErr(groupOf(t.dataset.num), true);
  // Scroll the overlay so the whole question sits between the sticky top bar and the sticky footer (with its hint).
  const box = t.closest('.onb-field, .onb-q, .onb-check') || t;
  const r = box.getBoundingClientRect(), gap = 16;
  const lo = ov.querySelector('.onb-top').getBoundingClientRect().bottom + gap;
  const hi = ov.querySelector('.onb-foot').getBoundingClientRect().top - gap;
  let dy = r.bottom > hi ? r.bottom - hi : 0;
  if (r.top - dy < lo) dy = r.top - lo; // taller than the gap, or above it: line up its top
  if (dy) { try { ov.scrollBy({ top: dy, behavior: RM ? 'auto' : 'smooth' }); } catch { ov.scrollTop += dy; } }
  try { t.focus({ preventScroll: true }); } catch { /* ignore */ }
}

function fill(el) {
  try {
    el.innerHTML = STEPS[cur].html();
    if (STEPS[cur].after) STEPS[cur].after(el);
  } catch (e) {
    console.error('[onboarding]', e);
    el.innerHTML = head('Sorry', 'Something went wrong', 'Your answers are safe. Go back a step and try again.');
  }
}

function goTo(id, dir = 1) {
  if (!ov || !STEPS[id]) return;
  lastNav = Date.now();
  const old = page();
  cur = id;
  if (id === 'pace') d.pace = allowedPace();
  const el = document.createElement('section');
  el.className = 'onb-page onb-p-' + id;
  ov.querySelector('.onb-stage').appendChild(el);
  fill(el);
  renderTop();
  renderFoot();
  ov.scrollTop = 0;
  ov.dataset.step = id;
  if (old) {
    if (RM || !el.animate) old.remove();
    else {
      old.classList.add('leaving');
      old.setAttribute('aria-hidden', 'true');
      const a = old.animate([{ opacity: 1, transform: 'none' }, { opacity: 0, transform: `translateX(${-dir * 36}px)` }], { duration: 200, easing: 'ease-in', fill: 'forwards' });
      a.onfinish = () => old.remove();
      el.animate([{ opacity: 0, transform: `translateX(${dir * 52}px)` }, { opacity: 1, transform: 'none' }], { duration: 340, easing: 'cubic-bezier(.2,.8,.2,1)' });
    }
  }
  const h = el.querySelector('h1');
  if (h) { try { h.focus({ preventScroll: true }); } catch { /* ignore */ } }
  saveDraft(true);
}

function focusKey(el) {
  if (!el || !el.dataset) return null;
  if (el.dataset.pick) return `[data-pick="${el.dataset.pick}"][data-value="${CSS.escape(el.dataset.value)}"]`;
  if (el.dataset.act) return `[data-act="${el.dataset.act}"]${el.dataset.perm ? `[data-perm="${el.dataset.perm}"]` : ''}`;
  if (el.id) return '#' + CSS.escape(el.id);
  return null;
}

/** Re-render the current page in place (after a choice) and keep keyboard focus on the same control. */
function rerender() {
  const el = page();
  if (!el) return;
  const a = document.activeElement;
  const key = a && el.contains(a) ? focusKey(a) : null;
  fill(el);
  if (key) { const t = el.querySelector(key); if (t) { try { t.focus({ preventScroll: true }); } catch { /* ignore */ } } }
  refresh();
}

/** Update everything that depends on the draft without rebuilding inputs (keeps the caret where it is). */
function refresh() {
  if (!ov) return;
  updateTop();
  updateFoot();
  const el = page();
  const live = STEPS[cur].live && STEPS[cur].live();
  if (el && live) for (const k of Object.keys(live)) { const t = el.querySelector(`[data-live="${k}"]`); if (t && t.innerHTML !== live[k]) t.innerHTML = live[k]; }
  saveDraft();
}

function showErr(group, force = true) {
  const el = page() && page().querySelector(`[data-err="${group}"]`);
  if (!el) return;
  const msg = fieldErr(group);
  if (force) ov.dataset['shown' + group] = '1';
  el.textContent = msg && ov.dataset['shown' + group] ? msg : '';
}

/* ---------------- navigation ---------------- */

function next() {
  if (!ov || Date.now() - lastNav < 280) return;
  const msg = STEPS[cur].valid();
  if (msg) { haptic('warning'); showMissing(); return; }
  const list = stepList();
  const i = list.indexOf(cur);
  if (i === list.length - 1) { complete(); return; }
  haptic('light');
  goTo(list[i + 1], 1);
}
function back() {
  if (!ov || Date.now() - lastNav < 280) return;
  const list = stepList();
  const i = list.indexOf(cur);
  if (i <= 0) { if (edit) cancel(); return; }
  goTo(list[i - 1], -1);
}
async function cancel() {
  if (!ov) return;
  if (JSON.stringify(d) !== orig) {
    const ok = await confirmSheet({ title: 'Discard your changes?', body: 'Your plan stays exactly as it was.', confirm: 'Discard changes', cancel: 'Keep editing', danger: true });
    if (!ok) return;
  }
  close();
}

function askKeep() {
  return new Promise((resolve) => {
    const wk = clamp(currentWeek(), 1, 12);
    let answered = false;
    const s = sheet(`<p class="prose">You’re in week ${wk} of 12. Keep going from here with your new answers, or start the 12 weeks again from this week. Your workout history is kept either way.</p>`, {
      title: 'Keep your plan progress?',
      footer: '<button type="button" class="btn" data-restart>Restart plan</button><button type="button" class="btn btn-primary" data-keep>Keep progress</button>',
      onClose: () => { if (!answered) resolve(null); },
    });
    s.el.querySelector('[data-keep]').addEventListener('click', () => { answered = true; resolve('keep'); s.close(); });
    s.el.querySelector('[data-restart]').addEventListener('click', () => { answered = true; resolve('restart'); s.close(); });
  });
}

async function complete() {
  if (finishing) return;
  if (edit && state.main.onboarded && state.main.plan.startDate) {
    const mode = await askKeep();
    if (mode) finish(mode);
    return;
  }
  finish(edit ? 'restart' : 'new');
}

function finish(mode) {
  finishing = true;
  const today = ymd();
  const prevW = latestWeight();
  const addWeight = !!d.weightKg && (mode === 'new' || prevW == null || Math.abs(prevW - d.weightKg) >= 0.05);
  const daysChanged = String([...(state.main.plan.days || [])].sort((a, b) => a - b)) !== String([...d.days].sort((a, b) => a - b));
  try {
    // A restarted plan reuses slot keys (w1d0…), so earlier sessions must stop counting toward it.
    if (mode === 'restart') detachPlanSessions(state.main.plan.block || 1);
    store.update((m) => {
      applyProfile(m, mode);
      if (mode !== 'keep' || !m.plan.startDate) { m.plan.days = [...d.days].sort((a, b) => a - b); startPlanThisWeek(m.plan); m.plan.swap = {}; m.plan.createdAt = new Date().toISOString(); }
      else if (daysChanged) setTrainingDays(m.plan, d.days);
      applyReadiness(m);
      if (addWeight) m.weights = [...m.weights.filter((w) => w.d !== today), { d: today, kg: r2(d.weightKg) }].sort((a, b) => (a.d < b.d ? -1 : a.d > b.d ? 1 : 0));
      m.onboarded = true;
    });
  } catch (e) {
    console.error(e);
    finishing = false;
    toast('Couldn’t save your plan. Please try again.');
    return;
  }
  const p = state.main.profile;
  if (addWeight && p.health && p.health.enabled) healthSaveWeight(r2(d.weightKg), today);
  if (p.reminders && p.reminders.enabled && features.reminders) scheduleReminders(state.main.plan.days, p.reminders.time);
  clearDraft();
  close();
  actions.go('today');
  haptic('success');
  toast(edit ? 'Your plan is updated' : 'Your plan is ready');
  finishing = false;
}

async function askPermission(key) {
  const btn = ov && ov.querySelector(`[data-act="perm-ask"][data-perm="${key}"]`);
  if (btn) { btn.disabled = true; btn.textContent = 'Waiting…'; }
  if (key === 'health') d.perm.health = (await requestHealth()) ? 'on' : 'off';
  else d.perm.notif = (await requestNotifications()) === 'granted' ? 'on' : 'off';
  if (ov && cur === 'permissions') rerender();
}

/* ---------------- events ---------------- */

function doPick(name, value) {
  switch (name) {
    case 'goal': d.goal = value; break;
    case 'sex': d.sex = value; if (value === 'male') delete d.answers.pregnant; break;
    case 'hunit': d.units.height = value; if (value === 'ftin') primeFtIn(); break;
    case 'wunit': d.units.weight = value; break;
    case 'sunit': {
      const t = d.treadmill;
      const wasDefault = t.maxSpeed == null || Math.abs(t.maxSpeed - defaultMaxSpeed(d.units.speed)) < 0.01;
      d.units.speed = value;
      if (wasDefault) t.maxSpeed = defaultMaxSpeed(value);
      else t.maxSpeed = sFrom(Math.round(sDisp(t.maxSpeed) * 2) / 2);
      break;
    }
    case 'pace': d.pace = value; break;
    case 'activity': d.activity = value; break;
    case 'canJog': d.canJog = value; break;
    case 'hard': d.hardExercise = value === 'yes'; break;
    case 'incline': d.treadmill.hasIncline = value === 'yes'; if (d.treadmill.hasIncline && d.treadmill.maxIncline == null) d.treadmill.maxIncline = 12; break;
    case 'hands': d.treadmill.handsFree = value === 'yes'; break;
    case 'ndays': d.days = (PRESET_DAYS[value] || d.days).slice(); break;
    case 'day': { const v = +value; d.days = d.days.includes(v) ? d.days.filter((x) => x !== v) : [...d.days, v].sort((a, b) => a - b); break; }
    case 'len': d.sessionLength = +value; break;
    case 'q': {
      const [id, ans] = String(value).split(':');
      d.answers[id] = ans === 'yes';
      if (id === 'meds' && ans === 'no') d.betaBlocker = null;
      if (id === 'joints' && ans === 'no') d.achilles = null;
      break;
    }
    case 'beta': d.betaBlocker = value === 'yes'; break;
    case 'achilles': d.achilles = value === 'yes'; break;
    default: return;
  }
  haptic('selection');
  rerender();
}

function stepBy(key, dir) {
  const f = NUM[key];
  if (!f) return;
  let v = f.get();
  const step = f.step || 1;
  if (v == null || Number.isNaN(v)) v = f.start != null ? f.start : f.min();
  else v = Math.round((v + dir * step) / step) * step;
  v = clamp(+v.toFixed(f.dec), f.min(), f.max());
  f.set(v);
  const inp = page() && page().querySelector(`[data-num="${key}"]`);
  if (inp) inp.value = numStr(f.get(), f.dec);
  showErr(groupOf(key), false);
  haptic('selection');
  refresh();
}

function onClick(e) {
  const pick = e.target.closest('[data-pick]');
  if (pick && ov.contains(pick)) { if (!pick.disabled) doPick(pick.dataset.pick, pick.dataset.value); return; }
  const st = e.target.closest('[data-stepbtn]');
  if (st) { stepBy(st.dataset.stepbtn, +st.dataset.dir); return; }
  const a = e.target.closest('[data-act]');
  if (!a || a.disabled) return;
  switch (a.dataset.act) {
    case 'next': next(); break;
    case 'back': back(); break;
    case 'cancel': cancel(); break;
    case 'restore': actions.importBackup(); break;
    case 'to-goal': goTo('goal', -1); break;
    case 'to-goalweight': if (stepList().includes('goalweight')) goTo('goalweight', -1); break;
    case 'to-fitter': d.goal = 'fitter'; goTo(stepList()[stepList().indexOf('body') + 1], 1); break;
    case 'edit-answers': goTo(stepList().find((s) => s !== 'welcome'), -1); break;
    case 'how': openHow(); break;
    case 'perm-ask': askPermission(a.dataset.perm); break;
    case 'perm-later': d.perm[a.dataset.perm] = 'later'; rerender(); break;
    default: break;
  }
}

function onInput(e) {
  const t = e.target;
  if (t.dataset.num) {
    const key = t.dataset.num, f = NUM[key];
    const n = parseNum(t.value);
    f.set(n == null || Number.isNaN(n) ? null : n);
    if (key === 'goal') {
      const r = page().querySelector('[data-range="goal"]');
      if (r && d.goalWeight != null) r.value = String(wDisp(d.goalWeight));
    }
    showErr(groupOf(key), false);
    refresh();
  } else if (t.dataset.range === 'goal') {
    d.goalWeight = r2(wFrom(+t.value));
    const inp = page().querySelector('[data-num="goal"]');
    if (inp) inp.value = fmt1(wDisp(d.goalWeight));
    refresh();
  } else if (t.dataset.text === 'name') {
    d.name = t.value;
    saveDraft();
  } else if (t.dataset.date === 'target') {
    d.targetDate = t.value || null;
    refresh();
  } else if (t.dataset.time === 'reminder') {
    d.reminderTime = t.value || '18:00';
    saveDraft();
  }
}

function onChange(e) {
  const t = e.target;
  if (t.dataset.num) { showErr(groupOf(t.dataset.num), true); return; }
  if (t.id === 'onb-sw-target') {
    d.targetOn = t.checked;
    haptic('selection');
    rerender();
    const f = d.targetOn && page() && page().querySelector('#onb-date');
    if (f) { try { f.closest('.onb-field').scrollIntoView({ behavior: RM ? 'auto' : 'smooth', block: 'nearest' }); } catch { /* ignore */ } }
    return;
  }
  if (t.id === 'onb-sw-nonumbers') { d.noNumbers = t.checked; haptic('selection'); if (cur === 'reveal') rerender(); else refresh(); return; }
  if (t.hasAttribute && t.hasAttribute('data-accept')) { d.accepted = t.checked; haptic('selection'); refresh(); return; }
  if (t.dataset.date === 'target' || t.dataset.time === 'reminder') onInput(e);
}

function onFieldKey(e) {
  if (e.key !== 'Enter') return;
  const t = e.target;
  if (!(t.tagName === 'INPUT' && (t.dataset.num || t.dataset.text))) return;
  e.preventDefault();
  const inputs = [...page().querySelectorAll('input[data-num], input[data-text]')];
  const i = inputs.indexOf(t);
  if (i >= 0 && i < inputs.length - 1) { inputs[i + 1].focus(); return; }
  if (t.dataset.num) showErr(groupOf(t.dataset.num), true);
  t.blur();
  if (!STEPS[cur].valid()) next();
}

function onKey(e) {
  if (!ov || e.key !== 'Escape') return;
  if (document.querySelector('.sheet-root')) return; // the sheet handles its own Escape
  if (edit) cancel();
  else if (cur !== 'welcome') back();
}

/* ---------------- open / close ---------------- */

function open({ edit: isEdit = false, step = null } = {}) {
  const want = resolveStep(step);
  if (ov) { if (want && stepList().includes(want)) goTo(want, 1); return; }
  edit = !!isEdit;
  let start = null;
  if (edit) d = draftFromState();
  else {
    const saved = loadDraft();
    d = saved ? saved.d : newDraft();
    if (saved && saved.step) start = saved.step === 'permissions' ? 'reveal' : saved.step;
  }
  orig = JSON.stringify(d);
  origFit = edit ? fitKey() : '';
  finishing = false;
  cache.clear();
  prevFocus = document.activeElement;

  ov = document.createElement('div');
  ov.className = 'overlay onb';
  ov.setAttribute('role', 'dialog');
  ov.setAttribute('aria-modal', 'true');
  ov.setAttribute('aria-label', edit ? 'Edit plan answers' : 'Set up Hillpace');
  ov.innerHTML = `<div class="onb-topo" aria-hidden="true">${topo({ w: 520, h: 420, seed: 5, lines: 15, cx: 0.72, cy: 0.22 })}</div>
    <header class="onb-top"></header>
    <div class="onb-stage"></div>
    <footer class="onb-foot"></footer>`;
  document.body.appendChild(ov);
  document.body.classList.add('immersive');
  ov.addEventListener('click', onClick);
  ov.addEventListener('input', onInput);
  ov.addEventListener('change', onChange);
  ov.addEventListener('keydown', onFieldKey);
  ov.addEventListener('scroll', () => { const t = ov && ov.querySelector('.onb-top'); if (t) t.classList.toggle('scrolled', ov.scrollTop > 4); }, { passive: true });
  document.addEventListener('keydown', onKey);
  document.addEventListener('visibilitychange', onHide);
  window.addEventListener('pagehide', writeDraft);
  // A restored backup (or account data arriving) during first-run setup ends onboarding.
  unsub = store.subscribe((reason) => {
    if (!ov || edit || finishing) return;
    if ((reason === 'load' || reason === 'remote') && state.main.onboarded) { clearDraft(); close(); actions.go('today'); }
  });

  const list = stepList();
  const first = want || start || (edit ? 'goal' : 'welcome');
  goTo(list.includes(first) ? first : list[0], 1);
}

function close() {
  if (!ov) return;
  const el = ov;
  ov = null;
  cur = null;
  cache.clear();
  clearTimeout(saveT);
  document.removeEventListener('keydown', onKey);
  document.removeEventListener('visibilitychange', onHide);
  window.removeEventListener('pagehide', writeDraft);
  if (unsub) { unsub(); unsub = null; }
  document.body.classList.remove('immersive');
  el.style.pointerEvents = 'none';
  if (RM || !el.animate) el.remove();
  else { const a = el.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 200, easing: 'ease-out', fill: 'forwards' }); a.onfinish = () => el.remove(); }
  try { if (prevFocus && document.contains(prevFocus) && prevFocus.focus) prevFocus.focus({ preventScroll: true }); } catch { /* ignore */ }
  prevFocus = null;
}

actions.openOnboarding = open;
actions.closeOnboarding = close;

export { open as openOnboarding, close as closeOnboarding };
