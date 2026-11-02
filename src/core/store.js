// App state + persistence. One "main" document (profile, plan, weights, custom workouts, achievements)
// and a "sessions" list. Persistence goes through an adapter chosen at boot:
//   - native iOS (Capacitor): a JSON file in Library/ (tmp + rename; the previous good copy is kept as data.prev.json)
//   - claude.ai artifact: private per-user db docs (data/users/<id>/...)
//   - plain browser: localStorage
// Every adapter also mirrors to localStorage so the first paint never waits on I/O.
//
// Sync bookkeeping (localStorage 'hp.sync.v1') records what the durable store has not confirmed yet: a revision number,
// whether main changed, and an outbox of session ids. Nothing is dropped from this device until the durable store has it:
//   - a failed write stays in the outbox and is retried (backoff, app focus, next launch);
//   - on load, this device's unconfirmed changes are merged with the stored copy instead of being overwritten;
//   - a cloud snapshot only removes a local session that the account was known to hold (deleted on another device).

const LS_MAIN = 'hp.main.v1';
const LS_SESS = 'hp.sessions.v1';
const LS_META = 'hp.sync.v1';
const LEGACY_KEY = 'incline-coach-v1'; // previous single-file version
const DRAFT_KEYS = ['hp.draft', 'hp.onb.draft']; // builder and onboarding drafts (owned by those screens)

export const DEFAULT_PROFILE = {
  name: '',
  goal: 'lose', // 'lose' | 'fitter' | 'habit' | 'hike'
  sex: null, // 'male' | 'female' | 'unspecified'
  age: null,
  heightCm: null,
  startWeight: null, // kg at plan start
  goalWeight: null, // kg
  pace: 'steady', // 'gentle' | 'steady' | 'ambitious' (see science.PACES)
  targetDate: null, // optional 'YYYY-MM-DD'
  activity: 'sitting', // science.ACTIVITY_LEVELS id
  canJog: 'unsure', // 'yes' | 'no' | 'unsure' (1 min at 8 km/h)
  hardExercise: false, // regularly does breathless exercise
  noNumbers: false, // "Train without calorie and weight numbers"
  hideWeight: false,
  units: { speed: 'kmh', weight: 'kg', height: 'cm' },
  paces: { walk: 4.5, brisk: 5.5, power: 6.0, jog: 8.0, run: 9.5 }, // km/h
  treadmill: { hasIncline: true, maxIncline: 12, maxSpeed: 16, handsFree: true },
  sessionLength: 45, // 30 | 45 | 60
  busyLength: 30,
  cues: { voice: true, beeps: true, lead: 10, detail: 2, rate: 1, voiceId: null }, // detail 1=changes only, 2=+milestones, 3=+splits
  haptics: true,
  health: { enabled: false, watch: false }, // watch: also recording on Apple Watch (skip energy/distance)
  reminders: { enabled: false, time: '18:00' },
  appearance: 'system', // 'system' | 'light' | 'dark'
};

export const DEFAULT_PLAN = {
  startDate: null, // 'YYYY-MM-DD' (a Monday)
  days: [1, 3, 5, 6], // ISO weekday numbers 1=Mon..7=Sun
  weeks: 12,
  block: 1,
  moved: {}, // slotKey -> 'YYYY-MM-DD' (rescheduled)
  skipped: {}, // slotKey -> true
  busy: {}, // slotKey -> true when the user chose the busy-day length
  adjust: { incline: 0, speed: 0 }, // effort-based adaptation applied to work intervals
  adaptLog: [], // [{date, kind:'hold'|'ease'|'step', reason}]
};

export const DEFAULT_READINESS = {
  answers: {}, // questionId -> true/false
  doctorFlag: false,
  doctorAck: false, // "I've checked with my doctor"
  achilles: false,
  betaBlocker: false,
  pregnant: false,
  acceptedAt: null, // ISO time the not-a-medical-device statement was accepted
};

export function defaultMain() {
  return {
    v: 1,
    onboarded: false,
    profile: structuredClone(DEFAULT_PROFILE),
    plan: structuredClone(DEFAULT_PLAN),
    readiness: structuredClone(DEFAULT_READINESS),
    lessonsRead: {}, // lessonId -> ISO
    lastBackup: null,
    weights: [], // [{d:'YYYY-MM-DD', kg}]
    measurements: [], // [{d, waistCm}]
    customs: [], // [{id, name, segs, updated}]
    achievements: {}, // id -> ISO date unlocked
    lastWorkoutId: null,
  };
}

function mergeMain(d) {
  const base = defaultMain();
  if (!d || typeof d !== 'object') return base;
  return {
    ...base,
    ...d,
    profile: {
      ...base.profile,
      ...(d.profile || {}),
      units: { ...base.profile.units, ...((d.profile || {}).units || {}) },
      paces: { ...base.profile.paces, ...((d.profile || {}).paces || {}) },
      treadmill: { ...base.profile.treadmill, ...((d.profile || {}).treadmill || {}) },
      cues: { ...base.profile.cues, ...((d.profile || {}).cues || {}) },
      health: { ...base.profile.health, ...((d.profile || {}).health || {}) },
      reminders: { ...base.profile.reminders, ...((d.profile || {}).reminders || {}) },
    },
    plan: { ...base.plan, ...(d.plan || {}), adjust: { ...base.plan.adjust, ...((d.plan || {}).adjust || {}) } },
    readiness: { ...base.readiness, ...(d.readiness || {}) },
    lessonsRead: d.lessonsRead && typeof d.lessonsRead === 'object' ? d.lessonsRead : {},
    weights: Array.isArray(d.weights) ? d.weights : [],
    measurements: Array.isArray(d.measurements) ? d.measurements : [],
    customs: Array.isArray(d.customs) ? d.customs : [],
    achievements: d.achievements && typeof d.achievements === 'object' ? d.achievements : {},
  };
}

