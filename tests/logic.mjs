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

/* ---------------- 9. flat treadmill and outdoors: no incline, climbs become pace ---------------- */
section('Flat treadmill and outdoors: every interval has 0% incline and work intervals are faster than an easy walk');
for (const canJog of ['unsure', 'yes']) {
  reset();
  state.main.profile.canJog = canJog;
  const walkPace = P.speedFor('walk');
  for (const surface of ['flat', 'outdoor']) {
    let inclined = [], slow = [], works = 0;
    for (const id of ALL_IDS) for (const level of [0, 1, 2]) for (const length of LENGTHS) {
      const segs = P.segmentsFor(id, { level, length, surface });
      if (segs.some((s) => s.incline !== 0)) inclined.push(`${id} L${level} ${length}`);
      for (const s of segs.filter((x) => x.role === 'work')) { works++; if (!(P.speedFor(s) > walkPace)) slow.push(`${id} L${level} ${length} "${s.label}" ${P.speedFor(s)}`); }
    }
    ok(inclined.length === 0, `canJog "${canJog}", ${surface}: every built-in workout at every level and length has 0% incline (${inclined.slice(0, 3).join(', ')})`);
    ok(works > 0 && slow.length === 0, `canJog "${canJog}", ${surface}: all ${works} work intervals are faster than the easy-walk pace of ${walkPace} km/h (${slow.slice(0, 3).join(', ')})`);
    ok(P.segmentsFor('free', { surface }).every((s) => s.incline === 0), `canJog "${canJog}", ${surface}: Just walk has no incline`);
    const labels = ALL_IDS.flatMap((id) => P.segmentsFor(id, { level: 2, length: 60, surface }).map((s) => s.label));
    ok(!labels.some((l) => /climb/i.test(l)), `canJog "${canJog}", ${surface}: no interval is called a climb (${labels.filter((l) => /climb/i.test(l)).slice(0, 3).join(', ')})`);
    const descs = ALL_IDS.map((id) => [id, P.workoutDesc(id, { surface, segs: P.segmentsFor(id, { level: 1, surface }) })]);
    const hilly = descs.filter(([, d]) => /incline|climb/i.test(d)).map(([id]) => id);
    ok(descs.every(([, d]) => d.length > 20) && hilly.length === 0, `canJog "${canJog}", ${surface}: no workout description mentions incline or climbs (${hilly.join(', ')})`);
    if (surface === 'outdoor') ok(!descs.some(([, d]) => /belt|rail/i.test(d)), `canJog "${canJog}": outdoor descriptions say nothing about a belt or rails`);
  }
  // A climb on the incline treadmill becomes extra pace without one (+0.1 km/h per point above 2%, at most +1).
  const inc = P.segmentsFor('hills', { level: 2, length: 45, surface: 'incline' });
  const flat = P.segmentsFor('hills', { level: 2, length: 45, surface: 'flat' });
  const i = inc.findIndex((s) => s.role === 'work');
  ok(inc[i].incline === 10 && Math.abs(P.speedFor(flat[i]) - (P.speedFor(inc[i]) + 0.8)) < 1e-9, `canJog "${canJog}": a 10% climb becomes +0.8 km/h on a flat treadmill (${P.speedFor(inc[i])} → ${P.speedFor(flat[i])} km/h)`);
  ok(inc.some((s) => s.incline > 0), `canJog "${canJog}": the incline treadmill still gets incline targets`);
  ok(P.segmentsFor('steep', { level: 1, surface: 'flat' }).every((s) => s.speed == null), `canJog "${canJog}": Steep Steady Walk's fixed 4.8 km/h is dropped without an incline`);
}
{
  reset();
  state.main.profile.treadmill.maxSpeed = 6; // a walking pad
  P.setUsualSurface(state.main, 'flat');
  const top = Math.max(...ALL_IDS.flatMap((id) => P.segmentsFor(id, { level: 2, length: 60 }).map((s) => P.speedFor(s))));
  ok(top <= 6, `a 6 km/h walking pad is never asked to go faster (top ${top} km/h)`);
  const qd = P.quickDraft({ minutes: 30, focus: 'climb', intensity: 'hard' });
  ok(qd.segs.every((s) => s.incline === 0) && !qd.segs.some((s) => /climb/i.test(s.label)), 'Quick Draft on a flat day: no incline and no "climb" labels');
}

