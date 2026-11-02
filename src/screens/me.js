// Me tab: profile hero, grouped settings, learning, data and legal pages.
// Routes: #me (root), #me-<page> (goal, treadmill = "Where you walk", paces, cues, reminders, health, appearance, data, calc, safety,
//         privacy, terms, support, lessons) and #lesson-<id>.
// Actions: openStopSigns(), openHowWeCalculate(), openLesson(id), importBackup(), exportBackup().
//
// Settings pages save immediately with silent store updates and repaint themselves (restoring focus), because the shell
// skips re-rendering while an input such as a switch has focus.
import * as store from '../core/store.js';
import { state, DEFAULT_PROFILE, getSync, currentAdapter } from '../core/store.js';
import { ACTIVITY_LEVELS, PACES, paceCap, healthyRange, roundKcal, LB_PER_KG, intakeFloor } from '../core/science.js';
import {
  MODES, MODE_IDS, currentWeek, phaseForWeek, bodyKg, getWorkout, planStart,
  SURFACES, SURFACE_IDS, EFFORT, usualSurface, activeSurface, setUsualSurface,
} from '../core/program.js';
import { totals } from '../core/achievements.js';
import {
  toSpeed, fromSpeed, speedUnit, toWeight, fromWeight, weightUnit, toDist, distUnit, toElev, elevUnit,
  isMph, isLb, isFtIn, fmt1, fmt2, fmtInt, ymd, esc,
} from '../core/format.js';
import {
  features, isNative, isArtifact, haptic, speak, stopSpeaking, voices, unlockAudio, beep,
  notificationPermission, requestNotifications, scheduleReminders, cancelReminders,
  healthAvailable, requestHealth, exportFileResult, clearExports, cancelCues, pickTextFile, copyText, statusBar,
} from '../core/platform.js';
import { actions } from '../ui/actions.js';
import {
  icon, modeIcon, topo, toast, sheet, confirmSheet, segmented, bindSegmented, stepperHtml, navBar, row, watchScroll,
} from '../ui/kit.js';
import { getIdentity } from '../core/identity.js';
import { LESSONS, lessonById } from './lessons.js';
import { READINESS_QUESTIONS } from './onboarding.js';

/* ---------------- constants & helpers ---------------- */

// eslint-disable-next-line no-undef
const VERSION = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : '1.0.0';
// The support address is set at build time (package.json "config.supportEmail" -> esbuild define __SUPPORT_EMAIL__).
// The fallback is a placeholder that must not ship in a release build.
// eslint-disable-next-line no-undef
const SUPPORT_EMAIL = typeof __SUPPORT_EMAIL__ !== 'undefined' && __SUPPORT_EMAIL__ ? String(__SUPPORT_EMAIL__) : 'support@walkingcompanion.app';
// eslint-disable-next-line no-undef
const SUPPORT_URL = typeof __SUPPORT_URL__ !== 'undefined' && __SUPPORT_URL__ ? String(__SUPPORT_URL__) : '';
// While the email is still the placeholder, point people at the support link instead of an address nobody reads.
const USE_LINK = SUPPORT_EMAIL === 'support@walkingcompanion.app' && !!SUPPORT_URL;
const contactHtml = () => (USE_LINK
  ? `<a class="me-inline" href="${esc(SUPPORT_URL)}" target="_blank" rel="noopener noreferrer">Report a problem or ask a question</a>`
  : `<span class="me-select-text">${esc(SUPPORT_EMAIL)}</span>`);
const MAX_IMPORT_BYTES = 10 * 1024 * 1024; // a backup with years of workouts is well under 5 MB
const POLICY_DATE = '1 November 2026';
const HOST_THEME = typeof document !== 'undefined' ? document.documentElement.getAttribute('data-theme') : null;

const GOALS = { lose: 'Lose weight', fitter: 'Get fitter', habit: 'Build a walking habit', hike: 'Train for a hike' };
// Effort numbers come from core EFFORT, so this page matches what the player, Today and Workouts coach.
const TALK = {
  walk: { effort: EFFORT.walk.rpe, text: 'Relaxed. You could chat or even sing.' },
  brisk: { effort: EFFORT.brisk.rpe, text: 'Purposeful. You can talk, but you couldn’t sing.' },
  power: { effort: EFFORT.power.rpe, text: 'Working. Short phrases only.' },
  jog: { effort: EFFORT.jog.rpe, text: 'Comfortably hard. A few words at a time.' },
  run: { effort: EFFORT.run.rpe, text: 'Hard. Talking is a struggle.' },
};
const DETAIL = [
  { value: 1, title: 'Changes only', sub: 'The next interval: mode, speed and incline' },
  { value: 2, title: 'Changes and milestones', sub: 'Also halfway and the last interval' },
  { value: 3, title: 'Everything', sub: 'Also a time check every 5 minutes' },
];

const P = () => state.main.profile;
const r1 = (x) => Math.round(x * 10) / 10;
const r2 = (x) => Math.round(x * 100) / 100;
const r3 = (x) => Math.round(x * 1000) / 1000;
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const val = (x) => (typeof x === 'function' ? x() : x);
const trim0 = (n) => fmt1(n).replace(/\.0$/, '');
const plural = (n, one, many = one + 's') => `${fmtInt(n)} ${n === 1 ? one : many}`;
const parseNum = (s) => { const t = String(s ?? '').replace(',', '.').trim(); if (!t) return null; const v = Number(t); return Number.isFinite(v) ? v : NaN; };
const isDone = (s) => s.completed || (s.completion || 0) >= 0.7;
const doneCount = () => state.sessions.filter(isDone).length;
const unlockedCount = () => Math.min(LESSONS.length, doneCount());
const wStr = (kg) => `${fmt1(toWeight(kg))}${'\u00a0'}${weightUnit()}`;
const weightShown = () => !P().noNumbers && !P().hideWeight;
const save = (fn) => store.update(fn, { silent: true });
const deviceWord = () => (isNative ? 'iPhone' : 'device');
const cloud = () => currentAdapter().name === 'cloud';
const immersive = () => document.body.classList.contains('immersive');

function dateMed(iso) {
  const d = new Date(iso);
  if (Number.isNaN(+d)) return '';
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}
function timeLabel(hhmm) {
  const [h, m] = String(hhmm || '18:00').split(':').map(Number);
  return new Date(2000, 0, 1, h || 0, m || 0).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}
function initials(name) {
  const w = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (!w.length) return '';
  return ((w[0][0] || '') + (w.length > 1 ? w[w.length - 1][0] || '' : '')).toUpperCase();
}
function goalLine() {
  const p = P(), parts = [GOALS[p.goal] || GOALS.fitter];
  if (p.goal === 'lose' && p.goalWeight && weightShown()) parts.push(`Goal ${wStr(p.goalWeight)}`);
  if (p.goal === 'lose' && !p.noNumbers) { const pd = PACES.find((x) => x.id === p.pace); if (pd) parts.push(`${pd.label} pace`); }
  return parts.join(' · ');
}
function planLine() {
  const plan = state.main.plan, weeks = plan.weeks || 12;
  if (!plan.startDate) return '12-week plan';
  const wk = currentWeek();
  if (wk < 1) return `Your plan starts ${planStart().toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'short' })}`;
  if (wk > weeks) return `Block ${plan.block || 1} complete`;
  return `Week ${wk} of ${weeks} · ${phaseForWeek(wk).name}`;
}
const paceLabel = (kgPerWeek) => (isLb() ? `${fmt1(kgPerWeek * LB_PER_KG)} lb a week` : `${kgPerWeek} kg a week`);
const speedTxt = (kmh) => `${trim0(toSpeed(kmh))} ${speedUnit()}`;
/** One line for where they usually walk: "Incline treadmill · 12% · 16 km/h", "Walking pad · 6 km/h top", "Outdoors". */
function whereLine(p = P()) {
  const s = usualSurface(p), t = p.treadmill, max = t.maxSpeed || 16;
  if (s === 'outdoor') return SURFACES.outdoor.name;
  if (s === 'flat') return `${max <= 8.05 ? 'Walking pad' : 'Flat treadmill'} · ${speedTxt(max)} top`;
  return `${SURFACES.incline.name} · ${trim0(t.maxIncline ?? 12)}% · ${speedTxt(max)}`;
}
/** What a spoken cue announces on the usual surface. */
const cueWhat = () => ({ incline: 'mode, speed and incline', flat: 'mode and speed', outdoor: 'mode and how it should feel' })[usualSurface()];

/* ---------------- HTML building blocks ---------------- */

/** Grouped section: optional title, rows inside .group, optional note and extra HTML below. */
function sec({ title = '', rows = '', note = '', after = '', cls = '', group = '' }) {
  return `<section class="me-sec ${cls}">${title ? `<h2 class="group-title">${esc(title)}</h2>` : ''}<div class="group" ${group}>${rows}</div>${after}${note ? `<p class="group-note">${note}</p>` : ''}</section>`;
}
/** Settings row with a switch. The whole row is a label, so tapping anywhere toggles it. */
function switchRow({ id, sw, title, sub = '', checked = false, iconName = '' }) {
  const d = sub ? ` aria-describedby="${id}-d"` : '';
  return `<label class="row me-sw ${iconName ? 'has-icon' : ''}" for="${id}">${iconName ? `<span class="row-icon">${icon(iconName)}</span>` : ''}<span class="row-main"><span class="row-title">${esc(title)}</span>${sub ? `<span class="row-sub" id="${id}-d">${esc(sub)}</span>` : ''}</span><span class="switch"><input type="checkbox" role="switch" id="${id}" data-sw="${sw}"${checked ? ' checked' : ''}${d}><span class="track"></span></span></label>`;
}
/** Non-interactive row. */
function staticRow({ title, sub = '', value = '', iconName = '', cls = '', right = '' }) {
  return `<div class="row me-static ${iconName ? 'has-icon' : ''} ${cls}">${iconName ? `<span class="row-icon">${icon(iconName)}</span>` : ''}<span class="row-main"><span class="row-title">${esc(title)}</span>${sub ? `<span class="row-sub">${esc(sub)}</span>` : ''}</span>${value ? `<span class="row-value">${esc(value)}</span>` : ''}${right}</div>`;
}
/** Text field row: label left, input right. */
function fieldRow({ id, label, value = '', unit = '', field, mode = 'decimal', placeholder = '', wide = false, max = 0 }) {
  return `<label class="row me-field" for="${id}"><span class="row-main"><span class="row-title">${esc(label)}</span></span><span class="me-input-wrap"><input id="${id}" class="me-input ${wide ? 'me-wide' : 'num'}" type="text" inputmode="${mode}" data-field="${field}" value="${esc(value)}" placeholder="${esc(placeholder)}" autocomplete="off" spellcheck="false"${max ? ` maxlength="${max}"` : ''} aria-describedby="err-${field}">${unit ? `<span class="me-unit">${esc(unit)}</span>` : ''}</span></label>`;
}
const errSlot = (...keys) => keys.map((k) => `<p class="me-err" id="err-${k}" data-err="${k}" role="alert"></p>`).join('');
/** Row with a stepper on the right. */
function stepRow({ id, title, sub = '', lead = '', below = '' }) {
  const s = STEPPERS[id];
  const v = s.get();
  return `<div class="row me-step ${lead ? 'has-icon' : ''} ${below ? 'me-wrap' : ''}">${lead}<span class="row-main"><span class="row-title">${esc(title)}</span>${sub ? `<span class="row-sub">${esc(sub)}</span>` : ''}</span>${stepperHtml(id, s.text(v), val(s.unit) || '', s.label || title)}${below ? `<span class="me-below">${esc(below)}</span>` : ''}</div>`;
}
/** Checkmark list row (radio). */
function radioRow({ group, value, title, sub = '', checked = false, disabled = false, lead = '' }) {
  return `<button type="button" class="row me-radio ${lead ? 'has-icon' : ''}" role="radio" aria-checked="${checked}" data-choice="${group}" data-value="${esc(value)}"${disabled ? ' aria-disabled="true"' : ''}>${lead}<span class="row-main"><span class="row-title">${esc(title)}</span>${sub ? `<span class="row-sub">${esc(sub)}</span>` : ''}</span><span class="me-check">${icon('check')}</span></button>`;
}
/** Row holding a segmented control (stacked under the title on narrow screens). */
function segRow({ title, sub = '', name, options, value, stack = false }) {
  return `<div class="row me-segrow ${stack ? 'me-stack' : ''}"><span class="row-main"><span class="row-title">${esc(title)}</span>${sub ? `<span class="row-sub">${esc(sub)}</span>` : ''}</span>${segmented(name, options, value, { block: stack, label: title })}</div>`;
}
const live = (key, tag = 'p', cls = 'group-note') => `<${tag} class="${cls}" data-live="${key}"></${tag}>`;
const banner = (kind, iconName, title, body) => `<div class="banner ${kind}"><span class="banner-icon">${icon(iconName)}</span><div class="banner-body"><b>${esc(title)}</b>${body}</div></div>`;

/* ---------------- steppers ---------------- */

const paceStep = (type) => ({
  label: `${MODES[type].name} speed`,
  get: () => r1(toSpeed(P().paces[type] || DEFAULT_PROFILE.paces[type])),
  step: 0.1,
  min: () => (isMph() ? 1.2 : 2),
  max: () => r1(toSpeed(P().treadmill.maxSpeed || 20)),
  unit: () => speedUnit(),
  text: fmt1,
  set: (v) => save((m) => { m.profile.paces = { ...m.profile.paces, [type]: r3(fromSpeed(v)) }; }),
});
const STEPPERS = {
  maxIncline: { label: 'Max incline', get: () => +(P().treadmill.maxIncline ?? 12), step: 0.5, min: 1, max: 15, unit: '%', text: fmt1, set: (v) => save((m) => { m.profile.treadmill.maxIncline = v; }) },
  maxSpeed: { label: 'Max speed', get: () => r1(toSpeed(P().treadmill.maxSpeed || 16)), step: 0.5, min: () => (isMph() ? 4 : 6), max: () => (isMph() ? 15.5 : 25), unit: () => speedUnit(), text: fmt1, set: (v) => save((m) => { m.profile.treadmill.maxSpeed = r2(fromSpeed(v)); }) },
  rate: { label: 'Speaking speed', get: () => r1(+P().cues.rate || 1), step: 0.1, min: 0.8, max: 1.3, unit: '', text: (v) => `${v.toFixed(1)}×`, set: (v) => save((m) => { m.profile.cues.rate = v; }) },
  ...Object.fromEntries(MODE_IDS.map((t) => ['pace-' + t, paceStep(t)])),
};
function stepValue(s, dir) {
  const cur = s.get(), st = s.step, eps = 1e-6;
  let n = dir > 0 ? Math.floor(cur / st + eps) * st + st : Math.ceil(cur / st - eps) * st - st;
  n = Math.round(clamp(n, val(s.min), val(s.max)) * 100) / 100;
  return n;
}