/* ---------------- sanitising imported data ---------------- */
// Backup files are untrusted input. Everything that later reaches markup, class names or arithmetic is coerced here:
// segment and split types are whitelisted, numbers are finite and clamped, text is a capped string, ids follow the
// db path grammar. Used by the restore flow (me.js), replaceAll and the legacy conversion.

const MODE_TYPES = ['walk', 'brisk', 'power', 'jog', 'run']; // keys of program.MODES
const SEG_NAMES = { walk: 'Easy walk', brisk: 'Brisk walk', power: 'Power walk', jog: 'Jog', run: 'Run' };
const ROLES = ['warm', 'work', 'rest', 'cool'];
const SAFE_ID = /^[A-Za-z0-9_.~:@+-]{1,200}$/;
const SAFE_TEXT = /^[\w .,:@+\-]{0,200}$/;
const num = (x, min, max, dflt = null) => {
  const n = typeof x === 'string' && x.trim() !== '' ? Number(x) : x;
  return typeof n === 'number' && Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : dflt;
};
const text = (x, max) => (typeof x === 'string' ? x : typeof x === 'number' && Number.isFinite(x) ? String(x) : '').slice(0, max);
const isoOrNull = (x) => {
  if (x == null || x === '' || typeof x === 'boolean') return null;
  const t = typeof x === 'number' ? x : Date.parse(String(x));
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
};
/** True when a session id is safe to use as a db document id. */
export const isSafeId = (id) => typeof id === 'string' && SAFE_ID.test(id) && id !== '.' && id !== '..';

