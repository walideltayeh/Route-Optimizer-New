// End-to-end journeys against dist/walking-companion.html (Playwright, Node).
//   node scripts/build.mjs --dev && node tests/e2e.mjs [--only a,f,c,d,g,h,e] [--page path/to/walking-companion.html] [--headed]
//   Journey a also runs b (the same fresh user starts the workout).
// Fails (exit 1) on any failed check, page error, console error, or an unregistered cross-screen action.
// Screenshots for review are written to tests/shots/.
import { readFileSync, mkdirSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const PAGE = opt('--page', join(ROOT, 'dist/walking-companion.html'));
const ONLY = (opt('--only', 'a,f,c,d,g,h,e') || '').split(',');
const SHOTS = join(ROOT, 'tests/shots');
mkdirSync(SHOTS, { recursive: true });
if (!existsSync(PAGE)) { console.error(`Missing ${PAGE}. Run: node scripts/build.mjs --dev`); process.exit(1); }

// The fixture is relative to today's date, so regenerate it for every run.
execFileSync(process.execPath, [join(ROOT, 'scripts/fixture.mjs')], { stdio: 'ignore' });
const FIXTURE = readFileSync(join(ROOT, 'tests/fixture.json'), 'utf8');

/* ---------------- tiny harness ---------------- */
const results = [];
let current = null;
function check(cond, msg) {
  current.checks++;
  if (!cond) { current.fail.push(msg); console.log(`    FAIL ${msg}`); } else if (process.env.VERBOSE) console.log(`    ok   ${msg}`);
  return !!cond;
}
class Abort extends Error {}
function must(cond, msg) { if (!check(cond, msg)) throw new Abort(msg); }

const browser = await chromium.launch({ headless: !args.includes('--headed') });

// patch: {key: {...}} merged into the fixture's main.<key> before the app loads (e.g. { readiness: { achilles: true } }).
async function newPage({ fresh = false, theme = 'light', locale = 'en-GB', clock = false, at = null, patch = null } = {}) {
  const ctx = await browser.newContext({ viewport: { width: 393, height: 852 }, deviceScaleFactor: 2, colorScheme: theme, locale });
  const page = await ctx.newPage();
  page.errors = [];
  page.on('pageerror', (e) => page.errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    const t = m.text();
    if (m.type() === 'error') page.errors.push(`console.error: ${t}`);
    else if (m.type() === 'warning' && /\[actions\]/.test(t)) page.errors.push(`unregistered action: ${t}`);
  });
  // A fixed morning start keeps a 45-minute fast-forwarded workout on the same calendar day.
  if (clock || at) { const t = at ? new Date(at) : new Date(); t.setHours(9, 0, 0, 0); await page.clock.install({ time: t }); }
  await page.addInitScript(({ fx, fresh, patch }) => {
    if (sessionStorage.getItem('seeded')) return;
    localStorage.clear();
    if (!fresh) {
      const d = JSON.parse(fx);
      for (const [k, v] of Object.entries(patch || {})) d.main[k] = { ...(d.main[k] || {}), ...v };
      localStorage.setItem('hp.main.v1', JSON.stringify(d.main)); localStorage.setItem('hp.sessions.v1', JSON.stringify(d.sessions));
    }
    sessionStorage.setItem('seeded', '1');
  }, { fx: FIXTURE, fresh, patch });
  await page.goto('file://' + PAGE + '#today');
  await page.waitForTimeout(700);
  return page;
}

async function journey(id, title, fn) {
  if (!ONLY.includes(id)) return;
  current = { id, title, checks: 0, fail: [], errors: [] };
  console.log(`\n[${id}] ${title}`);
  const pages = [];
  const track = (p) => { pages.push(p); return p; };
  try { await fn(track); } catch (e) { if (!(e instanceof Abort)) current.fail.push(`exception: ${e.message.split('\n')[0]}`); console.log(`    ABORT ${e.message.split('\n')[0]}`); }
  for (const p of pages) { current.errors.push(...p.errors); try { await p.context().close(); } catch { /* ignore */ } }
  for (const e of current.errors) console.log(`    ERROR ${e}`);
  results.push(current);
}

/* ---------------- page helpers ---------------- */
const W = (p, ms = 350) => p.waitForTimeout(ms);
const text = (p) => p.evaluate(() => document.body.innerText);
const main = (p) => p.evaluate(() => JSON.parse(localStorage.getItem('hp.main.v1')));
const sessions = (p) => p.evaluate(() => JSON.parse(localStorage.getItem('hp.sessions.v1')));
const visible = (p, sel) => p.locator(sel).first().isVisible().catch(() => false);
async function go(p, hash) { await p.evaluate((h) => { location.hash = h; }, hash); await W(p, 450); }
async function closeSheets(p) {
  for (let i = 0; i < 4 && (await p.locator('.sheet-root:not(.closing)').count()); i++) { await p.keyboard.press('Escape'); await W(p, 320); }
}
async function shot(p, name) { await W(p, 250); await p.screenshot({ path: join(SHOTS, `${name}.png`) }); }
/** Text that the user can actually see (ignores sr-only helpers). */
const visibleText = (p) => p.evaluate(() => {
  const out = [];
  const walk = (n) => {
    if (n.nodeType === 3) { out.push(n.textContent); return; }
    if (n.nodeType !== 1) return;
    const cs = getComputedStyle(n);
    if (cs.display === 'none' || cs.visibility === 'hidden' || n.classList.contains('sr-only') || n.hidden) return;
    for (const c of n.childNodes) walk(c);
  };
  walk(document.body);
  return out.join(' ');
});

/* ---------------- onboarding driver ---------------- */
const onbNext = async (p) => { await W(p, 340); await p.click('.onb-foot [data-act="next"]'); await W(p, 420); };
const onbStep = (p) => p.evaluate(() => { const h = document.querySelector('.onb-stage .onb-page:last-child h1, .onb-stage h1'); return h ? h.textContent.trim() : ''; });

