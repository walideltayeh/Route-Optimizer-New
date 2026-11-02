// Custom workout builder (full-screen overlay) and the Quick Draft sheet.
// Registers actions.openBuilder({ id, draft, restore }) and actions.openQuickDraft().
//
// Builder model (never stored in the DOM):
//   items = [step | repeat]
//   step   = { key, k: 'step', type, dur (s), speed ('' = follow the pace for that mode, else text in the user's unit), incline, label }
//   repeat = { key, k: 'rep', rounds, steps: [step, step] }   (work step + recovery step, played `rounds` times)
// While there are unsaved changes the model is mirrored to localStorage 'hp.draft', so a reload does not lose work.
import { state } from '../core/store.js';
import * as store from '../core/store.js';
import { MODES, MODE_IDS, INTENSITY, customs, personalise, planStats, speedFor, quickDraft, currentWeek, levelForWeek, restrictedToModerate, mainMode as programMainMode } from '../core/program.js';
import { roundKcal } from '../core/science.js';
import { esc, clock, fmt1, toSpeed, fromSpeed, speedUnit, speedStr, distStr, distUnit, toElev, elevUnit } from '../core/format.js';
import { haptic } from '../core/platform.js';
import { actions } from '../ui/actions.js';
import { icon, modeIcon, sheet, confirmSheet, toast, segmented, bindSegmented, stepperHtml, closeAllSheets, RM } from '../ui/kit.js';
import { intervalChart, modeLegend } from '../ui/charts.js';

export const DRAFT_KEY = 'hp.draft';
const WORK = new Set(['power', 'jog', 'run']);
const MIN_STEP = 15, MAX_STEP = 60 * 60;
const MIN_TOTAL = 5 * 60, MAX_TOTAL = 120 * 60;
const ROUNDS_MIN = 2, ROUNDS_MAX = 20;

const prof = () => state.main.profile;

/* ---------------- helpers shared with library.js ---------------- */

/** The plan level (0-2) for this week; used for custom workouts and as the default phase. */
export function curLevel() {
  const weeks = state.main.plan.weeks || 12;
  return levelForWeek(Math.min(weeks, Math.max(1, currentWeek())));
}
/** The workout's main work mode (program.mainMode): the one rule every Start button uses for its colour. */
export const mainMode = programMainMode;
/** Modes present, easiest first. */
export const modesIn = (segs) => MODE_IDS.filter((t) => segs.some((s) => s.type === t));

/** Time axis under an interval chart; drops a tick that would collide with the end label. */
export function chartTicks(segs) {
  const total = segs.reduce((a, s) => a + s.dur, 0);
  if (!total) return '';
  const mins = Math.round(total / 60);
  const step = mins > 50 ? 10 : 5;
  const marks = [];
  for (let m = 0; m < mins; m += step) marks.push(m);
  while (marks.length > 1 && (mins - marks[marks.length - 1]) / Math.max(1, mins) < 0.16) marks.pop();
  return `<div class="chart-ticks" aria-hidden="true">${marks.map((m) => `<span style="left:${((m * 60) / total) * 100}%">${m}</span>`).join('')}<span style="left:100%">${mins} min</span></div>`;
}
/** Full interval chart with a non-overlapping time axis. */
export const profileChart = (segs, opts = {}) => `${intervalChart(segs, { ...opts, ticks: false })}${chartTicks(segs)}`;

export function readDraft() {
  try {
    const d = JSON.parse(localStorage.getItem(DRAFT_KEY) || 'null');
    return d && d.v === 1 && d.model && Array.isArray(d.model.items) && d.model.items.length ? d : null;
  } catch { return null; }
}
export function clearDraft() { try { localStorage.removeItem(DRAFT_KEY); } catch { /* storage blocked */ } }

/* ---------------- limits, parsing, formatting ---------------- */

function lim() {
  const t = prof().treadmill;
  return { maxS: +t.maxSpeed || 20, maxI: t.hasIncline ? +(t.maxIncline ?? 15) : 0, hasIncline: !!t.hasIncline };
}
const incTxt = (i) => `${fmt1(i)}%`;
const clampDur = (d) => Math.max(MIN_STEP, Math.min(MAX_STEP, Math.round(+d || 0)));
const half = (x) => Math.round((+x || 0) * 2) / 2;
/** '' -> null (follow pace); '6.5' -> km/h; anything unparseable -> NaN */
function parseSpeed(str) {
  const t = String(str ?? '').trim().replace(',', '.');
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) ? fromSpeed(n) : NaN;
}
function roleFor(label, type) {
  const l = String(label || '').trim().toLowerCase();
  if (/^warm[\s-]?up/.test(l)) return 'warm';
  if (/^cool[\s-]?down/.test(l)) return 'cool';
  return WORK.has(type) ? 'work' : 'rest';
}
const numberedIdx = (steps) => { const i = steps.findIndex((s) => WORK.has(s.type)); return i < 0 ? 0 : i; };
const baseLabel = (l) => String(l || '').replace(/\s*\d+\s+of\s+\d+\s*$/i, '').trim();
/** Why jog/run steps become power-walk pushes for this user right now (core/program personalise), or ''. */
function noJogNote() {
  if (restrictedToModerate()) return 'Jog and run steps play as power-walk pushes, and inclines stay moderate, until you confirm you have checked with your doctor (Me → Health & safety).';
  if (prof().canJog !== 'yes') return 'Jog and run steps play as steep power-walk pushes until you say you can jog. From the Build phase, Today offers short jogs after two comfortable sessions.';
  return '';
}

/* ---------------- model ---------------- */

let keySeq = 0;
const nk = () => 'k' + (++keySeq).toString(36);
const mkStep = (type, dur, incline, label = '', speed = '') => ({ key: nk(), k: 'step', type: MODES[type] ? type : 'walk', dur: clampDur(dur), incline: Math.max(0, half(incline)), label: String(label || '').slice(0, 32), speed: String(speed ?? '') });
const mkRep = (rounds, steps) => ({ key: nk(), k: 'rep', rounds: Math.max(ROUNDS_MIN, Math.min(ROUNDS_MAX, Math.round(+rounds || ROUNDS_MIN))), steps });
const cloneStep = (s) => ({ ...s, key: nk() });
const cloneItem = (it) => (it.k === 'rep' ? { ...it, key: nk(), steps: it.steps.map(cloneStep) } : cloneStep(it));

