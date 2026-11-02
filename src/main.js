// App shell: boot, storage, tab bar, routing, lifecycle.
import * as store from './core/store.js';
import { state } from './core/store.js';
import { isNative, isArtifact, plugins, onAppState, hideSplash, statusBar, healthSaveWorkout, cancelCues } from './core/platform.js';
import { actions } from './ui/actions.js';
import { icon, toast, closeAllSheets, confirmSheet } from './ui/kit.js';
import { readArtifactV1 } from './core/legacy.js';
import * as router from './ui/router.js';
import { clock, esc } from './core/format.js';

// Screens (each registers its routes and any actions it owns)
import today from './screens/today.js';
import plan from './screens/plan.js';
import library from './screens/library.js';
import progress from './screens/progress.js';
import me from './screens/me.js';
import './screens/builder.js';
import './screens/player.js';
import './screens/summary.js';
import './screens/onboarding.js';

const SCREENS = [today, plan, library, progress, me];
for (const s of SCREENS) for (const r of s.routes || [s]) router.define(r.route, r);

const TABS = [
  { route: 'today', label: 'Today', icon: 'today' },
  { route: 'plan', label: 'Plan', icon: 'plan' },
  { route: 'library', label: 'Workouts', icon: 'library' },
  { route: 'progress', label: 'Progress', icon: 'progress' },
  { route: 'me', label: 'Me', icon: 'me' },
];

const host = document.getElementById('screen');
const tabbar = document.getElementById('tabbar');
tabbar.innerHTML = TABS.map((t) => `<a class="tab" href="#${t.route}" data-tab="${t.route}"><span class="tab-ico">${icon(t.icon)}</span><span>${t.label}</span></a>`).join('');

let cleanup = null;
let renderedKey = '';

const darkScheme = typeof matchMedia === 'function' ? matchMedia('(prefers-color-scheme: dark)') : null;
/** Theme from the saved Appearance, and status-bar text that stays readable on it (also when iOS switches light/dark). */
function applyAppearance() {
  const a = state.main.profile.appearance;
  const el = document.documentElement;
  if (a === 'light' || a === 'dark') el.setAttribute('data-theme', a);
  else if (!isArtifact) el.removeAttribute('data-theme');
  const t = el.getAttribute('data-theme');
  const dark = t ? t === 'dark' : !!(darkScheme && darkScheme.matches);
  statusBar(dark ? 'light' : 'dark');
}
if (darkScheme && darkScheme.addEventListener) darkScheme.addEventListener('change', applyAppearance);

function renderRoute(r, { force = false } = {}) {
  const def = router.routeDef(r.name);
  if (!def) return;
  const key = r.name + ':' + (r.param || '');
  const tab = def.tab || r.name;
  tabbar.querySelectorAll('.tab').forEach((a) => a.setAttribute('aria-current', a.dataset.tab === tab ? 'page' : 'false'));
  // Don't rebuild a screen the user is typing in when background data arrives.
  if (!force && key === renderedKey && host.contains(document.activeElement) && /INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName)) return;
  const sameScreen = key === renderedKey;
  const y = sameScreen ? window.scrollY : 0;
  if (cleanup) { try { cleanup(); } catch (e) { console.error(e); } cleanup = null; }
  const el = document.createElement('div');
  el.className = 'screen' + (def.tab && def.tab !== r.name ? ' push' : '') + (sameScreen ? ' no-anim' : '');
  if (sameScreen) el.style.animation = 'none';
  host.replaceChildren(el);
  try { cleanup = def.render(el, r.param, { refresh: sameScreen }) || null; } catch (e) {
    console.error(e);
    el.innerHTML = `<div class="empty"><p class="title-m">Something went wrong</p><p>${esc(String((e && e.message) || e))}</p><button type="button" class="btn btn-primary" data-go-today>Go to Today</button></div>`;
    const go = el.querySelector('[data-go-today]'); // no inline handler: the iOS build's Content-Security-Policy blocks them
    if (go) go.addEventListener('click', () => { location.hash = '#today'; });
  }
  renderedKey = key;
  window.scrollTo(0, y);
  if (!sameScreen) { const h = el.querySelector('h1'); if (h) { h.setAttribute('tabindex', '-1'); try { h.focus({ preventScroll: true }); } catch { /* ignore */ } } }
}

router.setOnChange((r) => { closeAllSheets(); renderRoute(r); });

actions.refresh = () => renderRoute(router.currentRoute(), { force: false });
actions.go = (name, param) => router.go(name, param);
actions.back = (fallback) => router.back(fallback);

// Re-render on data changes (debounced to one frame)
let raf = 0;
store.subscribe((reason) => {
  if (reason === 'sync') return;
  if (reason === 'load' || reason === 'erase') applyAppearance();
  cancelAnimationFrame(raf);
  raf = requestAnimationFrame(() => {
    if (document.body.classList.contains('immersive')) return; // player/onboarding own the screen
    renderRoute(router.currentRoute());
  });
});

