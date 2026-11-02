// App Store screenshots: renders real app screens and frames them with a caption.
// Output: store/screenshots/6.9/<n>-<slug>.png (1320×2868) and store/screenshots/6.3/<n>-<slug>.png (1206×2622). Opaque PNG.
// Usage: node scripts/store-shots.mjs [--page dist/walking-companion.html] [--only 2]
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const root = new URL('..', import.meta.url).pathname;
const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const page = opt('--page', root + 'dist/walking-companion.html');
const only = opt('--only', null);

// Fixture where today is a training day (so Today shows a session, not a rest day).
const fx = JSON.parse(readFileSync(root + 'tests/fixture.json', 'utf8'));
const isoToday = ((new Date().getDay() + 6) % 7) + 1;
const days = [...new Set([1, 3, 5, isoToday])].sort((a, b) => a - b).slice(0, 4);
const storeFx = structuredClone(fx);
storeFx.main.plan.days = days.includes(isoToday) ? days : [1, 3, 5, isoToday];

const wait = (ms) => `await new Promise(r=>setTimeout(r,${ms}));`;
const SHOTS = [
  { slug: 'plan', title: 'Your 12-week\nincline plan', sub: 'Built from your goal, your schedule and your treadmill.', hash: 'today', theme: 'light', bg: 'mist' },
  { slug: 'player', title: 'Big targets.\nSpoken cues.', sub: 'Speed and incline you can read from the belt.', hash: 'today', theme: 'dark', bg: 'basalt',
    js: `(async()=>{document.querySelector('.td-start').click();${wait(800)}document.querySelector('.sheet [data-act="start"]').click();})()`,
    ff: '06:00', ffAfter: '16:30' },
  { slug: 'builder', title: 'Build any\ninterval workout', sub: 'Steps, repeat blocks and live estimates.', hash: 'library', theme: 'light', bg: 'mist',
    js: `(async()=>{const c=[...document.querySelectorAll('.wk-card,button')].find(x=>/Hill Repeats/.test(x.textContent));c&&c.click();${wait(900)}const b=document.querySelector('.sheet [data-act="customise"]');b&&b.click();${wait(900)}window.scrollTo(0,0);})()` },
  { slug: 'adapt', title: 'A plan that\nlistens to effort', sub: 'Rate each session. Next week adjusts.', hash: 'history', theme: 'dark', bg: 'basalt',
    js: `(async()=>{document.querySelector('[data-session]').click();${wait(900)}const b=document.querySelector('.sheet [data-act="s-summary"]');b&&b.click();${wait(1200)}const r=document.querySelector('[data-rpe="6"]');if(r){r.scrollIntoView({block:'center'});r.click();}${wait(600)}const o=document.querySelector('.overlay');const h=[...document.querySelectorAll('.overlay h2,.overlay h3,.overlay .title-m,.overlay .section-title')].find(x=>/How hard/.test(x.textContent));if(o&&h){o.scrollTop=Math.max(0,h.getBoundingClientRect().top+o.scrollTop-28);}})()` },
  { slug: 'trend', title: 'See your real\nweight trend', sub: 'A smoothed trend line, not daily noise.', hash: 'weight', theme: 'light', bg: 'mist' },
  { slug: 'summits', title: 'Climb your way\nto Everest', sub: 'Every metre of incline adds up.', hash: 'records', theme: 'dark', bg: 'basalt' },
];

const SIZES = [{ dir: '6.9', W: 1320, H: 2868, vw: 440, vh: 956 }, { dir: '6.3', W: 1206, H: 2622, vw: 402, vh: 874 }];