// surface: 'incline' | 'flat' | 'outdoor' (Where will you walk most?); walkOnly: true answers "Walking only" (no jog question).
async function completeOnboarding(p, { days = null, revealShot = 'onb-reveal-light', checkHow = false, surface = 'incline', walkOnly = false } = {}) {
  must(await visible(p, '.overlay.onb'), 'fresh user sees the onboarding overlay');
  await shot(p, 'onb-welcome-light');
  await onbNext(p); // welcome
  must(await visible(p, '[data-pick="goal"][data-value="lose"]'), 'goal step shows goal choices');
  await p.click('[data-pick="goal"][data-value="lose"]');
  await onbNext(p);
  await p.fill('#onb-name', 'Alex');
  await p.click('[data-pick="sex"][data-value="female"]');
  await p.fill('#onb-age', '38');
  await p.locator('#onb-age').blur();
  await onbNext(p);
  must(await visible(p, '#onb-weight'), 'body step shows height and weight');
  await p.click('[data-pick="hunit"][data-value="cm"]'); await W(p, 150);
  await p.click('[data-pick="wunit"][data-value="kg"]'); await W(p, 150);
  await p.fill('#onb-heightCm', '168');
  await p.fill('#onb-weight', '82');
  await p.locator('#onb-weight').blur();
  await onbNext(p);
  must(await visible(p, '[data-range="goal"]'), 'goal-weight step shows the slider');
  await onbNext(p);
  must(await visible(p, '[data-pick="pace"]'), 'pace step shows paces');
  await onbNext(p);
  // Where will you walk most? (before Fitness, so the fitness copy and starting paces match the surface)
  must(await visible(p, '[data-pick="surface"][data-value="incline"]'), 'where-you-walk step shows the surface choices');
  check((await p.locator('[data-pick="surface"]').count()) === 3, 'where-you-walk step offers incline, flat and outdoors');
  check((await p.locator('[data-pick="surface"][aria-checked="true"]').count()) === 0, 'no surface is picked until the user chooses');
  await p.click(`[data-pick="surface"][data-value="${surface}"]`); await W(p, 250);
  await p.click('[data-pick="sunit"][data-value="kmh"]'); await W(p, 150);
  if (surface === 'outdoor') check(!(await visible(p, '[data-pick="hands"]')) && !(await visible(p, '#onb-maxSpeed')), 'outdoors asks no treadmill questions');
  else await p.click('[data-pick="hands"][data-value="yes"]');
  await onbNext(p);
  must(await visible(p, '[data-pick="activity"]'), 'fitness step follows where you walk');
  await p.click('[data-pick="activity"][data-value="some"]');
  await p.click('[data-pick="hard"][data-value="no"]');
  await p.click(`[data-pick="walkOnly"][data-value="${walkOnly ? 'yes' : 'no'}"]`); await W(p, 200);
  if (walkOnly) check(!(await visible(p, '[data-pick="canJog"]')), 'Walking only hides the jogging question');
  else await p.click('[data-pick="canJog"][data-value="yes"]');
  await onbNext(p);
  // Train on 4 days that include today, so Today has a session to start.
  const iso = await p.evaluate(() => ((new Date().getDay() + 6) % 7) + 1); // the page clock may be faked
  const want = new Set(days || [iso, ((iso + 1) % 7) + 1, ((iso + 3) % 7) + 1, ((iso + 4) % 7) + 1]);
  for (let d = 1; d <= 7; d++) {
    const b = p.locator(`[data-pick="day"][data-value="${d}"]`);
    const on = (await b.getAttribute('aria-pressed')) === 'true';
    if (on !== want.has(d)) { await b.click(); await W(p, 120); }
  }
  await onbNext(p);
  must(await visible(p, '[data-pick="q"]'), 'readiness step shows questions');
  const noBtns = p.locator('[data-pick="q"][data-value$=":no"]');
  const n = await noBtns.count();
  for (let i = 0; i < n; i++) { await noBtns.nth(i).click(); await W(p, 60); }
  await p.click('label.onb-check');
  await W(p, 200);
  await onbNext(p);
  must(/kcal|minutes/i.test(await text(p)), 'plan reveal shows the plan');
  check(/estimate/i.test(await text(p)), 'plan reveal labels calories as estimates');
  check(/not a promise/i.test(await text(p)), 'plan reveal says projection is not a promise');
  await shot(p, revealShot);
  if (checkHow) {
    // "How we calculate" must open above the onboarding overlay (me.js shows it as a sheet during full-screen flows)
    await p.click('.overlay.onb [data-act="how"]');
    await W(p, 500);
    const top = await p.evaluate(() => {
      const sh = document.querySelector('.sheet-root:not(.closing)');
      if (!sh) return null;
      const r = sh.querySelector('.sheet').getBoundingClientRect();
      const hit = document.elementFromPoint(r.left + r.width / 2, r.top + 40);
      return { text: sh.innerText, onTop: !!(hit && sh.contains(hit)) };
    });
    check(top && /How we calculate/.test(top.text) && /Mifflin|ACSM/.test(top.text), 'How we calculate opens from the plan reveal');
    check(top && top.onTop, 'How we calculate appears above the onboarding overlay');
    await shot(p, 'f-how-over-onboarding-light');
    await closeSheets(p);
    check(await visible(p, '.overlay.onb'), 'onboarding is still open after closing How we calculate');
  }
  await p.click('.onb-foot [data-act="next"]');
  await W(p, 900);
  check(!(await visible(p, '.overlay.onb')), 'onboarding closes after the reveal');
  return { iso, days: [...want] };
}

