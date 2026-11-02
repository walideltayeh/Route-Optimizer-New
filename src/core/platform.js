// The only module that touches native APIs. Every function is safe to call on any platform:
// native iOS (Capacitor), the claude.ai artifact viewer, or a plain browser. Nothing here throws.
import { Capacitor, registerPlugin } from '@capacitor/core';
import { state } from './store.js';

export const isNative = (() => { try { return Capacitor.isNativePlatform(); } catch { return false; } })();
export const isArtifact = !isNative && typeof window !== 'undefined' && !!(window.claude && typeof window.claude.use === 'function');
export const env = isNative ? 'ios' : isArtifact ? 'artifact' : 'web';

const P = isNative
  ? {
      Haptics: registerPlugin('Haptics'),
      KeepAwake: registerPlugin('KeepAwake'),
      TextToSpeech: registerPlugin('TextToSpeech'),
      LocalNotifications: registerPlugin('LocalNotifications'),
      App: registerPlugin('App'),
      Filesystem: registerPlugin('Filesystem'),
      Share: registerPlugin('Share'),
      StatusBar: registerPlugin('StatusBar'),
      SplashScreen: registerPlugin('SplashScreen'),
      HealthBridge: registerPlugin('HealthBridge'),
    }
  : {};
export const plugins = P;

const safe = async (fn, fallback) => { try { return await fn(); } catch (e) { if (typeof console !== 'undefined') console.warn('[platform]', e && e.message); return fallback; } };

/** Which optional features this platform offers. The UI hides anything that is false. */
export const features = {
  health: isNative,
  notifications: isNative,
  reminders: isNative,
  lockScreenCues: isNative,
  nativeShare: isNative,
  haptics: isNative || (typeof navigator !== 'undefined' && 'vibrate' in navigator),
};

/* ---------------- haptics ---------------- */

export function haptic(kind = 'light') {
  if (!state.main.profile.haptics) return;
  if (isNative) {
    const H = P.Haptics;
    if (kind === 'success' || kind === 'warning' || kind === 'error') safe(() => H.notification({ type: kind.toUpperCase() }));
    // iOS only plays selectionChanged() between selectionStart() and selectionEnd(); the calls run in order on the main queue.
    else if (kind === 'selection') safe(() => Promise.all([H.selectionStart(), H.selectionChanged(), H.selectionEnd()]));
    else safe(() => H.impact({ style: kind === 'heavy' ? 'HEAVY' : kind === 'medium' ? 'MEDIUM' : 'LIGHT' }));
  } else if (navigator.vibrate) {
    try { navigator.vibrate(kind === 'success' ? [30, 60, 30] : kind === 'medium' || kind === 'heavy' ? 25 : 10); } catch { /* ignore */ }
  }
}

/* ---------------- keep the screen awake ---------------- */

let wakeLock = null, wantAwake = false;
export async function keepAwake(on) {
  wantAwake = on;
  if (isNative) return safe(() => (on ? P.KeepAwake.keepAwake() : P.KeepAwake.allowSleep()));
  if (on) {
    try { if ('wakeLock' in navigator && document.visibilityState === 'visible') wakeLock = await navigator.wakeLock.request('screen'); } catch { wakeLock = null; }
  } else {
    try { wakeLock && (await wakeLock.release()); } catch { /* ignore */ }
    wakeLock = null;
  }
}
if (typeof document !== 'undefined') document.addEventListener('visibilitychange', () => { if (!isNative && wantAwake && document.visibilityState === 'visible') keepAwake(true); });

/* ---------------- voice ---------------- */

