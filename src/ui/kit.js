// UI kit: icons, sheets, confirms, toasts, topo background, count-up, confetti, small helpers.
import { esc } from '../core/format.js';
import { haptic } from '../core/platform.js';
import { currentRoute, routeDef } from './router.js';

export { esc };
export const $ = (s, r = document) => r.querySelector(s);
export const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
export const RM = typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;

/* ---------------- icons (24px grid, 1.9 stroke, round caps) ---------------- */
const P = {
  today: '<path d="M3 19h18"/><path d="M4 18.5 9.5 10l3.5 4.5 2.5-3 4.5 7"/><circle cx="17" cy="6" r="2.2"/>',
  calendar: '<rect x="3.5" y="5" width="17" height="15.5" rx="3"/><path d="M3.5 10h17M8 3v4M16 3v4"/><path d="m9 15 2 2 4-4"/>',
  plan: '<rect x="3.5" y="5" width="17" height="15.5" rx="3"/><path d="M3.5 10h17M8 3v4M16 3v4"/><path d="M8 14h2M12 14h2M16 14h.01M8 17h2M12 17h2"/>',
  library: '<rect x="4" y="9" width="16" height="11.5" rx="2.5"/><path d="M6 6h12M8 3.2h8"/>',
  progress: '<path d="M4 4v16h16"/><path d="m7.5 14.5 3.5-4 3 2.5 5-6"/>',
  me: '<circle cx="12" cy="8.5" r="3.8"/><path d="M4.5 20c1.2-3.6 4-5.3 7.5-5.3s6.3 1.7 7.5 5.3"/>',
  chevR: '<path d="m9.5 6 6 6-6 6"/>', chevL: '<path d="m14.5 6-6 6 6 6"/>', chevD: '<path d="m6 9.5 6 6 6-6"/>', chevU: '<path d="m6 14.5 6-6 6 6"/>',
  plus: '<path d="M12 5v14M5 12h14"/>', minus: '<path d="M5 12h14"/>', close: '<path d="M6 6l12 12M18 6 6 18"/>',
  play: '<path d="M8 5.5v13a1 1 0 0 0 1.5.86l10.2-6.5a1 1 0 0 0 0-1.72L9.5 4.64A1 1 0 0 0 8 5.5Z" fill="currentColor" stroke="none"/>',
  pause: '<rect x="6.5" y="5" width="3.6" height="14" rx="1.2" fill="currentColor" stroke="none"/><rect x="13.9" y="5" width="3.6" height="14" rx="1.2" fill="currentColor" stroke="none"/>',
  stop: '<rect x="6" y="6" width="12" height="12" rx="2.5" fill="currentColor" stroke="none"/>',
  next: '<path d="M18 5v14"/><path d="M5.5 5.8v12.4c0 .8.9 1.3 1.6.8l8.6-6.2a1 1 0 0 0 0-1.6L7.1 5c-.7-.5-1.6 0-1.6.8Z"/>',
  prev: '<path d="M6 5v14"/><path d="M18.5 5.8v12.4c0 .8-.9 1.3-1.6.8l-8.6-6.2a1 1 0 0 1 0-1.6L16.9 5c.7-.5 1.6 0 1.6.8Z"/>',
  check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>', checkCircle: '<circle cx="12" cy="12" r="9"/><path d="m8 12.3 2.8 2.8L16.5 9.5"/>',
  flag: '<path d="M5 21V4"/><path d="M5 4.5c4-2 6.5 2 11 0v8c-4.5 2-7-2-11 0"/>',
  medal: '<circle cx="12" cy="15" r="5"/><path d="M8.5 10.5 6 3h4l2 5 2-5h4l-2.5 7.5"/>',
  trophy: '<path d="M8 4h8v5a4 4 0 0 1-8 0V4Z"/><path d="M8 6H5a3 3 0 0 0 3 4M16 6h3a3 3 0 0 1-3 4M12 13v4M8.5 20h7M10 17h4"/>',
  flame: '<path d="M12 21c-3.9 0-6.5-2.6-6.5-6 0-3.4 2.6-5.3 3.9-8.5.9 2.2 2.3 3 3.1 3 0-2.7.7-4.5 2.4-6.5.4 3.6 3.6 6.6 3.6 11.5 0 3.7-2.6 6.5-6.5 6.5Z"/>',
  layers: '<path d="m12 3.5 8.5 4.5-8.5 4.5L3.5 8 12 3.5Z"/><path d="m3.5 12 8.5 4.5 8.5-4.5M3.5 16l8.5 4.5 8.5-4.5"/>',
  route: '<circle cx="6" cy="18" r="2.2"/><circle cx="18" cy="6" r="2.2"/><path d="M8 18h7.5a3.5 3.5 0 0 0 0-7h-7a3.5 3.5 0 0 1 0-7H16"/>',
  bolt: '<path d="M13 3 5 13.5h6.5L10.5 21 19 10h-6.5L13 3Z"/>',
  mountain: '<path d="M2.5 19.5 9 8.5l3.5 5.5 2.5-3.5 6.5 9H2.5Z"/><path d="m7.4 11.2 1.6 1.3 1.4-1.2"/>',
  scale: '<rect x="3.5" y="3.5" width="17" height="17" rx="4"/><path d="M7.5 11.5h9a4.5 4.5 0 0 0-9 0Z"/><path d="M12 11.5l1.6-2.4"/>', /* bathroom scale: closed dial window + needle (not a boxed "?") */
  speed: '<path d="M4 16a8 8 0 1 1 16 0"/><path d="m12 16 4-4.5"/><path d="M12 16h.01"/>',
  incline: '<path d="M3 19h18V7.5L3 19Z"/>',
  clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
  heart: '<path d="M12 20s-7.5-4.6-7.5-10.3A4.2 4.2 0 0 1 12 7.2a4.2 4.2 0 0 1 7.5 2.5C19.5 15.4 12 20 12 20Z"/>',
  pulse: '<path d="M3 12.5h4l2-4 3.5 8 2.5-6 1.5 2H21"/>',
  bell: '<path d="M6 16.5V11a6 6 0 1 1 12 0v5.5l1.5 2h-15l1.5-2Z"/><path d="M10 20.5a2.2 2.2 0 0 0 4 0"/>',
  voice: '<path d="M4 9.5v5h3.5L12 18.5v-13L7.5 9.5H4Z"/><path d="M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11"/>',
  mute: '<path d="M4 9.5v5h3.5L12 18.5v-13L7.5 9.5H4Z"/><path d="m16 9.5 5 5M21 9.5l-5 5"/>',
  sliders: '<path d="M4 7h10M18 7h2M4 17h4M12 17h8"/><circle cx="16" cy="7" r="2.2"/><circle cx="10" cy="17" r="2.2"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5.5M12 7.6h.01"/>',
  alert: '<path d="M12 4 2.8 19.5h18.4L12 4Z"/><path d="M12 10v4.5M12 17.2h.01"/>',
  share: '<path d="M12 15V3.5M8 7l4-3.5L16 7"/><path d="M6 11v8.5h12V11"/>',
  download: '<path d="M12 4v11M7.5 11 12 15.5 16.5 11"/><path d="M5 19.5h14"/>',
  upload: '<path d="M12 15.5V4.5M7.5 8.5 12 4l4.5 4.5"/><path d="M5 19.5h14"/>',
  trash: '<path d="M4.5 7h15M9.5 7V4.5h5V7M6.5 7l1 13h9l1-13"/><path d="M10 11v5.5M14 11v5.5"/>',
  edit: '<path d="M4 20h4L19 9l-4-4L4 16v4Z"/><path d="m13.5 6.5 4 4"/>',
  copy: '<rect x="8" y="8" width="12" height="12" rx="2.5"/><path d="M16 8V5.5A1.5 1.5 0 0 0 14.5 4h-9A1.5 1.5 0 0 0 4 5.5v9A1.5 1.5 0 0 0 5.5 16H8"/>',
  refresh: '<path d="M19.5 12a7.5 7.5 0 1 1-2.2-5.3"/><path d="M19.5 4v4.5H15"/>',
  wand: '<path d="m4 20 11-11M14 5l1-2 1 2 2 1-2 1-1 2-1-2-2-1 2-1ZM18.5 11l.6-1.2 1.2-.6-1.2-.6-.6-1.2-.6 1.2-1.2.6 1.2.6.6 1.2Z"/>',
  timer: '<circle cx="12" cy="13.5" r="7.5"/><path d="M12 9.5v4l2.5 1.5M9.5 2.8h5"/>',
  flat: '<path d="M3 15h18"/><path d="M6 11.5h3M11 11.5h3M16 11.5h2"/>',
  stride: '<path d="M3 16.5h18"/><path d="m5 13 3-3 3 3 3-3 3 3"/>',
  climb: '<path d="M3 18h18"/><path d="M4 17.5 16 6.5 20 17.5"/>',
  jog: '<path d="m6 7 5 5-5 5M12.5 7l5 5-5 5"/>',
  run: '<path d="m4 7 4.5 5L4 17M10 7l4.5 5-4.5 5M16 7l4.5 5-4.5 5"/>',
  lock: '<rect x="5" y="10.5" width="14" height="10" rx="2.5"/><path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5"/>',
  swap: '<path d="M4 8h13.5M14 4.5 17.5 8 14 11.5M20 16H6.5M10 12.5 6.5 16l3.5 3.5"/>',
  skipDay: '<path d="M5 12h11M12.5 8l4 4-4 4"/><path d="M20 5v14"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4"/>',
  moon: '<path d="M19.5 14.5A8 8 0 0 1 9.5 4.5a8 8 0 1 0 10 10Z"/>',
  external: '<path d="M13.5 4.5H19.5V10.5M19.5 4.5 11 13"/><path d="M17 14v5.5H4.5V7H10"/>',
  signout: '<path d="M13.5 4.5H7a2.5 2.5 0 0 0-2.5 2.5v10A2.5 2.5 0 0 0 7 19.5h6.5"/><path d="M10 12h10.5M17 8.5l3.5 3.5-3.5 3.5"/>',
  book: '<path d="M4 5.5A2 2 0 0 1 6 3.5h13v14H6a2 2 0 0 0-2 2v-14Z"/><path d="M4 19.5a2 2 0 0 0 2 2h13v-4"/>',
  shield: '<path d="M12 3 4.5 6v5.5c0 4.5 3.2 8 7.5 9.5 4.3-1.5 7.5-5 7.5-9.5V6L12 3Z"/>',
  help: '<circle cx="12" cy="12" r="9"/><path d="M9.6 9.3a2.5 2.5 0 1 1 3.4 2.4c-.6.3-1 .8-1 1.5v.6M12 16.8h.01"/>',
  mail: '<rect x="3" y="5.5" width="18" height="13" rx="2.5"/><path d="m3.8 7 8.2 6 8.2-6"/>',
  star: '<path d="m12 3.5 2.6 5.4 5.9.8-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8L3.5 9.7l5.9-.8L12 3.5Z"/>',
  grip: '<path d="M9 6h.01M15 6h.01M9 12h.01M15 12h.01M9 18h.01M15 18h.01"/>',
  repeat: '<path d="M4 11V9a3 3 0 0 1 3-3h12M16 2.5 19.5 6 16 9.5M20 13v2a3 3 0 0 1-3 3H5M8 21.5 4.5 18 8 14.5"/>',
  eyeOff: '<path d="M3.5 3.5 20.5 20.5M10 6.3A9.7 9.7 0 0 1 12 6c5.5 0 9 6 9 6a15.6 15.6 0 0 1-3 3.6M6.3 7.7A15 15 0 0 0 3 12s3.5 6 9 6a9 9 0 0 0 4-1"/><path d="M9.9 10a3 3 0 0 0 4.1 4.1"/>',
  target: '<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="4.5"/><circle cx="12" cy="12" r=".8" fill="currentColor"/>',
  watch: '<rect x="6.5" y="6" width="11" height="12" rx="3"/><path d="M9 6l.6-3h4.8L15 6M9 18l.6 3h4.8L15 18"/>',
  sparkline: '<path d="M3 17l5-5 4 3 5-7 4 4"/>',
  dots: '<circle cx="5.5" cy="12" r="1.3" fill="currentColor"/><circle cx="12" cy="12" r="1.3" fill="currentColor"/><circle cx="18.5" cy="12" r="1.3" fill="currentColor"/>',
  hand: '<path d="M8 13V5.5a1.5 1.5 0 0 1 3 0V11M11 11V4a1.5 1.5 0 0 1 3 0v7M14 11V5.5a1.5 1.5 0 0 1 3 0V14c0 4-2.5 7-6.5 7-2.6 0-4.3-1.3-5.6-3.6L3.4 14.6a1.5 1.5 0 0 1 2.4-1.8L8 15"/>',
};