/* ---------------- run a workout to the end with Skip ---------------- */
async function startFromSheet(p) {
  must(await visible(p, '.pr-sheet'), 'pre-run sheet opens');
  await W(p, 300);
  await p.click('.pr-sheet [data-act="start"]');
  await W(p, 400);
  must(await visible(p, '.player [data-el="ready"]'), 'get-ready countdown shows');
}
// onStart(p): extra checks once the first interval runs (default: a treadmill speed number and incline).
async function runToEndWithSkips(p, { onStart = null } = {}) {
  // Fake clock: fast-forward most of each interval, then press Skip (so the session is a real, complete one).
  await p.clock.fastForward(6000);
  await W(p, 300);
  must(!(await visible(p, '.player [data-el="ready"]')), 'get-ready countdown finishes');
  if (onStart) await onStart(p);
  else {
    const speed = (await p.textContent('.player [data-el="speed"]')).trim();
    check(/^\d+(\.\d)?$/.test(speed), `player shows a speed number (${speed})`);
    check(await visible(p, '.player [data-el="incline"]'), 'player shows incline');
  }
  for (let i = 0; i < 80 && (await p.locator('.player').count()) && !(await visible(p, '.sm-foot, [data-done]')); i++) {
    const t = await p.textContent('.player [data-el="count"]').catch(() => null);
    if (t == null) break;
    const [m, s] = t.trim().split(':').map(Number);
    const left = (m * 60 + s) * 1000;
    if (left > 1500) await p.clock.fastForward(left - 1200);
    await W(p, 60);
    if (await p.locator('.player [data-act="skip"]').count()) await p.click('.player [data-act="skip"]', { timeout: 2000 }).catch(() => {});
    await W(p, 120);
  }
  await W(p, 900);
}

/* ======================================================================
   a + b) fresh user: onboarding → Today → workout → summary → history
   ====================================================================== */
await journey('a', 'fresh user completes onboarding and lands on Today with a session to start', async (track) => {
  const p = track(await newPage({ fresh: true, clock: true }));
  const chosen = await completeOnboarding(p);
  const leftThisWeek = chosen.days.filter((d) => d >= chosen.iso).length; // earlier days were before the plan began
  const m = await main(p);
  check(m.onboarded === true, 'onboarded flag saved');
  check(m.profile.name === 'Alex' && m.profile.heightCm === 168, 'profile saved from answers');
  check(m.plan.startDate && m.plan.days.length === 4, 'plan saved with 4 training days');
  check(m.weights.length === 1 && m.weights[0].kg === 82, 'first weigh-in saved');
  check(!!m.plan.createdAt, 'plan records when it began (plan.createdAt)');
  must(await visible(p, '.td-start'), 'Today shows a Start button');
  check(/Start/.test(await p.textContent('.td-start')), 'Start button is labelled');
  check(/today’s session/i.test(await text(p)), 'Today shows today’s session');
  check(!/Missed/.test(await p.textContent('.td-week')), 'a new plan shows no missed sessions');
  await shot(p, 'a-today-new-light');

  /* b) start that workout */
  current.title += ' / [b] runs it to the end, rates effort and sees it in History';
  console.log('[b] start the workout, skip to the end, rate effort, check History and Today');
  await p.click('.td-start');
  await W(p, 500);
  await shot(p, 'b-prerun-light');
  await startFromSheet(p);
  await runToEndWithSkips(p);
  must(await visible(p, '[data-rpe="6"]'), 'summary opens with the effort picker');
  check(/workout complete/i.test(await text(p)), 'summary says Workout complete');
  await shot(p, 'b-summary-light');
  await p.click('[data-rpe="6"]');
  await W(p, 300);
  let ss = await sessions(p);
  check(ss.length === 1, 'one session saved');
  check(ss[0] && ss[0].rpe === 6, 'effort 6 saved on the session');
  check(ss[0] && ss[0].completed === true, `session counts as complete (completion ${ss[0] && ss[0].completion})`);
  check(ss[0] && !!ss[0].planSlot, 'session is linked to the plan slot');
  await p.click('[data-done]');
  await W(p, 900);
  check(!(await visible(p, '.overlay')), 'summary closes on Done');
  check((await p.evaluate(() => location.hash)) === '#today', 'Done returns to Today');
  check(await visible(p, '.week-hills .day.today.done'), 'week strip marks today as done');
  check(/done for today/i.test(await text(p)), 'Today shows Done for today');
  check(new RegExp(`1</b> of ${leftThisWeek} done`).test(await p.innerHTML('.td-week')), `week count shows 1 of ${leftThisWeek} done`);
  await shot(p, 'b-today-done-light');
  await go(p, '#history');
  check((await text(p)).includes(ss[0].name), `History lists the session (${ss[0].name})`);
  await shot(p, 'b-history-light');
  check((await sessions(p))[0].rpe === 6, 'effort still saved after closing');
});

/* ======================================================================
   f) a plan that starts next Monday (no training days left this week)
   ====================================================================== */
