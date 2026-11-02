// Today tab: greeting and plan meter, effort-adaptation banner, today's session (or rest day), this week,
// the Weekly Summit gauge, the weight card and the next lesson.
import * as store from '../core/store.js';
import { state } from '../core/store.js';
import {
  MODES, WEEKLY_TARGET, DELOAD_WEEKS, planSlots, currentWeek, phaseForWeek, planStart, levelForWeek, evaluateAdaptation,
  applyAdaptation, sessionActivityMin, deloadLength, jogOfferDue, SURFACES, usualSurface, activeSurface, setTodaySurface, FREE_WALK_ID, vigorousExamples,
} from '../core/program.js';
import { roundKcal, PACES, trendSlope, ewmaTrend, paceCap } from '../core/science.js';
import {
  esc, ymd, parseYmd, addDays, startOfWeek, daysBetween, dateLong, dayName, greeting, fmt1, toDist, distUnit, toElev, elevUnit,
  toWeight, weightUnit, toSpeed, speedUnit, isMph,
} from '../core/format.js';
import { actions } from '../ui/actions.js';
import { icon, modeIcon, topo, segmented, bindSegmented, toast } from '../ui/kit.js';
import { weekHills, planMeter, gauge, animateGauges } from '../ui/charts.js';
import { routeDef } from '../ui/router.js';
import { haptic } from '../core/platform.js';
import {
  has, mainMode, minLabel, startClock, planBegan, slotState, slotSession, nextPlanSlot, slotInfo, workSummary, restartPlan, restartWhen,
  distCell, peakCell, surfaceLegend, chartLabel, estimateNote, surfacePicker, surfacePhrase, surfaceChart, adaptWords,
} from './plan.js';

const NB = ' ';
const DAY_MS = 864e5;

/** Lesson order and titles (content lives in me.js). One unlocks per completed session. */
const LESSONS = [
  ['incline', 'Why incline works'],
  ['effort', 'Effort and the talk test'],
  ['warmup', 'Warm-up and cool-down'],
  ['handrails', 'Handrails and form'],
  ['neat', 'Daily steps add up'],
  ['protein', 'Protein and appetite'],
  ['plateaus', 'Plateaus and water weight'],
  ['sleep', 'Sleep and recovery'],
  ['safety', 'Treadmill safety'],
  ['habit', 'Building the habit'],
  ['outdoor', 'Walking outdoors'],
];

let gaugesAnimated = false;
let adaptBusy = false;

const isDone = (s) => s.completed || (s.completion || 0) >= 0.7;

/** "tomorrow" / "Friday" / "Mon 9 Nov" relative to today. */
function relDay(date, today) {
  const n = daysBetween(today, date);
  if (n === 0) return 'today';
  if (n === 1) return 'tomorrow';
  if (n > 1 && n < 7) return dayName(date, 'long');
  return dateLong(date);
}
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

/* ---------------- header ---------------- */

function headerHtml(today, wk, weeks, slots, began) {
  const p = state.main.profile, plan = state.main.plan;
  const name = (p.name || '').trim();
  const block = plan.block || 1;
  const wkStates = new Map();
  slots.forEach((s) => {
    const st = slotState(s, today, began);
    if (st === 'prestart') return;
    const e = wkStates.get(s.week) || { done: 0, total: 0 };
    e.total++; if (st === 'done') e.done++;
    wkStates.set(s.week, e);
  });
  const meterWeeks = Array.from({ length: weeks }, (_, i) => { const e = wkStates.get(i + 1); return { week: i + 1, pct: e && e.total ? e.done / e.total : 0 }; });
  let label, side = '';
  if (wk < 1) label = `${block > 1 ? `Block ${block}` : 'Your plan'} starts ${esc(dateLong(planStart()))}`;
  else if (wk > weeks) label = `<b>Plan complete</b> · ${weeks} of ${weeks} weeks`;
  else {
    const deload = DELOAD_WEEKS.includes(wk);
    label = `${block > 1 ? `Block ${block} · ` : ''}<b>Week ${wk}</b> of ${weeks} · ${deload ? 'Lighter week' : esc(phaseForWeek(wk).name)}`;
    const partialWeek = slots.some((s) => s.week === wk && slotState(s, today, began) === 'prestart');
    if (!partialWeek) side = `Day ${Math.min(weeks * 7, daysBetween(planStart(), today) + 1)} of ${weeks * 7}`;
  }
  return `
    <header class="td-head">
      <div class="td-head-text">
        <p class="eyebrow">${esc(dateLong(today))}</p>
        <h1 class="title-xl td-greet">${esc(greeting(today))}${name ? `, <span class="td-name">${esc(name)}</span>` : ''}</h1>
      </div>
    </header>
    <div class="td-meter">
      <p class="td-meter-label"><span>${label}</span>${side ? `<span class="faint num">${side}</span>` : ''}</p>
      ${planMeter(meterWeeks, Math.max(0, Math.min(weeks + 1, wk)), { block: state.main.plan.block || 1 })}
    </div>`;
}

/* ---------------- adaptation banner ---------------- */