/* ---------------- view lifecycle ---------------- */

let currentView = null;
let voiceList = null; // cached platform voices
let notifPerm = null; // cached notification permission
let healthOk = null; // cached Apple Health availability

function focusSel(el) {
  if (!el || el === document.body) return null;
  if (el.id) return '#' + CSS.escape(el.id);
  const q = (k, v) => `[data-${k}="${String(v).replace(/["\\]/g, '\\$&')}"]`;
  if (el.tagName === 'A' && el.getAttribute('href')) return `a[href="${el.getAttribute('href').replace(/["\\]/g, '\\$&')}"]`;
  const box = el.closest('[data-stepper],[data-seg]');
  let pre = '';
  if (box && box !== el) pre = (box.dataset.stepper != null ? q('stepper', box.dataset.stepper) : q('seg', box.dataset.seg)) + ' ';
  const own = ['act', 'choice', 'value', 'dir'].filter((k) => el.dataset[k] != null).map((k) => q(k, el.dataset[k])).join('');
  return own ? pre + own : null;
}

function paint(v, { first = false } = {}) {
  const ae = document.activeElement;
  const sel = !first && ae && v.root.contains(ae) ? focusSel(ae) : null;
  let ring = false;
  try { ring = !!(ae && ae.matches(':focus-visible')); } catch { ring = false; }
  const y = window.scrollY;
  v.root.innerHTML = v.html(v);
  if (v.unwatch) v.unwatch();
  v.unwatch = watchScroll(v.root.querySelector('.nav-bar'));
  const back = v.root.querySelector('[data-nav-back]');
  if (back) back.dataset.navBack = v.backTo;
  updateLive(v);
  if (!first) {
    window.scrollTo(0, y);
    if (sel) { const el = v.root.querySelector(sel); if (el) { try { el.focus({ preventScroll: true, focusVisible: ring }); } catch { /* ignore */ } } }
  }
}

function updateLive(v) {
  v.root.querySelectorAll('[data-live]').forEach((el) => {
    const fn = LIVE[el.dataset.live];
    const html = fn ? fn(v) : '';
    el.innerHTML = html;
    el.hidden = !html;
  });
  v.root.querySelectorAll('[data-stepper]').forEach((box) => {
    const s = STEPPERS[box.dataset.stepper];
    if (!s) return;
    const cur = s.get();
    box.querySelector('[data-dir="-1"]').setAttribute('aria-disabled', String(cur <= val(s.min) + 1e-9));
    box.querySelector('[data-dir="1"]').setAttribute('aria-disabled', String(cur >= val(s.max) - 1e-9));
  });
}

function mount(root, { page = null, lesson = null } = {}, ctx = {}) {
  const v = { root, page, lesson, revealWeight: false, unwatch: null, backTo: lesson != null ? 'me-lessons' : 'me' };
  v.html = lesson != null ? lessonPageHtml : page ? pageHtml : rootHtml;
  if (page && !ctx.refresh) root.classList.add('push'); // lesson routes get .push from the shell
  if (lesson != null) markLessonRead(lesson);
  paint(v, { first: true });
  currentView = v;

  const onClick = (e) => onClickView(v, e);
  const onChange = (e) => onChangeView(v, e);
  const onInput = (e) => onInputView(v, e);
  const onKey = (e) => { if (e.key === 'Enter' && e.target.matches('.me-input')) { e.preventDefault(); e.target.blur(); } };
  root.addEventListener('click', onClick);
  root.addEventListener('change', onChange);
  root.addEventListener('input', onInput);
  root.addEventListener('keydown', onKey);
  bindSegmented(root, (name, value) => onSeg(v, name, value));
  const unsub = store.subscribe((reason) => { if (reason === 'sync' && root.isConnected) updateLive(v); });

  // Async platform state for some pages
  if (page === 'cues' && P().cues.voice) loadVoices(v);
  if (page === 'reminders' && features.reminders) notificationPermission().then((p) => { notifPerm = p; if (root.isConnected) paint(v); });
  if (page === 'health' && features.health && healthOk == null) healthAvailable().then((ok) => { healthOk = ok; if (root.isConnected) paint(v); });
  if (isNative) { loadLegal('privacy'); loadLegal('support'); } // bundled pages, read once

  return () => {
    root.removeEventListener('click', onClick);
    root.removeEventListener('change', onChange);
    root.removeEventListener('input', onInput);
    root.removeEventListener('keydown', onKey);
    unsub();
    if (v.unwatch) v.unwatch();
    if (currentView === v) currentView = null;
  };
}
const repaintCurrent = () => { if (currentView && currentView.root.isConnected) paint(currentView); };

/* ---------------- root page ---------------- */

function heroHtml() {
  const p = P(), t = totals(), ini = initials(p.name);
  const hrs = t.sec / 3600;
  const time = hrs >= 1 ? `${fmt1(hrs)}<small>h</small>` : `${Math.round(t.sec / 60)}<small>min</small>`;
  const stats = t.count
    ? `<div class="stat-grid me-stats" style="--cols:3">
        <div><span class="stat-label">Workouts</span><span class="stat-value num">${fmtInt(t.count)}</span></div>
        <div><span class="stat-label">Time</span><span class="stat-value num">${time}</span></div>
        ${t.elev > 0 || usualSurface(p) === 'incline'
          ? `<div><span class="stat-label">Climbed</span><span class="stat-value num">${fmtInt(toElev(t.elev))}<small>${elevUnit()}</small></span></div>`
          : `<div><span class="stat-label">Distance</span><span class="stat-value num">${fmt1(toDist(t.km))}<small>${distUnit()}</small></span></div>`}
      </div>`
    : '<p class="me-stats-empty">Your totals appear here after your first workout.</p>';
  return `<section class="hero-card me-hero" aria-label="Your profile">
    ${topo({ seed: 11, cx: 0.86, cy: 0.1 })}
    <p class="eyebrow">${esc(planLine())}</p>
    <div class="me-id">
      <span class="me-avatar" aria-hidden="true">${ini ? esc(ini) : icon('me')}</span>
      <div class="me-id-text">
        <p class="me-name ${p.name ? '' : 'is-empty'}">${p.name ? esc(p.name) : 'Add your name'}</p>
        <p class="me-goal-line">${esc(goalLine())}</p>
      </div>
      <button type="button" class="icon-btn me-edit" data-act="edit-name" aria-label="${p.name ? 'Edit your name' : 'Add your name'}">${icon('edit')}</button>
    </div>
    ${stats}
  </section>`;
}

function rootHtml() {
  const p = P(), r = state.main.readiness;
  const read = state.main.lessonsRead || {};
  const nRead = LESSONS.filter((l) => read[l.id]).length;
  const unreadOpen = LESSONS.slice(0, unlockedCount()).filter((l) => !read[l.id]).length;
  const lessonsVal = nRead >= LESSONS.length ? 'All read' : unreadOpen ? `${unreadOpen} new` : `${unlockedCount()} of ${LESSONS.length}`;
  const doctor = r.doctorFlag && !r.doctorAck ? '<span class="tag warn">Doctor check</span>' : '';
  const cuesVal = p.cues.voice ? 'Voice on' : p.cues.beeps ? 'Beeps only' : 'Off';
  const appVal = { system: 'System', light: 'Light', dark: 'Dark' }[p.appearance] || 'System';

  return `<header class="screen-head"><div class="head-text"><p class="eyebrow">Profile and settings</p><h1 class="title-xl me-h1">Me</h1></div></header>
    ${heroHtml()}
    ${sec({ title: 'Account', rows: [
      `<div class="row me-static has-icon me-acct" data-live="account"></div>`,
      row({ title: 'Sign out', iconName: 'signout', attrs: 'data-act="sign-out"', chev: false, danger: true }),
    ].join('') })}
    ${sec({ title: 'Plan & goal', rows: [
      row({ title: 'Goal & body', value: GOALS[p.goal] || '', iconName: 'target', href: '#me-goal' }),
      row({ title: 'Edit plan answers', sub: 'Goal, schedule, where you walk and readiness', iconName: 'edit', attrs: 'data-act="edit-plan"' }),
      row({ title: 'Where you walk', sub: whereLine(p) + (p.walkOnly ? ' · Walking only' : ''), iconName: SURFACES[usualSurface(p)].icon, href: '#me-treadmill' }),
      row({ title: 'Paces & units', value: `${speedUnit()} · ${weightUnit()}`, iconName: 'speed', href: '#me-paces' }),
    ].join('') })}
    ${sec({ title: 'Coaching', rows: [
      row({ title: 'Voice & cues', value: cuesVal, iconName: 'voice', href: '#me-cues' }),
      features.haptics ? switchRow({ id: 'me-sw-haptics', sw: 'haptics', title: 'Haptics', sub: 'Vibrate at each interval change', checked: !!p.haptics, iconName: 'hand' }) : '',
      features.reminders ? row({ title: 'Reminders', value: p.reminders.enabled ? timeLabel(p.reminders.time) : 'Off', iconName: 'bell', href: '#me-reminders' }) : '',
      features.health ? row({ title: 'Apple Health', value: p.health.enabled ? 'On' : 'Off', iconName: 'heart', href: '#me-health' }) : '',
      row({ title: 'Appearance', value: appVal, iconName: 'moon', href: '#me-appearance' }),
    ].join('') })}
    ${sec({ title: 'Learn', rows: [
      row({ title: 'Lessons', value: lessonsVal, iconName: 'book', href: '#me-lessons' }),
      row({ title: 'How we calculate', iconName: 'info', href: '#me-calc' }),
      row({ title: 'Health & safety', iconName: 'shield', href: '#me-safety', right: doctor }),
    ].join('') })}
    ${sec({ title: 'Data', rows: [
      row({ title: 'Back up & restore', sub: state.main.lastBackup ? `Last backup ${dateMed(state.main.lastBackup)}` : 'No backup yet', iconName: 'download', href: '#me-data' }),
      `<div class="row me-static has-icon" data-live="sync-row"></div>`,
    ].join('') })}
    ${sec({ title: 'About', rows: [
      row({ title: 'Privacy policy', iconName: 'lock', href: '#me-privacy' }),
      row({ title: 'Terms of use', iconName: 'book', href: '#me-terms' }),
      row({ title: 'Support', iconName: 'help', href: '#me-support' }),
    ].join('') })}
    <p class="me-version">Walking Companion ${esc(VERSION)}<br>Not a medical device. Estimates only.</p>`;
}

function syncRowHtml() {
  const s = getSync();
  const ic = s.kind === 'warn' ? 'alert' : s.kind === 'ok' ? 'check' : 'lock';
  const text = s.kind === 'local' && isNative ? 'Saved on this iPhone' : s.text;
  const sub = s.sub || (s.kind === 'warn' ? 'Export a backup to keep your latest changes.' : s.kind === 'ok' ? 'Available wherever you open Walking Companion.' : 'No account needed. Keep a backup somewhere safe.');
  return `<span class="row-icon ${s.kind === 'warn' ? 'me-warn' : ''}">${icon(ic)}</span><span class="row-main"><span class="row-title">${esc(text)}</span><span class="row-sub">${esc(sub)}</span></span>`;
}

/* Account: who is signed in. Identity resolves once per page load; the row fills in when it arrives. */
let ident = null;
function accountRowHtml() {
  if (!ident) {
    getIdentity().then((id) => { ident = id; if (currentView && currentView.root.isConnected) updateLive(currentView); });
    return `<span class="row-icon me-acct-av is-loading" aria-hidden="true"></span><span class="row-main"><span class="row-title">Checking your account…</span></span>`;
  }
  const id = ident;
  const named = (id.kind === 'claude' || id.kind === 'readonly') && id.name;
  const title = id.kind === 'claude' ? (named ? id.name : 'Signed in with Claude')
    : id.kind === 'readonly' ? (named ? id.name : 'Signed in (view-only link)')
    : id.kind === 'guest' ? 'Guest'
    : (isNative ? 'This iPhone' : 'This browser');
  const sub = id.kind === 'claude' ? 'Signed in with Claude · your data is private to your account'
    : id.kind === 'readonly' ? 'View-only link · progress stays on this device'
    : id.kind === 'guest' ? 'Not signed in · progress stays in this browser'
    : 'No account needed · progress stays on this device';
  const av = id.avatarUrl
    ? `<img class="me-acct-img" src="${esc(id.avatarUrl)}" alt="">`
    : id.initials && id.kind !== 'device' ? `<span class="me-acct-ini">${esc(id.initials)}</span>` : icon(id.kind === 'device' ? (isNative ? 'watch' : 'lock') : 'me');
  return `<span class="row-icon me-acct-av" aria-hidden="true">${av}</span><span class="row-main"><span class="row-title">${esc(title)}</span><span class="row-sub">${esc(sub)}</span></span>`;
}

async function signOut() {
  const id = ident || await getIdentity();
  const body = id.kind === 'claude'
    ? 'Your plan and progress stay saved in your Claude account. You’ll go back to the welcome screen.'
    : 'Your plan and progress stay saved on this device. You’ll go back to the welcome screen.';
  const ok = await confirmSheet({ title: 'Sign out?', body, confirm: 'Sign out' });
  if (ok) actions.signOut();
}

