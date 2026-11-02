// Plan tab: phase timeline, the 12 weeks with every session, plan settings, and the session sheet (actions.openSlot).
// Also exports the small plan helpers Today uses, so both tabs read the plan the same way.
import * as store from '../core/store.js';
import { state } from '../core/store.js';
import {
  MODES, PHASES, WORKOUTS, INTENSITY, DELOAD_WEEKS, getWorkout, planSlots, slotSegments, planStats, currentWeek,
  phaseForWeek, planStart, startPlanThisWeek, lockReason, segmentsFor, mainMode as programMainMode, setTrainingDays,
  planBegan as corePlanBegan, slotState as coreSlotState, deloadLength, daysChangeFrom } from '../core/program.js';
import { roundKcal } from '../core/science.js';
import {
  esc, ymd, addDays, startOfWeek, daysBetween, dateShort, dateLong, dayName, fmt1, toDist, distUnit, toElev, elevUnit, parseYmd,
} from '../core/format.js';
import { actions } from '../ui/actions.js';
import { icon, modeIcon, sheet, confirmSheet, toast, segmented, bindSegmented, switchHtml } from '../ui/kit.js';
import { intervalChart, modeLegend } from '../ui/charts.js';
import { haptic } from '../core/platform.js';
import { steepNoticeHtml } from './player.js';

const NB = ' ';
export const has = (name) => name in actions; // the registry only "has" actions a module registered

/* ======================================================================
   Shared plan helpers (also used by today.js)
   ====================================================================== */

/** The workout's main work mode (program.mainMode): the one rule every Start button uses for its color. */
export const mainMode = programMainMode;

/** "45 min" with a non-breaking space so narrow labels never split the number from its unit. */
export const minLabel = (min) => `${Math.round(min)}${NB}min`;

