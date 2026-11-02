// Workouts tab: this week's plan, plan workouts, classics, easy sessions and the user's own workouts,
// plus the workout detail sheet. Registers actions.openWorkout(workoutId, {slotKey, level, length}).
import { state } from '../core/store.js';
import * as store from '../core/store.js';
import { MODES, PHASES, WORKOUTS, INTENSITY, getWorkout, customs, segmentsFor, planStats, timeline, lockReason, currentWeek, weekSlots, planSlots, slotStatus, phaseForWeek, speedFor, planStart, sessionDone } from '../core/program.js';
import { roundKcal } from '../core/science.js';
import { esc, clock, fmt1, speedStr, speedUnit, distStr, distUnit, toElev, elevUnit, dateShort, dateLong, DAY_SHORT, isoDay } from '../core/format.js';
import { actions } from '../ui/actions.js';
import { icon, modeIcon, sheet, confirmSheet, toast, topo, segmented, bindSegmented } from '../ui/kit.js';
import { intervalChart, modeLegend } from '../ui/charts.js';
import { mainMode, curLevel, readDraft, clearDraft, modesIn, profileChart } from './builder.js';
import { slotState, planBegan } from './plan.js';
import { steepNoticeHtml } from './player.js';

const FILTERS = [
  { value: 'all', label: 'All' },
  { value: 'plan', label: 'Plan' },
  { value: 'classic', label: 'Classics' },
  { value: 'easy', label: 'Easy' },
  { value: 'mine', label: 'Mine' },
];
let filter = 'all';
try { const f = sessionStorage.getItem('hp.libFilter'); if (FILTERS.some((x) => x.value === f)) filter = f; } catch { /* storage blocked */ }

const LENGTHS = [30, 45, 60];
const prof = () => state.main.profile;
/** Any whole length from 15 to 60 min (lighter weeks use 23 and 35); anything else falls back to 45. */
const normLen = (n) => (+n >= 15 && +n <= 60 ? Math.round(+n) : 45);
const clampLevel = (L) => Math.max(0, Math.min(2, +L || 0));
const mins = (sec) => Math.round(sec / 60);
/** Incline for display: 8 -> "8.0" */
const inc1 = (i) => fmt1(i);
/** Gated hard workouts (4×4, Sprint Intervals) open at the starter version until one has been finished (spec 3.6). */
const starterFirst = (id) => !!(WORKOUTS[id] && WORKOUTS[id].gated) && !state.sessions.some((s) => s.workoutId === id && sessionDone(s));
/** The phase a built-in workout opens at: this week's plan level, or the starter version for a first 4×4 or sprint session. */
const defaultLevel = (id) => (starterFirst(id) ? 0 : curLevel());

/* ---------------- shared bits ---------------- */

function intensityTag(n) {
  return `<span class="tag lib-int lib-int-${n}">${esc(INTENSITY[n] || 'Moderate')}</span>`;
}
/** True when an interval's label just repeats its mode name ("Jog 2 of 8" on a jog). */
const sameAsMode = (s) => {
  const base = String(s.label || '').replace(/\s*\d+\s+of\s+\d+\s*$/i, '').trim().toLowerCase();
  return !base || base === MODES[s.type].name.toLowerCase() || base === MODES[s.type].short.toLowerCase();
};
const lockTag = () => `<span class="tag lib-lock">${icon('lock')}Locked</span>`;

/** Compact mode key (dot + short name) so the mini chart's colours are never the only cue. */
function modeKeys(segs) {
  return `<span class="lib-keys">${modesIn(segs).map((t) => `<span class="mode-${esc(t)}"><i class="mode-dot"></i>${esc(MODES[t].short)}</span>`).join('')}</span>`;
}

