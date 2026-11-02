// Post-workout summary overlay: actions.openSummary(sessionId, { fresh }).
// fresh = straight after a run (records, badges, confetti, effort-based plan adaptation, console match, Apple Health save on Done).
// Not fresh = opened from history / plan / Today: read-only except effort and notes.
import * as store from '../core/store.js';
import { state } from '../core/store.js';
import {
  MODES, PHASES, WEEKLY_TARGET, DELOAD_WEEKS, planSlots, slotStatus, phaseForWeek, currentWeek, evaluateAdaptation, applyAdaptation,
  sessionActivityMin,
} from '../core/program.js';
import { roundKcal, KMH_PER_MPH } from '../core/science.js';
import { newRecords, collectNew } from '../core/achievements.js';
import {
  esc, clock, fmt1, fmt2, toDist, distUnit, toElev, elevUnit, toSpeed, speedUnit, isMph, dateLong, dateShort, startOfWeek, addDays,
  ymd, sameDay,
} from '../core/format.js';
import { features, healthSaveWorkout, copyText, haptic, shareText as shareViaSystem } from '../core/platform.js';
import { actions } from '../ui/actions.js';
import { currentRoute } from '../ui/router.js';
import { icon, modeIcon, topo, toast, countUp, confetti, debounce, RM } from '../ui/kit.js';
import { planBegan, slotState, slotSession } from './plan.js';

const NB = ' ';
const isDone = (s) => !!(s && (s.completed || (s.completion || 0) >= 0.7));
const getS = (id) => state.sessions.find((x) => x.id === id) || null;
const fromDist = (v) => (isMph() ? v * KMH_PER_MPH : v);
const r3 = (n) => Math.round(n * 1000) / 1000;
const r1 = (n) => Math.round(n * 10) / 10;

/** Talk-test anchors for the effort picker. */
const EFFORT = [
  { lo: 1, name: 'Very easy', talk: 'You could sing' },
  { lo: 3, name: 'Easy', talk: 'Full sentences' },
  { lo: 5, name: 'Moderate', talk: 'Short phrases' },
  { lo: 7, name: 'Hard', talk: 'A few words' },
  { lo: 9, name: 'Max effort', talk: 'Can’t talk' },
];
const effortOf = (n) => EFFORT[Math.min(4, Math.max(0, Math.floor((n - 1) / 2)))];

const RECORD_COPY = {
  distanceKm: { title: 'Longest distance in a session', icon: 'route' },
  elevM: { title: 'Most climb in a session', icon: 'mountain' },
  kcal: { title: 'Most active energy in a session', icon: 'bolt' },
};

const ADAPT_COPY = {
  ease: { title: 'We eased your next sessions', icon: 'sliders', cls: '' },
  hold: { title: 'Holding steady next week', icon: 'pulse', cls: '' },
  offer: { title: 'Step it up?', icon: 'climb', cls: 'good' },
  step: { title: 'Work intervals are a little steeper', icon: 'climb', cls: 'good' },
  keep: { title: 'Keeping your current level', icon: 'checkCircle', cls: '' },
};
const STEP_REASON = 'You chose slightly steeper work intervals after two sessions that felt easy.';
const KEEP_REASON = 'You kept your current level.';

/** Newly unlocked badges per session, so reopening a fresh summary in this app run shows the same cards. */
const collected = new Map();
/** Sessions with an Apple Health save in flight (never write twice). */
const healthBusy = new Set();

let cur = null; // the open summary

/* ======================================================================
   derived data
   ====================================================================== */

/** The plan slot a session completed, with its week's progress. */
function planPosition(s) {
  if (!s.planSlot || !state.main.plan.startDate) return null;
  const slots = planSlots();
  const slot = slots.find((x) => x.key === s.planSlot);
  if (!slot) return null;
  const began = planBegan();
  const all = slots.filter((x) => x.week === slot.week);
  const week = all.filter((x) => slotState(x, new Date(), began) !== 'prestart');
  const done = week.filter((x) => slotStatus(x) === 'done').length;
  const phase = phaseForWeek(slot.week);
  const weekComplete = week.length > 0 && done === week.length && isDone(s);
  const phaseEnd = weekComplete && slot.week === phase.weeks[1];
  return { slot, week: slot.week, weeks: state.main.plan.weeks || 12, done, total: week.length, partial: week.length < all.length, phase, weekComplete, phaseEnd };
}

/** Activity minutes and sessions for the calendar week the session falls in. */
function weekProgress(s) {
  const d = new Date(s.date);
  const ws = startOfWeek(d), we = addDays(ws, 7);
  const wk = currentWeek(d);
  const plan = state.main.plan;
  const inPlan = !!plan.startDate && wk >= 1 && wk <= (plan.weeks || 12);
  const ph = phaseForWeek(Math.max(1, Math.min(12, wk || 1)));
  const target = WEEKLY_TARGET[ph.id] || 150;
  const list = state.sessions.filter((x) => { const t = new Date(x.date); return t >= ws && t < we; });
  const minutes = list.reduce((a, x) => a + sessionActivityMin(x), 0);
  let done = 0, total = 0;
  if (inPlan) {
    const began = planBegan(), today = new Date();
    for (const sl of planSlots()) {
      const st = slotState(sl, today, began);
      if (st === 'prestart') continue;
      const ss = st === 'done' ? slotSession(sl) : null;
      const dd = ss ? new Date(ss.date) : sl.date;
      if (dd >= ws && dd < we) { total++; if (st === 'done') done++; }
    }
  }
  return {
    minutes, target, done, total, count: list.filter(isDone).length,
    thisWeek: ymd(ws) === ymd(startOfWeek(new Date())), ws, deload: inPlan && DELOAD_WEEKS.includes(wk),
  };
}