function cleanSeg(x, mapBrisk) {
  if (!x || typeof x !== 'object') return null;
  const type = mapBrisk && x.type === 'brisk' ? 'power' : x.type;
  if (!MODE_TYPES.includes(type)) return null;
  const dur = num(x.dur, 0, 7200, 0);
  if (!(dur >= 1)) return null;
  const s = { type, dur: Math.round(dur), incline: num(x.incline, 0, 30, 0), label: text(x.label, 60) || SEG_NAMES[type] };
  if (ROLES.includes(x.role)) s.role = x.role;
  const speed = num(x.speed, 0.5, 30);
  if (speed != null) s.speed = speed;
  const add = num(x.add, -5, 5, 0);
  if (add) s.add = add;
  return s;
}
function cleanStep(x, mapBrisk) {
  if (!x || typeof x !== 'object') return null;
  const type = mapBrisk && x.type === 'brisk' ? 'power' : x.type;
  const dur = num(x.dur, 0, 7200, 0);
  if (!MODE_TYPES.includes(type) || !(dur >= 1)) return null;
  const speed = text(x.speed, 8);
  return { k: 'step', type, dur: Math.round(dur), speed: /^[0-9.,]*$/.test(speed) ? speed : '', incline: num(x.incline, 0, 30, 0), label: text(x.label, 32) };
}
/** Builder items (optional on a custom workout). Returns null when anything looks wrong; the builder then rebuilds them from segs. */
function cleanItems(items, mapBrisk) {
  if (!Array.isArray(items) || !items.length || items.length > 200) return null;
  const out = [];
  for (const it of items) {
    if (it && it.k === 'rep') {
      const steps = (Array.isArray(it.steps) ? it.steps : []).map((x) => cleanStep(x, mapBrisk));
      if (!steps.length || steps.some((x) => !x)) return null;
      out.push({ k: 'rep', rounds: Math.round(num(it.rounds, 1, 50, 1)), steps });
    } else {
      const s = cleanStep(it, mapBrisk);
      if (!s) return null;
      out.push(s);
    }
  }
  return out;
}
/** Custom workouts from an untrusted source. Invalid segments are dropped, and so is a workout left without any. */
export function cleanCustoms(list, { mapBrisk = false } = {}) {
  const out = [], seen = new Set();
  for (const c of Array.isArray(list) ? list : []) {
    if (!c || typeof c !== 'object') continue;
    const segs = (Array.isArray(c.segs) ? c.segs : []).slice(0, 500).map((x) => cleanSeg(x, mapBrisk)).filter(Boolean);
    if (!segs.length) continue;
    let id = /^[A-Za-z0-9]{1,40}$/.test(String(c.id ?? '')) ? String(c.id) : uid('c');
    if (seen.has(id)) id = uid('c');
    seen.add(id);
    const rec = { id, name: text(c.name, 60).trim() || 'My workout', segs, intensity: Math.round(num(c.intensity, 1, 3, 2)) };
    if (typeof c.auto === 'boolean') rec.auto = c.auto;
    const updated = isoOrNull(c.updated);
    if (updated) rec.updated = updated;
    const items = cleanItems(c.items, mapBrisk);
    if (items) rec.items = items;
    out.push(rec);
  }
  return out;
}
function cleanSplit(x) {
  if (!x || typeof x !== 'object' || !MODE_TYPES.includes(x.type)) return null;
  return {
    idx: Math.round(num(x.idx, 0, 9999, 0)), type: x.type, label: text(x.label, 60), incline: num(x.incline, 0, 30, 0),
    speed: num(x.speed, 0, 30, 0), sec: num(x.sec, 0, 86400, 0), km: num(x.km, 0, 500, 0), kcal: num(x.kcal, 0, 1e5, 0), vig: !!x.vig,
  };
}
const SESSION_NUM = {
  durationSec: [0, 86400, 0], plannedSec: [0, 86400, 0], completion: [0, 1, 0], distanceKm: [0, 500, 0], kcal: [0, 1e5, 0],
  elevM: [0, 1e5, 0], avgMETs: [0, 30, null], nudgeKmh: [-10, 10, 0], length: [0, 600, null], level: [0, 10, null],
};
const SESSION_BOOL = ['completed', 'healthPending', 'consoleEdited'];
/** One session from an untrusted source, or null when it has no usable date. Unsafe ids get a fresh one. */
export function cleanSession(s) {
  if (!s || typeof s !== 'object' || Array.isArray(s)) return null;
  const date = isoOrNull(s.date);
  if (!date) return null;
  const out = {};
  // Other simple fields (e.g. prevPlanSlot, manualType) are kept when they are plain numbers, booleans or short safe text.
  for (const [k, v] of Object.entries(s)) {
    if (!/^[A-Za-z][A-Za-z0-9]{0,40}$/.test(k)) continue;
    if (v === null || typeof v === 'boolean' || (typeof v === 'number' && Number.isFinite(v)) || (typeof v === 'string' && SAFE_TEXT.test(v))) out[k] = v;
  }
  const id = s.id == null ? '' : String(s.id);
  out.id = isSafeId(id) ? id : uid('s');
  out.date = date;
  out.endedAt = isoOrNull(s.endedAt);
  out.name = text(s.name, 80);
  out.notes = text(s.notes, 4000);
  out.workoutId = typeof s.workoutId === 'string' && /^[\w.:@+-]{1,80}$/.test(s.workoutId) ? s.workoutId : null;
  out.planSlot = typeof s.planSlot === 'string' && /^[\w-]{1,40}$/.test(s.planSlot) ? s.planSlot : null;
  out.healthUUID = typeof s.healthUUID === 'string' && /^[\w-]{1,64}$/.test(s.healthUUID) ? s.healthUUID : null;
  out.source = s.source === 'manual' ? 'manual' : 'app';
  for (const [k, [min, max, dflt]] of Object.entries(SESSION_NUM)) out[k] = num(s[k], min, max, dflt);
  if (out.level != null) out.level = Math.round(out.level);
  const rpe = num(s.rpe, 1, 10);
  out.rpe = rpe == null ? null : Math.round(rpe);
  for (const k of SESSION_BOOL) out[k] = !!s[k];
  out.splits = (Array.isArray(s.splits) ? s.splits : []).slice(0, 1000).map(cleanSplit).filter(Boolean);
  out.pauseLog = (Array.isArray(s.pauseLog) ? s.pauseLog : []).slice(0, 500)
    .map((p) => { const a = p && isoOrNull(p.start), b = p && isoOrNull(p.end); return a && b && b >= a ? { start: a, end: b } : null; }).filter(Boolean);
  if (s.appValues && typeof s.appValues === 'object') {
    const a = s.appValues;
    out.appValues = { durationSec: num(a.durationSec, 0, 86400, 0), distanceKm: num(a.distanceKm, 0, 500, 0), kcal: num(a.kcal, 0, 1e5, 0), elevM: num(a.elevM, 0, 1e5, 0) };
  } else out.appValues = null;
  return out;
}
const byDateDesc = (a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0);
/** Sessions from an untrusted source: cleaned, de-duplicated by id, newest first. */
export function cleanSessions(list) {
  const seen = new Set(), out = [];
  for (const raw of Array.isArray(list) ? list : []) {
    const s = cleanSession(raw);
    if (!s) continue;
    if (seen.has(s.id)) { if (raw && raw.id != null && String(raw.id) === s.id) continue; s.id = uid('s'); }
    seen.add(s.id);
    out.push(s);
  }
  return out.sort(byDateDesc);
}

/** Convert data from the previous single-file app, if present. */
function readLegacy() {
  try {
    const raw = localStorage.getItem(LEGACY_KEY);
    if (!raw) return null;
    const d = JSON.parse(raw);
    const m = defaultMain();
    const p = d.profile || {};
    if (p.paces && typeof p.paces === 'object') m.profile.paces = { ...m.profile.paces, walk: num(p.paces.walk, 2, 12, 4.5), power: num(p.paces.brisk, 2, 12, 6.0), jog: num(p.paces.jog, 4, 20, 8.0) };
    m.profile.units.speed = p.units === 'mph' ? 'mph' : 'kmh';
    m.profile.startWeight = num(p.startWeight, 30, 400, null);
    if (m.profile.startWeight && num(p.goalLoss, 0, 300, null)) m.profile.goalWeight = +(m.profile.startWeight - num(p.goalLoss, 0, 300, 0)).toFixed(1);
    m.profile.cues.voice = p.voice !== false;
    m.profile.cues.beeps = p.beeps !== false;
    m.weights = (Array.isArray(d.weights) ? d.weights : []).filter((w) => w && /^\d{4}-\d{2}-\d{2}$/.test(String(w.d)) && num(w.kg, 20, 500) != null).map((w) => ({ d: w.d, kg: num(w.kg, 20, 500) }));
    // old custom workouts used 'brisk' for power walking
    m.customs = cleanCustoms(p.customs, { mapBrisk: true });
    const sessions = cleanSessions((Array.isArray(d.sessions) ? d.sessions : []).map((x) => (x && typeof x === 'object' ? { ...x, source: x.manual ? 'manual' : 'app', planSlot: null } : x)));
    return { main: m, sessions };
  } catch {
    return null;
  }
}