const ADAPT_COPY = {
  ease: { title: 'We eased your plan a little', icon: 'sliders', cls: '' },
  hold: { title: 'Holding steady next week', icon: 'pulse', cls: '' },
  offer: { title: 'Ready for steeper climbs?', icon: 'climb', cls: 'good' },
  step: { title: 'Work intervals are a little steeper', icon: 'climb', cls: 'good' },
};
/** Without an incline the same step-up means a slightly faster pace on work intervals (core personalise). */
const ADAPT_FLAT = {
  offer: { title: 'Ready for a little more pace?', icon: 'stride', cls: 'good' },
  step: { title: 'Work intervals are a little faster', icon: 'stride', cls: 'good' },
};
const adaptCopy = (kind) => (usualSurface() !== 'incline' && ADAPT_FLAT[kind]) || ADAPT_COPY[kind];

function adaptationHtml() {
  const pending = evaluateAdaptation();
  if (pending && (pending.kind === 'ease' || pending.kind === 'hold')) {
    // Safety first: easing or holding applies straight away (idempotent: evaluation only looks at sessions after the last entry).
    if (!adaptBusy) {
      adaptBusy = true;
      setTimeout(() => {
        try { if (evaluateAdaptation()) store.update((m) => applyAdaptation(m.plan, pending.kind, pending.kind === 'ease' ? adaptWords().eased : pending.reason)); } finally { adaptBusy = false; }
      }, 0);
    }
    const c = adaptCopy(pending.kind);
    return banner(c, pending.kind === 'ease' ? adaptWords().eased : pending.reason, `<button type="button" class="btn btn-sm" data-act="adapt-ack">Got it</button>`);
  }
  if (pending && pending.kind === 'offer') {
    const w = adaptWords();
    return banner(adaptCopy('offer'), `Your last two sessions felt easy. ${w.ask} That means ${w.change}.`,
      `<button type="button" class="btn btn-sm btn-primary" data-act="adapt-step">Step it up</button><button type="button" class="btn btn-sm" data-act="adapt-keep">Keep as is</button>`);
  }
  const log = state.main.plan.adaptLog || [];
  const last = log[log.length - 1];
  if (last && !last.ack && ADAPT_COPY[last.kind] && last.kind !== 'offer' && Date.now() - new Date(last.date).getTime() < 7 * DAY_MS) {
    return banner(adaptCopy(last.kind), last.reason, `<button type="button" class="btn btn-sm" data-act="adapt-ack">Got it</button>`);
  }
  if (jogOfferDue()) {
    // Spec 3.7: jogging comes in during Build, after two comfortable sessions, and only when the user says yes.
    const jog = `${fmt1(toSpeed(state.main.profile.paces.jog || 8))}${NB}${speedUnit()}`;
    return banner({ title: 'Ready to try short jogs?', icon: 'jog', cls: 'good' },
      `Your last two sessions felt comfortable. Say yes and some power-walk pushes become short jogs at about ${jog}. You can slow to a walk at any time.`,
      `<button type="button" class="btn btn-sm btn-primary" data-act="jog-yes">Try short jogs</button><button type="button" class="btn btn-sm" data-act="jog-no">Not yet</button>`);
  }
  return '';
}
function banner(c, text, buttons) {
  return `<div class="banner ${c.cls} td-adapt" role="status"><span class="banner-icon">${icon(c.icon)}</span><div class="banner-body"><b>${esc(c.title)}</b>${esc(text)}<div class="td-adapt-actions">${buttons}</div></div></div>`;
}
function ackLast(m) {
  const log = m.plan.adaptLog || [];
  if (log.length) log[log.length - 1] = { ...log[log.length - 1], ack: true };
}

/* ---------------- hero: today's session ---------------- */

function statCell(label, value) { return `<div><span class="stat-label">${label}</span><span class="stat-value">${value}</span></div>`; }

/** Time, ≈ kcal, distance and the surface's headline: max incline, top speed, or (outdoors) the hardest effort. */
function heroStats(st, segs, surface) {
  const p = state.main.profile;
  const cells = [statCell('Time', `${Math.round(st.sec / 60)}<small>min</small>`)];
  if (!p.noNumbers) cells.push(statCell('Active', `≈${roundKcal(st.kcal)}<small>kcal</small>`));
  cells.push(statCell(...distCell(st.km, surface)));
  if (surface === 'incline' && p.noNumbers) cells.push(statCell('Climb', `${Math.round(toElev(st.elev))}<small>${elevUnit()}</small>`));
  const [pl, pv] = peakCell(st, segs, surface);
  cells.push(statCell(pl, pv));
  return `<div class="stat-grid td-stats" style="--td-cols:${cells.length}">${cells.join('')}</div>`;
}

/**
 * "Where today": incline treadmill, flat treadmill or walking pad, or outdoors. A choice other than the usual one
 * lasts for today only (core setTodaySurface); the card's numbers and chart follow it straight away.
 */
function whereHtml(surface) {
  const usual = usualSurface();
  const notes = [];
  if (surface !== usual) notes.push(`Just for today: back to ${surfacePhrase(usual)} tomorrow.`);
  if (surface === 'outdoor') notes.push('Coached by effort, so speeds and distance are estimates.');
  else if (surface === 'flat' && surface !== usual) notes.push('Climbs become faster walking.');
  return `<div class="td-where">
    <span class="td-where-l" aria-hidden="true">Where today</span>
    ${surfacePicker('surface', surface, { label: 'Where you walk today' })}
    ${notes.length ? `<p class="td-where-note">${esc(notes.join(' '))}</p>` : ''}
  </div>`;
}