await journey('f', 'fresh user on a Sunday with weekday training days: plan starts next Monday, never "Week 0"', async (track) => {
  const sun = new Date(); sun.setDate(sun.getDate() + ((7 - sun.getDay()) % 7)); // this Sunday (or today if Sunday)
  const p = track(await newPage({ fresh: true, at: sun }));
  await completeOnboarding(p, { days: [1, 3, 5], revealShot: 'f-reveal-light', checkHow: true });
  const m = await main(p);
  const nextMon = new Date(sun); nextMon.setDate(sun.getDate() + 1);
  const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  check(m.plan.startDate === ymd(nextMon), `plan starts next Monday (${m.plan.startDate})`);
  const t = await visibleText(p);
  check(/Your plan starts/i.test(t), 'Today says when the plan starts');
  check(!/Week 0/i.test(t) && !/week 0/.test(await p.innerHTML('#screen')), 'Today never shows "Week 0"');
  check(/first session/i.test(t), 'Today previews the first session');
  check(await visible(p, '#screen [data-act="open-slot"]'), 'first-session preview opens the plan session');
  check(!/Missed/.test(t), 'nothing is shown as missed');
  await shot(p, 'f-today-future-light');
  await go(p, '#plan');
  const pt = await visibleText(p);
  check(/Starts /.test(pt) && !/Week 0/.test(pt), 'Plan tab says when it starts, not "Week 0"');
  await go(p, '#library');
  const lt = await visibleText(p);
  check(/Your first week/.test(lt) && /Your plan starts/.test(lt), 'Workouts tab shows the first week and its start date');
  await go(p, '#me');
  check(/Your plan starts/.test(await visibleText(p)), 'Me shows when the plan starts');
  // A brand-new user's Progress pages render their empty states
  for (const r of ['progress', 'history', 'weight', 'records']) {
    await go(p, '#' + r);
    const html = await p.innerHTML('#screen');
    check(!/Something went wrong/.test(html) && html.length > 300, `#${r} renders for a new user`);
    check(!/NaN|undefined|Infinity/.test(await visibleText(p)), `#${r} shows no NaN/undefined for a new user`);
    if (r === 'progress' || r === 'history') await shot(p, `f-${r}-new-light`);
  }
});

/* ======================================================================
   c) fixture user: every route, sheets, builder, units
   ====================================================================== */
const ME_PAGES = ['goal', 'treadmill', 'paces', 'cues', 'reminders', 'health', 'appearance', 'data', 'calc', 'safety', 'privacy', 'terms', 'support', 'lessons'];
const ROUTES = ['today', 'plan', 'library', 'progress', 'history', 'weight', 'records', 'me', ...ME_PAGES.map((x) => 'me-' + x), 'lesson-incline'];

await journey('c', 'fixture user visits every route and uses sheets, builder, Quick Draft and units', async (track) => {
  const p = track(await newPage());
  check(!(await visible(p, '.overlay.onb')), 'onboarded user sees no onboarding');
  for (const r of ROUTES) {
    await go(p, '#' + r);
    const html = await p.innerHTML('#screen');
    const bad = /Something went wrong/.test(html);
    const tab = r.split('-')[0];
    check(!bad && html.length > 400, `#${r} renders`);
    const h1 = await p.locator('#screen h1').count();
    check(h1 >= 1, `#${r} has a heading`);
    if (['today', 'plan', 'library', 'progress', 'me'].includes(tab) && !r.includes('-')) {
      check((await p.getAttribute(`.tab[data-tab="${tab}"]`, 'aria-current')) === 'page', `tab bar marks ${tab} as current`);
    }
    // nothing important hidden under the tab bar: the last element can scroll above it
    const overlap = await p.evaluate(() => {
      const tb = document.getElementById('tabbar'); const s = document.querySelector('#screen .screen');
      if (!tb || !s || getComputedStyle(tb).display === 'none') return 0;
      window.scrollTo(0, document.documentElement.scrollHeight);
      const last = [...s.children].filter((c) => c.getBoundingClientRect().height > 0).pop();
      if (!last) return 0;
      const ov = last.getBoundingClientRect().bottom - tb.getBoundingClientRect().top;
      window.scrollTo(0, 0);
      return ov;
    });
    check(overlap <= 0, `#${r}: content clears the tab bar (overlap ${Math.round(overlap)}px)`);
    const hscroll = await p.evaluate(() => document.documentElement.scrollWidth - innerWidth);
    check(hscroll <= 0, `#${r}: no horizontal scroll (${hscroll}px)`);
  }
  // Back from a pushed page returns to its tab
  await go(p, '#me'); await go(p, '#me-paces');
  await p.click('#screen [data-nav-back]'); await W(p, 450);
  check((await p.evaluate(() => location.hash)) === '#me', 'Back from #me-paces returns to #me');

  // Workout detail sheet
  await go(p, '#library');
  await p.click('.lib-card[data-act="open"]');
  await W(p, 500);
  check(await visible(p, '.sheet-root .sheet'), 'workout detail sheet opens');
  check(/Start/.test(await p.textContent('.sheet-root')), 'detail sheet has Start');
  await shot(p, 'c-detail-light');
  await closeSheets(p);

  // Builder: new workout, add a repeat block, save
  const before = (await main(p)).customs.length;
  await p.click('#screen [data-act="new"]');
  await W(p, 600);
  must(await visible(p, '.overlay [data-act="add-rep"]'), 'builder opens');
  await p.fill('#bld-name', 'Lunch hills');
  await p.click('.overlay [data-act="add-rep"]');
  await W(p, 300);
  await shot(p, 'c-builder-light');
  await p.click('.overlay [data-act="save"]');
  await W(p, 800);
  const m1 = await main(p);
  check(m1.customs.length === before + 1, 'builder saves a custom workout');
  const saved = m1.customs[m1.customs.length - 1] || m1.customs[0];
  check(saved && saved.name === 'Lunch hills', 'custom workout keeps its name');
  check(saved && saved.segs.length >= 5, 'custom workout includes the repeat block intervals');
  check(saved && /^c[a-z0-9]+$/.test(saved.id), 'custom id uses store.uid("c")');
  check(!(await visible(p, '.overlay')), 'builder closes after saving');
  await closeSheets(p);
  await go(p, '#library');
  check((await text(p)).includes('Lunch hills'), 'library lists the new workout');

  // Quick Draft
  await p.click('#screen [data-act="quick"]');
  await W(p, 500);
  check(await visible(p, '.sheet-root [data-act="qd-open"]'), 'Quick Draft opens with a preview');
  check(await p.locator('.sheet-root .chart svg').count() > 0, 'Quick Draft shows a chart');
  await shot(p, 'c-quick-light');
  await closeSheets(p);

  // Log weight
  await go(p, '#progress');
  await p.click('#screen [data-act="log-weight"]');
  await W(p, 500);
  must(await visible(p, '.sheet-root [data-act="w-save"]'), 'weight sheet opens');
  await shot(p, 'c-weight-sheet-light');
  await p.click('.sheet-root [data-act="w-save"]');
  await W(p, 500);
  check(!(await visible(p, '.sheet-root .sheet:not(.closing)')), 'weight sheet closes on save');

  // Open a session
  await go(p, '#history');
  await p.click('#screen [data-session]');
  await W(p, 500);
  check(await visible(p, '.sheet-root .sheet'), 'session sheet opens');
  await shot(p, 'c-session-light');
  await closeSheets(p);

  // Units → mph / lb, then the player shows mph
  await go(p, '#me-paces');
  await p.click('[data-seg="u-speed"] button[data-value="mph"]'); await W(p, 300);
  await p.click('[data-seg="u-weight"] button[data-value="lb"]'); await W(p, 300);
  const u = (await main(p)).profile.units;
  check(u.speed === 'mph' && u.weight === 'lb', 'units saved as mph and lb');
  await go(p, '#history');
  check(/\bmi\b/.test(await text(p)) && !/\bkm\b/.test(await text(p)), 'History shows miles, not km');
  await go(p, '#library');
  await p.click('.lib-card[data-act="open"]'); await W(p, 500);
  check(/mph/.test(await p.textContent('.sheet-root')), 'workout detail shows mph');
  await closeSheets(p);
  await go(p, '#weight');
  check(/\blb\b/.test(await text(p)), 'Weight shows lb');
  await go(p, '#today');
  const startSel = (await p.locator('.td-start').count()) ? '.td-start' : '[data-act="easy"]';
  await p.click(startSel);
  await W(p, 500);
  await startFromSheet(p);
  await W(p, 5600);
  check(await visible(p, '.player [data-el="speed"]'), 'player shows speed');
  check(/mph/.test(await p.textContent('.player')), 'player shows mph');
  check(!/km\/h/.test(await p.textContent('.player')), 'player shows no km/h');
  await shot(p, 'c-player-mph-light');
  await p.click('.player [data-act="pause"]'); await W(p, 500);
  await p.click('.sheet-root [data-ps="end"]'); await W(p, 600);
  // under a minute: discard
  if (await visible(p, '.sheet-root [data-yes]')) { await p.click('.sheet-root [data-yes]'); await W(p, 600); }
  check(!(await visible(p, '.player')), 'player closes after ending');
});