/* ---------------- adapters ---------------- */

function lsGet(k) { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch { return null; } }
function lsSet(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch { return false; } }

export const localAdapter = {
  name: 'local',
  label: 'Saved on this device',
  async load() { return { main: lsGet(LS_MAIN), sessions: lsGet(LS_SESS) }; },
  async saveMain() {},
  async saveSession() {},
  async deleteSession() {},
  async clear() {},
};

/**
 * Native adapter: one JSON file in the app's Library directory
 * (write data.json.tmp, then rename over data.json; the previous good copy is kept as data.prev.json).
 * Filesystem is the Capacitor plugin proxy; Directory is 'LIBRARY'.
 * Each file records the sync revision it contains, so launch can tell whether localStorage holds newer changes.
 */
export function fileAdapter(Filesystem) {
  const DIR = 'LIBRARY';
  const path = 'hillpace/data.json', tmp = path + '.tmp', prev = 'hillpace/data.prev.json';
  let pending = null;
  let waiters = []; // promises waiting for the next write
  let writing = Promise.resolve(); // the write chain: one file operation at a time
  let current = { main: null, sessions: [] };
  async function readJson(p) {
    try {
      const r = await Filesystem.readFile({ path: p, directory: DIR, encoding: 'utf8' });
      return JSON.parse(r.data);
    } catch { return null; }
  }
  async function writeNow() {
    const body = JSON.stringify({ schemaVersion: 2, savedAt: new Date().toISOString(), rev: meta.rev, main: current.main, sessions: current.sessions });
    await Filesystem.mkdir({ path: 'hillpace', directory: DIR, recursive: true }).catch(() => {});
    await Filesystem.writeFile({ path: tmp, directory: DIR, data: body, encoding: 'utf8' });
    await Filesystem.copy({ from: path, to: prev, directory: DIR, toDirectory: DIR }).catch(() => {});
    await Filesystem.rename({ from: tmp, to: path, directory: DIR, toDirectory: DIR });
  }
  /** Write now. Every caller waiting on an earlier scheduled write settles with this one. */
  function run() {
    clearTimeout(pending);
    pending = null;
    const ws = waiters;
    waiters = [];
    const job = writing.catch(() => {}).then(writeNow); // a failed write never blocks the next one
    writing = job;
    job.then(() => ws.forEach((w) => w.resolve()), (e) => ws.forEach((w) => w.reject(e)));
    return job;
  }
  function schedule() {
    clearTimeout(pending);
    const p = new Promise((resolve, reject) => waiters.push({ resolve, reject }));
    pending = setTimeout(run, 400);
    return p;
  }
  const valid = (d) => d && typeof d === 'object' && ((d.main && typeof d.main === 'object') || Array.isArray(d.sessions));
  const stamp = (d) => Date.parse(d.savedAt || '') || 0;
  return {
    name: 'device',
    label: 'Saved on this iPhone',
    async load() {
      // data.json.tmp can be newer than data.json when the app stopped between writing it and the rename.
      const found = (await Promise.all([readJson(path), readJson(tmp), readJson(prev)])).filter(valid);
      found.sort((a, b) => (b.rev || 0) - (a.rev || 0) || stamp(b) - stamp(a)); // stable: data.json wins a tie
      const d = found[0] || null;
      if (d) current = { main: d.main || null, sessions: Array.isArray(d.sessions) ? d.sessions : [] };
      return { main: current.main, sessions: d ? current.sessions : null, rev: d ? d.rev || 0 : 0, savedAt: d ? d.savedAt || null : null };
    },
    async saveMain(main, all) { current.main = main; if (Array.isArray(all)) current.sessions = all; return schedule(); },
    async saveSession(_s, all) { current.sessions = all; return schedule(); },
    async deleteSession(_id, all) { current.sessions = all; return schedule(); },
    /** Replace everything with one immediate write (restore, background flush). */
    async writeAll(main, sessions) { current = { main, sessions }; return run(); },
    async flush() { return run(); },
    /** Delete the files. Queued behind any write in progress, so an earlier write can't bring the data back. */
    async clear() {
      clearTimeout(pending);
      pending = null;
      const ws = waiters;
      waiters = [];
      current = { main: null, sessions: [] };
      const job = writing.catch(() => {}).then(async () => {
        for (const p of [path, prev, tmp]) await Filesystem.deleteFile({ path: p, directory: DIR }).catch(() => {});
      });
      writing = job;
      ws.forEach((w) => w.resolve());
      return job;
    },
  };
}

/** Run fn over items with at most n in flight. Rejects with the first error after all have finished. */
async function pool(items, fn, n = 4) {
  let i = 0, err = null;
  const worker = async () => {
    while (i < items.length) {
      const x = items[i++];
      try { await fn(x); } catch (e) { if (!err) err = e; }
    }
  };
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, worker));
  if (err) throw err;
}