function sessionHero(slot, status, today) {
  const p = state.main.profile;
  const surface = activeSurface(today); // the hero is always about doing it today
  const { segs, st, w, mode } = slotInfo(slot, surface);
  const lenOf = (x) => (slot.deload ? deloadLength(x) : x); // lighter weeks run every length about 25% shorter
  const busyLen = lenOf(p.busyLength || 30), regLen = lenOf(p.sessionLength || 45);
  const busy = !!(state.main.plan.busy && state.main.plan.busy[slot.key]);
  let eyebrow = 'Today’s session';
  if (status === 'missed') eyebrow = `Missed on ${dayName(slot.date, 'long')} — do it today?`;
  else if (status === 'upcoming') eyebrow = `Up next · ${cap(relDay(slot.date, today))}`;
  const sub = [`Week ${slot.week}`, slot.deload ? 'Lighter week' : phaseForWeek(slot.week).name];
  if (slot.moved && status === 'today') sub.push('Moved to today');
  const meta = workSummary(segs, w, surface);
  const showBusy = busyLen < regLen;
  const detailsBtn = has('openWorkout')
    ? `<button type="button" class="td-link" data-act="details">Details</button><span class="td-dot" aria-hidden="true">·</span><button type="button" class="td-link" data-act="options">${status === 'missed' ? 'Swap or move' : 'Move, swap or skip'}</button>`
    : `<button type="button" class="td-link" data-act="options">Details and options</button>`;
  return `
  <section class="hero-card td-hero" aria-labelledby="td-hero-title">
    ${topo({ seed: 3 })}
    <div class="td-hero-top">
      <p class="eyebrow td-eyebrow">${esc(eyebrow)}</p>
      <span class="mode-chip mode-${mode}">${modeIcon(mode)}${esc(MODES[mode].short)}</span>
    </div>
    <h2 class="title-l td-wname" id="td-hero-title">${esc(w.name)}</h2>
    <p class="td-sub">${esc(sub.join(' · '))}${meta ? ` · ${esc(meta)}` : ''}</p>
    ${whereHtml(surface)}
    ${heroStats(st, segs, surface)}
    <div class="td-chart">${surfaceChart(segs, surface, { h: surface === 'incline' ? 104 : 112, label: chartLabel(w.name, surface) })}</div>
    ${surfaceLegend(segs, surface)}
    <div class="td-actions${showBusy ? '' : ' solo'}">
      ${showBusy ? segmented('busy', [{ value: 'regular', label: `${regLen} min` }, { value: 'busy', label: `${busyLen} min` }], busy ? 'busy' : 'regular', { label: 'Session length. Pick the shorter one on a busy day.' }) : ''}
      <button type="button" class="btn btn-mode btn-lg mode-${mode} td-start" data-act="start" data-slot="${esc(slot.key)}">${icon('play')}<span>Start · <span class="num">${startClock(st.sec)}</span></span></button>
    </div>
    ${showBusy && busy ? `<p class="td-busy-note">${icon('timer')}Busy-day version: shorter warm-up and fewer intervals. It still counts toward your week.</p>` : ''}
    <div class="td-hero-foot">
      <div class="td-links">${detailsBtn}${status === 'missed' ? `<span class="td-dot" aria-hidden="true">·</span><button type="button" class="td-link" data-act="skip-missed">Skip it</button>` : ''}</div>
      <span class="td-est">${esc(estimateNote(surface))}</span>
    </div>
  </section>`;
}

/** Secondary "Just walk" entry under today's session: an open-ended walk with no intervals. */
function freeCard() {
  return `<button type="button" class="card tight td-free" data-act="free">
    <span class="td-free-icon">${icon('stride')}</span>
    <span class="td-free-main"><span class="td-free-title">Just walk</span><span class="body-xs">No intervals. Walk for as long as you like; we keep the time and distance.</span></span>
    <span class="td-free-go mode-brisk" aria-hidden="true">${icon('play')}</span>
  </button>`;
}

/** Compact preview of a slot, used inside the rest-day card. */
function nextPreview(slot, today, label) {
  const p = state.main.profile;
  const info = slotInfo(slot);
  const { segs, st, w, mode } = info;
  const meta = [minLabel(st.sec / 60)];
  if (!p.noNumbers) meta.push(`≈${roundKcal(st.kcal)}${NB}kcal (estimate)`);
  if (slot.deload) meta.push('Lighter week');
  return `<button type="button" class="td-next" data-act="open-slot" data-slot="${esc(slot.key)}" aria-label="${esc(`${label}: ${w.name}, ${Math.round(st.sec / 60)} minutes. Open details`)}">
    <span class="td-next-top"><span class="eyebrow">${esc(label)}</span><span class="mode-chip mode-${mode}">${modeIcon(mode)}${esc(MODES[mode].short)}</span></span>
    <span class="td-next-name">${esc(w.name)}</span>
    <span class="td-next-meta">${meta.map(esc).join(' · ')}</span>
    <span class="td-next-chart">${surfaceChart(segs, info.surface, { mini: true, h: 40, label: `${w.name} profile` })}</span>
  </button>`;
}

