// Build: bundles src/ into
//   dist/walking-companion.html  – single self-contained page (claude.ai artifact / any browser; Google Fonts link)
//   www/index.html      – full document for the Capacitor iOS app (fonts bundled, fully offline)
// Usage: node scripts/build.mjs [--dev]
import { build } from 'esbuild';
import { readFileSync, writeFileSync, mkdirSync, readdirSync, copyFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dev = process.argv.includes('--dev');
const outArg = process.argv.indexOf('--out');
const outDir = outArg > 0 ? process.argv[outArg + 1] : null; // optional private output dir for parallel work
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
// In-app support address (Me → Support): package.json "config.supportEmail".
const PLACEHOLDER_EMAIL = 'support@walkingcompanion.app';
const supportEmail = String((pkg.config && pkg.config.supportEmail) || PLACEHOLDER_EMAIL).trim();
// Used in place of the email while the email is still the placeholder (package.json "config.supportUrl").
const supportUrl = String((pkg.config && pkg.config.supportUrl) || '').trim();
if (supportUrl && !/^https:\/\/[^\s"'<>]+$/.test(supportUrl)) { console.error(`package.json config.supportUrl must be an https URL: ${supportUrl}`); process.exit(1); }
if (!/^[^\s@"'<>]+@[^\s@"'<>]+\.[^\s@"'<>]+$/.test(supportEmail)) { console.error(`package.json config.supportEmail is not an email address: ${supportEmail}`); process.exit(1); }
if (!dev && supportEmail === PLACEHOLDER_EMAIL) {
  console.warn(`\n  WARNING: the in-app support address is still the placeholder ${PLACEHOLDER_EMAIL}.\n  Set package.json "config.supportEmail" before an App Store build (APP_STORE.md section 10).\n`);
}

const r = await build({
  entryPoints: [join(root, 'src/main.js')],
  bundle: true, format: 'iife', write: false, minify: !dev, sourcemap: false,
  target: ['safari15', 'chrome100'], legalComments: 'none',
  define: { __APP_VERSION__: JSON.stringify(pkg.version || '1.0.0'), __SUPPORT_EMAIL__: JSON.stringify(supportEmail), __SUPPORT_URL__: JSON.stringify(supportUrl) },
});
const js = r.outputFiles[0].text.replace(/<\/script/gi, '<\\/script');

const cssFiles = ['tokens.css', 'base.css', 'components.css'].map((f) => join(root, 'src/styles', f));
const screensDir = join(root, 'src/screens');
for (const f of readdirSync(screensDir).sort()) if (f.endsWith('.css')) cssFiles.push(join(screensDir, f));
let css = cssFiles.map((f) => `/* ${f.split('/src/')[1]} */\n` + readFileSync(f, 'utf8')).join('\n');
if (!dev) css = css.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\n\s*\n/g, '\n');

const body = `<div id="app"><main id="screen" class="screen-host"></main><nav id="tabbar" class="tabbar" aria-label="Main"></nav></div>`;
const desc = 'Walking Companion: incline treadmill interval plans with voice cues, a 12-week plan and progress tracking.';

// 1) single-file page (the artifact wrapper supplies doctype/head/body)
const artifactCss = `:root{--flow-top:0px;--sticky-top:env(safe-area-inset-top,0px)}`;
const page = `<title>Walking Companion</title>
<meta name="claude:viewport-fit-sides" content="cover">
<meta name="description" content="${desc}">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Archivo:wdth,wght@62..125,100..900&family=Hanken+Grotesk:wght@400..700&display=swap">
<style>${css}\n${artifactCss}</style>
${body}
<script>${js}</script>
`;
const distDir = outDir || join(root, 'dist');
mkdirSync(distDir, { recursive: true });
writeFileSync(join(distDir, 'walking-companion.html'), page);
if (outDir) { console.log('built ' + join(distDir, 'walking-companion.html')); process.exit(0); }

// 2) Capacitor document. Pinch-zoom stays enabled (no user-scalable=no) and text follows Dynamic Type (base.css).
const fontsCss = readFileSync(join(root, 'assets/fonts/local-fonts.css'), 'utf8');
// Content-Security-Policy: only the inline bundle (by hash) runs; fonts, the bundled legal pages (fetched by Me →
// Privacy policy / Support) and data: images come from the app itself. Inline styles stay allowed (style attributes).
// The app origin is capacitor://localhost on iOS; it is listed next to 'self' in case a WebKit build doesn't match custom schemes to 'self'.
const scriptHash = createHash('sha256').update(js, 'utf8').digest('base64');
const self = "'self' capacitor://localhost";
const csp = [
  `default-src ${self}`, `script-src 'sha256-${scriptHash}'`, `style-src ${self} 'unsafe-inline'`, `img-src ${self} data:`,
  `font-src ${self}`, `connect-src ${self}`, "object-src 'none'", "base-uri 'none'", "form-action 'none'",
].join('; ');
const native = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<meta name="format-detection" content="telephone=no">
<meta name="color-scheme" content="light dark">
<meta name="theme-color" content="#EEF1EF" media="(prefers-color-scheme: light)">
<meta name="theme-color" content="#0A1012" media="(prefers-color-scheme: dark)">
<title>Walking Companion</title>
<style>${fontsCss}\n${css}</style>
</head>
<body>
${body}
<script>${js}</script>
</body>
</html>
`;
mkdirSync(join(root, 'www/fonts'), { recursive: true });
writeFileSync(join(root, 'www/index.html'), native);
for (const f of readdirSync(join(root, 'assets/fonts'))) if (f.endsWith('.woff2')) copyFileSync(join(root, 'assets/fonts', f), join(root, 'www/fonts', f));
const legal = join(root, 'legal');
if (existsSync(legal)) for (const f of readdirSync(legal)) if (f.endsWith('.html')) copyFileSync(join(legal, f), join(root, 'www', f));

const kb = (s) => (Buffer.byteLength(s) / 1024).toFixed(0) + ' KB';
console.log(`built dist/walking-companion.html (${kb(page)}), www/index.html (${kb(native)}), js ${kb(js)}, css ${kb(css)}`);
