// Units, number and date formatting. Internal units are always km/h, km, kg, cm, seconds.
import { KMH_PER_MPH, LB_PER_KG } from './science.js';
import { state } from './store.js';

const U = () => state.main.profile.units;

export const isMph = () => U().speed === 'mph';
export const isLb = () => U().weight === 'lb';
export const isFtIn = () => U().height === 'ftin';

export const toSpeed = (kmh) => (isMph() ? kmh / KMH_PER_MPH : kmh);
export const fromSpeed = (v) => (isMph() ? v * KMH_PER_MPH : v);
export const speedUnit = () => (isMph() ? 'mph' : 'km/h');
export const toDist = (km) => (isMph() ? km / KMH_PER_MPH : km);
export const distUnit = () => (isMph() ? 'mi' : 'km');
export const toWeight = (kg) => (isLb() ? kg * LB_PER_KG : kg);
export const fromWeight = (v) => (isLb() ? v / LB_PER_KG : v);
export const weightUnit = () => (isLb() ? 'lb' : 'kg');
export const toElev = (m) => (isMph() ? m * 3.28084 : m);
export const elevUnit = () => (isMph() ? 'ft' : 'm');

export const fmt1 = (n) => (Math.round((+n || 0) * 10) / 10).toFixed(1);
export const fmt2 = (n) => (Math.round((+n || 0) * 100) / 100).toFixed(2);
export const fmtInt = (n) => Math.round(+n || 0).toLocaleString();

export const speedStr = (kmh) => fmt1(toSpeed(kmh));
export const distStr = (km) => fmt2(toDist(km));
export const weightStr = (kg) => (kg == null ? '–' : fmt1(toWeight(kg)));

export function heightStr(cm) {
  if (!cm) return '–';
  if (!isFtIn()) return Math.round(cm) + ' cm';
  const inches = Math.round(cm / 2.54);
  return Math.floor(inches / 12) + '′ ' + (inches % 12) + '″';
}

/** 754 -> "12:34"; 3725 -> "1:02:05" */
export function clock(sec) {
  sec = Math.max(0, Math.round(sec || 0));
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  const ss = String(s).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

/** 2700 -> "45 min", 5400 -> "1 h 30 min" */
export function duration(sec) {
  const m = Math.round((sec || 0) / 60);
  if (m < 60) return m + ' min';
  return Math.floor(m / 60) + ' h' + (m % 60 ? ' ' + (m % 60) + ' min' : '');
}

/** Pace (min per km or mi) from km/h. */
export function pace(kmh) {
  if (!(kmh > 0)) return '–';
  const perUnit = 60 / toSpeed(kmh);
  const m = Math.floor(perUnit), s = Math.round((perUnit - m) * 60);
  return `${m}:${String(s === 60 ? 0 : s).padStart(2, '0')} /${distUnit()}`;
}

/* ---------- dates (local time, keyed as YYYY-MM-DD) ---------- */

export function ymd(d = new Date()) {
  d = new Date(d);
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}
export function parseYmd(s) {
  const [y, m, d] = String(s).split('-').map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
}
export function addDays(d, n) { const x = new Date(d); x.setDate(x.getDate() + n); return x; }
export function startOfWeek(d = new Date()) {
  const x = new Date(d); x.setHours(0, 0, 0, 0);
  x.setDate(x.getDate() - ((x.getDay() + 6) % 7));
  return x;
}
/** ISO weekday 1=Mon..7=Sun */
export const isoDay = (d) => ((new Date(d).getDay() + 6) % 7) + 1;
export const daysBetween = (a, b) => Math.round((startOfDay(b) - startOfDay(a)) / 864e5);
export function startOfDay(d) { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; }
export const sameDay = (a, b) => ymd(a) === ymd(b);

export const DAY_SHORT = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
export const dayName = (d, style = 'short') => new Date(d).toLocaleDateString(undefined, { weekday: style });
export const dateShort = (d) => new Date(d).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
export const dateLong = (d) => new Date(d).toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' });
export const monthYear = (d) => new Date(d).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });

export function relativeDay(d) {
  const n = daysBetween(new Date(), d);
  if (n === 0) return 'Today';
  if (n === 1) return 'Tomorrow';
  if (n === -1) return 'Yesterday';
  if (n > 1 && n < 7) return dayName(d, 'long');
  return dateShort(d);
}

export function greeting(now = new Date()) {
  const h = now.getHours();
  return h < 5 ? 'Late session' : h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
}

/** Escape text for innerHTML. */
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