const stripStep = (s) => ({ k: 'step', type: s.type, dur: s.dur, speed: s.speed || '', incline: s.incline, label: s.label || '' });
const strip = (items) => items.map((it) => (it.k === 'rep' ? { k: 'rep', rounds: it.rounds, steps: it.steps.map(stripStep) } : stripStep(it)));
const serialize = (m) => JSON.stringify({ name: m.name.trim(), intensity: m.intensity, auto: !!m.auto, items: strip(m.items) });

/** Rebuild keyed items from stored (stripped) items; returns null when the data doesn't look right. */
function rekey(items) {
  if (!Array.isArray(items) || !items.length) return null;
  const st = (s) => (s && MODES[s.type] && s.dur > 0 ? mkStep(s.type, s.dur, s.incline, s.label, s.speed) : null);
  const out = [];
  for (const it of items) {
    if (it && it.k === 'rep') {
      const steps = (it.steps || []).map(st).filter(Boolean);
      if (steps.length === 2) out.push(mkRep(it.rounds, steps));
      else out.push(...steps);
    } else { const s = st(it); if (s) out.push(s); }
  }
  return out.length ? out : null;
}

function segToStep(s) {
  let speed = '';
  if (s.speed != null) speed = fmt1(toSpeed(s.speed));
  else if (s.add) speed = fmt1(toSpeed(speedFor(s)));
  return mkStep(s.type, s.dur, s.incline, s.label, speed);
}

/** Interval list -> builder items, folding repeated [work, recovery] pairs into repeat blocks. */
function itemsFromSegs(segs) {
  const steps = (segs || []).filter((s) => s && s.dur > 0 && MODES[s.type]).map(segToStep);
  const same = (a, b) => a.type === b.type && a.dur === b.dur && a.incline === b.incline && a.speed === b.speed && baseLabel(a.label) === baseLabel(b.label);
  const wc = (s) => ['warm', 'cool'].includes(roleFor(s.label, s.type));
  const out = [];
  let i = 0;
  while (i < steps.length) {
    const a = steps[i], b = steps[i + 1];
    let r = 1;
    if (b && !wc(a) && !wc(b) && !same(a, b)) while (r < ROUNDS_MAX && steps[i + 2 * r + 1] && same(steps[i + 2 * r], a) && same(steps[i + 2 * r + 1], b)) r++;
    if (r >= 2) {
      out.push(mkRep(r, [{ ...a, label: baseLabel(a.label) }, { ...b, label: baseLabel(b.label) }]));
      i += 2 * r;
    } else { out.push(a); i++; }
  }
  return out;
}

function stepSeg(st, label, role) {
  const L = lim();
  const seg = { type: st.type, dur: st.dur, incline: Math.max(0, Math.min(L.maxI, st.incline)), label, role };
  const v = parseSpeed(st.speed);
  if (v != null && Number.isFinite(v) && v > 0) seg.speed = Math.round(Math.min(L.maxS, Math.max(1, v)) * 100) / 100;
  return seg;
}

/** Items -> the flat interval list we store (role warm/cool by label, work/rest by mode; block steps numbered "n of N"). */
function flatten(items) {
  const out = [];
  for (const it of items) {
    if (it.k === 'rep') {
      const wi = numberedIdx(it.steps);
      for (let r = 1; r <= it.rounds; r++) {
        it.steps.forEach((s, j) => {
          const own = s.label.trim();
          const rl = roleFor(own, s.type);
          const keep = rl === 'warm' || rl === 'cool';
          if (j === wi) out.push(stepSeg(s, `${own || MODES[s.type].short} ${r} of ${it.rounds}`, keep ? rl : 'work'));
          else out.push(stepSeg(s, own || 'Recover', keep ? rl : 'rest'));
        });
      }
    } else out.push(stepSeg(it, it.label.trim() || MODES[it.type].name, roleFor(it.label, it.type)));
  }
  return out;
}
const totalSec = (items) => items.reduce((a, it) => a + (it.k === 'rep' ? it.rounds * it.steps.reduce((b, s) => b + s.dur, 0) : it.dur), 0);

/** What the player will actually run (same personalisation as a saved custom workout). */
const previewSegs = (segs) => personalise(segs, { level: curLevel(), applyAdjust: false });

/** Suggested effort label from the intervals. */
function autoIntensity(segs) {
  const tot = segs.reduce((a, s) => a + s.dur, 0) || 1;
  const fast = segs.filter((s) => s.type === 'jog' || s.type === 'run').reduce((a, s) => a + s.dur, 0) / tot;
  let bouts = 0, prev = false;
  for (const s of segs) { const w = s.role === 'work'; if (w && !prev) bouts++; prev = w; }
  const maxI = Math.max(0, ...segs.map((s) => s.incline || 0));
  if (fast >= 0.1) return 3;
  if (bouts >= 3 || maxI >= 10) return 2;
  return 1;
}

function stepError(st) {
  const L = lim();
  const v = parseSpeed(st.speed);
  if (Number.isNaN(v) || (v != null && v <= 0)) return `Speed must be a number, like ${speedStr(speedFor(st.type))}.`;
  if (v != null && v > L.maxS + 0.005) return `Too fast: your treadmill’s top speed is ${speedStr(L.maxS)} ${speedUnit()}.`;
  if (v != null && v < 1 - 0.005) return `Use at least ${speedStr(1)} ${speedUnit()}.`;
  if (st.incline > L.maxI + 0.001) return L.hasIncline ? `Too steep: your treadmill’s maximum incline is ${incTxt(L.maxI)}.` : 'Your treadmill has no incline. Set this step to 0%.';
  return '';
}
function totalError(items) {
  const t = totalSec(items);
  if (t < MIN_TOTAL) return `Too short: workouts need at least 5 minutes. This one is ${clock(t)}.`;
  if (t > MAX_TOTAL) return `Too long: keep workouts to 120 minutes or less. This one is ${clock(t)}.`;
  return '';
}
const allSteps = (items) => items.flatMap((it) => (it.k === 'rep' ? it.steps : [it]));

/* ---------------- hold-to-repeat steppers ---------------- */