/** Inline SVG icon. */
export function icon(name, cls = '') {
  const d = P[name] || P.info;
  return `<svg class="ico ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${d}</svg>`;
}
export const modeIcon = (type) => icon({ walk: 'flat', brisk: 'stride', power: 'climb', jog: 'jog', run: 'run' }[type] || 'flat');

/* ---------------- topographic contour background ---------------- */

/** Deterministic contour-line SVG (every 5th line heavier). Color via currentColor; heavy lines via .strong. */
export function topo({ w = 400, h = 300, seed = 3, lines = 16, cx = 0.72, cy = 0.28 } = {}) {
  let s = seed * 9973;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  const ph = Array.from({ length: 4 }, () => rnd() * Math.PI * 2);
  const amp = [0.12, 0.07, 0.05, 0.03];
  const paths = [];
  for (let k = 1; k <= lines; k++) {
    const r = k * (Math.max(w, h) / lines) * 0.62;
    let d = '';
    for (let i = 0; i <= 72; i++) {
      const a = (i / 72) * Math.PI * 2;
      let m = 1;
      for (let j = 0; j < 4; j++) m += amp[j] * Math.sin((j + 2) * a + ph[j] + k * 0.17);
      const x = w * cx + Math.cos(a) * r * m * 1.25, y = h * cy + Math.sin(a) * r * m * 0.92;
      d += (i ? 'L' : 'M') + x.toFixed(1) + ' ' + y.toFixed(1);
    }
    paths.push(`<path d="${d}Z" class="${k % 5 === 0 ? 'strong' : ''}" fill="none" stroke="currentColor" stroke-width="${k % 5 === 0 ? 1.4 : 0.9}"/>`);
  }
  return `<svg class="topo-bg" viewBox="0 0 ${w} ${h}" preserveAspectRatio="xMidYMid slice" aria-hidden="true">${paths.join('')}</svg>`;
}

