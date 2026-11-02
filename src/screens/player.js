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
import { MODES, getWorkout, segmentsFor, planSlots, planStats, phaseForWeek, bodyKg, speedFor, lockReason, mainMode } from '../core/program.js';
import { roundKcal, KMH_PER_MPH } from '../core/science.js';
import { clock, toSpeed, speedUnit, speedStr, distStr, distUnit, toElev, elevUnit, fmt1, esc, isMph } from '../core/format.js';
import { env, features, haptic, keepAwake, speak, stopSpeaking, unlockAudio, beep, notificationPermission, requestNotifications, scheduleCues, cancelCues, onAppState, statusBar } from '../core/platform.js';
import { actions } from '../ui/actions.js';
import { icon, modeIcon, sheet, confirmSheet, toast, topo, RM } from '../ui/kit.js';
import { intervalChart, modeLegend } from '../ui/charts.js';

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

function loadRunSnapshot() { try { return JSON.parse(localStorage.getItem(RUN_KEY) || 'null'); } catch { return null; } }
function clearRunSnapshot() { try { localStorage.removeItem(RUN_KEY); } catch { /* storage blocked */ } }

/* ---------------- resolve what to run ---------------- */

function resolvePlan(opts = {}) {
  const p = prof(), t = p.treadmill;
  const slot = opts.slotKey ? planSlots().find((s) => s.key === opts.slotKey) || null : null;
  const workoutId = opts.workoutId || (slot && slot.workoutId) || null;
  const w = workoutId ? getWorkout(workoutId) : null;
  const level = opts.level ?? (slot ? slot.level : 0);
  const length = opts.length ?? (slot ? slot.length : p.sessionLength || 45);
  let segs = Array.isArray(opts.segs) && opts.segs.length ? opts.segs : w ? segmentsFor(workoutId, { level, length }) : [];
  // Defensive copy + treadmill limits (segmentsFor already clamps; raw drafts may not).
  const maxI = t.hasIncline ? t.maxIncline ?? 15 : 0;
  segs = segs.filter((s) => s && s.dur > 0 && MODES[s.type]).map((s) => ({ ...s, role: s.role || 'work', dur: Math.round(s.dur), incline: Math.max(0, Math.min(maxI, +s.incline || 0)) }));
  let context = '';
  if (slot) context = `Week ${slot.week} · ${phaseForWeek(slot.week).name}${slot.deload ? ' · lighter week' : ''}`;
  else if (w && w.custom) context = 'Your workout';
  else if (w) context = w.focus || '';
  return {
    segs, context, workoutId, level, length,
    name: opts.name || (w && w.name) || 'Workout',
    slotKey: slot ? slot.key : opts.slotKey || null,
    lock: w && !w.custom ? lockReason(workoutId) : null,
  };
}

/* ---------------- steep-session notice (Achilles or calf answer, spec 3.6) ---------------- */

/** Sessions that reach this incline (%) get a reminder for users who reported an Achilles or calf problem. */
export const STEEP_INCLINE = 10;
/** The incline the pre-run sheet can cap a steep session at, for today only. */
export const STEEP_CAP = 8;
const maxIncline = (segs) => Math.max(0, ...(segs || []).map((s) => +s.incline || 0));

/** True when the user reported an Achilles or calf problem and these intervals climb to 10% or more. */
export function needsSteepNotice(segs) {
  const r = state.main.readiness || {};
  return !!r.achilles && !!prof().treadmill.hasIncline && maxIncline(segs) >= STEEP_INCLINE - 1e-6;
}

/** Warn banner for steep sessions (empty string when not needed). `action` is extra HTML placed inside the banner body. */
export function steepNoticeHtml(segs, { action = '' } = {}) {
  if (!needsSteepNotice(segs)) return '';
  return `<div class="banner warn steep-notice" role="note"><span class="banner-icon">${icon('incline')}</span><div class="banner-body"><b>Steep session: up to ${incShort(maxIncline(segs))} incline</b>You mentioned an Achilles or calf problem. Steep climbs load your calves and Achilles tendons, so build up slowly, and lower the incline if the back of your heel or calf hurts.${action}</div></div>`;
}

/* ---------------- pre-run sheet ---------------- */