function editName() {
  const s = sheet(`<div class="field"><label for="me-name-input">Your name</label><input id="me-name-input" class="input" type="text" maxlength="40" autocomplete="given-name" enterkeyhint="done" value="${esc(P().name || '')}" autofocus><p class="hint">Shown in greetings on Today. Leave it blank if you prefer.</p></div>`, {
    title: P().name ? 'Edit your name' : 'Add your name',
    footer: '<button type="button" class="btn" data-close>Cancel</button><button type="button" class="btn btn-primary" data-save>Save name</button>',
  });
  const inp = s.el.querySelector('input');
  const commit = () => {
    const v = inp.value.trim().slice(0, 40);
    save((m) => { m.profile.name = v; });
    s.close();
    repaintCurrent();
    toast(v ? 'Name saved' : 'Name removed');
  };
  s.el.querySelector('[data-save]').addEventListener('click', commit);
  inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); commit(); } });
}

/* ---------------- subpages ---------------- */

const PAGES = {
  goal: { title: 'Goal & body', lede: 'About you, your goal and your day. Changes apply right away.', html: goalPage },
  treadmill: { title: 'Where you walk', lede: 'Your usual setting shapes how every session is coached.', html: treadmillPage },
  paces: { title: 'Paces & units', lede: 'The speeds Walking Companion uses for each kind of interval.', html: pacesPage },
  cues: { title: 'Voice & cues', lede: 'What you hear during a workout.', html: cuesPage },
  reminders: { title: 'Reminders', lede: 'A nudge on the days your plan has a workout.', html: remindersPage },
  health: { title: features.health ? 'Apple Health' : 'Health sync', lede: features.health ? 'Keep your workouts and weigh-ins in one place.' : '', html: healthPage },
  appearance: { title: 'Appearance', lede: '', html: appearancePage },
  data: { title: 'Back up & restore', lede: '', html: dataPage },
  calc: { title: 'How we calculate', lede: 'The equations behind every estimate in Walking Companion.', html: calcPage },
  safety: { title: 'Health & safety', lede: 'Walking Companion is not a medical device. Listen to your body first.', html: safetyPage },
  privacy: { title: 'Privacy policy', lede: '', html: privacyPage },
  terms: { title: 'Terms of use', lede: '', html: termsPage },
  support: { title: 'Support', lede: 'Questions, problems or ideas: we’d like to hear them.', html: supportPage },
  lessons: { title: 'Lessons', lede: 'Two-minute reads on walking, effort and recovery.', html: lessonsPage },
};

function pageHtml(v) {
  const pg = PAGES[v.page];
  return `${navBar(pg.title, { back: 'Me' })}
    <div class="me-head"><h1 class="title-l me-h1">${esc(pg.title)}</h1>${pg.lede ? `<p class="body-s">${esc(pg.lede)}</p>` : ''}</div>
    ${pg.html(v)}`;
}

/* ----- Goal & body ----- */

function goalPage(v) {
  const p = P(), lose = p.goal === 'lose';
  const sexOpts = [{ value: 'male', label: 'Male' }, { value: 'female', label: 'Female' }, { value: 'unspecified', label: 'Prefer not to say' }]; // same order as onboarding
  let height;
  if (isFtIn()) {
    const tIn = p.heightCm ? Math.round(p.heightCm / 2.54) : null;
    height = `<div class="row me-field"><span class="row-main"><span class="row-title" id="me-h-l">Height</span></span><span class="me-input-wrap">
      <input id="me-f-hft" class="me-input me-short num" type="text" inputmode="numeric" data-field="hft" value="${tIn ? Math.floor(tIn / 12) : ''}" aria-label="Height, feet" aria-describedby="err-height" autocomplete="off"><span class="me-unit">ft</span>
      <input id="me-f-hin" class="me-input me-short num" type="text" inputmode="numeric" data-field="hin" value="${tIn ? tIn % 12 : ''}" aria-label="Height, inches" aria-describedby="err-height" autocomplete="off"><span class="me-unit">in</span></span></div>`;
  } else {
    height = fieldRow({ id: 'me-f-hcm', label: 'Height', value: p.heightCm ? Math.round(p.heightCm) : '', unit: 'cm', field: 'height', mode: 'numeric' });
  }
  let html = sec({ title: 'Goal', rows: row({ title: 'Main goal', value: GOALS[p.goal] || '', iconName: 'flag', attrs: 'data-act="edit-goal"' }), note: 'Changing your main goal opens your plan answers, so everything stays consistent.' });
  html += sec({
    title: 'You',
    rows: [
      fieldRow({ id: 'me-f-name', label: 'Name', value: p.name || '', field: 'name', mode: 'text', placeholder: 'Optional', wide: true, max: 40 }),
      segRow({ title: 'Sex', sub: 'Used only in the resting energy formula', name: 'sex', options: sexOpts, value: p.sex || 'unspecified', stack: true }),
      fieldRow({ id: 'me-f-age', label: 'Age', value: p.age ?? '', unit: 'years', field: 'age', mode: 'numeric' }),
      height,
    ].join(''),
    after: errSlot('age', 'height'),
  });

  if (!p.noNumbers) {
    if (p.hideWeight && !v.revealWeight) {
      html += sec({ title: 'Weight', rows: row({ title: 'Show weight fields', sub: 'Weight figures are hidden. This shows them on this page only.', iconName: 'eyeOff', attrs: 'data-act="reveal-weight"', chev: false }) });
    } else {
      const ws = store.weighIns(); // includes this run's Apple Health weigh-ins
      const latest = ws.length ? ws[ws.length - 1] : null;
      const rows = [fieldRow({ id: 'me-f-start', label: 'Starting weight', value: p.startWeight ? fmt1(toWeight(p.startWeight)) : '', unit: weightUnit(), field: 'start' })];
      if (latest) rows.push(staticRow({ title: 'Latest weigh-in', value: `${wStr(latest.kg)} · ${new Date(latest.d + 'T12:00:00').toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}` }));
      if (lose) rows.push(fieldRow({ id: 'me-f-goalw', label: 'Goal weight', value: p.goalWeight ? fmt1(toWeight(p.goalWeight)) : '', unit: weightUnit(), field: 'goalw' }));
      html += sec({
        title: 'Weight',
        rows: rows.join(''),
        after: errSlot('start', 'goalw') + live('goal-hint'),
        note: lose ? '' : `Your main goal is “${esc(GOALS[p.goal] || '')}”. To set a goal weight, change your main goal to Lose weight.`,
      });
      if (lose) {
        const cap = paceCap(bodyKg());
        html += sec({
          title: 'Weekly pace',
          group: 'role="radiogroup" aria-label="Weekly pace"',
          rows: PACES.map((x) => {
            const ok = x.kgPerWeek <= cap + 1e-9;
            return radioRow({ group: 'pace', value: x.id, title: x.label, sub: ok ? paceLabel(x.kgPerWeek) : `${paceLabel(x.kgPerWeek)} · above your safe limit`, checked: p.pace === x.id, disabled: !ok });
          }).join(''),
          after: live('pace-note'),
        });
      }
    }
  }

  html += sec({
    title: 'Day to day',
    group: 'role="radiogroup" aria-label="Activity outside workouts"',
    rows: ACTIVITY_LEVELS.map((a) => radioRow({ group: 'activity', value: a.id, title: a.label, sub: a.detail, checked: p.activity === a.id })).join(''),
    note: 'Your activity outside workouts. Planned sessions are added separately.',
  });

  html += sec({
    title: 'Numbers',
    rows: switchRow({ id: 'me-sw-nonum', sw: 'noNumbers', title: 'Train without calorie and weight numbers', sub: 'See minutes, distance and climb instead of calories, intake, projections and weight', checked: !!p.noNumbers })
      + (p.noNumbers ? '' : switchRow({ id: 'me-sw-hidew', sw: 'hideWeight', title: 'Hide weight', sub: 'Hide weight figures across the app. You can still log weigh-ins.', checked: !!p.hideWeight })),
    note: p.noNumbers ? 'Weight fields are hidden while this is on.' : '',
  });
  return html;
}

function goalHint(v) {
  const p = P();
  if (p.noNumbers || (p.hideWeight && !(v && v.revealWeight))) return '';
  const hr = healthyRange(p.heightCm);
  if (p.goal !== 'lose') return '';
  if (!hr) return 'Add your height to see the healthy weight range for it.';
  let s = `Healthy range for your height: ${fmt1(toWeight(hr.low))}–${wStr(hr.high)} (BMI 18.5 to 24.9).`;
  const cur = bodyKg();
  if (p.goalWeight && cur > p.goalWeight) {
    const diff = cur - p.goalWeight;
    s += ` <b>${wStr(diff)} to go</b>, about ${Math.max(1, Math.round((diff / cur) * 100))}% of your current weight.`;
  }
  return s;
}
function paceNote() {
  const p = P();
  if (p.goal !== 'lose' || p.noNumbers) return '';
  const cap = paceCap(bodyKg());
  const cur = PACES.find((x) => x.id === p.pace);
  const capTxt = isLb() ? `${fmt1(cap * LB_PER_KG)} lb` : `${fmt2(cap).replace(/0$/, '')} kg`;
  if (cur && cur.kgPerWeek > cap + 1e-9) return `<span class="me-warn-text">Your current pace is faster than 1% of your weight a week. Choose a slower pace.</span>`;
  return `Walking Companion caps your pace at 1% of your body weight a week, up to 1 kg (2.2 lb). For you that’s ${capTxt} a week. Projections are estimates, not a promise.`;
}

/* ----- Where you walk ----- */

function surfaceCard(id, checked) {
  const S = SURFACES[id];
  return `<button type="button" class="choice me-choice" role="radio" aria-checked="${checked}" data-choice="surface" data-value="${esc(id)}"><span class="me-choice-ico">${icon(S.icon)}</span><span class="choice-main"><span class="choice-title">${esc(S.name)}</span><span class="choice-sub">${esc(S.blurb)}</span></span><span class="radio" aria-hidden="true"></span></button>`;
}

function treadmillPage() {
  const p = P(), t = p.treadmill, us = usualSurface(p), today = activeSurface();
  let note = 'You can switch for a single day from Today or before a workout.';
  if (today !== us) note += ` Today you’re walking ${today === 'outdoor' ? 'outdoors' : `on ${today === 'flat' ? 'a flat treadmill or walking pad' : 'an incline treadmill'}`}; tomorrow goes back to your usual.`;
  if (us === 'outdoor') note += ` On treadmill days, workouts stay within ${trim0(t.maxIncline ?? 12)}% and ${speedTxt(t.maxSpeed || 16)}.`;
  let html = `<section class="me-sec"><h2 class="group-title">Usually</h2><div class="choices me-choices" role="radiogroup" aria-label="Where you usually walk">${SURFACE_IDS.map((id) => surfaceCard(id, id === us)).join('')}</div><p class="group-note">${esc(note)}</p></section>`;

  if (us !== 'outdoor') {
    const inc = us === 'incline';
    const rows = [];
    if (inc) rows.push(stepRow({ id: 'maxIncline', title: 'Max incline', sub: 'Highest setting on your console' }));
    rows.push(stepRow({ id: 'maxSpeed', title: 'Max speed', sub: inc ? 'Fastest setting on your console' : 'Fastest setting on your treadmill or pad' }));
    html += sec({
      title: inc ? 'Your treadmill' : 'Your treadmill or walking pad',
      rows: rows.join(''),
      note: inc ? 'Workouts never go above these settings.' : 'Climbs become slightly faster walking. Workouts never go above your max speed.',
      after: live('tm-note'),
    });
    let rail;
    if (inc) {
      rail = p.noNumbers
        ? 'Holding the rails on a steep incline supports part of your weight, which makes the workout easier than it looks. If you need to hold on, try a lower incline or speed.'
        : 'Holding the rails on a steep incline supports part of your weight, so you use less energy than the incline suggests. When this is off, Walking Companion counts only 75% of the incline on slopes of 8% and above. Energy figures are always estimates.';
    } else {
      rail = p.noNumbers
        ? 'Many walking pads have no rails. Walking without holding on keeps your posture natural; if you need support, try a slower speed.'
        : 'Many walking pads have no rails. On the flat, holding on doesn’t change your estimates. On days you walk on an incline, Walking Companion counts only 75% of the incline on slopes of 8% and above when this is off.';
    }
    html += sec({ title: 'Handrails', rows: switchRow({ id: 'me-sw-hands', sw: 'handsFree', title: 'I walk hands-free', sub: 'Most of the time, without holding the rails', checked: t.handsFree !== false, iconName: 'hand' }), note: esc(rail) });
  }

  const jogNote = p.walkOnly ? ''
    : p.canJog === 'yes' ? 'Your plan includes short jog intervals.'
      : 'Jogs join your plan once you’re ready: from week 5, after two sessions that feel comfortable, Walking Companion asks first.';
  html += sec({
    title: 'Jogs',
    rows: switchRow({ id: 'me-sw-walkonly', sw: 'walkOnly', title: 'Walking only', sub: 'No jogs or runs. Harder parts become power walking.', checked: !!p.walkOnly, iconName: 'stride' }),
    note: jogNote,
  });
  return html;
}
function treadmillNote() {
  const p = P(), max = p.treadmill.maxSpeed || 16;
  const over = MODE_IDS.filter((t) => (p.paces[t] || 0) > max + 1e-6).map((t) => MODES[t].name.toLowerCase());
  if (!over.length) return '';
  return `<span class="me-warn-text">Your ${over.join(' and ')} ${over.length > 1 ? 'paces are' : 'pace is'} above this max speed, so those intervals will run at ${fmt1(toSpeed(max))} ${speedUnit()}.</span>`;
}

/* ----- Paces & units ----- */