/** Wire kit steppers inside root. onStep(id, dir, mult) returns false when it hit a limit (stops repeating). */
function bindSteppers(root, onStep) {
  let timer = 0, reps = 0;
  const stop = () => { clearTimeout(timer); timer = 0; };
  root.addEventListener('pointerdown', (e) => {
    const b = e.target.closest('[data-stepper] button[data-dir]');
    if (!b || !root.contains(b) || (e.button != null && e.button > 0)) return;
    const id = b.closest('[data-stepper]').dataset.stepper, dir = +b.dataset.dir;
    stop(); reps = 0;
    const fire = () => {
      reps++;
      const ok = onStep(id, dir, reps > 14 ? 4 : 1);
      if (ok === false) { stop(); return; }
      timer = setTimeout(fire, reps === 1 ? 450 : 85);
    };
    fire();
  });
  for (const ev of ['pointerup', 'pointercancel', 'pointerleave', 'contextmenu']) root.addEventListener(ev, stop, true);
  // Keyboard activation (Enter / Space) fires click with detail 0; pointer taps were handled on pointerdown.
  root.addEventListener('click', (e) => {
    const b = e.target.closest('[data-stepper] button[data-dir]');
    if (!b || !root.contains(b) || e.detail !== 0) return;
    onStep(b.closest('[data-stepper]').dataset.stepper, +b.dataset.dir, 1);
  });
  return stop;
}
function setStepperVal(root, id, text) {
  const v = root.querySelector(`[data-stepper="${id}"] .val`);
  if (v) v.textContent = text;
}

/* ---------------- builder overlay ---------------- */

let B = null; // the open builder (one at a time)

function defaultItems() {
  const L = lim();
  const c = (i) => Math.min(L.maxI, i);
  return [
    mkStep('walk', 180, c(1), 'Warm-up'),
    mkStep('brisk', 120, c(2), 'Warm-up'),
    mkStep('power', 900, c(5), 'Steady climb'),
    mkStep('brisk', 120, c(1), 'Cool-down'),
    mkStep('walk', 180, 0, 'Cool-down'),
  ];
}
const defaultName = () => `My workout ${customs().length + 1}`;

function openBuilder(opts = {}) {
  if (B) { toast('The builder is already open'); return; }
  const saved = readDraft();
  if (opts.restore) {
    if (saved) openFromDraft(saved, { announce: false });
    else toast('That draft is no longer available');
    return;
  }
  if (saved) {
    const same = opts.id ? saved.id === opts.id : !opts.draft && !saved.id && !saved.seeded;
    if (same) { openFromDraft(saved); return; }
    askAboutDraft(saved, () => { clearDraft(); openFresh(opts); });
    return;
  }
  openFresh(opts);
}

function openFromDraft(d, { announce = true } = {}) {
  const items = rekey(d.model.items);
  if (!items) { clearDraft(); toast('That draft couldn’t be restored'); return; }
  const model = { name: String(d.model.name || ''), items, intensity: +d.model.intensity || 2, auto: !!d.model.auto };
  const exists = d.id && customs().some((c) => c.id === d.id);
  mount({ id: exists ? d.id : null, seeded: !!d.seeded, model, baseline: typeof d.baseline === 'string' ? d.baseline : '' });
  if (announce) toast('Restored your unsaved changes');
}

function openFresh(opts) {
  if (opts.id) {
    const c = customs().find((x) => x.id === opts.id);
    if (!c) { toast('That workout isn’t available any more'); return; }
    let items = rekey(c.items);
    // stored builder items win only if they still describe the stored intervals
    if (items) {
      const f = flatten(items);
      const ok = f.length === c.segs.length && f.every((s, i) => s.type === c.segs[i].type && s.dur === c.segs[i].dur);
      if (!ok) items = null;
    }
    if (!items) items = itemsFromSegs(c.segs);
    mount({ id: c.id, model: { name: c.name || '', items, intensity: c.intensity || 2, auto: !!c.auto } });
    return;
  }
  if (opts.draft && Array.isArray(opts.draft.segs) && opts.draft.segs.length) {
    const d = opts.draft;
    mount({ seeded: true, model: { name: String(d.name || '').slice(0, 40), items: itemsFromSegs(d.segs), intensity: d.intensity || 2, auto: !d.intensity } });
    return;
  }
  mount({ model: { name: '', items: defaultItems(), intensity: 2, auto: true } });
}

function askAboutDraft(saved, proceed) {
  const name = saved.model.name || 'Untitled workout';
  const sh = sheet(`<p class="prose">“${esc(name)}” still has unsaved changes from earlier. Continue editing it, or discard it and carry on?</p>`, {
    title: 'Unsaved workout',
    footer: '<button type="button" class="btn" data-a="discard">Discard it</button><button type="button" class="btn btn-primary" data-a="continue">Continue editing</button>',
  });
  sh.el.addEventListener('click', (e) => {
    const b = e.target.closest('[data-a]');
    if (!b) return;
    sh.close();
    if (b.dataset.a === 'continue') openFromDraft(saved, { announce: false });
    else proceed();
  });
}

function mount({ id = null, seeded = false, model, baseline }) {
  closeAllSheets();
  const root = document.createElement('div');
  root.className = 'overlay bld';
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-modal', 'true');
  root.setAttribute('aria-labelledby', 'bld-title');
  B = { root, id, seeded, model, baseline: baseline ?? serialize(model), open: null, saveT: 0, flashT: {} };
  const title = id ? 'Edit workout' : 'New workout';
  root.innerHTML = `
    <header class="bld-bar" data-el="bar">
      <button type="button" class="bld-bar-btn" data-act="cancel">Cancel</button>
      <div class="bld-titles"><h1 class="bld-title" id="bld-title" tabindex="-1">${title}</h1><span class="bld-sub num" data-el="sub" aria-live="polite"></span></div>
      <button type="button" class="bld-bar-btn bld-save" data-act="save">Save</button>
    </header>
    <div class="bld-wrap">
      <div class="field"><label for="bld-name">Name</label>
        <input id="bld-name" class="input" type="text" maxlength="40" autocomplete="off" enterkeyhint="done" data-in="name" value="${esc(model.name)}" placeholder="${esc(defaultName())}"></div>
      <section class="card bld-sum" data-el="sum" aria-label="Workout summary"></section>
      <div class="field bld-effort" data-el="effort"></div>
      <section class="bld-steps" aria-labelledby="bld-steps-h">
        <div class="section-head"><h2 class="section-title" id="bld-steps-h">Steps</h2><span class="faint body-xs">Tap a step to change it</span></div>
        <div class="bld-list" data-el="list"></div>
        <div class="bld-add">
          <button type="button" class="btn btn-ghost" data-act="add-step">${icon('plus')}Add step</button>
          <button type="button" class="btn btn-ghost" data-act="add-rep">${icon('repeat')}Add repeat block</button>
        </div>
      </section>
      <p class="body-xs bld-foot">Speeds left blank follow your paces (Me → Paces &amp; units). Steps can’t go faster or steeper than your treadmill allows.</p>
    </div>`;
  document.body.appendChild(root);
  document.body.classList.add('immersive');
  root.addEventListener('scroll', () => root.querySelector('[data-el="bar"]').classList.toggle('scrolled', root.scrollTop > 4), { passive: true });
  paintSummary();
  paintList();
  wire();
  setTimeout(() => { try { root.querySelector('#bld-title').focus({ preventScroll: true }); } catch { /* ignore */ } }, 60);
}