/* ---------------- 10. walking only ---------------- */
section('Walking only removes every jog and run, everywhere');
{
  reset();
  state.main.profile.canJog = 'yes';
  state.main.profile.hardExercise = true;
  const jogsIn = (segs) => segs.some((s) => s.type === 'jog' || s.type === 'run');
  ok(ALL_IDS.some((id) => jogsIn(P.segmentsFor(id, { level: 2, length: 45, surface: 'incline' }))), 'without walking only, a jogger has jog intervals (control)');
  state.main.profile.walkOnly = true;
  const bad = [];
  for (const surface of P.SURFACE_IDS) for (const id of ALL_IDS) for (const level of [0, 1, 2]) for (const length of LENGTHS) {
    if (jogsIn(P.segmentsFor(id, { level, length, surface }))) bad.push(`${surface} ${id} L${level} ${length}`);
  }
  ok(bad.length === 0, `every built-in workout at every level, length and surface is walking only (${bad.slice(0, 4).join(', ')})`);
  state.main.customs = [{ id: 'c_run', name: 'Runner', segs: [{ type: 'run', dur: 120, incline: 1 }, { type: 'jog', dur: 300, incline: 2 }, { type: 'walk', dur: 120, incline: 0 }] }];
  ok(!jogsIn(P.segmentsFor('c_run')), 'a custom workout with runs and jogs becomes walking pushes');
  const planJogs = () => P.planSlots().filter((s) => jogsIn(P.slotSegments(s))).map((s) => s.key);
  ok(planJogs().length === 0, `no plan session in weeks 1–12 has a jog (${planJogs().slice(0, 4).join(', ')})`);
  state.main.plan.block = 2;
  ok(planJogs().length === 0, 'block 2 has no jogs either');
  state.main.plan.block = 1;
  const drafts = [];
  for (const focus of ['climb', 'intervals', 'steady', 'mixed']) for (const intensity of ['easy', 'moderate', 'hard']) for (const minutes of [20, 30, 45, 60]) {
    if (jogsIn(P.quickDraft({ minutes, focus, intensity }).segs)) drafts.push(`${focus} ${intensity} ${minutes}`);
  }
  ok(drafts.length === 0, `Quick Draft never adds a jog (${drafts.slice(0, 3).join(', ')})`);
  const jogDescs = P.SURFACE_IDS.flatMap((surface) => ALL_IDS.filter((id) => /\bjog|\brun/i.test(P.workoutDesc(id, { surface }))).map((id) => `${surface} ${id}`));
  ok(jogDescs.length === 0, `no workout description talks about jogs or runs (${jogDescs.slice(0, 3).join(', ')})`);
  state.main.profile.canJog = 'no';
  freeze('2026-09-14T09:00'); // Monday of week 5
  logSession('w4d2', '2026-09-11T18:00', { rpe: 4 }); logSession('w4d3', '2026-09-12T18:00', { rpe: 4 });
  ok(!P.jogOfferDue(), 'Today never offers short jogs to a walking-only user');
  state.main.profile.walkOnly = false;
  ok(P.jogOfferDue(), 'the jog offer comes back once walking only is turned off (control)');
}

