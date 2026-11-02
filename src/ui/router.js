// Hash router with tab roots and pushed detail screens.
// Routes look like  #today  #plan  #library  #progress  #me  #history  #weight  #records  #me-goal  #lesson-incline
// (claude.ai reserves #settings, #sidebar, #customize, #upgrade, #downloads and #comment-*; none are used.)

const routes = new Map(); // name -> {render(param), tab, title}
let current = { name: null, param: null };
let onChange = () => {};

export const TABS = ['today', 'plan', 'library', 'progress', 'me'];

export function define(name, def) { routes.set(name, def); }
export function setOnChange(fn) { onChange = fn; }

export function parse(hash = location.hash) {
  const h = (hash || '').replace(/^#/, '');
  if (!h) return { name: 'today', param: null };
  const i = h.indexOf('-');
  const name = i < 0 ? h : h.slice(0, i);
  const param = i < 0 ? null : decodeURIComponent(h.slice(i + 1));
  return routes.has(name) ? { name, param } : { name: 'today', param: null };
}

export function go(name, param, { replace = false } = {}) {
  const h = '#' + name + (param != null ? '-' + encodeURIComponent(param) : '');
  if (location.hash === h) { route(); return; }
  if (replace) { history.replaceState(null, '', h); route(); } else location.hash = h;
}

export function back(fallback = 'today') {
  if (history.length > 1 && document.referrer !== undefined && window.__navDepth > 0) { history.back(); }
  else go(fallback, null, { replace: true });
}

export function currentRoute() { return current; }
export function routeDef(name) { return routes.get(name); }

window.__navDepth = 0;
let lastHash = location.hash;
export function route() {
  const next = parse();
  const def = routes.get(next.name);
  const isTab = TABS.includes(next.name) && next.param == null; // #me-goal is a pushed page of the Me tab
  if (location.hash !== lastHash) window.__navDepth = isTab ? 0 : window.__navDepth + 1;
  lastHash = location.hash;
  const prev = current;
  current = next;
  onChange(next, prev, def);
}

window.addEventListener('hashchange', route);