function cardHtml(w, segs, { lock = null, sub = '' } = {}) {
  const st = planStats(segs);
  const hasIncline = prof().treadmill.hasIncline;
  const m = mins(st.sec);
  const peak = hasIncline ? `${inc1(st.maxI)}% max` : `${speedStr(st.maxS)} ${speedUnit()} top`;
  const label = `${w.name}. ${lock ? 'Locked' : INTENSITY[w.intensity] || ''}. ${sub}. ${m} minutes, ${hasIncline ? `up to ${inc1(st.maxI)} percent incline` : `top speed ${speedStr(st.maxS)} ${speedUnit()}`}.`;
  return `<button type="button" class="wk-card lib-card pressable${lock ? ' locked' : ''}" data-act="open" data-id="${esc(w.id)}" aria-label="${esc(label)}">
    <span class="wk-top"><span class="wk-name">${esc(w.name)}</span>${lock ? lockTag() : intensityTag(w.intensity)}</span>
    <span class="lib-focus">${esc(sub)}</span>
    <span class="wk-meta"><span class="lib-meta-i">${icon('clock')}${m} min</span><span class="lib-meta-i">${icon(hasIncline ? 'incline' : 'speed')}${esc(peak)}</span></span>
    <span class="lib-mini" aria-hidden="true">${intervalChart(segs, { mini: true })}${modeKeys(segs)}</span>
  </button>`;
}

function builtinCard(id) {
  const w = getWorkout(id);
  const segs = segmentsFor(id, { level: defaultLevel(id), length: normLen(prof().sessionLength) });
  return cardHtml(w, segs, { lock: lockReason(id), sub: w.focus });
}

function customCard(c) {
  const w = getWorkout(c.id);
  if (!w) return '';
  const segs = segmentsFor(c.id, { level: curLevel() });
  const when = c.updated ? ` · Edited ${dateShort(c.updated)}` : '';
  return cardHtml(w, segs, { sub: `${segs.length} interval${segs.length === 1 ? '' : 's'}${when}` });
}

/* ---------------- sections ---------------- */

function sectionHead(title, right = '', blurb = '') {
  return `<div class="section-head"><h2 class="section-title">${esc(title)}</h2>${right}</div>${blurb ? `<p class="body-s lib-blurb">${esc(blurb)}</p>` : ''}`;
}

function slotRow(slot, started = true, began = planBegan()) {
  const w = getWorkout(slot.workoutId);
  const status = started ? slotState(slot, new Date(), began) : 'upcoming';
  const d = new Date(slot.date);
  const tags = {
    done: `<span class="tag good">${icon('check')}Done</span>`,
    today: '<span class="tag lib-today">Today</span>',
    missed: '<span class="tag">Missed</span>',
    skipped: '<span class="tag">Skipped</span>',
    prestart: '<span class="tag">Before start</span>',
    upcoming: '',
  };
  const bits = [`${slot.length} min`, w ? INTENSITY[w.intensity] : ''];
  if (slot.deload) bits.push('Lighter week');
  if (slot.moved) bits.push('Moved');
  const aria = `${started ? dateLong(d) : DAY_SHORT[isoDay(d) - 1]}: ${w ? w.name : 'Workout'}, ${slot.length} minutes${status === 'upcoming' ? '' : ', ' + (status === 'prestart' ? 'before your plan began' : status)}`;
  return `<button type="button" class="row lib-slot ${status}" data-act="slot" data-key="${esc(slot.key)}" aria-label="${esc(aria)}">
    ${started
      ? `<span class="lib-day${status === 'today' ? ' is-today' : ''}" aria-hidden="true"><span>${DAY_SHORT[isoDay(d) - 1]}</span><b class="num">${d.getDate()}</b></span>`
      : `<span class="lib-day lib-day-only" aria-hidden="true"><b>${DAY_SHORT[isoDay(d) - 1]}</b></span>`}
    <span class="row-main"><span class="row-title">${esc(w ? w.name : 'Workout')}</span><span class="row-sub">${esc(bits.filter(Boolean).join(' · '))}</span></span>
    ${tags[status] || ''}${icon('chevR', 'chev')}
  </button>`;
}