/** Records this session holds, minus anything hidden by "train without numbers". */
function recordsFor(s) {
  const p = state.main.profile;
  return newRecords(s).filter((k) => !(k === 'kcal' && p.noNumbers));
}

/** Badges a user should see (calorie and weight badges stay hidden when those numbers are hidden). */
function visibleBadges(list) {
  const p = state.main.profile;
  return (list || []).filter((a) => !(a.group === 'Energy' && p.noNumbers) && !(a.group === 'Weight' && (p.noNumbers || p.hideWeight)));
}

function recordValue(k, s) {
  if (k === 'distanceKm') return `${fmt2(toDist(s.distanceKm))}${NB}${distUnit()}`;
  if (k === 'elevM') return `${Math.round(toElev(s.elevM)).toLocaleString()}${NB}${elevUnit()}`;
  return `≈${NB}${roundKcal(s.kcal).toLocaleString()}${NB}kcal`;
}

/** "Your last two sessions felt very hard, so … jogs 0.3 km/h slower." in the user's speed unit. */
function localReason(text) {
  return String(text || '').replace(/(\d+(?:\.\d+)?) km\/h/g, (_, v) => (isMph() ? `${fmt1(toSpeed(+v)).replace(/\.0$/, '')}${NB}mph` : `${v}${NB}km/h`));
}

/** Plain-text line for copying or sharing (hidden stats are left off; calories are never shared). */
function shareText(s) {
  const parts = ['Hillpace', s.name || 'Workout', clock(s.durationSec), `${fmt2(toDist(s.distanceKm))} ${distUnit()}`];
  if ((s.elevM || 0) > 0) parts.push(`${Math.round(toElev(s.elevM)).toLocaleString()} ${elevUnit()} climbed`);
  if (s.rpe) parts.push(`effort ${s.rpe}/10`);
  return parts.join(' · ');
}

/** "45:00", "45", "1:02:05" → seconds (NaN when unreadable). */
function parseClock(str) {
  const t = String(str || '').trim().replace(/[.,]/g, ':');
  if (/^\d+$/.test(t)) return +t * 60;
  const m = t.match(/^(?:(\d+):)?(\d{1,2}):(\d{1,2})$/);
  if (!m) return NaN;
  const h = +(m[1] || 0), mi = +m[2], se = +m[3];
  if (se > 59 || (m[1] && mi > 59)) return NaN;
  return h * 3600 + mi * 60 + se;
}

const timeOfDay = (d) => new Date(d).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });

/* ======================================================================
   HTML
   ====================================================================== */

function statCell(label, valueHtml, unit, key) {
  return `<div class="sm-stat" data-stat="${key}"><span class="stat-label">${esc(label)}</span><span class="sm-stat-val">${valueHtml}${unit ? `<small>${esc(unit)}</small>` : ''}</span></div>`;
}

function statsHtml(s) {
  const p = state.main.profile;
  const cells = [statCell('Time', `<span class="num" data-count="${Math.round(s.durationSec || 0)}" data-fmt="clock">${clock(s.durationSec)}</span>`, '', 'time')];
  cells.push(statCell('Distance', `<span class="num" data-count="${toDist(s.distanceKm || 0)}" data-dec="2">${fmt2(toDist(s.distanceKm))}</span>`, distUnit(), 'dist'));
  if (!p.treadmill.hasIncline && !(s.elevM > 0)) {
    const avg = s.durationSec > 0 ? (s.distanceKm || 0) / (s.durationSec / 3600) : 0;
    cells.push(statCell('Avg speed', `<span class="num" data-count="${toSpeed(avg)}" data-dec="1">${fmt1(toSpeed(avg))}</span>`, speedUnit(), 'speed'));
  } else {
    const up = Math.round(toElev(s.elevM || 0));
    cells.push(statCell('Climbed', `<span class="num" data-count="${up}">${up.toLocaleString()}</span>`, elevUnit(), 'elev'));
  }
  if (p.noNumbers) {
    const am = Math.round(sessionActivityMin(s));
    cells.push(statCell('Activity', `<span class="num" data-count="${am}">${am}</span>`, 'min', 'act'));
  } else {
    const k = roundKcal(s.kcal);
    cells.push(statCell('Active', `<span class="sm-approx" aria-hidden="true">≈</span><span class="sr-only">about </span><span class="num" data-count="${k}">${k.toLocaleString()}</span>`, 'kcal', 'kcal'));
  }
  return `<div class="sm-stats">${cells.join('')}</div>`;
}