const b = await chromium.launch();
for (const size of SIZES) {
  mkdirSync(`${root}store/screenshots/${size.dir}`, { recursive: true });
  for (const [i, s] of SHOTS.entries()) {
    if (only && String(i + 1) !== only) continue;
    // 1) raw app screen
    const ctx = await b.newContext({ viewport: { width: size.vw, height: size.vh }, deviceScaleFactor: 3, colorScheme: s.theme });
    const t = new Date(); t.setHours(7, 40, 0, 0); // a morning session
    await ctx.clock.install({ time: t });
    const p = await ctx.newPage();
    await p.addInitScript(({ fx }) => { if (!sessionStorage.getItem('seeded')) { localStorage.clear(); localStorage.setItem('hp.main.v1', JSON.stringify(fx.main)); localStorage.setItem('hp.sessions.v1', JSON.stringify(fx.sessions)); sessionStorage.setItem('seeded', '1'); sessionStorage.setItem('wc.entered', '1'); } }, { fx: storeFx });
    await p.goto('file://' + page + '#' + s.hash);
    await p.waitForTimeout(1400);
    if (s.js) { await p.evaluate(s.js); await p.waitForTimeout(900); }
    if (s.ff) { await p.clock.fastForward(s.ff); await p.waitForTimeout(800); }
    if (s.ffAfter) { await p.clock.fastForward(s.ffAfter); await p.waitForTimeout(1200); }
    await p.waitForTimeout(600);
    const raw = await p.screenshot({ type: 'png' });
    await ctx.close();
    // 2) frame it
    const fr = await b.newContext({ viewport: { width: size.W, height: size.H }, deviceScaleFactor: 1 });
    const fp = await fr.newPage();
    const k = size.W / 1320;
    const dark = s.bg === 'basalt';
    const html = `<!doctype html><html><head><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Archivo:wdth,wght@62..125,100..900&family=Hanken+Grotesk:wght@500;600&display=swap"><style>
      html,body{margin:0;width:${size.W}px;height:${size.H}px;overflow:hidden}
      body{background:${dark ? 'linear-gradient(160deg,#17302E,#0A1214 60%)' : 'linear-gradient(165deg,#F4F7F5,#E2E9E5)'};color:${dark ? '#ECF2F0' : '#0D1A1C'};font-family:'Hanken Grotesk',sans-serif;position:relative}
      .cap{position:absolute;left:${96 * k}px;right:${96 * k}px;top:${150 * k}px}
      h1{font-family:Archivo,sans-serif;font-stretch:112%;font-weight:830;font-size:${118 * k}px;line-height:1.02;letter-spacing:-.02em;margin:0;white-space:pre-line}
      p{font-size:${46 * k}px;line-height:1.3;margin:${34 * k}px 0 0;color:${dark ? '#A9B6B4' : '#44535A'};font-weight:500}
      .dev{position:absolute;left:50%;top:${700 * k}px;width:${1080 * k}px;transform:translateX(-50%);border-radius:${120 * k}px;padding:${22 * k}px;background:${dark ? '#05090A' : '#0D1A1C'};box-shadow:0 ${50 * k}px ${120 * k}px rgba(0,0,0,${dark ? .55 : .28})}
      .dev img{display:block;width:100%;border-radius:${100 * k}px}
      .topo{position:absolute;inset:0;opacity:${dark ? .07 : .06}}
    </style></head><body><svg class="topo" viewBox="0 0 100 100" preserveAspectRatio="none">${Array.from({ length: 14 }, (_, j) => `<ellipse cx="88" cy="6" rx="${(j + 1) * 9}" ry="${(j + 1) * 6}" fill="none" stroke="${dark ? '#fff' : '#0D1A1C'}" stroke-width=".15"/>`).join('')}</svg>
      <div class="cap"><h1>${s.title}</h1><p>${s.sub}</p></div>
      <div class="dev"><img src="data:image/png;base64,${raw.toString('base64')}"></div></body></html>`;
    await fp.setContent(html);
    await fp.waitForTimeout(1200);
    const out = `${root}store/screenshots/${size.dir}/${i + 1}-${s.slug}.png`;
    writeFileSync(out, await fp.screenshot({ type: 'png', omitBackground: false }));
    await fr.close();
    console.log('saved', out);
  }
}
await b.close();