function weekSection() {
  const weeks = state.main.plan.weeks || 12;
  const cw = currentWeek();
  if (cw > weeks) {
    return `<section class="section">${sectionHead('This week’s plan')}
      <div class="group"><a class="row has-icon" href="#plan"><span class="row-icon">${icon('flag')}</span><span class="row-main"><span class="row-title">You finished the 12-week plan</span><span class="row-sub">Start a new block from the Plan tab</span></span>${icon('chevR', 'chev')}</a></div></section>`;
  }
  const started = !!state.main.plan.startDate;
  const wk = Math.max(1, cw);
  const slots = weekSlots(wk);
  if (!slots.length) return '';
  const began = planBegan();
  const counted = slots.filter((s) => slotState(s, new Date(), began) !== 'prestart');
  const done = counted.filter((s) => slotStatus(s) === 'done').length;
  const right = `<a class="section-link" href="#plan">Week ${wk} · ${esc(phaseForWeek(wk).name)}${icon('chevR')}</a>`;
  const note = !started ? 'Your plan hasn’t started yet. These are the sessions for your first week.' : cw === 0 ? `Your plan starts ${dateLong(planStart())}.` : `${done} of ${counted.length} done this week.`;
  return `<section class="section">${sectionHead(started && cw >= 1 ? 'This week’s plan' : 'Your first week', right)}
    <p class="body-s lib-blurb">${esc(note)}</p>
    <div class="group lib-week">${slots.map((sl) => slotRow(sl, started, began)).join('')}</div></section>`;
}

function tilesHtml() {
  return `<div class="lib-tiles">
    <button type="button" class="lib-tile lib-tile-hero pressable" data-act="quick">
      ${topo({ w: 320, h: 220, seed: 11, lines: 12, cx: 0.9, cy: 0.1 })}
      <span class="lib-tile-ico">${icon('wand')}</span>
      <span class="lib-tile-t">Quick Draft</span>
      <span class="lib-tile-s">Pick a length and focus; we draft it on your phone</span>
    </button>
    <button type="button" class="lib-tile pressable" data-act="new">
      <span class="lib-tile-ico">${icon('plus')}</span>
      <span class="lib-tile-t">New workout</span>
      <span class="lib-tile-s">Build it step by step, with repeat blocks</span>
    </button>
  </div>`;
}

const emptyArt = `<svg class="empty-art" viewBox="0 0 120 64" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
  <path d="M6 56h108" opacity=".5"/><path d="M14 56c10 0 14-30 26-30s16 30 26 30" stroke-dasharray="4 5"/>
  <path d="M60 56c9 0 13-38 25-38s14 38 24 38"/><path d="M85 30v14M78 37h14"/></svg>`;

function mineSection({ withTiles }) {
  const list = customs();
  const count = list.length ? `<span class="faint lib-count">${list.length} saved</span>` : '';
  if (!list.length) {
    return `<section class="section">${sectionHead('My workouts')}
      <div class="empty lib-empty">${emptyArt}
        <p class="title-m">No workouts of your own yet</p>
        <p>Draft one from a length and a focus, or build it step by step with repeat blocks.</p>
        <div class="btn-row lib-empty-acts"><button type="button" class="btn btn-primary" data-act="quick">${icon('wand')}Quick Draft</button><button type="button" class="btn btn-ghost" data-act="new">${icon('plus')}New workout</button></div>
      </div></section>`;
  }
  const sorted = [...list].sort((a, b) => String(b.updated || '').localeCompare(String(a.updated || '')));
  return `<section class="section">${sectionHead('My workouts', count, 'Workouts you built or drafted. They start like any plan workout.')}
    ${withTiles ? tilesHtml() : ''}
    <div class="card-grid">${sorted.map(customCard).join('')}</div></section>`;
}

const PLAN_IDS = Object.keys(WORKOUTS).filter((id) => WORKOUTS[id].category === 'plan' && WORKOUTS[id].kind !== 'easy');
const CLASSIC_IDS = Object.keys(WORKOUTS).filter((id) => WORKOUTS[id].category === 'classic');
const EASYKIND_IDS = Object.keys(WORKOUTS).filter((id) => WORKOUTS[id].kind === 'easy');

