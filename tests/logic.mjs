// Logic checks for the core modules (plain Node, no browser): node tests/logic.mjs
// Each check prints PASS/FAIL; the exit code is 1 if any check fails.
// The clock is frozen per scenario so plan weeks and "today" are predictable.

/* ---------------- harness: frozen clock, storage stub, direct imports ---------------- */
const RealDate = Date;
let fixed = null;
class FrozenDate extends RealDate {
  constructor(...a) { if (a.length === 0 && fixed != null) super(fixed); else super(...a); }
  static now() { return fixed != null ? fixed : RealDate.now(); }
}
globalThis.Date = FrozenDate;
const freeze = (s) => { fixed = new RealDate(s).getTime(); };
const mem = new Map();
globalThis.localStorage = { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => mem.delete(k) };

const store = await import('../src/core/store.js');
const P = await import('../src/core/program.js');
const S = await import('../src/core/science.js');
const F = await import('../src/core/format.js');
const E = await import('../src/core/engine.js');
const { state } = store;

let failed = 0, passed = 0;
function ok(cond, msg) {
  if (cond) { passed++; if (process.env.VERBOSE) console.log(`  ok   ${msg}`); } else { failed++; console.log(`  FAIL ${msg}`); }
  return !!cond;
}
function section(name) { console.log(`\n${name}`); }

function reset({ days = [1, 3, 5, 6], start = '2026-08-17T09:00' } = {}) {
  freeze(start);
  state.main = store.defaultMain();
  state.sessions = [];
  state.main.onboarded = true;
  state.main.profile.startWeight = 85;
  state.main.plan.days = days;
  P.startPlanThisWeek(state.main.plan);
  store.setHealthWeights(null);
}
let sid = 0;
function logSession(slotKey, iso, extra = {}) {
  state.sessions.unshift({ id: 't' + (++sid), date: new Date(iso).toISOString(), planSlot: slotKey, source: 'app', completed: true, completion: 1, durationSec: 2700, rpe: 6, ...extra });
}
const metsOf = (s) => S.mets(P.speedFor(s), s.incline, s.type);
const vigorous = (s) => S.isVigorous(P.speedFor(s), s.incline, s.type);
const ALL_IDS = Object.keys(P.WORKOUTS);
const LENGTHS = [23, 30, 35, 45, 60];

/* ---------------- 1. doctor flag: light and moderate work only ---------------- */
section('Doctor flag keeps every interval moderate (< 6 METs) until the doctor check is confirmed');
for (const paces of [null, { walk: 5.2, brisk: 6.2, power: 7.2, jog: 9.5, run: 12 }]) {
  reset();
  if (paces) state.main.profile.paces = { ...state.main.profile.paces, ...paces };
  state.main.profile.canJog = 'yes';
  state.main.readiness.doctorFlag = true; state.main.readiness.doctorAck = false;
  const tag = paces ? 'fast paces' : 'default paces';
  const planSegs = P.planSlots().flatMap((s) => P.slotSegments(s));
  const top = Math.max(...planSegs.map(metsOf));
  ok(planSegs.length > 0 && top < 6, `${tag}: 12-week plan tops out at ${top.toFixed(2)} METs`);
  ok(!planSegs.some(vigorous), `${tag}: no vigorous interval in the plan`);
  ok(!planSegs.some((s) => s.type === 'jog' || s.type === 'run'), `${tag}: no jog or run intervals in the plan`);
  ok(P.planSlots().every((s) => s.level === 0), `${tag}: every plan week stays at the starting level`);
  let worst = 0, worstAt = '';
  for (const id of ALL_IDS) for (const level of [0, 1, 2]) for (const length of LENGTHS) {
    for (const s of P.segmentsFor(id, { level, length })) { const m = metsOf(s); if (m > worst) { worst = m; worstAt = `${id} L${level} ${length} min`; } }
  }
  ok(worst < 6, `${tag}: every library workout at every phase and length stays under 6 METs (max ${worst.toFixed(2)}, ${worstAt})`);
  state.main.customs = [{ id: 'c_test', name: 'Steep custom', segs: [{ type: 'run', dur: 120, incline: 12 }, { type: 'power', dur: 300, incline: 15 }] }];
  const custom = P.segmentsFor('c_test', { level: 0 });
  ok(custom.every((s) => metsOf(s) < 6 && !vigorous(s)), `${tag}: a steep custom workout is capped too (max ${Math.max(...custom.map(metsOf)).toFixed(2)} METs)`);
  ok(P.lockReason('fourx4', 6) !== null && P.lockReason('hiit', 6) !== null, `${tag}: 4×4 and Sprint Intervals stay locked`);
  state.main.readiness.doctorAck = true;
  ok(P.planSlots().some((s) => P.slotSegments(s).some(vigorous)), `${tag}: confirming the doctor check brings vigorous work back`);
}