/* ---------------- 11. a surface just for today ---------------- */
section('A just-for-today surface applies only today and clears when set back to the usual one');
{
  reset({ start: '2026-08-19T08:00' });
  P.setUsualSurface(state.main, 'incline');
  ok(P.usualSurface() === 'incline' && P.activeSurface() === 'incline' && state.main.profile.treadmill.hasIncline === true, 'usual surface: incline treadmill');
  P.setTodaySurface(state.main, 'outdoor');
  ok(P.activeSurface() === 'outdoor' && P.usualSurface() === 'incline', 'today is outdoors; the usual surface is unchanged');
  ok(state.main.todaySurface && state.main.todaySurface.d === '2026-08-19', `the choice is dated today (${state.main.todaySurface && state.main.todaySurface.d})`);
  ok(P.segmentsFor('hills', { level: 1 }).every((s) => s.incline === 0), 'today’s intervals follow it (no incline)');
  freeze('2026-08-19T23:30');
  ok(P.activeSurface() === 'outdoor', 'it lasts all day');
  freeze('2026-08-20T00:05');
  ok(P.activeSurface() === 'incline', 'tomorrow is back to the usual surface');
  ok(P.segmentsFor('hills', { level: 1 }).some((s) => s.incline > 0), 'tomorrow’s intervals have incline again');
  freeze('2026-08-19T12:00');
  P.setTodaySurface(state.main, 'flat');
  ok(P.activeSurface() === 'flat', 'today can change again (flat)');
  P.setTodaySurface(state.main, 'incline');
  ok(state.main.todaySurface === null && P.activeSurface() === 'incline', 'choosing the usual surface clears the one-off choice');
  P.setTodaySurface(state.main, 'outdoor'); P.setTodaySurface(state.main, null);
  ok(state.main.todaySurface === null, 'null clears it');
  P.setTodaySurface(state.main, 'moon');
  ok(state.main.todaySurface === null && P.activeSurface() === 'incline', 'an unknown surface is ignored');
  P.setTodaySurface(state.main, 'outdoor');
  P.setUsualSurface(state.main, 'flat');
  ok(P.usualSurface() === 'flat' && state.main.profile.treadmill.hasIncline === false && state.main.todaySurface === null && P.activeSurface() === 'flat', 'changing the usual surface keeps hasIncline in step and clears today’s choice');
  P.setTodaySurface(state.main, 'flat');
  ok(state.main.todaySurface === null, 'the usual surface (now flat) is never stored as a one-off');
}