function heroHtml(s, pos) {
  const p = state.main.profile;
  const pct = Math.round((s.completion || 0) * 100);
  const manual = s.source === 'manual';
  const complete = s.completed || pct >= 100;
  const status = manual ? 'Logged workout' : complete ? 'Workout complete' : `Saved as partial · ${pct}%`;
  const statusIcon = complete || manual ? 'checkCircle' : 'flag';
  const when = sameDay(s.date, new Date()) ? 'Today' : dateLong(s.date);
  const tags = [];
  if (pos) {
    tags.push(`<span class="tag">Week ${pos.week} of ${pos.weeks} · ${esc(pos.phase.name)}</span>`);
    tags.push(isDone(s) ? `<span class="tag num">${pos.done} of ${pos.total} done</span>` : '<span class="tag">Not counted yet</span>');
  } else if (!manual) tags.push('<span class="tag">Extra workout</span>');
  if (s.consoleEdited) tags.push(`<span class="tag">${icon('check')}Matched to treadmill</span>`);
  const partialNote = !complete && !manual && pos && !isDone(s)
    ? `<p class="sm-note">${icon('info')}<span>Plan sessions count toward your week at 70% or more. This one reached ${pct}%.</span></p>`
    : !complete && !manual && !pos ? `<p class="sm-note">${icon('info')}<span>You ended early. Everything you did is saved.</span></p>` : '';
  const est = p.noNumbers
    ? '<p class="sm-est">Activity minutes count jogs and steep climbs double.</p>'
    : '<p class="sm-est">≈ kcal is an estimate of active energy, not counting what you burn at rest. <button type="button" class="sm-link" data-act="how">How we calculate</button></p>';
  return `
  <section class="hero-card sm-hero" aria-labelledby="sm-title">
    ${topo({ seed: 7, cx: 0.85, cy: 0.12 })}
    <div class="sm-hero-top">
      <span class="eyebrow sm-status">${icon(statusIcon)}${esc(status)}</span>
      <button type="button" class="icon-btn sm-close" data-act="done" aria-label="Close summary">${icon('close')}</button>
    </div>
    <h1 class="title-xl sm-title" id="sm-title" tabindex="-1">${esc(s.name || 'Workout')}</h1>
    <p class="sm-meta">${esc(when)} · ${esc(timeOfDay(s.date))}</p>
    ${tags.length ? `<div class="sm-tags">${tags.join('')}</div>` : ''}
    ${partialNote}
    <div data-region="stats">${statsHtml(s)}</div>
    ${est}
  </section>`;
}

function highlightsHtml(s, c) {
  const recs = c.records.map((k) => `
    <li class="sm-record">
      <span class="sm-record-ico">${icon(RECORD_COPY[k].icon)}</span>
      <span class="sm-record-text"><b>${c.fresh ? 'New record' : 'Your best'}</b><span>${esc(RECORD_COPY[k].title)}</span></span>
      <span class="sm-record-val num">${recordValue(k, s)}</span>
    </li>`).join('');
  const cards = [];
  const pos = c.pos;
  if (c.fresh && pos && pos.weekComplete) {
    const next = PHASES[pos.phase.id + 1];
    if (pos.phaseEnd) {
      cards.push(card('flag', 'Phase complete', `${pos.phase.name} is done`,
        next ? `Weeks ${pos.phase.weeks[0]}–${pos.phase.weeks[1]} are behind you. ${next.name} starts next week: ${next.blurb.charAt(0).toLowerCase()}${next.blurb.slice(1)}` : 'That is the whole 12-week plan. Take a moment to enjoy it.'));
    } else {
      const desc = !pos.partial ? `All ${pos.total} planned sessions done.`
        : pos.total === 1 ? 'That was the only session left this week. Your plan carries on next week.'
          : `All ${pos.total} sessions left this week are done.`;
      cards.push(card('plan', 'Plan', `Week ${pos.week} complete`, desc));
    }
  }
  for (const a of c.badges) cards.push(card(a.icon, 'Badge unlocked', a.title, a.desc));
  if (!recs && !cards.length) return '';
  // A burst of badges (first run after an update, or a big week) shouldn't push the effort rating off screen.
  const MAX = 3;
  const folded = !c.allBadges && cards.length > MAX + 1 ? cards.length - MAX : 0;
  const shown = folded ? cards.slice(0, MAX) : cards;
  const rest = folded ? cards.slice(MAX).map((h) => h.replace('<div class="sm-card"', '<div class="sm-card" hidden data-more')) : [];
  return `
  <section class="sm-highlights" aria-label="Highlights">
    ${recs ? `<ul class="sm-records" role="list">${recs}</ul>` : ''}
    ${cards.length ? `<div class="sm-cards">${shown.join('')}${rest.join('')}</div>` : ''}
    ${folded ? `<button type="button" class="btn btn-ghost sm-more" data-act="more-badges">${icon('chevD')}Show ${folded} more ${folded === 1 ? 'badge' : 'badges'}</button>` : ''}
  </section>`;
}
const CARD_ICON = { calendar: 'plan' }; // achievements name an icon kit doesn't have
function card(ico, eyebrow, title, desc) {
  return `<div class="sm-card"><span class="sm-card-ico">${icon(CARD_ICON[ico] || ico)}</span><div class="sm-card-text"><span class="eyebrow">${esc(eyebrow)}</span><b>${esc(title)}</b><span>${esc(desc)}</span></div></div>`;
}