/* ---------------- 2. restart resets the block ---------------- */
section('Restarting the plan goes back to block 1 and Foundation');
{
  reset({ start: '2026-11-04T09:00' });
  state.main.plan.block = 2;
  state.main.plan.adjust = { incline: -1, speed: -0.3 };
  ok(P.phaseForWeek(1).name === 'Burn', 'block 2 week 1 runs at Burn');
  P.startPlanThisWeek(state.main.plan); // plain restart (Plan tab and onboarding both use this)
  ok((state.main.plan.block || 1) === 1, `restart resets plan.block to 1 (got ${state.main.plan.block})`);
  ok(P.levelForWeek(1) === 0 && P.phaseForWeek(1).name === 'Foundation', `week 1 after restart: ${P.phaseForWeek(1).name}, level ${P.levelForWeek(1)}`);
  ok(state.main.plan.adjust.incline === 0 && state.main.plan.adjust.speed === 0, 'restart clears effort adjustments');
  ok(P.lockReason('fourx4', 1) !== null, '4×4 is locked again in week 1 of block 1');
}

/* ---------------- 3. skip to the end is not "completed" ---------------- */
section('Skipping to the end does not count as a completed workout');
{
  reset();
  const segs = P.segmentsFor('hills', { level: 1, length: 45 });
  let t = new RealDate('2026-08-17T09:00:00Z').getTime();
  const now = () => t;
  // a) skip every interval
  const a = E.createEngine(segs.map((s) => ({ ...s })), { now });
  a.start();
  t += 20000; a.tick();
  for (let i = 0; i < 100 && !a.finished; i++) { t += 1000; a.skip(); }
  ok(a.finished, 'engine finishes after skipping the last interval');
  ok(a.completion() < E.COMPLETE_AT, `skip-to-end completion ${a.completion()} is below ${E.COMPLETE_AT}, so the session is saved as partial`);
  ok(!P.sessionDone({ source: 'app', completed: a.completion() >= E.COMPLETE_AT, completion: a.completion() }), 'a skip-to-end session does not count toward the plan');
  // b) walk the whole plan
  const b = E.createEngine(segs.map((s) => ({ ...s })), { now });
  b.start();
  for (let i = 0; i < 4000 && !b.finished; i++) { t += 1000; b.tick(); }
  ok(b.finished && b.completion() >= E.COMPLETE_AT, `a fully walked session is complete (completion ${b.completion()})`);
  // c) skip only the warm-up: not complete, but it still counts for the week (70%+)
  const c = E.createEngine(segs.map((s) => ({ ...s })), { now });
  c.start();
  while (c.current() && c.current().role === 'warm') { t += 1000; c.skip(); }
  for (let i = 0; i < 4000 && !c.finished; i++) { t += 1000; c.tick(); }
  const cc = c.completion();
  ok(cc < E.COMPLETE_AT && cc >= 0.7, `skipping only the warm-up: completion ${cc}`);
  ok(P.sessionDone({ source: 'app', completed: cc >= E.COMPLETE_AT, completion: cc }), 'that session still counts toward the week');
  // d) pauses are logged with wall-clock times for Apple Health
  const d = E.createEngine(segs.map((s) => ({ ...s })), { now });
  d.start(); t += 60000; d.tick();
  d.pause(); t += 30000; d.resume(); t += 60000; d.tick();
  d.pause(); t += 45000; d.end();
  ok(d.pauseLog.length === 2 && d.pauseLog.every((x) => x.start && x.end && x.end > x.start), 'engine logs two closed pauses');
  ok(d.pauseLog[1].end === d.endedAt, 'a pause still open when the workout ends closes at the end time');
  ok(Math.round(d.total) === 120, `paused time is not active time (active ${Math.round(d.total)} s)`);
  const cleaned = store.cleanSession({ id: 'x1', date: d.startedAt, pauseLog: [...d.pauseLog, { start: 'nope', end: null }] });
  ok(cleaned.pauseLog.length === 2, 'cleanSession keeps valid pauses and drops broken ones');
}