function closeBuilder() {
  if (!B) return;
  clearTimeout(B.saveT);
  Object.values(B.flashT).forEach(clearTimeout);
  B.stopSteppers && B.stopSteppers();
  document.removeEventListener('keydown', B.onKey);
  const root = B.root;
  B = null;
  root.remove();
  if (!document.querySelector('.overlay')) document.body.classList.remove('immersive');
  actions.refresh();
}

const dirty = () => B && serialize(B.model) !== B.baseline;

function persist() {
  if (!B) return;
  clearTimeout(B.saveT);
  B.saveT = setTimeout(() => {
    if (!B) return;
    if (!dirty()) { clearDraft(); return; }
    try {
      localStorage.setItem(DRAFT_KEY, JSON.stringify({
        v: 1, id: B.id, seeded: B.seeded, savedAt: new Date().toISOString(), baseline: B.baseline,
        model: { name: B.model.name, intensity: B.model.intensity, auto: B.model.auto, items: strip(B.model.items) },
      }));
    } catch { /* storage full or blocked: the builder still works */ }
  }, 250);
}

function find(key) {
  const items = B.model.items;
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    if (it.key === key) return { item: it, parent: null, list: items, idx: i };
    if (it.k === 'rep') {
      const j = it.steps.findIndex((s) => s.key === key);
      if (j >= 0) return { item: it.steps[j], parent: it, list: it.steps, idx: j };
    }
  }
  return null;
}
const ctxFor = (st, parent) => ({ inRep: !!parent, numbered: !!parent && parent.steps.indexOf(st) === numberedIdx(parent.steps) });

/* ---------- painting ---------- */

function effectiveIntensity(segs) { return B.model.auto ? autoIntensity(segs) : B.model.intensity; }

function paintSummary() {
  const raw = flatten(B.model.items);
  const segs = previewSegs(raw);
  const st = planStats(segs);
  const L = lim(), nn = prof().noNumbers;
  const terr = totalError(B.model.items);
  const cells = [
    ['Time', `${clock(st.sec)}`],
    nn ? ['Climb', `${Math.round(toElev(st.elev))}<small>${esc(elevUnit())}</small>`] : ['Active', `≈${roundKcal(st.kcal)}<small>kcal</small>`],
    ['Distance', `${distStr(st.km)}<small>${esc(distUnit())}</small>`],
    L.hasIncline ? ['Incline', `${fmt1(st.maxI)}<small>% max</small>`] : ['Top speed', `${speedStr(st.maxS)}<small>${esc(speedUnit())}</small>`],
  ];
  B.root.querySelector('[data-el="sum"]').innerHTML = `
    <div class="bld-stats">${cells.map(([l, v]) => `<div><span class="stat-label">${l}</span><span class="stat-value">${v}</span></div>`).join('')}</div>
    ${segs.length ? `<div class="bld-chart">${profileChart(segs, { h: 80, label: 'Workout profile: bars show speed, the line shows incline' })}</div>${modeLegend(segs, MODES)}` : ''}
    ${terr ? `<p class="bld-terr" role="alert">${icon('alert')}<span>${esc(terr)}</span></p>` : ''}
    ${nn ? '' : '<p class="body-xs">Calories are an estimate of active energy from your weight, speed and incline.</p>'}`;
  B.root.querySelector('[data-el="sub"]').textContent = `${clock(st.sec)} · ${segs.length} interval${segs.length === 1 ? '' : 's'}`;
  paintEffort(raw);
}

function paintEffort(raw) {
  const eff = effectiveIntensity(raw);
  const sug = autoIntensity(raw);
  const hint = B.model.auto
    ? 'Set from your steps. Choose one to label it yourself.'
    : `Shown on the workout card and used by the Easy filter.${sug !== eff ? ` <button type="button" class="bld-link" data-act="effort-auto">Use the suggestion (${esc(INTENSITY[sug])})</button>` : ''}`;
  B.root.querySelector('[data-el="effort"]').innerHTML = `<span class="label" id="bld-eff-l">Effort label</span>
    ${segmented('effort', [1, 2, 3].map((n) => ({ value: n, label: INTENSITY[n] })), eff, { block: true, label: 'Effort label' })}
    <span class="hint">${hint}</span>`;
}

function headInner(st, ctx) {
  const L = lim();
  const v = parseSpeed(st.speed);
  const kmh = v != null && Number.isFinite(v) && v > 0 ? Math.min(L.maxS, v) : speedFor(st.type);
  const title = st.label.trim() || (ctx.inRep && !ctx.numbered ? 'Recover' : MODES[st.type].name);
  const bits = [ctx.inRep ? MODES[st.type].short : MODES[st.type].name, `${speedStr(kmh)} ${speedUnit()}`];
  if (L.hasIncline) bits.push(incTxt(Math.min(L.maxI, st.incline)));
  const err = stepError(st);
  return `<span class="bld-ico" aria-hidden="true">${modeIcon(st.type)}</span>
    <span class="bld-main"><span class="bld-t">${esc(title)}</span><span class="bld-s">${esc(bits.join(' · '))}</span></span>
    ${err ? `<span class="bld-warn" aria-label="Needs a fix">${icon('alert')}</span>` : ''}
    <span class="bld-dur num">${clock(st.dur)}</span>${icon('chevD', 'chev')}`;
}