function gridSection(title, ids, blurb) {
  if (!ids.length) return '';
  return `<section class="section">${sectionHead(title, `<span class="faint lib-count">${ids.length} workout${ids.length === 1 ? '' : 's'}</span>`, blurb)}
    <div class="card-grid">${ids.map(builtinCard).join('')}</div></section>`;
}

function draftBanner() {
  const d = readDraft();
  if (!d) return '';
  const name = (d.model && d.model.name) || 'Untitled workout';
  return `<div class="banner lib-draft" role="status"><span class="banner-icon">${icon('edit')}</span><div class="banner-body"><b>Unsaved workout</b>“${esc(name)}” was still open in the builder.
    <span class="lib-draft-acts"><button type="button" class="btn btn-sm btn-primary" data-act="draft-continue">Continue editing</button><button type="button" class="btn btn-sm btn-text" data-act="draft-discard">Discard</button></span></div></div>`;
}

function bodyHtml() {
  const out = [];
  if (filter === 'all' || filter === 'mine') out.push(draftBanner());
  if (filter === 'all') {
    out.push(weekSection());
    out.push(`<section class="section">${sectionHead('Make your own')}${tilesHtml()}</section>`);
    out.push(gridSection('Plan workouts', PLAN_IDS, 'The five sessions your 12-week plan is built from. Each gets steeper and longer from Foundation to Burn.'));
    out.push(gridSection('Classics', CLASSIC_IDS, 'Well-known treadmill routines, set to your paces and treadmill.'));
    out.push(gridSection('Easy', EASYKIND_IDS, 'Gentle walks for recovery days, lighter weeks and sore legs.'));
    out.push(mineSection({ withTiles: false }));
  } else if (filter === 'plan') {
    out.push(weekSection());
    out.push(gridSection('Plan workouts', PLAN_IDS, 'The five sessions your 12-week plan is built from. Each gets steeper and longer from Foundation to Burn.'));
  } else if (filter === 'classic') {
    out.push(gridSection('Classics', CLASSIC_IDS, 'Well-known treadmill routines, set to your paces and treadmill.'));
  } else if (filter === 'easy') {
    const ids = Object.keys(WORKOUTS).filter((id) => WORKOUTS[id].intensity === 1);
    const mine = customs().filter((c) => (c.intensity || 2) === 1);
    out.push(`<section class="section">${sectionHead('Easy workouts', `<span class="faint lib-count">${ids.length + mine.length} workouts</span>`, 'Lower-effort sessions for recovery days, lighter weeks and sore legs. You should be able to talk the whole way.')}
      <div class="card-grid">${ids.map(builtinCard).join('')}${mine.map(customCard).join('')}</div></section>`);
  } else if (filter === 'mine') {
    out.push(mineSection({ withTiles: customs().length > 0 }));
  }
  return out.filter(Boolean).join('');
}

/* ---------------- detail sheet ---------------- */