/* ---------------- 12. Just walk: the open-ended engine ---------------- */
section('Just walk: an open engine never finishes by itself; end() completes it; changeCurrent splits intervals');
{
  reset();
  let t = new RealDate('2026-08-17T09:00:00Z').getTime();
  const now = () => t;
  const segs = P.segmentsFor('free', { surface: 'flat' }).map((s) => ({ ...s }));
  ok(segs.length === 1 && segs[0].type === 'brisk' && segs[0].dur === 600, 'Just walk starts as one 10-minute brisk interval');
  const e = E.createEngine(segs, { now, open: true });
  e.start();
  const sums = () => ({
    dur: segs.reduce((a, s) => a + s.dur, 0), sec: e.splits.reduce((a, x) => a + x.sec, 0),
    km: e.splits.reduce((a, x) => a + x.km, 0), kcal: e.splits.reduce((a, x) => a + x.kcal, 0),
  });
  const consistent = (tag) => {
    const s = sums();
    ok(Math.abs(s.dur - e.planTotal) < 1e-6 && Math.abs(s.sec - e.total) < 1e-6 && Math.abs(s.km - e.km) < 1e-9 && Math.abs(s.kcal - e.kcal) < 1e-6 && Math.abs(e.planElapsed() - e.total) < 1e-6,
      `${tag}: totals agree (intervals ${s.dur} s = plan ${e.planTotal} s; splits ${Math.round(s.sec)} s = active ${Math.round(e.total)} s; distance and energy match)`);
  };
  for (let i = 0; i < 25 * 60; i++) { t += 1000; e.tick(); }
  ok(!e.finished && e.running, `still running after 25 minutes (the 10-minute interval kept extending, now ${segs[0].dur / 60} min)`);
  ok(Math.round(e.total) === 1500 && e.planTotal >= e.total, `active time 25:00 (${Math.round(e.total)} s), plan ${e.planTotal} s`);
  ok(e.completion() === 1, 'an open walk counts as fully done whenever it ends');
  consistent('after 25 min');
  t += 3 * 3600 * 1000; e.tick(); // the phone slept for three hours
  ok(!e.finished && Math.round(e.total) === 1500 + 3 * 3600, `a long gap (suspended app) never finishes it (active ${Math.round(e.total)} s)`);
  // Change pace: the current interval is split; the time before the change keeps its old pace.
  const kmBefore = e.km;
  e.changeCurrent({ type: 'power' });
  ok(segs.length === 2 && e.idx === 1 && segs[0].type === 'brisk' && segs[1].type === 'power', `changing pace splits the interval (${segs.map((s) => s.type).join(' → ')})`);
  ok(Math.abs(segs[0].dur - e.total) < 1e-6 && Math.abs(e.km - kmBefore) < 1e-12, 'the brisk part ends now and keeps its distance');
  for (let i = 0; i < 120; i++) { t += 1000; e.tick(); }
  ok(Math.abs(e.splits.find((x) => x.idx === 1).km - (P.speedFor('power') * 120) / 3600) < 1e-9, 'two minutes of power walking add distance at the power-walk pace');
  consistent('after a pace change');
  e.changeCurrent({ speed: 6.6, incline: 2.3 });
  ok(segs.length === 3 && segs[2].speed === 6.6 && segs[2].incline === 2.5 && segs[2].type === 'power', `a speed and incline change is logged as a new interval (${segs[2].speed} km/h, ${segs[2].incline}%)`);
  for (let i = 0; i < 60; i++) { t += 1000; e.tick(); }
  ok(Math.abs(e.speed() - 6.6) < 1e-9 && Math.abs(e.splits.find((x) => x.idx === 2).km - (6.6 * 60) / 3600) < 1e-9, 'the new speed is used from then on');
  // Two changes within a second (a speed tap that just settled, then a pace tap): the log follows the last one.
  e.changeCurrent({ speed: 5.8 }); t += 400; e.tick(); e.changeCurrent({ type: 'walk' });
  for (let i = 0; i < 30; i++) { t += 1000; e.tick(); }
  t += 600; e.tick(); // back on whole seconds (a split ends on a whole second)
  const quick = e.splits.find((x) => x.idx === e.idx);
  ok(segs[e.idx].type === 'walk' && quick.type === 'walk' && Math.abs(quick.speed - P.speedFor('walk')) < 1e-9, `a pace change right after a speed change is logged as that pace (${quick.type} at ${quick.speed} km/h)`);
  e.changeCurrent({ speed: 99 });
  ok(segs[segs.length - 1].speed <= 25, 'a silly speed is clamped');
  for (let i = 0; i < 30; i++) { t += 1000; e.tick(); }
  consistent('after speed and incline changes');
  ok(!e.finished, 'still running after the changes');
  const total = e.total;
  t += 5000; e.end();
  ok(e.finished && e.completed === true, 'end() finishes an open walk as completed');
  ok(Math.round(e.total) === Math.round(total + 5), 'end() counts the last few seconds');
  const nSegs = segs.length;
  t += 60000; e.tick(); e.changeCurrent({ type: 'walk' });
  ok(Math.round(e.total) === Math.round(total + 5) && segs.length === nSegs, 'nothing changes after the end');
  // A planned workout ended early is not completed (control).
  const plan = E.createEngine(P.segmentsFor('hills', { level: 0 }).map((s) => ({ ...s })), { now });
  plan.start(); for (let i = 0; i < 60; i++) { t += 1000; plan.tick(); }
  plan.end();
  ok(plan.finished && plan.completed === false && plan.completion() < E.COMPLETE_AT, 'ending a planned workout early is not completed (control)');
  // Pause: paused time is not active time in an open walk either.
  const segs2 = P.segmentsFor('free', { surface: 'outdoor' }).map((s) => ({ ...s }));
  const f = E.createEngine(segs2, { now, open: true });
  f.start(); t += 60000; f.tick(); f.pause(); t += 600000; f.resume(); t += 60000; f.tick();
  ok(Math.round(f.total) === 120 && !f.finished, `a 10-minute pause does not count (active ${Math.round(f.total)} s)`);
}

console.log(`\n${failed ? 'FAILED' : 'PASSED'}: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