function restHero(next, today, { firstTime, skippedToday, doneSess }) {
  const p = state.main.profile;
  const surface = activeSurface(today);
  let eyebrow = 'Rest day', title = 'Recovery is part of the plan.';
  let copy = 'Your muscles adapt between sessions. A relaxed walk or some gentle stretching is plenty today.';
  let easy = 'Or a guided easy walk';
  if (doneSess) {
    const meta = [minLabel((doneSess.durationSec || 0) / 60), `${doneSess.surface === 'outdoor' ? '≈' : ''}${fmt1(toDist(doneSess.distanceKm || 0))}${NB}${distUnit()}`];
    if (!p.noNumbers) meta.push(`≈${roundKcal(doneSess.kcal)}${NB}kcal (estimate)`);
    eyebrow = 'Done for today';
    title = `${doneSess.name || 'Workout'}: done.`;
    copy = `${meta.join(' · ')}. Rest and refuel.${next ? ` Your next session is ${relDay(next.date, today)}.` : ''}`;
  } else if (firstTime && next) {
    eyebrow = 'Getting started';
    title = `Your first session is ${relDay(next.date, today)}.`;
    copy = usualSurface() === 'outdoor'
      ? 'A good day to find a route you like, mostly flat to start. A short, easy walk is a gentle first step.'
      : 'A good day to set up your treadmill and get to know its controls. A short, easy walk is a gentle first step.';
    easy = 'Or try a guided easy walk';
  } else if (skippedToday) {
    eyebrow = 'Day off';
    title = 'Today’s session is skipped.';
    copy = 'Rest well. The plan carries on with your next session. A relaxed walk is still fine if you feel like moving.';
  }
  const label = next ? `${firstTime ? 'First session' : 'Up next'} · ${cap(relDay(next.date, today))}` : '';
  const easyLen = p.busyLength || 30;
  // Rest days: "Just walk" is the main suggestion, with where you walk today right above it.
  const actionsHtml = doneSess
    ? (has('openSummary') ? `<div class="td-rest-actions"><button type="button" class="btn" data-act="summary" data-id="${esc(doneSess.id)}">${icon('checkCircle')}View summary</button></div>` : '')
    : `${whereHtml(surface)}
    <div class="td-rest-actions">
      <button type="button" class="btn btn-mode mode-brisk btn-lg td-free-btn" data-act="free">${icon('play')}Just walk</button>
      <button type="button" class="td-link td-easy-link" data-act="easy">${esc(easy)} · ${easyLen}${NB}min</button>
      <span class="td-est">Just walk has no intervals and no end time. An extra walk counts toward your weekly minutes, not your plan.</span>
    </div>`;
  return `
  <section class="hero-card td-hero td-rest" aria-labelledby="td-hero-title">
    ${topo({ seed: 5 })}
    <p class="eyebrow td-eyebrow">${doneSess ? icon('check', 'td-eyebrow-ico') : ''}${esc(eyebrow)}</p>
    <h2 class="title-l td-rest-title" id="td-hero-title">${esc(title)}</h2>
    <p class="td-rest-copy">${esc(copy)}</p>
    ${actionsHtml}
    ${next ? nextPreview(next, today, label) : ''}
  </section>`;
}

function finishedHero(slots) {
  const plan = state.main.plan;
  const weeks = plan.weeks || 12;
  const doneSlots = slots.filter((s) => slotSession(s));
  const start = planStart();
  const since = state.sessions.filter((s) => new Date(s.date) >= start);
  const climbed = since.reduce((a, s) => a + (s.elevM || 0), 0);
  // Without an incline (or before any climbing) the block is summed up as distance walked.
  const byClimb = usualSurface() === 'incline' && climbed > 0;
  const walked = since.reduce((a, s) => a + (s.distanceKm || 0), 0);
  const total = byClimb
    ? `climbed <b class="num">${Math.round(toElev(climbed)).toLocaleString()}${NB}${elevUnit()}</b>`
    : `walked <b class="num">${Math.round(toDist(walked)).toLocaleString()}${NB}${distUnit()}</b>`;
  const block = plan.block || 1;
  return `
  <section class="hero-card td-hero td-rest" aria-labelledby="td-hero-title">
    ${topo({ seed: 8 })}
    <p class="eyebrow td-eyebrow">${block > 1 ? `Block ${block} complete` : 'Plan complete'}</p>
    <h2 class="title-l td-rest-title" id="td-hero-title">${weeks} weeks, done. ${byClimb ? 'Well climbed.' : 'Well walked.'}</h2>
    <p class="td-rest-copy">You finished <b class="num">${doneSlots.length}</b> of ${slots.length} plan sessions and ${total}. Block ${block + 1} runs the ${weeks} weeks again and keeps the adjustments your effort ratings made.</p>
    <div class="td-rest-actions">
      <button type="button" class="btn btn-primary btn-lg td-block2" data-act="block2">Start block ${block + 1}</button>
      <button type="button" class="btn td-easy" data-act="free">${icon('stride')}Just walk</button>
      <button type="button" class="td-link td-easy-link" data-act="easy">Or a guided easy walk · ${state.main.profile.busyLength || 30}${NB}min</button>
      <span class="td-est">Just walk is open-ended: no intervals, no end time.</span>
    </div>
  </section>`;
}

/* ---------------- this week ---------------- */