function effortHtml(s, c) {
  const sub = c.fresh && s.planSlot
    ? 'Rate the whole session. Your plan uses your last two ratings to set the effort of the sessions ahead.'
    : 'Rate the whole session, using the talk test.';
  const rows = EFFORT.map((g) => `
    <div class="sm-eff-row${s.rpe && effortOf(s.rpe) === g ? ' on' : ''}">
      <span class="sm-eff-text"><span class="sm-eff-name">${esc(g.name)}</span><span class="sm-eff-talk">${esc(g.talk)}</span></span>
      <span class="sm-eff-btns">${[g.lo, g.lo + 1].map((n) => `<button type="button" class="num" data-rpe="${n}" aria-pressed="${s.rpe === n}" aria-label="Effort ${n} of 10, ${esc(g.name.toLowerCase())}: ${esc(g.talk.toLowerCase())}">${n}</button>`).join('')}</span>
    </div>`).join('');
  return `
  <section class="section sm-effort-sec" aria-labelledby="sm-eff-title">
    <div class="stack-s">
      <h2 class="section-title" id="sm-eff-title">How hard did that feel?</h2>
      <p class="body-s">${sub}</p>
    </div>
    <div class="sm-effort" role="group" aria-labelledby="sm-eff-title">${rows}</div>
    <p class="body-xs sm-eff-status" data-region="eff-status" aria-live="polite">${effortStatus(s)}</p>
    <div data-region="adapt" aria-live="polite">${adaptHtml(c)}</div>
  </section>`;
}
function effortStatus(s) {
  return s.rpe ? `Effort ${s.rpe} of 10 saved. You can change it any time.` : 'Tap the number that matches how the session felt overall.';
}

function adaptHtml(c) {
  const a = c && c.adapt;
  if (!a) return '';
  const k = ADAPT_COPY[a.kind];
  let body = '', buttons = '';
  if (a.kind === 'offer') {
    body = `${localReason(a.reason)} That means 1% more incline on work intervals and ${isMph() ? `0.1${NB}mph` : `0.2${NB}km/h`} more on jogs.`;
    buttons = '<div class="sm-adapt-actions"><button type="button" class="btn btn-sm btn-primary" data-act="adapt-step">Yes, step it up</button><button type="button" class="btn btn-sm" data-act="adapt-keep">Not now</button></div>';
  } else if (a.kind === 'step') {
    body = `From your next plan session: 1% more incline on work intervals and ${isMph() ? `0.1${NB}mph` : `0.2${NB}km/h`} more on jogs. Keep rating your effort and the plan keeps adjusting.`;
  } else if (a.kind === 'keep') {
    body = 'Your plan stays as it is. We’ll check again after your next two rated plan sessions.';
  } else {
    body = localReason(a.reason);
  }
  return `<div class="banner ${k.cls} sm-adapt" role="status"><span class="banner-icon">${icon(k.icon)}</span><div class="banner-body"><b>${esc(k.title)}</b>${esc(body)}${buttons}</div></div>`;
}

function notesHtml(s) {
  return `
  <section class="field sm-notes">
    <label for="sm-notes" class="sm-notes-label">Notes</label>
    <textarea id="sm-notes" class="input" rows="3" maxlength="1000" placeholder="How did it feel? Sore spots, which treadmill, anything for next time.">${esc(s.notes || '')}</textarea>
  </section>`;
}

function weekHtml(s) {
  const w = weekProgress(s);
  const pct = Math.max(0, Math.min(100, (w.minutes / w.target) * 100));
  const left = Math.max(0, Math.round(w.target - w.minutes));
  const title = w.thisWeek ? 'This week' : `Week of ${dateShort(w.ws)}`;
  const tag = w.total ? `<span class="tag num">${w.done} of ${w.total} sessions</span>` : `<span class="tag num">${w.count} ${w.count === 1 ? 'workout' : 'workouts'}</span>`;
  const status = left ? `<b class="num">${left}</b> ${left === 1 ? 'minute' : 'minutes'} to your weekly target.` : '<b>Weekly target reached.</b>';
  return `
  <section class="card sm-week" aria-labelledby="sm-week-title">
    <div class="card-row"><h2 class="section-title" id="sm-week-title">${esc(title)}</h2>${tag}</div>
    <p class="sm-week-num"><span class="num">${Math.round(w.minutes)}</span><span>of ${w.target} activity minutes</span></p>
    <div class="pbar" role="img" aria-label="${Math.round(w.minutes)} of ${w.target} activity minutes"><i style="width:${pct.toFixed(1)}%"></i></div>
    <p class="body-s">${status} Vigorous minutes, like jogs and steep climbs, count double.</p>
    ${w.deload ? '<p class="body-xs">Lighter week: a lower total is part of the plan.</p>' : ''}
  </section>`;
}

function consoleHtml(s, c) {
  return `
  <details class="sm-details" data-details="console"${c.open.console ? ' open' : ''}>
    <summary><span class="sm-sum-text"><span class="title-s">Match your treadmill</span><span class="body-xs">Use the time and distance on your console</span></span>${icon('chevD', 'sm-chev')}</summary>
    <form class="sm-details-body" data-form="console" novalidate>
      <p class="body-s">Treadmill belts often read a little differently. Enter what your console shows and we’ll update this workout. Climb and the energy estimate scale with distance.${s.healthUUID ? ' This workout is already in Apple Health, which keeps the numbers it was saved with.' : ''}</p>
      <div class="sm-console-grid">
        <div class="field"><label for="sm-c-time">Time</label><input id="sm-c-time" class="input num" inputmode="numeric" autocomplete="off" value="${esc(clock(s.durationSec))}" aria-describedby="sm-c-time-hint"><span class="hint" id="sm-c-time-hint">mm:ss</span></div>
        <div class="field"><label for="sm-c-dist">Distance</label><div class="input-unit"><input id="sm-c-dist" class="input num" inputmode="decimal" autocomplete="off" value="${esc(fmt2(toDist(s.distanceKm)))}"><span class="unit">${esc(distUnit())}</span></div></div>
      </div>
      <p class="sm-err" data-region="console-err" role="alert"></p>
      <div class="sm-console-actions">
        <button type="submit" class="btn btn-primary btn-block">Update workout</button>
        ${s.consoleEdited && s.appValues ? '<button type="button" class="btn btn-text" data-act="console-reset">Use Hillpace’s numbers instead</button>' : ''}
      </div>
    </form>
  </details>`;
}

