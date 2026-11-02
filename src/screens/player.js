// Workout flow: pre-run sheet → 5-second get-ready → player overlay (voice, beeps, haptics, lock-screen cues)
// → pause sheet → finish / save. Registers actions.startWorkout(opts) and actions.resumeWorkout(snapshot).
//
// Timing comes from core/engine.js (wall clock). This module only renders, cues and persists:
//   - DOM is built once per run; ticks update text and two widths (no re-render per tick)
//   - crash recovery snapshot in localStorage 'hp.run' on every state change and every 5 s
//   - lock-screen safety net: interval-change notifications rescheduled after every manual change
import { state } from '../core/store.js';
import * as store from '../core/store.js';
import { createEngine, COMPLETE_AT } from '../core/engine.js';
import {
  MODES, MODE_RANK, getWorkout, segmentsFor, personalise, planSlots, planStats, phaseForWeek, bodyKg, speedFor, lockReason, mainMode,
  SURFACES, activeSurface, usualSurface, usesIncline, setTodaySurface, effortFor, FREE_WALK_ID, freeWalkSegments, workoutFocus,
} from '../core/program.js';
import { roundKcal, KMH_PER_MPH } from '../core/science.js';
import { clock, toSpeed, fromSpeed, speedUnit, speedStr, distStr, distUnit, toElev, elevUnit, fmt1, esc, isMph } from '../core/format.js';
import { env, features, haptic, keepAwake, speak, stopSpeaking, unlockAudio, beep, notificationPermission, requestNotifications, scheduleCues, cancelCues, onAppState, statusBar } from '../core/platform.js';
import { actions } from '../ui/actions.js';
import { icon, modeIcon, sheet, confirmSheet, toast, topo, bindSegmented, RM } from '../ui/kit.js';
import { surfacePicker, surfaceChart, surfaceLegend, peakCell, distCell, chartLabel } from './plan.js';

const RUN_KEY = 'hp.run';
const SAVE_EVERY_MS = 5000;
const SLEEP_AFTER_PAUSE_MS = 5 * 60 * 1000;
const HOLD_MS = 1000;

let run = null; // the active run controller (one at a time)

/* ---------------- small helpers ---------------- */

const prof = () => state.main.profile;
const modeName = (t) => (MODES[t] || MODES.walk).name;
const modeSay = (t) => (MODES[t] || MODES.walk).say;
/** Spoken number: 8.0 -> "8", 6.2 -> "6.2" */
const sayNum = (n) => fmt1(n).replace(/\.0$/, '');
const speedWords = () => (isMph() ? 'miles per hour' : 'kilometres per hour');
/** One speed-nudge step in km/h: 0.1 of the user's unit. */
const nudgeStep = () => (isMph() ? 0.1 * KMH_PER_MPH : 0.1);
/** Compact incline for secondary text: 2 -> "2%", 8.5 -> "8.5%" */
const incShort = (i) => sayNum(i) + '%';
/** Short duration for labels: 30 -> "30 s", 120 -> "2 min", 90 -> "1:30" */
const durShort = (sec) => (sec < 60 ? `${Math.round(sec)} s` : sec % 60 === 0 ? `${sec / 60} min` : clock(sec));
const isDarkTheme = () => {
  const t = document.documentElement.getAttribute('data-theme');
  return t ? t === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
};
/** "1 minute 12 seconds" for speech. */
function spokenTime(sec) {
  sec = Math.max(0, Math.ceil(sec));
  const m = Math.floor(sec / 60), s = sec % 60;
  const mm = m ? `${m} minute${m === 1 ? '' : 's'}` : '';
  const ss = s ? `${s} second${s === 1 ? '' : 's'}` : '';
  return [mm, ss].filter(Boolean).join(' ') || '0 seconds';
}
/** n-th interval of this mode, out of N of that mode ("Jog 3 of 6"). */
function modeOrdinal(segs, idx) {
  const t = segs[idx] && segs[idx].type;
  let n = 0, N = 0;
  segs.forEach((s, i) => { if (s.type === t) { N++; if (i <= idx) n++; } });
  return { n, N };
}
const triangle = (up) => `<svg viewBox="0 0 10 10" aria-hidden="true" focusable="false"><path d="${up ? 'M5 1.5 9.2 8.5H.8Z' : 'M5 8.5 .8 1.5h8.4Z'}" fill="currentColor"/></svg>`;

/* ---- effort language (outdoors there are no speed or incline targets: the player coaches by effort and the talk test) ---- */
/** Big name for a mode when coaching by effort: "Easy walk", "Brisk walk", "Hard walking", "Jog", "Run". */
const effName = (t) => (t === 'power' ? effortFor('power').feel : modeName(t));
/** Talk test in a few words, for "Next: Easy walk · full sentences". */
const TALK_SHORT = { walk: 'full sentences', brisk: 'talk, not sing', power: 'short phrases', jog: 'a few words', run: 'too hard to talk' };
const talkShort = (t) => TALK_SHORT[t] || effortFor(t).talk.toLowerCase();
/** "6–7" read aloud / to VoiceOver as "6 to 7". */
const rpeWords = (t) => effortFor(t).rpe.replace('–', ' to ');
/** Just walk: the three paces the walker can switch between. */
const FREE_PACES = ['walk', 'brisk', 'power'];
const PACE_LABEL = { walk: 'Easy', brisk: 'Brisk', power: 'Hard walking' };
/** "10 minutes", "1 hour", "1 hour 20 minutes" for the open walk's 10-minute cue. */
function spokenMinutes(min) {
  const h = Math.floor(min / 60), m = min % 60;
  const hh = h ? `${h} hour${h === 1 ? '' : 's'}` : '';
  const mm = m ? `${m} minute${m === 1 ? '' : 's'}` : '';
  return [hh, mm].filter(Boolean).join(' ');
}

function loadRunSnapshot() { try { return JSON.parse(localStorage.getItem(RUN_KEY) || 'null'); } catch { return null; } }
function clearRunSnapshot() { try { localStorage.removeItem(RUN_KEY); } catch { /* storage blocked */ } }

/* ---------------- resolve what to run ---------------- */

function resolvePlan(opts = {}) {
  const p = prof();
  const slot = opts.slotKey ? planSlots().find((s) => s.key === opts.slotKey) || null : null;
  const workoutId = opts.workoutId || (slot && slot.workoutId) || null;
  const free = workoutId === FREE_WALK_ID;
  const w = workoutId ? getWorkout(workoutId) : null;
  const level = free ? null : opts.level ?? (slot ? slot.level : 0);
  const length = free ? null : opts.length ?? (slot ? slot.length : p.sessionLength || 45);
  const surface = SURFACES[opts.surface] ? opts.surface : activeSurface();
  const plan = {
    workoutId, level, length, free, surface,
    base: !free && Array.isArray(opts.segs) && opts.segs.length ? opts.segs : null, // a draft passed in (re-fitted when the surface changes)
    name: opts.name || (w && w.name) || (free ? 'Just walk' : 'Workout'),
    slotKey: slot ? slot.key : opts.slotKey || null,
    lock: w && !w.custom && !free ? lockReason(workoutId) : null,
    context: '', inclineCap: null,
  };
  if (slot) plan.context = `Week ${slot.week} · ${phaseForWeek(slot.week).name}${slot.deload ? ' · lighter week' : ''}`;
  else if (w && w.custom) plan.context = 'Your workout';
  else if (w && !free) plan.focusContext = true; // the workout's focus, worded for the surface (setSurface)
  setSurface(plan, surface);
  return plan;
}

/** Intervals for this run on a surface: the workout's own (segmentsFor / freeWalkSegments), or a passed-in draft re-fitted. */
function planSegs(plan, surface) {
  const t = prof().treadmill;
  let segs;
  if (plan.free) segs = freeWalkSegments({ surface });
  else if (plan.base) segs = surface === activeSurface() ? plan.base : personalise(plan.base, { applyAdjust: false, surface });
  else segs = plan.workoutId && getWorkout(plan.workoutId) ? segmentsFor(plan.workoutId, { level: plan.level, length: plan.length, surface }) : [];
  // Defensive copy + treadmill limits (segmentsFor already clamps; raw drafts may not).
  const maxI = usesIncline(surface) ? t.maxIncline ?? 15 : 0;
  return segs.filter((s) => s && s.dur > 0 && MODES[s.type]).map((s) => ({ ...s, role: s.role || 'work', dur: Math.round(s.dur), incline: Math.max(0, Math.min(maxI, +s.incline || 0)) }));
}

/** Point a plan at a surface: fresh intervals, the "cap incline today" choice kept where it still applies. */
function setSurface(plan, surface) {
  plan.surface = surface;
  plan.fullSegs = planSegs(plan, surface);
  if (!usesIncline(surface)) plan.inclineCap = null;
  plan.segs = plan.inclineCap ? plan.fullSegs.map((s) => ({ ...s, incline: Math.min(s.incline, plan.inclineCap) })) : plan.fullSegs;
  if (plan.free) plan.context = SURFACES[surface].name;
  else if (plan.focusContext) plan.context = workoutFocus(plan.workoutId, { surface, segs: plan.fullSegs }) || '';
}

/* ---------------- steep-session notice (Achilles or calf answer, spec 3.6) ---------------- */

/** Sessions that reach this incline (%) get a reminder for users who reported an Achilles or calf problem. */
export const STEEP_INCLINE = 10;
/** The incline the pre-run sheet can cap a steep session at, for today only. */
export const STEEP_CAP = 8;
const maxIncline = (segs) => Math.max(0, ...(segs || []).map((s) => +s.incline || 0));

/** True when the user reported an Achilles or calf problem and these intervals climb to 10% or more.
 *  (Intervals for a flat treadmill or outdoors have no incline, so they never need it.) */
export function needsSteepNotice(segs) {
  const r = state.main.readiness || {};
  return !!r.achilles && maxIncline(segs) >= STEEP_INCLINE - 1e-6;
}