/** claude.ai artifact adapter: private per-user documents, live across devices. */
export function artifactAdapter(db, uid, onRemote) {
  const mainRef = db.doc('data/users/' + uid + '/app');
  const sessCol = mainRef.collection('sessions');
  let adapterError = () => {};
  const NO_RETRY = new Set(['invalid_argument', 'quota_exceeded', 'resource_exhausted', 'revoked', 'not_granted', 'capability_disabled', 'capability_removed', 'transform_error']);
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const chains = new Map();
  /** One write at a time per document. 'unavailable' (or an unknown code) is retried once after a short random delay. */
  function write(key, fn) {
    const attempt = () => Promise.resolve().then(fn);
    const withRetry = () => attempt().catch(async (e) => {
      if (e instanceof TypeError || (e && NO_RETRY.has(e.code))) throw e;
      await sleep(250 + Math.random() * 750);
      return attempt();
    });
    const p = (chains.get(key) || Promise.resolve()).catch(() => {}).then(withRetry);
    chains.set(key, p);
    const done = () => { if (chains.get(key) === p) chains.delete(key); };
    p.then(done, done);
    return p;
  }
  const docData = (d) => { const x = structuredClone(d.data()); if (x && x.id == null) x.id = d.id; return x; };
  const a = {
    name: 'cloud',
    label: 'Synced to your account',
    set onError(fn) { adapterError = fn; },
    async load() {
      const [m, s] = await Promise.all([
        mainRef.get(),
        sessCol.orderBy('date', 'desc').limit(1000).get(),
      ]);
      return {
        main: m.exists ? structuredClone(m.data()) : null,
        sessions: s.empty ? null : s.docs.map(docData),
        remoteEmpty: !m.exists && s.empty,
      };
    },
    subscribe() {
      // A listener the host terminated with 'unavailable' only recovers with a fresh onSnapshot.
      const retry = (again) => (e) => { if (e && e.code === 'unavailable') setTimeout(again, 2000 + Math.random() * 3000); else adapterError(e); };
      const watchMain = () => mainRef.onSnapshot((snap) => {
        // Skip cached copies (possibly from an earlier visit) and this page's own unconfirmed writes.
        if (snap.exists && !snap.metadata.hasPendingWrites && !snap.metadata.fromCache) onRemote({ main: structuredClone(snap.data()) });
      }, retry(watchMain));
      const watchSessions = () => sessCol.orderBy('date', 'desc').limit(1000).onSnapshot((snap) => {
        if (!snap.metadata.hasPendingWrites && !snap.metadata.fromCache) onRemote({ sessions: snap.docs.map(docData), windowFull: snap.docs.length >= 1000 });
      }, retry(watchSessions));
      watchMain();
      watchSessions();
    },
    async saveMain(main) {
      const body = structuredClone(main);
      body.updatedAt = new Date().toISOString();
      return write('main', () => mainRef.set(body));
    },
    async clearMain() { return write('main', () => mainRef.delete()); },
    async saveSession(s) { const body = structuredClone(s); return write('s:' + s.id, () => sessCol.doc(String(s.id)).set(body)); },
    async deleteSession(id) { return write('s:' + id, () => sessCol.doc(String(id)).delete()); },
    async clear(all) {
      await pool((all || []).map((s) => (s && typeof s === 'object' ? s.id : s)), (id) => a.deleteSession(id));
      return a.clearMain();
    },
  };
  return a;
}

/* ---------------- sync bookkeeping ---------------- */
// rev       – bumps on every local change (the device file stores the rev it contains)
// mainAt    – time of the last local change to main
// mainDirty – main changed locally and the durable store hasn't confirmed it
// mainAuth  – the local main replaces the stored one outright (restore, erase): never merged with it
// mainGone  – the stored main must be deleted (after Erase all, cloud)
// outbox    – sessions changed locally and not confirmed yet: id -> 'set' | 'del'
// known     – session ids the account last reported holding (cloud)
const freshMeta = () => ({ rev: 0, mainAt: null, mainDirty: false, mainAuth: false, mainGone: false, outbox: {}, known: [] });
let meta = freshMeta();
let tracking = true; // false on the plain web, where localStorage itself is the durable store
let mainSeq = 0;
const sessSeq = new Map();
function loadMeta() {
  const m = lsGet(LS_META);
  meta = { ...freshMeta(), ...(m && typeof m === 'object' && !Array.isArray(m) ? m : {}) };
  if (!meta.outbox || typeof meta.outbox !== 'object' || Array.isArray(meta.outbox)) meta.outbox = {};
  if (!Array.isArray(meta.known)) meta.known = [];
  meta.rev = Number.isFinite(meta.rev) ? meta.rev : 0;
}
function saveMeta() { lsSet(LS_META, meta); }
function touchMain() {
  meta.rev++;
  meta.mainAt = new Date().toISOString();
  mainSeq++;
  if (tracking) { meta.mainDirty = true; meta.mainGone = false; }
}
function touchSessions(ids, op) {
  meta.rev++;
  for (const id of ids) {
    sessSeq.set(id, (sessSeq.get(id) || 0) + 1);
    if (tracking) meta.outbox[id] = op;
  }
}
const isDirty = () => meta.mainDirty || Object.keys(meta.outbox).length > 0;
const hasLocalData = () => !!(state.main.onboarded || state.sessions.length || (state.main.weights || []).length);
try { loadMeta(); } catch { /* storage unavailable */ }

/** Plain browser: localStorage is the durable store, so nothing ever waits to sync. */
export function setLocalOnly() {
  tracking = false;
  meta.mainDirty = meta.mainAuth = meta.mainGone = false;
  meta.outbox = {};
  meta.known = [];
  saveMeta();
}

/* ---------------- store ---------------- */

const listeners = new Set();
let adapter = localAdapter;
let syncStatus = { kind: 'local', text: localAdapter.label, sub: '' };

export const state = {
  main: defaultMain(),
  sessions: [],
};

