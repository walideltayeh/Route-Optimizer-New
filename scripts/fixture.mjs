// Generates tests/fixture.json: a realistic user 3 weeks into the plan (for screenshots and tests).
import { writeFileSync, mkdirSync } from 'node:fs';
const store = await import('../src/core/store.js');
const pr = await import('../src/core/program.js');
const fmt = await import('../src/core/format.js');
const { state } = store;
const today = new Date(); today.setHours(9, 0, 0, 0);
const m = store.defaultMain();
Object.assign(m.profile, { name: 'Sam', goal: 'lose', sex: 'male', age: 41, heightCm: 178, startWeight: 92, goalWeight: 84.5, pace: 'steady', activity: 'sitting', canJog: 'yes', hardExercise: false });
m.profile.paces = { walk: 4.8, brisk: 5.5, power: 6.2, jog: 8.0, run: 9.5 };
m.onboarded = true;
m.readiness.acceptedAt = new Date(today - 22 * 864e5).toISOString();
m.plan.startDate = fmt.ymd(fmt.addDays(fmt.startOfWeek(today), -14));
m.plan.days = [1, 3, 5, 6];
state.main = m; state.sessions = [];
const sessions = [];
const rpes = [6, 7, 5, 6, 7, 6, 8, 6, 5, 7];
let k = 0;
for (const slot of pr.planSlots()) {
  if (slot.date >= fmt.startOfWeek(today) && fmt.daysBetween(slot.date, today) <= 0 && fmt.ymd(slot.date) !== fmt.ymd(today) && slot.index > 1) continue;
  if (fmt.daysBetween(today, slot.date) >= 0) continue; // only past slots
  if (slot.key === 'w2d3') continue; // one missed session
  const segs = pr.slotSegments(slot); const st = pr.planStats(segs, 0, 91);
  const d = new Date(slot.date); d.setHours(18, 10, 0, 0);
  sessions.push({ id: store.uid(), date: d.toISOString(), endedAt: new Date(+d + st.sec * 1000).toISOString(), workoutId: slot.workoutId, name: pr.getWorkout(slot.workoutId).name, planSlot: slot.key, level: slot.level, length: slot.length,
    durationSec: st.sec, plannedSec: st.sec, completion: 1, completed: true, distanceKm: +st.km.toFixed(3), kcal: Math.round(st.kcal), elevM: Math.round(st.elev), rpe: rpes[k++ % rpes.length], notes: k === 2 ? 'Calves felt it on the last climb.' : '',
    splits: segs.map((x, i) => ({ idx: i, type: x.type, label: x.label, incline: x.incline, speed: pr.speedFor(x), sec: x.dur, km: pr.speedFor(x) * x.dur / 3600, kcal: 0, vig: x.type === 'jog' })), source: 'app' });
}
sessions.reverse();
const w = [92.0, 91.6, 91.8, 91.1, 90.9, 90.6, 90.8, 90.2, 89.9, 89.6];
m.weights = w.map((kg, i) => ({ d: fmt.ymd(fmt.addDays(today, -21 + Math.round(i * 2.3))), kg }));
mkdirSync(new URL('../tests/', import.meta.url), { recursive: true });
writeFileSync(new URL('../tests/fixture.json', import.meta.url), JSON.stringify({ main: m, sessions }, null, 1));
console.log('fixture:', sessions.length, 'sessions,', m.weights.length, 'weigh-ins, plan start', m.plan.startDate);