function pacesPage() {
  const u = P().units;
  const units = sec({
    title: 'Units',
    rows: [
      segRow({ title: 'Speed and distance', name: 'u-speed', options: [{ value: 'kmh', label: 'km/h' }, { value: 'mph', label: 'mph' }], value: u.speed }),
      segRow({ title: 'Weight', name: 'u-weight', options: [{ value: 'kg', label: 'kg' }, { value: 'lb', label: 'lb' }], value: u.weight }),
      segRow({ title: 'Height', name: 'u-height', options: [{ value: 'cm', label: 'cm' }, { value: 'ftin', label: 'ft, in' }], value: u.height }),
    ].join(''),
  });
  const paces = sec({
    title: 'Your paces',
    rows: MODE_IDS.map((t) => stepRow({
      id: 'pace-' + t,
      title: MODES[t].name,
      sub: `Effort ${TALK[t].effort} of 10`,
      below: TALK[t].text,
      lead: `<span class="row-icon me-mode mode-${t}">${modeIcon(t)}</span>`,
    })).join(''),
    after: live('paces-note'),
    note: usualSurface() === 'outdoor'
      ? 'Use the talk test: if a pace feels easier or harder than described, adjust it by 0.1. Outdoors these paces feed your distance and energy estimates; you’re coached by effort.'
      : `Use the talk test: if a pace feels easier or harder than described, adjust it by 0.1. Workouts never go above your max speed of ${fmt1(toSpeed(P().treadmill.maxSpeed || 16))} ${speedUnit()}.`,
  });
  return units + paces + `<button type="button" class="btn btn-ghost btn-block" data-act="reset-paces">${icon('refresh')}Reset to suggested paces</button>`;
}
function pacesNote() {
  const ps = MODE_IDS.map((t) => P().paces[t] || 0);
  for (let i = 1; i < ps.length; i++) {
    if (ps[i] + 1e-6 < ps[i - 1]) return `<span class="me-warn-text">Your ${MODES[MODE_IDS[i]].name.toLowerCase()} is slower than your ${MODES[MODE_IDS[i - 1]].name.toLowerCase()}. Each pace should be at least as fast as the one above it.</span>`;
  }
  return '';
}

/* ----- Voice & cues ----- */

function voiceOptions() {
  const id = P().cues.voiceId;
  const cur = id != null && !/^\d+$/.test(String(id)) ? id : null; // older builds saved a list position, which isn't stable
  const list = voiceList || [];
  let opts = `<option value=""${!cur ? ' selected' : ''}>System default</option>`;
  opts += list.map((x) => `<option value="${esc(x.id)}"${String(x.id) === String(cur) ? ' selected' : ''}>${esc(x.name)}${x.lang ? ` (${esc(x.lang)})` : ''}</option>`).join('');
  if (cur && !list.some((x) => String(x.id) === String(cur))) opts += `<option value="${esc(cur)}" selected>${voiceList ? 'Saved voice (not on this device)' : 'Loading voices…'}</option>`;
  return opts;
}
function loadVoices(v) {
  if (voiceList) return;
  voices().then((list) => {
    voiceList = Array.isArray(list) ? list : [];
    const sel = v.root.isConnected && v.root.querySelector('#me-voice');
    if (sel) sel.innerHTML = voiceOptions();
  });
}
function cuesPage() {
  const c = P().cues;
  const voiceRows = [switchRow({ id: 'me-sw-voice', sw: 'voice', title: 'Spoken cues', sub: `Announce each interval change: ${cueWhat()}`, checked: !!c.voice, iconName: 'voice' })];
  if (c.voice) {
    voiceRows.push(
      `<label class="row me-field" for="me-voice"><span class="row-main"><span class="row-title">Voice</span></span><span class="me-select-wrap"><select id="me-voice" class="me-select" data-select="voice">${voiceOptions()}</select>${icon('chevD')}</span></label>`,
      stepRow({ id: 'rate', title: 'Speaking speed', sub: 'From 0.8× to 1.3×' }),
      row({ title: 'Test voice', sub: 'Play a sample cue', iconName: 'play', attrs: 'data-act="test-voice"', chev: false }),
    );
  }
  let html = sec({ title: 'Voice', rows: voiceRows.join('') });
  if (c.voice) {
    html += sec({
      title: 'Announcements',
      rows: segRow({ title: 'Warn me before changes', sub: 'How early to announce the next interval', name: 'lead', options: [5, 10, 15].map((n) => ({ value: n, label: `${n} s` })), value: c.lead || 10, stack: true }),
    });
    html += sec({
      title: 'How much to say',
      group: 'role="radiogroup" aria-label="How much to say"',
      rows: DETAIL.map((d) => radioRow({ group: 'detail', value: d.value, title: d.title, sub: d.value === 1 ? `The next interval: ${cueWhat()}` : d.sub, checked: (+c.detail || 2) === d.value })).join(''),
    });
  }
  html += sec({
    title: 'Sounds',
    rows: switchRow({ id: 'me-sw-beeps', sw: 'beeps', title: 'Countdown beeps', sub: 'Three beeps before each change', checked: !!c.beeps, iconName: 'timer' }),
    note: features.lockScreenCues
      ? `Voice cues play while Walking Companion is on screen, so it keeps your screen awake during a workout. If your phone locks, interval changes arrive as notifications with a sound or vibration instead, if you allow them.${features.reminders ? ' <a class="me-inline" href="#me-reminders">Notification settings</a>' : ''}`
      : 'Keep Walking Companion open with the screen on during a workout so cues can play.',
  });
  return html;
}
function testVoice() {
  const p = P();
  if (!isNative && !('speechSynthesis' in window)) { toast('Spoken cues aren’t available in this browser'); return; }
  unlockAudio();
  const lead = +p.cues.lead || 10;
  const s = usualSurface(p);
  if (s === 'outdoor') {
    speak(`In ${lead} seconds: power walk. ${EFFORT.power.say}`, { interrupt: true });
  } else {
    const sp = trim0(toSpeed(p.paces.power || 6));
    const words = isMph() ? 'miles per hour' : 'kilometres per hour';
    const inc = s === 'incline' ? `, incline ${trim0(Math.min(8, p.treadmill.maxIncline ?? 12))} percent` : '';
    speak(`In ${lead} seconds: power walk, ${sp} ${words}${inc}.`, { interrupt: true });
  }
  toast('Playing a sample cue');
}

/* ----- Reminders ----- */