/** Warn banner for steep sessions (empty string when not needed). `action` is extra HTML placed inside the banner body. */
export function steepNoticeHtml(segs, { action = '' } = {}) {
  if (!needsSteepNotice(segs)) return '';
  return `<div class="banner warn steep-notice" role="note"><span class="banner-icon">${icon('incline')}</span><div class="banner-body"><b>Steep session: up to ${incShort(maxIncline(segs))} incline</b>You mentioned an Achilles or calf problem. Steep climbs load your calves and Achilles tendons, so build up slowly, and lower the incline if the back of your heel or calf hurts.${action}</div></div>`;
}

/* ---------------- pre-run sheet ---------------- */

/** Safety tips for where they walk. */
function tipsFor(surface) {
  if (surface === 'outdoor') {
    return [
      ['shield', 'Be seen: wear bright or reflective clothing, especially early, late or in the dark.'],
      ['route', 'Choose a safe route with pavements or paths, and cross where drivers can see you.'],
      ['stride', 'Wear comfortable shoes with good grip.'],
      ['sun', 'Carry water when it’s hot, and pick the shade or a cooler time of day.'],
      ['voice', 'Keep your phone volume up, or wear one earbud, so you can still hear traffic.'],
    ];
  }
  const hf = prof().treadmill.handsFree !== false;
  const what = surface === 'incline' ? 'the climb' : 'the walk';
  return [
    ['shield', surface === 'flat' ? 'If your treadmill or walking pad has a safety key, clip it to your clothing before you start the belt.' : 'Clip the safety key to your clothing before you start the belt.'],
    ['stride', surface === 'flat' ? 'Start the belt at a slow speed, then step on. Stand on the side rails while it starts, if it has them.' : 'Start the belt while standing on the side rails, then step on at a slow speed.'],
    ['hand', hf ? `You walk hands-free, so keep your hands off the rails. Holding on makes ${what} easier than the plan intends.` : `Use the rails lightly, for balance only. Leaning on them makes ${what} easier than the plan intends.`],
    ['speed', 'Slow the belt before stepping off.'],
  ];
}

/**
 * Voice and lock-screen cue banner. kind: 'loading' | 'granted' | 'prompt' | 'denied' (iOS) | 'web' | 'free'.
 * Outdoors the phone usually goes in a pocket, so the web copy says plainly that voice cues need the screen on.
 */
function cueStatusHtml(kind, surface = activeSurface()) {
  const p = prof();
  const voiceOff = !p.cues.voice;
  const extra = voiceOff ? '<span class="pr-cue-extra">Voice cues are off in settings. Beeps and the on-screen countdown still guide you.</span>' : '';
  if (kind === 'free') {
    const tens = !voiceOff && (+p.cues.detail || 2) >= 2;
    const what = tens ? 'Walking Companion tells you every 10 minutes how long you’ve walked. ' : '';
    const freeExtra = voiceOff ? '<span class="pr-cue-extra">Voice cues are off in settings.</span>' : '';
    const lock = env === 'ios' ? 'If your phone locks, voice cues pause but your time keeps counting.' : 'Voice cues pause if the screen locks or you switch apps, but your time keeps counting.';
    return `<span class="banner-icon">${icon('voice')}</span><div class="banner-body"><b>${env === 'ios' ? 'Keep Walking Companion open' : 'Keep this page open'}</b>${what}${lock}${freeExtra}</div>`;
  }
  if (kind === 'loading') return `<span class="banner-icon">${icon('bell')}</span><div class="banner-body"><b>Checking cue settings</b>${extra}</div>`;
  if (kind === 'granted') return `<span class="banner-icon">${icon('bell')}</span><div class="banner-body"><b>Lock-screen cues are on</b>If your phone locks, interval changes arrive as notifications with a vibration.${extra}</div>`;
  if (kind === 'prompt') return `<span class="banner-icon">${icon('voice')}</span><div class="banner-body"><b>Keep the screen on</b>Voice cues stop if your phone locks. Allow lock-screen cues to get each interval change as a notification with a vibration.${extra}<button class="btn btn-sm btn-ghost pr-allow" type="button" data-act="allow-cues">${icon('bell')}Allow lock-screen cues</button></div>`;
  if (kind === 'denied') return `<span class="banner-icon">${icon('voice')}</span><div class="banner-body"><b>Keep the screen on</b>Voice cues stop if your phone locks, and notifications for Walking Companion are off, so interval changes won’t reach the lock screen.${extra}</div>`;
  if (surface === 'outdoor') return `<span class="banner-icon">${icon('voice')}</span><div class="banner-body"><b>Keep the screen on for voice cues</b>Outdoors your phone is usually in a pocket. In a web browser, voice cues and beeps only play while this page is open and the screen is on.${extra}</div>`;
  return `<span class="banner-icon">${icon('voice')}</span><div class="banner-body"><b>Keep this page open</b>Voice cues and beeps stop if the screen locks or you switch to another app.${extra}</div>`;
}

/** Just walk: what each surface means for an open walk. */
const FREE_BLURB = {
  incline: 'Set your speed and incline as you go, so distance and climb add up.',
  flat: 'Set your speed as you go, so distance adds up.',
  outdoor: 'Pick a pace by how it feels. Distance is estimated from your usual paces.',
};

/** Just walk: the three paces, with the speed for each (treadmill) or how each should feel (outdoors). */
function freeCardHtml(plan) {
  const S = plan.surface, nn = prof().noNumbers;
  const rows = FREE_PACES.map((t) => {
    const val = S === 'outdoor'
      ? `<span class="pr-pace-val"><b class="num">${esc(effortFor(t).rpe)}</b><small>of 10</small></span>`
      : `<span class="pr-pace-val"><b class="num">${speedStr(speedFor(t))}</b><small>${esc(speedUnit())}</small></span>`;
    const sub = S === 'outdoor' ? `<small>${esc(effortFor(t).talk)}</small>` : '';
    return `<div class="pr-pace mode-${t}"><span class="pr-pace-ico">${modeIcon(t)}</span><span class="pr-pace-main"><b>${esc(effName(t))}</b>${sub}</span>${val}</div>`;
  }).join('');
  const inc = plan.segs[0] ? plan.segs[0].incline || 0 : 0;
  const start = `You start at a brisk walk${usesIncline(S) && inc > 0 ? ` on a ${sayNum(inc)}% incline` : ''}. Change pace any time while you walk.`;
  const est = S === 'outdoor' ? (nn ? ' Distance is an estimate.' : ' Distance and calories are estimates.') : nn ? '' : ' Calories are estimates of active energy.';
  return `
    <div class="card pr-card pr-free">
      <p class="pr-free-lead">${esc(getWorkout(FREE_WALK_ID).desc)}</p>
      <div class="pr-paces" role="list" aria-label="${S === 'outdoor' ? 'How each pace should feel, effort out of 10' : `Your paces in ${esc(speedUnit())}`}">${rows.replace(/<div class="pr-pace /g, '<div role="listitem" class="pr-pace ')}</div>
      <p class="body-xs">${esc(start + est)}</p>
    </div>`;
}

/** Intervals card: time, the surface's headline stat, energy or distance, chart, legend and the estimate note. */
function intervalsCardHtml(plan) {
  const S = plan.surface, nn = prof().noNumbers;
  const st = planStats(plan.segs);
  // outdoors the headline is the hardest effort as a number ("6–7 of 10"): it fits the narrow middle column
  const hardest = plan.segs.reduce((m, s) => ((MODE_RANK[s.type] || 0) > (MODE_RANK[m] || 0) ? s.type : m), 'walk');
  const stats = [
    ['Time', `${Math.round(st.sec / 60)}<small>min</small>`],
    S === 'outdoor' ? ['Hardest', `${esc(effortFor(hardest).rpe)}<small>of 10</small>`] : peakCell(st, plan.segs, S),
    nn ? distCell(st.km, S) : ['Active', `≈${roundKcal(st.kcal)}<small>kcal</small>`],
  ];
  const note = S === 'outdoor'
    ? `There are no speed or incline targets outdoors: each interval tells you how hard to walk, as effort out of 10 and a talk test.${nn ? ' Distance is an estimate.' : ' Distance and calories are estimates.'}`
    : nn ? '' : `Calories are estimates of active energy, based on your weight${S === 'incline' ? ', speed and incline' : ' and speed'}.`;
  return `
    <div class="card pr-card">
      <div class="stat-grid" style="--cols:3">${stats.map(([l, v]) => `<div><span class="stat-label">${l}</span><span class="stat-value">${v}</span></div>`).join('')}</div>
      <div class="pr-chart">${surfaceChart(plan.segs, S, { h: 84, label: chartLabel(plan.name, S) })}</div>
      ${surfaceLegend(plan.segs, S)}
      ${note ? `<p class="body-xs">${esc(note)}</p>` : ''}
    </div>`;
}

