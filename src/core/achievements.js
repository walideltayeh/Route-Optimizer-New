// Achievements, personal records and weekly streaks. Pure derivations from state.
import { state, weighIns } from './store.js';
import { startOfWeek, addDays, ymd, isLb, toDist, distUnit, toElev, elevUnit } from './format.js';
import { LB_PER_KG } from './science.js';
import { planSlots, slotState, planBegan, sessionDone } from './program.js';

const sum = (arr, k) => arr.reduce((a, s) => a + (+s[k] || 0), 0);

/** Cumulative-climb milestones (metres). Real summit heights. */
export const SUMMITS = [
  { m: 330, name: 'Eiffel Tower' },
  { m: 1085, name: 'Snowdon (Yr Wyddfa)' },
  { m: 1345, name: 'Ben Nevis' },
  { m: 3776, name: 'Mount Fuji' },
  { m: 4808, name: 'Mont Blanc' },
  { m: 5895, name: 'Kilimanjaro' },
  { m: 8849, name: 'Everest' },
];

/** count = finished workouts (completed, ≥ 70% done or logged by hand); time, distance, energy and climb include partial sessions. */
export function totals(sessions = state.sessions) {
  return {
    count: sessions.filter(sessionDone).length,
    sec: sum(sessions, 'durationSec'),
    km: sum(sessions, 'distanceKm'),
    kcal: sum(sessions, 'kcal'),
    elev: sum(sessions, 'elevM'),
  };
}

/** Consecutive weeks (ending this week if met, else last week) with at least `target` finished sessions. */
export function weekStreak(target = Math.max(2, (state.main.plan.days || []).length - 1), today = new Date()) {
  const counts = new Map();
  for (const s of state.sessions) {
    if (!sessionDone(s)) continue;
    const k = ymd(startOfWeek(new Date(s.date)));
    counts.set(k, (counts.get(k) || 0) + 1);
  }
  let wk = startOfWeek(today);
  const thisMet = (counts.get(ymd(wk)) || 0) >= target;
  if (!thisMet) wk = addDays(wk, -7);
  let n = 0;
  while ((counts.get(ymd(wk)) || 0) >= target) { n++; wk = addDays(wk, -7); }
  return { weeks: n, thisWeekMet: thisMet, target };
}

/** Best single-session values. */
export function records(sessions = state.sessions) {
  const best = (k) => sessions.reduce((b, s) => ((+s[k] || 0) > (b ? +b[k] || 0 : 0) ? s : b), null);
  return {
    distanceKm: best('distanceKm'),
    kcal: best('kcal'),
    elevM: best('elevM'),
    durationSec: best('durationSec'),
  };
}

/** Which records does `s` beat compared with all other sessions? Returns ['distanceKm', ...]. */
export function newRecords(s) {
  const others = state.sessions.filter((x) => x.id !== s.id);
  if (others.length < 2) return [];
  const r = records(others);
  return ['distanceKm', 'kcal', 'elevM'].filter((k) => r[k] && (+s[k] || 0) > (+r[k][k] || 0) * 1.0001);
}

function weightLost() {
  const p = state.main.profile;
  const w = weighIns(); // own weigh-ins plus this run's Apple Health ones, oldest first
  const start = p.startWeight || (w[0] && w[0].kg);
  const cur = w.length ? w[w.length - 1].kg : start;
  return { start, cur, goal: p.goalWeight, lost: start && cur ? start - cur : 0 };
}

/** Plan weeks where every countable slot is done (slots before the plan began, e.g. after a mid-week start, don't count). */
function weeksFullyDone() {
  const slots = planSlots();
  const today = new Date(), began = planBegan();
  const byWeek = new Map();
  for (const s of slots) {
    const st = slotState(s, today, began);
    if (st === 'prestart') continue;
    const e = byWeek.get(s.week) || { done: 0, total: 0 };
    e.total++; if (st === 'done') e.done++;
    byWeek.set(s.week, e);
  }
  return [...byWeek.entries()].filter(([, e]) => e.total && e.done === e.total).map(([w]) => w);
}

