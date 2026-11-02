// Migration from the earlier single-file "Incline Interval Coach" page (same artifact URL, versions 1–3).
// That version stored, per user, a doc data/users/<uid>/profile = {profile, weights, updated}
// and a subcollection data/users/<uid>/profile/sessions/<id>. Its calories were GROSS (included resting burn);
// Walking Companion shows NET active calories, so we subtract the resting cost (1 MET) when converting.
import { defaultMain, uid as makeId } from './store.js';

const num = (x) => (typeof x === 'number' && isFinite(x) ? x : null);
const str = (x, max = 300) => (typeof x === 'string' ? x.slice(0, max) : '');
const YMD = /^\d{4}-\d{2}-\d{2}$/;

/** Convert the old {profile, weights, sessions} shape into Walking Companion {main, sessions}. Returns null if nothing usable. */
export function convertV1({ profile, weights, sessions }) {
  const p = profile && typeof profile === 'object' ? profile : {};
  const w = (Array.isArray(weights) ? weights : []).filter((x) => x && YMD.test(x.d) && num(x.kg) > 20 && x.kg < 400).map((x) => ({ d: x.d, kg: Math.round(x.kg * 10) / 10 }));
  const ss = Array.isArray(sessions) ? sessions : [];
  if (!w.length && !ss.length && !p.startWeight) return null;
  const m = defaultMain();
  const paces = p.paces || {};
  m.profile.paces = { ...m.profile.paces, walk: num(paces.walk) || m.profile.paces.walk, power: num(paces.brisk) || m.profile.paces.power, jog: num(paces.jog) || m.profile.paces.jog };
  m.profile.units.speed = p.units === 'mph' ? 'mph' : 'kmh';
  if (num(p.startWeight)) {
    m.profile.startWeight = Math.round(p.startWeight * 10) / 10;
    if (num(p.goalLoss)) m.profile.goalWeight = Math.round((p.startWeight - p.goalLoss) * 10) / 10;
  }
  m.profile.cues.voice = p.voice !== false;
  m.profile.cues.beeps = p.beeps !== false;
  m.weights = [...new Map(w.map((x) => [x.d, x])).values()].sort((a, b) => (a.d < b.d ? -1 : 1));
  // old custom workouts used 'brisk' for power walking
  m.customs = (Array.isArray(p.customs) ? p.customs : []).filter((c) => c && Array.isArray(c.segs) && c.segs.length).map((c) => ({
    id: makeId('c'), name: str(c.name, 40) || 'My workout', updated: Date.now(), intensity: 2,
    segs: c.segs.filter((x) => x && num(x.dur) > 0).map((x) => {
      const type = x.type === 'brisk' ? 'power' : ['walk', 'jog'].includes(x.type) ? x.type : 'power';
      const s = { type, dur: Math.round(x.dur), incline: Math.max(0, Math.min(15, num(x.incline) || 0)), label: str(x.label, 30), role: /warm/i.test(x.label || '') ? 'warm' : /cool/i.test(x.label || '') ? 'cool' : 'work' };
      if (num(x.speed)) s.speed = x.speed;
      if (num(x.add)) s.add = x.add;
      return s;
    }),
  }));
  const kg = (m.weights.length ? m.weights[m.weights.length - 1].kg : m.profile.startWeight) || 80;
  const out = ss.filter((s) => s && typeof s.date === 'string' && !isNaN(new Date(s.date))).map((s) => {
    const sec = Math.max(0, Math.round(num(s.durationSec) || 0));
    const gross = num(s.kcal) || 0;
    const resting = 0.0175 * kg * (sec / 60); // 1 MET = 3.5 ml/kg/min × 5 kcal/L
    const planned = Math.max(sec, Math.round(num(s.plannedSec) || sec));
    return {
      id: str(s.id, 40).replace(/[^a-z0-9]/gi, '') || makeId(),
      date: new Date(s.date).toISOString(),
      workoutId: null, // old ids don't map onto Walking Companion workouts
      name: str(s.name, 60) || 'Treadmill session',
      planSlot: null, level: null, length: Math.round(planned / 60),
      durationSec: sec, plannedSec: planned,
      completion: planned ? Math.min(1, sec / planned) : 1,
      completed: s.completed !== false,
      distanceKm: Math.max(0, num(s.distanceKm) || 0),
      kcal: Math.max(0, Math.round(gross - resting)),
      elevM: Math.max(0, Math.round(num(s.elevM) || 0)),
      rpe: num(s.rpe) >= 1 && s.rpe <= 10 ? Math.round(s.rpe) : null,
      notes: str(s.notes, 300),
      splits: [], nudgeKmh: 0,
      source: s.manual ? 'manual' : 'app',
      imported: 'incline-v1',
    };
  }).sort((a, b) => (a.date < b.date ? 1 : -1));
  return { main: m, sessions: out };
}

/** Read the old per-user documents from the artifact database. Returns converted data or null. */
export async function readArtifactV1(db, uid) {
  try {
    const ref = db.doc('data/users/' + uid + '/profile');
    const [p, s] = await Promise.all([ref.get(), ref.collection('sessions').limit(1000).get()]);
    if (!p.exists && s.empty) return null;
    const d = p.exists ? p.data() || {} : {};
    return convertV1({ profile: d.profile, weights: d.weights, sessions: s.docs.map((x) => x.data()) });
  } catch {
    return null;
  }
}