/* ---------------- toast ---------------- */
let toastEl, toastT;
export function toast(msg, { ms = 2400 } = {}) {
  if (!toastEl) { toastEl = document.createElement('div'); toastEl.className = 'toast'; toastEl.setAttribute('role', 'status'); toastEl.setAttribute('aria-live', 'polite'); document.body.appendChild(toastEl); }
  toastEl.textContent = msg;
  toastEl.classList.add('show');
  clearTimeout(toastT);
  toastT = setTimeout(() => toastEl.classList.remove('show'), ms);
}

/* ---------------- sheets ---------------- */
const openSheets = [];

/* Modal sheets: everything behind the topmost sheet is made inert (no focus, no taps, hidden from VoiceOver):
   the children of #app, every full-screen .overlay and any lower .sheet-root. Only elements this code made inert
   are released again (marked with data-sheet-inert), so other owners' inert state (e.g. the summary's #app) is kept. */
let inertObserver = null;
function syncInert() {
  const top = openSheets.length ? openSheets[openSheets.length - 1].el : null;
  const want = new Set();
  if (top) document.querySelectorAll('#app > *, body > .overlay, body > .sheet-root').forEach((el) => { if (el !== top) want.add(el); });
  document.querySelectorAll('[data-sheet-inert]').forEach((el) => { if (!want.has(el)) { el.inert = false; el.removeAttribute('data-sheet-inert'); } });
  want.forEach((el) => { if (!el.inert) { el.inert = true; el.setAttribute('data-sheet-inert', ''); } });
  if (top && !inertObserver && typeof MutationObserver !== 'undefined') {
    // an overlay appended while a sheet is open (it sits below the sheet) must not take focus either
    inertObserver = new MutationObserver(() => syncInert());
    inertObserver.observe(document.body, { childList: true });
  } else if (!top && inertObserver) { inertObserver.disconnect(); inertObserver = null; }
}

