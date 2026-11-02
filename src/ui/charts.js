// Shared SVG charts. All colors come from CSS tokens so both themes work.
import { speedFor, PHASES, DELOAD_WEEKS } from '../core/program.js';
import { esc, toSpeed, speedUnit, dateShort, DAY_SHORT } from '../core/format.js';

const fx = (n) => (Math.round(n * 100) / 100).toString();
/** Running modes get stripes on top of their colour, so they read without colour vision too (never colour alone). */
export const HATCHED = ['jog', 'run'];
let patternSeq = 0;

/**
 * Two-band interval profile on one time axis:
 *   top band  = incline as a filled hill outline,
 *   bottom    = speed bars colored by mode.
 * opts: {h, mini, progress (sec), current (index), nudge, ticks (bool), label}
 */
export function intervalChart(segs, opts = {}) {
  const W = 1000, H = opts.h || (opts.mini ? 46 : 132);
  const total = segs.reduce((a, s) => a + s.dur, 0) || 1;
  const topH = opts.mini ? H * 0.36 : H * 0.34, gap = opts.mini ? 3 : 8, barTop = topH + gap, barH = H - barTop;
  const maxI = Math.max(10, ...segs.map((s) => s.incline || 0));
  const speeds = segs.map((s) => speedFor(s, opts.nudge || 0));
  const maxS = Math.max(...speeds, 7) * 1.04, minS = Math.min(2.5, ...speeds) * 0.6;
  let x = 0, bars = '', hill = `M0 ${topH}`, line = '';
  // horizontal stripes: the chart is stretched only horizontally (preserveAspectRatio="none"), so they stay crisp
  const pid = `hp-hatch-${++patternSeq}`;
  const hatched = segs.some((s) => HATCHED.includes(s.type));
  const defs = hatched ? `<defs><pattern id="${pid}" patternUnits="userSpaceOnUse" width="20" height="${opts.mini ? 4 : 5.5}"><rect width="20" height="${opts.mini ? 1.5 : 2}" fill="var(--m-jog-on)" opacity=".32"/></pattern></defs>` : '';
  segs.forEach((s, i) => {
    const w = (s.dur / total) * W;
    const v = speeds[i];
    const bh = Math.max(3, ((v - minS) / (maxS - minS)) * barH);
    const g = opts.mini ? 1.5 : 3;
    const cur = opts.current === i;
    const past = opts.progress != null && x + w <= (opts.progress / total) * W;
    const op = opts.progress != null && !past && !cur ? 0.42 : 1;
    const geo = `x="${fx(x + g / 2)}" y="${fx(barTop + barH - bh)}" width="${fx(Math.max(0.5, w - g))}" height="${fx(bh)}" rx="${opts.mini ? 1.5 : 3}"`;
    bars += `<rect ${geo} fill="var(--m-${esc(s.type)})" opacity="${op}"${cur ? ' stroke="var(--ink)" stroke-width="2.5" vector-effect="non-scaling-stroke"' : ''}/>`;
    if (HATCHED.includes(s.type)) bars += `<rect ${geo} fill="url(#${pid})" opacity="${op}"/>`;
    const y = topH - ((s.incline || 0) / maxI) * (topH - 2);
    hill += ` L${fx(x)} ${fx(y)} L${fx(x + w)} ${fx(y)}`;
    line += `${i ? ' L' : 'M'}${fx(x)} ${fx(y)} L${fx(x + w)} ${fx(y)}`;
    x += w;
  });
  hill += ` L${W} ${topH} Z`;
  let prog = '';
  if (opts.progress != null) {
    const px = (Math.min(total, opts.progress) / total) * W;
    prog = `<line x1="${fx(px)}" x2="${fx(px)}" y1="0" y2="${H}" stroke="var(--ink)" stroke-width="2" vector-effect="non-scaling-stroke"/>`;
  }
  const svg = `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" style="height:${H}px" role="img" aria-label="${esc(opts.label || 'Workout profile: bars show speed, the line shows incline')}">
    <path d="${hill}" fill="var(--ink)" opacity=".07"/>
    <path d="${line}" fill="none" stroke="var(--ink)" stroke-width="${opts.mini ? 1.4 : 2}" stroke-linejoin="round" opacity=".7" vector-effect="non-scaling-stroke"/>
    ${defs}${bars}${prog}</svg>`;
  if (opts.mini || opts.ticks === false) return `<div class="chart">${svg}</div>`;
  const mins = Math.round(total / 60);
  const step = mins > 50 ? 10 : 5;
  let ticks = '';
  // ticks every 5 (or 10) minutes; the end label always shows "<total> min", and a tick too close to it is dropped
  for (let m = 0; m < mins; m += step) if (m === 0 || mins - m >= step * 0.6 + (mins > 50 ? 2 : 1)) ticks += `<span style="left:${((m * 60) / total) * 100}%">${m}</span>`;
  ticks += `<span style="left:100%">${mins} min</span>`;
  return `<div class="chart">${svg}<div class="chart-ticks">${ticks}</div></div>`;
}