/* ======================================================================
   d) noNumbers: no kcal anywhere
   ====================================================================== */
await journey('d', 'noNumbers hides calories on Today, Progress and the summary', async (track) => {
  const p = track(await newPage());
  await go(p, '#me-goal');
  await p.click('label[for="me-sw-nonum"]');
  await W(p, 500);
  check((await main(p)).profile.noNumbers === true, 'noNumbers saved');
  for (const r of ['today', 'progress', 'history', 'records', 'plan', 'library']) {
    await go(p, '#' + r);
    const t = await visibleText(p);
    check(!/kcal|calorie/i.test(t), `#${r} shows no kcal (${(t.match(/.{0,30}(kcal|calorie).{0,30}/i) || [''])[0]})`);
  }
  await go(p, '#weight');
  check(!/\d+(\.\d)?\s*kg\b/.test(await visibleText(p)), '#weight shows no weight figures');
  // A summary opened from history
  await go(p, '#history');
  await p.click('#screen [data-session]');
  await W(p, 500);
  check(!/kcal|calorie/i.test(await visibleText(p)), 'session sheet shows no kcal');
  await p.click('.sheet-root [data-act="s-summary"]');
  await W(p, 900);
  must(await visible(p, '.overlay [data-done]'), 'summary opens from the session sheet');
  const st = await visibleText(p);
  check(!/kcal|calorie/i.test(st), `summary shows no kcal (${(st.match(/.{0,30}(kcal|calorie).{0,30}/i) || [''])[0]})`);
  await shot(p, 'd-summary-nonumbers-light');
  await p.click('.overlay [data-done]'); await W(p, 600);
  // pre-run sheet too
  await go(p, '#today');
  const startSel = (await p.locator('.td-start').count()) ? '.td-start' : '[data-act="easy"]';
  await p.click(startSel); await W(p, 500);
  check(!/kcal|calorie/i.test(await visibleText(p)), 'pre-run sheet shows no kcal');
  await closeSheets(p);
});

/* ======================================================================
   g) safety: steep-session notice for Achilles users, and skip-to-end saves as partial
   ====================================================================== */
