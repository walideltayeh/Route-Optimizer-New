// Exercise and nutrition formulas. Pure functions: no DOM, no state.
// Sources (shown to users on the "How we calculate" page):
//  - ACSM's Guidelines for Exercise Testing and Prescription: walking and running metabolic equations
//  - Mifflin MD, St Jeor ST et al. (1990): resting metabolic rate
//  - Hall KD et al. (2011), Lancet: dynamic model of weight change (≈24 kcal/day per kg, half-time ≈1 year)
//  - CDC / WHO physical activity guidelines: 150–300 moderate minutes per week

export const KCAL_PER_KG = 7700; // static rule, used only to size a deficit and as the optimistic projection edge
export const KMH_PER_MPH = 1.609344;
export const LB_PER_KG = 2.2046226;

/** ACSM: walking equation unless the interval is a jog/run (or ≥ 8 km/h). */
export function isRunningGait(kmh, mode) {
  return mode === 'jog' || mode === 'run' || kmh >= 8;
}

/**
 * Effective grade. Holding the handrails at steep inclines reduces the real cost a lot;
 * we apply a 25% reduction at ≥ 8% when the user does not walk hands-free (a heuristic, disclosed in-app).
 */
export function effectiveGrade(inclinePct, handsFree = true) {
  const g = Math.max(0, inclinePct || 0) / 100;
  return !handsFree && g >= 0.08 ? g * 0.75 : g;
}

/** Oxygen cost, ml/kg/min (gross, includes 3.5 resting). */
export function vo2(kmh, inclinePct, mode, handsFree = true) {
  const s = (kmh * 1000) / 60; // m/min
  const g = effectiveGrade(inclinePct, handsFree);
  return isRunningGait(kmh, mode) ? 0.2 * s + 0.9 * s * g + 3.5 : 0.1 * s + 1.8 * s * g + 3.5;
}

/** Net ("active") kcal per minute: excludes resting cost. This is what we display and write to Apple Health. */
export function activeKcalPerMin(kmh, inclinePct, kg, mode, handsFree = true) {
  return ((vo2(kmh, inclinePct, mode, handsFree) - 3.5) * kg) / 1000 * 5;
}

export const mets = (kmh, inclinePct, mode, handsFree = true) => vo2(kmh, inclinePct, mode, handsFree) / 3.5;

/** Vigorous if running gait or ≥ 6 METs (activity minutes count vigorous minutes double). */
export const isVigorous = (kmh, inclinePct, mode) => isRunningGait(kmh, mode) || mets(kmh, inclinePct, mode) >= 6;

/** Round a calorie estimate for display (to 5). */
export const roundKcal = (k) => Math.max(0, Math.round((k || 0) / 5) * 5);

/* ---------------- energy balance ---------------- */

/** Mifflin-St Jeor RMR, kcal/day. sex: 'male' | 'female' | 'unspecified' */
export function rmr({ sex, kg, cm, age }) {
  if (!(kg > 0 && cm > 0 && age > 0)) return null;
  const s = sex === 'male' ? 5 : sex === 'female' ? -161 : -78;
  return Math.round(10 * kg + 6.25 * cm - 5 * age + s);
}

export const ACTIVITY_LEVELS = [
  { id: 'sitting', label: 'Mostly sitting', detail: 'Desk job, driving, little walking', factor: 1.2 },
  { id: 'some', label: 'On my feet some of the day', detail: 'Errands, some walking, light chores', factor: 1.3 },
  { id: 'most', label: 'On my feet most of the day', detail: 'Retail, nursing, active job', factor: 1.4 },
];

/** Daily energy expenditure: RMR × activity factor + planned exercise per day. */
export function tdee(rmrKcal, activityId, exercisePerDay = 0) {
  const lvl = ACTIVITY_LEVELS.find((a) => a.id === activityId) || ACTIVITY_LEVELS[0];
  return rmrKcal ? Math.round(rmrKcal * lvl.factor + exercisePerDay) : null;
}

/** Safe weekly loss cap: min(1 kg, 1% of body weight). */
export const paceCap = (kg) => Math.min(1, Math.round((kg || 0) * 0.01 * 100) / 100);

export const PACES = [
  { id: 'gentle', label: 'Gentle', kgPerWeek: 0.25 },
  { id: 'steady', label: 'Steady', kgPerWeek: 0.5 },
  { id: 'ambitious', label: 'Ambitious', kgPerWeek: 0.75 },
];

/** Minimum intake we will ever suggest. */
export const intakeFloor = (sex) => (sex === 'female' ? 1200 : 1500);

/**
 * Suggested daily intake for a weekly pace (kg/week).
 * Returns { deficit, intake, low, high, floorApplied } or null when inputs are missing.
 */