function weekStrip(stripStart, slots, today, began) {
  const end = addDays(stripStart, 7);
  const items = []; // {date, kind, slot?, sess?, status}
  for (const s of slots) {
    const status = slotState(s, today, began);
    const sess = status === 'done' ? slotSession(s) : null;
    const d = sess ? new Date(sess.date) : s.date;
    if (d >= stripStart && d < end) items.push({ date: d, slot: s, sess, status });
  }
  const planIds = new Set(items.filter((x) => x.sess).map((x) => x.sess.id));
  for (const sess of state.sessions) {
    const d = new Date(sess.date);
    if (d >= stripStart && d < end && isDone(sess) && !sess.planSlot && !planIds.has(sess.id)) items.push({ date: d, sess, status: 'extra' });
  }
  const rank = { today: 0, done: 1, upcoming: 2, missed: 3, extra: 4, skipped: 5, prestart: 6 };
  const days = [];
  let done = 0, total = 0;
  for (const it of items) { if (it.slot && it.status !== 'prestart') { total++; if (it.status === 'done') done++; } }
  for (let i = 0; i < 7; i++) {
    const date = addDays(stripStart, i);
    const dk = ymd(date);
    const here = items.filter((x) => ymd(x.date) === dk).sort((a, b) => rank[a.status] - rank[b.status]);
    const isToday = dk === ymd(today);
    const main = here[0];
    let st = 'rest', label = 'Rest', mode = 'power', key = `rest:${dk}`, desc = 'rest day';
    if (main) {
      const segInfo = main.slot ? slotInfo(main.slot) : null;
      const sessMode = main.sess && Array.isArray(main.sess.splits) && main.sess.splits.length ? mainMode(main.sess.splits.map((x) => ({ ...x, dur: x.sec, role: 'work' }))) : null;
      mode = (segInfo && segInfo.mode) || sessMode || 'power';
      const min = main.sess ? (main.sess.durationSec || 0) / 60 : segInfo ? segInfo.st.sec / 60 : 0;
      const name = main.sess ? main.sess.name : segInfo ? segInfo.w.name : 'Workout';
      key = main.slot ? `slot:${main.slot.key}` : `sess:${main.sess.id}`;
      if (main.status === 'done') { st = 'done'; label = `Done ${minLabel(min)}`; desc = `${name}, done, ${Math.round(min)} minutes`; }
      else if (main.status === 'extra') { st = 'done'; label = `Extra ${minLabel(min)}`; desc = `${name}, extra workout, ${Math.round(min)} minutes`; }
      else if (main.status === 'today') { st = 'today'; label = `Today ${minLabel(min)}`; desc = `${name}, today, ${Math.round(min)} minutes`; }
      else if (main.status === 'upcoming') { st = 'planned'; label = minLabel(min); desc = `${name}, planned, ${Math.round(min)} minutes`; }
      else if (main.status === 'missed') { st = 'missed'; label = 'Missed'; desc = `${name}, missed`; }
      else if (main.status === 'skipped') { st = 'skipped'; label = 'Skipped'; desc = `${name}, skipped`; }
      else { st = 'rest'; label = ''; desc = 'before your plan began'; }
      const more = here.filter((x) => x.status !== 'prestart').length;
      if (more > 1) { label = `${more} sessions`; desc += `, and ${more - 1} more`; }
    } else if (began && date < began) { label = ''; desc = 'before your plan began'; } // "Rest" means nothing before day one
    days.push({ date, key, state: st, mode, label, isToday, aria: `${dateLong(date)}: ${desc}` });
  }
  return { html: weekHills(days), done, total };
}

/* ---------------- weekly summit ---------------- */

function summitHtml(wk, weekStart, done, total) {
  const ph = phaseForWeek(Math.max(1, Math.min(12, wk || 1)));
  const target = WEEKLY_TARGET[ph.id] || 150;
  const end = addDays(weekStart, 7);
  const minutes = state.sessions.filter((s) => { const d = new Date(s.date); return d >= weekStart && d < end; }).reduce((a, s) => a + sessionActivityMin(s), 0);
  const left = Math.max(0, Math.round(target - minutes));
  const deload = DELOAD_WEEKS.includes(wk);
  return `
  <section class="card td-summit" aria-labelledby="td-summit-title">
    <div class="td-summit-head">
      <h2 class="section-title" id="td-summit-title">Weekly Summit</h2>
      ${total ? `<span class="tag num">${done} of ${total} sessions</span>` : ''}
    </div>
    <div class="td-summit-body">
      ${gauge(minutes, target, { sub: `of ${target} activity minutes`, label: 'Activity minutes this week' })}
      <div class="td-summit-text">
        <p class="td-summit-status">${left ? `<b class="num">${left}</b> minutes to the top` : '<b>Summit reached</b> this week'}</p>
        <p class="body-s">Vigorous minutes, ${esc(vigorousExamples())}, count double. The WHO suggests 150 to 300 a week.</p>
        ${deload ? '<p class="body-xs">Lighter week: a lower total is part of the plan.</p>' : ''}
      </div>
    </div>
  </section>`;
}

/* ---------------- weight ---------------- */