let speechQueue = Promise.resolve();
// Every cue is English, so the native voice language is English whatever the device language is
// (a German iPhone would otherwise read English text with a German voice, or not at all).
const EN_TAGS = ['en-US', 'en-GB', 'en-AU', 'en-IE', 'en-ZA', 'en-IN'];
function cueLang() {
  const l = (typeof navigator !== 'undefined' && navigator.language ? navigator.language : '').replace('_', '-').toLowerCase();
  return EN_TAGS.find((t) => t.toLowerCase() === l) || 'en-US';
}
// The saved voice is its stable voiceURI. The plugin wants an index into the current voice list, which changes
// when voices are downloaded or iOS updates, so the index is looked up at speaking time.
let nativeVoiceList = null;
function loadNativeVoices() {
  if (!nativeVoiceList) nativeVoiceList = safe(() => P.TextToSpeech.getSupportedVoices(), { voices: [] }).then((r) => (r && r.voices) || []);
  return nativeVoiceList;
}
const isVoiceUri = (id) => typeof id === 'string' && id !== '' && !/^\d+$/.test(id); // older builds saved a list index
/** Speak a cue. interrupt=true replaces anything still being spoken. */
export function speak(text, { interrupt = false } = {}) {
  const c = state.main.profile.cues;
  if (!c.voice || !text) return;
  if (isNative) {
    const T = P.TextToSpeech;
    const opts = { text, lang: cueLang(), rate: c.rate || 1, pitch: 1, volume: 1, category: 'playback', queueStrategy: interrupt ? 0 : 1 };
    const voiceIdx = isVoiceUri(c.voiceId) ? loadNativeVoices().then((list) => list.findIndex((v) => v.voiceURI === c.voiceId)) : Promise.resolve(-1);
    // One chain keeps cues in order while the voice list loads.
    speechQueue = speechQueue.then(async () => {
      const i = await voiceIdx;
      if (i >= 0) opts.voice = i;
      if (interrupt) await safe(() => T.stop());
      safe(() => T.speak(opts)); // resolves when the utterance ends; don't hold the queue for it
    });
    return;
  }
  try {
    const s = window.speechSynthesis;
    if (!s) return;
    if (interrupt) s.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.rate = Math.max(0.6, Math.min(1.6, c.rate || 1));
    const vs = s.getVoices();
    if (c.voiceId && vs.length) { const v = vs.find((x) => x.voiceURI === c.voiceId); if (v) u.voice = v; }
    s.speak(u);
  } catch { /* speech unavailable */ }
}
export function stopSpeaking() {
  if (isNative) return safe(() => P.TextToSpeech.stop());
  try { window.speechSynthesis && window.speechSynthesis.cancel(); } catch { /* ignore */ }
}
/** [{id, name, lang}] for the voice picker. */
export async function voices() {
  if (isNative) {
    nativeVoiceList = null; // refresh: voices may have been downloaded since
    const list = await loadNativeVoices();
    return list.filter((v) => v && v.voiceURI && /^en/i.test(v.lang || '')).map((v) => ({ id: v.voiceURI, name: v.name, lang: v.lang }));
  }
  try {
    const s = window.speechSynthesis; if (!s) return [];
    let vs = s.getVoices();
    if (!vs.length) await new Promise((r) => { s.onvoiceschanged = r; setTimeout(r, 800); });
    vs = s.getVoices();
    const lang = (navigator.language || 'en').slice(0, 2);
    return vs.filter((v) => (v.lang || '').slice(0, 2) === lang).map((v) => ({ id: v.voiceURI, name: v.name, lang: v.lang }));
  } catch { return []; }
}

/* ---------------- beeps (Web Audio; works in WKWebView after a tap) ---------------- */

let actx = null;
/** Call from a user gesture (Start button) so audio is allowed. */
export function unlockAudio() {
  try {
    if (!actx) actx = new (window.AudioContext || window.webkitAudioContext)();
    if (actx.state === 'suspended') actx.resume();
  } catch { actx = null; }
}
export function beep(kind = 'tick') {
  if (!state.main.profile.cues.beeps || !actx) return;
  const spec = { tick: [880, 0.12, 0.22], go: [1320, 0.32, 0.28], done: [988, 0.5, 0.28] }[kind] || [880, 0.12, 0.2];
  try {
    const [f, d, v] = spec;
    const o = actx.createOscillator(), g = actx.createGain();
    o.type = 'sine'; o.frequency.value = f;
    g.gain.setValueAtTime(v, actx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.0001, actx.currentTime + d);
    o.connect(g).connect(actx.destination);
    o.start(); o.stop(actx.currentTime + d + 0.02);
  } catch { /* ignore */ }
}

/* ---------------- notifications ---------------- */

const CUE_BASE = 1000, CUE_MAX = 56, REMINDER_BASE = 2000;