function openWorkout(id, opts = {}) {
  const w = getWorkout(id);
  if (!w) { toast('That workout isn’t available any more'); return; }
  const p = prof();
  const slot = opts.slotKey ? planSlots().find((s) => s.key === opts.slotKey) || null : null;
  const S = {
    level: clampLevel(opts.level ?? (slot ? slot.level : defaultLevel(id))),
    length: normLen(opts.length ?? (slot ? slot.length : p.sessionLength)),
    showAll: false,
  };
  const lock = w.custom ? null : lockReason(id);
  const segsNow = () => (w.custom ? segmentsFor(id, { level: curLevel() }) : segmentsFor(id, { level: S.level, length: S.length }));

  const footer = () => {
    const segs = segsNow();
    const m = mins(segs.reduce((a, s) => a + s.dur, 0));
    const second = w.custom
      ? `<button type="button" class="btn" data-act="edit">${icon('edit')}Edit</button>`
      : `<button type="button" class="btn" data-act="customise" ${lock ? 'disabled aria-disabled="true"' : ''}>${icon('sliders')}Customise</button>`;
    return `${second}<button type="button" class="btn btn-mode mode-${mainMode(segs)} lib-start" data-act="start" ${lock ? 'disabled aria-disabled="true"' : ''}>${icon('play')}<span>Start<span class="hide-narrow"> · ${m} min</span></span></button>`;
  };

  const body = () => {
    const segs = segsNow();
    const st = planStats(segs);
    const nn = p.noNumbers;
    const hasIncline = p.treadmill.hasIncline;
    let context = '';
    if (slot) context = `${state.main.plan.startDate ? `${dateLong(slot.date)} · ` : ''}Week ${slot.week}, ${phaseForWeek(slot.week).name}${slot.deload ? ' · lighter week' : ''}`;
    else if (w.custom) context = 'My workout';
    else context = w.category === 'classic' ? `Classic · ${w.focus}` : w.kind === 'easy' ? `Easy · ${w.focus}` : `Plan workout · ${w.focus}`;
    const stats = [
      ['Time', `${mins(st.sec)}<small>min</small>`],
      nn ? ['Intervals', `${segs.length}`] : ['Active', `≈${roundKcal(st.kcal)}<small>kcal</small>`],
      ['Distance', `${distStr(st.km)}<small>${esc(distUnit())}</small>`],
      ['Climb', `${Math.round(toElev(st.elev))}<small>${esc(elevUnit())}</small>`],
      ['Top speed', `${speedStr(st.maxS)}<small>${esc(speedUnit())}</small>`],
      hasIncline ? ['Max incline', `${inc1(st.maxI)}<small>%</small>`] : ['Intervals', `${segs.length}`],
    ];
    const tl = timeline(segs);
    const LIMIT = 8;
    const rows = (S.showAll || tl.length <= LIMIT + 2 ? tl : tl.slice(0, LIMIT)).map((s) => `<tr class="mode-${esc(s.type)}">
        <td class="num lib-t-time">${clock(s.start)}<span class="faint"> to ${clock(s.end)}</span></td>
        <td><span class="lib-t-iv"><span class="lib-t-ico">${modeIcon(s.type)}</span><span class="lib-t-lab"><b>${esc(s.label || MODES[s.type].name)}</b>${sameAsMode(s) ? '' : `<small>${esc(MODES[s.type].name)}</small>`}</span></span></td>
        <td class="num lib-t-n">${speedStr(speedFor(s))}</td>
        <td class="num lib-t-n">${inc1(s.incline)}<small>%</small></td></tr>`).join('');
    const more = !S.showAll && tl.length > LIMIT + 2 ? `<button type="button" class="btn btn-text lib-more" data-act="all">Show all ${tl.length} intervals${icon('chevD')}</button>` : '';
    const lvlHint = !w.custom ? (() => {
      const cur = curLevel();
      const ph = PHASES[S.level];
      if (S.level === 0 && starterFirst(id)) return 'Starter version, the easiest setting. Start here the first time you do this workout.';
      return `${esc(ph.blurb)}${S.level !== cur ? ` Your plan is in ${esc(PHASES[cur].name)} this week.` : ''}`;
    })() : '';
    return `
      <p class="eyebrow lib-context">${esc(context)}</p>
      <p class="prose lib-desc">${esc(w.custom ? customDesc(id, segs) : w.desc)}</p>
      <div class="row-gap lib-tags">${intensityTag(w.intensity)}${lock ? lockTag() : ''}${w.custom ? '' : `<span class="tag">${S.length} min version</span>`}</div>
      ${lock ? `<div class="banner warn lib-lockb"><span class="banner-icon">${icon('lock')}</span><div class="banner-body"><b>Not available yet</b>${esc(lock)}</div></div>` : steepNoticeHtml(segs)}
      ${w.custom ? '' : `<div class="lib-ctl"><span class="label" id="lib-len-l">Length</span>${segmented('len', (LENGTHS.includes(S.length) ? LENGTHS : [...LENGTHS, S.length].sort((a, b) => a - b)).map((n) => ({ value: n, label: `${n} min` })), S.length, { block: true, label: 'Length' })}</div>
      <div class="lib-ctl"><span class="label">Phase</span>${segmented('lvl', PHASES.map((ph) => ({ value: ph.id, label: ph.name })), S.level, { block: true, label: 'Phase' })}<span class="hint">${lvlHint}</span></div>`}
      <div class="card lib-prof">
        <div class="lib-stats">${stats.map(([l, v]) => `<div><span class="stat-label">${l}</span><span class="stat-value">${v}</span></div>`).join('')}</div>
        <div class="lib-chart">${profileChart(segs, { h: 96, label: `${w.name} profile: bars show speed, the line shows incline` })}</div>
        ${modeLegend(segs, MODES)}
        ${nn ? '' : `<p class="body-xs lib-est">Calories are an estimate of active energy from your weight, speed and incline. <button type="button" class="lib-link" data-act="how">How we calculate</button></p>`}
      </div>
      <section class="stack-s">
        <h3 class="title-s">Intervals <span class="faint num">${tl.length}</span></h3>
        <div class="group lib-table-wrap"><table class="lib-table">
          <thead><tr><th scope="col">Time</th><th scope="col">Interval</th><th scope="col" class="lib-t-n">${esc(speedUnit())}</th><th scope="col" class="lib-t-n">Incline</th></tr></thead>
          <tbody>${rows}</tbody></table>${more}</div>
      </section>
      ${w.custom ? `<div class="group">
        <button type="button" class="row has-icon" data-act="dup"><span class="row-icon">${icon('copy')}</span><span class="row-main"><span class="row-title">Duplicate</span><span class="row-sub">Save a copy to change</span></span>${icon('chevR', 'chev')}</button>
        <button type="button" class="row has-icon danger" data-act="delete"><span class="row-icon">${icon('trash')}</span><span class="row-main"><span class="row-title">Delete workout</span></span></button>
      </div>` : ''}`;
  };

  const sh = sheet(body(), { title: w.name, footer: footer(), label: `${w.name} details` });
  sh.el.classList.add('lib-sheet');
  const repaint = () => {
    const y = sh.body.scrollTop;
    sh.body.innerHTML = body();
    sh.foot.innerHTML = footer();
    sh.body.scrollTop = y;
  };
  bindSegmented(sh.el, (name, v) => {
    if (name === 'len') S.length = normLen(v);
    else if (name === 'lvl') S.level = clampLevel(v);
    else return;
    repaint();
  });
  sh.el.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-act]');
    if (!b || !sh.el.contains(b)) return;
    const act = b.dataset.act;
    if (act === 'all') { S.showAll = true; repaint(); return; }
    if (act === 'how') { actions.openHowWeCalculate(); return; }
    if (act === 'start') {
      if (lock) return;
      sh.close();
      actions.startWorkout({ workoutId: id, level: w.custom ? curLevel() : S.level, length: w.custom ? null : S.length, slotKey: slot ? slot.key : null });
      return;
    }
    if (act === 'customise') {
      if (lock) return;
      const segs = segsNow();
      sh.close();
      actions.openBuilder({ draft: { name: `My ${w.name}`, segs, intensity: w.intensity } });
      return;
    }
    if (act === 'edit') { sh.close(); actions.openBuilder({ id }); return; }
    if (act === 'dup') {
      const src = customs().find((c) => c.id === id);
      if (!src) return;
      const copy = { ...structuredClone(src), id: store.uid('c'), name: copyName(src.name), updated: new Date().toISOString() };
      store.update((m) => { m.customs = [copy, ...(m.customs || [])]; });
      sh.close();
      toast(`Saved “${copy.name}” to My workouts`);
      setTimeout(() => openWorkout(copy.id), 240);
      return;
    }
    if (act === 'delete') {
      const yes = await confirmSheet({
        title: 'Delete this workout?',
        body: `“${esc(w.name)}” will be removed from My workouts. Sessions you already did with it stay in your history.`,
        confirm: 'Delete workout', danger: true,
      });
      if (!yes) return;
      store.update((m) => {
        m.customs = (m.customs || []).filter((c) => c.id !== id);
        if (m.plan && m.plan.swap) for (const k of Object.keys(m.plan.swap)) if (m.plan.swap[k] === id) delete m.plan.swap[k];
        if (m.lastWorkoutId === id) m.lastWorkoutId = null;
      });
      const d = readDraft();
      if (d && d.id === id) clearDraft();
      sh.close();
      toast('Workout deleted');
    }
  });
  return sh;
}