/** Downhill trail from start to goal with a marker at the current progress (0..1). */
function trailSvg(pct, startTxt, goalTxt, pctTxt) {
  const P = [[10, 18], [58, 18], [82, 56], [140, 60]];
  const at = (t) => { const u = 1 - t; return [0, 1].map((k) => u * u * u * P[0][k] + 3 * u * u * t * P[1][k] + 3 * u * t * t * P[2][k] + t * t * t * P[3][k]); };
  const pts = Array.from({ length: 41 }, (_, i) => at(i / 40));
  const lens = [0];
  for (let i = 1; i < pts.length; i++) lens.push(lens[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  const total = lens[lens.length - 1];
  const target = Math.max(0, Math.min(1, pct)) * total;
  let i = lens.findIndex((l) => l >= target); if (i < 1) i = 1;
  const f = (target - lens[i - 1]) / ((lens[i] - lens[i - 1]) || 1);
  const mx = pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * f, my = pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * f;
  const d = `M${P[0][0]} ${P[0][1]} C${P[1][0]} ${P[1][1]} ${P[2][0]} ${P[2][1]} ${P[3][0]} ${P[3][1]}`;
  const r = (n) => n.toFixed(1);
  return `<svg class="td-trail" viewBox="0 0 160 80" aria-hidden="true" focusable="false">
    <path d="${d}" fill="none" stroke="var(--ink-3)" stroke-width="2" stroke-dasharray="1 5" stroke-linecap="round"/>
    <path d="${d}" fill="none" stroke="var(--ink)" stroke-width="2.6" stroke-linecap="round" pathLength="1" stroke-dasharray="${r(Math.max(0.001, Math.min(1, pct)))} 2"/>
    <circle cx="${P[0][0]}" cy="${P[0][1]}" r="3.4" fill="var(--ink)"/>
    <path d="M${P[3][0]} ${P[3][1]}V${P[3][1] - 22}" stroke="var(--ink-2)" stroke-width="1.8" stroke-linecap="round"/>
    <path d="M${P[3][0]} ${P[3][1] - 22}l13 4.5-13 4.5Z" fill="var(--good)"/>
    <circle cx="${r(mx)}" cy="${r(my)}" r="5.4" fill="var(--surface)" stroke="var(--ink)" stroke-width="2.6"/>
    <text class="chart-axis" x="4" y="10">${esc(startTxt)}</text>
    <text class="chart-axis" x="156" y="76" text-anchor="end">${esc(goalTxt)}</text>
    ${pctTxt ? `<text class="chart-axis td-trail-pct" x="${r(Math.min(150, mx + 8))}" y="${r(my - 9)}">${esc(pctTxt)}</text>` : ''}
  </svg>`;
}

/** Trend value at time t (linear between smoothed points), or null before the first weigh-in. */
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
/** True when the trend dropped by more than 1% of body weight in each of the last 3 weeks (same rule as Progress). */
function fastLoss(tr) {
  if (tr.length < 4) return false;
  const last = tr[tr.length - 1].t;
  if ((last - tr[0].t) / DAY_MS < 21) return false;
  for (let k = 0; k < 3; k++) {
    const a = trendAt(tr, last - 7 * k * DAY_MS), b = trendAt(tr, last - 7 * (k + 1) * DAY_MS);
    if (a == null || b == null || !(b - a > 0.01 * b)) return false;
  }
  return true;
}

function weightHtml() {
  const p = state.main.profile;
  if (p.noNumbers || p.goal !== 'lose') return '';
  const logBtn = `<button type="button" class="td-log" data-act="log-weight">${icon('plus')}Log weight</button>`;
  const canOpen = !!routeDef('weight');
  const head = `<div class="td-w-head"><h2 class="eyebrow td-w-title">${canOpen ? `<a href="#weight">Weight goal${icon('chevR')}</a>` : 'Weight goal'}</h2>${logBtn}</div>`;
  if (p.hideWeight) {
    return `<section class="card td-weight">${head}<p class="td-w-hidden">${icon('eyeOff')}<span>Weight is hidden. Your weigh-ins are still saved, and you can show them again in Progress.</span></p></section>`;
  }
  const ws = store.weighIns(); // own weigh-ins plus this run's Apple Health ones (memory only), oldest first
  const start = p.startWeight || (ws[0] && ws[0].kg);
  if (!start) {
    return `<section class="card td-weight">${head}<p class="body-s">Log your first weigh-in to start your trend. Once a week, same time of day, is enough.</p></section>`;
  }
  const now = ws.length ? ws[ws.length - 1].kg : start;
  const goal = p.goalWeight && p.goalWeight < start ? p.goalWeight : null;
  const u = weightUnit();
  const lost = start - now;
  const big = `${lost > 0.05 ? '−' : lost < -0.05 ? '+' : ''}${fmt1(toWeight(Math.abs(lost)))}`;
  const need = goal ? start - goal : 0;
  const pct = need ? Math.max(0, Math.min(1, lost / need)) : 0;
  // pace status
  const pace = (PACES.find((x) => x.id === p.pace) || PACES[1]).kgPerWeek;
  const pts = ws.map((w) => ({ t: parseYmd(w.d).getTime(), kg: w.kg }));
  const ts = trendSlope(pts);
  let rate = null;
  if (ts.ready) rate = -ts.perWeek;
  else if (ws.length >= 2) { const span = daysBetween(parseYmd(ws[0].d), parseYmd(ws[ws.length - 1].d)); if (span >= 10) rate = (ws[0].kg - ws[ws.length - 1].kg) / (span / 7); }
  let tag = '', line = '';
  const wkTxt = (kg) => `${fmt1(toWeight(kg))}${NB}${u}`;
  if (goal && now <= goal) { tag = '<span class="tag good">Goal reached</span>'; line = 'You reached your goal weight. Keep the habit going.'; }
  else if (fastLoss(ewmaTrend(pts)) || (rate != null && rate > paceCap(now))) {
    // Same rule as Progress, plus the app's 1%-of-body-weight cap: never reward a loss rate we call too fast.
    tag = '<span class="tag warn">Faster than planned</span>';
    line = `${rate != null ? `Your trend: about ${wkTxt(rate)} a week, faster than the plan pace of ${wkTxt(pace)} a week. ` : ''}Make sure you eat enough to fuel your workouts.`;
  } else if (rate == null) { line = 'Weigh in a few times a week. Your trend shows after about two weeks.'; }
  else if (rate <= 0.02) { tag = '<span class="tag warn">Behind pace</span>'; line = 'Your trend is flat lately. Day-to-day swings are normal, and the trend matters more.'; }
  else {
    const ratio = rate / pace;
    tag = ratio >= 1.2 ? '<span class="tag good">Ahead of pace</span>' : ratio >= 0.7 ? '<span class="tag good">On pace</span>' : '<span class="tag warn">Behind pace</span>';
    line = `Your trend: about ${wkTxt(rate)} a week. Plan pace: ${wkTxt(pace)} a week.`;
  }
  return `<section class="card td-weight" aria-label="Weight goal">
    ${head}
    <div class="td-w-body">
      <div class="td-w-nums">
        <p class="td-w-big"><span class="display-num num">${big}</span><small>${u}</small></p>
        <p class="td-w-sub">${goal ? `of ${fmt1(toWeight(need))}${NB}${u} · ` : ''}now <b class="num">${fmt1(toWeight(now))}${NB}${u}</b></p>
      </div>
      ${goal ? trailSvg(pct, fmt1(toWeight(start)), fmt1(toWeight(goal)), lost > 0.05 ? `${Math.round(pct * 100)}%` : '') : ''}
    </div>
    <p class="td-w-status">${tag}<span>${esc(line)}</span></p>
  </section>`;
}

/* ---------------- lesson ---------------- */

function lessonHtml() {
  if (!has('openLesson')) return '';
  const read = state.main.lessonsRead || {};
  const unlocked = Math.min(LESSONS.length, state.sessions.filter(isDone).length);
  const idx = LESSONS.findIndex(([id], i) => i < unlocked && !read[id]);
  if (idx < 0) {
    if (unlocked >= LESSONS.length) return '';
    const [, title] = LESSONS[unlocked];
    return `<div class="card tight td-lesson locked"><span class="td-lesson-icon">${icon('lock')}</span><span class="td-lesson-main"><span class="eyebrow">Lesson ${unlocked + 1} of ${LESSONS.length}</span><span class="td-lesson-title">${esc(title)}</span><span class="body-xs">Unlocks after your next session</span></span></div>`;
  }
  const [id, title] = LESSONS[idx];
  return `<button type="button" class="card tight td-lesson" data-act="lesson" data-id="${esc(id)}">
    <span class="td-lesson-icon">${icon('book')}</span>
    <span class="td-lesson-main"><span class="eyebrow">Lesson ${idx + 1} of ${LESSONS.length} · 2 min read</span><span class="td-lesson-title">${esc(title)}</span></span>
    ${icon('chevR', 'chev')}
  </button>`;
}

/* ---------------- render ---------------- */

/** Save today's surface (a just-for-today choice, or back to the usual one) and say what it changes. */
function chooseSurface(id) {
  if (!SURFACES[id] || id === activeSurface()) return;
  const usual = usualSurface();
  store.update((m) => setTodaySurface(m, id));
  if (id === usual) toast(`Back to your usual: ${SURFACES[id].name.toLowerCase()}`);
  else toast(`${SURFACES[id].short} today. ${SURFACES[id].blurb}`, { ms: 3200 });
}

function render(root, _param, ctx = {}) {
  const today = new Date();
  const plan = state.main.plan, p = state.main.profile;
  const weeks = plan.weeks || 12;
  const wk = currentWeek(today);
  const slots = planSlots();
  const began = planBegan();
  const next = nextPlanSlot(slots, today);
  const nextStatus = next ? slotState(next, today, began) : null;
  const todays = slots.filter((s) => ymd(s.date) === ymd(today));
  const doneToday = todays.find((s) => slotState(s, today, began) === 'done');
  const skippedToday = todays.some((s) => slotState(s, today, began) === 'skipped');
  const firstTime = !state.sessions.some(isDone);
  const finished = !next && wk >= weeks;

  const doneSess = doneToday ? slotSession(doneToday) : null;

  let hero, free = '';
  if (finished) hero = finishedHero(slots);
  else if (next && nextStatus === 'today') { hero = sessionHero(next, nextStatus, today); free = freeCard(); }
  else if (next && nextStatus === 'missed' && !doneSess) { hero = sessionHero(next, nextStatus, today); free = freeCard(); }
  else if (doneSess) { hero = restHero(slots.find((s) => slotState(s, today, began) === 'upcoming') || null, today, { doneSess }); free = freeCard(); }
  else hero = restHero(next, today, { firstTime, skippedToday });

  // Week strip: this week, or the first real week when this one is entirely before the plan began.
  let stripStart = startOfWeek(today), stripTitle = 'This week';
  const thisWeekSlots = slots.filter((s) => s.date >= stripStart && s.date < addDays(stripStart, 7));
  if (thisWeekSlots.length && thisWeekSlots.every((s) => slotState(s, today, began) === 'prestart') && wk < weeks) { stripStart = addDays(stripStart, 7); stripTitle = 'Next week'; }
  if (wk < 1) { stripStart = startOfWeek(planStart()); stripTitle = 'Week 1'; }
  const strip = weekStrip(stripStart, slots, today, began);
  const thisWk = weekStrip(startOfWeek(today), slots, today, began);

  root.innerHTML = `
    ${headerHtml(today, wk, weeks, slots, began)}
    ${adaptationHtml()}
    ${hero}
    ${free}
    <section class="section td-week" aria-labelledby="td-week-title">
      <div class="section-head">
        <h2 class="section-title" id="td-week-title">${stripTitle}</h2>
        ${strip.total ? `<span class="td-count"><b class="num">${strip.done}</b> of ${strip.total} done</span>` : ''}
      </div>
      ${strip.html}
      <a class="section-link td-plan-link" href="#plan">See the full plan${icon('chevR')}</a>
    </section>
    ${summitHtml(wk, startOfWeek(today), thisWk.done, thisWk.total)}
    ${weightHtml()}
    ${lessonHtml()}`;

  if (!ctx.refresh && !gaugesAnimated) { gaugesAnimated = true; animateGauges(root); }

  bindSegmented(root, (name, value) => {
    if (name === 'surface') { chooseSurface(value); return; }
    if (name !== 'busy' || !next) return;
    const key = next.key, on = value === 'busy';
    store.update((m) => { m.plan.busy = { ...(m.plan.busy || {}) }; if (on) m.plan.busy[key] = true; else delete m.plan.busy[key]; });
  });

  const onClick = (e) => {
    const day = e.target.closest('.week-hills [data-day]');
    if (day && root.contains(day)) {
      const [kind, id] = String(day.dataset.day).split(/:(.*)/s);
      if (kind === 'slot') actions.openSlot(id);
      else if (kind === 'sess' && has('openSession')) actions.openSession(id);
      return;
    }
    const b = e.target.closest('[data-act]');
    if (!b || !root.contains(b)) return;
    const act = b.dataset.act;
    const lvl = levelForWeek(Math.max(1, Math.min(weeks, wk || 1)));
    switch (act) {
      case 'start': if (next) actions.startWorkout({ workoutId: next.workoutId, slotKey: next.key, level: next.level, length: next.length }); break;
      case 'details': if (next) actions.openWorkout(next.workoutId, { slotKey: next.key, level: next.level, length: next.length }); break;
      case 'options': if (next) actions.openSlot(next.key); break;
      case 'open-slot': actions.openSlot(b.dataset.slot); break;
      case 'skip-missed':
        if (next) { const key = next.key; store.update((m) => { m.plan.skipped = { ...(m.plan.skipped || {}), [key]: true }; }); haptic('light'); toast('Skipped. Your plan carries on.'); }
        break;
      case 'easy': actions.startWorkout({ workoutId: 'easy', level: lvl, length: p.busyLength || 30 }); break;
      case 'free': actions.startWorkout({ workoutId: FREE_WALK_ID }); break;
      case 'summary': actions.openSummary(b.dataset.id, { fresh: false }); break;
      case 'log-weight': actions.logWeight(); break;
      case 'lesson': actions.openLesson(b.dataset.id); break;
      case 'block2': { const when = restartWhen(new Date(), { nextBlock: true }); restartPlan({ nextBlock: true }); haptic('success'); toast(`Block ${(state.main.plan.block || 2)} starts ${when}`); break; }
      case 'jog-yes':
        store.update((m) => { m.profile.canJog = 'yes'; delete m.plan.jogAsked; });
        haptic('success'); toast('Short jogs start with your next plan session');
        break;
      case 'jog-no':
        store.update((m) => { m.plan.jogAsked = new Date().toISOString(); });
        toast('Power-walk pushes it is. We’ll ask again after two more easy sessions.');
        break;
      case 'adapt-ack': store.update((m) => ackLast(m)); break;
      case 'adapt-step': {
        const pending = evaluateAdaptation();
        if (!pending || pending.kind !== 'offer') break;
        const incline = usualSurface() === 'incline';
        store.update((m) => { applyAdaptation(m.plan, 'step', incline ? 'You chose slightly steeper work intervals after two sessions that felt easy.' : 'You chose a slightly faster pace on work intervals after two sessions that felt easy.'); ackLast(m); });
        haptic('success'); toast(incline ? 'Done. Work intervals are now 1% steeper.' : 'Done. Work intervals are now a little faster.');
        break;
      }
      case 'adapt-keep':
        store.update((m) => { applyAdaptation(m.plan, 'keep', 'You kept your current level.'); ackLast(m); });
        toast('Keeping your current level');
        break;
      default: break;
    }
  };
  root.addEventListener('click', onClick);
  return () => root.removeEventListener('click', onClick);
}

export default { route: 'today', tab: 'today', title: 'Today', render };