function toolBtn(act, key, ic, label, disabled = false) {
  return `<button type="button" class="icon-btn bld-tool" data-act="${act}" data-key="${key}" aria-label="${esc(label)}" title="${esc(label)}"${disabled ? ' disabled' : ''}>${icon(ic)}</button>`;
}

function editorHtml(st, ctx, pos) {
  const L = lim(), k = st.key;
  const jog = (st.type === 'jog' || st.type === 'run') ? noJogNote() : '';
  const ph = ctx.inRep && !ctx.numbered ? 'Recover' : MODES[st.type].name;
  const tools = ctx.inRep
    ? `<button type="button" class="btn btn-sm bld-swap" data-act="swap" data-key="${k}">${icon('swap')}Swap order</button>`
    : `${toolBtn('up', k, 'chevU', 'Move step up', pos.first)}${toolBtn('down', k, 'chevD', 'Move step down', pos.last)}${toolBtn('dup', k, 'copy', 'Duplicate step')}${toolBtn('del', k, 'trash', 'Delete step', B.model.items.length <= 1)}`;
  return `<div class="bld-ed" id="ed-${k}">
    <div class="bld-modes" role="radiogroup" aria-label="Mode">${MODE_IDS.map((t) => `<button type="button" role="radio" aria-checked="${t === st.type}" class="bld-mode mode-${t}" data-act="mode" data-mode="${t}" data-key="${k}"><span class="bld-mode-ico">${modeIcon(t)}</span><span class="bld-mode-t">${esc(MODES[t].short)}</span></button>`).join('')}</div>
    ${jog ? `<p class="bld-note">${icon('info')}<span>${esc(jog)}</span></p>` : ''}
    <div class="bld-rows">
      <div class="bld-row"><span class="bld-row-l">Time</span>${stepperHtml('dur:' + k, clock(st.dur), '', 'Time in minutes and seconds')}</div>
      <div class="bld-row"><span class="bld-row-l">Incline</span>${L.hasIncline ? stepperHtml('inc:' + k, incTxt(st.incline), '', 'Incline') : '<span class="bld-noinc">Your treadmill has no incline</span>'}</div>
    </div>
    <div class="bld-grid">
      <div class="field"><label for="spd-${k}">Speed</label><div class="input-unit"><input id="spd-${k}" class="input" type="text" inputmode="decimal" autocomplete="off" enterkeyhint="done" data-in="speed" data-key="${k}" value="${esc(st.speed)}" placeholder="${speedStr(speedFor(st.type))}" aria-describedby="spdh-${k}"><span class="unit">${esc(speedUnit())}</span></div><span class="hint" id="spdh-${k}">Leave blank to use your ${esc(MODES[st.type].name.toLowerCase())} pace</span></div>
      <div class="field"><label for="lab-${k}">Label</label><input id="lab-${k}" class="input" type="text" maxlength="32" autocomplete="off" enterkeyhint="done" data-in="label" data-key="${k}" value="${esc(st.label)}" placeholder="${esc(ph)}">${ctx.numbered ? '<span class="hint">Numbered each round, like “Climb 2 of 6”</span>' : ''}</div>
    </div>
    <p class="bld-err" data-err="${k}" role="alert">${esc(stepError(st))}</p>
    <div class="bld-tools">${tools}<span class="spacer"></span><button type="button" class="btn btn-sm" data-act="done" data-key="${k}">Done</button></div>
  </div>`;
}

function stepHtml(st, ctx, pos) {
  const open = B.open === st.key;
  return `<div class="bld-step mode-${st.type}${open ? ' open' : ''}${stepError(st) ? ' has-err' : ''}" data-key="${st.key}">
    <button type="button" class="bld-head" data-act="toggle" data-key="${st.key}" aria-expanded="${open}"${open ? ` aria-controls="ed-${st.key}"` : ''}>${headInner(st, ctx)}</button>
    ${open ? editorHtml(st, ctx, pos) : ''}
  </div>`;
}

function repSub(it) { return `${it.rounds} rounds · ${clock(it.rounds * it.steps.reduce((a, s) => a + s.dur, 0))}`; }

function repHtml(it, pos) {
  const wi = numberedIdx(it.steps);
  return `<div class="bld-rep" data-key="${it.key}" role="group" aria-label="Repeat block, ${it.rounds} rounds">
    <div class="bld-rep-head">
      <span class="bld-rep-ico" aria-hidden="true">${icon('repeat')}</span>
      <span class="bld-main"><span class="bld-t">Repeat block</span><span class="bld-s" data-el="repsub">${esc(repSub(it))}</span></span>
      ${stepperHtml('rounds:' + it.key, '×' + it.rounds, '', 'Rounds')}
    </div>
    <p class="bld-err" data-err="${it.key}" role="alert"></p>
    <div class="bld-rep-steps">${it.steps.map((s, j) => stepHtml(s, { inRep: true, numbered: j === wi }, {})).join('')}</div>
    <div class="bld-tools bld-rep-tools">
      ${toolBtn('up', it.key, 'chevU', 'Move block up', pos.first)}${toolBtn('down', it.key, 'chevD', 'Move block down', pos.last)}${toolBtn('dup', it.key, 'copy', 'Duplicate block')}${toolBtn('del', it.key, 'trash', 'Delete block', B.model.items.length <= 1)}
      <span class="spacer"></span><button type="button" class="btn btn-sm btn-text" data-act="split" data-key="${it.key}">Split into steps</button>
    </div>
  </div>`;
}

function paintList() {
  const items = B.model.items;
  B.root.querySelector('[data-el="list"]').innerHTML = items.map((it, i) => {
    const pos = { first: i === 0, last: i === items.length - 1 };
    return it.k === 'rep' ? repHtml(it, pos) : stepHtml(it, { inRep: false, numbered: false }, pos);
  }).join('');
}