await journey('g', 'Achilles user sees the steep-session notice and can cap the incline; skipping to the end saves a partial session', async (track) => {
  // The fixture user answered yes to the Achilles question (Me → Health & safety sets readiness.achilles).
  const p = track(await newPage({ clock: true, patch: { readiness: { achilles: true } } }));
  await go(p, '#library');
  await p.click('.lib-card[data-id="steep"]'); await W(p, 600);
  await p.click('.sheet-root [data-seg="lvl"] button[data-value="2"]'); await W(p, 300);
  must(await visible(p, '.sheet-root .steep-notice'), 'Steep Steady Walk at Burn shows the steep-session notice in the workout sheet');
  check(/Steep session: up to 1\d(\.\d)?% incline/.test(await p.textContent('.sheet-root .steep-notice')), 'notice names the top incline');
  await p.click('.sheet-root [data-seg="lvl"] button[data-value="0"]'); await W(p, 300);
  check(!(await visible(p, '.sheet-root .steep-notice')), 'the Foundation version (under 10%) shows no notice');
  await p.click('.sheet-root [data-seg="lvl"] button[data-value="2"]'); await W(p, 300);
  await shot(p, 'g-steep-detail-light');
  await p.click('.sheet-root [data-act="start"]'); await W(p, 700);
  must(await visible(p, '.pr-sheet .steep-notice'), 'the pre-run sheet shows the steep-session notice');
  await p.click('.pr-sheet [data-act="cap"]'); await W(p, 300);
  check(/Incline capped at 8% today/.test(await p.textContent('.pr-sheet')), 'Cap incline at 8% swaps in the capped notice');
  await shot(p, 'g-steep-prerun-capped-light');
  await startFromSheet(p);
  await p.clock.fastForward(6000); await W(p, 300);
  const run = await p.evaluate(() => JSON.parse(localStorage.getItem('hp.run') || 'null'));
  const top = run ? Math.max(...run.segs.map((x) => x.incline)) : null;
  check(top != null && top <= 8, `the running workout tops out at 8% (got ${top})`);
  // Walk about a minute, then skip every remaining interval.
  await p.clock.fastForward(70000); await W(p, 300);
  for (let i = 0; i < 40 && (await p.locator('.player [data-act="skip"]').count()) && !(await visible(p, '[data-rpe="5"]')); i++) {
    await p.click('.player [data-act="skip"]', { timeout: 2000 }).catch(() => {});
    await W(p, 120);
  }
  await W(p, 900);
  if (await visible(p, '.sheet-root [data-no]')) { await p.click('.sheet-root [data-no]'); await W(p, 700); } // "Save anyway" if offered
  must(await visible(p, '[data-rpe="5"]'), 'summary opens after skipping to the end');
  const st = await text(p);
  check(/Saved as partial/i.test(st) && !/Workout complete/i.test(st), 'summary says Saved as partial, not Workout complete');
  await shot(p, 'g-partial-summary-light');
  await p.click('[data-rpe="5"]'); await W(p, 300);
  const ss = await sessions(p);
  const s0 = ss.find((x) => x.workoutId === 'steep');
  check(s0 && s0.completed === false && s0.completion < 0.98, `the skip-to-end session is not completed (completion ${s0 && s0.completion})`);
  check(s0 && Array.isArray(s0.pauseLog), 'the session carries a pause log for Apple Health');
  await p.click('[data-done]'); await W(p, 900);
  check(!(await visible(p, '.overlay')), 'summary closes on Done');
  // Block 2 runs at Burn: Hill Repeats climbs to 10%, so the plan session sheet shows the notice too.
  const q = track(await newPage({ clock: true, patch: { readiness: { achilles: true }, plan: { block: 2 } } }));
  check(/Block 2 · Burn/i.test(await q.textContent('.td-meter')), 'Today’s plan meter shows one Block 2 · Burn row');
  await go(q, '#plan');
  const slotKey = await q.evaluate(() => { const b = document.querySelector('#screen .pn-sess.today, #screen .pn-sess.upcoming'); return b ? b.dataset.slot : null; });
  must(slotKey, 'Plan tab lists a session to open');
  await q.click(`#screen [data-slot="${slotKey}"]`); await W(q, 600);
  check(await visible(q, '.sheet-root .steep-notice'), `the plan session sheet (${slotKey}) shows the steep-session notice`);
  await shot(q, 'g-steep-plan-sheet-light');
  await closeSheets(q);
});

/* ======================================================================
   h) where you walk: outdoors + walking only, a flat day, Just walk, Me
   ====================================================================== */