/** Full catalogue with progress. Each: {id, group, title, desc, progress 0..1, unlocked, icon} */
export function catalogue() {
  const t = totals();
  const st = weekStreak();
  const wl = weightLost();
  const full = weeksFullyDone();
  const phaseDone = (a) => [a, a + 1, a + 2, a + 3].every((w) => full.includes(w)) ? 1 : [a, a + 1, a + 2, a + 3].filter((w) => full.includes(w)).length / 4;
  // Distance and climb badges keep their metric thresholds but speak the user's units.
  const distTxt = (km) => `${Math.round(toDist(km)).toLocaleString()} ${distUnit()}`;
  const elevTxt = (m) => `${Math.round(toElev(m)).toLocaleString()} ${elevUnit()}`;
  const items = [
    { id: 'first', group: 'Milestones', icon: 'flag', title: 'First steps', desc: 'Finish your first workout', progress: Math.min(1, t.count / 1) },
    { id: 's10', group: 'Milestones', icon: 'medal', title: 'Ten down', desc: 'Finish 10 workouts', progress: Math.min(1, t.count / 10) },
    { id: 's25', group: 'Milestones', icon: 'medal', title: 'Regular', desc: 'Finish 25 workouts', progress: Math.min(1, t.count / 25) },
    { id: 's50', group: 'Milestones', icon: 'medal', title: 'Committed', desc: 'Finish 50 workouts', progress: Math.min(1, t.count / 50) },
    { id: 's100', group: 'Milestones', icon: 'trophy', title: 'Centurion', desc: 'Finish 100 workouts', progress: Math.min(1, t.count / 100) },
    { id: 'week1', group: 'Consistency', icon: 'calendar', title: 'Full week', desc: 'Complete every planned session in a week', progress: full.length ? 1 : 0 },
    { id: 'streak3', group: 'Consistency', icon: 'flame', title: 'Three in a row', desc: 'Hit your weekly target 3 weeks running', progress: Math.min(1, st.weeks / 3) },
    { id: 'streak8', group: 'Consistency', icon: 'flame', title: 'Habit formed', desc: 'Hit your weekly target 8 weeks running', progress: Math.min(1, st.weeks / 8) },
    { id: 'p0', group: 'Plan', icon: 'layers', title: 'Foundation laid', desc: 'Complete every session in weeks 1–4', progress: phaseDone(1) },
    { id: 'p1', group: 'Plan', icon: 'layers', title: 'Built up', desc: 'Complete every session in weeks 5–8', progress: phaseDone(5) },
    { id: 'p2', group: 'Plan', icon: 'trophy', title: 'Plan complete', desc: 'Complete every session in weeks 9–12', progress: phaseDone(9) },
    { id: 'km50', group: 'Distance', icon: 'route', title: distTxt(50), desc: `Cover ${distTxt(50)} in total`, progress: Math.min(1, t.km / 50) },
    { id: 'km200', group: 'Distance', icon: 'route', title: distTxt(200), desc: `Cover ${distTxt(200)} in total`, progress: Math.min(1, t.km / 200) },
    { id: 'kcal10k', group: 'Energy', icon: 'bolt', title: '10,000 kcal', desc: 'Reach ≈10,000 active kcal in workouts (estimate)', progress: Math.min(1, t.kcal / 10000) },
    { id: 'kcal30k', group: 'Energy', icon: 'bolt', title: '30,000 kcal', desc: 'Reach ≈30,000 active kcal in workouts (estimate)', progress: Math.min(1, t.kcal / 30000) },
    ...SUMMITS.map((s, i) => ({ id: 'climb' + i, group: 'Climbing', icon: 'mountain', title: s.name, desc: `Climb ${elevTxt(s.m)} in total`, progress: Math.min(1, t.elev / s.m) })),
  ];
  if (wl.goal && wl.start && wl.start > wl.goal) {
    const need = wl.start - wl.goal;
    // First milestone: 1 kg, or 2 lb for pound users. No "lose X" wording (compliance copy rules).
    const first = isLb() ? { kg: 2 / LB_PER_KG, txt: '2 lb' } : { kg: 1, txt: '1 kg' };
    items.push(
      { id: 'kg1', group: 'Weight', icon: 'scale', title: 'First milestone', desc: `Weigh in ${first.txt} below your starting weight`, progress: Math.max(0, Math.min(1, wl.lost / first.kg)) },
      { id: 'half', group: 'Weight', icon: 'scale', title: 'Halfway', desc: 'Reach the halfway point to your goal weight', progress: Math.max(0, Math.min(1, wl.lost / (need / 2))) },
      { id: 'goal', group: 'Weight', icon: 'trophy', title: 'Goal reached', desc: 'Reach your goal weight', progress: Math.max(0, Math.min(1, wl.lost / need)) },
    );
  }
  const got = state.main.achievements || {};
  return items.map((a) => ({ ...a, unlocked: !!got[a.id] || a.progress >= 1, date: got[a.id] || null }));
}

/** Record newly unlocked achievements in main state; returns the new ones. Call inside update(). */
export function collectNew(main) {
  const out = [];
  for (const a of catalogue()) {
    if (a.progress >= 1 && !main.achievements[a.id]) {
      main.achievements[a.id] = new Date().toISOString();
      out.push(a);
    }
  }
  return out;
}

/** Next summit to aim for. */
export function nextSummit(elev = totals().elev) {
  const next = SUMMITS.find((s) => s.m > elev);
  const prev = [...SUMMITS].reverse().find((s) => s.m <= elev) || null;
  return { next, prev, elev };
}