/* ---------------- 4. changing training days mid-week ---------------- */
section('Changing training days mid-week keeps the days already behind us');
{
  reset({ start: '2026-10-12T09:00' }); // Monday, week 1
  for (const [k, d] of [['w1d0', '10-12'], ['w1d1', '10-14'], ['w1d2', '10-16'], ['w1d3', '10-17'], ['w2d0', '10-19'], ['w2d1', '10-21'], ['w2d2', '10-23'], ['w2d3', '10-24']]) logSession(k, `2026-${d}T18:00`);
  freeze('2026-10-29T10:00'); // Thursday of week 3; Monday's session was skipped, Wednesday's missed
  state.main.plan.skipped = { w3d0: true };
  const wk3Before = P.weekSlots(3).filter((s) => s.date < F.startOfDay(new Date())).map((s) => `${s.key}@${F.ymd(s.date)}:${P.slotStatus(s)}`);
  P.setTrainingDays(state.main.plan, [2, 4, 6, 7]);
  const w3 = P.weekSlots(3);
  const past = w3.filter((s) => s.date < F.startOfDay(new Date()));
  const wk3After = past.map((s) => `${s.key}@${F.ymd(s.date)}:${P.slotStatus(s)}`);
  ok(JSON.stringify(wk3After) === JSON.stringify(wk3Before), `past slots of this week are unchanged (${wk3After.join(', ')})`);
  ok(past.every((s) => [1, 3].includes(F.isoDay(s.date))), 'they stay on the old days (Mon, Wed)');
  ok(!w3.some((s) => s.date < F.startOfDay(new Date()) && [2].includes(F.isoDay(s.date))), 'no phantom session appears on a day already behind us (Tue)');
  ok(P.slotStatus(w3.find((s) => F.isoDay(s.date) === 1)) === 'skipped', 'the Monday skip is kept');
  ok(w3.filter((s) => s.date >= F.startOfDay(new Date())).map((s) => F.isoDay(s.date)).join() === '4,6,7', 'from today on this week: Thu, Sat, Sun');
  ok(P.weekSlots(4).map((s) => F.isoDay(s.date)).join() === '2,4,6,7', 'next week uses the new days');
  ok(P.weekSlots(2).map((s) => F.isoDay(s.date)).join() === '1,3,5,6', 'last week is untouched');
  ok(P.weekSlots(2).every((s) => P.slotStatus(s) === 'done'), 'last week stays done');
}

/* ---------------- 5. lighter weeks ---------------- */
section('Lighter weeks (4, 8, 12) have less volume');
for (const len of [30, 45, 60]) {
  reset();
  state.main.profile.sessionLength = len;
  const vol = (w) => P.weekSlots(w).reduce((a, s) => { const st = P.planStats(P.slotSegments(s)); a.min += st.sec / 60; a.kcal += st.kcal; return a; }, { min: 0, kcal: 0 });
  for (const w of P.DELOAD_WEEKS) {
    const full = vol(w - 1), light = vol(w);
    ok(light.min <= full.min * 0.8 && light.kcal < full.kcal, `${len}-min sessions, week ${w}: ${Math.round(full.min)} → ${Math.round(light.min)} min, ${Math.round(full.kcal)} → ${Math.round(light.kcal)} kcal`);
  }
  const slot = P.weekSlots(4)[0];
  const total = P.slotSegments(slot).reduce((a, s) => a + s.dur, 0);
  ok(slot.deload && slot.length === P.deloadLength(len) && total === slot.length * 60, `${len}-min sessions: week 4 sessions run ${slot.length} min (${total / 60} min of intervals)`);
  ok(P.weekSlots(3).every((s) => !s.deload && s.length === len), `${len}-min sessions: full weeks keep ${len} min`);
}