function openPreRun(plan) {
  let cueKind = 'web';
  const cueFor = () => (plan.free ? 'free' : env === 'ios' ? cueKind : 'web');
  const steepHtml = () => {
    if (plan.inclineCap) {
      return `<div class="banner good steep-notice" role="note"><span class="banner-icon">${icon('check')}</span><div class="banner-body"><b>Incline capped at ${STEEP_CAP}% today</b>Every climb above ${STEEP_CAP}% runs at ${STEEP_CAP}% this time. Your plan doesn’t change.<button type="button" class="btn btn-sm btn-ghost pr-cap" data-act="uncap">Use the full incline</button></div></div>`;
    }
    return steepNoticeHtml(plan.segs, { action: `<button type="button" class="btn btn-sm btn-ghost pr-cap" data-act="cap">${icon('incline')}Cap incline at ${STEEP_CAP}% today</button>` });
  };
  const whereNote = () => {
    const S = plan.surface, us = usualSurface();
    const usual = { incline: 'on an incline treadmill', flat: 'on a flat treadmill or walking pad', outdoor: 'outdoors' }[us];
    const blurb = plan.free ? FREE_BLURB[S] : SURFACES[S].blurb;
    return S === us ? blurb : `${blurb} Just for today: you usually walk ${usual}.`;
  };
  const bodyHtml = () => {
    const S = plan.surface;
    return `
    ${plan.context && !plan.free ? `<p class="eyebrow pr-context">${esc(plan.context)}</p>` : ''}
    <div class="pr-where">
      <span class="label pr-where-lbl" id="pr-where-lbl">Where are you walking?</span>
      ${surfacePicker('surface', S, { label: 'Where are you walking?' })}
      <p class="body-xs pr-where-note" aria-live="polite">${esc(whereNote())}</p>
    </div>
    ${plan.lock ? `<div class="banner warn"><span class="banner-icon">${icon('lock')}</span><div class="banner-body"><b>Not available yet</b>${esc(plan.lock)}</div></div>` : steepHtml()}
    ${plan.free ? freeCardHtml(plan) : intervalsCardHtml(plan)}
    <section class="stack-s">
      <h3 class="title-s">${S === 'outdoor' ? 'Before you head out' : 'Before you step on'}</h3>
      <div class="group pr-tips">${tipsFor(S).map(([ic, t]) => `<div class="row has-icon pr-tip"><span class="row-icon">${icon(ic)}</span><span class="row-main"><span class="pr-tip-text">${esc(t)}</span></span></div>`).join('')}</div>
    </section>
    <div class="banner pr-cues" data-el="cues" aria-live="polite">${cueStatusHtml(cueFor(), S)}</div>
    <div class="group"><button type="button" class="row has-icon" data-act="stop-signs"><span class="row-icon">${icon('alert')}</span><span class="row-main"><span class="row-title">Stop signs</span><span class="row-sub">Know when to stop and what to do</span></span>${icon('chevR', 'chev')}</button></div>`;
  };
  const startLabel = plan.free ? 'Start walking' : 'Start workout';
  const footer = `<button type="button" class="btn btn-mode btn-lg btn-block mode-${mainMode(plan.segs)}" data-act="start" ${plan.lock ? 'disabled aria-disabled="true"' : ''}>${icon('play')}${startLabel}</button>`;
  const sh = sheet(bodyHtml(), { title: plan.name, footer, label: `Start ${plan.name}` });
  sh.el.classList.add('pr-sheet');
  if (env === 'ios' && !plan.free) cueKind = 'loading';
  if (cueKind === 'loading') sh.body.querySelector('[data-el="cues"]').innerHTML = cueStatusHtml('loading', plan.surface);

  const setCues = (kind) => {
    cueKind = kind;
    const cuesEl = sh.el.querySelector('[data-el="cues"]');
    if (cuesEl && cuesEl.isConnected) cuesEl.innerHTML = cueStatusHtml(cueFor(), plan.surface);
  };
  /** Re-render the body (surface or incline cap changed), keeping the scroll position and moving focus to the new choice. */
  const repaint = (focusSel) => {
    const y = sh.body.scrollTop;
    sh.body.innerHTML = bodyHtml();
    sh.body.scrollTop = y;
    const start = sh.el.querySelector('[data-act="start"]');
    if (start) start.className = start.className.replace(/\bmode-\w+/, 'mode-' + mainMode(plan.segs));
    const f = sh.body.querySelector(focusSel);
    try { f && f.focus({ preventScroll: true }); } catch { /* ignore */ }
  };
  if (cueKind === 'loading') {
    notificationPermission().then((perm) => setCues(perm === 'granted' ? 'granted' : perm === 'prompt' ? 'prompt' : 'denied'));
  }
  // Where are you walking? Changing it re-plans this run and becomes today's surface (the player and Today read it).
  bindSegmented(sh.el, (name, value) => {
    if (name !== 'surface' || !SURFACES[value] || value === plan.surface) return;
    setSurface(plan, value);
    store.update((m) => setTodaySurface(m, value));
    repaint(`[data-seg="surface"] [data-value="${value}"]`);
  });
  sh.el.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-act]');
    if (!b) return;
    const act = b.dataset.act;
    if (act === 'stop-signs') { actions.openStopSigns(); return; }
    if (act === 'allow-cues') {
      b.disabled = true;
      const res = await requestNotifications();
      setCues(res === 'granted' ? 'granted' : 'denied');
      return;
    }
    if (act === 'cap') {
      plan.inclineCap = STEEP_CAP;
      plan.segs = plan.fullSegs.map((s) => ({ ...s, incline: Math.min(s.incline, STEEP_CAP) }));
      haptic('selection');
      repaint('[data-act="uncap"]');
      return;
    }
    if (act === 'uncap') {
      plan.inclineCap = null;
      plan.segs = plan.fullSegs;
      haptic('selection');
      repaint('[data-act="cap"]');
      return;
    }
    if (act === 'start') {
      if (plan.lock) return;
      unlockAudio(); // must run inside the tap so iOS allows Web Audio
      haptic('medium');
      sh.close();
      startRun(plan);
    }
  });
}

/* ---------------- the run controller ---------------- */

function startRun(plan) {
  if (run) return;
  run = createRun(plan, null);
  run.getReady();
}