/** 'granted' | 'denied' | 'prompt' | 'unavailable'. Never shows a prompt. */
export async function notificationPermission() {
  if (!isNative) return 'unavailable';
  const r = await safe(() => P.LocalNotifications.checkPermissions(), null);
  if (!r) return 'unavailable';
  return r.display === 'granted' ? 'granted' : r.display === 'denied' ? 'denied' : 'prompt';
}
/** Shows the system prompt. Only call from an explicit user tap. */
export async function requestNotifications() {
  if (!isNative) return 'unavailable';
  const r = await safe(() => P.LocalNotifications.requestPermissions(), null);
  return r && r.display === 'granted' ? 'granted' : 'denied';
}

async function pendingIds() {
  const r = await safe(() => P.LocalNotifications.getPending(), { notifications: [] });
  return (r.notifications || []).map((n) => +n.id);
}

/**
 * Pre-schedule interval-change notifications so cues still arrive if the phone locks.
 * boundaries: [{at: ms, title, body}] (already sorted). Only schedules when permission is already granted
 * (schedule() would otherwise show the permission prompt by itself).
 */
export async function scheduleCues(boundaries) {
  if (!isNative) return 0;
  await cancelCues();
  if ((await notificationPermission()) !== 'granted') return 0;
  const pend = await pendingIds();
  const budget = Math.max(0, Math.min(CUE_MAX, 64 - pend.filter((id) => id < CUE_BASE || id >= CUE_BASE + 100).length - 1));
  const now = Date.now();
  const list = boundaries.filter((b) => b.at > now + 1500).slice(0, budget).map((b, i) => ({
    id: CUE_BASE + i,
    title: b.title,
    body: b.body || '',
    schedule: { at: new Date(b.at), allowWhileIdle: true },
    sound: 'default', // without a sound iOS shows a silent banner with no vibration
    interruptionLevel: 'timeSensitive',
    threadIdentifier: 'workout',
    foreground: false, // don't show while the app is open (voice cues cover that)
  }));
  if (!list.length) return 0;
  await safe(() => P.LocalNotifications.schedule({ notifications: list }));
  return list.length;
}
/** Cancel pending workout cues and clear delivered ones (training reminders stay). */
export async function cancelCues() {
  if (!isNative) return;
  const ids = Array.from({ length: 100 }, (_, i) => ({ id: CUE_BASE + i }));
  await safe(() => P.LocalNotifications.cancel({ notifications: ids }));
  await safe(() => P.LocalNotifications.removeDeliveredNotifications({ notifications: ids }));
}

/** Weekly training reminders on plan days (ISO 1=Mon..7=Sun) at 'HH:MM'. Only when permission is granted. */
export async function scheduleReminders(days, time) {
  if (!isNative) return false;
  await cancelReminders();
  if ((await notificationPermission()) !== 'granted') return false;
  const [hour, minute] = String(time || '18:00').split(':').map(Number);
  const list = days.map((d, i) => ({
    id: REMINDER_BASE + i,
    title: 'Time for your walk',
    body: 'Your plan has a workout today. Ready when you are.',
    sound: 'default',
    schedule: { on: { weekday: (d % 7) + 1, hour, minute }, allowWhileIdle: true }, // iOS weekday 1 = Sunday
  }));
  await safe(() => P.LocalNotifications.schedule({ notifications: list }));
  return true;
}
export async function cancelReminders() {
  if (!isNative) return;
  await safe(() => P.LocalNotifications.cancel({ notifications: Array.from({ length: 10 }, (_, i) => ({ id: REMINDER_BASE + i })) }));
}

/* ---------------- Apple Health (local HealthBridge plugin) ---------------- */

export async function healthAvailable() {
  if (!isNative) return false;
  const r = await safe(() => P.HealthBridge.isAvailable(), { available: false });
  return !!r.available;
}
/** Shows the Health permission sheet. Only call from an explicit user tap. */
export async function requestHealth() {
  if (!isNative) return false;
  const r = await safe(() => P.HealthBridge.requestAuthorization(), { granted: false });
  return !!r.granted;
}
/**
 * Save a finished session as an indoor walking/running workout. Net active energy only.
 * Returns the HealthKit UUID or null.
 */
/**
 * Wall-clock pauses of a session: s.pauseLog [{start, end}] (ISO) when the player recorded them; otherwise, when the
 * session ran longer than its active time, one pause covering the difference at the end, so the Health workout keeps
 * its real end time and its active duration.
 */