/* Apple Health weigh-ins live in memory only (progress.js reads them from HealthKit each app run, spec 6.7).
   They are never written to state.main, the data file or backups; weighIns() merges them in for the readers. */
let healthWeightsFn = () => [];
/** Register the provider of this run's Health weigh-ins ([{d, kg}]; it returns [] while Health is off). */
export function setHealthWeights(fn) { healthWeightsFn = typeof fn === 'function' ? fn : () => []; }
/** The user's own weigh-ins plus this run's Apple Health weigh-ins for days without one of their own, oldest first. */
export function weighIns() {
  const own = (state.main.weights || []).filter((w) => w && w.d && w.kg > 0);
  let extra = [];
  try { extra = healthWeightsFn() || []; } catch { extra = []; }
  const have = new Set(own.map((w) => w.d));
  return [...own, ...extra.filter((h) => h && h.d && h.kg > 0 && !have.has(h.d))].sort((a, b) => (a.d < b.d ? -1 : a.d > b.d ? 1 : 0));
}

export function subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); }
function emit(reason) { for (const fn of listeners) { try { fn(reason); } catch (e) { console.error(e); } } }

export function getSync() { return syncStatus; }
export function currentAdapter() { return adapter; }
/** Status line for the Me tab. sub (optional) explains a warning. */
export function setSync(kind, text, sub = '') { syncStatus = { kind, text, sub }; emit('sync'); }
export { mergeMain };

let storageWarned = false;
/** Write the localStorage mirror. On the plain web it is the only copy, so a failure is shown. */
function writeLocal(k, v) {
  const ok = lsSet(k, v);
  if (!ok && !tracking && !storageWarned) { storageWarned = true; setSync('warn', 'Couldn’t save in this browser', 'Browser storage is full or blocked. Export a backup to keep your latest changes.'); }
  return ok;
}
function writeAllLocal() { writeLocal(LS_MAIN, state.main); writeLocal(LS_SESS, state.sessions); saveMeta(); }

/* ----- sending changes to the durable store ----- */

let retryTimer = null, retryDelay = 0;

/** Device file: every write holds the whole state, so a successful one confirms everything changed before it was asked for. */
function captureFlags() {
  const seq = mainSeq, ops = Object.entries(meta.outbox).map(([id, op]) => [id, op, sessSeq.get(id)]);
  return () => {
    if (seq === mainSeq) meta.mainDirty = meta.mainAuth = meta.mainGone = false;
    for (const [id, op, s] of ops) if (meta.outbox[id] === op && sessSeq.get(id) === s) delete meta.outbox[id];
    saveMeta();
  };
}
function pushMain() {
  const a = adapter, seq = mainSeq, gone = meta.mainGone;
  const confirm = a.writeAll ? captureFlags() : null;
  const p = gone && a.clearMain ? a.clearMain() : a.saveMain(state.main, state.sessions);
  return Promise.resolve(p).then(() => {
    if (a === localAdapter || a !== adapter) return;
    if (confirm) confirm();
    else if (seq === mainSeq) { meta.mainDirty = meta.mainAuth = meta.mainGone = false; saveMeta(); }
  });
}
function pushSession(id) {
  const a = adapter, seq = sessSeq.get(id), op = meta.outbox[id];
  const confirm = a.writeAll ? captureFlags() : null;
  const s = state.sessions.find((x) => x.id === id);
  const p = op === 'del' || !s ? a.deleteSession(id, state.sessions) : a.saveSession(s, state.sessions);
  return Promise.resolve(p).then(() => {
    if (a === localAdapter || a !== adapter) return;
    if (confirm) return confirm();
    if (op === 'del') meta.known = meta.known.filter((k) => k !== id);
    if (sessSeq.get(id) === seq && meta.outbox[id] === op) delete meta.outbox[id];
    saveMeta();
  });
}
/** Send every unconfirmed change. Resolves when the durable store has them; rejects with the first error. */
async function pushDirty() {
  const a = adapter;
  if (a === localAdapter || !isDirty()) return;
  if (a.writeAll) {
    // Device file: one immediate write holds everything changed so far.
    const confirm = captureFlags();
    await a.writeAll(state.main, state.sessions);
    if (a === adapter) confirm();
    return;
  }
  const jobs = [pool(Object.keys(meta.outbox), pushSession, 4)];
  if (meta.mainDirty) jobs.push(pushMain());
  const res = await Promise.allSettled(jobs);
  const bad = res.find((r) => r.status === 'rejected');
  if (bad) throw bad.reason;
}
/** After a successful write: clear a warning once nothing is waiting any more. */
function settle() {
  if (isDirty()) return; // something else is still waiting (and may have a retry scheduled)
  retryDelay = 0;
  clearTimeout(retryTimer);
  if (syncStatus.kind === 'warn' && adapter !== localAdapter) setSync(adapter.name === 'cloud' ? 'ok' : 'local', adapter.label);
}
function onSaveError(e) {
  console.warn('save failed', e);
  const code = e && e.code;
  if (adapter.name === 'cloud') {
    if (code === 'quota_exceeded') setSync('warn', 'Account storage is full', 'Your latest changes are only in this browser. Export a backup to keep them.');
    else setSync('warn', 'Not synced yet', 'Your latest changes are only in this browser for now. Hillpace keeps trying to sync them.');
  } else if (adapter.name === 'device') {
    setSync('warn', 'Couldn’t save to iPhone storage', 'Hillpace will try again. If this keeps happening, free up some space and export a backup.');
  } else {
    setSync('warn', 'Couldn’t save', 'Export a backup to keep your latest changes.');
  }
  // Transient problems are retried with a growing, randomised delay; the rest wait for the next change or app focus.
  if (['invalid_argument', 'quota_exceeded', 'revoked', 'not_granted', 'capability_disabled', 'capability_removed', 'transform_error'].includes(code) || e instanceof TypeError) return;
  clearTimeout(retryTimer);
  retryDelay = Math.min(120000, retryDelay ? retryDelay * 2 : 4000);
  retryTimer = setTimeout(() => { retrySync(); }, retryDelay * (0.75 + Math.random() * 0.5));
}
/** Retry anything not yet confirmed (call when the app comes back to the foreground). */
export function retrySync() {
  if (adapter === localAdapter || !isDirty()) return Promise.resolve();
  return pushDirty().then(settle, onSaveError);
}
/** Write any pending changes now (call when the app goes to the background). Does nothing when nothing changed. */
export async function flush() {
  clearTimeout(saveTimer);
  saveTimer = null;
  if (adapter === localAdapter || !isDirty()) return;
  try { await pushDirty(); settle(); } catch (e) { onSaveError(e); }
}