function customDesc(id, segs) {
  const c = customs().find((x) => x.id === id);
  const reps = segs.filter((s) => s.role === 'work').length;
  const parts = [`${segs.length} intervals`];
  if (reps > 1) parts.push(`${reps} work efforts`);
  const when = c && c.updated ? ` Last edited ${dateShort(c.updated)}.` : '';
  return `A workout you made: ${parts.join(', ')}. It keeps the length you built and stays within your treadmill’s limits.${when}`;
}

function copyName(name) {
  const base = String(name || 'Workout').replace(/ copy( \d+)?$/i, '');
  const names = new Set(customs().map((c) => c.name));
  let n = `${base} copy`, i = 2;
  while (names.has(n)) n = `${base} copy ${i++}`;
  return n.slice(0, 40);
}

actions.openWorkout = (id, opts) => openWorkout(id, opts || {});

/* ---------------- the screen ---------------- */

export default {
  route: 'library', tab: 'library', title: 'Workouts',
  render(root, param) {
    if (param && FILTERS.some((f) => f.value === param)) filter = param;
    root.classList.add('lib');
    root.innerHTML = `
      <header class="screen-head">
        <div class="head-text"><p class="eyebrow">${Object.keys(WORKOUTS).length + customs().length} workouts</p><h1 class="title-xl">Workouts</h1><p class="body-s">Every workout is set to your paces and your treadmill’s limits.</p></div>
        <div class="head-actions"><button type="button" class="icon-btn" data-act="new" aria-label="New workout">${icon('plus')}</button></div>
      </header>
      <div class="lib-filter" data-el="filter">${segmented('lib-filter', FILTERS, filter, { block: true, label: 'Show workouts' })}</div>
      <div class="lib-body" data-el="body">${bodyHtml()}</div>`;
    const bodyEl = root.querySelector('[data-el="body"]');
    const filterEl = root.querySelector('[data-el="filter"]');

    bindSegmented(root, (name, v) => {
      if (name !== 'lib-filter') return;
      filter = v;
      try { sessionStorage.setItem('hp.libFilter', v); } catch { /* storage blocked */ }
      bodyEl.innerHTML = bodyHtml();
      // If the filter is stuck to the top, jump back to the start of the new list.
      const head = root.querySelector('.screen-head');
      const natural = head.getBoundingClientRect().bottom + window.scrollY + 22;
      const target = natural - (parseFloat(getComputedStyle(filterEl).top) || 0);
      if (window.scrollY > target) window.scrollTo(0, target);
    });

    root.addEventListener('click', async (e) => {
      const b = e.target.closest('[data-act]');
      if (!b || !root.contains(b)) return;
      const act = b.dataset.act;
      if (act === 'open') { openWorkout(b.dataset.id); return; }
      if (act === 'slot') {
        const slot = planSlots().find((s) => s.key === b.dataset.key);
        if (slot) openWorkout(slot.workoutId, { slotKey: slot.key, level: slot.level, length: slot.length });
        return;
      }
      if (act === 'quick') { actions.openQuickDraft(); return; }
      if (act === 'new') { actions.openBuilder({}); return; }
      if (act === 'draft-continue') { actions.openBuilder({ restore: true }); return; }
      if (act === 'draft-discard') {
        const yes = await confirmSheet({ title: 'Discard this draft?', body: 'The unsaved workout and its steps will be deleted.', confirm: 'Discard draft', danger: true });
        if (!yes) return;
        clearDraft();
        bodyEl.innerHTML = bodyHtml();
      }
    });
  },
};