export function intakePlan({ tdeeKcal, sex, kgPerWeek }) {
  if (!tdeeKcal) return null;
  let deficit = (kgPerWeek * KCAL_PER_KG) / 7;
  let intake = tdeeKcal - deficit;
  const floor = intakeFloor(sex);
  let floorApplied = false;
  if (intake < floor) { intake = floor; deficit = Math.max(0, tdeeKcal - floor); floorApplied = true; }
  const r50 = (x) => Math.round(x / 50) * 50;
  return {
    deficit: Math.round(deficit),
    intake: r50(intake),
    low: r50(Math.max(floor, intake * 0.9)),
    high: r50(intake * 1.1),
    floorApplied,
    effectiveKgPerWeek: (deficit * 7) / KCAL_PER_KG,
  };
}

/** Weeks to reach goal at a pace. */
export function weeksToGoal(currentKg, goalKg, kgPerWeek) {
  if (!(currentKg > goalKg) || !(kgPerWeek > 0)) return 0;
  return Math.ceil((currentKg - goalKg) / kgPerWeek);
}

/** BMI and the weight range for BMI 18.5–24.9 at a height. */
export const bmi = (kg, cm) => (kg > 0 && cm > 0 ? kg / Math.pow(cm / 100, 2) : null);
export function healthyRange(cm) {
  if (!(cm > 0)) return null;
  const h2 = Math.pow(cm / 100, 2);
  return { low: Math.round(18.5 * h2 * 10) / 10, high: Math.round(24.9 * h2 * 10) / 10 };
}

/* ---------------- projection ---------------- */

/**
 * Projection band for a sustained daily deficit D (kcal/day) from starting weight W0, t in days.
 * heavy = Hall 2011 dynamic model (slower, more realistic); light = static 7,700 kcal/kg rule (optimistic).
 * Both clipped at the goal.
 */
export function projectionBand(W0, D, days, goalKg) {
  const clip = (w) => (goalKg ? Math.max(goalKg, w) : w);
  const light = clip(W0 - (D * days) / KCAL_PER_KG);
  const heavy = clip(W0 - (D / 24) * (1 - Math.pow(2, -days / 365)));
  return { light, heavy };
}

/** Days until the band edge reaches the goal (Infinity if never within 3 years). */
export function bandGoalDays(W0, D, goalKg) {
  const r = { light: Infinity, heavy: Infinity };
  for (let d = 1; d <= 1095; d++) {
    const b = projectionBand(W0, D, d, null);
    if (r.light === Infinity && b.light <= goalKg) r.light = d;
    if (r.heavy === Infinity && b.heavy <= goalKg) { r.heavy = d; break; }
  }
  return r;
}

/**
 * Exponentially smoothed trend of weigh-ins (α ≈ 0.1/day, adjusted for gaps).
 * points: [{t: ms, kg}] (any order). Returns [{t, kg, trend}] sorted.
 */
export function ewmaTrend(points) {
  const s = [...(points || [])].filter((p) => p.kg > 0).sort((a, b) => a.t - b.t);
  let T = null, last = null;
  return s.map((p) => {
    if (T == null) T = p.kg;
    else {
      const dd = Math.max(0, (p.t - last) / 864e5);
      const a = 1 - Math.pow(0.9, Math.max(dd, 0.5));
      T = T + a * (p.kg - T);
    }
    last = p.t;
    return { ...p, trend: T };
  });
}

/**
 * Trend slope in kg/week from the smoothed series over the last 28 days. Requires ≥ 14 days of span and ≥ 4 weigh-ins.
 * Returns { perWeek, se, ready } .
 */
export function trendSlope(points, windowDays = 28) {
  const tr = ewmaTrend(points);
  if (tr.length < 4) return { ready: false };
  const lastT = tr[tr.length - 1].t;
  const firstT = tr[0].t;
  if ((lastT - firstT) / 864e5 < 14) return { ready: false };
  const pts = tr.filter((p) => p.t >= lastT - windowDays * 864e5).map((p) => ({ x: (p.t - lastT) / 864e5, y: p.trend }));
  if (pts.length < 3) return { ready: false };
  const n = pts.length, mx = pts.reduce((a, p) => a + p.x, 0) / n, my = pts.reduce((a, p) => a + p.y, 0) / n;
  let sxx = 0, sxy = 0;
  for (const p of pts) { sxx += (p.x - mx) ** 2; sxy += (p.x - mx) * (p.y - my); }
  if (!sxx) return { ready: false };
  const b = sxy / sxx;
  let sse = 0;
  for (const p of pts) sse += (p.y - (my + b * (p.x - mx))) ** 2;
  const se = n > 2 ? Math.sqrt(sse / (n - 2) / sxx) : 0;
  return { ready: true, perWeek: b * 7, se: se * 7, current: tr[tr.length - 1].trend };
}

/* ---------------- heart rate (informational) ---------------- */
export const hrMax = (age) => (age > 0 ? Math.round(208 - 0.7 * age) : null);
