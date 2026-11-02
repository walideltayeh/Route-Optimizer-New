// Procedural walker → runner animation for the landing page (canvas, no libraries).
//
// Gait model (side view, metres internally, one world unit = 1 m):
//  - A blend b ∈ [0, 1] goes walk → run over a loop. Speed, cadence, stance fraction, stride, bob, lean, knee lift and
//    elbow bend are all interpolated from b, so the change is continuous.
//  - Feet are planted: during stance a foot's world position is fixed (it never slides); during swing it travels on an
//    arc to the next landing point, which is placed ahead of the hip by half a stance stride. Legs are solved with 2-bone
//    inverse kinematics from hip to foot, knees bending forward. Running has a flight phase (stance < 50%).
//  - The camera follows the body, so the ground, footprints and contour lines scroll; the figure stays near centre.
// Rendering: tapered limb strokes in a champagne-gold gradient with a soft glow, onion-skin echoes of recent poses,
// glowing footprints that fade, a fine trail line and drifting topographic contours. DPR-aware; pauses when hidden;
// with reduced motion it draws one still pose.

const TAU = Math.PI * 2;
const lerp = (a, b, t) => a + (b - a) * t;
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const smooth = (t) => t * t * (3 - 2 * t);

// Body proportions (metres)
const THIGH = 0.46, SHIN = 0.45, FOOT = 0.13, TORSO = 0.56, NECK = 0.1, HEAD = 0.115, UPPER = 0.31, FORE = 0.29;
const HIP_H = 0.84; // hip height while moving (below THIGH + SHIN so the knee keeps a natural bend)

/** Gentle rolling trail (world x → ground height, metres). */
function ground(x) {
  return 0.16 * Math.sin(x * 0.21) + 0.07 * Math.sin(x * 0.53 + 1.3) + 0.03 * Math.sin(x * 1.1 + 0.4);
}
function groundSlope(x) {
  return 0.16 * 0.21 * Math.cos(x * 0.21) + 0.07 * 0.53 * Math.cos(x * 0.53 + 1.3) + 0.03 * 1.1 * Math.cos(x * 1.1 + 0.4);
}

/** Gait parameters for blend b (0 walk … 1 run). */
function gaitParams(b) {
  const e = smooth(clamp(b, 0, 1));
  return {
    speed: lerp(1.35, 3.4, e), // m/s
    cadence: lerp(0.92, 1.42, e), // stride cycles per second (one cycle = two steps)
    stance: lerp(0.6, 0.36, e), // fraction of a cycle a foot is on the ground
    lift: lerp(0.12, 0.3, e), // swing foot height (m)
    bob: lerp(0.035, 0.07, e), // vertical hip motion (m)
    lean: lerp(0.04, 0.2, e), // torso lean forward (rad)
    armSwing: lerp(0.42, 0.85, e), // shoulder swing amplitude (rad)
    elbow: lerp(0.35, 1.45, e), // elbow bend (rad)
    crouch: lerp(0.02, 0.06, e), // lower hips when running (m)
    e,
  };
}

/** 2-bone IK: returns the knee point for hip H and foot F, knee bending forward (+x). */
function solveKnee(hx, hy, fx, fy, l1, l2, forward = 1) {
  let dx = fx - hx, dy = fy - hy;
  let d = Math.hypot(dx, dy);
  const maxD = l1 + l2 - 1e-4;
  if (d > maxD) { dx *= maxD / d; dy *= maxD / d; d = maxD; }
  const a = (l1 * l1 - l2 * l2 + d * d) / (2 * d);
  const h = Math.sqrt(Math.max(0, l1 * l1 - a * a));
  const mx = hx + (dx * a) / d, my = hy + (dy * a) / d;
  // perpendicular, choose the side that puts the knee ahead in the direction of travel
  const px = -dy / d, py = dx / d;
  const s = px * forward >= 0 ? 1 : -1;
  return [mx + px * h * s, my + py * h * s];
}