/**
 * Open a bottom sheet. content: HTML string. Returns {el, body, close}.
 * opts: {title, footer (HTML), onClose, wide, label}
 */
export function sheet(content, { title = '', footer = '', onClose, label } = {}) {
  const root = document.createElement('div');
  root.className = 'sheet-root';
  root.innerHTML = `<div class="sheet-backdrop" data-close></div>
    <div class="sheet" role="dialog" aria-modal="true" aria-label="${esc(label || title || 'Details')}">
      <div class="sheet-handle" aria-hidden="true"></div>
      ${title ? `<div class="sheet-head"><h2 class="title-m">${esc(title)}</h2><button class="icon-btn plain" data-close aria-label="Close">${icon('close')}</button></div>` : ''}
      <div class="sheet-body">${content}</div>
      ${footer ? `<div class="sheet-foot">${footer}</div>` : ''}
    </div>`;
  const prevFocus = document.activeElement;
  document.body.appendChild(root);
  const sh = root.querySelector('.sheet');
  let closed = false;
  const close = (result) => {
    if (closed) return; closed = true;
    root.classList.add('closing'); sh.classList.add('closing');
    const i = openSheets.indexOf(api); if (i >= 0) openSheets.splice(i, 1);
    syncInert(); // the sheet below (or the page) is live again right away; this one is inert while it slides out
    setTimeout(() => { root.remove(); root.removeAttribute('data-sheet-inert'); try { prevFocus && prevFocus.isConnected && !prevFocus.closest('[inert]') && prevFocus.focus && prevFocus.focus(); } catch { /* ignore */ } }, RM ? 0 : 210);
    onClose && onClose(result);
  };
  root.addEventListener('click', (e) => { if (e.target.closest('[data-close]')) close(); });
  // drag the handle down to dismiss
  let y0 = null, dy = 0;
  const head = root.querySelector('.sheet-handle');
  const start = (e) => { y0 = (e.touches ? e.touches[0] : e).clientY; dy = 0; sh.style.transition = 'none'; };
  const move = (e) => { if (y0 == null) return; dy = Math.max(0, (e.touches ? e.touches[0] : e).clientY - y0); sh.style.transform = `translateY(${dy}px)`; };
  const end = () => { if (y0 == null) return; sh.style.transition = ''; if (dy > 90) close(); else sh.style.transform = ''; y0 = null; };
  [head, root.querySelector('.sheet-head')].filter(Boolean).forEach((h) => { h.addEventListener('touchstart', start, { passive: true }); h.addEventListener('touchmove', move, { passive: true }); h.addEventListener('touchend', end); });
  const api = { el: root, body: root.querySelector('.sheet-body'), foot: root.querySelector('.sheet-foot'), close };
  openSheets.push(api);
  syncInert();
  setTimeout(() => { const f = sh.querySelector('[autofocus]') || sh.querySelector('button, [href], input, select, textarea'); try { f && f.focus({ preventScroll: true }); } catch { /* ignore */ } }, 60);
  return api;
}
export function closeAllSheets() { [...openSheets].forEach((s) => s.close()); }
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && openSheets.length) openSheets[openSheets.length - 1].close(); });

