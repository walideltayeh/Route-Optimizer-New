// Screenshot helper.  node scripts/shoot.mjs <hash> <outPrefix> [--fresh] [--js "<code run after load>"] [--page dist/walking-companion.html] [--wait ms] [--full]
// Seeds localStorage with tests/fixture.json (unless --fresh) and saves <outPrefix>-light.png and <outPrefix>-dark.png (393x852 @2x).
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const args = process.argv.slice(2);
const hash = args[0] || 'today', out = args[1] || '/tmp/shot';
const opt = (k, d) => { const i = args.indexOf(k); return i > 0 ? args[i + 1] : d; };
const fresh = args.includes('--fresh'), full = args.includes('--full');
const page = opt('--page', new URL('../dist/walking-companion.html', import.meta.url).pathname);
const js = opt('--js', ''), wait = +opt('--wait', 900);
const fx = readFileSync(new URL('../tests/fixture.json', import.meta.url), 'utf8');
const b = await chromium.launch();
const errors = [];
for (const theme of ['light', 'dark']) {
  const ctx = await b.newContext({ viewport: { width: 393, height: 852 }, deviceScaleFactor: 2, colorScheme: theme });
  const p = await ctx.newPage();
  p.on('pageerror', (e) => errors.push(`[${theme}] pageerror: ${e.message}`));
  p.on('console', (m) => { if (m.type() === 'error') errors.push(`[${theme}] console: ${m.text()}`); });
  await p.addInitScript(({ fx, fresh }) => { if (!sessionStorage.getItem('seeded')) { localStorage.clear(); if (!fresh) { const d = JSON.parse(fx); localStorage.setItem('hp.main.v1', JSON.stringify(d.main)); localStorage.setItem('hp.sessions.v1', JSON.stringify(d.sessions)); } sessionStorage.setItem('seeded', '1'); } }, { fx, fresh });
  await p.goto('file://' + page + '#' + hash);
  await p.waitForTimeout(wait);
  if (js) { await p.evaluate(js); await p.waitForTimeout(wait); }
  await p.screenshot({ path: `${out}-${theme}.png`, fullPage: full });
  await ctx.close();
}
await b.close();
console.log(errors.length ? errors.join('\n') : 'no errors', `\nsaved ${out}-light.png ${out}-dark.png`);