/** Refresh one step's header, error and its block's subtitle without rebuilding the list (keeps focus and held buttons). */
function refreshStep(key) {
  const f = find(key);
  if (!f) return;
  const el = B.root.querySelector(`.bld-step[data-key="${key}"]`);
  if (el) {
    el.querySelector('.bld-head').innerHTML = headInner(f.item, ctxFor(f.item, f.parent));
    const e = stepError(f.item);
    el.classList.toggle('has-err', !!e);
    const er = el.querySelector(`[data-err="${key}"]`);
    if (er && !B.flashT[key]) er.textContent = e;
  }
  if (f.parent) refreshRep(f.parent.key);
}
function refreshRep(key) {
  const f = find(key);
  const el = B.root.querySelector(`.bld-rep[data-key="${key}"]`);
  if (!f || !el) return;
  el.querySelector('[data-el="repsub"]').textContent = repSub(f.item);
  el.setAttribute('aria-label', `Repeat block, ${f.item.rounds} rounds`);
}

/** Show a short limit message under a step or block, then fall back to its validation message. */
function flash(key, msg) {
  if (!B) return;
  haptic('warning');
  const er = B.root.querySelector(`[data-err="${key}"]`);
  if (!er) { toast(msg); return; }
  er.textContent = msg;
  er.classList.add('flash');
  clearTimeout(B.flashT[key]);
  B.flashT[key] = setTimeout(() => {
    if (!B) return;
    delete B.flashT[key];
    er.classList.remove('flash');
    const f = find(key);
    er.textContent = f && f.item.k === 'step' ? stepError(f.item) : '';
  }, 2600);
}

function changed({ list = false } = {}) {
  if (list) paintList();
  paintSummary();
  persist();
}

function focusSel(sel) {
  const el = B && B.root.querySelector(sel);
  if (el) try { el.focus({ preventScroll: false }); } catch { /* ignore */ }
}
function reveal(key) {
  const el = B && B.root.querySelector(`[data-key="${key}"]`);
  if (el && el.scrollIntoView) el.scrollIntoView({ block: 'nearest', behavior: RM ? 'auto' : 'smooth' });
}

/* ---------- editing ---------- */

/** Index where new steps go: before the trailing cool-down steps. */
function insertIndex() {
  const items = B.model.items;
  let i = items.length;
  while (i > 0 && items[i - 1].k === 'step' && roleFor(items[i - 1].label, items[i - 1].type) === 'cool') i--;
  return i === 0 && items.length ? items.length : i;
}

function addStep() {
  const L = lim();
  const items = B.model.items;
  const at = insertIndex();
  const prev = items[at - 1];
  const prevType = prev ? (prev.k === 'rep' ? prev.steps[0].type : prev.type) : 'walk';
  const st = WORK.has(prevType) && prev && prev.k === 'step'
    ? mkStep('walk', 120, Math.min(L.maxI, 1), 'Recover')
    : mkStep('power', 180, Math.min(L.maxI, 5), 'Climb');
  items.splice(at, 0, st);
  B.open = st.key;
  changed({ list: true });
  reveal(st.key);
  focusSel(`.bld-step[data-key="${st.key}"] .bld-head`);
}

function addRepeat() {
  const L = lim();
  const it = mkRep(4, [mkStep('power', 120, Math.min(L.maxI, 6), 'Climb'), mkStep('walk', 120, Math.min(L.maxI, 1), 'Recover')]);
  B.model.items.splice(insertIndex(), 0, it);
  B.open = null;
  changed({ list: true });
  reveal(it.key);
  focusSel(`.bld-rep[data-key="${it.key}"] [data-stepper] button[data-dir="1"]`);
}

function onStepper(id, dir, mult) {
  if (!B) return false;
  const [kind, key] = id.split(':');
  const f = find(key);
  if (!f) return false;
  const L = lim();
  if (kind === 'dur') {
    const d = f.item.dur;
    const next = dir > 0 ? Math.floor(d / 15) * 15 + 15 * mult : Math.ceil(d / 15) * 15 - 15 * mult;
    const c = Math.max(MIN_STEP, Math.min(MAX_STEP, next));
    if (c === d) { flash(key, dir > 0 ? 'Steps can be up to 60 minutes. Add another step for more.' : 'Steps need at least 15 seconds.'); return false; }
    f.item.dur = c;
    setStepperVal(B.root, id, clock(c));
  } else if (kind === 'inc') {
    const i = f.item.incline;
    const next = half(i + dir * 0.5 * mult);
    const c = Math.max(0, Math.min(L.maxI, next));
    if (dir > 0 && next > L.maxI && i >= L.maxI) { flash(key, `Your treadmill’s maximum incline is ${incTxt(L.maxI)}.`); return false; }
    if (dir < 0 && i <= 0) return false;
    f.item.incline = c;
    setStepperVal(B.root, id, incTxt(c));
  } else if (kind === 'rounds') {
    const r = f.item.rounds;
    const c = Math.max(ROUNDS_MIN, Math.min(ROUNDS_MAX, r + dir));
    if (c === r) { flash(key, dir > 0 ? `A block can repeat up to ${ROUNDS_MAX} times.` : 'A block needs at least 2 rounds. Use “Split into steps” for a single round.'); return false; }
    f.item.rounds = c;
    setStepperVal(B.root, id, '×' + c);
    refreshRep(key);
    changed();
    return true;
  } else return false;
  haptic('selection');
  refreshStep(key);
  changed();
  return true;
}

function moveItem(key, dir) {
  const items = B.model.items;
  const i = items.findIndex((x) => x.key === key);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= items.length) return;
  [items[i], items[j]] = [items[j], items[i]];
  changed({ list: true });
  const sel = `[data-act="${dir < 0 ? 'up' : 'down'}"][data-key="${key}"]`;
  const btn = B.root.querySelector(sel);
  if (btn && !btn.disabled) focusSel(sel); else focusSel(`[data-act="${dir < 0 ? 'down' : 'up'}"][data-key="${key}"]`);
  reveal(key);
}

function splitRep(key) {
  const items = B.model.items;
  const i = items.findIndex((x) => x.key === key);
  if (i < 0) return;
  const it = items[i];
  const wi = numberedIdx(it.steps);
  const out = [];
  for (let r = 1; r <= it.rounds; r++) {
    it.steps.forEach((s, j) => {
      const own = s.label.trim();
      out.push({ ...cloneStep(s), label: j === wi ? `${own || MODES[s.type].short} ${r} of ${it.rounds}`.slice(0, 32) : own || 'Recover' });
    });
  }
  items.splice(i, 1, ...out);
  B.open = null;
  changed({ list: true });
  toast(`Split into ${out.length} steps`);
  focusSel(`.bld-step[data-key="${out[0].key}"] .bld-head`);
}