export function sessionPauses(s, startMs, activeMs, endMs) {
  const log = (Array.isArray(s.pauseLog) ? s.pauseLog : [])
    .map((p) => [Date.parse(p && p.start), Date.parse(p && p.end)])
    .filter(([a, b]) => Number.isFinite(a) && Number.isFinite(b) && b > a && a >= startMs && b <= endMs)
    .sort((x, y) => x[0] - y[0]);
  const out = [];
  for (const [a, b] of log) { const last = out[out.length - 1]; if (last && a <= last[1]) last[1] = Math.max(last[1], b); else out.push([a, b]); }
  if (!out.length && endMs - startMs - activeMs > 1000) out.push([startMs + activeMs, endMs]);
  return out;
}
export async function healthSaveWorkout(s) {
  const h = state.main.profile.health;
  if (!isNative || !h.enabled || (s.durationSec || 0) < 60) return null;
  const runSec = (s.splits || []).filter((x) => x.type === 'jog' || x.type === 'run').reduce((a, x) => a + x.sec, 0);
  const startMs = new Date(s.date).getTime();
  const activeMs = (s.durationSec || 0) * 1000;
  const endedMs = Date.parse(s.endedAt || '');
  const endMs = Number.isFinite(endedMs) && endedMs > startMs + activeMs ? endedMs : startMs + activeMs; // durationSec excludes pauses
  const pauses = sessionPauses(s, startMs, activeMs, endMs);
  // Active time -> clock time: add every pause that began before that moment (for a start, also one beginning at it).
  const wall = (activeOffset, isEnd) => {
    let t = startMs + activeOffset;
    for (const [a, b] of pauses) { if (a < t || (!isEnd && a === t)) t += b - a; else break; }
    return Math.min(t, endMs);
  };
  let off = 0;
  const segments = (s.splits || []).filter((x) => x.sec > 0).map((x) => {
    const seg = { start: new Date(wall(off, false)).toISOString(), end: new Date(wall(off + x.sec * 1000, true)).toISOString(), kcal: h.watch ? 0 : x.kcal, distanceM: h.watch ? 0 : x.km * 1000 };
    off += x.sec * 1000;
    return seg;
  });
  const r = await safe(() => P.HealthBridge.saveWorkout({
    start: new Date(startMs).toISOString(),
    end: new Date(endMs).toISOString(),
    pauses: pauses.map(([a, b]) => ({ start: new Date(a).toISOString(), end: new Date(b).toISOString() })),
    activityType: runSec >= (s.durationSec || 0) * 0.5 ? 'running' : 'walking',
    indoor: s.surface !== 'outdoor', // HKMetadataKeyIndoorWorkout / HKWorkoutConfiguration.locationType
    segments,
    totalKcal: h.watch ? 0 : s.kcal,
    totalDistanceM: h.watch ? 0 : (s.distanceKm || 0) * 1000,
    elevationM: s.elevM || 0,
    avgMETs: s.avgMETs || null,
  }), null);
  return r && r.uuid ? r.uuid : null;
}
export async function healthSaveWeight(kg, dateYmd) {
  if (!isNative || !state.main.profile.health.enabled) return false;
  const r = await safe(() => P.HealthBridge.saveBodyMass({ kg, date: new Date(dateYmd + 'T08:00:00').toISOString() }), null);
  return !!(r && r.ok);
}
/** [{d:'YYYY-MM-DD', kg}] weigh-ins from Health (excluding ones this app wrote). */
export async function healthReadWeights(sinceYmd) {
  if (!isNative || !state.main.profile.health.enabled) return [];
  const r = await safe(() => P.HealthBridge.readBodyMass({ since: new Date(sinceYmd + 'T00:00:00').toISOString() }), { samples: [] });
  return (r.samples || []).map((x) => ({ d: String(x.date).slice(0, 10), kg: Math.round(x.kg * 10) / 10, source: 'health' }));
}

/* ---------------- files: export, share, import ---------------- */

let downloadsCap = null;
if (isArtifact) { try { window.claude.use('downloads').then((d) => { downloadsCap = d; }).catch(() => {}); } catch { /* ignore */ } }

const EXPORT_DIR = 'hillpace-export'; // in CACHE; emptied after each share and by clearExports()