/** Legend for the modes present in segs. */
export function modeLegend(segs, MODES) {
  const types = [...new Set(segs.map((s) => s.type))];
  const order = ['walk', 'brisk', 'power', 'jog', 'run'].filter((t) => types.includes(t));
  return `<div class="legend">${order.map((t) => `<span class="mode-${t}"><i class="mode-dot${HATCHED.includes(t) ? ' hatch' : ''}"></i>${esc(MODES[t].name)} <span class="faint num">${toSpeed(speedFor(t)).toFixed(1)}</span></span>`).join('')}<span><i class="ln" style="opacity:.7"></i>Incline</span><span class="faint">${speedUnit()}</span></div>`;
}

/** Hill glyph for the week strip. state: done | today | planned | rest | missed | skipped */
export function hillGlyph(state, mode = 'power') {
  const d = 'M2 28 C10 28 14 6 23 6 C32 6 36 28 44 28';
  if (state === 'rest') return `<svg class="hill" viewBox="0 0 46 30" aria-hidden="true"><path d="M6 27h34" stroke="var(--ink-3)" stroke-width="2" stroke-linecap="round" opacity=".5"/></svg>`;
  if (state === 'done') return `<svg class="hill mode-${esc(mode)}" viewBox="0 0 46 30" aria-hidden="true"><path d="${d}Z" fill="var(--mode)"/><path d="m17 17 4 4 8-8" stroke="var(--mode-on)" stroke-width="2.4" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
  if (state === 'today') return `<svg class="hill mode-${esc(mode)}" viewBox="0 0 46 30" aria-hidden="true"><path d="${d}" fill="color-mix(in srgb, var(--mode) 20%, transparent)" stroke="var(--mode-ink)" stroke-width="2.2"/><circle cx="23" cy="6" r="3.4" fill="var(--mode)" stroke="var(--bg)" stroke-width="1.5"/></svg>`;
  if (state === 'missed') return `<svg class="hill" viewBox="0 0 46 30" aria-hidden="true"><path d="${d}" fill="none" stroke="var(--ink-3)" stroke-width="1.8" stroke-dasharray="3 3"/><path d="M17 15l12 0" stroke="var(--ink-3)" stroke-width="2" stroke-linecap="round"/></svg>`;
  if (state === 'skipped') return `<svg class="hill" viewBox="0 0 46 30" aria-hidden="true"><path d="${d}" fill="none" stroke="var(--ink-3)" stroke-width="1.6" stroke-dasharray="2 4" opacity=".6"/></svg>`;
  return `<svg class="hill mode-${esc(mode)}" viewBox="0 0 46 30" aria-hidden="true"><path d="${d}" fill="none" stroke="var(--mode-ink)" stroke-width="1.8" stroke-dasharray="4 3" opacity=".9"/></svg>`;
}

/**
 * Week strip. days: [{date, key, state, mode, label, aria, isToday, interactive?}] for Mon..Sun.
 * Each day is a list item. Days with an action (a planned or done session) hold a <button data-day="<key>">;
 * rest days and days before the plan began are plain text (not focusable). Pass interactive to override.
 */
export function weekHills(days) {
  return `<div class="week-hills" role="list">${days.map((d, i) => {
    const live = d.interactive != null ? !!d.interactive : !!d.key && d.state !== 'rest' && !/^rest:/.test(d.key);
    const cls = `day ${d.state}${d.isToday ? ' today' : ''}`;
    const inner = `${hillGlyph(d.state, d.mode)}
      <span class="dname"${live ? '' : ' aria-hidden="true"'}>${DAY_SHORT[i]}</span>
      <span class="dnum"${live ? '' : ' aria-hidden="true"'}>${new Date(d.date).getDate()}</span>
      <span class="dlab"${live ? '' : ' aria-hidden="true"'}>${esc(d.label || '')}</span>`;
    return `
    <div class="day-cell" role="listitem">${live
      ? `<button type="button" class="${cls}" data-day="${esc(d.key)}" aria-label="${esc(d.aria || '')}">${inner}</button>`
      : `<div class="${cls}">${d.aria ? `<span class="sr-only">${esc(d.aria)}</span>` : ''}${inner}</div>`}</div>`;
  }).join('')}</div>`;
}

/**
 * 12-week plan meter grouped by phase. weeks: [{week, pct (0..1)}], current: week number.
 */
export function planMeter(weeks, current, { block = 1 } = {}) {
  const aria = current < 1 ? 'Plan progress: your plan has not started yet' : current > 12 ? 'Plan progress: all 12 weeks complete' : `Plan progress: week ${current} of 12`;
  // Block 2+ runs every week at Burn level: one row for the whole block instead of three phases.
  const phases = block > 1 ? [{ name: `Block ${block} · ${PHASES[PHASES.length - 1].name}`, weeks: [1, 12] }] : PHASES;
  return `<div class="plan-meter${block > 1 ? ' one' : ''}" role="img" aria-label="${aria}">${phases.map((ph) => {
    const ws = weeks.filter((w) => w.week >= ph.weeks[0] && w.week <= ph.weeks[1]);
    const isCur = current >= ph.weeks[0] && current <= ph.weeks[1];
    return `<div class="ph ${isCur ? 'current' : ''}"><div class="ph-weeks">${ws.map((w) => {
      const cls = w.week === current ? 'now' : w.pct >= 1 ? 'done' : w.pct > 0 ? 'part' : '';
      return `<i class="wk ${cls} ${DELOAD_WEEKS.includes(w.week) ? 'deload' : ''}" style="--p:${Math.round(w.pct * 100)}%"></i>`;
    }).join('')}</div><span class="ph-name">${esc(ph.name)}</span></div>`;
  }).join('')}</div>`;
}

/** Weekly Summit gauge: an open arc (not a ring) from value/target. */
export function gauge(value, target, { sub = '', label = 'Weekly activity minutes' } = {}) {
  const p = Math.max(0, Math.min(1, target ? value / target : 0));
  const r = 80, cx = 100, cy = 100, a0 = Math.PI * 1.08, a1 = Math.PI * -0.08;
  const pt = (a) => [cx + r * Math.cos(a), cy - r * Math.sin(a)];
  const [x0, y0] = pt(a0), [x1, y1] = pt(a1);
  const len = r * (a0 - a1);
  return `<div class="gauge" role="img" aria-label="${esc(label)}: ${Math.round(value)} of ${Math.round(target)}">
    <svg viewBox="0 0 200 112"><path d="M${fx(x0)} ${fx(y0)} A${r} ${r} 0 1 1 ${fx(x1)} ${fx(y1)}" fill="none" stroke="var(--surface-3)" stroke-width="14" stroke-linecap="round"/>
    <path class="gauge-val" d="M${fx(x0)} ${fx(y0)} A${r} ${r} 0 1 1 ${fx(x1)} ${fx(y1)}" fill="none" stroke="var(--m-walk)" stroke-width="14" stroke-linecap="round" stroke-dasharray="${fx(len)}" stroke-dashoffset="${fx(len * (1 - p))}" style="transition:stroke-dashoffset 1.1s var(--ease)" data-len="${fx(len)}" data-p="${p}"/>
    ${[0.25, 0.5, 0.75].map((t) => { const a = a0 - (a0 - a1) * t; const [ax, ay] = pt(a); const [bx, by] = [cx + (r - 11) * Math.cos(a), cy - (r - 11) * Math.sin(a)]; return `<line x1="${fx(ax)}" y1="${fx(ay)}" x2="${fx(bx)}" y2="${fx(by)}" stroke="var(--bg)" stroke-width="2"/>`; }).join('')}
    </svg>
    <div class="gauge-text"><span class="gauge-num" data-count="${Math.round(value)}">${Math.round(value)}</span><span class="gauge-sub">${esc(sub)}</span></div></div>`;
}
/** Animate gauges in root from 0 (call after inserting). */
export function animateGauges(root) {
  root.querySelectorAll('.gauge-val').forEach((p) => {
    const len = +p.dataset.len, pv = +p.dataset.p;
    p.style.transition = 'none'; p.style.strokeDashoffset = len; p.getBoundingClientRect();
    p.style.transition = ''; requestAnimationFrame(() => { p.style.strokeDashoffset = len * (1 - pv); });
  });
}

/**
 * Line chart sized to its container width (call with container.clientWidth).
 * series: [{points:[{t, v}], color, width, dash, dots, fill}] ; band: {upper:[{t,v}], lower:[{t,v}], color}
 * hlines: [{v, label, color, dash}] ; opts: {w, h, yFmt, xFmt, yMin, yMax, label}
 */
export function lineChart({ series = [], band = null, hlines = [], w = 340, h = 200, yFmt = (v) => v.toFixed(0), xFmt = (t) => dateShort(t), yMin, yMax, label = 'Chart', marker = null }) {
  const all = [...series.flatMap((s) => s.points), ...(band ? [...band.upper, ...band.lower] : [])];
  if (!all.length) return '';
  const l = 38, r = 12, t = 12, b = 24;
  const ts = all.map((p) => p.t), vs = all.map((p) => p.v).concat(hlines.map((x) => x.v));
  let x0 = Math.min(...ts), x1 = Math.max(...ts); if (x1 - x0 < 864e5 * 7) x1 = x0 + 864e5 * 7;
  let y0 = yMin ?? Math.min(...vs), y1 = yMax ?? Math.max(...vs);
  const pad = Math.max(0.5, (y1 - y0) * 0.12); y0 -= pad; y1 += pad;
  const X = (v) => l + ((v - x0) / (x1 - x0)) * (w - l - r), Y = (v) => t + ((y1 - v) / (y1 - y0)) * (h - t - b);
  const ticksN = 4, step = (y1 - y0) / ticksN;
  let g = '';
  for (let i = 0; i <= ticksN; i++) { const v = y0 + step * i; g += `<line x1="${l}" x2="${w - r}" y1="${fx(Y(v))}" y2="${fx(Y(v))}" stroke="var(--line-soft)"/><text class="chart-axis" x="${l - 6}" y="${fx(Y(v) + 4)}" text-anchor="end">${esc(yFmt(v))}</text>`; }
  g += `<text class="chart-axis" x="${l}" y="${h - 6}">${esc(xFmt(x0))}</text><text class="chart-axis" x="${w - r}" y="${h - 6}" text-anchor="end">${esc(xFmt(x1))}</text>`;
  if (band && band.upper.length) {
    const up = band.upper.map((p, i) => `${i ? 'L' : 'M'}${fx(X(p.t))} ${fx(Y(p.v))}`).join(' ');
    const lo = [...band.lower].reverse().map((p) => `L${fx(X(p.t))} ${fx(Y(p.v))}`).join(' ');
    g += `<path d="${up} ${lo} Z" fill="${band.color || 'var(--m-walk)'}" opacity=".16"/>`;
  }
  for (const hl of hlines) g += `<line x1="${l}" x2="${w - r}" y1="${fx(Y(hl.v))}" y2="${fx(Y(hl.v))}" stroke="${hl.color || 'var(--ink-3)'}" stroke-width="1.6" stroke-dasharray="${hl.dash || '5 5'}"/>${hl.label ? `<text class="chart-axis" x="${w - r}" y="${fx(Y(hl.v) - 5)}" text-anchor="end" style="fill:${hl.color || 'var(--ink-3)'};font-weight:700">${esc(hl.label)}</text>` : ''}`;
  for (const s of series) {
    if (!s.points.length) continue;
    const d = s.points.map((p, i) => `${i ? 'L' : 'M'}${fx(X(p.t))} ${fx(Y(p.v))}`).join(' ');
    if (s.fill) g += `<path d="${d} L${fx(X(s.points[s.points.length - 1].t))} ${h - b} L${fx(X(s.points[0].t))} ${h - b} Z" fill="${s.color}" opacity=".10"/>`;
    if (s.line !== false) g += `<path d="${d}" fill="none" stroke="${s.color}" stroke-width="${s.width || 2.4}" stroke-linejoin="round" stroke-linecap="round" ${s.dash ? `stroke-dasharray="${s.dash}"` : ''} opacity="${s.opacity || 1}"/>`;
    if (s.dots) g += s.points.map((p) => `<circle cx="${fx(X(p.t))}" cy="${fx(Y(p.v))}" r="${s.dotR || 2.6}" fill="${s.dotFill || s.color}" opacity="${s.dotOpacity || 1}"/>`).join('');
  }
  if (marker) g += `<circle cx="${fx(X(marker.t))}" cy="${fx(Y(marker.v))}" r="5.5" fill="var(--bg)" stroke="${marker.color || 'var(--ink)'}" stroke-width="2.5"/>${marker.label ? `<text class="chart-axis" x="${fx(Math.min(X(marker.t), w - r - 20))}" y="${fx(Y(marker.v) - 10)}" text-anchor="middle" style="fill:var(--ink);font-weight:700;font-size:min(calc(12 * var(--pt)), 15px)">${esc(marker.label)}</text>` : ''}`;
  return `<svg viewBox="0 0 ${w} ${h}" style="height:${h}px" role="img" aria-label="${esc(label)}">${g}</svg>`;
}

/** Simple bar chart. bars: [{label, v, highlight}] ; target line optional. */
export function barChart({ bars = [], w = 340, h = 180, target = null, yFmt = (v) => Math.round(v), label = 'Bar chart', color = 'var(--ink)' }) {
  const l = 34, r = 8, t = 18, b = 24;
  const raw = Math.max(1, target ? target * 1.15 : 0, ...bars.map((x) => x.v));
  // Round the axis up to a "nice" maximum whose half is also round (188 → 200, 575 → 600, 5 → 6).
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const maxV = ([1, 2, 4, 6, 8, 10].find((n) => n * mag >= raw - 1e-9) || 10) * mag;
  const Y = (v) => t + (1 - v / maxV) * (h - t - b);
  const bw = (w - l - r) / Math.max(1, bars.length);
  let g = `<line x1="${l}" x2="${w - r}" y1="${fx(Y(0))}" y2="${fx(Y(0))}" stroke="var(--line)"/>`;
  [0, maxV / 2, maxV].forEach((v) => { g += `<text class="chart-axis" x="${l - 6}" y="${fx(Y(v) + 4)}" text-anchor="end">${esc(yFmt(v))}</text>`; });
  bars.forEach((x, i) => {
    const bx = l + i * bw + bw * 0.2, bwid = bw * 0.6, bh = Math.max(0, Y(0) - Y(x.v));
    g += `<rect x="${fx(bx)}" y="${fx(Y(x.v))}" width="${fx(bwid)}" height="${fx(bh)}" rx="4" fill="${color}" opacity="${x.highlight ? 1 : 0.45}"><title>${esc(x.title || '')}</title></rect>`;
    if (x.v > 0 && bars.length <= 14) {
      // keep the value label clear of the dashed target line (lift it above the line when they would touch)
      let ly = Y(x.v) - 5;
      if (target && Math.abs(ly - 4 - Y(target)) < 9) ly = Y(target) - 5;
      g += `<text class="chart-axis" x="${fx(bx + bwid / 2)}" y="${fx(ly)}" text-anchor="middle" style="fill:var(--ink);font-weight:700">${esc(yFmt(x.v))}</text>`;
    }
    if (bars.length <= 14 || i % Math.ceil(bars.length / 8) === 0) g += `<text class="chart-axis" x="${fx(bx + bwid / 2)}" y="${h - 7}" text-anchor="middle">${esc(x.label)}</text>`;
  });
  if (target) g += `<line x1="${l}" x2="${w - r}" y1="${fx(Y(target))}" y2="${fx(Y(target))}" stroke="var(--m-walk-ink)" stroke-width="1.6" stroke-dasharray="5 5"/>`;
  return `<svg viewBox="0 0 ${w} ${h}" style="height:${h}px" role="img" aria-label="${esc(label)}">${g}</svg>`;
}