await journey('h', 'outdoor walking-only user: effort-coached session, a flat day, Just walk to History, and Me → Where you walk', async (track) => {
  /* (i) fresh onboarding: Outdoors + Walking only → an effort-coached session saved as outdoor */
  const p = track(await newPage({ fresh: true, clock: true }));
  await completeOnboarding(p, { surface: 'outdoor', walkOnly: true, revealShot: 'h-reveal-outdoor-light' });
  const m = await main(p);
  check(m.profile.surface === 'outdoor' && m.profile.walkOnly === true, `onboarding saves surface outdoor and walking only (${m.profile.surface}, ${m.profile.walkOnly})`);
  must(await visible(p, '#screen [data-seg="surface"] button[data-value="outdoor"][aria-pressed="true"]'), 'Today’s Where today control is set to Outdoors');
  check((await p.locator('#screen [data-seg="surface"] button[aria-pressed="true"]').count()) === 1, 'exactly one surface is selected on Today');
  check(!/km\/h|% max/.test(await p.textContent('.td-hero')), 'Today’s session card shows no speed or incline targets outdoors');
  await shot(p, 'h-today-outdoor-light');
  must(await visible(p, '.td-start'), 'Today shows a Start button');
  await p.click('.td-start'); await W(p, 500);
  check(await visible(p, '.pr-sheet [data-seg="surface"] button[data-value="outdoor"][aria-pressed="true"]'), 'the pre-run sheet asks where you are walking, set to Outdoors');
  check(/Before you head out/.test(await p.textContent('.pr-sheet')), 'the pre-run sheet shows outdoor safety tips');
  await shot(p, 'h-prerun-outdoor-light');
  await startFromSheet(p);
  await runToEndWithSkips(p, {
    onStart: async (q) => {
      check(await visible(q, '.player .pl-effort[data-el="panel"]'), 'the player shows the effort panel outdoors');
      check(!(await q.locator('.player [data-el="speed"], .player [data-el="incline"]').count()), 'the player shows no speed or incline target outdoors');
      const panel = await q.textContent('.player [data-el="panel"]');
      check(!/km\/h|mph|%/.test(panel), `no km/h or incline numbers in the player panel (${panel.replace(/\s+/g, ' ').trim()})`);
      check(/\d–\d/.test(await q.textContent('.player [data-el="rpe"]')) && /out of 10/.test(panel), 'the panel shows effort out of 10');
      check((await q.textContent('.player [data-el="talk"]')).trim().length > 5, 'the panel shows the talk test');
      check(!/km\/h/.test(await q.textContent('.player')), 'nothing in the player shows km/h');
      await shot(q, 'h-player-outdoor-light');
    },
  });
  must(await visible(p, '[data-rpe="6"]'), 'summary opens after the outdoor session');
  await p.click('[data-rpe="6"]'); await W(p, 300);
  let ss = await sessions(p);
  check(ss.length === 1 && ss[0].surface === 'outdoor', `the session is saved with surface outdoor (${ss[0] && ss[0].surface})`);
  check(ss[0] && ss[0].completed === true && !!ss[0].planSlot, 'the outdoor session is complete and counts toward the plan');
  check(ss[0] && !(ss[0].splits || []).some((x) => x.type === 'jog' || x.type === 'run'), 'a walking-only session has no jog or run intervals');
  check(ss[0] && (ss[0].splits || []).every((x) => !x.incline), 'an outdoor session records no incline');
  await shot(p, 'h-summary-outdoor-light');
  await p.click('[data-done]'); await W(p, 900);

  /* (iv) Me → Where you walk: three options and the Walking only switch */
  await go(p, '#me');
  check(/Where you walk/.test(await visibleText(p)) && /Outdoors · Walking only/.test(await visibleText(p)), 'Me lists Where you walk: Outdoors · Walking only');
  await go(p, '#me-treadmill');
  check((await p.locator('#screen [data-choice="surface"]').count()) === 3, 'Where you walk offers three options');
  check(await visible(p, '#screen [data-choice="surface"][data-value="outdoor"][aria-checked="true"]'), 'Outdoors is the checked option');
  check(await p.locator('#screen #me-sw-walkonly').count() === 1, 'Where you walk has the Walking only switch');
  check(await p.isChecked('#screen #me-sw-walkonly'), 'the Walking only switch is on');
  check(!(await visible(p, '#screen [data-choice="surface"][data-value="flat"][aria-checked="true"]')), 'only one option is checked');
  await shot(p, 'h-me-where-light');
  await p.click('#screen label[for="me-sw-walkonly"]'); await W(p, 450);
  check((await main(p)).profile.walkOnly === false, 'turning the switch off saves walkOnly false');
  await p.click('#screen label[for="me-sw-walkonly"]'); await W(p, 450);
  check((await main(p)).profile.walkOnly === true, 'turning it back on saves walkOnly true');

  /* (ii) an outdoor walker on a treadmill today: switch Today to Flat → the pre-run sheet has no incline */
  const q = track(await newPage({ clock: true, patch: { profile: { surface: 'outdoor', walkOnly: true } } }));
  must(await visible(q, '#screen [data-seg="surface"] button[data-value="outdoor"][aria-pressed="true"]'), 'fixture user (usually outdoors): Today’s control is set to Outdoors');
  await q.click('#screen [data-seg="surface"] button[data-value="flat"]'); await W(q, 600);
  const tm = await main(q);
  const today = await q.evaluate(() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; });
  check(tm.todaySurface && tm.todaySurface.surface === 'flat' && tm.todaySurface.d === today, `Flat is saved for today only (${JSON.stringify(tm.todaySurface)})`);
  check(tm.profile.surface === 'outdoor', 'the usual surface stays Outdoors');
  check(await visible(q, '#screen [data-seg="surface"] button[data-value="flat"][aria-pressed="true"]'), 'Today now shows Flat');
  check(/Just for today/i.test(await visibleText(q)), 'Today says the choice is just for today');
  await shot(q, 'h-today-flat-light');
  const startSel = (await q.locator('.td-start').count()) ? '.td-start' : '[data-act="easy"]';
  await q.click(startSel); await W(q, 600);
  must(await visible(q, '.pr-sheet'), 'pre-run sheet opens on a flat day');
  check(await visible(q, '.pr-sheet [data-seg="surface"] button[data-value="flat"][aria-pressed="true"]'), 'the pre-run sheet is set to Flat');
  const pr = await q.evaluate(() => {
    const sh = document.querySelector('.pr-sheet');
    const clone = sh.cloneNode(true);
    clone.querySelectorAll('[data-seg="surface"]').forEach((n) => n.remove()); // the picker itself names "Incline"
    return { text: clone.innerText, hill: sh.querySelectorAll('.pr-chart svg path').length, ln: sh.querySelectorAll('.legend .ln').length };
  });
  check(!/incline|\d%/i.test(pr.text), `the flat pre-run sheet shows no incline (${(pr.text.match(/.{0,30}(incline|\d%).{0,30}/i) || [''])[0]})`);
  check(/Top speed/.test(pr.text) && /km\/h/.test(pr.text), 'it shows the top speed instead');
  check(pr.hill === 0 && pr.ln === 0, `its chart has no incline line (paths ${pr.hill}, legend lines ${pr.ln})`);
  await shot(q, 'h-prerun-flat-light');
  await closeSheets(q);

  /* (iii) Just walk from Today: open-ended timer, change pace, hold End → saved and in History */
  must(await visible(q, '#screen [data-act="free"]'), 'Today offers Just walk');
  await q.click('#screen [data-act="free"]'); await W(q, 600);
  must(await visible(q, '.pr-sheet .pr-free'), 'Just walk opens its pre-run card');
  check(/Start walking/.test(await q.textContent('.pr-sheet [data-act="start"]')), 'the button says Start walking');
  await shot(q, 'h-prerun-free-light');
  await startFromSheet(q);
  await q.clock.fastForward(6000); await W(q, 300);
  must(await visible(q, '.player.pl-free'), 'the Just walk player is showing');
  check(!(await q.locator('.player [data-el="left"], .player [data-el="count"], .player [data-act="skip"]').count()), 'Just walk has no time left, interval countdown or Skip');
  const t0 = (await q.textContent('.player [data-el="elapsed"]')).trim();
  await q.clock.fastForward(90000); await W(q, 300);
  const t1 = (await q.textContent('.player [data-el="elapsed"]')).trim();
  check(/^\d+:\d\d$/.test(t1) && t1 !== t0 && /^1:3\d$/.test(t1), `the timer counts up (${t0} → ${t1})`);
  check(await visible(q, '.player [data-pace="brisk"][aria-pressed="true"]'), 'it starts at a brisk walk');
  await q.click('.player [data-pace="power"]'); await W(q, 300);
  check(await visible(q, '.player [data-pace="power"][aria-pressed="true"]'), 'Hard walking is now the chosen pace');
  check(/Hard walking/.test(await q.textContent('.player [data-pace="power"]')), 'the pace button is labelled Hard walking');
  await q.clock.fastForward(10 * 60 * 1000); await W(q, 400);
  const t2 = (await q.textContent('.player [data-el="elapsed"]')).trim();
  check(await visible(q, '.player.pl-free') && /^1[12]:\d\d$/.test(t2), `it keeps going past the first 10 minutes (${t2})`);
  await shot(q, 'h-player-free-light');
  // Hold End for a second (a tap only shows a hint)
  const box = await q.locator('.player .pl-end').boundingBox();
  await q.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await q.mouse.down(); await q.clock.fastForward(1300); await W(q, 200); await q.mouse.up();
  await W(q, 1200);
  must(await visible(q, '.overlay [data-done]'), 'holding End opens the summary');
  check(/Walk complete/i.test(await text(q)), 'the summary says Walk complete');
  await shot(q, 'h-summary-free-light');
  const fs = (await sessions(q)).find((x) => x.workoutId === 'free');
  check(!!fs, 'the walk is saved with workoutId free');
  check(fs && fs.completed === true && fs.completion === 1 && fs.planSlot === null && fs.name === 'Just walk', `it is saved as a completed Just walk outside the plan (${fs && JSON.stringify({ completed: fs.completed, planSlot: fs.planSlot, name: fs.name })})`);
  check(fs && fs.surface === 'flat', `it records today’s surface (${fs && fs.surface})`);
  check(fs && fs.durationSec >= 690 && (fs.splits || []).some((x) => x.type === 'power') && (fs.splits || []).some((x) => x.type === 'brisk'), `it logs the brisk and hard-walking parts (${fs && (fs.splits || []).map((x) => `${x.type} ${x.sec}s`).join(', ')})`);
  await q.click('.overlay [data-done]'); await W(q, 900);
  check(!(await visible(q, '.overlay')), 'summary closes on Done');
  await go(q, '#history');
  check(/Just walk/.test(await visibleText(q)), 'History lists the Just walk');
  await shot(q, 'h-history-light');
});