/** In-app confirm (the viewer blocks window.confirm). Resolves true/false. */
export function confirmSheet({ title, body = '', confirm = 'Confirm', cancel = 'Cancel', danger = false }) {
  return new Promise((resolve) => {
    let answered = false;
    const s = sheet(`<p class="prose">${body}</p>`, {
      title,
      footer: `<button class="btn" data-no>${esc(cancel)}</button><button class="btn ${danger ? 'btn-danger' : 'btn-primary'}" data-yes>${esc(confirm)}</button>`,
      onClose: () => { if (!answered) resolve(false); },
    });
    s.el.querySelector('[data-yes]').addEventListener('click', () => { answered = true; haptic(danger ? 'warning' : 'light'); resolve(true); s.close(); });
    s.el.querySelector('[data-no]').addEventListener('click', () => { answered = true; resolve(false); s.close(); });
  });
}

/* ---------------- segmented control helper ---------------- */
/** HTML for a segmented control. options: [{value, label}] */
export function segmented(name, options, value, { block = false, label = '' } = {}) {
  return `<div class="seg ${block ? 'block' : ''}" role="group" aria-label="${esc(label || name)}" data-seg="${esc(name)}">${options
    .map((o) => `<button type="button" data-value="${esc(o.value)}" aria-pressed="${String(o.value) === String(value)}">${esc(o.label)}</button>`)
    .join('')}</div>`;
}
/** Wire segmented controls inside root: onChange(name, value). */
export function bindSegmented(root, onChange) {
  root.addEventListener('click', (e) => {
    const b = e.target.closest('[data-seg] button');
    if (!b || !root.contains(b)) return;
    const seg = b.closest('[data-seg]');
    seg.querySelectorAll('button').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
    haptic('selection');
    onChange(seg.dataset.seg, b.dataset.value);
  });
}

/** Switch HTML (accessible checkbox). */
export const switchHtml = (id, checked, label) => `<span class="switch"><input type="checkbox" role="switch" id="${esc(id)}" ${checked ? 'checked' : ''} aria-label="${esc(label || id)}"><span class="track"></span></span>`;

/** Stepper HTML: data-step-for=id; value shown in .val. */
export const stepperHtml = (id, valueText, unit = '', label = '') => `<div class="stepper" data-stepper="${esc(id)}" role="group" aria-label="${esc(label || id)}"><button type="button" data-dir="-1" aria-label="Decrease">${icon('minus')}</button><span class="val num" aria-live="polite">${valueText}${unit ? `<small>${esc(unit)}</small>` : ''}</span><button type="button" data-dir="1" aria-label="Increase">${icon('plus')}</button></div>`;