/* ----- merging (cloud) ----- */

const dayKey = (w) => w && w.d;
function unionBy(a, b, key, pick = (x, y) => y) {
  const m = new Map();
  for (const x of Array.isArray(a) ? a : []) if (key(x) != null) m.set(key(x), x);
  for (const y of Array.isArray(b) ? b : []) if (key(y) != null) m.set(key(y), m.has(key(y)) ? pick(m.get(key(y)), y) : y);
  return [...m.values()];
}
/** Local main has unconfirmed edits and the account has its own copy: keep both sides' entries. */
function mergeMains(local, remote) {
  const localNewer = !remote.updatedAt || (meta.mainAt && meta.mainAt > remote.updatedAt);
  const m = localNewer ? { ...remote, ...local } : { ...local, ...remote }; // settings and plan: the newer side
  m.weights = unionBy(remote.weights, local.weights, dayKey).sort((x, y) => (x.d < y.d ? -1 : 1)); // this device wins a day
  m.measurements = unionBy(remote.measurements, local.measurements, dayKey).sort((x, y) => (x.d < y.d ? -1 : 1));
  m.customs = unionBy(remote.customs, local.customs, (c) => c && c.id, (r, l) => ((r.updated || '') > (l.updated || '') ? r : l));
  const earliest = (x, y) => { const out = { ...(x || {}) }; for (const [k, v] of Object.entries(y || {})) if (!out[k] || (v && v < out[k])) out[k] = v; return out; };
  m.achievements = earliest(remote.achievements, local.achievements);
  m.lessonsRead = earliest(remote.lessonsRead, local.lessonsRead);
  m.onboarded = !!(local.onboarded || remote.onboarded);
  return mergeMain(m);
}
/**
 * Merge the account's session list into this device's. A local session survives unless the account
 * confirmed it before and no longer has it (deleted elsewhere). Returns ids that still need uploading.
 */
function mergeSessions(local, server, { windowFull = false } = {}) {
  const byId = new Map();
  for (const s of server) if (s && s.id != null && meta.outbox[s.id] !== 'del') byId.set(String(s.id), s);
  const known = new Set(meta.known);
  let oldest = null;
  if (windowFull) for (const s of server) if (s && s.date && (!oldest || s.date < oldest)) oldest = s.date;
  const upload = [];
  for (const s of local) {
    const op = meta.outbox[s.id];
    if (op === 'set') { byId.set(s.id, s); continue; } // newer here, still on its way
    if (op === 'del' || byId.has(s.id)) continue;
    if (oldest && s.date < oldest) { byId.set(s.id, s); continue; } // older than the synced window of 1000
    if (known.has(s.id)) continue; // the account had it and doesn't any more
    byId.set(s.id, s); // never reached the account: keep it and send it
    upload.push(s.id);
  }
  return { list: [...byId.values()].sort(byDateDesc), upload };
}

/* ----- public data API ----- */

/** Replace everything with imported data (backup restore). The screen updates at once; resolves once saved. */
export async function replaceAll(main, sessions) {
  clearTimeout(saveTimer);
  saveTimer = null;
  const before = new Set([...state.sessions.map((s) => s.id), ...meta.known]);
  const m = mergeMain(main);
  m.customs = cleanCustoms(m.customs);
  state.main = m;
  state.sessions = cleanSessions(sessions);
  const now = new Set(state.sessions.map((s) => s.id));
  touchMain();
  if (tracking) meta.mainAuth = true;
  touchSessions([...before].filter((id) => !now.has(id)), 'del');
  touchSessions([...now], 'set');
  writeAllLocal();
  emit('load');
  try { await pushDirty(); settle(); } catch (e) { onSaveError(e); }
}

/** Synchronous first load from localStorage (or legacy data) so the UI can paint immediately. */
export function loadLocal() {
  loadMeta();
  const m = lsGet(LS_MAIN);
  const s = lsGet(LS_SESS);
  if (m) {
    state.main = mergeMain(m);
    state.sessions = Array.isArray(s) ? s : [];
  } else {
    const legacy = readLegacy();
    if (legacy) {
      state.main = mergeMain(legacy.main);
      state.sessions = legacy.sessions;
      touchMain();
      touchSessions(legacy.sessions.map((x) => x.id), 'set');
      writeAllLocal();
    }
  }
}