function createRun(plan, snap) {
  const p = prof();
  const surface = SURFACES[plan.surface] ? plan.surface : usualSurface();
  const outdoor = surface === 'outdoor', hasInc = usesIncline(surface), free = !!plan.free;
  const segs = (snap ? snap.segs : plan.segs).map((s) => ({ ...s }));
  const engine = createEngine(segs, {
    kg: (snap && snap.engine && snap.engine.kg) || bodyKg(),
    nudge: (snap && snap.engine && snap.engine.nudge) || 0,
    handsFree: outdoor || p.treadmill.handsFree !== false, // no rails to lean on outdoors
    open: free, // Just walk: never finishes on its own
  });
  if (snap) {
    const wasRunning = !!snap.engine.running;
    engine.restore(snap.engine); engine.running = false;
    // The app closed mid-run: count the gap from the last saved moment as a pause (Apple Health pause times).
    const from = snap.engine.last || snap.savedAt;
    if (wasRunning && Number.isFinite(from) && !engine.finished) engine.pauseLog.push({ start: new Date(from).toISOString(), end: null });
  }

  const R = {
    plan, segs, engine, surface, free,
    phase: snap ? 'paused' : 'ready', // ready | running | paused | resuming | done
    muted: !!(snap && snap.muted),
    shownIdx: null, fromIdx: -1,
    unwell: false, changedAway: false,
    lastSave: 0, lastSplit: Math.floor((engine.total || 0) / 300), lastTen: Math.floor((engine.total || 0) / 600),
    raf: 0, timer: 0, sleepT: 0, countT: 0, holdT: 0,
    pend: {}, pendT: 0, // Just walk: speed / incline taps not yet logged (see commitPend)
    pauseSheet: null, text: {},
  };

  /* ---------- DOM ---------- */
  const root = document.createElement('div');
  root.className = `overlay player mode-${(engine.current() || segs[0]).type} surf-${surface}${free ? ' pl-free' : ''}`;
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-modal', 'true');
  root.setAttribute('aria-label', free ? 'Just walk' : `${plan.name} workout`);
  const unit = speedUnit();
  const wordEnd = free ? 'walk' : 'workout';
  // live stats: distance (≈ outdoors), ≈ kcal (unless "no numbers"), climb (on an incline), then interval count to fill
  const liveStats = [`<div><b>${outdoor ? '≈' : ''}<span class="num" data-el="dist">0.00</span><small>${esc(distUnit())}</small></b><span>${outdoor && p.noNumbers ? 'Distance (estimate)' : 'Distance'}</span></div>`];
  if (!p.noNumbers) liveStats.push('<div><b>≈<span class="num" data-el="kcal">0</span><small>kcal</small></b><span>Active (estimate)</span></div>');
  if (hasInc) liveStats.push(`<div><b><span class="num" data-el="elev">0</span><small>${esc(elevUnit())}</small></b><span>Climbed</span></div>`);
  if (!free && liveStats.length < 3) liveStats.push(`<div><b><span class="num" data-el="ivl">1</span><small>of ${segs.length}</small></b><span>Interval</span></div>`);

  const stepper = (what, stepTxt) => `<span class="pl-step" role="group" aria-label="Change ${what}"><button type="button" data-act="${what}-down" aria-label="Lower ${what} by ${esc(stepTxt)}">${icon('minus')}</button><button type="button" data-act="${what}-up" aria-label="Raise ${what} by ${esc(stepTxt)}">${icon('plus')}</button></span>`;
  // Target panel. Outdoors: how hard to walk (mode name, effort out of 10, talk test). Treadmill: speed (and incline).
  const panelHtml = outdoor
    ? `<section class="pl-panel pl-effort" data-el="panel" aria-label="How hard to walk">
        <p class="pl-eff-name" data-el="feel" aria-hidden="true"></p>
        <div class="pl-eff-more" aria-hidden="true">
          <p class="pl-eff-lvl"><span class="pl-lbl">Effort</span><b class="num" data-el="rpe"></b><span>out of 10</span></p>
          <p class="pl-eff-talk" data-el="talk"></p>
        </div>
      </section>`
    : `<section class="pl-panel${hasInc ? '' : ' pl-single'}" data-el="panel" aria-label="Set your treadmill">
        <div class="pl-row">
          <div class="pl-meta">
            <span class="pl-lbl">Speed<i class="pl-unit">${esc(unit)}</i></span>
            ${free ? stepper('speed', `0.1 ${unit}`) : '<span class="pl-chips"><span class="pl-chg" data-el="dSpeed"></span></span>'}
          </div>
          <div class="pl-num display-num" data-el="speed" aria-hidden="true"></div>
        </div>
        ${hasInc ? `<div class="pl-row">
          <div class="pl-meta">
            <span class="pl-lbl">Incline<i class="pl-unit">%</i></span>
            ${free ? stepper('incline', '0.5%') : '<span class="pl-chips"><span class="pl-chg" data-el="dIncline"></span></span>'}
          </div>
          <div class="pl-num display-num" data-el="incline" aria-hidden="true"></div>
        </div>` : ''}
      </section>`;
  const header = `
      <header class="pl-top">
        <button type="button" class="pl-end" data-act="end" aria-label="End ${wordEnd}. Press and hold for one second."><span class="pl-end-fill" aria-hidden="true"></span>${icon('stop')}<span>End</span></button>
        <div class="pl-title"><b>${esc(plan.name)}</b>${plan.context ? `<span>${esc(plan.context)}</span>` : ''}</div>
        <button type="button" class="icon-btn pl-sound" data-act="sound"></button>
      </header>`;
  const intervalsBody = `
      <div class="pl-overall">
        <div class="pl-ov">
          <span><b class="num" data-el="elapsed">0:00</b><small>elapsed</small></span>
          <span><small>left</small><b class="num" data-el="left">0:00</b></span>
        </div>
        <div class="pl-tl" data-el="tl" aria-hidden="true">${segs.map((s, i) => `<i class="pl-tl-seg mode-${esc(s.type)}" data-i="${i}"></i>`).join('')}<span class="pl-tl-head" data-el="head"></span></div>
      </div>

      <div class="pl-moderow">
        <span class="mode-chip" data-el="chip"></span>
        <span class="pl-label" data-el="label"></span>
      </div>

      ${panelHtml}

      <section class="pl-count">
        <div class="pl-count-main">
          <p class="pl-count-lbl" data-el="countLbl"></p>
          <p class="pl-count-num display-num" data-el="count" role="timer" aria-live="off">0:00</p>
        </div>
        <div class="pl-adjust">
          <button type="button" class="btn pl-extend" data-act="extend" aria-label="Add 30 seconds to this interval">+30 s</button>
          ${outdoor ? '' : `<div class="pl-nudge" role="group" aria-label="Adjust speed for all intervals">
            <button type="button" data-act="nudge-down" aria-label="Lower speed by 0.1 ${esc(unit)}">${icon('minus')}</button>
            <span class="pl-nudge-lbl" data-el="adj">Speed</span>
            <button type="button" data-act="nudge-up" aria-label="Raise speed by 0.1 ${esc(unit)}">${icon('plus')}</button>
          </div>`}
        </div>
      </section>
      <div class="pl-bar" aria-hidden="true"><i data-el="bar"></i><b data-el="ticks"></b></div>

      <div class="pl-next" data-el="next"></div>

      <div class="pl-live">${liveStats.join('')}</div>

      <div class="pl-controls">
        <button type="button" class="pl-ctl" data-act="back" aria-label="Back: restart this interval, or go to the previous one"><span class="pl-ctl-c">${icon('prev')}</span><span>Back</span></button>
        <button type="button" class="pl-pause" data-act="pause" data-el="pause"></button>
        <button type="button" class="pl-ctl" data-act="skip" aria-label="Skip to the next interval"><span class="pl-ctl-c">${icon('next')}</span><span>Skip</span></button>
      </div>`;
  // Just walk: the time counts up; choose a pace (and on a treadmill set what the console shows) as you go.
  const freeBody = `
      <section class="pl-free-time">
        <p class="pl-count-lbl" data-el="countLbl">Walking for</p>
        <p class="pl-free-clock display-num num" data-el="elapsed" role="timer" aria-live="off">0:00</p>
      </section>

      <div class="pl-pace" role="group" aria-label="Pace">${FREE_PACES.map((t) => `<button type="button" class="pl-pace-btn mode-${t}" data-pace="${t}" aria-pressed="false"><span class="pl-pace-ico">${modeIcon(t)}</span><span class="pl-pace-txt">${esc(PACE_LABEL[t])}</span></button>`).join('')}</div>

      ${panelHtml}

      <div class="pl-live${liveStats.length < 3 ? ' pl-live-2' : ''}">${liveStats.join('')}</div>

      <div class="pl-controls pl-controls-free">
        <button type="button" class="pl-pause" data-act="pause" data-el="pause"></button>
      </div>`;
  root.innerHTML = `
    <div class="pl-topo" aria-hidden="true">${topo({ w: 420, h: 260, seed: 11, lines: 15, cx: 0.86, cy: 0.06 })}</div>
    <div class="pl-wrap">
      ${header}
      ${free ? freeBody : intervalsBody}
      <p class="sr-only" aria-live="polite" data-el="live"></p>
    </div>
    <div class="pl-ready" data-el="ready" hidden>
      <p class="eyebrow" data-el="readyTitle">Get ready</p>
      <p class="pl-ready-num display-num" data-el="readyNum" aria-live="assertive">5</p>
      <p class="pl-ready-first" data-el="readyFirst"></p>
      <p class="pl-ready-tip" data-el="readyTip"></p>
      <button type="button" class="btn btn-ghost pl-ready-cancel" data-act="cancel-count">Cancel</button>
    </div>`;
  const el = {};
  root.querySelectorAll('[data-el]').forEach((n) => { el[n.dataset.el] = n; });
  const tlSegs = el.tl ? Array.from(el.tl.querySelectorAll('.pl-tl-seg')) : [];
  const paceBtns = Array.from(root.querySelectorAll('[data-pace]'));
  document.body.appendChild(root);
  document.body.classList.add('immersive');
  statusBar(isDarkTheme() ? 'light' : 'dark');

  /* ---------- text helpers ---------- */
  const setText = (key, node, v) => { if (node && R.text[key] !== v) { R.text[key] = v; node.textContent = v; } };
  const announce = (msg) => { el.live.textContent = ''; setTimeout(() => { el.live.textContent = msg; }, 30); };
  /** What to set (treadmill) or how hard to walk (outdoors), for VoiceOver and the lock screen. */
  const targetWords = (s, { speed = engine.speed(s), incline = s.incline } = {}) => (outdoor
    ? `Effort ${rpeWords(s.type)} out of 10. ${effortFor(s.type).talk}`
    : `${speedStr(speed)} ${speedUnit()}${hasInc ? `, incline ${fmt1(incline)} percent` : ''}`);

  /* ---------- audio cues (one utterance per tick; newer cues interrupt older ones) ---------- */
  let pending = [], flushQueued = false;
  function cue(text, { low = false } = {}) {
    if (!text) return;
    if (low) pending.push(text); else pending.unshift(text);
    if (flushQueued) return;
    flushQueued = true;
    queueMicrotask(() => {
      flushQueued = false;
      const msg = pending.join(' ');
      pending = [];
      if (!R.muted) speak(msg, { interrupt: true });
    });
  }
  const tone = (kind) => { if (!R.muted) beep(kind); };

  function leadText(s, n, secs) {
    const pre = `In ${secs} seconds: `;
    if (outdoor) return n.type === s.type ? '' : `${pre}${effName(n.type).toLowerCase()}. ${effortFor(n.type).talk}.`;
    const v = engine.speed(s), nv = engine.speed(n);
    const dv = Math.abs(nv - v) >= 0.05, di = Math.abs((n.incline || 0) - (s.incline || 0)) >= 0.25, dm = n.type !== s.type;
    if (!dv && !di) return dm ? `${pre}${modeSay(n.type)}, same speed${hasInc ? ' and incline' : ''}.` : '';
    if (!dv && !dm) return `${pre}incline to ${sayNum(n.incline)} percent.`;
    const parts = [modeSay(n.type)];
    if (dv) parts.push(`${sayNum(toSpeed(nv))} ${speedWords()}`);
    if (di) parts.push(dv ? `incline ${sayNum(n.incline)} percent` : `incline to ${sayNum(n.incline)} percent`);
    return pre + parts.join(', ') + '.';
  }
  function fullDesc(s) {
    const lbl = s.label && !/^(Recover|Easy walk|Brisk walk|Power walk|Jog|Run|Just walk)$/i.test(s.label) ? `${s.label}. ` : '';
    if (outdoor) return `${lbl}${effortFor(s.type).say}`;
    const inc = hasInc ? `, incline ${sayNum(s.incline)} percent` : '';
    return `${lbl}${modeName(s.type)}, ${sayNum(toSpeed(engine.speed(s)))} ${speedWords()}${inc}.`;
  }
  /** Just walk: what to say when the pace changes (or at the start). */
  function paceCue(s) {
    if (outdoor) return effortFor(s.type).say;
    return `${effName(s.type)}. ${sayNum(toSpeed(engine.speed(s)))} ${speedWords()}${hasInc && s.incline > 0 ? `, incline ${sayNum(s.incline)} percent` : ''}.`;
  }
  function announceT0(idx) {
    const s = segs[idx], prev = R.fromIdx >= 0 && R.fromIdx !== idx ? segs[R.fromIdx] : null;
    if (outdoor && prev && prev.type === s.type) { haptic('light'); return; } // outdoors nothing changes between same-mode blocks
    tone('go'); haptic('medium');
    const parts = [];
    if (!prev) parts.push(fullDesc(s));
    else if (outdoor) parts.push(effortFor(s.type).say);
    else {
      const v = engine.speed(s), pv = engine.speed(prev), nm = modeName(s.type);
      if (v - pv >= 1.5 - 1e-6) parts.push(`${nm}. Start raising to ${fmt1(toSpeed(v))}.`);
      else if (Math.abs(v - pv) >= 0.05) parts.push(`${nm}. ${fmt1(toSpeed(v))}.`);
      else if (Math.abs((s.incline || 0) - (prev.incline || 0)) >= 0.25) parts.push(`${nm}. Incline ${sayNum(s.incline)}.`);
      else parts.push(`${nm}.`);
    }
    if (idx === segs.length - 1 && segs.length > 1 && (+prof().cues.detail || 2) >= 2) parts.push('Last interval.');
    cue(parts.join(' '));
  }
  function checkLead() {
    if (free || !engine.running || engine.finished) return;
    const s = engine.current(), n = engine.next();
    if (!s || !n) return;
    const key = 'L' + engine.idx;
    if (engine.marks[key]) return;
    const lead = +prof().cues.lead || 10, rem = engine.segRemaining();
    if (rem <= lead + 0.05 && rem > 3.5 && engine.segEl >= 2) {
      engine.marks[key] = 1;
      cue(leadText(s, n, Math.round(rem)));
    }
  }
  function checkSplit() {
    if (free) return;
    const k = Math.floor(engine.total / 300);
    if (k <= R.lastSplit) return;
    R.lastSplit = k;
    if ((+prof().cues.detail || 2) >= 3 && engine.planRemaining() > 45) {
      cue(`${k * 5} minutes done. ${Math.round(engine.planRemaining() / 60)} minutes to go.`, { low: true });
    }
  }
  /** Just walk: "10 minutes", "20 minutes", … of walking (cue detail 2 or more). */
  function checkTen() {
    if (!free) return;
    const k = Math.floor(engine.total / 600);
    if (k <= R.lastTen) return;
    R.lastTen = k;
    if ((+prof().cues.detail || 2) >= 2) cue(`${spokenMinutes(k * 10)}.`, { low: true });
  }

  /* ---------- lock-screen notifications (interval sessions only; an open walk has no interval changes) ---------- */
  function schedule() {
    if (free || !features.lockScreenCues || !engine.running || engine.finished) return;
    const list = engine.upcoming().map((b) => {
      if (b.finish || !b.seg) return { at: b.at, title: 'Workout complete', body: 'Open Walking Companion to see your summary.' };
      const { n, N } = modeOrdinal(segs, b.index);
      const body = outdoor ? `Effort ${effortFor(b.seg.type).rpe} out of 10 · ${effortFor(b.seg.type).talk}` : `${speedStr(engine.speed(b.seg))} ${speedUnit()}${hasInc ? ` · ${incShort(b.seg.incline)}` : ''}`;
      return { at: b.at, title: `Next: ${outdoor ? effName(b.seg.type) : modeName(b.seg.type)} (${n} of ${N})`, body };
    });
    scheduleCues(list);
  }

  /* ---------- persistence ---------- */
  function save() {
    if (!engine.startedAt || engine.finished || R.phase === 'done') return;
    R.lastSave = Date.now();
    try {
      localStorage.setItem(RUN_KEY, JSON.stringify({
        engine: engine.snapshot(), segs, name: plan.name, workoutId: plan.workoutId, slotKey: plan.slotKey,
        level: plan.level, length: plan.length, context: plan.context, surface, free, muted: R.muted, savedAt: Date.now(),
      }));
    } catch { /* storage full or blocked: the run still works */ }
  }

  /* ---------- rendering ---------- */
  function layoutTimeline() {
    if (!tlSegs.length) return;
    const total = engine.planTotal || 1;
    let t = 0;
    const maxI = Math.max(6, ...segs.map((s) => s.incline || 0));
    segs.forEach((s, i) => {
      const n = tlSegs[i];
      if (!n) return;
      n.style.left = (t / total) * 100 + '%';
      n.style.width = `max(1.5px, calc(${(s.dur / total) * 100}% - 2px))`;
      // incline: the hill's shape; outdoors: harder efforts stand taller; flat: one even band
      n.style.height = hasInc ? 22 + ((s.incline || 0) / maxI) * 78 + '%' : outdoor ? 34 + (MODE_RANK[s.type] || 0) * 16.5 + '%' : '60%';
      t += s.dur;
    });
  }
  function fitNumber(node) {
    if (!node) return;
    node.style.fontSize = '';
    const max = node.clientWidth;
    let size = parseFloat(getComputedStyle(node).fontSize);
    let guard = 12;
    while (node.scrollWidth > max + 1 && size > 84 && guard--) { size -= 6; node.style.fontSize = size + 'px'; }
  }
  /** Shrink a one-line text (the effort name) until it fits, down to 36 px. */
  function fitText(node) {
    if (!node) return;
    node.style.fontSize = '';
    let size = parseFloat(getComputedStyle(node).fontSize), guard = 16;
    while (node.scrollWidth > node.clientWidth + 1 && size > 36 && guard--) { size -= 4; node.style.fontSize = size + 'px'; }
  }
  function chipHtml(delta, digits) {
    if (Math.abs(delta) < (digits ? 0.05 : 0.25)) return '';
    return `${triangle(delta > 0)}${fmt1(Math.abs(delta))}`;
  }
  function renderSound() {
    const c = prof().cues;
    const off = R.muted || (!c.voice && !c.beeps);
    const b = root.querySelector('.pl-sound');
    b.innerHTML = icon(off ? 'mute' : 'voice');
    b.setAttribute('aria-pressed', String(!off));
    b.setAttribute('aria-label', !c.voice && !c.beeps ? 'Voice and beeps are off in settings' : off ? 'Sound off. Turn voice and beeps on' : 'Sound on. Turn voice and beeps off');
    b.classList.toggle('is-off', off);
  }
  function renderPauseBtn() {
    const paused = !engine.running;
    const key = (paused ? 'play' : 'pause') + ':' + R.phase;
    if (R.text.pauseIcon === key) return;
    R.text.pauseIcon = key;
    el.pause.innerHTML = icon(paused ? 'play' : 'pause');
    el.pause.setAttribute('aria-label', paused ? `Resume ${wordEnd}` : `Pause ${wordEnd}`);
    root.classList.toggle('is-paused', paused && R.phase === 'paused');
  }
  /** Outdoors: the effort panel (mode name big, effort out of 10, talk test). */
  function renderEffort(s) {
    if (!el.feel) return;
    el.feel.textContent = effName(s.type);
    el.rpe.textContent = effortFor(s.type).rpe;
    el.talk.textContent = effortFor(s.type).talk;
    el.panel.setAttribute('aria-label', `How hard to walk: ${effName(s.type)}. ${targetWords(s)}.`);
    fitText(el.feel);
  }
  /** Just walk on a treadmill: the numbers to set, including taps not logged yet; stepper limits. */
  function renderFreeTargets(s) {
    const t = prof().treadmill;
    const v = R.pend.speed ?? engine.speed(s), inc = R.pend.incline ?? (s.incline || 0);
    setText('speed', el.speed, speedStr(v));
    if (el.incline) setText('incline', el.incline, fmt1(inc));
    const q = (a) => root.querySelector(`[data-act="${a}"]`);
    q('speed-up').disabled = v >= (t.maxSpeed || 20) - 1e-6;
    q('speed-down').disabled = toSpeed(v) - 0.1 < toSpeed(1) - 1e-6;
    if (el.incline) { q('incline-up').disabled = inc >= (t.maxIncline ?? 15) - 1e-6; q('incline-down').disabled = inc <= 1e-6; }
    el.panel.setAttribute('aria-label', `Set your treadmill: ${targetWords(s, { speed: v, incline: inc })}`);
    fitNumber(el.speed); fitNumber(el.incline);
  }
  function renderSegment() {
    const s = engine.current();
    if (!s) return;
    const idx = engine.idx, last = idx === segs.length - 1;
    root.className = root.className.replace(/\bmode-\w+/, 'mode-' + s.type);
    if (free) {
      paceBtns.forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.pace === s.type)));
      if (outdoor) renderEffort(s); else renderFreeTargets(s);
      renderPauseBtn();
      renderTick();
      return;
    }
    const lbl = s.label || modeName(s.type), long = lbl.length > 14;
    // long labels ("Circuit 2 · Steep climb") get the short mode name so both fit on one line
    el.chip.innerHTML = long
      ? `${modeIcon(s.type)}<span aria-hidden="true">${esc((MODES[s.type] || MODES.walk).short)}</span><span class="sr-only">${esc(modeName(s.type))}</span>`
      : `${modeIcon(s.type)}${esc(modeName(s.type))}`;
    el.label.textContent = lbl;
    el.label.classList.toggle('long', long);
    const prev = R.fromIdx >= 0 && R.fromIdx !== idx ? segs[R.fromIdx] : idx > 0 ? segs[idx - 1] : null;
    if (outdoor) renderEffort(s);
    else {
      const v = engine.speed(s);
      el.speed.textContent = speedStr(v);
      if (el.incline) el.incline.textContent = fmt1(s.incline);
      el.dSpeed.innerHTML = prev ? chipHtml(toSpeed(v) - toSpeed(engine.speed(prev)), true) : '';
      el.dSpeed.setAttribute('aria-hidden', 'true');
      if (el.dIncline) { el.dIncline.innerHTML = prev ? chipHtml((s.incline || 0) - (prev.incline || 0), false) : ''; el.dIncline.setAttribute('aria-hidden', 'true'); }
      const nd = toSpeed(engine.nudge);
      const adjusted = Math.abs(engine.nudge) > 0.001;
      el.adj.textContent = adjusted ? `${nd > 0 ? '+' : '−'}${fmt1(Math.abs(nd))}` : 'Speed';
      el.adj.classList.toggle('on', adjusted);
      el.adj.setAttribute('aria-label', adjusted ? `Speed adjusted by ${nd > 0 ? 'plus' : 'minus'} ${fmt1(Math.abs(nd))} ${speedUnit()}` : 'Speed as planned');
      // speed-nudge limits: never above the treadmill maximum, never below the belt minimum
      const step = nudgeStep();
      const up = root.querySelector('[data-act="nudge-up"]'), down = root.querySelector('[data-act="nudge-down"]');
      up.disabled = speedFor(s, engine.nudge + step) <= v + 1e-6 || engine.nudge + step > 3.001;
      down.disabled = speedFor(s, engine.nudge - step) >= v - 1e-6 || engine.nudge - step < -3.001;
      el.panel.setAttribute('aria-label', `Set your treadmill: ${targetWords(s)}`);
      fitNumber(el.speed); fitNumber(el.incline);
    }
    setText('countLbl', el.countLbl, !engine.running && R.phase === 'paused' ? 'Paused' : last ? 'Workout ends in' : `${modeName(s.type)} ends in`);
    // 30-second ticks on the interval bar (60 s for very long intervals)
    const tick = s.dur > 900 ? 60 : 30;
    el.ticks.hidden = s.dur <= tick;
    el.ticks.style.setProperty('--tick', ((tick / s.dur) * 100).toFixed(4) + '%');
    // next up
    const n = engine.next();
    if (n) {
      const what = outdoor
        ? `<em class="mode-${n.type}">${esc(effName(n.type))}</em> · ${esc(talkShort(n.type))}`
        : `<em class="mode-${n.type}">${esc(modeName(n.type))}</em> ${speedStr(engine.speed(n))} ${esc(speedUnit())}${hasInc ? ` · ${incShort(n.incline)}` : ''}`;
      el.next.innerHTML = `<span class="pl-next-ico mode-${n.type}">${modeIcon(n.type)}</span>
        <span class="pl-next-txt"><small>Next · ${esc(durShort(n.dur))}</small><b>${what}</b></span>
        <span class="pl-next-in"><small>in</small><b class="num" data-el="nextIn"></b></span>`;
    } else {
      el.next.innerHTML = `<span class="pl-next-ico pl-next-fin">${icon('flag')}</span>
        <span class="pl-next-txt"><small>Then</small><b>Workout complete</b></span>
        <span class="pl-next-in"><small>in</small><b class="num" data-el="nextIn"></b></span>`;
    }
    el.nextIn = el.next.querySelector('[data-el="nextIn"]');
    R.text.nextIn = null;
    tlSegs.forEach((node, i) => { node.classList.toggle('past', i < idx); node.classList.toggle('cur', i === idx); });
    renderPauseBtn();
    renderTick();
  }
  function renderTick() {
    const e = engine, s = e.current();
    setText('elapsed', el.elapsed, clock(Math.floor(e.total)));
    setText('dist', el.dist, distStr(e.km));
    if (el.kcal) setText('kcal', el.kcal, String(roundKcal(e.kcal)));
    if (el.elev) setText('elev', el.elev, String(Math.round(toElev(e.elev))));
    if (free) {
      if (e.total >= 3600 && !el.elapsed.classList.contains('hours')) el.elapsed.classList.add('hours'); // h:mm:ss needs a smaller size
      setText('countLbl', el.countLbl, R.phase === 'done' ? 'Walk ended' : !e.running && R.phase === 'paused' ? 'Paused' : 'Walking for');
      renderPauseBtn();
      return;
    }
    setText('left', el.left, clock(Math.ceil(e.planRemaining() - 1e-6)));
    if (s) {
      const rem = Math.ceil(e.segRemaining() - 1e-6);
      setText('count', el.count, clock(rem));
      if (el.nextIn) setText('nextIn', el.nextIn, clock(rem));
      el.bar.style.width = Math.min(100, (e.segEl / s.dur) * 100).toFixed(2) + '%';
    }
    el.head.style.left = (e.progress() * 100).toFixed(3) + '%';
    if (el.ivl) setText('ivl', el.ivl, String(Math.min(segs.length, e.idx + 1)));
    setText('countLbl', el.countLbl, R.phase === 'done' ? 'Workout ended' : !e.running && R.phase === 'paused' ? 'Paused' : s ? (e.idx === segs.length - 1 ? 'Workout ends in' : `${modeName(s.type)} ends in`) : '');
    renderPauseBtn();
  }

  /* ---------- loop ---------- */
  function step() {
    if (!engine.running || engine.finished) return;
    engine.tick(); // emits 'tick' → renderTick, and 'segment'/'finish' when due
    if (!engine.running || engine.finished) return;
    checkLead();
    checkSplit();
    checkTen();
    if (Date.now() - R.lastSave > SAVE_EVERY_MS) save();
  }
  function frame() { step(); R.raf = engine.running ? requestAnimationFrame(frame) : 0; }
  function startLoop() {
    stopLoop();
    R.raf = requestAnimationFrame(frame);
    R.timer = setInterval(step, 1000); // fallback when rAF is throttled (hidden tab, low power)
  }
  function stopLoop() { cancelAnimationFrame(R.raf); R.raf = 0; clearInterval(R.timer); R.timer = 0; }

  /* ---------- engine events ---------- */
  engine.on('tick', renderTick);
  engine.on('state', () => { renderPauseBtn(); save(); });
  engine.on('segment', (idx, info = {}) => {
    const from = info.from != null && info.from >= 0 ? info.from : R.shownIdx;
    R.fromIdx = from != null && from !== idx ? from : idx - 1;
    if (info.from === -1) R.fromIdx = -1;
    R.shownIdx = idx;
    if (info.manual) delete engine.marks['L' + idx];
    renderSegment();
    const s = segs[idx];
    if (free) {
      // the start, or a pace / speed / incline the walker logged: no interval countdown, no beeps
      announce(`${effName(s.type)}. ${targetWords(s)}.`);
      if (info.from === -1 && R.phase === 'running') { tone('go'); haptic('medium'); cue(`Let’s walk. ${paceCue(s)}`); }
      save();
      return;
    }
    announce(`${modeName(s.type)}, ${s.label || ''}. ${targetWords(s)}. ${clock(engine.segRemaining())} to next change.`);
    if (info.catchUp) { R.changedAway = true; return; }
    if (R.phase === 'running') announceT0(idx);
    save();
  });
  engine.on('countdown', () => {
    if (R.phase !== 'running') return;
    const s = engine.current(), n = engine.next();
    if (outdoor && s && n && s.type === n.type) return; // nothing to change outdoors
    tone('tick'); haptic('light');
  });
  engine.on('milestone', (k) => {
    if (free || (+prof().cues.detail || 2) < 2) return;
    if (k === 'half') cue('Halfway.', { low: true });
    if (k === 'five') cue('Five minutes left.', { low: true });
  });
  engine.on('extend', () => { delete engine.marks['L' + engine.idx]; layoutTimeline(); renderSegment(); });
  engine.on('nudge', () => renderSegment());
  engine.on('finish', (natural) => onFinish(natural));

  /* ---------- countdown overlay (get ready / resume) ---------- */
  function countdown(n, { title, first = '', tip = '', cancelable = true, onDone, onCancel }) {
    clearInterval(R.countT);
    el.readyTitle.textContent = title;
    el.readyFirst.innerHTML = first;
    el.readyTip.textContent = tip;
    el.readyTip.hidden = !tip;
    root.querySelector('[data-act="cancel-count"]').hidden = !cancelable;
    el.ready.hidden = false;
    el.ready.classList.remove('out');
    const t0 = performance.now();
    let shown = null;
    const show = (k) => {
      if (k === shown) return;
      shown = k;
      el.readyNum.textContent = String(k);
      if (!RM) { el.readyNum.classList.remove('pop'); void el.readyNum.offsetWidth; el.readyNum.classList.add('pop'); }
      tone('tick'); haptic('light');
    };
    show(n);
    R.cancelCount = () => { clearInterval(R.countT); el.ready.hidden = true; R.cancelCount = null; onCancel && onCancel(); };
    R.countT = setInterval(() => {
      const k = n - Math.floor((performance.now() - t0) / 1000);
      if (k > 0) { show(k); return; }
      clearInterval(R.countT); R.cancelCount = null;
      el.ready.hidden = true;
      onDone();
    }, 80);
    // after any closing sheet has restored its focus
    setTimeout(() => { const c = root.querySelector('[data-act="cancel-count"]'); if (cancelable && c && !el.ready.hidden) try { c.focus({ preventScroll: true }); } catch { /* ignore */ } }, 260);
  }
  function firstLine(s) {
    const what = outdoor ? ` · effort ${esc(effortFor(s.type).rpe)} out of 10` : ` ${speedStr(engine.speed(s))} ${esc(speedUnit())}${hasInc ? ` · ${fmt1(s.incline)} %` : ''}`;
    return `<span class="mode-${s.type}"><i class="mode-dot"></i></span><span>First: <b>${esc(outdoor ? effName(s.type) : modeName(s.type))}</b>${what}</span>`;
  }
  function readyTip() {
    if (outdoor) return free ? 'Start at a brisk pace. Change it any time.' : prof().cues.voice ? 'Phone in your pocket? Voice cues tell you each change.' : 'Start walking when the count reaches zero.';
    return surface === 'flat' ? 'Start the belt slowly, then step on.' : 'Stand on the side rails, start the belt slowly, then step on.';
  }

  /* ---------- actions ---------- */
  R.getReady = () => {
    R.phase = 'ready';
    renderSegment();
    if (!R.muted) speak('Get ready.', { interrupt: true });
    countdown(5, {
      title: 'Get ready',
      first: firstLine(segs[0]),
      tip: readyTip(),
      onDone: () => {
        R.phase = 'running';
        engine.start(); // emits segment 0 → go beep + first announcement
        keepAwake(true);
        if (free) cancelCues(); else schedule();
        startLoop();
        save();
        try { el.pause.focus({ preventScroll: true }); } catch { /* ignore */ }
      },
      onCancel: () => { stopSpeaking(); close(); },
    });
  };

  function pause({ showSheet = true } = {}) {
    if (!engine.running || engine.finished) return;
    commitPend();
    engine.pause();
    R.phase = 'paused';
    stopLoop();
    cancelCues();
    haptic('medium');
    cue('Paused.');
    clearTimeout(R.sleepT);
    R.sleepT = setTimeout(() => keepAwake(false), SLEEP_AFTER_PAUSE_MS);
    renderSegment();
    save();
    if (showSheet) openPauseSheet();
  }
  function resume() {
    if (engine.running || engine.finished || R.phase === 'resuming') return;
    unlockAudio();
    R.phase = 'resuming';
    countdown(3, {
      title: 'Resuming',
      first: firstLine(engine.current()).replace('First:', 'Now:'),
      tip: '',
      onDone: () => {
        R.phase = 'running';
        engine.resume();
        clearTimeout(R.sleepT);
        keepAwake(true);
        R.lastSplit = Math.floor(engine.total / 300);
        R.lastTen = Math.floor(engine.total / 600);
        const s = engine.current();
        tone('go'); haptic('medium');
        cue(free ? paceCue(s) : outdoor ? `${effName(s.type)}. ${effortFor(s.type).talk}.` : `${modeName(s.type)}. ${fmt1(toSpeed(engine.speed(s)))}.`);
        schedule();
        startLoop();
        renderSegment();
        save();
      },
      onCancel: () => { R.phase = 'paused'; renderSegment(); },
    });
  }
  function togglePause() { if (R.phase === 'running') pause(); else if (R.phase === 'paused') resume(); }

  function openPauseSheet() {
    if (R.pauseSheet) return;
    const e = engine;
    const times = free
      ? `<span><b class="num">${clock(Math.floor(e.total))}</b> walked</span><span><b class="num">${outdoor ? '≈' : ''}${distStr(e.km)}</b> ${esc(distUnit())}</span>`
      : `<span><b class="num">${clock(Math.floor(e.total))}</b> done</span><span><b class="num">${clock(Math.ceil(e.planRemaining()))}</b> left</span>`;
    const safety = outdoor
      ? `<div class="banner warn"><span class="banner-icon">${icon('alert')}</span><div class="banner-body"><b>Stop somewhere safe</b>Step to the side of the path, away from traffic, before you look at your phone.</div></div>`
      : `<div class="banner warn"><span class="banner-icon">${icon('alert')}</span><div class="banner-body"><b>Slow the belt before stepping off</b>Step onto the side rails once it has slowed right down.</div></div>`;
    const s = sheet(`
      <p class="pl-ps-time">${times}</p>
      ${safety}
      <div class="stack pl-ps-actions">
        <button type="button" class="btn btn-primary btn-lg btn-block" data-ps="resume" autofocus>${icon('play')}Resume</button>
        <button type="button" class="btn btn-lg btn-block" data-ps="end">${icon('stop')}${free ? 'End walk' : 'End workout'}</button>
        <button type="button" class="btn btn-danger btn-block" data-ps="unwell">${icon('heart')}I feel unwell</button>
      </div>`, { title: 'Paused', onClose: () => { R.pauseSheet = null; } });
    s.el.classList.add('pl-ps');
    R.pauseSheet = s;
    s.el.addEventListener('click', (ev) => {
      const b = ev.target.closest('[data-ps]');
      if (!b) return;
      const a = b.dataset.ps;
      s.close();
      if (a === 'resume') resume();
      else if (a === 'end') endWorkout();
      else if (a === 'unwell') { R.unwell = true; endWorkout(); }
    });
  }

  function endWorkout() {
    if (engine.finished || R.phase === 'done') return;
    if (R.cancelCount) { clearInterval(R.countT); el.ready.hidden = true; R.cancelCount = null; }
    commitPend();
    engine.end(); // emits 'finish' (false for a plan, true for an open walk)
  }
  function skip() {
    if (free || engine.finished || R.phase === 'ready' || R.phase === 'resuming') return;
    haptic('light');
    engine.skip();
    if (!engine.finished) { schedule(); save(); }
  }
  function back() {
    if (free || engine.finished || R.phase === 'ready' || R.phase === 'resuming') return;
    haptic('light');
    engine.back();
    schedule(); save();
  }
  function extend() {
    if (free || engine.finished || R.phase === 'ready' || R.phase === 'resuming') return;
    engine.extend(30);
    haptic('light');
    toast('Added 30 s to this interval');
    schedule(); save();
  }
  function nudge(dir) {
    const s = engine.current();
    if (!s || engine.finished || free || outdoor) return;
    const target = Math.round((engine.nudge + dir * nudgeStep()) * 100) / 100;
    const cur = engine.speed(s), next = speedFor(s, target);
    if (dir > 0 && next <= cur + 1e-6) { toast(`That’s your treadmill’s top speed (${speedStr(prof().treadmill.maxSpeed || 20)} ${speedUnit()})`); return; }
    if (Math.abs(target) > 3.001 || (dir < 0 && next >= cur - 1e-6)) return;
    engine.setNudge(target); // emits nudge → renderSegment
    haptic('selection');
    announce(`Speed ${speedStr(engine.speed())} ${speedUnit()}. All intervals adjusted.`);
    schedule(); save();
  }

  /* ---------- Just walk: pace, speed and incline ---------- */
  const canChange = () => free && !engine.finished && R.phase !== 'ready' && R.phase !== 'resuming' && R.phase !== 'done';
  /** Log speed / incline taps once they settle, so a run of taps becomes one change instead of many tiny splits. */
  function commitPend() {
    clearTimeout(R.pendT); R.pendT = 0;
    const patch = R.pend;
    R.pend = {};
    if (patch.speed == null && patch.incline == null) return;
    engine.changeCurrent(patch); // emits segment → renderSegment
    save();
  }
  function setPace(t) {
    const s = engine.current();
    if (!canChange() || !s || !FREE_PACES.includes(t)) return;
    if (s.type === t && R.pend.speed == null) return;
    const inc = R.pend.incline;
    clearTimeout(R.pendT); R.pendT = 0; R.pend = {};
    engine.changeCurrent(inc != null ? { type: t, incline: inc } : { type: t }); // the speed goes back to this pace
    haptic('selection');
    cue(paceCue(engine.current()));
  }
  function stepSpeed(dir) {
    const s = engine.current();
    if (!canChange() || !s || outdoor) return;
    const t = prof().treadmill;
    const cur = R.pend.speed ?? engine.speed(s);
    const next = fromSpeed(Math.round((toSpeed(cur) + dir * 0.1) * 10) / 10);
    if (dir > 0 && next > (t.maxSpeed || 20) + 1e-6) { toast(`That’s your treadmill’s top speed (${speedStr(t.maxSpeed || 20)} ${speedUnit()})`); return; }
    if (dir < 0 && next < 1 - 1e-6) return;
    R.pend.speed = next;
    clearTimeout(R.pendT); R.pendT = setTimeout(commitPend, 1200);
    haptic('selection');
    renderFreeTargets(s);
    announce(`Speed ${speedStr(next)} ${speedUnit()}`);
  }
  function stepIncline(dir) {
    const s = engine.current();
    if (!canChange() || !s || !hasInc) return;
    const max = prof().treadmill.maxIncline ?? 15;
    const cur = R.pend.incline ?? (s.incline || 0);
    const next = Math.round((cur + dir * 0.5) * 2) / 2;
    if (next < 0 || next > max + 1e-6) return;
    R.pend.incline = next;
    clearTimeout(R.pendT); R.pendT = setTimeout(commitPend, 1200);
    haptic('selection');
    renderFreeTargets(s);
    announce(`Incline ${fmt1(next)} percent`);
  }

  function toggleSound() {
    const c = prof().cues;
    if (!c.voice && !c.beeps) { toast('Voice and beeps are off. Turn them on in Me → Voice and cues.'); return; }
    R.muted = !R.muted;
    if (R.muted) stopSpeaking();
    renderSound();
    toast(R.muted ? `Voice and beeps off for this ${wordEnd}` : 'Voice and beeps on');
    save();
  }

  /* ---------- hold-to-end ---------- */
  const endBtn = root.querySelector('.pl-end');
  let holdStart = 0;
  const holdCancel = (showHint) => {
    if (!R.holdT) return;
    clearTimeout(R.holdT); R.holdT = 0;
    endBtn.classList.remove('holding');
    if (showHint && performance.now() - holdStart < HOLD_MS * 0.6) toast('Hold to end, or pause first');
  };
  endBtn.addEventListener('pointerdown', (ev) => {
    if (ev.button > 0 || engine.finished) return;
    holdStart = performance.now();
    endBtn.classList.add('holding');
    haptic('light');
    try { endBtn.setPointerCapture(ev.pointerId); } catch { /* ignore */ }
    R.holdT = setTimeout(() => { R.holdT = 0; endBtn.classList.remove('holding'); haptic('heavy'); endWorkout(); }, HOLD_MS);
  });
  endBtn.addEventListener('pointerup', () => holdCancel(true));
  endBtn.addEventListener('pointercancel', () => holdCancel(false));
  endBtn.addEventListener('contextmenu', (ev) => ev.preventDefault());
  // Keyboard / VoiceOver activation can't hold: open the pause sheet, which has "End workout".
  endBtn.addEventListener('click', (ev) => {
    if (ev.detail !== 0) return;
    if (R.phase === 'running') pause(); else if (R.phase === 'paused') openPauseSheet();
  });

  root.addEventListener('click', (ev) => {
    const pb = ev.target.closest('[data-pace]');
    if (pb) { setPace(pb.dataset.pace); return; }
    const b = ev.target.closest('[data-act]');
    if (!b || b.disabled) return;
    switch (b.dataset.act) {
      case 'pause': togglePause(); break;
      case 'skip': skip(); break;
      case 'back': back(); break;
      case 'extend': extend(); break;
      case 'nudge-up': nudge(1); break;
      case 'nudge-down': nudge(-1); break;
      case 'speed-up': stepSpeed(1); break;
      case 'speed-down': stepSpeed(-1); break;
      case 'incline-up': stepIncline(1); break;
      case 'incline-down': stepIncline(-1); break;
      case 'sound': toggleSound(); break;
      case 'cancel-count': if (R.cancelCount) R.cancelCount(); break;
      default: break;
    }
  });
  function onKey(ev) {
    if (ev.key !== ' ' || document.querySelector('.sheet-root')) return;
    if (ev.target && /INPUT|TEXTAREA|SELECT|BUTTON/.test(ev.target.tagName)) return;
    ev.preventDefault();
    togglePause();
  }
  document.addEventListener('keydown', onKey);

  /* ---------- foreground / background ---------- */
  R.onAppState = (active) => {
    if (!active) { R.idxAtHide = engine.idx; R.changedAway = false; commitPend(); save(); return; }
    if (!engine.running || engine.finished) { renderTick(); return; }
    // The fallback timer may already have caught up before this event arrives, so compare with the
    // interval at the moment we went to the background rather than just before this tick.
    const prevIdx = R.idxAtHide != null ? R.idxAtHide : engine.idx;
    R.idxAtHide = null;
    engine.tick();
    if (engine.finished) return;
    if (free) { R.lastTen = Math.floor(engine.total / 600); if (!R.raf) startLoop(); save(); return; } // no catch-up cues for an open walk
    const moved = R.changedAway || engine.idx !== prevIdx;
    R.changedAway = false;
    if (moved) {
      const s = engine.current(), { n, N } = modeOrdinal(segs, engine.idx);
      cue(`You're in ${outdoor ? effName(s.type).toLowerCase() : modeSay(s.type)} ${n} of ${N}, ${spokenTime(engine.segRemaining())} left.`);
      if (engine.segRemaining() <= (+prof().cues.lead || 10)) engine.marks['L' + engine.idx] = 1;
      cancelCues().then(() => schedule()); // clears delivered notifications, then re-plans the rest
    }
    if (!R.raf) startLoop();
    save();
  };

  /* ---------- finish ---------- */
  // Share of the plan actually walked. e.total counts active seconds only, so skipped time never counts. (An open walk: 1.)
  const completionNow = () => engine.completion();
  // "Complete" means the plan was walked (98%+), not just that the last interval ran out after skips.
  const isComplete = () => free || completionNow() >= COMPLETE_AT;

  function onFinish(natural) {
    stopLoop();
    clearTimeout(R.sleepT);
    clearTimeout(R.holdT);
    clearTimeout(R.pendT);
    cancelCues();
    keepAwake(false);
    if (R.pauseSheet) { R.pauseSheet.close(); R.pauseSheet = null; }
    R.phase = 'done';
    renderTick();
    if (natural && !R.unwell) {
      tone('done');
      if (isComplete()) { haptic('success'); cue(free ? 'Walk complete.' : 'Workout complete.'); } else cue('Workout ended.');
    } else stopSpeaking();
    finalize();
  }

  function buildSession() {
    const e = engine;
    const completion = free ? 1 : completionNow();
    const hours = e.total / 3600;
    // Net kcal = (METs − 1) × 3.5 ml/kg/min × kg × 5 kcal/L → kcal/(kg·h) = (METs − 1) × 1.05
    const avgMETs = hours > 0 && e.kg > 0 ? Math.round((1 + e.kcal / (e.kg * hours * 1.05)) * 10) / 10 : null;
    return {
      id: store.uid(),
      date: e.startedAt || new Date().toISOString(),
      endedAt: e.endedAt || new Date().toISOString(),
      workoutId: free ? FREE_WALK_ID : plan.workoutId || null,
      name: free ? 'Just walk' : plan.name,
      planSlot: free ? null : plan.slotKey || null,
      level: free ? null : plan.level ?? null,
      length: free ? null : plan.length ?? null,
      surface,
      durationSec: Math.round(e.total),
      plannedSec: free ? Math.round(e.total) : Math.round(e.planTotal), // an open walk has no plan: what was walked
      completion,
      completed: free || completion >= COMPLETE_AT,
      distanceKm: Math.round(e.km * 1000) / 1000,
      kcal: Math.round(e.kcal),
      elevM: Math.round(e.elev),
      avgMETs,
      rpe: null,
      notes: '',
      splits: e.splits.filter((x) => x.sec >= 1).sort((a, b) => a.idx - b.idx).map((x) => ({
        idx: x.idx, type: x.type, label: x.label, incline: x.incline, speed: Math.round(x.speed * 100) / 100,
        sec: Math.round(x.sec), km: Math.round(x.km * 1000) / 1000, kcal: Math.round(x.kcal * 10) / 10, vig: !!x.vig,
      })),
      nudgeKmh: e.nudge || 0,
      // Wall-clock pauses (an open one ends with the workout), so Apple Health gets the exact pause times.
      pauseLog: (e.pauseLog || []).map((x) => ({ start: x.start, end: x.end || e.endedAt || new Date().toISOString() })),
      source: 'app',
      healthUUID: null,
      healthPending: !!(features.health && state.main.profile.health.enabled && e.total >= 60),
      consoleEdited: false,
    };
  }

  async function finalize() {
    clearRunSnapshot(); // the run is over: never offer to resume it, whatever happens next
    const remember = (s) => store.update((m) => { if (s.workoutId && s.workoutId !== FREE_WALK_ID) m.lastWorkoutId = s.workoutId; });
    if (R.unwell) {
      // Safety first: no questions. Keep anything worth keeping, then show the stop signs.
      const keep = engine.total >= 60;
      if (keep) { const s = buildSession(); store.addSession(s); remember(s); }
      clearRunSnapshot();
      close();
      if (keep) toast(`${free ? 'Walk' : 'Workout'} saved. Rest, and get help if symptoms don’t settle.`, { ms: 4200 });
      actions.openStopSigns();
      return;
    }
    if (engine.total < 60) {
      const discard = await confirmSheet({
        title: free ? 'Discard this walk?' : 'Discard this workout?',
        body: free
          ? 'It lasted less than a minute, so there is little to save. Discarded walks don’t count toward your totals.'
          : 'It lasted less than a minute, so there is little to save. Discarded workouts don’t count toward your plan or totals.',
        confirm: 'Discard', cancel: 'Save anyway', danger: true,
      });
      if (discard) {
        clearRunSnapshot();
        close();
        toast(free ? 'Walk discarded' : 'Workout discarded');
        return;
      }
    }
    const s = buildSession();
    store.addSession(s);
    remember(s);
    clearRunSnapshot();
    actions.openSummary(s.id, { fresh: true });
    close({ delay: 380 }); // let the summary overlay cover the player before removing it
  }

  /* ---------- close ---------- */
  function close({ delay = 0 } = {}) {
    stopLoop();
    clearInterval(R.countT);
    clearTimeout(R.sleepT);
    clearTimeout(R.holdT);
    clearTimeout(R.pendT);
    document.removeEventListener('keydown', onKey);
    R.offResize();
    if (R.pauseSheet) { R.pauseSheet.close(); R.pauseSheet = null; }
    if (engine.running) engine.pause();
    keepAwake(false);
    if (run === R) run = null;
    const remove = () => {
      root.remove();
      if (!document.querySelector('.overlay')) {
        document.body.classList.remove('immersive');
        actions.refresh(); // data changed while the player owned the screen
      }
      statusBar(isDarkTheme() ? 'light' : 'dark');
    };
    if (delay) setTimeout(remove, delay); else remove();
  }

  /* ---------- fit: tighten spacing when the screen (minus safe areas) is too short ---------- */
  // Tiers are cumulative: each one tightens further until nothing scrolls (iPhone SE 375×667 and 320-pt Display Zoom included).
  const FIT_TIERS = ['pl-compact', 'pl-dense', 'pl-tight', 'pl-mini'];
  function fitLayout() {
    root.classList.remove(...FIT_TIERS, 'pl-adjrow', 'pl-scroll');
    [el.speed, el.incline, el.feel].forEach((n) => { if (n) n.style.fontSize = ''; }); // measure at the tier's own size, not a fit shrink
    const fits = () => root.scrollHeight <= root.clientHeight + 1;
    for (const tier of FIT_TIERS) {
      if (fits()) return;
      root.classList.add(tier);
      // +30 s and the speed nudge share one row once space is short, if the screen is wide enough for both and the timer
      if (tier === 'pl-dense' && root.clientWidth >= 360 && !free) root.classList.add('pl-adjrow');
    }
    if (!fits()) root.classList.add('pl-scroll');
  }
  const onResize = () => { fitLayout(); fitNumber(el.speed); fitNumber(el.incline); fitText(el.feel); };
  window.addEventListener('resize', onResize);
  R.offResize = () => window.removeEventListener('resize', onResize);

  /* ---------- initial paint ---------- */
  layoutTimeline();
  renderSound();
  R.shownIdx = engine.idx;
  R.fromIdx = engine.idx > 0 ? engine.idx - 1 : -1;
  renderSegment();
  fitLayout();
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => { if (root.isConnected) onResize(); });
  R.resume = resume;
  R.save = save;
  return R;
}