/* ---------------- count-up ---------------- */
export function countUp(el, to, { from = 0, dec = 0, ms = 900, fmt } = {}) {
  const f = fmt || ((v) => (dec ? v.toFixed(dec) : Math.round(v).toLocaleString()));
  if (RM || from === to) { el.textContent = f(to); return; }
  const t0 = performance.now();
  const step = (now) => { const k = Math.min(1, (now - t0) / ms), e = 1 - Math.pow(1 - k, 3); el.textContent = f(from + (to - from) * e); if (k < 1) requestAnimationFrame(step); };
  requestAnimationFrame(step);
}

/* ---------------- confetti (milestones and records only) ---------------- */
export function confetti() {
  if (RM) return;
  const c = document.createElement('canvas'); c.className = 'confetti-canvas'; document.body.appendChild(c);
  const dpr = window.devicePixelRatio || 1, W = innerWidth, H = innerHeight;
  c.width = W * dpr; c.height = H * dpr;
  const ctx = c.getContext('2d'); ctx.scale(dpr, dpr);
  const cs = getComputedStyle(document.documentElement);
  const cols = ['--m-walk', '--m-power', '--m-jog', '--m-brisk', '--m-run'].map((v) => cs.getPropertyValue(v).trim() || '#999');
  const ps = Array.from({ length: 140 }, () => ({ x: W / 2 + (Math.random() - 0.5) * W * 0.4, y: H * 0.32, vx: (Math.random() - 0.5) * 13, vy: -Math.random() * 12 - 4, r: Math.random() * 6.3, vr: (Math.random() - 0.5) * 0.3, w: 6 + Math.random() * 6, h: 4 + Math.random() * 4, c: cols[(Math.random() * cols.length) | 0] }));
  const t0 = performance.now();
  const f = (now) => {
    const t = now - t0; ctx.clearRect(0, 0, W, H); ctx.globalAlpha = Math.max(0, 1 - Math.max(0, t - 1700) / 900);
    for (const p of ps) { p.vy += 0.3; p.vx *= 0.99; p.x += p.vx; p.y += p.vy; p.r += p.vr; ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.r); ctx.fillStyle = p.c; ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h); ctx.restore(); }
    if (t < 2600) requestAnimationFrame(f); else c.remove();
  };
  requestAnimationFrame(f);
}

/* ---------------- misc ---------------- */
export function debounce(fn, ms = 250) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; }

/** Make a nav bar get a hairline once the page scrolls. */
export function watchScroll(navBar) {
  if (!navBar) return () => {};
  const on = () => navBar.classList.toggle('scrolled', window.scrollY > 4);
  window.addEventListener('scroll', on, { passive: true }); on();
  return () => window.removeEventListener('scroll', on);
}

/** Back label for a pushed screen: the title of the tab it belongs to ("Progress"), else "Back". */
function backLabel() {
  try {
    const def = routeDef(currentRoute().name);
    const tab = def && def.tab && routeDef(def.tab);
    if (tab && tab !== def && tab.title) return tab.title;
  } catch { /* ignore */ }
  return 'Back';
}

/** Standard pushed-screen nav bar HTML. back defaults to the owning tab's title, like iOS. */
export function navBar(title, { back = backLabel(), action = '' } = {}) {
  return `<header class="nav-bar"><button class="nav-back" data-nav-back>${icon('chevL')}${esc(back)}</button><span class="nav-title">${esc(title)}</span><span class="nav-action">${action}</span></header>`;
}

/** Row HTML for grouped lists. */
export function row({ title, sub = '', value = '', iconName = '', href = '', attrs = '', chev = true, danger = false, right = '' }) {
  const tag = href ? 'a' : 'button';
  const hrefAttr = href ? ` href="${esc(href)}"` : ' type="button"';
  return `<${tag} class="row ${iconName ? 'has-icon' : ''} ${danger ? 'danger' : ''}"${hrefAttr} ${attrs}>${iconName ? `<span class="row-icon">${icon(iconName)}</span>` : ''}<span class="row-main"><span class="row-title">${esc(title)}</span>${sub ? `<span class="row-sub">${esc(sub)}</span>` : ''}</span>${value ? `<span class="row-value">${esc(value)}</span>` : ''}${right}${chev ? icon('chevR', 'chev') : ''}</${tag}>`;
}