/**
 * Offer a text file to the user (share sheet on iOS, save dialog elsewhere).
 * Resolves 'shared' (sheet completed, or the file was handed to the browser), 'cancelled' (share sheet dismissed) or 'failed'.
 * On iOS the temporary copy is deleted again once the share sheet closes.
 */
export async function exportFileResult(filename, text, mime = 'application/json') {
  if (isNative) {
    const path = EXPORT_DIR + '/' + filename;
    const w = await safe(() => P.Filesystem.writeFile({ path, data: text, directory: 'CACHE', encoding: 'utf8', recursive: true }), null);
    if (!w || !w.uri) return 'failed';
    let result = 'shared';
    try { await P.Share.share({ title: filename, files: [w.uri] }); } catch (e) { result = /cancel/i.test(String((e && e.message) || e)) ? 'cancelled' : 'failed'; }
    await safe(() => P.Filesystem.deleteFile({ path, directory: 'CACHE' }));
    return result;
  }
  if (isArtifact) {
    if (!downloadsCap) { try { downloadsCap = await window.claude.use('downloads'); } catch { downloadsCap = null; } }
    if (downloadsCap) { try { await downloadsCap.save({ filename, data: text }); return 'shared'; } catch { return 'failed'; } }
    return 'failed';
  }
  try {
    const url = URL.createObjectURL(new Blob([text], { type: mime }));
    const a = document.createElement('a');
    a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
    return 'shared';
  } catch { return 'failed'; }
}
/** Offer a text file to the user. Returns true only if it was actually shared or saved (false when cancelled). */
export async function exportFile(filename, text, mime = 'application/json') {
  return (await exportFileResult(filename, text, mime)) === 'shared';
}
/** Delete any temporary export copies left on the device (Erase all data). */
export async function clearExports() {
  if (!isNative) return;
  await safe(() => P.Filesystem.rmdir({ path: EXPORT_DIR, directory: 'CACHE', recursive: true }));
}

/**
 * Ask the user to pick a file; resolves with its text or null (cancelled).
 * A file larger than maxBytes is not read and resolves '' (callers treat it as unreadable).
 */
export function pickTextFile(accept = '.json,application/json', { maxBytes = 0 } = {}) {
  return new Promise((resolve) => {
    const inp = document.createElement('input');
    inp.type = 'file'; inp.accept = accept; inp.style.display = 'none';
    inp.onchange = () => {
      const f = inp.files && inp.files[0];
      if (!f) return resolve(null);
      if (maxBytes && f.size > maxBytes) { inp.remove(); return resolve(''); }
      const rd = new FileReader();
      rd.onload = () => resolve(String(rd.result || ''));
      rd.onerror = () => resolve(null);
      rd.readAsText(f);
      inp.remove();
    };
    // Safari 16.4+/Chrome 113+ fire 'cancel' when the picker is dismissed; resolve so callers never hang.
    inp.addEventListener('cancel', () => { inp.remove(); resolve(null); });
    document.body.appendChild(inp);
    inp.click();
  });
}

/* ---------------- app lifecycle & chrome ---------------- */

/** fn(active:boolean) when the app goes to the background / comes back. */
export function onAppState(fn) {
  if (isNative) { safe(() => P.App.addListener('appStateChange', (s) => fn(!!s.isActive))); return; }
  document.addEventListener('visibilitychange', () => fn(document.visibilityState === 'visible'));
}
export function statusBar(style) { // 'light' text on dark backgrounds, or 'dark'
  if (isNative) safe(() => P.StatusBar.setStyle({ style: style === 'light' ? 'DARK' : 'LIGHT' }));
}
export function hideSplash() { if (isNative) safe(() => P.SplashScreen.hide()); }

/** Share plain text: iOS share sheet, Web Share where available, otherwise copy. Returns 'shared' | 'copied' | 'failed'. */
export async function shareText(text, title = 'Walking Companion') {
  if (isNative) { const r = await safe(() => P.Share.share({ title, text }), false); return r === false ? 'failed' : 'shared'; }
  try { if (navigator.share) { await navigator.share({ title, text }); return 'shared'; } } catch (e) { if (e && e.name === 'AbortError') return 'failed'; }
  return (await copyText(text)) ? 'copied' : 'failed';
}

/** Copy text to the clipboard (call from a tap). */
export async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true; } catch { return false; }
}