function splitsHtml(s, c) {
  const sp = (s.splits || []).filter((x) => x.sec > 0).slice().sort((a, b) => a.idx - b.idx);
  if (!sp.length) return '';
  const rows = sp.map((x) => {
    const m = MODES[x.type] || MODES.walk;
    return `<tr>
      <th scope="row"><span class="sm-iv mode-${esc(x.type)}"><span class="sm-iv-ico">${modeIcon(x.type)}</span><span class="sm-iv-text"><b>${esc(x.label || m.name)}</b>${x.label && x.label.toLowerCase() !== m.name.toLowerCase() ? `<small>${esc(m.name)}</small>` : ''}</span></span></th>
      <td class="num">${clock(x.sec)}</td><td class="num">${fmt1(toSpeed(x.speed || 0))}</td><td class="num">${fmt1(x.incline || 0)}%</td></tr>`;
  }).join('');
  return `
  <details class="sm-details" data-details="splits"${c.open.splits ? ' open' : ''}>
    <summary><span class="sm-sum-text"><span class="title-s">Interval breakdown</span><span class="body-xs">${sp.length} ${sp.length === 1 ? 'interval' : 'intervals'}</span></span>${icon('chevD', 'sm-chev')}</summary>
    <div class="sm-details-body sm-table-wrap">
      <table class="sm-table">
        <thead><tr><th scope="col">Interval</th><th scope="col">Time</th><th scope="col">${esc(speedUnit())}</th><th scope="col">Incline</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
      <p class="body-xs">Speed and incline are the targets for each interval, including any speed changes you made during the workout.</p>
    </div>
  </details>`;
}

function healthHtml(s, c) {
  if (!features.health) return '';
  const h = state.main.profile.health;
  if (!h.enabled) {
    return `<div class="group sm-health"><button type="button" class="row has-icon" data-act="health-setup"><span class="row-icon">${icon('heart')}</span><span class="row-main"><span class="row-title">Save workouts to Apple Health</span><span class="row-sub">Turn it on in Me</span></span>${icon('chevR', 'chev')}</button></div>`;
  }
  let title, sub, btn = '', ico = 'heart';
  if (s.healthUUID) { title = 'Saved to Apple Health'; sub = h.watch ? 'Saved without energy and distance, because your Apple Watch records those.' : 'Saved as an indoor workout.'; ico = 'checkCircle'; }
  else if ((s.durationSec || 0) < 60) { title = 'Not saved to Apple Health'; sub = 'Workouts under a minute aren’t saved.'; }
  else if (c.health === 'saving') { title = 'Saving to Apple Health…'; sub = 'This takes a moment.'; }
  else if (c.health === 'failed') { title = 'Couldn’t save to Apple Health'; sub = 'Check that Hillpace can write workouts in the Health app.'; btn = '<button type="button" class="btn btn-sm" data-act="health-save">Retry</button>'; ico = 'alert'; }
  else if (c.fresh) { title = 'Apple Health'; sub = 'This workout saves when you tap Done.'; }
  else { title = 'Not in Apple Health'; sub = 'Save this workout to Apple Health.'; btn = '<button type="button" class="btn btn-sm" data-act="health-save">Save</button>'; }
  return `<div class="group sm-health"><div class="row has-icon" role="status"><span class="row-icon${ico === 'alert' ? ' warn' : ''}">${icon(ico)}</span><span class="row-main"><span class="row-title">${esc(title)}</span><span class="row-sub">${esc(sub)}</span></span>${btn}</div></div>`;
}

function shareHtml() {
  const canShare = features.nativeShare || (typeof navigator !== 'undefined' && typeof navigator.share === 'function');
  return `
  <section class="section sm-share" aria-label="Share">
    <div class="btn-row">
      <button type="button" class="btn" data-act="copy">${icon('copy')}Copy summary</button>
      ${canShare ? `<button type="button" class="btn" data-act="share">${icon('share')}Share</button>` : ''}
    </div>
  </section>`;
}

function bodyHtml(s, c) {
  return `
  <div class="sm-wrap">
    ${heroHtml(s, c.pos)}
    ${highlightsHtml(s, c)}
    ${effortHtml(s, c)}
    ${notesHtml(s)}
    ${weekHtml(s)}
    <div class="stack">
      ${c.fresh && s.source !== 'manual' ? consoleHtml(s, c) : ''}
      ${splitsHtml(s, c)}
    </div>
    <div data-region="health">${healthHtml(s, c)}</div>
    ${shareHtml()}
  </div>
  <div class="sm-foot"><div class="sm-foot-in"><button type="button" class="btn btn-primary btn-lg btn-block" data-act="done" data-done>Done</button></div></div>`;
}

/* ======================================================================
   behaviour
   ====================================================================== */

function region(c, name, html) {
  const el = c.root.querySelector(`[data-region="${name}"]`);
  if (el) el.innerHTML = html;
}