async function tryCancel() {
  if (!B) return;
  if (!dirty()) { clearDraft(); closeBuilder(); return; }
  const yes = await confirmSheet({
    title: 'Discard changes?',
    body: B.id ? 'Your edits to this workout won’t be saved.' : 'This workout hasn’t been saved yet. Its steps will be deleted.',
    confirm: 'Discard', cancel: 'Keep editing', danger: true,
  });
  if (!yes || !B) return;
  clearDraft();
  closeBuilder();
}

function save() {
  if (!B) return;
  const items = B.model.items;
  const bad = allSteps(items).find((s) => stepError(s));
  const terr = totalError(items);
  if (bad) {
    haptic('warning');
    B.open = bad.key;
    paintList();
    reveal(bad.key);
    toast('Fix the highlighted step first');
    return;
  }
  if (terr) {
    haptic('warning');
    B.root.querySelector('[data-el="sum"]').scrollIntoView({ block: 'center', behavior: RM ? 'auto' : 'smooth' });
    toast(terr.split(':')[0] === 'Too short' ? 'Workouts need at least 5 minutes' : 'Workouts can be up to 120 minutes');
    return;
  }
  const segs = flatten(items);
  const id = B.id || store.uid('c');
  const isNew = !B.id;
  const rec = {
    id,
    name: (B.model.name.trim() || defaultName()).slice(0, 40),
    segs,
    intensity: effectiveIntensity(segs),
    auto: !!B.model.auto,
    items: strip(items),
    updated: new Date().toISOString(),
  };
  store.update((m) => {
    m.customs = Array.isArray(m.customs) ? m.customs : [];
    const i = m.customs.findIndex((c) => c.id === id);
    if (i >= 0) m.customs[i] = { ...m.customs[i], ...rec };
    else m.customs.unshift(rec);
  });
  haptic('success');
  clearDraft();
  closeBuilder();
  toast(isNew ? `Saved “${rec.name}” to My workouts` : 'Workout updated');
  // offer Start right away: the detail sheet has the Start button
  setTimeout(() => actions.openWorkout(id), RM ? 0 : 120);
}

function wire() {
  const root = B.root;
  B.stopSteppers = bindSteppers(root, onStepper);
  bindSegmented(root, (name, v) => {
    if (name !== 'effort' || !B) return;
    B.model.intensity = +v;
    B.model.auto = false;
    paintEffort(flatten(B.model.items));
    persist();
  });
  root.addEventListener('click', (e) => {
    if (!B) return;
    const b = e.target.closest('[data-act]');
    if (!b || !root.contains(b) || b.disabled) return;
    const act = b.dataset.act, key = b.dataset.key;
    if (act === 'cancel') { tryCancel(); return; }
    if (act === 'save') { save(); return; }
    if (act === 'add-step') { addStep(); return; }
    if (act === 'add-rep') { addRepeat(); return; }
    if (act === 'effort-auto') { B.model.auto = true; paintEffort(flatten(B.model.items)); persist(); return; }
    if (act === 'toggle') {
      B.open = B.open === key ? null : key;
      paintList();
      focusSel(`.bld-step[data-key="${key}"] .bld-head`);
      if (B.open) reveal(key);
      return;
    }
    if (act === 'done') { B.open = null; paintList(); focusSel(`.bld-step[data-key="${key}"] .bld-head`); return; }
    const f = key ? find(key) : null;
    if (!f) return;
    if (act === 'mode') {
      const t = b.dataset.mode;
      if (!MODES[t] || f.item.type === t) return;
      f.item.type = t;
      haptic('selection');
      changed({ list: true });
      focusSel(`.bld-mode[data-key="${key}"][data-mode="${t}"]`);
      return;
    }
    if (act === 'swap' && f.parent) {
      f.parent.steps.reverse();
      changed({ list: true });
      focusSel(`[data-act="swap"][data-key="${key}"]`);
      return;
    }
    if (f.parent) return; // remaining actions are for top-level items
    if (act === 'up') { moveItem(key, -1); return; }
    if (act === 'down') { moveItem(key, 1); return; }
    if (act === 'dup') {
      const copy = cloneItem(f.item);
      B.model.items.splice(f.idx + 1, 0, copy);
      if (copy.k === 'step') B.open = copy.key;
      changed({ list: true });
      reveal(copy.key);
      focusSel(copy.k === 'step' ? `.bld-step[data-key="${copy.key}"] .bld-head` : `[data-act="dup"][data-key="${copy.key}"]`);
      return;
    }
    if (act === 'del') {
      if (B.model.items.length <= 1) { flash(key, 'A workout needs at least one step.'); return; }
      B.model.items.splice(f.idx, 1);
      if (B.open === key) B.open = null;
      changed({ list: true });
      const next = B.model.items[Math.min(f.idx, B.model.items.length - 1)];
      if (next) focusSel(next.k === 'rep' ? `.bld-rep[data-key="${next.key}"] [data-stepper] button` : `.bld-step[data-key="${next.key}"] .bld-head`);
      toast(f.item.k === 'rep' ? 'Repeat block deleted' : 'Step deleted');
      return;
    }
    if (act === 'split' && f.item.k === 'rep') splitRep(key);
  });
  root.addEventListener('input', (e) => {
    if (!B) return;
    const inp = e.target.closest('[data-in]');
    if (!inp) return;
    if (inp.dataset.in === 'name') { B.model.name = inp.value.slice(0, 40); persist(); return; }
    const f = find(inp.dataset.key);
    if (!f) return;
    if (inp.dataset.in === 'speed') f.item.speed = inp.value.slice(0, 6);
    if (inp.dataset.in === 'label') f.item.label = inp.value.slice(0, 32);
    inp.setAttribute('aria-invalid', String(inp.dataset.in === 'speed' && !!stepError(f.item)));
    refreshStep(f.item.key);
    changed();
  });
  root.addEventListener('keydown', (e) => {
    // Enter in a text field just closes the keyboard
    if (e.key === 'Enter' && e.target.matches && e.target.matches('input.input')) { e.preventDefault(); e.target.blur(); }
  });
  B.onKey = (e) => {
    if (e.key === 'Escape' && B && !document.querySelector('.sheet-root')) { e.preventDefault(); tryCancel(); }
  };
  document.addEventListener('keydown', B.onKey);
}