/* ---------------- lifecycle (registered once) ---------------- */

onAppState((active) => { if (run && run.onAppState) run.onAppState(active); });
if (typeof window !== 'undefined') window.addEventListener('pagehide', () => { if (run && run.save) run.save(); });

/* ---------------- actions ---------------- */

actions.startWorkout = (opts = {}) => {
  if (run) { toast('A workout is already in progress'); return; }
  const plan = resolvePlan(opts);
  if (!plan.segs.length) { toast('This workout has no intervals yet'); return; }
  openPreRun(plan);
};

actions.resumeWorkout = (snap) => {
  if (run) return;
  snap = snap || loadRunSnapshot();
  if (!snap || !snap.engine || !Array.isArray(snap.segs) || !snap.segs.length || snap.engine.finished) {
    clearRunSnapshot();
    toast('That workout couldn’t be restored');
    return;
  }
  const free = !!snap.free || snap.workoutId === FREE_WALK_ID;
  const plan = {
    segs: snap.segs, name: snap.name || (free ? 'Just walk' : 'Workout'), context: snap.context || '', workoutId: snap.workoutId || null,
    slotKey: snap.slotKey || null, level: snap.level ?? 0, length: snap.length ?? null, lock: null,
    surface: SURFACES[snap.surface] ? snap.surface : usualSurface(), // runs saved before surfaces existed: the usual one
    free,
  };
  run = createRun(plan, snap);
};

export default { name: 'player' };