/* ---------------- 6. no jogging until the user says yes ---------------- */
section('Users who can’t jog yet get no jog intervals until they confirm');
for (const canJog of ['no', 'unsure']) {
  reset();
  state.main.profile.canJog = canJog;
  const jogSlots = P.planSlots().filter((s) => P.slotSegments(s).some((x) => x.type === 'jog' || x.type === 'run'));
  ok(jogSlots.length === 0, `canJog "${canJog}": no plan session in weeks 1–12 has a jog (${jogSlots.map((s) => s.key).slice(0, 4).join(', ')})`);
  const libJogs = ALL_IDS.filter((id) => [0, 1, 2].some((level) => P.segmentsFor(id, { level }).some((x) => x.type === 'jog' || x.type === 'run')));
  ok(libJogs.length === 0, `canJog "${canJog}": no library workout has a jog (${libJogs.join(', ')})`);
  state.main.plan.block = 2;
  ok(!P.planSlots().some((s) => P.slotSegments(s).some((x) => x.type === 'jog' || x.type === 'run')), `canJog "${canJog}": block 2 has no jogs either`);
  state.main.plan.block = 1;
  // The offer: from week 5, after two comfortable rated plan sessions in the last 14 days
  freeze('2026-09-14T09:00'); // Monday of week 5
  ok(!P.jogOfferDue(), 'no offer before two comfortable sessions');
  logSession('w4d2', '2026-09-11T18:00', { rpe: 5 }); logSession('w4d3', '2026-09-12T18:00', { rpe: 4 });
  ok(P.jogOfferDue(), 'Today offers short jogs after two comfortable sessions in week 5');
  freeze('2026-08-26T09:00'); // week 2
  ok(!P.jogOfferDue(), 'no offer during Foundation');
  state.main.profile.canJog = 'yes';
  ok(P.planSlots().some((s) => P.slotSegments(s).some((x) => x.type === 'jog')), 'after saying yes, the plan has jogs');
}

/* ---------------- 7. Apple Health weigh-ins (memory only) ---------------- */
section('Apple Health weigh-ins reach Today, calories and badges without being saved');
{
  reset();
  state.main.weights = [{ d: '2026-08-10', kg: 85 }, { d: '2026-08-14', kg: 84.4 }];
  store.setHealthWeights(() => [{ d: '2026-08-14', kg: 99, source: 'health' }, { d: '2026-08-16', kg: 84.0, source: 'health' }]);
  const ws = store.weighIns();
  ok(ws.map((w) => w.d).join() === '2026-08-10,2026-08-14,2026-08-16', 'own and Health weigh-ins merge, oldest first');
  ok(ws.find((w) => w.d === '2026-08-14').kg === 84.4, 'the user’s own weigh-in wins on the same day');
  ok(P.bodyKg() === 84.0, `bodyKg() uses the latest weigh-in, including Health (${P.bodyKg()})`);
  ok(state.main.weights.length === 2 && !state.main.weights.some((w) => w.source === 'health'), 'Health weigh-ins are never written into saved state');
  store.setHealthWeights(null);
  ok(P.bodyKg() === 84.4, 'without Health, bodyKg() falls back to the user’s own weigh-ins');
}

/* ---------------- 8. starting block 2 never doubles up a training day ---------------- */
section('Starting block 2 after finishing block 1');
{
  reset();
  for (const s of P.planSlots()) logSession(s.key, F.ymd(s.date) + 'T18:00');
  freeze('2026-11-07T19:00'); // Saturday of week 12, already trained today
  const probe = JSON.parse(JSON.stringify(state.main.plan));
  P.startPlanThisWeek(probe, new Date(), { newBlock: true });
  ok(probe.startDate === '2026-11-09', `block 2 starts next Monday (${probe.startDate}), not in the week block 1 still owns`);
}

console.log(`\n${failed ? 'FAILED' : 'PASSED'}: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