function saveNotes(c) {
  const ta = c.root.querySelector('#sm-notes');
  const s = getS(c.id);
  if (!ta || !s) return;
  const v = ta.value.replace(/\s+$/, '');
  if (v !== (s.notes || '')) store.updateSession(c.id, { notes: v });
}

function setEffort(c, n) {
  const s = getS(c.id);
  if (!s) return;
  store.updateSession(c.id, { rpe: n });
  haptic('selection');
  c.root.querySelectorAll('[data-rpe]').forEach((b) => b.setAttribute('aria-pressed', String(+b.dataset.rpe === n)));
  c.root.querySelectorAll('.sm-eff-row').forEach((r) => r.classList.toggle('on', !!r.querySelector(`[data-rpe="${n}"]`)));
  region(c, 'eff-status', effortStatus(getS(c.id)));
  if (c.fresh && s.planSlot) runAdaptation(c);
}

/* ---- effort-based adaptation (fresh plan sessions only) ---- */

function snapshotPlan(m) {
  return { adjust: { ...(m.plan.adjust || { incline: 0, speed: 0 }) }, levelCap: m.plan.levelCap ? { ...m.plan.levelCap } : null, adaptLog: [...(m.plan.adaptLog || [])] };
}
/** Undo a change this summary made (the effort rating was changed afterwards). */
function restorePlan(c) {
  if (!c.adaptSnap) return;
  const snap = c.adaptSnap;
  c.adaptSnap = null;
  store.update((m) => {
    m.plan.adjust = snap.adjust;
    if (snap.levelCap) m.plan.levelCap = snap.levelCap; else delete m.plan.levelCap;
    m.plan.adaptLog = snap.adaptLog;
  });
}
function applyChange(c, kind, reason) {
  store.update((m) => {
    c.adaptSnap = c.adaptSnap || snapshotPlan(m);
    applyAdaptation(m.plan, kind, reason);
    if (kind === 'step' || kind === 'keep') { const log = m.plan.adaptLog; log[log.length - 1] = { ...log[log.length - 1], ack: true }; }
  });
}
function runAdaptation(c) {
  restorePlan(c);
  const r = evaluateAdaptation();
  c.adapt = null;
  if (r && (r.kind === 'ease' || r.kind === 'hold')) {
    applyChange(c, r.kind, r.reason);
    c.adapt = { kind: r.kind, reason: r.reason };
  } else if (r && r.kind === 'offer') {
    c.adapt = { kind: 'offer', reason: r.reason };
  }
  region(c, 'adapt', adaptHtml(c));
}
function answerOffer(c, yes) {
  if (!c.adapt || c.adapt.kind !== 'offer') return;
  applyChange(c, yes ? 'step' : 'keep', yes ? STEP_REASON : KEEP_REASON);
  c.adapt = { kind: yes ? 'step' : 'keep' };
  haptic(yes ? 'success' : 'light');
  region(c, 'adapt', adaptHtml(c));
  const b = c.root.querySelector('.sm-adapt');
  if (b) { b.setAttribute('tabindex', '-1'); try { b.focus({ preventScroll: true }); } catch { /* ignore */ } }
}

/* ---- match your treadmill ---- */

function scaleSplits(splits, distRatio, timeRatio, totalSec) {
  const out = (splits || []).map((x) => ({ ...x, km: r3((x.km || 0) * distRatio), kcal: r1((x.kcal || 0) * distRatio), sec: Math.max(0, Math.round((x.sec || 0) * timeRatio)) }));
  // keep every Apple Health sample inside the workout: interval seconds may not add up to more than the total
  let over = out.reduce((a, x) => a + x.sec, 0) - totalSec;
  for (let i = out.length - 1; i >= 0 && over > 0; i--) { const cut = Math.min(over, out[i].sec); out[i].sec -= cut; over -= cut; }
  return out;
}

function applyConsole(c, form) {
  const s = getS(c.id);
  if (!s) return;
  const sec = parseClock(form.querySelector('#sm-c-time').value);
  const distIn = parseFloat(String(form.querySelector('#sm-c-dist').value).replace(',', '.'));
  const km = fromDist(distIn);
  let err = '';
  if (!(sec >= 60 && sec <= 6 * 3600)) err = 'Enter the time as minutes and seconds, for example 45:00.';
  else if (!(km > 0.05 && km <= 100)) err = `Enter the distance in ${distUnit()}, for example ${fmt2(toDist(s.distanceKm || 3))}.`;
  c.open.console = true;
  const badTime = !(sec >= 60 && sec <= 6 * 3600);
  form.querySelector('#sm-c-time').setAttribute('aria-invalid', String(!!err && badTime));
  form.querySelector('#sm-c-dist').setAttribute('aria-invalid', String(!!err && !badTime));
  region(c, 'console-err', esc(err));
  if (err) { haptic('error'); const f = form.querySelector(badTime ? '#sm-c-time' : '#sm-c-dist'); if (f) f.focus(); return; }
  const base = s.appValues || { durationSec: s.durationSec, distanceKm: s.distanceKm, kcal: s.kcal, elevM: s.elevM };
  const rd = base.distanceKm > 0 ? km / base.distanceKm : 1;
  const splits = scaleSplits(s.splits, s.distanceKm > 0 ? km / s.distanceKm : 1, s.durationSec > 0 ? sec / s.durationSec : 1, sec);
  store.updateSession(c.id, {
    appValues: base, consoleEdited: true, durationSec: Math.round(sec), distanceKm: r3(km),
    kcal: Math.round((base.kcal || 0) * rd), elevM: Math.round((base.elevM || 0) * rd), splits,
  });
  afterNumbersChanged(c);
  haptic('success');
  toast('Workout updated to match your treadmill');
}