/** "45:00" for the Start button. */
export function startClock(sec) {
  const m = Math.floor(sec / 60), s = Math.round(sec % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

/**
 * The day the current plan actually began (onboarding or a restart), or null (core/program planBegan).
 * Plan weeks always start on a Monday, so slots earlier in that first week were never really scheduled.
 */
export const planBegan = corePlanBegan;

/** The session that completed a slot (newest first), or null. */
export function slotSession(slot) {
  return state.sessions.find((s) => s.planSlot === slot.key && (s.completed || (s.completion || 0) >= 0.7)) || null;
}

/**
 * slotStatus plus 'prestart': a slot dated before the plan began that was never done is not "missed"
 * (core/program slotState, shared with the badges). Returns 'done' | 'skipped' | 'missed' | 'today' | 'upcoming' | 'prestart'.
 */
export const slotState = coreSlotState;

/** Same rule as program.nextSlot (today's, else this week's missed, else next upcoming) but never a pre-start slot. */
export function nextPlanSlot(slots = planSlots(), today = new Date()) {
  const began = planBegan();
  const st = (s) => slotState(s, today, began);
  const todays = slots.find((s) => st(s) === 'today');
  if (todays) return todays;
  const ws = startOfWeek(today);
  const missed = slots.find((s) => st(s) === 'missed' && s.date >= ws);
  if (missed) return missed;
  return slots.find((s) => st(s) === 'upcoming') || null;
}

/** Everything a card needs about a slot. */
export function slotInfo(slot) {
  const segs = slotSegments(slot);
  const w = getWorkout(slot.workoutId) || { name: 'Workout', intensity: 2, focus: '' };
  return { segs, st: planStats(segs), w, mode: mainMode(segs) };
}

/** Number of work intervals and a noun for them ("7 climbs"). */
export function workSummary(segs, w) {
  const work = segs.filter((s) => s.role === 'work');
  const mode = mainMode(segs);
  const noun = { power: state.main.profile.treadmill.hasIncline ? ['climb', 'climbs'] : ['power interval', 'power intervals'], jog: ['jog', 'jogs'], run: ['sprint', 'sprints'], brisk: ['brisk block', 'brisk blocks'], walk: ['walk', 'walks'] }[mode] || ['interval', 'intervals'];
  const n = work.filter((s) => s.type === mode).length;
  const parts = [INTENSITY[w.intensity] || ''];
  if (n > 1) parts.push(`${n} ${noun[1]}`);
  return parts.filter(Boolean).join(' · ');
}

/** Sessions keep their history when a plan restarts, but must stop counting toward the new plan's slots (keys repeat). */
export function detachPlanSessions(block) {
  const ids = state.sessions.filter((s) => s.planSlot).map((s) => [s.id, s.planSlot]);
  for (const [id, key] of ids) store.updateSession(id, { planSlot: null, prevPlanSlot: key, prevPlanBlock: block || 1 });
}

/**
 * When a restarted plan (or the next block) would begin: 'this week', or 'on Monday 9 November' when no training day
 * is left this week, today is already trained, or (nextBlock) the finished block still owns this week.
 */
export function restartWhen(today = new Date(), { nextBlock = false } = {}) {
  const p = state.main.plan;
  const probe = { days: [...(p.days || [])], startDate: p.startDate, weeks: p.weeks };
  startPlanThisWeek(probe, today, { newBlock: nextBlock });
  return probe.startDate === ymd(startOfWeek(today)) ? 'this week' : `on ${dateLong(parseYmd(probe.startDate))}`;
}

/**
 * Restart the 12 weeks at block 1 and Foundation level (this Monday, or next Monday: see restartWhen).
 * nextBlock starts block N+1 instead and keeps effort adjustments.
 */
export function restartPlan({ nextBlock = false } = {}) {
  const block = state.main.plan.block || 1;
  detachPlanSessions(block);
  store.update((m) => {
    const adjust = { ...(m.plan.adjust || { incline: 0, speed: 0 }) };
    startPlanThisWeek(m.plan, new Date(), { newBlock: nextBlock }); // resets plan.block to 1
    m.plan.swap = {};
    m.plan.createdAt = new Date().toISOString();
    if (nextBlock) { m.plan.block = block + 1; m.plan.adjust = adjust; }
  });
}

/* ======================================================================
   Swap alternatives
   ====================================================================== */

const GROUPS = {
  moderate: ['hills', 'pyramid', 'steep', 'threes'],
  hard: ['walkjog', 'mixed', 'fourx4', 'hiit'],
  easy: ['steady', 'easy', 'threes'],
};

/** The workout the plan scheduled for a slot, ignoring any swap. */
function plannedWorkoutId(slot) {
  const p = state.main.plan;
  if (!p.swap || !p.swap[slot.key]) return slot.workoutId;
  const saved = p.swap;
  p.swap = {}; // synchronous peek: planSlots reads plan.swap
  try { const s = planSlots().find((x) => x.key === slot.key); return s ? s.workoutId : slot.workoutId; } finally { p.swap = saved; }
}

function swapChoices(slot) {
  const planned = plannedWorkoutId(slot);
  const kind = (WORKOUTS[planned] || {}).kind;
  const group = kind === 'interval-moderate' ? GROUPS.moderate : kind === 'interval-hard' || kind === 'classic-hard' ? GROUPS.hard : GROUPS.easy;
  const ids = [planned, ...group.filter((id) => id !== planned)];
  return {
    planned,
    list: ids.filter((id) => WORKOUTS[id]).map((id) => ({ id, w: getWorkout(id), lock: lockReason(id, slot.week) })).filter((x) => !x.lock || x.id === planned),
  };
}

/* ======================================================================
   Session sheet (actions.openSlot)
   ====================================================================== */

function statusLine(slot, status, sess) {
  const day = dateLong(slot.date);
  if (status === 'done') return { cls: 'done', icon: 'checkCircle', text: `Done on ${dateLong(sess ? sess.date : slot.date)}` };
  if (status === 'today') return { cls: 'today', icon: 'today', text: slot.moved ? `Moved to today, ${day}` : `Today, ${day}` };
  if (status === 'missed') return { cls: 'missed', icon: 'alert', text: `Missed on ${day}` };
  if (status === 'skipped') return { cls: 'skipped', icon: 'skipDay', text: `Skipped (was ${day})` };
  if (status === 'prestart') return { cls: 'skipped', icon: 'info', text: `${day}, before your plan began` };
  return { cls: 'upcoming', icon: 'plan', text: `${slot.moved ? 'Moved to ' : ''}${day}` };
}

function statCells(cells) {
  return `<div class="stat-grid pn-stats" style="grid-template-columns:repeat(${cells.length}, auto)">${cells.map(([l, v]) => `<div><span class="stat-label">${l}</span><span class="stat-value">${v}</span></div>`).join('')}</div>`;
}

function plannedStats(st) {
  const p = state.main.profile;
  const cells = [['Time', `${Math.round(st.sec / 60)}<small>min</small>`]];
  if (!p.noNumbers) cells.push(['Active', `≈${roundKcal(st.kcal)}<small>kcal</small>`]);
  cells.push(['Distance', `${fmt1(toDist(st.km))}<small>${distUnit()}</small>`]);
  if (p.treadmill.hasIncline) cells.push(['Incline', `${fmt1(st.maxI).replace(/\.0$/, '')}<small>% max</small>`]);
  else cells.push(['Climb', `${Math.round(toElev(st.elev))}<small>${elevUnit()}</small>`]);
  return statCells(cells);
}

function sessionStats(s) {
  const p = state.main.profile;
  const cells = [['Time', `${Math.round((s.durationSec || 0) / 60)}<small>min</small>`]];
  cells.push(['Distance', `${fmt1(toDist(s.distanceKm || 0))}<small>${distUnit()}</small>`]);
  if (!p.noNumbers) cells.push(['Active', `≈${roundKcal(s.kcal)}<small>kcal</small>`]);
  cells.push(['Climb', `${Math.round(toElev(s.elevM || 0))}<small>${elevUnit()}</small>`]);
  return statCells(cells);
}

function openSlot(key) {
  let view = 'main';
  const find = () => planSlots().find((s) => s.key === key) || null;
  if (!find()) { toast('That session is no longer in your plan'); return; }
  const s = sheet('', { title: ' ', footer: '<span></span>', label: 'Plan session' });
  const titleEl = s.el.querySelector('.sheet-head .title-m');

  const draw = () => {
    const slot = find();
    if (!slot) { s.close(); return; }
    const p = state.main.profile;
    const status = slotState(slot);
    const sess = status === 'done' ? slotSession(slot) : null;
    const { segs, st, w, mode } = slotInfo(slot);
    const phase = phaseForWeek(slot.week);
    titleEl.textContent = sess && sess.name ? sess.name : w.name;

    if (view === 'swap') {
      const { planned, list } = swapChoices(slot);
      s.body.innerHTML = `
        <p class="body-s">Pick another workout of the same kind for ${esc(dateLong(slot.date))}. It counts toward your plan the same way.</p>
        <div class="choices pn-swap" role="radiogroup" aria-label="Workouts">
          ${list.map(({ id, w: ww }) => {
            const sg = segmentsFor(id, { level: slot.level, length: slot.length });
            const ss = planStats(sg);
            const on = id === slot.workoutId;
            return `<button type="button" class="choice pn-swap-item" role="radio" aria-checked="${on}" data-swap="${esc(id)}">
              <span class="radio" aria-hidden="true"></span>
              <span class="choice-main">
                <span class="choice-title">${esc(ww.name)}${id === planned ? ' <span class="tag">Planned</span>' : ''}</span>
                <span class="choice-sub">${esc(ww.focus)} · ${minLabel(ss.sec / 60)}${p.noNumbers ? '' : ` · ≈${roundKcal(ss.kcal)}${NB}kcal`}</span>
                <span class="pn-swap-chart">${intervalChart(sg, { mini: true, h: 34, label: `${ww.name} profile` })}</span>
              </span>
            </button>`;
          }).join('')}
        </div>`;
      s.foot.innerHTML = `<button class="btn" type="button" data-act="back">${icon('chevL')}Back</button>`;
      return;
    }

    const line = statusLine(slot, status, sess);
    const canMove = status !== 'done' && status !== 'today' && Math.abs(daysBetween(new Date(), slot.date)) <= 7;
    const busyOn = !!(state.main.plan.busy && state.main.plan.busy[key]);
    const lenOf = (x) => (slot.deload ? deloadLength(x) : x); // lighter weeks run every length about 25% shorter
    const busyLen = lenOf(p.busyLength || 30), regLen = lenOf(p.sessionLength || 45);
    const showBusy = status !== 'done' && busyLen < regLen;
    const swapped = !!(state.main.plan.swap && state.main.plan.swap[key]);
    const rows = [];
    if (showBusy) {
      rows.push(`<label class="row pn-busy-row" for="pn-busy-${esc(key)}">
        <span class="row-icon">${icon('timer')}</span>
        <span class="row-main"><span class="row-title">Busy day: ${busyLen} min</span><span class="row-sub">Shorter warm-up and fewer intervals. It still counts.</span></span>
        ${switchHtml('pn-busy-' + key, busyOn, `Busy day: ${busyLen} minutes`)}
      </label>`);
    }
    if (status !== 'done') {
      if (slot.moved) rows.push(`<button type="button" class="row has-icon" data-act="unmove"><span class="row-icon">${icon('repeat')}</span><span class="row-main"><span class="row-title">Move back to ${esc(dayName(slot.planned, 'long'))}</span><span class="row-sub">${esc(dateLong(slot.planned))}</span></span>${icon('chevR', 'chev')}</button>`);
      if (canMove) rows.push(`<button type="button" class="row has-icon" data-act="move"><span class="row-icon">${icon('today')}</span><span class="row-main"><span class="row-title">Move to today</span><span class="row-sub">Do it today instead of ${esc(dayName(slot.date, 'long'))}</span></span>${icon('chevR', 'chev')}</button>`);
      rows.push(`<button type="button" class="row has-icon" data-act="swap"><span class="row-icon">${icon('swap')}</span><span class="row-main"><span class="row-title">Swap workout</span><span class="row-sub">${swapped ? `Swapped from ${esc(getWorkout(plannedWorkoutId(slot)).name)}` : 'Choose another of the same kind'}</span></span>${icon('chevR', 'chev')}</button>`);
      rows.push(status === 'skipped'
        ? `<button type="button" class="row has-icon" data-act="unskip"><span class="row-icon">${icon('repeat')}</span><span class="row-main"><span class="row-title">Put back in the plan</span></span>${icon('chevR', 'chev')}</button>`
        : `<button type="button" class="row has-icon" data-act="skip"><span class="row-icon">${icon('skipDay')}</span><span class="row-main"><span class="row-title">Skip this session</span><span class="row-sub">Your plan carries on without it</span></span>${icon('chevR', 'chev')}</button>`);
    }
    if (has('openWorkout')) rows.push(`<button type="button" class="row has-icon" data-act="view"><span class="row-icon">${icon('library')}</span><span class="row-main"><span class="row-title">View workout</span><span class="row-sub">Every interval, speed and incline</span></span>${icon('chevR', 'chev')}</button>`);

    s.body.innerHTML = `
      <div class="pn-sh-tags">
        <span class="mode-chip mode-${mode}">${modeIcon(mode)}${esc(MODES[mode].name)}</span>
        <span class="tag">Week ${slot.week} · ${esc(phase.name)}</span>
        ${slot.deload ? '<span class="tag">Lighter week</span>' : ''}
      </div>
      <p class="pn-sh-status ${line.cls}" tabindex="-1" autofocus>${icon(line.icon)}<span>${esc(line.text)}</span></p>
      ${sess || lockReason(slot.workoutId, slot.week) ? '' : steepNoticeHtml(segs)}
      <div class="card pn-sh-card">
        ${sess ? sessionStats(sess) : plannedStats(st)}
        ${sess && sess.rpe ? `<p class="body-s pn-sh-rpe">Effort rating: <b class="num">${sess.rpe}</b> of 10</p>` : ''}
        ${sess ? '' : `<div class="pn-sh-chart">${intervalChart(segs, { h: 96, label: `${w.name} profile: bars show speed, the line shows incline` })}</div>${modeLegend(segs, MODES)}`}
      </div>
      <p class="body-xs">${sess ? '' : `${esc(w.focus || '')}. `}${p.noNumbers ? 'Distance is an estimate from your paces.' : 'Calories are estimates of active energy.'}</p>
      ${rows.length ? `<div class="group">${rows.join('')}</div>` : ''}`;

    if (sess) {
      s.foot.innerHTML = has('openSummary') ? `<button class="btn btn-primary" type="button" data-act="summary">View summary</button>` : `<button class="btn" type="button" data-close>Close</button>`;
    } else {
      s.foot.innerHTML = `<button class="btn btn-mode btn-lg mode-${mode}" type="button" data-act="start">${icon('play')}Start · ${startClock(st.sec)}</button>`;
    }
  };

  s.el.addEventListener('click', (e) => {
    const b = e.target.closest('[data-act], [data-swap]');
    if (!b || !s.el.contains(b)) return;
    const slot = find();
    if (!slot) return;
    if (b.dataset.swap) {
      const id = b.dataset.swap;
      const planned = plannedWorkoutId(slot);
      store.update((m) => { m.plan.swap = { ...(m.plan.swap || {}) }; if (id === planned) delete m.plan.swap[key]; else m.plan.swap[key] = id; });
      haptic('selection');
      toast(id === planned ? 'Back to the planned workout' : `Swapped to ${getWorkout(id).name}`);
      view = 'main'; draw();
      return;
    }
    const act = b.dataset.act;
    if (act === 'start') {
      s.close();
      actions.startWorkout({ workoutId: slot.workoutId, slotKey: slot.key, level: slot.level, length: slot.length });
    } else if (act === 'summary') {
      const sess = slotSession(slot);
      s.close();
      if (sess) actions.openSummary(sess.id, { fresh: false });
    } else if (act === 'view') {
      s.close();
      actions.openWorkout(slot.workoutId, { slotKey: slot.key, level: slot.level, length: slot.length });
    } else if (act === 'move') {
      store.update((m) => { m.plan.moved = { ...(m.plan.moved || {}), [key]: ymd(new Date()) }; if (m.plan.skipped) delete m.plan.skipped[key]; });
      haptic('light'); toast('Moved to today'); draw();
    } else if (act === 'unmove') {
      store.update((m) => { m.plan.moved = { ...(m.plan.moved || {}) }; delete m.plan.moved[key]; });
      toast(`Moved back to ${dayName(slot.planned, 'long')}`); draw();
    } else if (act === 'skip') {
      store.update((m) => { m.plan.skipped = { ...(m.plan.skipped || {}), [key]: true }; });
      haptic('light'); toast('Session skipped. You can put it back here.'); draw();
    } else if (act === 'unskip') {
      store.update((m) => { m.plan.skipped = { ...(m.plan.skipped || {}) }; delete m.plan.skipped[key]; });
      toast('Back in your plan'); draw();
    } else if (act === 'swap') { view = 'swap'; draw(); s.body.scrollTop = 0; }
    else if (act === 'back') { view = 'main'; draw(); }
  });
  s.el.addEventListener('change', (e) => {
    if (!e.target.matches('input[type="checkbox"]')) return;
    const on = e.target.checked;
    store.update((m) => { m.plan.busy = { ...(m.plan.busy || {}) }; if (on) m.plan.busy[key] = true; else delete m.plan.busy[key]; });
    haptic('selection');
    draw();
  });
  draw();
}
actions.openSlot = openSlot;

/* ======================================================================
   Plan tab
   ====================================================================== */

const expanded = new Set(); // weeks the user opened (UI-only state, survives data re-renders)
let expandedInit = '';
let daysDraft = null; // unsaved training-day selection

const STATUS_TEXT = { done: 'Done', today: 'Today', upcoming: '', missed: 'Missed', skipped: 'Skipped', prestart: 'Before start' };

function sessionItem(slot, status, today) {
  const p = state.main.profile;
  const sess = status === 'done' ? slotSession(slot) : null;
  const { segs, st, w, mode } = slotInfo(slot);
  const name = sess && sess.name ? sess.name : w.name;
  const min = sess ? (sess.durationSec || 0) / 60 : st.sec / 60;
  const kcal = sess ? sess.kcal : st.kcal;
  let stTxt = STATUS_TEXT[status];
  if (status === 'done') stTxt = `Done ${dateShort(sess ? sess.date : slot.date)}`;
  if (status === 'upcoming') stTxt = daysBetween(today, slot.date) === 1 ? 'Tomorrow' : '';
  const meta = [minLabel(min)];
  if (!p.noNumbers) meta.push(`≈${roundKcal(kcal)}${NB}kcal`);
  if (state.main.plan.busy && state.main.plan.busy[slot.key] && status !== 'done') meta.push('Busy day');
  if (slot.moved && status !== 'done') meta.push('Moved');
  const aria = `${dateLong(slot.date)}: ${name}, ${Math.round(min)} minutes${stTxt ? ', ' + stTxt : ''}`;
  return `<button type="button" class="pn-sess ${status}" data-slot="${esc(slot.key)}" aria-label="${esc(aria)}">
    <span class="pn-day" aria-hidden="true"><span>${esc(dayName(slot.date, 'short'))}</span><b class="num">${new Date(slot.date).getDate()}</b></span>
    <span class="pn-sess-main">
      <span class="pn-sess-top"><span class="pn-sess-name">${esc(name)}</span>${stTxt ? `<span class="pn-st ${status}">${status === 'done' ? icon('check') : ''}${esc(stTxt)}</span>` : ''}</span>
      <span class="pn-sess-meta">${meta.map(esc).join(' · ')}</span>
      <span class="pn-mini mode-${mode}">${intervalChart(segs, { mini: true, h: 30, label: `${w.name} profile` })}</span>
    </span>
    ${icon('chevR', 'chev')}
  </button>`;
}

function weekCard(week, slots, curWeek, today, began) {
  const ws = slots.filter((s) => s.week === week);
  const start = addDays(planStart(), (week - 1) * 7);
  const end = addDays(start, 6);
  const states = ws.map((s) => slotState(s, today, began));
  const counted = states.filter((x) => x !== 'prestart');
  const done = counted.filter((x) => x === 'done').length;
  const open = expanded.has(week);
  const isCur = week === curWeek;
  const deload = DELOAD_WEEKS.includes(week);
  const missed = states.filter((x) => x === 'missed').length;
  return `<article class="pn-week${isCur ? ' current' : ''}${open ? ' open' : ''}">
    <button type="button" class="pn-week-head" aria-expanded="${open}" aria-controls="pn-w${week}" data-week="${week}">
      <span class="pn-wk-main">
        <span class="pn-wk-title">Week ${week}${isCur ? '<span class="pn-now">This week</span>' : ''}${deload ? '<span class="tag">Lighter</span>' : ''}</span>
        <span class="pn-wk-dates">${esc(dateShort(start))} – ${esc(dateShort(end))} · ${esc(phaseForWeek(week).name)}</span>
      </span>
      <span class="pn-wk-prog num" aria-label="${done} of ${counted.length} done">${counted.length ? `${done}/${counted.length}` : '–'}${missed && week <= curWeek ? `<small>${missed} missed</small>` : ''}</span>
      ${icon('chevD', 'pn-chev')}
    </button>
    <div class="pn-week-body" id="pn-w${week}"${open ? '' : ' hidden'}>
      ${open ? ws.map((s, i) => sessionItem(s, states[i], today)).join('') : ''}
    </div>
  </article>`;
}

function phaseTimeline(curWeek, weeks, block = 1) {
  if (block > 1) {
    // Block 2+: every week runs at Burn level, so one row for the whole block.
    const ph = PHASES[2];
    const st = curWeek > weeks ? 'done' : curWeek >= 1 ? 'current' : 'next';
    const deloads = DELOAD_WEEKS.filter((w) => w <= weeks);
    return `<ol class="pn-tl"><li class="pn-ph ${st}">
      <span class="pn-dot" aria-hidden="true">${st === 'done' ? icon('check') : ''}</span>
      <div class="pn-ph-text">
        <div class="pn-ph-head"><span class="title-s">Block ${block} · ${esc(ph.name)}</span><span class="pn-ph-weeks num">Weeks 1–${weeks}</span>${st === 'current' ? `<span class="pn-now">Week ${curWeek}</span>` : ''}${st === 'done' ? '<span class="sr-only">(completed)</span>' : ''}</div>
        <p class="body-s">Every week at Burn level, with the effort adjustments you have earned.</p>
        ${deloads.length ? `<p class="body-xs">Weeks ${deloads.join(', ')} are lighter weeks: shorter, easier sessions so your body can catch up.</p>` : ''}
      </div>
    </li></ol>`;
  }
  return `<ol class="pn-tl">${PHASES.map((ph) => {
    const [a, b] = ph.weeks;
    const state0 = curWeek > b ? 'done' : curWeek >= a ? 'current' : 'next';
    const deloads = DELOAD_WEEKS.filter((w) => w >= a && w <= b && w <= weeks);
    return `<li class="pn-ph ${state0}">
      <span class="pn-dot" aria-hidden="true">${state0 === 'done' ? icon('check') : ''}</span>
      <div class="pn-ph-text">
        <div class="pn-ph-head"><span class="title-s">${esc(ph.name)}</span><span class="pn-ph-weeks num">Weeks ${a}–${b}</span>${state0 === 'current' ? `<span class="pn-now">Week ${curWeek}</span>` : ''}${state0 === 'done' ? '<span class="sr-only">(completed)</span>' : ''}</div>
        <p class="body-s">${esc(ph.blurb)}</p>
        ${deloads.length ? `<p class="body-xs">Week ${deloads.join(', ')} is a lighter week${a === 1 ? ': shorter, easier sessions so your body can catch up' : ''}.</p>` : ''}
      </div>
    </li>`;
  }).join('')}</ol>`;
}

const DAY_LONG = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const DAY_ABBR = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

function settingsHtml() {
  const p = state.main.profile, plan = state.main.plan;
  const saved = [...new Set(plan.days || [])].sort((a, b) => a - b);
  const draft = daysDraft || saved;
  const dirty = daysDraft && String(daysDraft) !== String(saved);
  const reg = p.sessionLength || 45, busy = p.busyLength || 30;
  const busyOpts = [30, 45].filter((v) => v < reg);
  return `
  <section class="section pn-settings" aria-labelledby="pn-settings-title">
    <h2 class="section-title" id="pn-settings-title">Plan settings</h2>
    <div class="stack-s">
      <div class="group-title" id="pn-days-label">Training days</div>
      <div class="group pn-days">
        <div class="pn-day-chips" role="group" aria-labelledby="pn-days-label">
          ${DAY_ABBR.map((d, i) => `<button type="button" class="chip-toggle" data-day="${i + 1}" aria-pressed="${draft.includes(i + 1)}" aria-label="${DAY_LONG[i]}">${d}</button>`).join('')}
        </div>
        <p class="pn-days-note">${dirty
          ? `${draft.length} days a week. ${daysChangeNote()} Completed sessions stay in your history.`
          : `${saved.length} sessions a week, with hard days kept apart. Pick 2 to 6 days.`}</p>
        ${dirty ? `<div class="pn-days-actions"><button type="button" class="btn btn-sm" data-act="days-cancel">Cancel</button><button type="button" class="btn btn-sm btn-primary" data-act="days-save">Save training days</button></div>` : ''}
      </div>
    </div>
    <div class="group">
      <div class="row pn-set-row">
        <span class="row-main"><span class="row-title">Usual session</span><span class="row-sub">Length of every plan session</span></span>
        ${segmented('len', [30, 45, 60].map((v) => ({ value: v, label: `${v} min` })), reg, { label: 'Usual session length' })}
      </div>
      <div class="row pn-set-row">
        <span class="row-main"><span class="row-title">Busy day</span><span class="row-sub">${busyOpts.length ? 'The shorter version you can pick any day' : 'Your sessions are already the short version'}</span></span>
        ${busyOpts.length > 1 ? segmented('busy', busyOpts.map((v) => ({ value: v, label: `${v} min` })), busy, { label: 'Busy-day length' }) : `<span class="row-value">${busyOpts.length ? `${busyOpts[0]} min` : 'Off'}</span>`}
      </div>
    </div>
    <div class="group">
      <button type="button" class="row has-icon danger" data-act="restart"><span class="row-icon">${icon('refresh')}</span><span class="row-main"><span class="row-title">Restart plan</span><span class="row-sub">Back to week 1, starting ${esc(restartWhen())}. Your history stays.</span></span>${icon('chevR', 'chev')}</button>
    </div>
  </section>`;
}

/** When saved training days take effect, in words (same rule as core/program daysChangeFrom). */
function daysChangeNote() {
  const plan = state.main.plan, wk = currentWeek();
  if (!plan.startDate || wk < 1) return 'Your plan uses your new days from the start.';
  return daysChangeFrom(plan).week > wk
    ? 'This week stays as it is because you already trained. Your new days start next week.'
    : 'Sessions from today on move to your new days.';
}

/** Change training days: slots from today (or next week) on are regenerated; past days and their edits stay (core/program setTrainingDays). */
function saveDays(days) {
  store.update((m) => { setTrainingDays(m.plan, days); });
}

function render(root) {
  const today = new Date();
  const plan = state.main.plan;
  const weeks = plan.weeks || 12;
  const wkRaw = currentWeek(today);
  const curWeek = Math.min(weeks + 1, Math.max(0, wkRaw));
  const slots = planSlots();
  const began = planBegan();
  const initKey = `${plan.startDate}|${curWeek}`;
  if (expandedInit !== initKey) {
    expanded.clear();
    if (curWeek >= 1 && curWeek <= weeks) {
      const ws = slots.filter((x) => x.week === curWeek);
      const allBefore = ws.length && ws.every((x) => slotState(x, today, began) === 'prestart');
      expanded.add(allBefore && curWeek < weeks ? curWeek + 1 : curWeek);
    } else if (curWeek < 1) expanded.add(1);
    expandedInit = initKey;
  }
  const states = slots.map((s) => slotState(s, today, began));
  const countable = states.filter((x) => x !== 'prestart');
  const doneAll = countable.filter((x) => x === 'done').length;
  const block = plan.block || 1;
  const eyebrow = curWeek < 1 ? `Starts ${dateLong(planStart())}`
    : curWeek > weeks ? `Plan complete${block > 1 ? ` · Block ${block}` : ''}`
      : `${block > 1 ? `Block ${block} · ` : ''}Week ${curWeek} of ${weeks} · ${phaseForWeek(curWeek).name}`;

  root.innerHTML = `
    <header class="screen-head">
      <div class="head-text"><p class="eyebrow">${esc(eyebrow)}</p><h1 class="title-xl pn-title">Plan</h1></div>
    </header>

    <section class="card pn-phases" aria-label="Phases">
      ${phaseTimeline(curWeek, weeks, block)}
    </section>

    <section class="section" aria-labelledby="pn-weeks-title">
      <div class="section-head"><h2 class="section-title" id="pn-weeks-title">${weeks} weeks</h2><span class="pn-total num">${doneAll} of ${countable.length} done</span></div>
      <div class="pn-weeks">
        ${Array.from({ length: weeks }, (_, i) => weekCard(i + 1, slots, curWeek, today, began)).join('')}
      </div>
      <p class="body-xs pn-foot-note">${state.main.profile.noNumbers ? 'Times are planned lengths. Tap a session to start, move, skip or swap it.' : 'Calories are estimates of active energy. Tap a session to start, move, skip or swap it.'}</p>
    </section>

    ${settingsHtml()}`;

  const onClick = async (e) => {
    const head = e.target.closest('[data-week]');
    if (head && root.contains(head)) {
      const w = +head.dataset.week;
      if (expanded.has(w)) expanded.delete(w); else expanded.add(w);
      const card = head.closest('.pn-week');
      const body = card.querySelector('.pn-week-body');
      const open = expanded.has(w);
      head.setAttribute('aria-expanded', String(open));
      card.classList.toggle('open', open);
      if (open) {
        const now = new Date(), b = planBegan();
        const ws = planSlots().filter((s) => s.week === w);
        body.innerHTML = ws.map((s) => sessionItem(s, slotState(s, now, b), now)).join('');
      }
      body.hidden = !open;
      haptic('selection');
      return;
    }
    const sl = e.target.closest('[data-slot]');
    if (sl && root.contains(sl)) { openSlot(sl.dataset.slot); return; }
    const chip = e.target.closest('[data-day]');
    if (chip && root.contains(chip)) {
      const d = +chip.dataset.day;
      const cur = [...(daysDraft || [...new Set(state.main.plan.days || [])])];
      const i = cur.indexOf(d);
      if (i >= 0) {
        if (cur.length <= 2) { toast('Pick at least 2 training days'); return; }
        cur.splice(i, 1);
      } else {
        if (cur.length >= 6) { toast('Keep at least one rest day each week'); return; }
        cur.push(d);
      }
      cur.sort((a, b) => a - b);
      daysDraft = String(cur) === String([...new Set(state.main.plan.days || [])].sort((a, b) => a - b)) ? null : cur;
      haptic('selection');
      actions.refresh();
      return;
    }
    const act = e.target.closest('[data-act]');
    if (!act || !root.contains(act)) return;
    if (act.dataset.act === 'days-cancel') { daysDraft = null; actions.refresh(); }
    else if (act.dataset.act === 'days-save') {
      const days = daysDraft; daysDraft = null;
      saveDays(days);
      haptic('success');
      toast(`Training days saved: ${days.map((d) => DAY_ABBR[d - 1]).join(', ')}`);
    } else if (act.dataset.act === 'restart') {
      const ok = await confirmSheet({
        title: 'Restart the plan?',
        body: `Week 1 starts again ${esc(restartWhen())} at Foundation level, and effort adjustments are cleared. Your completed sessions stay in your history and still count toward your totals, but no longer toward this plan.`,
        confirm: 'Restart plan', danger: true,
      });
      if (!ok) return;
      const when = restartWhen();
      restartPlan();
      expandedInit = '';
      toast(`Your plan starts again ${when}`);
    }
  };
  root.addEventListener('click', onClick);
  bindSegmented(root, (name, value) => {
    const v = +value;
    if (name === 'len') store.update((m) => { m.profile.sessionLength = v; if ((m.profile.busyLength || 30) >= v) m.profile.busyLength = 30; });
    if (name === 'busy') store.update((m) => { m.profile.busyLength = v; });
  });
  return () => root.removeEventListener('click', onClick);
}

export default { route: 'plan', tab: 'plan', title: 'Plan', render };
