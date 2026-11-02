// Who is using Hillpace, and where their data lives. Used by the landing (sign-in) page and Me.
//
//   kind 'claude'   – signed in to claude.ai: data is private to this person's account and syncs across their devices
//   kind 'readonly' – signed in, but the page was shared with view-only access: data can only be kept on this device
//   kind 'guest'    – opened without a claude.ai identity (e.g. a public link while signed out): this device only
//   kind 'device'   – the iPhone app or a plain browser: this device only (iPhone: backed up with the phone)
//
// Names and avatars are display data only and are never stored (store only ids).
import { isNative, isArtifact } from './platform.js';
import { state } from './store.js';

let pending = null;

export function initials(name) {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '';
  return ((parts[0][0] || '') + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase();
}

function local(kind) {
  const name = state.main.profile.name || '';
  return { kind, id: null, name, initials: initials(name), avatarUrl: null, color: null };
}

/** Resolve once per page load (cached). Never rejects. */
export function getIdentity() {
  if (pending) return pending;
  pending = (async () => {
    if (!isArtifact) return local('device');
    try {
      const user = await window.claude.use('user');
      if (!user) return local('guest');
      const me = await user.me();
      if (!me || !me.id) return local('guest');
      let canWrite = null;
      try { canWrite = await user.can('data.write'); } catch { canWrite = null; }
      const name = me.name || state.main.profile.name || '';
      return { kind: canWrite === false ? 'readonly' : 'claude', id: me.id, name, initials: initials(name), avatarUrl: me.avatarUrl || null, color: me.color || null };
    } catch {
      return local('guest');
    }
  })();
  return pending;
}

/** One-line description of where data is kept, for the landing page and Me. */
export function storageLine(id) {
  switch (id && id.kind) {
    case 'claude': return 'Your plan and progress are private to your Claude account and follow you to any device.';
    case 'readonly': return 'You can look around, but this link is view-only, so your progress stays on this device. Ask for “can use” access to save it to your account.';
    case 'guest': return 'You’re not signed in, so your progress stays in this browser. Sign in to Claude to keep it in your own account.';
    default: return isNative ? 'Your plan and progress stay on this iPhone. No account needed.' : 'Your plan and progress stay in this browser. No account needed.';
  }
}