function resetConsole(c) {
  const s = getS(c.id);
  if (!s || !s.appValues) return;
  const b = s.appValues;
  const splits = scaleSplits(s.splits, s.distanceKm > 0 ? b.distanceKm / s.distanceKm : 1, s.durationSec > 0 ? b.durationSec / s.durationSec : 1, b.durationSec);
  store.updateSession(c.id, { ...b, splits, consoleEdited: false, appValues: null });
  afterNumbersChanged(c);
  toast('Back to Hillpace’s numbers');
}

function afterNumbersChanged(c) {
  const s = getS(c.id);
  c.records = recordsFor(s);
  const hero = c.root.querySelector('.sm-hero');
  if (hero) hero.outerHTML = heroHtml(s, c.pos);
  const hl = c.root.querySelector('.sm-highlights');
  const hlNew = highlightsHtml(s, c);
  if (hl) hl.outerHTML = hlNew || '';
  else if (hlNew) c.root.querySelector('.sm-hero').insertAdjacentHTML('afterend', hlNew);
  const wk = c.root.querySelector('.sm-week');
  if (wk) wk.outerHTML = weekHtml(s);
  rerenderDetails(c);
}

function rerenderDetails(c) {
  const s = getS(c.id);
  const con = c.root.querySelector('[data-details="console"]');
  if (con) con.outerHTML = consoleHtml(s, c);
  const sp = c.root.querySelector('[data-details="splits"]');
  if (sp) sp.outerHTML = splitsHtml(s, c);
}

/* ---- Apple Health ---- */

async function saveHealth(c) {
  const s = getS(c.id);
  if (!s || s.healthUUID || healthBusy.has(s.id)) return !!(s && s.healthUUID);
  healthBusy.add(s.id);
  c.health = 'saving';
  region(c, 'health', healthHtml(s, c));
  let uuid = null;
  try { uuid = await healthSaveWorkout(s); } catch { uuid = null; }
  healthBusy.delete(s.id);
  if (uuid) store.updateSession(s.id, { healthUUID: uuid, healthPending: false });
  c.health = uuid ? 'saved' : 'failed';
  if (c.root.isConnected) region(c, 'health', healthHtml(getS(c.id) || s, c));
  if (uuid) haptic('success');
  return !!uuid;
}
function needsHealthSave(c) {
  const s = getS(c.id);
  return features.health && state.main.profile.health.enabled && c.fresh && s && !s.healthUUID && (s.durationSec || 0) >= 60 && !c.healthTried;
}

/* ---- share ---- */

async function copySummary(c) {
  const s = getS(c.id);
  if (!s) return;
  const ok = await copyText(shareText(s));
  toast(ok ? 'Summary copied' : 'Couldn’t copy. Try again.');
  if (ok) haptic('light');
}
async function shareSummary(c) {
  const s = getS(c.id);
  if (!s) return;
  // platform.shareText: iOS share sheet, Web Share, or the clipboard. 'failed' is also what a cancelled sheet returns, so stay quiet then.
  const r = await shareViaSystem(shareText(s), 'Share workout');
  if (r === 'copied') { toast('Summary copied'); haptic('light'); }
}

/* ---- open / close ---- */

async function done(c) {
  if (c.closing || c.busy) return;
  saveNotes(c);
  if (needsHealthSave(c)) {
    c.busy = true;
    c.healthTried = true;
    const btn = c.root.querySelector('[data-done]');
    if (btn) { btn.disabled = true; btn.textContent = 'Saving to Apple Health…'; }
    const ok = await saveHealth(c);
    c.busy = false;
    if (btn) { btn.disabled = false; btn.textContent = 'Done'; }
    if (!ok) {
      // Stay open so the failure and Retry are visible; the next Done closes.
      const h = c.root.querySelector('.sm-health');
      if (h) h.scrollIntoView({ block: 'center', behavior: RM ? 'auto' : 'smooth' });
      return;
    }
    toast('Saved to Apple Health');
  }
  close(c);
}

/** then: run after the overlay is gone instead of the default (Today after a fresh run, else refresh). */
function close(c, { then } = {}) {
  if (c.closing) return;
  c.closing = true;
  c.offs.forEach((f) => { try { f(); } catch { /* ignore */ } });
  if (c.adapt && (c.adapt.kind === 'ease' || c.adapt.kind === 'hold')) {
    // Shown here already: don't repeat it as a banner on Today.
    store.update((m) => { const log = m.plan.adaptLog || []; if (log.length) log[log.length - 1] = { ...log[log.length - 1], ack: true }; });
  }
  if (cur === c) cur = null;
  const app = document.getElementById('app');
  if (app) app.inert = !!c.prevInert;
  document.body.classList.remove('sm-open');
  const finish = () => {
    c.root.remove();
    if (!document.querySelector('.overlay')) document.body.classList.remove('immersive');
    if (then) { then(); return; }
    if (c.fresh && currentRoute().name !== 'today') actions.go('today');
    else actions.refresh();
    try { c.prevFocus && c.prevFocus.isConnected && c.prevFocus.focus({ preventScroll: true }); } catch { /* ignore */ }
  };
  if (RM) finish();
  else { c.root.classList.add('closing'); setTimeout(finish, 200); }
}

