// Workout engine: a wall-clock-based interval state machine with no DOM.
// It survives the app being suspended (iOS locks the screen): on resume, tick() catches up through any intervals
// that elapsed, accumulating distance/energy correctly, and emits only the latest interval change.
import { speedFor } from './program.js';
import { activeKcalPerMin, isVigorous } from './science.js';

/** A session counts as completed only when at least this share of the planned time was actually walked. */
export const COMPLETE_AT = 0.98;

export function createEngine(segs, { kg = 75, nudge = 0, handsFree = true, open = false, now = () => Date.now() } = {}) {
  // open: an open-ended walk ("Just walk"). The last interval keeps extending; it ends only when the user ends it.
  const handlers = {};
  const planTotal = segs.reduce((a, s) => a + s.dur, 0);
  const e = {
    open: !!open,
    segs,
    planTotal,
    idx: 0,
    segEl: 0, // seconds into current interval
    total: 0, // active seconds (excludes pauses)
    running: false,
    finished: false,
    km: 0,
    kcal: 0,
    elev: 0,
    nudge,
    kg,
    startedAt: null, // ISO
    endedAt: null,
    last: null, // ms timestamp of last tick while running
    marks: {}, // fired one-shot events
    pauses: 0,
    pauseLog: [], // wall-clock pauses [{start, end}] (ISO; end null while paused), for Apple Health
    splits: [], // per-interval actual {idx, sec, km, kcal}
  };

  const emit = (ev, ...a) => (handlers[ev] || []).forEach((fn) => { try { fn(...a); } catch (err) { console.error(err); } });
  e.on = (ev, fn) => { (handlers[ev] = handlers[ev] || []).push(fn); return e; };

  e.current = () => segs[e.idx] || null;
  e.next = () => segs[e.idx + 1] || null;
  e.speed = (s = e.current()) => (s ? speedFor(s, e.nudge) : 0);
  e.segRemaining = () => { const s = e.current(); return s ? Math.max(0, s.dur - e.segEl) : 0; };
  e.planElapsed = () => segs.slice(0, e.idx).reduce((a, s) => a + s.dur, 0) + e.segEl;
  e.planRemaining = () => Math.max(0, e.planTotal - e.planElapsed());
  e.progress = () => (e.planTotal ? Math.min(1, e.planElapsed() / e.planTotal) : 0);
  /** Share of the planned time actually walked (skipped time never counts), 0–1 to three decimals. */
  e.completion = () => (e.open ? 1 : e.planTotal ? Math.min(1, Math.round((e.total / e.planTotal) * 1000) / 1000) : 0);

  function splitFor(i) {
    let sp = e.splits.find((x) => x.idx === i);
    if (!sp) { const s = segs[i]; sp = { idx: i, type: s.type, label: s.label, incline: s.incline, speed: 0, sec: 0, km: 0, kcal: 0, vig: false }; e.splits.push(sp); }
    return sp;
  }

  /** Advance the clock by dt seconds of active time. Returns true if the interval changed. */
  function advance(dt, live) {
    let changed = false;
    while (dt > 1e-9 && e.idx < segs.length) {
      const s = segs[e.idx];
      const rem = s.dur - e.segEl;
      const step = Math.min(dt, rem);
      const v = speedFor(s, e.nudge);
      const d = (v * step) / 3600;
      const kc = (activeKcalPerMin(v, s.incline, e.kg, s.type, handsFree) * step) / 60;
      e.km += d; e.elev += (d * 1000 * s.incline) / 100; e.kcal += kc;
      const sp = splitFor(e.idx); sp.sec += step; sp.km += d; sp.kcal += kc; sp.speed = v; sp.vig = isVigorous(v, s.incline, s.type);
      const before = Math.ceil(rem - 1e-6);
      e.segEl += step; e.total += step; dt -= step;
      const left = Math.ceil(s.dur - e.segEl - 1e-6);
      // One-shot cues inside the interval (only when ticking live, not when catching up after suspension).
      if (live && e.idx < segs.length - 1) {
        if (left >= 1 && left <= 3 && left < before && !e.marks[`c${e.idx}-${left}`]) { e.marks[`c${e.idx}-${left}`] = 1; emit('countdown', left); }
        if (left <= 10 && left > 3 && !e.marks[`w${e.idx}`] && s.dur > 20) { e.marks[`w${e.idx}`] = 1; emit('warn', segs[e.idx + 1], left); }
      }
      if (e.segEl >= s.dur - 1e-6) {
        if (e.open && e.idx === segs.length - 1) { s.dur += 600; e.planTotal += 600; continue; } // open walk: keep going
        e.idx++; e.segEl = 0; changed = true;
        if (e.idx >= segs.length) { finish(true); return changed; }
      }
    }
    const done = e.planElapsed();
    if (live && !e.marks.half && done >= e.planTotal / 2) { e.marks.half = 1; emit('milestone', 'half'); }
    if (live && !e.marks.five && e.planTotal > 600 && e.planTotal - done <= 300) { e.marks.five = 1; emit('milestone', 'five'); }
    return changed;
  }

  e.tick = () => {
    if (!e.running || e.finished) return;
    const t = now();
    const dt = Math.max(0, (t - e.last) / 1000);
    e.last = t;
    const live = dt < 3; // a large gap means we were suspended
    const prevIdx = e.idx;
    const changed = advance(Math.min(dt, 6 * 3600), live);
    if (changed && !e.finished) emit('segment', e.idx, { catchUp: !live, from: prevIdx });
    emit('tick');
  };

  e.start = () => {
    if (e.startedAt) return;
    e.startedAt = new Date(now()).toISOString();
    e.running = true; e.last = now();
    emit('segment', 0, { catchUp: false, from: -1 });
    emit('state');
  };
  e.pause = () => {
    if (!e.running || e.finished) return;
    e.tick(); e.running = false; e.pauses++;
    e.pauseLog.push({ start: new Date(now()).toISOString(), end: null });
    emit('state');
  };
  /** Close the open pause (if any) at time t (ms). */
  const closePause = (t) => { const p = e.pauseLog[e.pauseLog.length - 1]; if (p && !p.end) p.end = new Date(Math.max(Date.parse(p.start) || t, t)).toISOString(); };
  e.resume = () => { if (e.running || e.finished) return; closePause(now()); e.running = true; e.last = now(); emit('state'); };
  e.toggle = () => (e.running ? e.pause() : e.resume());

  e.skip = () => {
    if (e.finished) return;
    e.tick();
    e.idx++; e.segEl = 0;
    if (e.idx >= segs.length) { finish(true); return; }
    emit('segment', e.idx, { catchUp: false, manual: true });
    emit('tick');
  };
  e.back = () => {
    if (e.finished) return;
    e.tick();
    if (e.segEl > 4 || e.idx === 0) e.segEl = 0; else { e.idx--; e.segEl = 0; }
    // allow cues to fire again for this interval
    Object.keys(e.marks).forEach((k) => { if (k.startsWith('c' + e.idx + '-') || k === 'w' + e.idx) delete e.marks[k]; });
    emit('segment', e.idx, { catchUp: false, manual: true });
    emit('tick');
  };
  /** Add seconds to the current interval (e.g. +30 s). */
  e.extend = (sec = 30) => { e.tick(); const s = segs[e.idx]; if (!s) return; s.dur += sec; e.planTotal += sec; Object.keys(e.marks).forEach((k) => { if (k.startsWith('c' + e.idx + '-') || k === 'w' + e.idx) delete e.marks[k]; }); emit('extend', sec); emit('tick'); };
  /**
   * Open walks: log what the user is doing now (pace mode, speed in km/h, incline). Splits the current interval so
   * distance and energy before the change keep their old values. patch: {type?, speed?, incline?, label?}
   */
  e.changeCurrent = (patch = {}) => {
    e.tick();
    const s = segs[e.idx];
    if (!s || e.finished) return;
    const clean = {};
    if (patch.type) clean.type = patch.type;
    if (patch.speed != null && isFinite(patch.speed)) clean.speed = Math.max(0.8, Math.min(25, +patch.speed));
    if (patch.incline != null && isFinite(patch.incline)) clean.incline = Math.max(0, Math.min(15, Math.round(patch.incline * 2) / 2));
    if (patch.label) clean.label = String(patch.label).slice(0, 40);
    if (e.segEl < 1) { Object.assign(s, clean); if (clean.type && patch.speed == null) delete s.speed; }
    else {
      const used = Math.max(1, Math.round(e.segEl));
      const rest = Math.max(60, s.dur - used);
      e.planTotal += used + rest - s.dur;
      s.dur = used;
      const next = { ...s, ...clean, dur: rest };
      if (clean.type && patch.speed == null) delete next.speed;
      delete next.add;
      segs.splice(e.idx + 1, 0, next);
      e.idx++; e.segEl = 0;
    }
    emit('segment', e.idx, { catchUp: false, manual: true, changed: true });
    emit('tick');
  };
  e.setNudge = (n) => { e.tick(); e.nudge = Math.max(-3, Math.min(3, Math.round(n * 100) / 100)); emit('nudge', e.nudge); emit('tick'); };

  function finish(completed) {
    if (e.finished) return;
    e.finished = true; e.running = false; e.completed = completed;
    e.endedAt = new Date(now()).toISOString();
    closePause(Date.parse(e.endedAt)); // ended from the pause sheet: the pause lasts until the end
    emit('finish', completed);
  }
  e.end = () => { e.tick(); finish(!!e.open); }; // ending an open walk is the normal way to finish it

  /** Upcoming interval boundaries as absolute times (ms) from now, for lock-screen notifications. */
  e.upcoming = (limit = 60) => {
    const out = [];
    let t = now() + e.segRemaining() * 1000;
    for (let i = e.idx + 1; i < segs.length && out.length < limit; i++) { out.push({ at: t, seg: segs[i], index: i }); t += segs[i].dur * 1000; }
    out.push({ at: t, seg: null, index: segs.length, finish: true });
    return out;
  };

  e.snapshot = () => JSON.parse(JSON.stringify({ ...e, segs: undefined }));
  e.restore = (snap) => { Object.assign(e, snap, { segs }); if (!Array.isArray(e.pauseLog)) e.pauseLog = []; if (e.running) e.last = now(); };

  return e;
}