/* ======================================================================
   e) dark-mode screenshots of each main screen
   ====================================================================== */
await journey('e', 'screenshots of each main screen (dark and light) saved to tests/shots', async (track) => {
  for (const theme of ['dark', 'light']) {
    const p = track(await newPage({ theme }));
    for (const r of ['today', 'plan', 'library', 'progress', 'history', 'weight', 'records', 'me', 'me-goal', 'me-paces', 'me-safety', 'lesson-incline']) {
      await go(p, '#' + r);
      await W(p, 500);
      check(!/Something went wrong/.test(await p.innerHTML('#screen')), `[${theme}] #${r} renders`);
      await shot(p, `e-${r}-${theme}`);
      await p.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
      await shot(p, `e-${r}-bottom-${theme}`);
      await p.evaluate(() => window.scrollTo(0, 0));
    }
    // sheets and overlays
    await go(p, '#library');
    await p.click('.lib-card[data-act="open"]'); await W(p, 600);
    await shot(p, `e-detail-${theme}`);
    await closeSheets(p);
    await go(p, '#plan');
    const slot = p.locator('#screen [data-slot], #screen [data-key]').first();
    if (await slot.count()) { await slot.click(); await W(p, 600); await shot(p, `e-slot-${theme}`); await closeSheets(p); }
    await go(p, '#history');
    await p.click('#screen [data-session]'); await W(p, 500);
    await p.click('.sheet-root [data-act="s-summary"]'); await W(p, 1500);
    await shot(p, `e-summary-${theme}`);
    await p.click('.overlay [data-done]'); await W(p, 600);
    await go(p, '#today');
    const startSel = (await p.locator('.td-start').count()) ? '.td-start' : '[data-act="easy"]';
    await p.click(startSel); await W(p, 600);
    await shot(p, `e-prerun-${theme}`);
    await p.click('.pr-sheet [data-act="start"]'); await W(p, 6000);
    await shot(p, `e-player-${theme}`);
    await p.click('.player [data-act="pause"]'); await W(p, 500);
    await p.click('.sheet-root [data-ps="end"]'); await W(p, 600);
    if (await visible(p, '.sheet-root [data-yes]')) { await p.click('.sheet-root [data-yes]'); await W(p, 600); }
    await go(p, '#library');
    await p.click('#screen [data-act="new"]'); await W(p, 700);
    await shot(p, `e-builder-${theme}`);
    await p.click('.overlay [data-act="cancel"]'); await W(p, 500);
    if (await visible(p, '.sheet-root [data-yes]')) { await p.click('.sheet-root [data-yes]'); await W(p, 500); }
    const f = track(await newPage({ theme, fresh: true }));
    await shot(f, `e-onboarding-${theme}`);
  }
});

await browser.close();

/* ---------------- report ---------------- */
let failed = 0;
console.log('\n================ results ================');
for (const r of results) {
  const ok = !r.fail.length && !r.errors.length;
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  [${r.id}] ${r.title}  (${r.checks} checks${r.fail.length ? `, ${r.fail.length} failed` : ''}${r.errors.length ? `, ${r.errors.length} page/console errors` : ''})`);
}
console.log(`screenshots: ${SHOTS}`);
process.exit(failed ? 1 : 0);
