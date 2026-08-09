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
  },

  /* From Apple Health, not Whoop. Every one of these is something the strap
     cannot see, which is the only reason it is here. See src/data/health.js. */
  steps: {
    label: 'Steps', unit: '', field: 'steps', dp: 0, better: 'up', flat: 200, apple: true,
    phrase: 'How much you actually moved. Your phone has been counting whether you asked it to or not.'
  },
  walkKm: {
    label: 'Distance', unit: 'km', field: 'walkKm', dp: 1, better: 'up', flat: 0.2, apple: true,
    phrase: 'Ground covered on your own feet. Escalators do not count and never did.'
  },
  flights: {
    label: 'Flights', unit: '', field: 'flights', dp: 0, better: 'up', flat: 0.5, apple: true,
    phrase: 'Floors climbed. The one number that goes up when the lift is broken.'
  },
  exerciseMin: {
    label: 'Exercise', unit: '', field: 'exerciseMin', dp: 0, better: 'up', flat: 2, asTime: true, apple: true,
    phrase: 'Minutes your phone counted as real effort. Stricter than you are about yourself.'
  },
  weightKg: {
    label: 'Weight', unit: 'kg', field: 'weightKg', dp: 1, better: 'neutral', flat: 0.15, apple: true,
    phrase: 'Only ever useful as a line. Never as a morning.'
  },
  bodyFatPct: {
    label: 'Body fat', unit: '%', field: 'bodyFatPct', dp: 1, better: 'neutral', flat: 0.1, apple: true,
    phrase: 'Moves slowly. Anything moving fast here is the scale guessing.'
  },
  bmi: {
    label: 'BMI', unit: '', field: 'bmi', dp: 1, better: 'neutral', flat: 0.1, apple: true,
    phrase: 'A number from 1832 that does not know you train. Shown because it is there.'
  },
  vo2max: {
    label: 'VO2 max', unit: '', field: 'vo2max', dp: 1, better: 'up', flat: 0.2, apple: true,
    phrase: 'Your engine. Goes up slower than you want and down faster than you think.'
  },
  caffeineMg: {
    label: 'Caffeine', unit: 'mg', field: 'caffeineMg', dp: 0, better: 'neutral', flat: 10, apple: true,
    phrase: 'What you logged drinking. When you drank it matters more than how much.'
  },
  drinks: {
    label: 'Drinks', unit: '', field: 'drinks', dp: 1, better: 'down', flat: 0.1, apple: true,
    phrase: 'Counted, not judged. Your HRV does the judging.'
  },
  waterL: {
    label: 'Water', unit: 'L', field: 'waterL', dp: 1, better: 'up', flat: 0.05, apple: true,
    phrase: 'Logged water only. Everything you drank without telling your phone is invisible here.'
  },
  kcalIn: {
    label: 'Eaten', unit: 'kcal', field: 'kcalIn', dp: 0, better: 'neutral', flat: 30, apple: true,
    phrase: 'What went in, next to everything else here that measures what went out.'
  },
  proteinG: {
    label: 'Protein', unit: 'g', field: 'proteinG', dp: 0, better: 'up', flat: 3, apple: true,
    phrase: 'As accurate as your logging, which is to say generous.'
  },
  daylightMin: {
    label: 'Daylight', unit: '', field: 'daylightMin', dp: 0, better: 'up', flat: 3, asTime: true, apple: true,
    phrase: 'Time outside in real light. The cheapest thing on this list and the one you skip.'
  },
  mindfulMin: {
    label: 'Mindful', unit: '', field: 'mindfulMin', dp: 0, better: 'up', flat: 1, asTime: true, apple: true,
    phrase: 'Minutes you sat still on purpose.'
  },
  headphoneDb: {
    label: 'Headphones', unit: 'dB', field: 'headphoneDb', dp: 0, better: 'down', flat: 0.5, apple: true,
    phrase: 'How loud you have been listening. Ears do not heal.'
  },
  mood: {
    label: 'Mood', unit: '', field: 'mood', dp: 0, better: 'up', flat: 1, apple: true,
    phrase: 'What you logged feeling, out of 100. The only number in this app you chose.'
  }
};

for (const m of Object.values(METRICS)) {
  const { field, scale = 1 } = m;
  m.get = (d) => (d[field] == null ? null : d[field] * scale);
}

// Pane one is the six you check first. Pane two is everything else.
export const CORE_TILES = ['sleep', 'strain', 'hrv', 'rhr', 'sleepDebt', 'calories'];
export const MORE_TILES = ['sleepPerf', 'rhythm', 'sleepConsistency', 'sleepEff', 'spo2', 'respRate', 'skinTemp', 'avgHr', 'maxHr', 'workouts'];

/**
 * The Apple ones, in the order a person would read them. They are never all
 * shown: an iPhone with no watch records steps and almost nothing else, and a
 * grid of seventeen dashes is worse than no grid, so `withData` decides.
 */
export const LIFE_TILES = [
  'steps', 'walkKm', 'flights', 'exerciseMin',
  'weightKg', 'bodyFatPct', 'bmi', 'vo2max',
  'caffeineMg', 'drinks', 'waterL', 'kcalIn', 'proteinG',
  'daylightMin', 'mindfulMin', 'headphoneDb', 'mood'
];

/** Body composition moves over months, so it is read against itself, not
    against what you did yesterday. Everything else is behaviour. */
export const BODY_TILES = ['weightKg', 'bodyFatPct', 'bmi', 'vo2max'];
export const BEHAVIOUR_TILES = LIFE_TILES.filter((k) => !BODY_TILES.includes(k));

/**
 * Which of `keys` are worth drawing, on the evidence.
 *
 * A field that appears on two days out of ninety is a stray sample from an app
 * you tried once, not a metric you have. `minDays` is what separates them.
 */
export function withData(days, keys = LIFE_TILES, minDays = 5) {
  return keys.filter((key) => {
    const meta = METRICS[key];
    if (!meta) return false;
    let n = 0;
    for (const d of days) {
      if (Number.isFinite(meta.get(d)) && ++n >= minDays) return true;
    }
    return false;
  });
}

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