/** Switch to a durable adapter, reconcile with what this device has, and start listening. */
export async function useAdapter(next) {
  let remote;
  try {
    remote = (await next.load()) || {};
  } catch (e) {
    console.warn('storage adapter failed, staying local', e);
    if (next.name === 'cloud') setSync('warn', 'Not synced', 'Couldn’t reach your account. Changes stay in this browser until it’s back.');
    else setSync('warn', 'Saved on this device only', 'Export a backup to keep your data safe.');
    return;
  }
  adapter = next;
  if (next.writeAll) {
    // Device file. localStorage is written first on every change, so when it holds unconfirmed changes at least as new
    // as the file (a write failed, or the app closed first), it wins and is written back.
    const fileRev = remote.rev || 0;
    if (remote.main) {
      if (hasLocalData() && isDirty() && meta.rev >= fileRev) meta.mainDirty = true;
      else {
        state.main = mergeMain(remote.main);
        if (Array.isArray(remote.sessions)) state.sessions = remote.sessions;
        meta.rev = Math.max(meta.rev, fileRev);
        meta.mainDirty = meta.mainAuth = meta.mainGone = false;
        meta.outbox = {};
      }
    } else if (hasLocalData()) meta.mainDirty = true; // new file: seed it from this device
  } else {
    // Account documents.
    const server = Array.isArray(remote.sessions) ? remote.sessions : [];
    if (remote.main && !meta.mainAuth) {
      if (meta.mainDirty && hasLocalData()) state.main = mergeMains(state.main, mergeMain(remote.main)); // stays dirty: pushed below
      else { state.main = mergeMain(remote.main); meta.mainDirty = false; }
    } else if (!remote.main && hasLocalData() && tracking) meta.mainDirty = true; // new account: seed it from this device
    if (meta.mainAuth && tracking) {
      // A restore or erase here hasn't reached the account yet: it replaces the account's sessions too.
      const mine = new Set(state.sessions.map((s) => s.id));
      for (const s of server) if (!mine.has(s.id) && !meta.outbox[s.id]) meta.outbox[s.id] = 'del';
    }
    const { list, upload } = mergeSessions(state.sessions, server, { windowFull: server.length >= 1000 });
    state.sessions = list;
    if (tracking) for (const id of upload) meta.outbox[id] = 'set';
    meta.known = server.map((s) => s.id);
  }
  writeAllLocal();
  if (next.subscribe) next.subscribe();
  setSync(next.name === 'cloud' ? 'ok' : 'local', next.label);
  emit('load');
  if (isDirty()) retrySync();
}

/** Apply a remote change (artifact live sync). Unconfirmed local changes always win. */
export function applyRemote({ main, sessions, windowFull = false }) {
  let changed = false;
  if (main && !meta.mainDirty) { state.main = mergeMain(main); changed = true; }
  if (Array.isArray(sessions)) {
    const { list, upload } = mergeSessions(state.sessions, sessions, { windowFull });
    state.sessions = list;
    meta.known = sessions.map((s) => s.id);
    if (tracking && upload.length) for (const id of upload) meta.outbox[id] = 'set';
    changed = true;
    if (upload.length) setTimeout(retrySync, 0);
  }
  if (!changed) return;
  writeAllLocal();
  emit('remote');
}

let saveTimer = null;
/** Mutate main state. Persists (debounced 250 ms) and notifies listeners. */
export function update(mutator, { silent = false } = {}) {
  mutator(state.main);
  touchMain();
  writeLocal(LS_MAIN, state.main);
  saveMeta();
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveTimer = null;
    pushMain().then(settle, onSaveError);
  }, 250);
  if (!silent) emit('update');
}

function changedSession(id, op) {
  touchSessions([id], op);
  writeLocal(LS_SESS, state.sessions);
  saveMeta();
  pushSession(id).then(settle, onSaveError);
  emit('session');
}

export function addSession(s) {
  state.sessions = [s, ...state.sessions.filter((x) => x.id !== s.id)];
  changedSession(s.id, 'set');
}

export function updateSession(id, patch) {
  const s = state.sessions.find((x) => x.id === id);
  if (!s) return;
  Object.assign(s, patch);
  changedSession(id, 'set');
}

export function deleteSession(id) {
  state.sessions = state.sessions.filter((x) => x.id !== id);
  changedSession(id, 'del');
}

/** Erase everything from this device and the durable store. The screen updates at once; resolves once deleted. */
export async function eraseAll() {
  clearTimeout(saveTimer);
  saveTimer = null;
  const ids = [...new Set([...state.sessions.map((s) => s.id), ...meta.known])];
  const all = state.sessions.slice();
  state.main = defaultMain();
  state.sessions = [];
  for (const k of [LEGACY_KEY, 'incline-coach-ui', 'incline-coach-draft', ...DRAFT_KEYS]) { try { localStorage.removeItem(k); } catch { /* ignore */ } }
  const a = adapter;
  if (a.writeAll || (a === localAdapter && !tracking)) {
    // Device file (or plain web): delete locally, nothing left to sync.
    meta = { ...freshMeta(), rev: meta.rev + 1 };
    writeAllLocal();
    emit('erase');
    try { await a.clear(all); } catch (e) { onSaveError(e); }
    return;
  }
  // Account (or an account still loading): delete through the outbox so an interrupted erase finishes next time.
  touchMain();
  meta.mainAuth = meta.mainGone = true;
  meta.outbox = {};
  touchSessions(ids, 'del');
  writeAllLocal();
  emit('erase');
  try { await pushDirty(); settle(); } catch (e) { onSaveError(e); }
}

export function uid(prefix = '') {
  return prefix + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}