function remindersPage() {
  if (!features.reminders) return unavailable('Training reminders aren’t part of the web version. Your plan on the Today tab always shows what’s next.');
  const p = P(), rem = p.reminders;
  const days = (state.main.plan.days || []).slice().sort((a, b) => a - b).map((d) => ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'][d - 1]).join(', ');
  const remSub = rem.enabled ? `On ${days || 'your plan days'}` : notifPerm === 'denied' ? 'Allow notifications in the Settings app first' : notifPerm === 'granted' ? 'A notification on your plan days' : 'Walking Companion asks for permission the first time';
  const rows = [switchRow({ id: 'me-sw-rem', sw: 'reminders', title: 'Training-day reminders', sub: remSub, checked: !!rem.enabled, iconName: 'bell' })];
  if (rem.enabled) {
    rows.push(`<label class="row me-field" for="me-rem-time"><span class="row-main"><span class="row-title">Time</span></span><span class="me-input-wrap"><input id="me-rem-time" class="me-input num" type="time" data-field="remtime" value="${esc(rem.time || '18:00')}"></span></label>`);
    rows.push(staticRow({ title: 'Days', value: days || 'None', sub: 'Change your training days in the Plan tab' }));
  }
  let html = sec({ title: 'Reminders', rows: rows.join('') });
  const perm = notifPerm === 'granted'
    ? staticRow({ title: 'Notifications allowed', sub: 'Lock-screen cues are ready', iconName: 'check' })
    : notifPerm === 'prompt'
      ? row({ title: 'Allow notifications', sub: 'Shows the iPhone permission prompt', iconName: 'bell', attrs: 'data-act="allow-notif"', chev: false })
      : notifPerm === 'denied'
        ? staticRow({ title: 'Notifications are off for Walking Companion', sub: 'Open the Settings app, tap Notifications, then Walking Companion, and turn on Allow Notifications.', iconName: 'alert', cls: 'me-denied' })
        : notifPerm === 'unavailable'
          ? staticRow({ title: 'Notifications aren’t available', sub: 'This device doesn’t support local notifications', iconName: 'alert' })
          : staticRow({ title: 'Checking permission…', iconName: 'bell' });
  html += sec({
    title: 'Lock-screen workout cues',
    rows: perm,
    note: 'Voice cues need Walking Companion on screen. During a workout, Walking Companion also schedules a notification for each interval change, so if your phone locks you still get a banner with a sound (or a vibration when your iPhone is on silent). These cues need notification permission. Everything is scheduled on your iPhone; nothing is sent to a server.',
  });
  return html;
}
async function setReminders(v, on) {
  if (!on) {
    save((m) => { m.profile.reminders.enabled = false; });
    await cancelReminders();
    paint(v);
    toast('Reminders off');
    return;
  }
  let perm = await notificationPermission();
  if (perm === 'prompt') perm = await requestNotifications();
  notifPerm = perm;
  if (perm !== 'granted') {
    save((m) => { m.profile.reminders.enabled = false; });
    paint(v);
    toast('Notifications are off for Walking Companion. You can allow them in the Settings app.');
    return;
  }
  save((m) => { m.profile.reminders.enabled = true; });
  await scheduleReminders(state.main.plan.days || [], P().reminders.time || '18:00');
  paint(v);
  toast(`Reminders set for ${timeLabel(P().reminders.time)} on training days`);
}

/* ----- Apple Health ----- */

function healthPage() {
  if (!features.health) return unavailable('Health app sync isn’t part of the web version. Your workouts and weigh-ins are kept in Walking Companion.');
  const h = P().health;
  const what = `<article class="card me-doc prose">
    <h3>What Walking Companion saves</h3>
    <ul><li>Walking or running workouts, with estimated active energy and distance</li><li>Your weigh-ins, as body weight</li></ul>
    <h3>What Walking Companion reads</h3>
    <ul><li>Your body weight, to keep your weight trend up to date</li></ul>
    <p>Health data stays on your iPhone and in Apple Health. Walking Companion never shares it or uses it for advertising.</p>
  </article>`;
  if (healthOk === false) return banner('warn', 'alert', 'Apple Health isn’t available', 'This device doesn’t support Apple Health.') + what;
  if (!h.enabled) {
    return what + `<button type="button" class="btn btn-primary btn-block btn-lg" data-act="connect-health">${icon('heart')}Connect Apple Health</button>
      <p class="group-note me-center">Apple Health will ask which data to share. Walking Companion works fully if you say no.</p>`;
  }
  return sec({
    title: 'Connection',
    rows: switchRow({ id: 'me-sw-health', sw: 'health', title: 'Use Apple Health', sub: 'Save workouts and weigh-ins, read body weight', checked: true, iconName: 'heart' })
      + switchRow({ id: 'me-sw-watch', sw: 'watch', title: 'I also record on Apple Watch', sub: 'Save sessions without energy and distance so they aren’t counted twice', checked: !!h.watch, iconName: 'watch' }),
    note: 'To change what Walking Companion can read or write, open the Health app, tap your profile picture, then Apps, then Walking Companion.',
  }) + what;
}
async function connectHealth(v) {
  const ok = await requestHealth();
  if (ok) {
    save((m) => { m.profile.health.enabled = true; });
    haptic('success');
    toast('Apple Health connected');
  } else {
    toast('Apple Health wasn’t connected. You can try again any time.');
  }
  paint(v);
}

/* ----- Appearance ----- */

function appearancePage() {
  const a = P().appearance || 'system';
  return sec({
    title: 'Theme',
    group: 'role="radiogroup" aria-label="Theme"',
    rows: [
      radioRow({ group: 'appearance', value: 'system', title: 'System', sub: isNative ? 'Match your iPhone’s light or dark setting' : 'Match your device’s light or dark setting', checked: a === 'system', lead: `<span class="row-icon">${icon('sliders')}</span>` }),
      radioRow({ group: 'appearance', value: 'light', title: 'Light', sub: 'Always light', checked: a === 'light', lead: `<span class="row-icon">${icon('sun')}</span>` }),
      radioRow({ group: 'appearance', value: 'dark', title: 'Dark', sub: 'Always dark', checked: a === 'dark', lead: `<span class="row-icon">${icon('moon')}</span>` }),
    ].join(''),
  });
}
function applyTheme(a) {
  const el = document.documentElement;
  if (a === 'light' || a === 'dark') el.setAttribute('data-theme', a);
  else if (!isArtifact) el.removeAttribute('data-theme');
  else if (HOST_THEME) el.setAttribute('data-theme', HOST_THEME);
  else el.removeAttribute('data-theme');
  const t = el.getAttribute('data-theme');
  const dark = t ? t === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
  statusBar(dark ? 'light' : 'dark');
}

/* ----- Back up & restore ----- */

function dataPage() {
  const m = state.main;
  const where = cloud() ? 'In your account' : isNative ? 'On this iPhone' : 'On this device';
  const summary = sec({
    title: where,
    rows: [
      staticRow({ title: 'Workouts', value: fmtInt(state.sessions.length), iconName: 'library' }),
      staticRow({ title: 'Weigh-ins', value: fmtInt((m.weights || []).length), iconName: 'scale' }),
      staticRow({ title: 'Custom workouts', value: fmtInt((m.customs || []).length), iconName: 'layers' }),
      `<div class="row me-static has-icon" data-live="sync-row"></div>`,
    ].join(''),
  });
  const busyRow = (act) => (busy[act] ? `data-act="${act}" disabled aria-busy="true"` : `data-act="${act}"`);
  const backup = sec({
    title: 'Backup',
    rows: [
      row({ title: 'Export backup', sub: 'One file with your plan, workouts, weigh-ins and settings', iconName: 'download', attrs: 'data-act="export-backup"', chev: false }),
      row({ title: 'Export workouts as CSV', sub: 'For spreadsheets', iconName: 'share', attrs: 'data-act="export-csv"', chev: false }),
      row({ title: 'Import backup', sub: busy['import-backup'] || 'Restore from a Walking Companion backup file', iconName: 'upload', attrs: busyRow('import-backup'), chev: false }),
    ].join(''),
    after: live('backup-note'),
  });
  const erase = sec({
    title: 'Erase',
    rows: row({ title: 'Erase all data', sub: busy.erase || (cloud() ? 'Delete everything from your account and this device' : `Delete everything from this ${deviceWord()}`), iconName: 'trash', attrs: busyRow('erase'), chev: false, danger: true }),
    note: 'This can’t be undone. Export a backup first if you might want your history later.',
  });
  return summary + backup + erase;
}
function backupNote() {
  const last = state.main.lastBackup;
  const tip = cloud()
    ? 'Your data syncs to your account. A backup file is still a good idea.'
    : `Walking Companion keeps your data on this ${deviceWord()} only. Back up monthly and keep the file somewhere safe, such as iCloud Drive.`;
  if (!last) return `<b>No backup yet.</b> ${tip}`;
  const age = (Date.now() - new Date(last).getTime()) / 864e5;
  const lead = `Last backup: <b>${esc(dateMed(last))}</b>.`;
  return age > 31 ? `${lead} <span class="me-warn-text">It’s been over a month.</span> ${tip}` : `${lead} ${tip}`;
}

async function exportBackup() {
  const exportedAt = new Date().toISOString();
  const data = { app: 'walking-companion', version: 1, exportedAt, main: { ...state.main, lastBackup: exportedAt }, sessions: state.sessions };
  const res = await exportFileResult(`walking-companion-backup-${ymd()}.json`, JSON.stringify(data, null, 2), 'application/json');
  if (res === 'shared') {
    save((m) => { m.lastBackup = exportedAt; }); // only when the file actually went somewhere
    repaintCurrent();
    toast('Backup file ready');
  } else if (res === 'cancelled') {
    toast('Export cancelled. No backup was saved.');
  } else {
    toast('Couldn’t create the backup file. Try again.');
  }
  return res === 'shared';
}

const csvCell = (x) => {
  let s = String(x ?? '');
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; // keep spreadsheets from treating notes as formulas
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
function slotLabel(key) {
  const m = /^w(\d+)d(\d+)$/.exec(String(key || ''));
  return m ? `Week ${m[1]}, session ${+m[2] + 1}` : '';
}
async function exportCsv() {
  if (!state.sessions.length) { toast('No workouts to export yet'); return; }
  const nums = !P().noNumbers;
  const head = ['Date', 'Start time', 'Workout', 'Plan session', 'Duration (min)', 'Completed (%)', `Distance (${distUnit()})`, `Climb (${elevUnit()})`];
  if (nums) head.push('Active energy (kcal, estimate)');
  head.push('Effort (1-10)', 'Source', 'Notes');
  const rows = [...state.sessions].sort((a, b) => (a.date < b.date ? -1 : 1)).map((s) => {
    const d = new Date(s.date);
    const w = getWorkout(s.workoutId);
    const comp = s.completion != null ? s.completion : s.completed ? 1 : 0;
    const r = [
      Number.isNaN(+d) ? '' : ymd(d),
      Number.isNaN(+d) ? '' : `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`,
      s.name || (w && w.name) || 'Workout',
      slotLabel(s.planSlot),
      r1((s.durationSec || 0) / 60),
      Math.round(comp * 100),
      fmt2(toDist(s.distanceKm || 0)),
      Math.round(toElev(s.elevM || 0)),
    ];
    if (nums) r.push(roundKcal(s.kcal));
    r.push(s.rpe ?? '', s.source === 'manual' ? 'Manual entry' : 'Walking Companion', s.notes || '');
    return r;
  });
  const text = '\ufeff' + [head, ...rows].map((r) => r.map(csvCell).join(',')).join('\r\n');
  const res = await exportFileResult(`walking-companion-workouts-${ymd()}.csv`, text, 'text/csv');
  toast(res === 'shared' ? 'Spreadsheet file ready' : res === 'cancelled' ? 'Export cancelled' : 'Couldn’t create the file. Try again.');
}

/* import */

const YMD_RE = /^\d{4}-\d{2}-\d{2}$/;
function cleanWeights(list) {
  const byDay = new Map();
  for (const w of Array.isArray(list) ? list : []) {
    if (!w || typeof w !== 'object' || !YMD_RE.test(String(w.d)) || !(+w.kg > 0)) continue;
    byDay.set(w.d, { ...w, kg: +w.kg });
  }
  return [...byDay.values()].sort((a, b) => (a.d < b.d ? -1 : 1));
}
// Imported files are untrusted: store.cleanSessions / store.cleanCustoms whitelist types, clamp numbers, cap text and fix ids.
const cleanSessions = (list) => store.cleanSessions(list);
const cleanCustoms = (list, mapBrisk = false) => store.cleanCustoms(list, { mapBrisk });
/** Legacy import over an existing setup: keep this app's custom workouts and add the imported ones that are new. */
function mergeCustoms(mine, theirs) {
  const sig = (c) => `${String(c.name || '').trim().toLowerCase()}|${JSON.stringify((c.segs || []).map((x) => [x.type, x.dur, x.incline || 0, x.speed ?? null]))}`;
  const out = [...(Array.isArray(mine) ? mine : [])];
  const ids = new Set(out.map((c) => c.id)), sigs = new Set(out.map(sig));
  let added = 0;
  for (const c of Array.isArray(theirs) ? theirs : []) {
    const k = sig(c);
    if (sigs.has(k)) continue;
    const rec = ids.has(c.id) ? { ...c, id: store.uid('c') } : c;
    out.push(rec);
    ids.add(rec.id); sigs.add(k); added++;
  }
  return { list: out, added };
}
/** Same conversion as store.readLegacy, applied to an imported file from the previous single-file app. */
function convertLegacy(d) {
  const m = store.defaultMain();
  const p = d.profile || {};
  if (p.paces && typeof p.paces === 'object') m.profile.paces = { ...m.profile.paces, walk: +p.paces.walk || 4.5, power: +p.paces.brisk || 6.0, jog: +p.paces.jog || 8.0 };
  m.profile.units.speed = p.units === 'mph' ? 'mph' : 'kmh';
  m.profile.startWeight = +p.startWeight || null;
  if (+p.startWeight > 0 && +p.goalLoss > 0) m.profile.goalWeight = +(+p.startWeight - +p.goalLoss).toFixed(1);
  m.profile.cues.voice = p.voice !== false;
  m.profile.cues.beeps = p.beeps !== false;
  m.weights = cleanWeights(d.weights);
  m.customs = cleanCustoms(p.customs, true);
  const sessions = cleanSessions((Array.isArray(d.sessions) ? d.sessions : []).map((x) => (x && typeof x === 'object' ? { ...x, source: x.manual ? 'manual' : 'app', planSlot: null } : x)));
  return { main: m, sessions };
}
/** Returns {kind, main, sessions, exportedAt} or null when the file isn't a backup we understand. */
function parseBackup(d) {
  if (!d || typeof d !== 'object' || Array.isArray(d)) return null;
  const OURS = ['walking-companion', 'hillpace']; // 'hillpace': backups made before the rename
  if (d.app != null && !OURS.includes(d.app)) return null;
  if (d.main && typeof d.main === 'object' && !Array.isArray(d.main) && (OURS.includes(d.app) || d.schemaVersion != null || d.main.profile)) {
    if (d.main.profile != null && (typeof d.main.profile !== 'object' || Array.isArray(d.main.profile))) return null;
    const main = { ...d.main, weights: cleanWeights(d.main.weights), customs: cleanCustoms(d.main.customs) };
    return { kind: 'hillpace', main, sessions: cleanSessions(d.sessions), exportedAt: d.exportedAt || d.savedAt || null };
  }
  if (d.profile && typeof d.profile === 'object' && (Array.isArray(d.weights) || Array.isArray(d.sessions))) {
    return { kind: 'legacy', ...convertLegacy(d), exportedAt: null };
  }
  return null;
}

function badFileSheet() {
  sheet(`<p class="prose">This file isn’t a Walking Companion backup, or it’s damaged. Choose a <b>.json</b> file made with <b>Export backup</b> in Walking Companion, or a backup from the previous version of the app.</p>`, {
    title: 'Can’t use this file',
    footer: '<button type="button" class="btn btn-primary" data-close>OK</button>',
  });
}

const busy = {}; // data-act -> status text while a restore or erase is being saved
function setBusy(act, textOrNull) {
  if (textOrNull) busy[act] = textOrNull; else delete busy[act];
  repaintCurrent();
}
/** Wait for the save, but not for ever: anything unsaved stays queued and is retried. */
const settleWithin = (p, ms) => Promise.race([p, new Promise((r) => setTimeout(r, ms))]);

async function importBackup() {
  if (busy['import-backup']) return false;
  const text = await pickTextFile('.json,application/json,text/plain', { maxBytes: MAX_IMPORT_BYTES });
  if (text == null) return false;
  let data = null;
  try { data = text && text.length <= MAX_IMPORT_BYTES ? JSON.parse(text) : null; } catch { data = null; }
  const parsed = parseBackup(data);
  if (!parsed) { badFileSheet(); return false; }

  let { main, sessions } = parsed;
  const nC = (main.customs || []).length;
  const keepSettings = parsed.kind === 'legacy' && state.main.onboarded;
  let addedC = 0;
  if (keepSettings) {
    const cur = structuredClone(state.main);
    cur.weights = main.weights;
    const merged = mergeCustoms(cur.customs, main.customs);
    cur.customs = merged.list;
    addedC = merged.added;
    main = cur;
  }
  const nW = (main.weights || []).length, nS = sessions.length;
  const dates = sessions.map((s) => new Date(s.date)).filter((d) => !Number.isNaN(+d)).sort((a, b) => a - b);
  const span = dates.length ? ` (${esc(dateMed(dates[0]))}${dates.length > 1 ? ` to ${esc(dateMed(dates[dates.length - 1]))}` : ''})` : '';
  const curS = state.sessions.length, curW = (state.main.weights || []).length, curC = (state.main.customs || []).length;
  const hasData = curS || curW || curC || state.main.onboarded;
  const where = cloud() ? 'in your account and on this device' : `on this ${deviceWord()}`;

  const lines = [
    `<b>${plural(nS, 'workout')}</b>${span}`,
    `<b>${plural(nW, 'weigh-in')}</b>`,
    `<b>${plural(nC, 'custom workout')}</b>`,
  ];
  let body = `This file contains:</p><ul class="me-import-list">${lines.map((l) => `<li>${l}</li>`).join('')}</ul><p class="prose">`;
  if (parsed.exportedAt && !Number.isNaN(+new Date(parsed.exportedAt))) body += `Exported ${esc(dateMed(parsed.exportedAt))}. `;
  if (keepSettings) {
    body += `It comes from the previous version of the app. Your current plan, settings and custom workouts stay as they are${addedC ? `, and ${plural(addedC, 'custom workout')} from the file ${addedC === 1 ? 'is' : 'are'} added` : ''}. `;
    if (curS || curW) body += `Restoring replaces the ${plural(curS, 'workout')} and ${plural(curW, 'weigh-in')} ${where}. This can’t be undone.`;
  } else {
    if (parsed.kind === 'legacy') body += 'It comes from the previous version of the app, so you’ll finish setting up your plan afterwards. ';
    if (hasData) body += `Restoring replaces ${state.main.onboarded ? 'your plan and settings, ' : ''}${plural(curS, 'workout')}, ${plural(curW, 'weigh-in')} and ${plural(curC, 'custom workout')} ${where}. This can’t be undone.`;
  }

  const ok = await confirmSheet({ title: 'Restore this backup?', body, confirm: hasData ? 'Replace data' : 'Restore', danger: !!hasData });
  if (!ok) return false;

  setBusy('import-backup', 'Restoring your backup…');
  try { await settleWithin(store.replaceAll(main, sessions), 5000); } finally { setBusy('import-backup', null); }
  haptic('success');
  if (features.reminders) {
    const rem = state.main.profile.reminders;
    if (rem.enabled && (await notificationPermission()) === 'granted') scheduleReminders(state.main.plan.days || [], rem.time);
    else cancelReminders();
  }
  if (state.main.onboarded) toast(`Backup restored: ${plural(nS, 'workout')}`);
  else {
    toast(`Imported ${plural(nS, 'workout')}. Finish setting up your plan.`);
    if (!immersive()) actions.openOnboarding({ edit: false });
  }
  return true;
}

async function eraseAll() {
  if (busy.erase) return;
  const nS = state.sessions.length, nW = (state.main.weights || []).length;
  const ok = await confirmSheet({
    title: 'Erase all data?',
    body: `This permanently deletes your plan, ${plural(nS, 'workout')}, ${plural(nW, 'weigh-in')} and all settings from ${cloud() ? 'your account and this device' : `this ${deviceWord()}`}. Export a backup first if you might want them later.`,
    confirm: 'Erase all',
    danger: true,
  });
  if (!ok) return;
  setBusy('erase', 'Erasing…');
  if (features.reminders) await cancelReminders();
  if (features.lockScreenCues) cancelCues(); // cues of an unfinished run
  try { localStorage.removeItem('hp.run'); } catch { /* ignore */ }
  clearExports(); // temporary copies of exported backups
  try { await settleWithin(store.eraseAll(), 5000); } finally { setBusy('erase', null); }
  applyTheme('system');
  toast('All data erased');
  actions.go('today');
  actions.openOnboarding({ edit: false });
}

/* ----- How we calculate ----- */

function calcHtml() {
  const p = P();
  const intro = p.noNumbers
    ? banner('', 'info', 'You’re training without numbers', 'Calorie and weight figures are hidden in your app. This page explains how they’re worked out, for reference.')
    : banner('', 'info', 'Every figure is an estimate', 'Walking Companion works out energy, distance and climb from your speeds, inclines and body weight with published equations. Your actual burn can differ substantially from these estimates, and from what your treadmill or watch shows, because each uses its own formula and sensors.');
  return `${intro}
  <article class="card me-doc prose">
    <h3>Workout energy</h3>
    <p>For each interval we estimate oxygen use with the ACSM metabolic equations. S is the belt speed in metres per minute (km/h × 16.67) and G is the incline as a fraction (8% is 0.08).</p>
    <p class="me-formula"><span class="me-f-label">Walking</span>VO<sub>2</sub> = 0.1 × S + 1.8 × S × G + 3.5</p>
    <p class="me-formula"><span class="me-f-label">Jogging and running</span>VO<sub>2</sub> = 0.2 × S + 0.9 × S × G + 3.5</p>
    <p>VO<sub>2</sub> is millilitres of oxygen per kilogram of body weight per minute. We use the running equation for jog and run intervals, and for anything at 8 km/h (5 mph) or faster.</p>
    <h3>Active energy, not total</h3>
    <p>The 3.5 in each equation is what your body uses at rest. We take it out, so the figure you see is the extra energy the workout costs, often called net or active energy:</p>
    <p class="me-formula">kcal per minute = (VO<sub>2</sub> − 3.5) × weight (kg) ÷ 1000 × 5</p>
    <p>For example, walking at 4.8 km/h (3.0 mph) up a 12% incline at 75 kg comes to about 9.5 kcal a minute. Many treadmills show total (gross) energy, which includes resting energy, so their numbers are usually higher. ${features.health ? 'Active energy is also what Walking Companion saves to Apple Health. ' : ''}Figures are shown with ≈ and rounded to the nearest 5 kcal.</p>
    <h3>Holding the handrails</h3>
    <p>Holding on supports part of your weight, so a climb costs less than the incline suggests. If you turn off “I walk hands-free”, we count 75% of the incline on slopes of 8% and above (G′ = 0.75 × G). This is a rule of thumb, not a measured value.</p>
    <h3>Distance and climb</h3>
    <p>Distance is speed × time for each interval, using the speeds you actually ran, including any changes you make during the workout. Climb is distance × incline, the usual treadmill convention. If your belt runs faster or slower than its display, these will be off too.</p>
    <h3>Walking outdoors</h3>
    <p>Outdoors, Walking Companion can’t see your real speed or the hills on your route. Sessions are coached by effort, and distance and energy are worked out from your paces as if the ground were flat, so they are rougher estimates than on a treadmill. Climb isn’t counted.</p>
    <h3>Activity minutes</h3>
    <p>Following WHO and CDC guidelines, a moderate minute counts once and a vigorous minute counts twice. A minute is vigorous during jog and run intervals, or when the estimated effort is 6 METs or more (METs = VO<sub>2</sub> ÷ 3.5). Your weekly targets are 150, 200 and 250 activity minutes in the Foundation, Build and Burn phases. The guidelines suggest 150 to 300 moderate minutes a week for adults.</p>
    <h3>Resting and daily energy</h3>
    <p>Resting energy uses the Mifflin-St Jeor equation:</p>
    <p class="me-formula">RMR = 10 × weight (kg) + 6.25 × height (cm) − 5 × age + s</p>
    <p>where s is +5 for men, −161 for women and −78 if you’d rather not say (the midpoint). It’s within about 10% for most adults, which is why suggested intake is shown as a range.</p>
    <p>Daily energy multiplies resting energy by an activity factor for your day outside workouts, then adds the average daily energy of your planned sessions:</p>
    <ul>${ACTIVITY_LEVELS.map((a) => `<li>${esc(a.label)}: × ${a.factor.toFixed(1)}</li>`).join('')}</ul>
    <h3>Sizing a deficit</h3>
    <p>To turn a weekly pace into a daily deficit, we use the common rule of thumb that 1 kg of body weight is about 7,700 kcal:</p>
    <p class="me-formula">daily deficit = weekly pace (kg) × 7,700 ÷ 7</p>
    <p>So the Steady pace (0.5 kg a week) means about 550 kcal a day, from workouts and food together. We use the 7,700 rule only to size the deficit, not to predict your weight. Pace is capped at 1% of your body weight a week, up to 1 kg, and we never suggest eating less than ${fmtInt(intakeFloor('female'))} kcal a day for women or ${fmtInt(intakeFloor('male'))} for men (or if you’d rather not say).</p>
    <h3>Projection</h3>
    <p>Until you have two weeks of weigh-ins, the projection is a band. The faster edge applies the 7,700 rule directly. The slower edge uses the Hall et al. (2011) model of how the body adapts as weight changes:</p>
    <p class="me-formula">change (kg) = deficit ÷ 24 × (1 − 2<sup>−days ÷ 365</sup>)</p>
    <p>In that model, each 24 kcal a day of lasting deficit leads to about 1 kg of eventual change, with half of it reached in about a year. Both edges stop at your goal. The band is a projection if you follow the plan and the suggested intake, not a promise.</p>
    <h3>Weight trend</h3>
    <p>Day-to-day weight jumps with water, salt and food, so we smooth it. Each weigh-in moves the trend part of the way towards the new value, about 10% for each day since the last one (α = 1 − 0.9<sup>days</sup>). Once you have at least four weigh-ins spread over 14 days, the projection follows the slope of your trend over the last 28 days instead of the band.</p>
    <h3>Sources</h3>
    <ul class="me-sources">
      <li>American College of Sports Medicine. ACSM’s Guidelines for Exercise Testing and Prescription (metabolic equations).</li>
      <li>Mifflin MD, St Jeor ST, et al. A new predictive equation for resting energy expenditure in healthy individuals. American Journal of Clinical Nutrition, 1990.</li>
      <li>Hall KD, et al. Quantification of the effect of energy imbalance on bodyweight. The Lancet, 2011.</li>
      <li>World Health Organization. Guidelines on physical activity and sedentary behaviour, 2020.</li>
      <li>US Centers for Disease Control and Prevention. Physical activity guidelines for adults.</li>
    </ul>
  </article>`;
}
function calcPage() { return calcHtml(); }

/* ----- Health & safety ----- */

function stopSignsHtml() {
  const items = [
    ['heart', 'Chest pain, pressure or tightness'],
    ['pulse', 'Unusual shortness of breath'],
    ['alert', 'Dizziness, light-headedness or feeling faint'],
    ['pulse', 'A racing, pounding or irregular heartbeat'],
    ['alert', 'Nausea'],
    ['alert', 'Sharp pain in your calf, Achilles tendon or shin'],
  ];
  // Today's surface: the sheet opens during workouts, which may be on a one-off surface.
  const s = activeSurface();
  const how = s === 'outdoor'
    ? 'slow down and stop somewhere safe, away from traffic. Sit down if you feel faint, and ask someone nearby for help if you need it.'
    : s === 'flat'
      ? 'press Stop on the console or remote, or pull the safety key if there is one, and step off to the side once the belt has stopped. Sit down if you feel faint.'
      : 'hold the side rails, press Stop or pull the safety key, and step off to the sides once the belt has stopped. Sit down if you feel faint.';
  return `<div class="me-stop">
    <p class="me-stop-lead">${s === 'outdoor' ? 'Stop walking' : 'Stop the belt safely'} and seek medical care if you have:</p>
    <ul class="me-stop-list">${items.map(([ic, t]) => `<li><span class="me-stop-ico">${icon(ic)}</span><span>${esc(t)}</span></li>`).join('')}</ul>
    <p class="me-stop-how"><b>To stop safely:</b> ${how}</p>
    <p class="me-emergency">${icon('alert')}<span>If symptoms are severe or don’t ease quickly with rest, call your local emergency number.</span></p>
  </div>`;
}

function safetyPage() {
  const p = P(), r = state.main.readiness;
  const qs = READINESS_QUESTIONS.filter((q) => !(q.id === 'pregnant' && p.sex === 'male'));
  const answered = qs.some((q) => typeof r.answers[q.id] === 'boolean');
  let status;
  if (!answered) status = banner('', 'info', 'No readiness answers yet', 'Answer a few questions so Walking Companion can tell you when to check with your doctor first.');
  else if (r.doctorFlag && !r.doctorAck) status = banner('warn', 'alert', 'Check with your doctor', 'One or more of your answers suggests checking with a doctor before harder exercise. Until you confirm below, your plan sticks to light and moderate workouts, and 4×4 Intervals and Sprint Intervals stay locked.');
  else if (r.doctorFlag) status = banner('good', 'check', 'You’ve checked with your doctor', 'Your plan can include harder intervals as it progresses. If your health changes, review your answers.');
  else status = banner('good', 'check', 'No doctor check flagged', 'None of your answers needed a doctor check. If your health changes, review your answers.');

  const extra = [];
  if (r.achilles) extra.push('You mentioned an Achilles or calf problem. Build incline slowly, and you’ll see a reminder before steep sessions.');
  if (r.betaBlocker) extra.push('Your medicine can change your heart rate, so judge effort with the talk test rather than heart rate.');
  if (r.pregnant) extra.push('During pregnancy, hard intervals are hidden. Follow the advice of your midwife or doctor.');

  const treadmillSafety = sec({
    title: 'On a treadmill or walking pad',
    rows: [
      staticRow({ title: 'Clip on the safety key', sub: 'Attach it to your clothing every time, if your machine has one. If you slip, it stops the belt.', iconName: 'lock' }),
      staticRow({ title: 'Start the belt slowly', sub: 'On a treadmill, stand on the side rails to start it, then step on.', iconName: 'grip' }),
      staticRow({ title: 'Hold on while settings change', sub: 'Use the rails while speed or incline changes, then let go once you’re steady. No rails? Keep to a pace you can hold without support.', iconName: 'hand' }),
      staticRow({ title: 'Slow down before stepping off', sub: 'Bring the belt to a walk or a stop first. Never step off backwards.', iconName: 'stop' }),
      staticRow({ title: 'Go easy on steep inclines', sub: 'Steep climbs load your calves and Achilles tendons. Lower the incline if they hurt.', iconName: 'incline' }),
    ].join(''),
  });
  const outdoorSafety = sec({
    title: 'Outdoors',
    rows: [
      staticRow({ title: 'Be seen', sub: 'Wear bright or reflective clothing and carry a light after dark. With no pavement or path, walk facing oncoming traffic.', iconName: 'sun' }),
      staticRow({ title: 'Keep hearing the road', sub: 'Set your cues to a volume that still lets you hear traffic and cyclists.', iconName: 'voice' }),
      staticRow({ title: 'Mind the heat', sub: 'On hot days walk early or late, choose shade and carry water on longer walks.', iconName: 'alert' }),
    ].join(''),
  });

  const ansRows = answered
    ? qs.map((q) => { const a = r.answers[q.id]; return staticRow({ title: q.text, value: a === true ? 'Yes' : a === false ? 'No' : 'Not answered', cls: 'me-q' + (a === true ? ' yes' : '') }); }).join('')
    : '';

  return `<section class="me-sec"><h2 class="group-title">Stop signs</h2><div class="card me-stop-card">${stopSignsHtml()}</div></section>
    ${usualSurface(p) === 'outdoor' ? outdoorSafety + treadmillSafety : treadmillSafety + outdoorSafety}
    <section class="me-sec me-ready"><h2 class="group-title">Your readiness</h2>${status}
      ${r.doctorFlag ? `<div class="group">${switchRow({ id: 'me-sw-doc', sw: 'doctorAck', title: 'I’ve checked with my doctor', sub: 'A doctor has said harder exercise, such as jogging intervals, is OK for me', checked: !!r.doctorAck, iconName: 'shield' })}</div>` : ''}
      ${extra.length ? `<div class="card tight me-notes">${extra.map((t) => `<p>${esc(t)}</p>`).join('')}</div>` : ''}
    </section>
    ${answered ? sec({ title: 'Your answers', rows: ansRows, note: r.acceptedAt ? `You confirmed that Walking Companion is not a medical device on ${esc(dateMed(r.acceptedAt))}.` : '' }) : ''}
    <button type="button" class="btn btn-ghost btn-block" data-act="review-readiness">${icon('edit')}${answered ? 'Review my answers' : 'Answer the questions'}</button>
    ${sec({
      title: 'Food and weight',
      rows: staticRow({ title: 'Support is available', sub: 'If food or weight feels hard to think about, consider talking to your doctor or an eating-disorder support service.', iconName: 'heart' })
        + switchRow({ id: 'me-sw-nonum2', sw: 'noNumbers', title: 'Train without calorie and weight numbers', sub: 'See minutes, distance and climb instead', checked: !!p.noNumbers }),
    })}`;
}

function openStopSigns() {
  const showLink = !immersive();
  const s = sheet(stopSignsHtml() + (showLink ? `<button type="button" class="btn btn-ghost btn-block" data-more>${icon('shield')}More in Health & safety</button>` : ''), {
    title: 'Stop signs',
    label: 'Stop signs: when to stop exercising',
    footer: '<button type="button" class="btn btn-primary" data-close>Got it</button>',
  });
  const more = s.el.querySelector('[data-more]');
  if (more) more.addEventListener('click', () => { s.close(); actions.go('me', 'safety'); });
  return s;
}

/* ----- Privacy, terms, support ----- */

// On iPhone, Me shows the text of the bundled legal pages (legal/privacy.html and legal/support.html, copied into www/
// by the build and hosted for the App Store listing), so the in-app policy always matches the published one.
// The web builds have no bundled pages and use the short policy below.
const legal = {}; // 'privacy' | 'support' -> parsed content, null while loading, false when unavailable
const LEGAL_DROP = 'script,style,link,meta,iframe,object,embed,form,input,button,select,textarea,svg,img,video,audio,template,nav,footer';
const LEGAL_TAGS = new Set(['P', 'H2', 'H3', 'H4', 'UL', 'OL', 'LI', 'B', 'STRONG', 'EM', 'I', 'A', 'SPAN', 'BR', 'DIV', 'DL', 'DT', 'DD', 'SECTION']);
function legalHref(h) {
  if (/^mailto:[^\s"'<>]+$/i.test(h)) return h;
  if (/(^|\/)privacy\.html$/i.test(h)) return '#me-privacy';
  if (/(^|\/)support\.html$/i.test(h)) return '#me-support';
  return null; // in-page anchors and anything else become plain text
}
/** Clean HTML of one element from a bundled page: known tags only, no ids or handlers, classes prefixed lg-, h2/h3 one level down. */
function legalHtml(el) {
  if (!el) return '';
  const box = el.cloneNode(true);
  box.querySelectorAll(LEGAL_DROP).forEach((n) => n.remove());
  for (const n of [...box.querySelectorAll('*')].reverse()) {
    if (!LEGAL_TAGS.has(n.tagName)) { n.replaceWith(...n.childNodes); continue; }
    for (const at of [...n.attributes]) {
      const name = at.name.toLowerCase();
      if (name === 'class') n.setAttribute('class', at.value.split(/\s+/).filter(Boolean).map((c) => 'lg-' + c.replace(/[^\w-]/g, '')).join(' '));
      else if (name === 'href' && n.tagName === 'A' && legalHref(at.value.trim())) n.setAttribute('href', legalHref(at.value.trim()));
      else n.removeAttribute(at.name);
    }
    if (n.tagName === 'H2' || n.tagName === 'H3') {
      const h = document.createElement(n.tagName === 'H2' ? 'h3' : 'h4');
      h.append(...n.childNodes);
      n.replaceWith(h);
    }
  }
  return box.innerHTML.trim();
}
function parseLegal(name, html) {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  if (name === 'privacy') {
    const main = doc.querySelector('main');
    if (!main) return false;
    return {
      date: (doc.querySelector('header .dates')?.textContent || '').trim(),
      short: [...doc.querySelectorAll('.hero li')].map((li) => legalHtml(li.querySelector('span') || li)).filter(Boolean),
      html: legalHtml(main),
    };
  }
  const faq = [...doc.querySelectorAll('.faq details')].map((d) => [(d.querySelector('summary')?.textContent || '').trim(), legalHtml(d.querySelector('.answer'))]).filter(([q, a]) => q && a);
  return faq.length ? { faq } : false;
}
function loadLegal(name) {
  if (!isNative || legal[name] !== undefined || typeof fetch !== 'function' || typeof DOMParser === 'undefined') return;
  legal[name] = null;
  fetch(`${name}.html`)
    .then((r) => (r.ok ? r.text() : Promise.reject(new Error(String(r.status)))))
    .then((html) => { legal[name] = parseLegal(name, html); })
    .catch(() => { legal[name] = false; })
    .then(() => { if (currentView && currentView.page === name) repaintCurrent(); });
}

function privacyPage() {
  if (isNative && legal.privacy !== false) {
    const d = legal.privacy;
    if (!d) return `<article class="card me-doc prose" aria-busy="true"><p class="me-doc-date">Loading…</p></article>`;
    return `<article class="card me-doc prose me-legal">
      ${d.date ? `<p class="me-doc-date">${esc(d.date)}</p>` : ''}
      ${d.short.length ? `<h3>The short version</h3><ul class="lg-short">${d.short.map((x) => `<li>${x}</li>`).join('')}</ul>` : ''}
      ${d.html}
    </article>
    <button type="button" class="btn btn-ghost btn-block" data-act="go-data">${icon('download')}Back up or erase your data</button>`;
  }
  const dev = deviceWord();
  const storeTxt = cloud()
    ? 'In this web version, your data is saved privately to your account so it’s there wherever you open Walking Companion. Other people can’t see it.'
    : isNative
      ? 'They are kept in Walking Companion’s private storage on your iPhone. If you use iCloud or computer backups, they’re included in those backups, which Apple handles.'
      : 'They are kept in this browser’s storage on your device. Clearing your browser data deletes them.';
  const short = cloud()
    ? 'Walking Companion has no analytics, no ads and no tracking. What you enter is saved privately to your account, under your control.'
    : `Walking Companion has no account, no analytics, no ads and no tracking. What you enter stays on your ${dev}, under your control.`;
  return `<article class="card me-doc prose">
    <p class="me-doc-date">Last updated ${POLICY_DATE}</p>
    <p><b>The short version:</b> ${short}</p>
    <h3>What Walking Companion stores</h3>
    <p>Your plan answers (such as age, height, weight and goal), readiness answers, workouts, weigh-ins, custom workouts and settings. ${storeTxt}</p>
    <h3>What we don’t collect</h3>
    <p>We don’t run servers that receive your data. Walking Companion has no analytics or advertising tools and no third-party tracking. We can’t see your data, and we never sell or share it.</p>
    ${features.health ? `<h3>Apple Health</h3>
    <p>If you connect Apple Health, Walking Companion saves your workouts (walks or runs with estimated active energy and distance) and your weigh-ins, and reads your body weight to keep your trend up to date. Health data is used only for these features. It is never shared, never used for advertising or marketing, and never leaves your iPhone through Walking Companion. You can change or remove access at any time in the Health app.</p>` : ''}
    <h3>${features.notifications ? 'Notifications and voice' : 'Voice cues'}</h3>
    <p>${features.notifications ? 'Reminders and workout cues are local notifications scheduled on your iPhone. No push service or server is involved. ' : ''}Spoken cues use the speech voices built into your device.${isNative ? '' : ' In a web browser, some voices supplied by the browser may be processed online by the browser maker.'}</p>
    <h3>Your controls</h3>
    <p>You can export all your data as a backup file or a spreadsheet, and erase everything, in Me, then Back up & restore.${isNative ? ' Deleting the app also deletes its data from your iPhone.' : ''}</p>
    <h3>Children</h3>
    <p>Walking Companion is for ages 13 and up. Weight-loss targets and calorie intake suggestions are shown to adults only. It is not directed at children under 13.</p>
    <h3>Changes</h3>
    <p>If this policy changes, we’ll update this page and the date at the top.</p>
    <h3>Contact</h3>
    <p>Questions about privacy: ${contactHtml()}</p>
  </article>
  <button type="button" class="btn btn-ghost btn-block" data-act="go-data">${icon('download')}Back up or erase your data</button>`;
}

function termsPage() {
  return `<article class="card me-doc prose">
    <p class="me-doc-date">Last updated ${POLICY_DATE}</p>
    <h3>Licence</h3>
    ${isNative
    ? `<p>This app uses Apple’s standard licence agreement. Your use of Walking Companion is governed by Apple’s Licensed Application End User License Agreement, available at <span class="me-select-text">apple.com/legal/internet-services/itunes/dev/stdeula</span>.</p>`
    : `<p>Walking Companion is free to use for your personal training. These terms apply to your use of the Walking Companion web app.</p>`}
    <h3>Not medical advice</h3>
    <p>Walking Companion provides general fitness information and workout guidance. It is not a medical device. It doesn’t diagnose, treat or prevent any condition, and it isn’t a substitute for advice from a doctor or other qualified professional. Check with your doctor before starting a new exercise programme or changing how you eat, especially if you have a health condition, are pregnant or take regular medicine.</p>
    <h3>Exercise safely</h3>
    <p>Exercise carries a risk of injury. You choose and control your treadmill settings and your route. On a treadmill, use the safety key and follow its maker’s instructions; outdoors, take care around traffic. Stop straight away if you feel unwell. Health & safety lists the warning signs.</p>
    <h3>Estimates</h3>
    <p>Calories, distance, climb, intake suggestions and weight projections are estimates based on published equations. They can differ substantially from actual values, and they are not a promise of any result.</p>
    <h3>Your data</h3>
    <p>Your data stays on your device. Keeping a backup is up to you; Back up & restore makes it easy.</p>
    <h3>Changes</h3>
    <p>We may update the app and these terms. If the terms change, we’ll update this page and the date at the top.</p>
    <h3>Contact</h3>
    <p>${contactHtml()}</p>
  </article>
  <button type="button" class="btn btn-ghost btn-block" data-act="go-safety">${icon('shield')}Health & safety</button>`;
}

function supportPage() {
  const platform = isNative ? 'iPhone' : isArtifact ? 'web' : 'browser';
  let faq = [
    isNative
      ? ['Why do voice cues stop when my phone locks?', `<p>iPhone pauses apps when the screen locks, so spoken cues play only while Walking Companion is on screen. Walking Companion keeps the screen awake during a workout. If the phone does lock, interval changes arrive as notifications with a sound (or a vibration on silent), as long as you’ve allowed notifications in Me, then Reminders.</p>`]
      : ['Why do voice cues stop when my screen locks?', `<p>Browsers pause pages that aren’t on screen, so spoken cues play only while Walking Companion is open and visible. During a workout Walking Companion asks your browser to keep the screen awake, where your browser allows it. Keep the page open on your treadmill console and turn the volume up.</p>`],
    ['Why don’t my calories match my treadmill or watch?', `<p>Every device uses its own formula. Walking Companion shows estimated active energy from the ACSM equations, which leaves out the energy you’d use at rest anyway, while many treadmills show total energy. All of these are estimates and can differ substantially from your actual burn. <a class="me-inline" href="#me-calc">How we calculate</a></p>`],
    ['How do I back up my data?', `<p>Go to Me, then Back up & restore, and tap Export backup. Save the file somewhere safe, such as iCloud Drive or Files. To restore, tap Import backup and choose the file. A monthly backup is a good habit. <a class="me-inline" href="#me-data">Back up now</a></p>`],
    ['How do I change my plan or training days?', `<p>Tap Edit plan answers on the Me tab to change your goal, schedule, where you walk or readiness answers. Your plan updates from the current week.</p>`],
  ];
  if (isNative && legal.support) faq = legal.support.faq; // the same answers as the published support page
  if (USE_LINK) return `<section class="card me-contact">
      <p class="eyebrow">Get help</p>
      <p class="body-s">Report a problem or ask a question on the Walking Companion support page. A real person reads every message.</p>
      <div class="btn-row">
        <a class="btn btn-primary me-btn" href="${esc(SUPPORT_URL)}" target="_blank" rel="noopener noreferrer">${icon('external')}Open support page</a>
      </div>
      <p class="body-xs">Please mention your app version: Walking Companion ${esc(VERSION)} (${platform}).</p>
    </section>
    <section class="me-sec"><h2 class="group-title">Common questions</h2><div class="group me-faq ${isNative && legal.support ? 'me-legal' : ''}">${faq.map(([q, a]) => `<details><summary><span>${esc(q)}</span>${icon('chevD')}</summary><div class="me-faq-body">${a}</div></details>`).join('')}</div></section>`;
  return `<section class="card me-contact">
      <p class="eyebrow">Email support</p>
      <p class="me-email" id="me-email">${esc(SUPPORT_EMAIL)}</p>
      <div class="btn-row">
        <button type="button" class="btn btn-primary" data-act="copy-email">${icon('copy')}Copy address</button>
        ${isNative ? `<a class="btn me-btn btn-ghost" href="mailto:${esc(SUPPORT_EMAIL)}?subject=${encodeURIComponent(`Walking Companion ${VERSION} support`)}">${icon('mail')}Write an email</a>` : ''}
      </div>
      <p class="body-xs">Please mention your app version: Walking Companion ${esc(VERSION)} (${platform}).</p>
    </section>
    <section class="me-sec"><h2 class="group-title">Common questions</h2><div class="group me-faq ${isNative && legal.support ? 'me-legal' : ''}">${faq.map(([q, a]) => `<details><summary><span>${esc(q)}</span>${icon('chevD')}</summary><div class="me-faq-body">${a}</div></details>`).join('')}</div></section>`;
}

function unavailable(msg) {
  return `<div class="empty"><h2 class="title-m">Not available here</h2><p>${esc(msg)}</p><a class="btn me-btn btn-primary" href="#me">Back to Me</a></div>`;
}

/* ----- Lessons ----- */

function lessonsPage() {
  const read = state.main.lessonsRead || {}, open = unlockedCount();
  const nRead = LESSONS.filter((l) => read[l.id]).length;
  const done = doneCount();
  const head = `<div class="card me-lessons-head">
      <div class="card-row"><span class="title-s">${open} of ${LESSONS.length} unlocked</span><span class="body-s">${nRead} read</span></div>
      <div class="pbar" role="progressbar" aria-label="Lessons unlocked" aria-valuemin="0" aria-valuemax="${LESSONS.length}" aria-valuenow="${open}"><i style="width:${(open / LESSONS.length) * 100}%"></i></div>
      <p class="body-s">${open >= LESSONS.length ? 'Every lesson is open. Read them in any order.' : 'A new lesson unlocks each time you finish a workout.'}</p>
    </div>`;
  const rows = LESSONS.map((l, i) => {
    const n = i + 1;
    if (i < open) {
      const isRead = !!read[l.id];
      return `<a class="row has-icon me-lesson-row" href="#lesson-${esc(l.id)}"><span class="row-icon ${isRead ? 'me-read' : ''}">${icon(isRead ? 'check' : 'book')}</span><span class="row-main"><span class="row-title">${esc(l.title)}</span><span class="row-sub">Lesson ${n} · ${l.minutes} min read${isRead ? ' · Read' : ''}</span></span>${isRead ? '' : '<span class="tag">New</span>'}${icon('chevR', 'chev')}</a>`;
    }
    const more = n - done;
    return `<div class="row has-icon me-lesson-row locked"><span class="row-icon">${icon('lock')}</span><span class="row-main"><span class="row-title">${esc(l.title)}</span><span class="row-sub">Unlocks after ${more <= 1 ? 'your next workout' : `${more} more workouts`}</span></span></div>`;
  }).join('');
  return head + sec({ rows });
}

function markLessonRead(id) {
  const i = LESSONS.findIndex((l) => l.id === id);
  if (i < 0 || i >= unlockedCount()) return;
  if ((state.main.lessonsRead || {})[id]) return;
  save((m) => { m.lessonsRead = { ...(m.lessonsRead || {}), [id]: new Date().toISOString() }; });
}

function lessonPageHtml(v) {
  const l = lessonById(v.lesson);
  if (!l) {
    return `${navBar('Lesson', { back: 'Lessons' })}<div class="empty"><h2 class="title-m">Lesson not found</h2><p>It may have moved. Your other lessons are still here.</p><a class="btn me-btn btn-primary" href="#me-lessons">See all lessons</a></div>`;
  }
  const i = LESSONS.indexOf(l), n = i + 1, open = unlockedCount();
  const nav = navBar(i >= open ? `Lesson ${n}` : l.title, { back: 'Lessons' });
  if (i >= open) {
    const more = n - doneCount();
    return `${nav}<div class="empty"><span class="me-lock-art">${icon('lock')}</span><h2 class="title-m">${esc(l.title)}</h2><p>This lesson unlocks after ${more <= 1 ? 'your next workout' : `${more} more workouts`}.</p><a class="btn me-btn btn-primary" href="#me-lessons">See all lessons</a></div>`;
  }
  const next = LESSONS[i + 1];
  let foot;
  if (next && i + 1 < open) foot = `<a class="btn me-btn btn-primary btn-block" href="#lesson-${esc(next.id)}">Next: ${esc(next.title)}${icon('chevR')}</a>`;
  else if (next) foot = `<p class="body-s me-center">The next lesson, “${esc(next.title)}”, unlocks after your next workout.</p><a class="btn me-btn btn-ghost btn-block" href="#me-lessons">See all lessons</a>`;
  else foot = `<p class="body-s me-center">That’s every lesson. Nice work.</p><a class="btn me-btn btn-ghost btn-block" href="#me-lessons">See all lessons</a>`;
  return `${nav}
    <article class="me-lesson">
      <p class="eyebrow">Lesson ${n} of ${LESSONS.length} · ${l.minutes} min read</p>
      <h1 class="title-l me-h1">${esc(l.title)}</h1>
      <div class="card me-doc prose">${l.body}<p class="me-source"><b>Source:</b> ${esc(l.source)}</p></div>
    </article>
    <div class="stack">${foot}</div>`;
}

/* ---------------- live text ---------------- */

const LIVE = {
  'goal-hint': goalHint,
  'pace-note': paceNote,
  'tm-note': treadmillNote,
  'paces-note': pacesNote,
  'backup-note': backupNote,
  'sync-row': syncRowHtml,
  account: accountRowHtml,
};

/* ---------------- events ---------------- */

function setErr(v, key, msg) {
  const el = v.root.querySelector(`[data-err="${key}"]`);
  if (el) el.textContent = msg || '';
  const inputs = key === 'height' ? v.root.querySelectorAll('[data-field="height"],[data-field="hft"],[data-field="hin"]') : v.root.querySelectorAll(`[data-field="${key}"]`);
  inputs.forEach((i) => { if (msg) i.setAttribute('aria-invalid', 'true'); else i.removeAttribute('aria-invalid'); });
}

/** Commit a text field. Returns an error message, 'repaint', or null. */
function commitField(v, field, input) {
  const raw = input.value;
  const p = P();
  switch (field) {
    case 'age': {
      const n = parseNum(raw);
      if (n == null) return 'Enter your age.';
      if (Number.isNaN(n) || n !== Math.round(n)) return 'Enter your age in whole years.';
      if (n < 13) return 'Walking Companion is made for ages 13 and up.';
      if (n > 100) return 'Enter an age up to 100.';
      let toFit = false;
      save((m) => { m.profile.age = n; if (n < 18 && m.profile.goal === 'lose') { m.profile.goal = 'fitter'; m.profile.goalWeight = null; toFit = true; } });
      if (toFit) { toast('Weight-loss targets are for adults, so your plan now focuses on fitness.'); return 'repaint'; }
      return null;
    }
    case 'height': {
      const n = parseNum(raw);
      if (n == null || Number.isNaN(n) || n < 120 || n > 230) return 'Enter a height between 120 and 230 cm.';
      save((m) => { m.profile.heightCm = r1(n); });
      input.value = String(Math.round(n));
      return null;
    }
    case 'hft': case 'hin': {
      const ft = parseNum(v.root.querySelector('[data-field="hft"]').value);
      const inch = parseNum(v.root.querySelector('[data-field="hin"]').value) ?? 0;
      if (ft == null || Number.isNaN(ft) || Number.isNaN(inch)) return 'Enter your height in feet and inches.';
      if (inch < 0 || inch >= 12) return 'Inches should be between 0 and 11.';
      const cm = r1((ft * 12 + inch) * 2.54);
      if (cm < 120 || cm > 230) return 'Enter a height between 3′ 11″ and 7′ 6″.';
      save((m) => { m.profile.heightCm = cm; });
      return null;
    }
    case 'start': {
      const n = parseNum(raw);
      if (n == null || Number.isNaN(n)) return 'Enter your starting weight.';
      const kg = fromWeight(n);
      if (kg < 35 || kg > 300) return `Enter a weight between ${fmtInt(toWeight(35))} and ${fmtInt(toWeight(300))} ${weightUnit()}.`;
      save((m) => { m.profile.startWeight = r2(kg); });
      input.value = fmt1(n);
      return null;
    }
    case 'goalw': {
      const n = parseNum(raw);
      if (n == null) { save((m) => { m.profile.goalWeight = null; }); return null; }
      if (Number.isNaN(n)) return 'Enter a number for your goal weight.';
      const kg = fromWeight(n);
      const hr = healthyRange(p.heightCm), cur = bodyKg();
      if (hr && kg < hr.low - 0.05) return `Let’s pick a goal inside the healthy range. For your height, that starts at ${wStr(hr.low)}.`;
      if (kg < 35) return `Enter a goal above ${fmtInt(toWeight(35))} ${weightUnit()}.`;
      if (kg > cur - 0.45) return `Your goal should be below your current weight of ${wStr(cur)}.`;
      save((m) => { m.profile.goalWeight = r2(kg); });
      input.value = fmt1(n);
      return null;
    }
    case 'remtime': {
      if (!/^\d{2}:\d{2}$/.test(raw)) return null;
      save((m) => { m.profile.reminders.time = raw; });
      if (p.reminders.enabled) scheduleReminders(state.main.plan.days || [], raw);
      return null;
    }
    default: return null;
  }
}

function onInputView(v, e) {
  const t = e.target;
  if (t.dataset.field === 'name') save((m) => { m.profile.name = t.value.trim().slice(0, 40); });
}

function onChangeView(v, e) {
  const t = e.target;
  if (!v.root.contains(t)) return;
  if (t.dataset.field && t.dataset.field !== 'name') {
    const field = t.dataset.field;
    const errKey = field === 'hft' || field === 'hin' ? 'height' : field;
    const res = commitField(v, field, t);
    if (res === 'repaint') { paint(v); return; }
    setErr(v, errKey, res);
    if (!res) {
      // a valid height or weight can clear a goal-weight error that depended on it
      if (errKey !== 'goalw' && v.root.querySelector('[data-err="goalw"]')?.textContent) {
        const g = v.root.querySelector('[data-field="goalw"]');
        if (g) setErr(v, 'goalw', commitField(v, 'goalw', g));
      }
      updateLive(v);
    }
    return;
  }
  if (t.dataset.select === 'voice') { save((m) => { m.profile.cues.voiceId = t.value || null; }); return; }
  if (t.dataset.sw) onSwitch(v, t.dataset.sw, t.checked, t);
}

async function onSwitch(v, sw, on, input) {
  switch (sw) {
    case 'haptics': save((m) => { m.profile.haptics = on; }); if (on) haptic('medium'); break;
    case 'noNumbers': save((m) => { m.profile.noNumbers = on; }); haptic('selection'); paint(v); break;
    case 'hideWeight': save((m) => { m.profile.hideWeight = on; }); v.revealWeight = false; haptic('selection'); paint(v); break;
    case 'walkOnly':
      save((m) => { m.profile.walkOnly = on; });
      haptic('selection');
      paint(v);
      toast(on ? 'Walking only: jogs become power walking' : P().canJog === 'yes' ? 'Short jogs are back in your plan' : 'Jogs can join your plan when you’re ready');
      break;
    case 'handsFree': save((m) => { m.profile.treadmill.handsFree = on; }); break;
    case 'voice': save((m) => { m.profile.cues.voice = on; }); if (on) loadVoices(v); else stopSpeaking(); paint(v); break;
    case 'beeps': save((m) => { m.profile.cues.beeps = on; }); if (on) { unlockAudio(); beep('tick'); } break;
    case 'reminders': input.disabled = true; await setReminders(v, on); break;
    case 'health': if (!on) { save((m) => { m.profile.health.enabled = false; }); toast('Apple Health off. Walking Companion won’t save or read Health data.'); paint(v); } break;
    case 'watch': save((m) => { m.profile.health.watch = on; }); break;
    case 'doctorAck': {
      if (on) {
        const ok = await confirmSheet({
          title: 'Checked with your doctor?',
          body: 'Only confirm if a doctor has said harder exercise, such as jogging intervals, is OK for you. Your plan can then include harder sessions as it progresses.',
          confirm: 'I’ve checked',
        });
        if (!ok) { input.checked = false; return; }
        save((m) => { m.readiness.doctorAck = true; });
        toast('Thanks. Your plan can now include harder intervals.');
      } else {
        save((m) => { m.readiness.doctorAck = false; });
        toast('Your plan will stick to light and moderate workouts.');
      }
      paint(v);
      break;
    }
    default: break;
  }
}

function onSeg(v, name, value) {
  switch (name) {
    case 'sex': save((m) => { m.profile.sex = value; }); break;
    case 'u-speed': save((m) => { m.profile.units.speed = value; }); paint(v); break;
    case 'u-weight': save((m) => { m.profile.units.weight = value; }); paint(v); break;
    case 'u-height': save((m) => { m.profile.units.height = value; }); paint(v); break;
    case 'lead': save((m) => { m.profile.cues.lead = +value; }); break;
    default: break;
  }
}

function onPick(v, group, value, el) {
  if (el.getAttribute('aria-disabled') === 'true') { if (group === 'pace') toast('That pace is faster than 1% of your weight a week'); return; }
  haptic('selection');
  switch (group) {
    case 'pace': save((m) => { m.profile.pace = value; }); break;
    case 'activity': save((m) => { m.profile.activity = value; }); break;
    case 'detail': save((m) => { m.profile.cues.detail = +value; }); break;
    case 'surface': if (!SURFACES[value] || value === usualSurface()) return; save((m) => { setUsualSurface(m, value); }); break;
    case 'appearance': save((m) => { m.profile.appearance = value; }); applyTheme(value); break;
    default: return;
  }
  paint(v);
}

function onStep(v, id, dir, btn) {
  const s = STEPPERS[id];
  if (!s || btn.getAttribute('aria-disabled') === 'true') return;
  const n = stepValue(s, dir);
  if (n === s.get()) return;
  s.set(n);
  haptic('selection');
  const box = v.root.querySelector(`[data-stepper="${id}"] .val`);
  const unit = val(s.unit);
  if (box) box.innerHTML = `${s.text(n)}${unit ? `<small>${esc(unit)}</small>` : ''}`;
  updateLive(v);
}

async function resetPaces(v) {
  const max = P().treadmill.maxSpeed || 16;
  const def = DEFAULT_PROFILE.paces;
  const list = MODE_IDS.map((t) => `${MODES[t].name} ${fmt1(toSpeed(Math.min(def[t], max)))}`).join(', ');
  const ok = await confirmSheet({ title: 'Reset your paces?', body: `Back to the suggested starting paces: ${esc(list)} ${speedUnit()}.`, confirm: 'Reset paces' });
  if (!ok) return;
  save((m) => { m.profile.paces = Object.fromEntries(MODE_IDS.map((t) => [t, Math.min(def[t], max)])); });
  paint(v);
  toast('Paces reset');
}

function onClickView(v, e) {
  const st = e.target.closest('[data-stepper] button');
  if (st && v.root.contains(st)) { onStep(v, st.closest('[data-stepper]').dataset.stepper, +st.dataset.dir, st); return; }
  const ch = e.target.closest('[data-choice]');
  if (ch && v.root.contains(ch)) { onPick(v, ch.dataset.choice, ch.dataset.value, ch); return; }
  const a = e.target.closest('[data-act]');
  if (!a || !v.root.contains(a) || a.disabled) return;
  switch (a.dataset.act) {
    case 'edit-name': editName(); break;
    case 'edit-plan': actions.openOnboarding({ edit: true }); break;
    case 'edit-goal': actions.openOnboarding({ edit: true, step: 'goal' }); break;
    case 'reveal-weight': v.revealWeight = true; paint(v); { const f = v.root.querySelector('#me-f-start'); if (f) f.focus({ preventScroll: true }); } break;
    case 'reset-paces': resetPaces(v); break;
    case 'test-voice': testVoice(); break;
    case 'allow-notif': requestNotifications().then((p) => { notifPerm = p; if (v.root.isConnected) paint(v); if (p === 'granted') toast('Notifications allowed'); }); break;
    case 'connect-health': connectHealth(v); break;
    case 'export-backup': exportBackup(); break;
    case 'export-csv': exportCsv(); break;
    case 'import-backup': importBackup(); break;
    case 'erase': eraseAll(); break;
    case 'review-readiness': actions.openOnboarding({ edit: true, step: 'readiness' }); break;
    case 'go-data': actions.go('me', 'data'); break;
    case 'go-safety': actions.go('me', 'safety'); break;
    case 'sign-out': signOut(); break;
    case 'copy-email':
      copyText(SUPPORT_EMAIL).then((ok) => {
        if (ok) { haptic('success'); toast('Email address copied'); } else toast('Couldn’t copy. Press and hold the address to copy it.');
      });
      break;
    default: break;
  }
}

/* ---------------- actions ---------------- */

actions.openStopSigns = () => openStopSigns();
actions.openHowWeCalculate = () => {
  // Over a full-screen flow (onboarding, player, summary) show it in a sheet so the flow stays put.
  if (immersive()) return sheet(calcHtml(), { title: 'How we calculate' });
  actions.go('me', 'calc');
  return null;
};
actions.openLesson = (id) => actions.go('lesson', id);
actions.importBackup = () => importBackup();
actions.exportBackup = () => exportBackup();

/* ---------------- screen ---------------- */

function renderMe(root, param, ctx = {}) {
  const page = param && Object.prototype.hasOwnProperty.call(PAGES, param) ? param : null;
  return mount(root, { page }, ctx);
}
function renderLesson(root, param, ctx = {}) {
  return mount(root, { lesson: param || '' }, ctx);
}

export default {
  route: 'me',
  tab: 'me',
  title: 'Me',
  render: renderMe,
  routes: [
    { route: 'me', tab: 'me', title: 'Me', render: renderMe },
    { route: 'lesson', tab: 'me', title: 'Lesson', render: renderLesson },
  ],
};