function wire(c) {
  const root = c.root;
  const onClick = (e) => {
    const b = e.target.closest('button, [data-act]');
    if (!b || !root.contains(b)) return;
    if (b.dataset.rpe) { setEffort(c, +b.dataset.rpe); return; }
    switch (b.dataset.act) {
      case 'done': done(c); break;
      case 'how': actions.openHowWeCalculate(); break;
      case 'adapt-step': answerOffer(c, true); break;
      case 'adapt-keep': answerOffer(c, false); break;
      case 'console-reset': resetConsole(c); break;
      case 'more-badges': {
        c.allBadges = true;
        const first = root.querySelector('.sm-card[data-more]');
        root.querySelectorAll('.sm-card[data-more]').forEach((x) => { x.hidden = false; });
        b.remove();
        if (first) { first.setAttribute('tabindex', '-1'); try { first.focus({ preventScroll: true }); } catch { /* ignore */ } }
        break;
      }
      case 'health-save': saveHealth(c); break;
      case 'health-setup': saveNotes(c); close(c, { then: () => actions.go('me', 'health') }); break;
      case 'copy': copySummary(c); break;
      case 'share': shareSummary(c); break;
      default: break;
    }
  };
  const onSubmit = (e) => {
    const f = e.target.closest('[data-form="console"]');
    if (!f) return;
    e.preventDefault();
    applyConsole(c, f);
  };
  const onToggle = (e) => {
    const d = e.target.closest && e.target.closest('details[data-details]');
    if (d) c.open[d.dataset.details] = d.open;
  };
  const notesLater = debounce(() => saveNotes(c), 800);
  const onInput = (e) => { if (e.target.id === 'sm-notes') notesLater(); };
  const onBlur = (e) => { if (e.target.id === 'sm-notes') saveNotes(c); };
  const onKey = (e) => { if (e.key === 'Escape' && !document.querySelector('.sheet-root') && cur === c) done(c); };
  root.addEventListener('click', onClick);
  root.addEventListener('submit', onSubmit);
  root.addEventListener('toggle', onToggle, true);
  root.addEventListener('input', onInput);
  root.addEventListener('focusout', onBlur);
  document.addEventListener('keydown', onKey);
  const onHide = () => saveNotes(c);
  window.addEventListener('pagehide', onHide);
  // A link inside the summary that navigates (e.g. a methodology page) must not open hidden behind the overlay.
  const onHash = () => { if (cur === c && !c.closing) { saveNotes(c); close(c, { then: () => {} }); } };
  window.addEventListener('hashchange', onHash);
  c.offs.push(() => document.removeEventListener('keydown', onKey), () => window.removeEventListener('pagehide', onHide), () => window.removeEventListener('hashchange', onHash));
}

function animateIn(c) {
  if (!c.fresh || RM) return;
  c.root.querySelectorAll('.sm-stats [data-count]').forEach((el) => {
    const to = +el.dataset.count;
    const dec = +(el.dataset.dec || 0);
    const fmt = el.dataset.fmt === 'clock' ? (v) => clock(v) : dec ? (v) => v.toFixed(dec) : (v) => Math.round(v).toLocaleString();
    el.textContent = fmt(0);
    countUp(el, to, { dec, ms: 1000, fmt });
  });
}

actions.openSummary = (sessionId, { fresh = false } = {}) => {
  const s = getS(sessionId);
  if (!s) { toast('That workout couldn’t be found'); return; }
  if (cur) {
    const prev = cur;
    prev.closing = true; prev.offs.forEach((f) => f()); prev.root.remove();
    document.body.classList.remove('sm-open');
    const a = document.getElementById('app'); if (a) a.inert = !!prev.prevInert;
    cur = null;
  }

  const c = {
    id: s.id, fresh: !!fresh, root: null, offs: [], open: { console: false, splits: false },
    adapt: null, adaptSnap: null, health: s.healthUUID ? 'saved' : 'idle', healthTried: false,
    prevFocus: document.activeElement, prevInert: false,
  };
  c.pos = planPosition(s);
  c.records = recordsFor(s);
  let unlocked = [];
  if (c.fresh) {
    if (collected.has(s.id)) unlocked = collected.get(s.id);
    else { store.update((m) => { unlocked = collectNew(m); }); collected.set(s.id, unlocked); }
  }
  c.badges = visibleBadges(unlocked);
  const celebrate = c.fresh && (c.records.length > 0 || c.badges.length > 0 || !!(c.pos && c.pos.weekComplete));

  const root = document.createElement('div');
  root.className = 'overlay sm';
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-modal', 'true');
  root.setAttribute('aria-labelledby', 'sm-title');
  root.innerHTML = bodyHtml(s, c);
  c.root = root;
  document.body.appendChild(root);
  document.body.classList.add('immersive', 'sm-open');
  const app = document.getElementById('app');
  if (app) { c.prevInert = !!app.inert; app.inert = true; }
  cur = c;
  wire(c);
  animateIn(c);
  const h = root.querySelector('#sm-title');
  try { h && h.focus({ preventScroll: true }); } catch { /* ignore */ }
  if (celebrate) setTimeout(() => { if (cur === c) { confetti(); haptic('success'); } }, RM ? 0 : 420);
};

export default { name: 'summary' };
