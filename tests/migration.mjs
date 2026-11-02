// Migration test: the earlier single-file page's account data (data/users/<uid>/profile + sessions) is brought into Hillpace.
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const page = new URL('../dist/hillpace.html', import.meta.url).pathname;
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 393, height: 852 } });
const errors = [];
p.on('pageerror', (e) => errors.push(e.message));
p.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
await p.addInitScript(() => {
  localStorage.clear();
  const docs = new Map();
  const old = { profile: { units: 'kmh', paces: { walk: 5, brisk: 6.2, jog: 8 }, startWeight: 92, goalLoss: 7.5, voice: true, beeps: true, customs: [] }, weights: [{ d: '2026-10-20', kg: 92 }, { d: '2026-10-28', kg: 91.1 }] };
  docs.set('data/users/u1/profile', old);
  ['2026-10-21', '2026-10-24', '2026-10-27'].forEach((d, i) => docs.set(`data/users/u1/profile/sessions/s${i}`, { id: 's' + i, date: d + 'T18:00:00.000Z', workoutId: 'hills', name: 'Hill Repeats', level: 0, durationSec: 2700, plannedSec: 2700, distanceKm: 4, kcal: 500, elevM: 280, rpe: 6, notes: '', completed: true }));
  const meta = { fromCache: false, hasPendingWrites: false };
  const snap = (path) => ({ id: path.split('/').pop(), exists: docs.has(path), data: () => docs.get(path), metadata: meta });
  const qsnap = (col) => { const ds = [...docs.keys()].filter((k) => k.startsWith(col + '/') && k.slice(col.length + 1).indexOf('/') < 0).map(snap); return { docs: ds, empty: !ds.length, size: ds.length, metadata: meta, docChanges: () => ds.map((d) => ({ type: 'added', doc: d })) }; };
  const coll = (col) => { const q = { orderBy: () => q, limit: () => q, where: () => q, get: async () => qsnap(col), onSnapshot: (n) => { setTimeout(() => n(qsnap(col)), 10); return () => {}; }, doc: (id) => docRef(col + '/' + (id || Math.random().toString(36).slice(2))), add: async (d) => { const r = docRef(col + '/' + Math.random().toString(36).slice(2)); await r.set(d); return r; }, path: col }; return q; };
  const docRef = (path) => ({ id: path.split('/').pop(), path, get: async () => snap(path), set: async (d) => { docs.set(path, JSON.parse(JSON.stringify(d))); }, update: async (d) => { docs.set(path, { ...(docs.get(path) || {}), ...d }); }, delete: async () => { docs.delete(path); }, onSnapshot: (n) => { setTimeout(() => n(snap(path)), 10); return () => {}; }, collection: (sub) => coll(path + '/' + sub) });
  const db = { doc: docRef, collection: coll };
  const user = { id: async () => 'u1', me: async () => ({ id: 'u1', name: '', isOwner: true, canEdit: true }), isOwner: async () => true, canEdit: async () => true, can: async () => null };
  window.__docs = docs;
  window.claude = { use: async (n) => (n === 'db' ? db : n === 'user' ? user : null) };
});
await p.goto('file://' + page);
await p.waitForTimeout(2500);
const r = await p.evaluate(() => ({
  sessions: JSON.parse(localStorage.getItem('hp.sessions.v1') || '[]').map((s) => [s.name, s.kcal, s.imported]),
  weights: (JSON.parse(localStorage.getItem('hp.main.v1') || '{}').weights || []).length,
  power: (JSON.parse(localStorage.getItem('hp.main.v1') || '{}').profile || {}).paces?.power,
  toast: (document.querySelector('.toast') || {}).textContent || '',
  onboarding: !!document.querySelector('.overlay'),
  remoteSessions: [...window.__docs.keys()].filter((k) => k.includes('/app/sessions/')).length,
}));
console.log(JSON.stringify(r, null, 1));
const ok = r.sessions.length === 3 && r.weights === 2 && r.power === 6.2 && /brought over 3 workouts/.test(r.toast) && r.onboarding && !errors.length;
console.log(ok ? 'PASS migration' : 'FAIL migration', errors);
await b.close();
process.exit(ok ? 0 : 1);