/* ---------------- Quick Draft sheet ---------------- */

const QD_LEN = [20, 30, 45, 60];
const QD_FOCUS = [
  { value: 'climb', label: 'Climb' }, { value: 'intervals', label: 'Intervals' },
  { value: 'steady', label: 'Steady' }, { value: 'mixed', label: 'Mixed' },
];
const QD_INT = [{ value: 'easy', label: 'Easy' }, { value: 'moderate', label: 'Moderate' }, { value: 'hard', label: 'Hard' }];

function focusHint(focus) {
  const jog = prof().canJog === 'yes' && !restrictedToModerate();
  return {
    climb: 'Three-minute climbs with two-minute flat recoveries.',
    intervals: jog ? 'Short jogs with brisk-walk recoveries. The jogs get longer as the intensity goes up.' : 'Short, steep power-walk pushes with brisk-walk recoveries.',
    steady: 'Five-minute blocks of continuous power walking on a rolling incline.',
    mixed: jog ? 'Seven-minute rounds: a climb, a short recovery, a jog and a hill walk.' : 'Seven-minute rounds: a climb, a short recovery, a push and a hill walk.',
  }[focus];
}

function openQuickDraft() {
  const L = lim();
  const p = prof();
  const q = {
    minutes: QD_LEN.includes(p.sessionLength) ? p.sessionLength : 30,
    focus: 'climb',
    intensity: 'moderate',
    maxInc: L.maxI,
  };
  const draft = () => quickDraft({ minutes: q.minutes, focus: q.focus, intensity: q.intensity, maxIncline: L.hasIncline ? q.maxInc : null });
  const incHint = () => (q.maxInc >= L.maxI ? 'Your treadmill’s maximum. Lower it to keep the climbs gentler.' : `Climbs stay at or below ${incTxt(q.maxInc)}.`);
  const html = `
    <p class="body-s qd-lede">Pick a length and focus; we draft it on your phone from your paces and treadmill. Nothing is sent anywhere, and you can change every step afterwards.</p>
    <div class="field"><span class="label">Length</span>${segmented('qd-min', QD_LEN.map((n) => ({ value: n, label: `${n} min` })), q.minutes, { block: true, label: 'Length' })}</div>
    <div class="field"><span class="label">Focus</span>${segmented('qd-focus', QD_FOCUS, q.focus, { block: true, label: 'Focus' })}<span class="hint" data-el="fhint">${esc(focusHint(q.focus))}</span></div>
    <div class="field"><span class="label">Intensity</span>${segmented('qd-int', QD_INT, q.intensity, { block: true, label: 'Intensity' })}</div>
    ${L.hasIncline
      ? `<div class="field qd-inc"><span class="label">Max incline <span class="faint">(optional)</span></span>${stepperHtml('qd-inc', incTxt(q.maxInc), '', 'Max incline')}<span class="hint" data-el="ihint">${esc(incHint())}</span></div>`
      : '<p class="body-xs">Your treadmill has no incline, so the draft changes speed only.</p>'}
    <section class="card qd-prev" data-el="prev" aria-label="Draft preview" aria-live="polite"></section>`;
  const sh = sheet(html, {
    title: 'Quick Draft',
    footer: `<button type="button" class="btn btn-primary btn-block" data-act="qd-open">${icon('edit')}Open in builder</button>`,
    label: 'Quick Draft',
  });
  sh.el.classList.add('qd-sheet');
  const prev = sh.el.querySelector('[data-el="prev"]');
  const paint = () => {
    const d = draft();
    const segs = previewSegs(d.segs);
    const st = planStats(segs);
    const nn = p.noNumbers;
    const bits = [`${Math.round(st.sec / 60)} min`];
    if (!nn) bits.push(`≈ ${roundKcal(st.kcal)} kcal`);
    bits.push(`${distStr(st.km)} ${distUnit()}`);
    if (L.hasIncline) bits.push(`up to ${incTxt(st.maxI)}`);
    prev.innerHTML = `
      <div class="qd-top"><span class="eyebrow">Preview</span><span class="tag">${esc(INTENSITY[d.intensity])}</span></div>
      <p class="title-m">${esc(d.name)}</p>
      <p class="qd-stats num">${esc(bits.join(' · '))}</p>
      <div class="qd-chart">${profileChart(segs, { h: 72, label: 'Draft profile: bars show speed, the line shows incline' })}</div>
      ${modeLegend(segs, MODES)}
      <p class="body-xs">${segs.length} intervals${nn ? '' : '. Calories are an estimate'}.</p>`;
  };
  paint();
  bindSegmented(sh.el, (name, v) => {
    if (name === 'qd-min') q.minutes = +v;
    else if (name === 'qd-focus') { q.focus = v; sh.el.querySelector('[data-el="fhint"]').textContent = focusHint(v); }
    else if (name === 'qd-int') q.intensity = v;
    else return;
    paint();
  });
  const stop = bindSteppers(sh.el, (id, dir, mult) => {
    if (id !== 'qd-inc') return false;
    const next = half(q.maxInc + dir * 0.5 * mult);
    const c = Math.max(1, Math.min(L.maxI, next));
    if (c === q.maxInc) {
      haptic('warning');
      sh.el.querySelector('[data-el="ihint"]').textContent = dir > 0 ? `Your treadmill’s maximum incline is ${incTxt(L.maxI)}.` : 'The lowest limit is 1%.';
      return false;
    }
    q.maxInc = c;
    haptic('selection');
    setStepperVal(sh.el, 'qd-inc', incTxt(c));
    sh.el.querySelector('[data-el="ihint"]').textContent = incHint();
    paint();
    return true;
  });
  sh.el.addEventListener('click', (e) => {
    const b = e.target.closest('[data-act="qd-open"]');
    if (!b) return;
    stop();
    const d = draft();
    sh.close();
    openBuilder({ draft: { name: d.name, segs: d.segs, intensity: d.intensity } });
  });
}

actions.openBuilder = (opts) => openBuilder(opts || {});
actions.openQuickDraft = () => openQuickDraft();

export default { name: 'builder' };
