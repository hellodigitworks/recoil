// What each number is, what about it matters, and how to render it.
//
// `phrase` is the line under every tile. It has to say the thing in one breath:
// what you are looking at, and what would make it good or bad.
// `flat` is the per-month drift below which a trend is noise, not a story.

export const METRICS = {
  recovery: {
    label: 'Recovery', unit: '%', field: 'recovery', dp: 0, better: 'up', flat: 0.8, bands: true,
    phrase: 'How much of you showed up today. Above 67 go wild, below 34 go back to bed.'
  },
  sleep: {
    label: 'Sleep', unit: 'h', field: 'asleepMin', scale: 1 / 60, dp: 1, better: 'up', flat: 0.15,
    phrase: 'Actually asleep. Lying in the dark scrolling does not count and never did.'
  },
  strain: {
    label: 'Strain', unit: '', field: 'strain', dp: 1, better: 'neutral', flat: 0.25,
    phrase: 'What the day took out of you, out of 21. Being alive is not free.'
  },
  hrv: {
    label: 'HRV', unit: 'ms', field: 'hrv', dp: 0, better: 'up', flat: 0.8,
    phrase: 'Your headroom. Only ever compare it to your own, never to anyone else on the internet.'
  },
  rhr: {
    label: 'Resting HR', unit: 'bpm', field: 'rhr', dp: 0, better: 'down', flat: 0.4,
    phrase: 'Lower means fresher. This one tells on you before you feel anything.'
  },
  sleepDebt: {
    label: 'Sleep debt', unit: '', field: 'sleepDebtMin', dp: 0, better: 'down', flat: 5, asTime: true,
    phrase: 'What you still owe your body. It does not forgive the balance, it just waits.'
  },
  calories: {
    label: 'Calories', unit: 'kcal', field: 'calories', dp: 0, better: 'neutral', flat: 30,
    phrase: 'Everything you burned. Training, panicking, existing.'
  },
  sleepPerf: {
    label: 'Sleep score', unit: '%', field: 'sleepPerf', dp: 0, better: 'up', flat: 1,
    phrase: 'How much of the sleep you needed you actually got. Whoop grading your night.'
  },
  sleepConsistency: {
    label: 'Consistency', unit: '%', field: 'sleepConsistency', dp: 0, better: 'up', flat: 1,
    phrase: 'Whether you keep the same hours or reinvent yourself nightly.'
  },
  sleepEff: {
    label: 'Efficiency', unit: '%', field: 'sleepEff', dp: 1, better: 'up', flat: 0.5,
    phrase: 'Asleep versus lying there staring at the ceiling.'
  },
  spo2: {
    label: 'Blood oxygen', unit: '%', field: 'spo2', dp: 1, better: 'up', flat: 0.15,
    phrase: 'Oxygen while you sleep. 95 to 100 is where you want to live.'
  },
  respRate: {
    label: 'Resp rate', unit: '', field: 'respRate', dp: 1, better: 'neutral', flat: 0.15,
    phrase: 'Breaths a minute while asleep. Steady is the whole point.'
  },
  skinTemp: {
    label: 'Skin temp', unit: '°C', field: 'skinTemp', dp: 1, better: 'neutral', flat: 0.1,
    phrase: 'Quietly climbs a day or two before you admit you are getting ill.'
  },
  avgHr: {
    label: 'Avg HR', unit: 'bpm', field: 'avgHr', dp: 0, better: 'neutral', flat: 0.5,
    phrase: 'Your heart across the entire day, meetings included.'
  },
  maxHr: {
    label: 'Max HR', unit: 'bpm', field: 'maxHr', dp: 0, better: 'neutral', flat: 0.5,
    phrase: 'The single hardest moment of your day.'
  },
  workouts: {
    label: 'Training strain', unit: '', field: 'workoutStrain', dp: 1, better: 'neutral', flat: 0.3,
    phrase: 'Only the sessions you logged. Strain counts the rest of your chaos too.'
  },
  // Computed here, not by Whoop: the spread of your own bed and wake times.
  rhythm: {
    label: 'Clock', unit: '', field: 'rhythm', dp: 0, better: 'up', flat: 1,
    phrase: 'Ours, not Whoop’s. How tightly you keep your own bed and wake times.'
  }
};

for (const m of Object.values(METRICS)) {
  const { field, scale = 1 } = m;
  m.get = (d) => (d[field] == null ? null : d[field] * scale);
}

// Pane one is the six you check first. Pane two is everything else.
export const CORE_TILES = ['sleep', 'strain', 'hrv', 'rhr', 'sleepDebt', 'calories'];
export const MORE_TILES = ['sleepPerf', 'rhythm', 'sleepConsistency', 'sleepEff', 'spo2', 'respRate', 'skinTemp', 'avgHr', 'maxHr', 'workouts'];

/** Metrics whose deviation from your own baseline is worth flagging. */
export const BASELINE_METRICS = ['rhr', 'hrv', 'respRate'];

/** "1h 15m". Durations never read well as a decimal. */
export function hm(m) {
  if (!Number.isFinite(m)) return '—';
  const sign = m < 0 ? '−' : '';
  const abs = Math.abs(m);
  const h = Math.floor(abs / 60);
  const m2 = Math.round(abs % 60);
  if (!h) return `${sign}${Math.round(abs)}m`;
  // A round hour reads as "8h". "8h 0m" is how a machine says it.
  return m2 ? `${sign}${h}h ${m2}m` : `${sign}${h}h`;
}

/** Display string for a value, without its unit. Uses − not - for negatives. */
export function fmtValue(meta, v, { signed = false } = {}) {
  if (!Number.isFinite(v)) return '—';
  if (meta.asTime) return (signed && v > 0 ? '+' : '') + hm(v);
  const body = Math.abs(v).toFixed(meta.dp);
  if (!signed) return v < 0 ? '−' + body : body;
  return (v >= 0 ? '+' : '−') + body;
}

/** The unit shown beside a delta. Durations carry theirs inside the value. */
export const deltaUnit = (meta) => (meta.asTime ? '' : meta.unit);

/** Below this, a change is not worth colouring green or red. */
export const deltaNoise = (meta) => (meta.asTime ? 4 : 0.05);
