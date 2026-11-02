// Landing / sign-in page: the first screen of every visit (once per browser tab), and where "Sign out" returns to.
// Identity comes from the account the person is signed into (claude.ai) or, on the iPhone and in a plain browser,
// from this device. Registers actions.openLanding({ signedOut }) → Promise<'continue' | 'start' | 'restore'>.
import { state } from '../core/store.js';
import { isNative } from '../core/platform.js';
import { getIdentity, storageLine } from '../core/identity.js';
import { actions } from '../ui/actions.js';
import { esc, RM } from '../ui/kit.js';
import { createWalker } from '../ui/walker.js';
import { walkerMark } from '../ui/brand.js';

const KEY = 'wc.entered';
export const entered = () => { try { return sessionStorage.getItem(KEY) === '1'; } catch { return false; } };
const markEntered = (on) => { try { if (on) sessionStorage.setItem(KEY, '1'); else sessionStorage.removeItem(KEY); } catch { /* ignore */ } };

const MARK = walkerMark({ id: 'wcm-ld-g' });

let open = null;

function firstName(n) { return String(n || '').trim().split(/\s+/)[0] || ''; }

function avatarHtml(id) {
  if (id && id.avatarUrl) return `<img class="ld-av" src="${esc(id.avatarUrl)}" alt="">`;
  const ini = id && id.initials;
  return `<span class="ld-av ld-av-ini" aria-hidden="true">${ini ? esc(ini) : '<svg viewBox="0 0 24 24"><circle cx="12" cy="8.5" r="3.8" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M4.5 20c1.2-3.6 4-5.3 7.5-5.3s6.3 1.7 7.5 5.3" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>'}</span>`;
}

function cardHtml(id, { signedOut }) {
  if (!id) {
    return `<div class="ld-who"><span class="ld-av ld-av-ini ld-shimmer" aria-hidden="true"></span><div class="ld-who-text"><p class="ld-kicker">Checking your account…</p><p class="ld-name ld-shimmer-line"></p></div></div>
      <button class="ld-btn" disabled>Continue</button>`;
  }
  const isNew = !state.main.onboarded;
  const first = firstName(id.name);
  const kicker = signedOut ? 'You’re signed out'
    : id.kind === 'claude' ? (isNew ? 'Signed in with Claude' : 'Welcome back')
    : id.kind === 'readonly' ? 'Viewing a shared link'
    : id.kind === 'guest' ? 'Not signed in'
    : isNew ? 'Welcome' : 'Welcome back';
  const name = id.kind === 'claude' || id.kind === 'readonly' ? (id.name || 'Your account') : id.kind === 'guest' ? 'Guest' : (id.name || (isNative ? 'On this iPhone' : 'On this device'));
  const label = signedOut
    ? (first && id.kind === 'claude' ? `Sign in as ${first}` : 'Sign in')
    : isNew
      ? (first && id.kind === 'claude' ? `Get started as ${first}` : 'Get started')
      : (first && (id.kind === 'claude' || id.kind === 'device') ? `Continue as ${first}` : id.kind === 'guest' || id.kind === 'readonly' ? 'Continue on this device' : 'Continue');
  const notYou = id.kind === 'claude' || id.kind === 'readonly';
  return `<div class="ld-who">${avatarHtml(id)}<div class="ld-who-text"><p class="ld-kicker">${esc(kicker)}</p><p class="ld-name">${esc(name)}</p></div></div>
    <button class="ld-btn" data-ld="go">${esc(label)}<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h13M13 6l6 6-6 6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg></button>
    <p class="ld-store">${esc(storageLine(id))}</p>
    <div class="ld-links">
      ${isNew ? '<button class="ld-link" data-ld="restore">Restore from a backup</button>' : ''}
      ${notYou ? '<button class="ld-link" data-ld="notyou" aria-expanded="false">Not you?</button>' : ''}
    </div>
    ${notYou ? `<p class="ld-help" hidden>Walking Companion uses the Claude account you’re signed in with, so your data stays private to you. To use a different account, sign out of Claude, sign in with the other account, then open this link again.</p>` : ''}`;
}

function show({ signedOut = false } = {}) {
  if (open) return open.promise;
  let resolve;
  const promise = new Promise((r) => { resolve = r; });
  const root = document.createElement('div');
  root.className = 'overlay landing';
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-modal', 'true');
  root.setAttribute('aria-label', 'Welcome to Walking Companion');
  root.innerHTML = `<canvas class="ld-canvas" aria-hidden="true"></canvas><div class="ld-veil" aria-hidden="true"></div>
    <div class="ld-inner">
      <header class="ld-brand">
        <span class="ld-mark">${MARK}</span>
        <p class="ld-eyebrow">Your walking coach</p>
        <h1 class="ld-word" tabindex="-1"><span>Walking</span><span>Companion</span></h1>
        <span class="ld-rule" aria-hidden="true"></span>
        <p class="ld-promise">Walking plans that fit where you walk: incline, flat or outdoors.</p>
      </header>
      <div class="ld-space"></div>
      <section class="ld-card" aria-live="polite">${cardHtml(null, { signedOut })}</section>
      <p class="ld-foot">Private by design <i>·</i> No ads <i>·</i> No tracking</p>
    </div>`;
  document.body.appendChild(root);
  document.body.classList.add('immersive', 'landing-open');
  // The figure walks in the open band between the headline and the card, feet just above the card.
  const canvas = root.querySelector('.ld-canvas'), space = root.querySelector('.ld-space');
  const stage = () => { const c = canvas.getBoundingClientRect(), b = space.getBoundingClientRect(); return { top: b.top - c.top - 8, bottom: b.bottom - c.top - 10 }; };
  let walker = null;
  try { walker = createWalker(canvas, { reducedMotion: RM, stage }); } catch (e) { console.warn('walker', e); }
  const ro = walker && typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => walker.layout()) : null;
  if (ro) ro.observe(space);
  const h1 = root.querySelector('.ld-word');
  try { h1.focus({ preventScroll: true }); } catch { /* ignore */ }

  let ident = null;
  const card = root.querySelector('.ld-card');
  getIdentity().then((id) => {
    ident = id;
    if (!root.isConnected) return;
    card.innerHTML = cardHtml(id, { signedOut });
    card.classList.add('ready');
  });

  const close = (result) => {
    if (!open) return;
    open = null;
    markEntered(true);
    root.classList.add('leaving');
    setTimeout(() => {
      if (ro) ro.disconnect();
      if (walker) walker.destroy();
      root.remove();
      document.body.classList.remove('landing-open');
      if (!document.querySelector('.overlay')) document.body.classList.remove('immersive');
      resolve(result);
    }, RM ? 0 : 420);
  };

  root.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-ld]');
    if (!b) return;
    const a = b.dataset.ld;
    if (a === 'go') close(state.main.onboarded ? 'continue' : 'start');
    else if (a === 'notyou') {
      const help = root.querySelector('.ld-help');
      const on = help.hidden;
      help.hidden = !on;
      b.setAttribute('aria-expanded', String(on));
    } else if (a === 'restore') {
      // Restore runs its own file picker and confirmation; afterwards carry on as a returning user.
      await actions.importBackup();
      if (state.main.onboarded) close('restore');
    }
  });
  open = { promise, close, root, get ident() { return ident; } };
  return promise;
}

actions.openLanding = (opts) => show(opts);
/** Sign out: forget this tab's sign-in and show the landing page again. Resolves when the person continues. */
actions.signOut = async () => {
  markEntered(false);
  const r = await show({ signedOut: true });
  actions.refresh();
  return r;
};