function cueStatusHtml(kind) {
  const p = prof();
  const voiceOff = !p.cues.voice;
  const extra = voiceOff ? '<span class="pr-cue-extra">Voice cues are off in settings. Beeps and the on-screen countdown still guide you.</span>' : '';
  if (kind === 'loading') return `<span class="banner-icon">${icon('bell')}</span><div class="banner-body"><b>Checking cue settings</b>${extra}</div>`;
  if (kind === 'granted') return `<span class="banner-icon">${icon('bell')}</span><div class="banner-body"><b>Lock-screen cues are on</b>If your phone locks, interval changes arrive as notifications with a vibration.${extra}</div>`;
  if (kind === 'prompt') return `<span class="banner-icon">${icon('voice')}</span><div class="banner-body"><b>Keep the screen on</b>Voice cues stop if your phone locks. Allow lock-screen cues to get each interval change as a notification with a vibration.${extra}<button class="btn btn-sm btn-ghost pr-allow" type="button" data-act="allow-cues">${icon('bell')}Allow lock-screen cues</button></div>`;
  if (kind === 'denied') return `<span class="banner-icon">${icon('voice')}</span><div class="banner-body"><b>Keep the screen on</b>Voice cues stop if your phone locks, and notifications for Hillpace are off, so interval changes won’t reach the lock screen.${extra}</div>`;
  return `<span class="banner-icon">${icon('voice')}</span><div class="banner-body"><b>Keep this page open</b>Voice cues and beeps stop if the screen locks or you switch to another app.${extra}</div>`;
}

