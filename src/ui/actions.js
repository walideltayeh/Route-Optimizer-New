// Cross-screen actions registry. Screens call actions.X(...); the module that owns X registers it at load.
// This avoids circular imports between screens. Every action is optional-safe: calling an unregistered action logs a warning.
//
// Registered by (module → actions) — every entry below is registered at module load by its owner:
//   main.js        → refresh(), go(name, param), back(fallback)
//   player.js      → startWorkout({ workoutId, slotKey, level, length, segs, name }), resumeWorkout(snapshot)
//   summary.js     → openSummary(sessionId, { fresh })
//   library.js     → openWorkout(workoutId, { slotKey, level, length })                (workout detail sheet)
//   builder.js     → openBuilder({ id, draft, restore }), openQuickDraft()
//   progress.js    → logWeight(), openSession(sessionId), logManualSession()
//   onboarding.js  → openOnboarding({ edit, step }), closeOnboarding()
//   me.js          → openStopSigns(), openHowWeCalculate(), openLesson(lessonId), importBackup(), exportBackup()
//   plan.js        → openSlot(slotKey)
// Use `name in actions` to test whether an action is registered (the proxy returns a warning stub otherwise).
export const actions = new Proxy({}, {
  get(target, prop) {
    if (prop in target) return target[prop];
    if (typeof prop === 'symbol') return undefined;
    return (...args) => { console.warn(`[actions] "${String(prop)}" is not registered`, args); };
  },
  set(target, prop, value) { target[prop] = value; return true; },
});