export function createWalker(canvas, opts = {}) {
  const reduce = opts.reducedMotion ?? (typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches);
  const palette = {
    gold1: opts.gold1 || '#F3E2B6', gold2: opts.gold2 || '#C9A25A', gold3: opts.gold3 || '#8E6A2E',
    contour: opts.contour || 'rgba(233, 214, 170, 0.045)', contourStrong: opts.contourStrong || 'rgba(233, 214, 170, 0.085)',
    trail: opts.trail || 'rgba(233, 214, 170, 0.5)',
  };
  const ctx = canvas.getContext('2d');
  let W = 0, H = 0, dpr = 1, raf = 0, last = 0, running = false;
  let stage = null;

  // world state
  let t = 0; // seconds
  let x = 0; // body world x
  let phase = 0; // gait cycle phase 0..1
  const legs = [
    { off: 0, fx: 0.25, fy: ground(0.25), ax: 0.25, ay: ground(0.25), tx: 0.38, ty: ground(0.25), liftX: 0, liftY: 0, landX: 0.25, wasStance: true },
    { off: 0.5, fx: -0.4, fy: ground(-0.4), ax: -0.4, ay: ground(-0.4), tx: -0.27, ty: ground(-0.4), liftX: -0.4, liftY: ground(-0.4), landX: 0.6, wasStance: false },
  ];
  const prints = []; // {x, y, born, side}
  const echoes = []; // recent poses
  let echoT = 0;
  let contours = null;

  function blendAt(time) {
    // 14 s loop: walk 4.5 s → ease up 2.5 s → run 4 s → ease down 3 s
    const L = 14, u = ((time % L) + L) % L;
    if (u < 4.5) return 0;
    if (u < 7) return smooth((u - 4.5) / 2.5);
    if (u < 11) return 1;
    return 1 - smooth((u - 11) / 3);
  }

  function resize() {
    const r = canvas.getBoundingClientRect();
    dpr = Math.min(2.5, window.devicePixelRatio || 1);
    W = Math.max(1, r.width); H = Math.max(1, r.height);
    canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    measureStage();
    buildContours();
  }
  // opts.stage() → { top, bottom } in canvas px: the free band the figure walks in (its feet on the bottom edge).
  function measureStage() {
    stage = null;
    if (!opts.stage) return;
    try { const st = opts.stage(); if (st && st.bottom > st.top) stage = st; } catch { stage = null; }
  }

  function buildContours() {
    // Concentric organic loops around a few "peaks", in world-ish units (screen px at parallax 0.25)
    // Concentric organic rings around a few summits. Centres are fractions of the canvas; ring sizes use one unit
    // (the shorter side) so rings stay round on tall phone screens.
    const peaks = [[0.92, 0.1, 10], [1.62, 0.46, 7]];
    contours = [];
    for (const [cx, cy, n] of peaks) {
      for (let k = 1; k <= n; k++) {
        const pts = [];
        const R = k * 0.075;
        for (let i = 0; i <= 72; i++) {
          const a = (i / 72) * TAU;
          const m = 1 + 0.1 * Math.sin(2 * a + k * 0.35 + cx * 3) + 0.06 * Math.sin(3 * a + 1.7 + cy * 5) + 0.03 * Math.sin(5 * a + k * 0.7);
          pts.push([Math.cos(a) * R * m * 1.35, Math.sin(a) * R * m]);
        }
        contours.push({ cx, cy, pts, strong: k % 5 === 0 });
      }
    }
  }

  // ---------- simulation ----------
  const REACH = THIGH + SHIN - 0.004;
  let hipX = 0, hipY = HIP_H, lean = 0, curG = gaitParams(0);

  function hipAt(g) {
    const gy = ground(x);
    const p2 = (phase * 2) % 1; // one bump per step
    const walkBob = Math.cos(TAU * (p2 - g.stance / 2 + 0.25)) * g.bob; // highest near mid-stance
    const runBob = -Math.cos(TAU * (p2 - g.stance / 2)) * g.bob; // lowest at mid-stance, high in flight
    return [x, gy + HIP_H - g.crouch + lerp(walkBob, runBob, g.e)];
  }

  /** Stance ankle: heel down if the hip can reach it; otherwise the heel lifts and the foot rolls on its planted toes. */
  function stanceAnkle(leg) {
    const sl = Math.atan(groundSlope(leg.fx));
    const toeX = leg.fx + Math.cos(sl) * FOOT, toeY = leg.fy + Math.sin(sl) * FOOT;
    let a = 0; // heel-lift angle
    // direction from the toe back to the ankle: along the ground at 0, rotating upward as the heel lifts
    const at = (ang) => [toeX + Math.cos(Math.PI + sl - ang) * FOOT, toeY + Math.sin(Math.PI + sl - ang) * FOOT];
    let [ax, ay] = at(0);
    if (Math.hypot(ax - hipX, ay - hipY) > REACH) {
      let lo = 0, hi = 1.3;
      for (let i = 0; i < 14; i++) { const m = (lo + hi) / 2; const [mx, my] = at(m); if (Math.hypot(mx - hipX, my - hipY) > REACH) lo = m; else hi = m; }
      a = hi; [ax, ay] = at(a);
    }
    leg.ax = ax; leg.ay = ay; leg.tx = toeX; leg.ty = toeY; leg.heel = a;
  }

  function step(dt) {
    const b = blendAt(t);
    const g = gaitParams(b);
    curG = g;
    t += dt;
    x += g.speed * dt;
    phase = (phase + g.cadence * dt) % 1;
    [hipX, hipY] = hipAt(g);
    lean = g.lean + groundSlope(x) * 0.35;
    for (const leg of legs) {
      const p = (phase + leg.off) % 1; // 0..1, stance first
      if (leg.p != null && p < leg.p) leg.early = false; // new cycle
      let stance = p < g.stance && !leg.early;
      if (stance && leg.wasStance) {
        // push off early if the planted foot is out of reach even with the heel fully raised (pace changing mid-step)
        stanceAnkle(leg);
        if (leg.heel >= 1.29 && Math.hypot(leg.ax - hipX, leg.ay - hipY) > REACH + 0.002) { leg.early = true; stance = false; }
      }
      if (stance && !leg.wasStance) {
        // touchdown: the heel lands at the planned point and stays there for the whole stance (no sliding)
        leg.fx = leg.landX; leg.fy = ground(leg.landX);
        prints.push({ x: leg.fx, y: leg.fy, born: t, run: g.e });
        if (prints.length > 24) prints.shift();
      }
      if (!stance && leg.wasStance) {
        // lift-off: plan the next touchdown slightly ahead of where the hip will be then
        leg.liftX = leg.ax; leg.liftY = leg.ay; leg.liftP = p;
        const timeToLand = (1 - p) / g.cadence;
        leg.landX = x + g.speed * timeToLand + lerp(0.3, 0.2, g.e);
      }
      if (stance) stanceAnkle(leg);
      else {
        const s0 = leg.liftP != null && leg.liftP <= p ? leg.liftP : g.stance;
        const s = clamp((p - s0) / (1 - s0), 0, 1); // 0..1 through swing
        const e = lerp(s, smooth(s), 0.55); // the foot leaves briskly and settles into the heel strike
        const gy = lerp(leg.liftY, ground(leg.landX), e);
        let ax = lerp(leg.liftX, leg.landX, e);
        let ay = gy + Math.sin(Math.PI * Math.pow(s, 0.75)) * g.lift; // the knee lifts the foot early in the swing
        // a swinging leg can always fold, so keep the foot within reach of the hip (the knee bends more)
        const d = Math.hypot(ax - hipX, ay - hipY);
        if (d > REACH) { ax = hipX + ((ax - hipX) * REACH) / d; ay = hipY + ((ay - hipY) * REACH) / d; }
        leg.ax = ax; leg.ay = ay;
        // swing foot: toes point down after push-off and come level for the heel strike
        const ang = lerp(-0.9 - 0.3 * g.e, 0.15, smooth(s));
        leg.tx = leg.ax + Math.cos(ang) * FOOT; leg.ty = leg.ay + Math.sin(ang) * FOOT;
      }
      leg.wasStance = stance;
      leg.p = p;
    }
    // echoes for onion skinning
    echoT += dt;
    if (echoT > 0.075) { echoT = 0; echoes.push(pose(g)); if (echoes.length > 5) echoes.shift(); }
    return g;
  }

  /** Current skeleton in world coordinates. */
  function pose(g) {
    const shX = hipX + Math.sin(lean) * TORSO, shY = hipY + Math.cos(lean) * TORSO;
    const nkX = shX + Math.sin(lean) * NECK, nkY = shY + Math.cos(lean) * NECK;
    const hdX = nkX + Math.sin(lean) * HEAD, hdY = nkY + Math.cos(lean) * HEAD * 0.9;
    const L = legs.map((leg) => {
      const [kx, ky] = solveKnee(hipX, hipY, leg.ax, leg.ay, THIGH, SHIN, 1);
      return { hip: [hipX, hipY], knee: [kx, ky], ankle: [leg.ax, leg.ay], toe: [leg.tx, leg.ty] };
    });
    const arms = legs.map((leg) => {
      // Each arm swings opposite its own leg: the leg is forward at touchdown (p = 0), so the arm is back then.
      // Angles are measured from straight down; positive = forward.
      const swing = -Math.cos(TAU * leg.p) * g.armSwing + lean * 0.5;
      const elX = shX + Math.sin(swing) * UPPER, elY = shY - Math.cos(swing) * UPPER;
      const fore = swing + g.elbow * (0.85 + 0.15 * Math.max(0, Math.cos(TAU * leg.p))); // forearm bends forward
      const hx = elX + Math.sin(fore) * FORE, hy = elY - Math.cos(fore) * FORE;
      return { sh: [shX, shY], el: [elX, elY], hand: [hx, hy] };
    });
    return { legs: L, arms, hip: [hipX, hipY], sh: [shX, shY], head: [hdX, hdY], e: g.e };
  }

  // ---------- rendering ----------
  function view() {
    // scale so the figure is ~ 34% of the canvas height, camera centred slightly left of the body
    const band = stage ? Math.max(70, stage.bottom - stage.top) : H;
    const scale = Math.min(H * 0.19, W * 0.27, band / 1.9);
    const camX = x - (W * 0.48) / scale;
    const baseY = stage ? stage.bottom - 4 : H * 0.74;
    const camY = ground(x) * 0.6;
    const S = (wx, wy) => [(wx - camX) * scale, baseY - (wy - camY) * scale];
    return { scale, camX, S };
  }

  function drawContours(v) {
    const U = Math.min(W, H);
    const span = W * 1.8;
    const shift = (v.camX * v.scale * 0.22) % span; // slow parallax drift with the walker
    ctx.lineWidth = 1;
    for (const c of contours) {
      ctx.strokeStyle = c.strong ? palette.contourStrong : palette.contour;
      for (const off of [0, span]) {
        const ox = c.cx * W - shift + off, oy = c.cy * H;
        if (ox < -U * 1.4 || ox > W + U * 1.4) continue;
        ctx.beginPath();
        c.pts.forEach(([px, py], i) => { const X = ox + px * U, Y = oy + py * U; if (i) ctx.lineTo(X, Y); else ctx.moveTo(X, Y); });
        ctx.stroke();
      }
    }
  }

  function drawTrail(v) {
    const left = v.camX - 0.5, right = v.camX + W / v.scale + 0.5;
    const grad = ctx.createLinearGradient(0, 0, W, 0);
    grad.addColorStop(0, 'rgba(233,214,170,0)');
    grad.addColorStop(0.25, palette.trail);
    grad.addColorStop(0.75, palette.trail);
    grad.addColorStop(1, 'rgba(233,214,170,0)');
    ctx.beginPath();
    for (let wx = left; wx <= right; wx += 0.08) {
      const [sx, sy] = v.S(wx, ground(wx));
      if (wx === left) ctx.moveTo(sx, sy); else ctx.lineTo(sx, sy);
    }
    ctx.strokeStyle = grad; ctx.lineWidth = 1.2; ctx.stroke();
    // faint second line below for depth
    ctx.beginPath();
    for (let wx = left; wx <= right; wx += 0.12) {
      const [sx, sy] = v.S(wx, ground(wx) - 0.09);
      if (wx === left) ctx.moveTo(sx, sy); else ctx.lineTo(sx, sy);
    }
    ctx.globalAlpha = 0.35; ctx.stroke(); ctx.globalAlpha = 1;
  }

  function drawPrints(v) {
    for (const pr of prints) {
      const age = t - pr.born;
      const a = Math.max(0, 1 - age / 2.6);
      if (a <= 0) continue;
      const [sx, sy] = v.S(pr.x + 0.05, pr.y);
      const r = v.scale * (0.05 + 0.03 * pr.run) * (1 + age * 0.35);
      const g = ctx.createRadialGradient(sx, sy, 0, sx, sy, r * 2.2);
      g.addColorStop(0, `rgba(243, 226, 182, ${0.55 * a})`);
      g.addColorStop(1, 'rgba(243, 226, 182, 0)');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.ellipse(sx, sy, r * 2.2, r * 0.7, 0, 0, TAU); ctx.fill();
    }
  }

  function limb(v, a, b, w0, w1, color, alpha) {
    // tapered stroke as a filled quad with round ends
    const [x0, y0] = v.S(a[0], a[1]), [x1, y1] = v.S(b[0], b[1]);
    const dx = x1 - x0, dy = y1 - y0, d = Math.hypot(dx, dy) || 1, nx = -dy / d, ny = dx / d;
    ctx.globalAlpha = alpha;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(x0 + nx * w0, y0 + ny * w0);
    ctx.lineTo(x1 + nx * w1, y1 + ny * w1);
    ctx.lineTo(x1 - nx * w1, y1 - ny * w1);
    ctx.lineTo(x0 - nx * w0, y0 - ny * w0);
    ctx.closePath(); ctx.fill();
    ctx.beginPath(); ctx.arc(x0, y0, w0, 0, TAU); ctx.arc(x1, y1, w1, 0, TAU); ctx.fill();
    ctx.globalAlpha = 1;
  }

  function drawFigure(v, P, alpha, glow) {
    const k = v.scale / 100; // stroke widths scale with size
    const grad = (() => {
      const [hx, hy] = v.S(P.head[0], P.head[1] + HEAD);
      const [fx, fy] = v.S(P.hip[0], P.hip[1] - HIP_H);
      const gr = ctx.createLinearGradient(hx, hy, fx, fy);
      gr.addColorStop(0, palette.gold1); gr.addColorStop(0.55, palette.gold2); gr.addColorStop(1, palette.gold3);
      return gr;
    })();
    if (glow) { ctx.shadowColor = 'rgba(233, 196, 120, 0.55)'; ctx.shadowBlur = 14 * k; }
    // far limbs (second leg/arm) slightly dimmer for depth
    const order = [1, 0];
    for (const i of order) {
      const dim = i === 1 ? 0.6 : 1;
      const L = P.legs[i];
      limb(v, L.hip, L.knee, 4.6 * k, 3.4 * k, grad, alpha * dim);
      limb(v, L.knee, L.ankle, 3.4 * k, 2.2 * k, grad, alpha * dim);
      limb(v, L.ankle, L.toe, 2.2 * k, 1.3 * k, grad, alpha * dim);
      const A = P.arms[i];
      if (i === 1) { limb(v, A.sh, A.el, 3.0 * k, 2.3 * k, grad, alpha * dim); limb(v, A.el, A.hand, 2.3 * k, 1.5 * k, grad, alpha * dim); }
    }
    limb(v, P.hip, P.sh, 5.2 * k, 4.4 * k, grad, alpha); // torso
    const A0 = P.arms[0];
    limb(v, A0.sh, A0.el, 3.0 * k, 2.3 * k, grad, alpha);
    limb(v, A0.el, A0.hand, 2.3 * k, 1.5 * k, grad, alpha);
    const [hx, hy] = v.S(P.head[0], P.head[1]);
    ctx.globalAlpha = alpha; ctx.fillStyle = grad;
    ctx.beginPath(); ctx.arc(hx, hy, HEAD * v.scale * 0.92, 0, TAU); ctx.fill();
    ctx.globalAlpha = 1; ctx.shadowBlur = 0;
  }

  function render(g) {
    ctx.clearRect(0, 0, W, H);
    const v = view();
    drawContours(v);
    drawTrail(v);
    drawPrints(v);
    // light bloom behind the figure
    const [bx, by] = v.S(x, ground(x) + 1.0);
    const bloom = ctx.createRadialGradient(bx, by, 0, bx, by, v.scale * 1.6);
    bloom.addColorStop(0, `rgba(233, 196, 120, ${0.10 + 0.06 * g.e})`);
    bloom.addColorStop(1, 'rgba(233, 196, 120, 0)');
    ctx.fillStyle = bloom; ctx.fillRect(0, 0, W, H);
    // echoes (older first)
    // motion echoes: barely there while walking, a soft trail when running
    echoes.forEach((P, i) => drawFigure(v, P, (0.012 + 0.016 * i) * (0.35 + 0.9 * g.e), false));
    drawFigure(v, pose(g), 1, true);
  }

  function frame(now) {
    if (!running) return;
    const dt = Math.min(0.05, last ? (now - last) / 1000 : 1 / 60);
    last = now;
    const g = step(dt);
    render(g);
    raf = requestAnimationFrame(frame);
  }

  function start() {
    if (running) return;
    running = true; last = 0;
    raf = requestAnimationFrame(frame);
  }
  function stop() { running = false; cancelAnimationFrame(raf); }

  function still() {
    // advance to an elegant mid-stride walking pose and draw once
    for (let i = 0; i < 40; i++) step(1 / 60);
    render(gaitParams(0));
  }

  const onVis = () => { if (document.hidden) stop(); else if (!reduce) start(); };
  const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => { resize(); if (reduce || !running) render(gaitParams(blendAt(t))); }) : null;

  resize();
  // warm up so footprints and echoes exist on the first frame
  for (let i = 0; i < 90; i++) step(1 / 60);
  if (reduce) still(); else start();
  document.addEventListener('visibilitychange', onVis);
  if (ro) ro.observe(canvas);

  return {
    destroy() { stop(); document.removeEventListener('visibilitychange', onVis); if (ro) ro.disconnect(); },
    /** Re-measure the stage band (call when the layout around the canvas changes). */
    layout() { measureStage(); if (reduce || !running) render(gaitParams(blendAt(t))); },
    /** For tests: advance the simulation and report feet. */
    _debug: { step: (dt) => step(dt), legs, pose: () => pose(curG), get x() { return x; }, get t() { return t; }, blendAt, REACH, THIGH, SHIN },
  };
}