// "Back" buttons in pushed screens
document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-nav-back]');
  if (b) { e.preventDefault(); router.back(b.dataset.navBack || 'today'); }
});

/* ---------------- boot ---------------- */

let artifactDb = null; // {db, uid} on claude.ai, used once to bring over data from the earlier version of this page

/**
 * The earlier "Incline Interval Coach" version of this page stored workouts under a different path.
 * If this account has nothing in Hillpace yet, convert that history and finish setup in edit mode.
 */
async function migrateEarlierVersion() {
  if (!artifactDb || state.main.onboarded || state.sessions.length || state.main.weights.length) return;
  const data = await readArtifactV1(artifactDb.db, artifactDb.uid);
  if (!data || (!data.sessions.length && !data.main.weights.length)) return;
  await store.replaceAll(data.main, data.sessions);
  actions.closeOnboarding && actions.closeOnboarding();
  actions.openOnboarding({ edit: true });
  const n = data.sessions.length, w = data.main.weights.length;
  toast(`Welcome to Hillpace. We brought over ${n} workout${n === 1 ? '' : 's'}${w ? ` and ${w} weigh-in${w === 1 ? '' : 's'}` : ''}. Finish a few questions to build your plan.`, { ms: 6000 });
}

async function chooseAdapter() {
  if (isNative) {
    if (plugins.Filesystem) return store.fileAdapter(plugins.Filesystem);
    return null;
  }
  if (isArtifact) {
    try {
      const [db, user] = await Promise.all([window.claude.use('db'), window.claude.use('user')]);
      if (!db || !user) return null;
      const uid = await user.id();
      if (!uid) return null;
      artifactDb = { db, uid };
      const a = store.artifactAdapter(db, uid, store.applyRemote);
      // Live updates stopped (writes still go through and report their own errors).
      a.onError = () => store.setSync('warn', 'Live sync paused', 'Changes from your other devices show up the next time you open Hillpace.');
      return a;
    } catch { return null; }
  }
  return null;
}

function offerResume() {
  let snap = null;
  try { snap = JSON.parse(localStorage.getItem('hp.run') || 'null'); } catch { snap = null; }
  if (!snap || !snap.engine || snap.engine.finished) return;
  const age = Date.now() - (snap.savedAt || 0);
  if (age > 6 * 3600 * 1000) { try { localStorage.removeItem('hp.run'); } catch { /* ignore */ } return; }
  confirmSheet({
    title: 'Resume your workout?',
    body: `You were ${clock(snap.engine.total || 0)} into <b>${esc(snap.name || 'a workout')}</b> when the app closed.`,
    confirm: 'Resume', cancel: 'Discard',
  }).then((yes) => {
    if (yes) actions.resumeWorkout(snap);
    else { cancelCues(); try { localStorage.removeItem('hp.run'); } catch { /* ignore */ } }
  });
}

async function boot() {
  // Lock-screen cues still pending from a run that ended with the app (force-quit, crash) are stale:
  // no run is active at launch, and resuming a run schedules its cues again.
  if (isNative) cancelCues();
  if (!isNative && !isArtifact) store.setLocalOnly(); // plain browser: localStorage is the only store
  store.loadLocal();
  applyAppearance();
  router.route();
  if (!state.main.onboarded) actions.openOnboarding({ edit: false });
  hideSplash();

  const adapter = await chooseAdapter();
  if (adapter) {
    const wasOnboarded = state.main.onboarded;
    await store.useAdapter(adapter);
    // An account that already has data skips onboarding on a new device.
    if (!wasOnboarded && state.main.onboarded) { actions.closeOnboarding && actions.closeOnboarding(); renderRoute(router.currentRoute(), { force: true }); }
    try { await migrateEarlierVersion(); } catch (e) { console.warn('migration skipped', e); }
  }
  if (state.main.onboarded) offerResume();
  retryHealthSaves();
}

/** Save workouts to Apple Health that were finished but never saved (e.g. the app closed on the summary). */
async function retryHealthSaves() {
  if (!isNative || !state.main.profile.health.enabled) return;
  const weekAgo = Date.now() - 7 * 864e5;
  for (const s of state.sessions.filter((x) => x.healthPending && !x.healthUUID && new Date(x.date).getTime() > weekAgo)) {
    const uuid = await healthSaveWorkout(s);
    store.updateSession(s.id, uuid ? { healthUUID: uuid, healthPending: false } : { healthPending: true });
  }
}

onAppState((active) => {
  if (!active) { store.flush(); return; }
  store.retrySync(); // anything that failed to save or sync earlier
  if (!document.body.classList.contains('immersive')) actions.refresh(); // dates may have rolled over
});

window.addEventListener('error', (e) => console.error('[hillpace]', e.message));
boot().catch((e) => { console.error(e); toast('Something went wrong while starting. Your data is safe.'); });