function openPreRun(plan) {
  const p = prof();
  const mm = mainMode(plan.segs);
  const nn = p.noNumbers;
  const hf = p.treadmill.handsFree !== false;
  const tips = [
    ['shield', 'Clip the safety key to your clothing before you start the belt.'],
    ['stride', 'Start the belt while standing on the side rails, then step on at a slow speed.'],
    ['hand', hf ? 'You walk hands-free, so keep your hands off the rails. Holding on makes the climb easier than the plan intends.' : 'Use the rails lightly, for balance only. Leaning on them makes the climb easier than the plan intends.'],
    ['speed', 'Slow the belt before stepping off.'],
  ];
  const fullSegs = plan.segs; // before any "cap incline today" choice
  let cueKind = env === 'ios' ? 'loading' : 'web';
  const steepHtml = () => {
    if (plan.inclineCap) {
      return `<div class="banner good steep-notice" role="note"><span class="banner-icon">${icon('check')}</span><div class="banner-body"><b>Incline capped at ${STEEP_CAP}% today</b>Every climb above ${STEEP_CAP}% runs at ${STEEP_CAP}% this time. Your plan doesn’t change.<button type="button" class="btn btn-sm btn-ghost pr-cap" data-act="uncap">Use the full incline</button></div></div>`;
    }
    return steepNoticeHtml(plan.segs, { action: `<button type="button" class="btn btn-sm btn-ghost pr-cap" data-act="cap">${icon('incline')}Cap incline at ${STEEP_CAP}% today</button>` });
  };
  const bodyHtml = () => {
    const st = planStats(plan.segs);
    const stats = [
      ['Time', `${Math.round(st.sec / 60)}<small>min</small>`],
      p.treadmill.hasIncline ? ['Incline', `${fmt1(st.maxI)}<small>% max</small>`] : ['Top speed', `${speedStr(st.maxS)}<small>${esc(speedUnit())}</small>`],
      nn ? ['Distance', `${distStr(st.km)}<small>${esc(distUnit())}</small>`] : ['Active', `≈${roundKcal(st.kcal)}<small>kcal</small>`],
    ];
    return `
    ${plan.context ? `<p class="eyebrow pr-context">${esc(plan.context)}</p>` : ''}
    ${plan.lock ? `<div class="banner warn"><span class="banner-icon">${icon('lock')}</span><div class="banner-body"><b>Not available yet</b>${esc(plan.lock)}</div></div>` : steepHtml()}
    <div class="card pr-card">
      <div class="stat-grid" style="--cols:3">${stats.map(([l, v]) => `<div><span class="stat-label">${l}</span><span class="stat-value">${v}</span></div>`).join('')}</div>
      <div class="pr-chart">${intervalChart(plan.segs, { h: 84, label: `${plan.name} profile: bars show speed, the line shows incline` })}</div>
      ${modeLegend(plan.segs, MODES)}
      ${nn ? '' : '<p class="body-xs">Calories are estimates of active energy, based on your weight, speed and incline.</p>'}
    </div>
    <section class="stack-s">
      <h3 class="title-s">Before you step on</h3>
      <div class="group pr-tips">${tips.map(([ic, t]) => `<div class="row has-icon pr-tip"><span class="row-icon">${icon(ic)}</span><span class="row-main"><span class="pr-tip-text">${esc(t)}</span></span></div>`).join('')}</div>
    </section>
    <div class="banner pr-cues" data-el="cues" aria-live="polite">${cueStatusHtml(cueKind)}</div>
    <div class="group"><button type="button" class="row has-icon" data-act="stop-signs"><span class="row-icon">${icon('alert')}</span><span class="row-main"><span class="row-title">Stop signs</span><span class="row-sub">Know when to stop and what to do</span></span>${icon('chevR', 'chev')}</button></div>`;
  };
  const footer = `<button type="button" class="btn btn-mode btn-lg btn-block mode-${mm}" data-act="start" ${plan.lock ? 'disabled aria-disabled="true"' : ''}>${icon('play')}Start workout</button>`;
  const sh = sheet(bodyHtml(), { title: plan.name, footer, label: `Start ${plan.name}` });
  sh.el.classList.add('pr-sheet');

  const setCues = (kind) => {
    cueKind = kind;
    const cuesEl = sh.el.querySelector('[data-el="cues"]');
    if (cuesEl && cuesEl.isConnected) cuesEl.innerHTML = cueStatusHtml(kind);
  };
  /** Re-render the body after the incline cap changes, keeping the scroll position and moving focus to the new choice. */
  const repaint = (focusAct) => {
    const y = sh.body.scrollTop;
    sh.body.innerHTML = bodyHtml();
    sh.body.scrollTop = y;
    const f = sh.body.querySelector(`[data-act="${focusAct}"]`);
    try { f && f.focus({ preventScroll: true }); } catch { /* ignore */ }
  };
  if (env === 'ios') {
    notificationPermission().then((perm) => setCues(perm === 'granted' ? 'granted' : perm === 'prompt' ? 'prompt' : 'denied'));
  }
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
      plan.segs = fullSegs.map((s) => ({ ...s, incline: Math.min(s.incline, STEEP_CAP) }));
      plan.inclineCap = STEEP_CAP;
      haptic('selection');
      repaint('uncap');
      return;
    }
    if (act === 'uncap') {
      plan.segs = fullSegs;
      plan.inclineCap = null;
      haptic('selection');
      repaint('cap');
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
  const segs = (snap ? snap.segs : plan.segs).map((s) => ({ ...s }));
  const engine = createEngine(segs, {
    kg: (snap && snap.engine && snap.engine.kg) || bodyKg(),
    nudge: (snap && snap.engine && snap.engine.nudge) || 0,
    handsFree: p.treadmill.handsFree !== false,
  });
  if (snap) {
    const wasRunning = !!snap.engine.running;
    engine.restore(snap.engine); engine.running = false;
    // The app closed mid-run: count the gap from the last saved moment as a pause (Apple Health pause times).
    const from = snap.engine.last || snap.savedAt;
    if (wasRunning && Number.isFinite(from) && !engine.finished) engine.pauseLog.push({ start: new Date(from).toISOString(), end: null });
  }

  const R = {
    plan, segs, engine,
    phase: snap ? 'paused' : 'ready', // ready | running | paused | resuming | done
    muted: !!(snap && snap.muted),
    shownIdx: null, fromIdx: -1,
    unwell: false, changedAway: false,
    lastSave: 0, lastSplit: Math.floor((engine.total || 0) / 300),
    raf: 0, timer: 0, sleepT: 0, countT: 0, holdT: 0,
    pauseSheet: null, text: {},
  };

  /* ---------- DOM ---------- */
  const root = document.createElement('div');
  root.className = `overlay player mode-${(engine.current() || segs[0]).type}`;
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-modal', 'true');
  root.setAttribute('aria-label', `${plan.name} workout`);
  const unit = speedUnit();
  // live stats: distance, ≈ kcal (unless "no numbers"), climb (if the treadmill inclines), then interval count to fill
  const liveStats = [`<div><b><span class="num" data-el="dist">0.00</span><small>${esc(distUnit())}</small></b><span>Distance</span></div>`];
  if (!p.noNumbers) liveStats.push('<div><b>≈<span class="num" data-el="kcal">0</span><small>kcal</small></b><span>Active (estimate)</span></div>');
  if (p.treadmill.hasIncline) liveStats.push(`<div><b><span class="num" data-el="elev">0</span><small>${esc(elevUnit())}</small></b><span>Climbed</span></div>`);
  if (liveStats.length < 3) liveStats.push(`<div><b><span class="num" data-el="ivl">1</span><small>of ${segs.length}</small></b><span>Interval</span></div>`);
  root.innerHTML = `
    <div class="pl-topo" aria-hidden="true">${topo({ w: 420, h: 260, seed: 11, lines: 15, cx: 0.86, cy: 0.06 })}</div>
    <div class="pl-wrap">
      <header class="pl-top">
        <button type="button" class="pl-end" data-act="end" aria-label="End workout. Press and hold for one second."><span class="pl-end-fill" aria-hidden="true"></span>${icon('stop')}<span>End</span></button>
        <div class="pl-title"><b>${esc(plan.name)}</b>${plan.context ? `<span>${esc(plan.context)}</span>` : ''}</div>
        <button type="button" class="icon-btn pl-sound" data-act="sound"></button>
      </header>

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

      <section class="pl-panel${p.treadmill.hasIncline ? '' : ' pl-single'}" data-el="panel" aria-label="Set your treadmill">
        <div class="pl-row">
          <div class="pl-meta">
            <span class="pl-lbl">Speed<i class="pl-unit">${esc(unit)}</i></span>
            <span class="pl-chips"><span class="pl-chg" data-el="dSpeed"></span></span>
          </div>
          <div class="pl-num display-num" data-el="speed" aria-hidden="true"></div>
        </div>
        <div class="pl-row" data-el="incRow" ${p.treadmill.hasIncline ? '' : 'hidden'}>
          <div class="pl-meta">
            <span class="pl-lbl">Incline<i class="pl-unit">%</i></span>
            <span class="pl-chips"><span class="pl-chg" data-el="dIncline"></span></span>
          </div>
          <div class="pl-num display-num" data-el="incline" aria-hidden="true"></div>
        </div>
      </section>

      <section class="pl-count">
        <div class="pl-count-main">
          <p class="pl-count-lbl" data-el="countLbl"></p>
          <p class="pl-count-num display-num" data-el="count" role="timer" aria-live="off">0:00</p>
        </div>
        <div class="pl-adjust">
          <button type="button" class="btn pl-extend" data-act="extend" aria-label="Add 30 seconds to this interval">+30 s</button>
          <div class="pl-nudge" role="group" aria-label="Adjust speed for all intervals">
            <button type="button" data-act="nudge-down" aria-label="Lower speed by 0.1 ${esc(unit)}">${icon('minus')}</button>
            <span class="pl-nudge-lbl" data-el="adj">Speed</span>
            <button type="button" data-act="nudge-up" aria-label="Raise speed by 0.1 ${esc(unit)}">${icon('plus')}</button>
          </div>
        </div>
      </section>
      <div class="pl-bar" aria-hidden="true"><i data-el="bar"></i><b data-el="ticks"></b></div>

      <div class="pl-next" data-el="next"></div>

      <div class="pl-live">${liveStats.join('')}</div>

      <div class="pl-controls">
        <button type="button" class="pl-ctl" data-act="back" aria-label="Back: restart this interval, or go to the previous one"><span class="pl-ctl-c">${icon('prev')}</span><span>Back</span></button>
        <button type="button" class="pl-pause" data-act="pause" data-el="pause"></button>
        <button type="button" class="pl-ctl" data-act="skip" aria-label="Skip to the next interval"><span class="pl-ctl-c">${icon('next')}</span><span>Skip</span></button>
      </div>
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
  const tlSegs = Array.from(el.tl.querySelectorAll('.pl-tl-seg'));
  document.body.appendChild(root);
  document.body.classList.add('immersive');
  statusBar(isDarkTheme() ? 'light' : 'dark');

  /* ---------- text helpers ---------- */
  const setText = (key, node, v) => { if (R.text[key] !== v) { R.text[key] = v; node.textContent = v; } };
  const announce = (msg) => { el.live.textContent = ''; setTimeout(() => { el.live.textContent = msg; }, 30); };

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
    const v = engine.speed(s), nv = engine.speed(n);
    const dv = Math.abs(nv - v) >= 0.05, di = Math.abs((n.incline || 0) - (s.incline || 0)) >= 0.25, dm = n.type !== s.type;
    const pre = `In ${secs} seconds: `;
    if (!dv && !di) return dm ? `${pre}${modeSay(n.type)}, same speed and incline.` : '';
    if (!dv && !dm) return `${pre}incline to ${sayNum(n.incline)} percent.`;
    const parts = [modeSay(n.type)];
    if (dv) parts.push(`${sayNum(toSpeed(nv))} ${speedWords()}`);
    if (di) parts.push(dv ? `incline ${sayNum(n.incline)} percent` : `incline to ${sayNum(n.incline)} percent`);
    return pre + parts.join(', ') + '.';
  }
  function fullDesc(s) {
    const lbl = s.label && !/^(Recover|Easy walk|Brisk walk|Power walk|Jog|Run)$/i.test(s.label) ? `${s.label}. ` : '';
    const inc = prof().treadmill.hasIncline ? `, incline ${sayNum(s.incline)} percent` : '';
    return `${lbl}${modeName(s.type)}, ${sayNum(toSpeed(engine.speed(s)))} ${speedWords()}${inc}.`;
  }
  function announceT0(idx) {
    const s = segs[idx], prev = R.fromIdx >= 0 && R.fromIdx !== idx ? segs[R.fromIdx] : null;
    tone('go'); haptic('medium');
    const parts = [];
    if (!prev) parts.push(fullDesc(s));
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
    if (!engine.running || engine.finished) return;
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
    const k = Math.floor(engine.total / 300);
    if (k <= R.lastSplit) return;
    R.lastSplit = k;
    if ((+prof().cues.detail || 2) >= 3 && engine.planRemaining() > 45) {
      cue(`${k * 5} minutes done. ${Math.round(engine.planRemaining() / 60)} minutes to go.`, { low: true });
    }
  }

  /* ---------- lock-screen notifications ---------- */
  function schedule() {
    if (!features.lockScreenCues || !engine.running || engine.finished) return;
    const unitTxt = speedUnit(), hasInc = prof().treadmill.hasIncline;
    const list = engine.upcoming().map((b) => {
      if (b.finish || !b.seg) return { at: b.at, title: 'Workout complete', body: 'Open Hillpace to see your summary.' };
      const { n, N } = modeOrdinal(segs, b.index);
      return { at: b.at, title: `Next: ${modeName(b.seg.type)} (${n} of ${N})`, body: `${speedStr(engine.speed(b.seg))} ${unitTxt}${hasInc ? ` · ${incShort(b.seg.incline)}` : ''}` };
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
        level: plan.level, length: plan.length, context: plan.context, muted: R.muted, savedAt: Date.now(),
      }));
    } catch { /* storage full or blocked: the run still works */ }
  }

  /* ---------- rendering ---------- */
  function layoutTimeline() {
    const total = engine.planTotal || 1;
    let t = 0;
    const hasInc = prof().treadmill.hasIncline;
    const maxI = Math.max(6, ...segs.map((s) => s.incline || 0));
    segs.forEach((s, i) => {
      const n = tlSegs[i];
      n.style.left = (t / total) * 100 + '%';
      n.style.width = `max(1.5px, calc(${(s.dur / total) * 100}% - 2px))`;
      n.style.height = hasInc ? 22 + ((s.incline || 0) / maxI) * 78 + '%' : 60 + '%';
      t += s.dur;
    });
  }
  function fitNumber(node) {
    node.style.fontSize = '';
    const max = node.clientWidth;
    let size = parseFloat(getComputedStyle(node).fontSize);
    let guard = 12;
    while (node.scrollWidth > max + 1 && size > 84 && guard--) { size -= 6; node.style.fontSize = size + 'px'; }
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
    el.pause.setAttribute('aria-label', paused ? 'Resume workout' : 'Pause workout');
    root.classList.toggle('is-paused', paused && R.phase === 'paused');
  }
  function renderSegment() {
    const s = engine.current();
    if (!s) return;
    const idx = engine.idx, last = idx === segs.length - 1;
    root.className = root.className.replace(/\bmode-\w+/, 'mode-' + s.type);
    const lbl = s.label || modeName(s.type), long = lbl.length > 14;
    // long labels ("Circuit 2 · Steep climb") get the short mode name so both fit on one line
    el.chip.innerHTML = long
      ? `${modeIcon(s.type)}<span aria-hidden="true">${esc((MODES[s.type] || MODES.walk).short)}</span><span class="sr-only">${esc(modeName(s.type))}</span>`
      : `${modeIcon(s.type)}${esc(modeName(s.type))}`;
    el.label.textContent = lbl;
    el.label.classList.toggle('long', long);
    const v = engine.speed(s);
    el.speed.textContent = speedStr(v);
    el.incline.textContent = fmt1(s.incline);
    const prev = R.fromIdx >= 0 && R.fromIdx !== idx ? segs[R.fromIdx] : idx > 0 ? segs[idx - 1] : null;
    el.dSpeed.innerHTML = prev ? chipHtml(toSpeed(v) - toSpeed(engine.speed(prev)), true) : '';
    el.dIncline.innerHTML = prev ? chipHtml((s.incline || 0) - (prev.incline || 0), false) : '';
    el.dSpeed.setAttribute('aria-hidden', 'true'); el.dIncline.setAttribute('aria-hidden', 'true');
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
    setText('countLbl', el.countLbl, !engine.running && R.phase === 'paused' ? 'Paused' : last ? 'Workout ends in' : `${modeName(s.type)} ends in`);
    // 30-second ticks on the interval bar (60 s for very long intervals)
    const tick = s.dur > 900 ? 60 : 30;
    el.ticks.hidden = s.dur <= tick;
    el.ticks.style.setProperty('--tick', ((tick / s.dur) * 100).toFixed(4) + '%');
    // next up
    const n = engine.next();
    if (n) {
      el.next.innerHTML = `<span class="pl-next-ico mode-${n.type}">${modeIcon(n.type)}</span>
        <span class="pl-next-txt"><small>Next · ${esc(durShort(n.dur))}</small><b><em class="mode-${n.type}">${esc(modeName(n.type))}</em> ${speedStr(engine.speed(n))} ${esc(speedUnit())}${prof().treadmill.hasIncline ? ` · ${incShort(n.incline)}` : ''}</b></span>
        <span class="pl-next-in"><small>in</small><b class="num" data-el="nextIn"></b></span>`;
    } else {
      el.next.innerHTML = `<span class="pl-next-ico pl-next-fin">${icon('flag')}</span>
        <span class="pl-next-txt"><small>Then</small><b>Workout complete</b></span>
        <span class="pl-next-in"><small>in</small><b class="num" data-el="nextIn"></b></span>`;
    }
    el.nextIn = el.next.querySelector('[data-el="nextIn"]');
    R.text.nextIn = null;
    tlSegs.forEach((node, i) => { node.classList.toggle('past', i < idx); node.classList.toggle('cur', i === idx); });
    el.panel.setAttribute('aria-label', `Set your treadmill: ${speedStr(v)} ${speedUnit()}${prof().treadmill.hasIncline ? `, incline ${fmt1(s.incline)} percent` : ''}`);
    fitNumber(el.speed); fitNumber(el.incline);
    renderPauseBtn();
    renderTick();
  }
  function renderTick() {
    const e = engine, s = e.current();
    setText('elapsed', el.elapsed, clock(Math.floor(e.total)));
    setText('left', el.left, clock(Math.ceil(e.planRemaining() - 1e-6)));
    if (s) {
      const rem = Math.ceil(e.segRemaining() - 1e-6);
      setText('count', el.count, clock(rem));
      if (el.nextIn) setText('nextIn', el.nextIn, clock(rem));
      el.bar.style.width = Math.min(100, (e.segEl / s.dur) * 100).toFixed(2) + '%';
    }
    el.head.style.left = (e.progress() * 100).toFixed(3) + '%';
    setText('dist', el.dist, distStr(e.km));
    if (el.kcal) setText('kcal', el.kcal, String(roundKcal(e.kcal)));
    if (el.ivl) setText('ivl', el.ivl, String(Math.min(segs.length, e.idx + 1)));
    if (el.elev) setText('elev', el.elev, String(Math.round(toElev(e.elev))));
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
    announce(`${modeName(segs[idx].type)}, ${segs[idx].label || ''}. ${speedStr(engine.speed())} ${speedUnit()}${prof().treadmill.hasIncline ? `, incline ${fmt1(segs[idx].incline)} percent` : ''}. ${clock(engine.segRemaining())} to next change.`);
    if (info.catchUp) { R.changedAway = true; return; }
    if (R.phase === 'running') announceT0(idx);
    save();
  });
  engine.on('countdown', () => { if (R.phase === 'running') { tone('tick'); haptic('light'); } });
  engine.on('milestone', (k) => {
    if ((+prof().cues.detail || 2) < 2) return;
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
    const inc = prof().treadmill.hasIncline ? ` · ${fmt1(s.incline)} %` : '';
    return `<span class="mode-${s.type}"><i class="mode-dot"></i></span><span>First: <b>${esc(modeName(s.type))}</b> ${speedStr(engine.speed(s))} ${esc(speedUnit())}${inc}</span>`;
  }

  /* ---------- actions ---------- */
  R.getReady = () => {
    R.phase = 'ready';
    renderSegment();
    if (!R.muted) speak('Get ready.', { interrupt: true });
    countdown(5, {
      title: 'Get ready',
      first: firstLine(segs[0]),
      tip: 'Stand on the side rails, start the belt slowly, then step on.',
      onDone: () => {
        R.phase = 'running';
        engine.start(); // emits segment 0 → go beep + full first-interval announcement
        keepAwake(true);
        schedule();
        startLoop();
        save();
        try { el.pause.focus({ preventScroll: true }); } catch { /* ignore */ }
      },
      onCancel: () => { stopSpeaking(); close(); },
    });
  };

  function pause({ showSheet = true } = {}) {
    if (!engine.running || engine.finished) return;
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
        const s = engine.current();
        tone('go'); haptic('medium');
        cue(`${modeName(s.type)}. ${fmt1(toSpeed(engine.speed(s)))}.`);
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
    const s = sheet(`
      <p class="pl-ps-time"><span><b class="num">${clock(Math.floor(e.total))}</b> done</span><span><b class="num">${clock(Math.ceil(e.planRemaining()))}</b> left</span></p>
      <div class="banner warn"><span class="banner-icon">${icon('alert')}</span><div class="banner-body"><b>Slow the belt before stepping off</b>Step onto the side rails once it has slowed right down.</div></div>
      <div class="stack pl-ps-actions">
        <button type="button" class="btn btn-primary btn-lg btn-block" data-ps="resume" autofocus>${icon('play')}Resume</button>
        <button type="button" class="btn btn-lg btn-block" data-ps="end">${icon('stop')}End workout</button>
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
    engine.end(); // emits 'finish'(false)
  }
  function skip() {
    if (engine.finished || R.phase === 'ready' || R.phase === 'resuming') return;
    haptic('light');
    engine.skip();
    if (!engine.finished) { schedule(); save(); }
  }
  function back() {
    if (engine.finished || R.phase === 'ready' || R.phase === 'resuming') return;
    haptic('light');
    engine.back();
    schedule(); save();
  }
  function extend() {
    if (engine.finished || R.phase === 'ready' || R.phase === 'resuming') return;
    engine.extend(30);
    haptic('light');
    toast('Added 30 s to this interval');
    schedule(); save();
  }
  function nudge(dir) {
    const s = engine.current();
    if (!s || engine.finished) return;
    const target = Math.round((engine.nudge + dir * nudgeStep()) * 100) / 100;
    const cur = engine.speed(s), next = speedFor(s, target);
    if (dir > 0 && next <= cur + 1e-6) { toast(`That’s your treadmill’s top speed (${speedStr(prof().treadmill.maxSpeed || 20)} ${speedUnit()})`); return; }
    if (Math.abs(target) > 3.001 || (dir < 0 && next >= cur - 1e-6)) return;
    engine.setNudge(target); // emits nudge → renderSegment
    haptic('selection');
    announce(`Speed ${speedStr(engine.speed())} ${speedUnit()}. All intervals adjusted.`);
    schedule(); save();
  }
  function toggleSound() {
    const c = prof().cues;
    if (!c.voice && !c.beeps) { toast('Voice and beeps are off. Turn them on in Me → Voice and cues.'); return; }
    R.muted = !R.muted;
    if (R.muted) stopSpeaking();
    renderSound();
    toast(R.muted ? 'Voice and beeps off for this workout' : 'Voice and beeps on');
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
    const b = ev.target.closest('[data-act]');
    if (!b || b.disabled) return;
    switch (b.dataset.act) {
      case 'pause': togglePause(); break;
      case 'skip': skip(); break;
      case 'back': back(); break;
      case 'extend': extend(); break;
      case 'nudge-up': nudge(1); break;
      case 'nudge-down': nudge(-1); break;
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
    if (!active) { R.idxAtHide = engine.idx; R.changedAway = false; save(); return; }
    if (!engine.running || engine.finished) { renderTick(); return; }
    // The fallback timer may already have caught up before this event arrives, so compare with the
    // interval at the moment we went to the background rather than just before this tick.
    const prevIdx = R.idxAtHide != null ? R.idxAtHide : engine.idx;
    R.idxAtHide = null;
    engine.tick();
    if (engine.finished) return;
    const moved = R.changedAway || engine.idx !== prevIdx;
    R.changedAway = false;
    if (moved) {
      const s = engine.current(), { n, N } = modeOrdinal(segs, engine.idx);
      cue(`You're in ${modeSay(s.type)} ${n} of ${N}, ${spokenTime(engine.segRemaining())} left.`);
      if (engine.segRemaining() <= (+prof().cues.lead || 10)) engine.marks['L' + engine.idx] = 1;
      cancelCues().then(() => schedule()); // clears delivered notifications, then re-plans the rest
    }
    if (!R.raf) startLoop();
    save();
  };

  /* ---------- finish ---------- */
  // Share of the plan actually walked. e.total counts active seconds only, so skipped time never counts.
  const completionNow = () => engine.completion();
  // "Complete" means the plan was walked (98%+), not just that the last interval ran out after skips.
  const isComplete = () => completionNow() >= COMPLETE_AT;

  function onFinish(natural) {
    stopLoop();
    clearTimeout(R.sleepT);
    clearTimeout(R.holdT);
    cancelCues();
    keepAwake(false);
    if (R.pauseSheet) { R.pauseSheet.close(); R.pauseSheet = null; }
    R.phase = 'done';
    renderTick();
    if (natural && !R.unwell) {
      tone('done');
      if (isComplete()) { haptic('success'); cue('Workout complete.'); } else cue('Workout ended.');
    } else stopSpeaking();
    finalize();
  }

  function buildSession() {
    const e = engine;
    const planned = Math.round(e.planTotal);
    const completion = completionNow();
    const hours = e.total / 3600;
    // Net kcal = (METs − 1) × 3.5 ml/kg/min × kg × 5 kcal/L → kcal/(kg·h) = (METs − 1) × 1.05
    const avgMETs = hours > 0 && e.kg > 0 ? Math.round((1 + e.kcal / (e.kg * hours * 1.05)) * 10) / 10 : null;
    return {
      id: store.uid(),
      date: e.startedAt || new Date().toISOString(),
      endedAt: e.endedAt || new Date().toISOString(),
      workoutId: plan.workoutId || null,
      name: plan.name,
      planSlot: plan.slotKey || null,
      level: plan.level ?? null,
      length: plan.length ?? null,
      durationSec: Math.round(e.total),
      plannedSec: planned,
      completion,
      completed: completion >= COMPLETE_AT,
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
    if (R.unwell) {
      // Safety first: no questions. Keep anything worth keeping, then show the stop signs.
      const keep = engine.total >= 60;
      if (keep) { const s = buildSession(); store.addSession(s); store.update((m) => { if (s.workoutId) m.lastWorkoutId = s.workoutId; }); }
      clearRunSnapshot();
      close();
      if (keep) toast('Workout saved. Rest, and get help if symptoms don’t settle.', { ms: 4200 });
      actions.openStopSigns();
      return;
    }
    if (engine.total < 60) {
      const discard = await confirmSheet({
        title: 'Discard this workout?',
        body: 'It lasted less than a minute, so there is little to save. Discarded workouts don’t count toward your plan or totals.',
        confirm: 'Discard', cancel: 'Save anyway', danger: true,
      });
      if (discard) {
        clearRunSnapshot();
        close();
        toast('Workout discarded');
        return;
      }
    }
    const s = buildSession();
    store.addSession(s);
    store.update((m) => { if (s.workoutId) m.lastWorkoutId = s.workoutId; });
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
    el.speed.style.fontSize = ''; el.incline.style.fontSize = ''; // measure at the tier's own size, not a fitNumber shrink
    const fits = () => root.scrollHeight <= root.clientHeight + 1;
    for (const tier of FIT_TIERS) {
      if (fits()) return;
      root.classList.add(tier);
      // +30 s and the speed nudge share one row once space is short, if the screen is wide enough for both and the timer
      if (tier === 'pl-dense' && root.clientWidth >= 360) root.classList.add('pl-adjrow');
    }
    if (!fits()) root.classList.add('pl-scroll');
  }
  const onResize = () => { fitLayout(); fitNumber(el.speed); fitNumber(el.incline); };
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
  const plan = {
    segs: snap.segs, name: snap.name || 'Workout', context: snap.context || '', workoutId: snap.workoutId || null,
    slotKey: snap.slotKey || null, level: snap.level ?? 0, length: snap.length ?? null, lock: null,
  };
  run = createRun(plan, snap);
};

export default { name: 'player' };
