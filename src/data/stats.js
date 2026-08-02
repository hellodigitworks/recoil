// Everything that turns daily rows into an answer.
//
// Rule for this file: never report a pattern without its sample size. A number
// derived from four nights is not a finding, and the UI has to be able to say so.

export * from './trends.js';
export * from './activities.js';

export const GREEN = 67; // Whoop's own recovery bands: >=67 green, 34-66 amber, <34 red
export const AMBER = 34;

const nums = (arr) => arr.filter((v) => typeof v === 'number' && Number.isFinite(v));

export function mean(arr) {
  const v = nums(arr);
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
}

export function median(arr) {
  const v = nums(arr).sort((a, b) => a - b);
  if (!v.length) return null;
  const mid = v.length >> 1;
  return v.length % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2;
}

/** Pearson r. Null below 3 pairs, because r on two points is always 1. */
export function pearson(xs, ys) {
  const pairs = xs.map((x, i) => [x, ys[i]]).filter(([x, y]) => Number.isFinite(x) && Number.isFinite(y));
  if (pairs.length < 3) return null;
  const mx = mean(pairs.map((p) => p[0]));
  const my = mean(pairs.map((p) => p[1]));
  let num = 0, dx = 0, dy = 0;
  for (const [x, y] of pairs) {
    num += (x - mx) * (y - my);
    dx += (x - mx) ** 2;
    dy += (y - my) ** 2;
  }
  const den = Math.sqrt(dx * dy);
  return den === 0 ? null : num / den;
}

/** Your personal normal: median of the trailing window, per day. */
export function rollingBaseline(days, key, window = 30) {
  const out = [];
  for (let i = 0; i < days.length; i++) {
    const slice = days.slice(Math.max(0, i - window + 1), i + 1).map((d) => d[key]);
    out.push(median(slice));
  }
  return out;
}

/** Least-squares slope, expressed as change per 30 days. */
export function trendPerMonth(days, key) {
  const pts = days.map((d, i) => [i, d[key]]).filter(([, y]) => Number.isFinite(y));
  if (pts.length < 8) return null;
  const mx = mean(pts.map((p) => p[0]));
  const my = mean(pts.map((p) => p[1]));
  let num = 0, den = 0;
  for (const [x, y] of pts) {
    num += (x - mx) * (y - my);
    den += (x - mx) ** 2;
  }
  return den === 0 ? null : (num / den) * 30;
}

/** Minutes past 18:00, so an 11pm and a 1am bedtime sit next to each other. */
export function bedtimeAxis(bedtimeMin) {
  if (!Number.isFinite(bedtimeMin)) return null;
  return (bedtimeMin - 1080 + 1440) % 1440;
}

export function clockLabel(bedtimeMin) {
  if (!Number.isFinite(bedtimeMin)) return '—';
  const h = Math.floor(bedtimeMin / 60) % 24;
  const m = Math.round(bedtimeMin % 60);
  return String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0');
}

function bucketStats(buckets, minN = 3) {
  return [...buckets.entries()]
    .map(([k, vals]) => ({ key: k, n: vals.length, value: mean(vals) }))
    .filter((b) => b.n >= minN && b.value != null)
    .sort((a, b) => a.key - b.key);
}

/**
 * Bedtime against the recovery it produced. The sleep on a row is already the
 * sleep that scored that row's recovery, so no day-shifting is needed here.
 */
export function bedtimeVsRecovery(days) {
  const buckets = new Map();
  const xs = [], ys = [];
  for (const d of days) {
    const axis = bedtimeAxis(d.bedtimeMin);
    if (axis == null || !Number.isFinite(d.recovery)) continue;
    const hour = Math.floor(axis / 60);
    if (!buckets.has(hour)) buckets.set(hour, []);
    buckets.get(hour).push(d.recovery);
    xs.push(axis); ys.push(d.recovery);
  }
  const rows = bucketStats(buckets).map((b) => ({
    ...b,
    label: clockLabel((b.key * 60 + 1080) % 1440)
  }));
  return { rows, r: pearson(xs, ys), n: xs.length };
}

/**
 * How much sleep you personally need. Finds the shortest half-hour bin whose
 * average recovery is already within 2 points of your best bin, i.e. the point
 * where extra hours stop paying.
 */
export function sleepHoursVsRecovery(days) {
  const buckets = new Map();
  const xs = [], ys = [];
  for (const d of days) {
    if (!Number.isFinite(d.asleepMin) || !Number.isFinite(d.recovery)) continue;
    const bin = Math.round(d.asleepMin / 30) / 2; // half-hour bins
    if (!buckets.has(bin)) buckets.set(bin, []);
    buckets.get(bin).push(d.recovery);
    xs.push(d.asleepMin / 60); ys.push(d.recovery);
  }
  const rows = bucketStats(buckets).map((b) => ({ ...b, label: b.key.toFixed(1) + 'h' }));
  let sweetSpot = null;
  if (rows.length >= 3) {
    const best = Math.max(...rows.map((r) => r.value));
    sweetSpot = rows.find((r) => r.value >= best - 2) || null;
  }
  return { rows, r: pearson(xs, ys), n: xs.length, sweetSpot };
}

/** Workout on day D judged by recovery on day D+1, versus your overall average. */
export function workoutImpact(days, workouts) {
  const recoveryByDate = new Map(days.filter((d) => Number.isFinite(d.recovery)).map((d) => [d.date, d.recovery]));
  const overall = mean([...recoveryByDate.values()]);
  const bySport = new Map();

  for (const w of workouts) {
    const next = new Date(Date.parse(w.date + 'T00:00:00Z') + 86400000).toISOString().slice(0, 10);
    const rec = recoveryByDate.get(next);
    if (!Number.isFinite(rec)) continue;
    if (!bySport.has(w.sport)) bySport.set(w.sport, { recs: [], strains: [], mins: [] });
    const e = bySport.get(w.sport);
    e.recs.push(rec);
    if (Number.isFinite(w.strain)) e.strains.push(w.strain);
    if (Number.isFinite(w.durationMin)) e.mins.push(w.durationMin);
  }

  const rows = [...bySport.entries()]
    .map(([sport, e]) => ({
      sport,
      n: e.recs.length,
      nextRecovery: mean(e.recs),
      delta: overall == null ? null : mean(e.recs) - overall,
      avgStrain: mean(e.strains),
      avgMin: mean(e.mins)
    }))
    .filter((r) => r.n >= 3)
    .sort((a, b) => (b.delta ?? -99) - (a.delta ?? -99));

  return { rows, overall, n: workouts.length };
}

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export function weekdayOf(dateStr) {
  const t = Date.parse(dateStr + 'T00:00:00Z');
  return Number.isNaN(t) ? null : new Date(t).getUTCDay();
}

/** Does your week have a shape? Recovery, sleep and strain by day of week. */
export function weekShape(days) {
  const rows = WEEKDAYS.map((name, i) => {
    const set = days.filter((d) => weekdayOf(d.date) === i);
    return {
      key: i,
      label: name,
      short: name.slice(0, 3),
      n: set.length,
      recovery: mean(set.map((d) => d.recovery)),
      sleepH: (() => { const m = mean(set.map((d) => d.asleepMin)); return m == null ? null : m / 60; })(),
      strain: mean(set.map((d) => d.strain)),
      bedtime: median(set.map((d) => bedtimeAxis(d.bedtimeMin)))
    };
  });
  // Start the week on Monday, which is how a week actually reads.
  return [...rows.slice(1), rows[0]];
}

/** Longest run of consecutive calendar days passing `test`. */
export function longestStreak(days, test) {
  let best = { length: 0, from: null, to: null };
  let run = 0, from = null, prevDate = null;
  for (const d of days) {
    const contiguous = prevDate == null || Date.parse(d.date + 'T00:00:00Z') - Date.parse(prevDate + 'T00:00:00Z') === 86400000;
    if (test(d) && contiguous) {
      run += 1;
      from = run === 1 ? d.date : from;
    } else if (test(d)) {
      run = 1; from = d.date;
    } else {
      run = 0; from = null;
    }
    if (run > best.length) best = { length: run, from, to: d.date };
    prevDate = d.date;
  }
  return best;
}

const pick = (days, key, cmp) => {
  const set = days.filter((d) => Number.isFinite(d[key]));
  if (!set.length) return null;
  return set.reduce((a, b) => (cmp(b[key], a[key]) ? b : a));
};

/** Best 7-day rolling mean recovery and where it happened. */
export function bestWeek(days) {
  let best = null;
  for (let i = 0; i + 7 <= days.length; i++) {
    const win = days.slice(i, i + 7);
    const m = mean(win.map((d) => d.recovery));
    if (m != null && (!best || m > best.value)) best = { value: m, from: win[0].date, to: win[6].date };
  }
  return best;
}

export function records(days, workouts) {
  const hardest = workouts.filter((w) => Number.isFinite(w.strain)).sort((a, b) => b.strain - a.strain)[0] || null;
  const longestWorkout = workouts.filter((w) => Number.isFinite(w.durationMin)).sort((a, b) => b.durationMin - a.durationMin)[0] || null;
  return {
    bestRecovery: pick(days, 'recovery', (a, b) => a > b),
    worstRecovery: pick(days, 'recovery', (a, b) => a < b),
    longestSleep: pick(days, 'asleepMin', (a, b) => a > b),
    shortestSleep: pick(days, 'asleepMin', (a, b) => a < b),
    highestStrain: pick(days, 'strain', (a, b) => a > b),
    lowestRhr: pick(days, 'rhr', (a, b) => a < b),
    highestHrv: pick(days, 'hrv', (a, b) => a > b),
    greenStreak: longestStreak(days, (d) => Number.isFinite(d.recovery) && d.recovery >= GREEN),
    sleepStreak: longestStreak(days, (d) => Number.isFinite(d.asleepMin) && d.asleepMin >= 420),
    bestWeek: bestWeek(days),
    hardestWorkout: hardest,
    longestWorkout
  };
}

/* ------------------------------------------------- personal baselines -- */

/** How many days of history a baseline needs before it is worth trusting. */
export const BASELINE_WINDOW = 60;
const MIN_BASELINE_N = 21;

/**
 * Your own normal for a metric, and how far today sits from it.
 *
 * Deliberately excludes the day being judged, so a genuinely unusual day cannot
 * drag its own baseline toward itself and hide.
 *
 * @returns {{mean:number, sd:number, z:number, n:number}|null}
 */
export function baselineAt(days, index, field, window = BASELINE_WINDOW) {
  const prior = days.slice(Math.max(0, index - window), index)
    .map((d) => d[field])
    .filter((v) => Number.isFinite(v));
  if (prior.length < MIN_BASELINE_N) return null;

  const m = mean(prior);
  const sd = Math.sqrt(prior.reduce((s, x) => s + (x - m) ** 2, 0) / (prior.length - 1));
  const value = days[index]?.[field];
  return {
    mean: m,
    sd,
    n: prior.length,
    z: sd > 0 && Number.isFinite(value) ? (value - m) / sd : null
  };
}

/** normal / mild / significant, from your own spread rather than a fixed cut-off. */
export function deviation(z) {
  if (!Number.isFinite(z)) return 'unknown';
  const a = Math.abs(z);
  if (a < 1) return 'normal';
  if (a < 2) return 'mild';
  return 'significant';
}

/** Baseline for the newest day. */
export function baselineNow(days, field, window = BASELINE_WINDOW) {
  return days.length ? baselineAt(days, days.length - 1, field, window) : null;
}

/* --------------------------------------------- strain -> next recovery -- */

/**
 * Does a hard day actually cost you tomorrow, and past what strain?
 * Pairs strain on day X with recovery on X+1, then finds the lowest strain bin
 * whose mean next-day recovery drops below your overall mean and stays there.
 */
export function strainVsNextRecovery(days) {
  const byDate = new Map(days.map((d) => [d.date, d]));
  const points = [];
  for (const d of days) {
    if (!Number.isFinite(d.strain)) continue;
    const next = byDate.get(new Date(Date.parse(d.date + 'T00:00:00Z') + 86400000).toISOString().slice(0, 10));
    if (!next || !Number.isFinite(next.recovery)) continue;
    points.push({ date: d.date, strain: d.strain, recovery: next.recovery });
  }

  const overall = mean(points.map((p) => p.recovery));
  const buckets = new Map();
  for (const p of points) {
    const bin = Math.floor(p.strain / 2) * 2; // 0-2, 2-4, ...
    if (!buckets.has(bin)) buckets.set(bin, []);
    buckets.get(bin).push(p.recovery);
  }
  const rows = [...buckets.entries()]
    .map(([bin, recs]) => ({ key: bin, label: `${bin}-${bin + 2}`, n: recs.length, value: mean(recs) }))
    .filter((r) => r.n >= 3)
    .sort((a, b) => a.key - b.key);

  // The threshold is the first bin from which every heavier bin also sits below
  // your average. One dip in the middle is noise, not a threshold.
  let threshold = null;
  for (let i = 0; i < rows.length; i++) {
    if (rows.slice(i).every((r) => r.value < overall)) { threshold = rows[i]; break; }
  }

  return {
    points, rows, overall, threshold,
    n: points.length,
    r: pearson(points.map((p) => p.strain), points.map((p) => p.recovery))
  };
}

/* ------------------------------------------------- sleep rhythm score -- */

/**
 * How steady your clock is, from the spread of your bed and wake times.
 *
 * Uses circular statistics: 23:50 and 00:10 are twenty minutes apart, not
 * twenty-three hours. Scored so 0 minutes of spread is 100 and two hours is 0,
 * which is a scale you can hold in your head.
 */
export function circularSd(minutes) {
  const vals = nums(minutes);
  if (vals.length < 2) return null;
  let sin = 0, cos = 0;
  for (const m of vals) {
    const a = (2 * Math.PI * m) / 1440;
    sin += Math.sin(a); cos += Math.cos(a);
  }
  const R = Math.sqrt((sin / vals.length) ** 2 + (cos / vals.length) ** 2);
  if (R <= 0 || R >= 1) return 0;
  return Math.sqrt(-2 * Math.log(R)) * (1440 / (2 * Math.PI));
}

const SPREAD_AT_ZERO = 120; // two hours of drift scores nothing

export function rhythmScore(window) {
  const bed = circularSd(window.map((d) => d.bedtimeMin));
  const wake = circularSd(window.map((d) => d.wakeMin));
  if (bed == null && wake == null) return null;
  const spread = mean([bed, wake]);
  return {
    score: Math.max(0, Math.min(100, Math.round(100 - (spread / SPREAD_AT_ZERO) * 100))),
    bedSd: bed, wakeSd: wake, n: window.filter((d) => Number.isFinite(d.bedtimeMin)).length
  };
}

/** Rolling rhythm score per day, so it can be charted over time. */
export function rhythmSeries(days, window = 7) {
  return days.map((d, i) => {
    const slice = days.slice(Math.max(0, i - window + 1), i + 1);
    const r = slice.length >= Math.min(window, 4) ? rhythmScore(slice) : null;
    return { date: d.date, score: r ? r.score : null };
  });
}

/* ---------------------------------------------------- sleep debt ledger -- */

export const DEFAULT_SLEEP_TARGET_MIN = 480; // 8 hours

/**
 * Running surplus and deficit against a target you set, rather than one night
 * measured against Whoop's own estimate of what you needed.
 * Positive `cumulative` means you are behind.
 */
export function sleepLedger(days, targetMin = DEFAULT_SLEEP_TARGET_MIN) {
  let running = 0;
  const rows = days.map((d) => {
    const delta = Number.isFinite(d.asleepMin) ? targetMin - d.asleepMin : 0;
    running += delta;
    return { date: d.date, asleepMin: d.asleepMin, delta, cumulative: running };
  });
  const window = (n) => {
    const slice = rows.slice(-n);
    return slice.reduce((s, r) => s + r.delta, 0);
  };
  return { rows, target: targetMin, week: window(7), month: window(30), total: running };
}

/* ------------------------------------------------------- early warning -- */

/** Beyond this many standard deviations counts as moving the wrong way. */
const WARN_Z = 0.7;
const WARN_DAYS = 2;

/**
 * Illness and overtraining rarely announce themselves on one metric. This flags
 * the case where resting heart rate, HRV and respiratory rate are ALL moving
 * unfavourably at once for two days running, even though no single one of them
 * has crossed a threshold Whoop would alert on.
 */
export function earlyWarning(days) {
  const marks = days.map((_, i) => {
    const rhr = baselineAt(days, i, 'rhr');
    const hrv = baselineAt(days, i, 'hrv');
    const resp = baselineAt(days, i, 'respRate');
    if (!rhr?.z && rhr?.z !== 0) return null;
    if (!hrv || !resp) return null;
    if (![rhr.z, hrv.z, resp.z].every(Number.isFinite)) return null;
    // Unfavourable: heart rate up, variability down, breathing up.
    const bad = rhr.z >= WARN_Z && hrv.z <= -WARN_Z && resp.z >= WARN_Z;
    return bad ? { date: days[i].date, rhr, hrv, resp } : null;
  });

  let run = [];
  for (let i = marks.length - 1; i >= 0; i--) {
    if (!marks[i]) break;
    run.unshift(marks[i]);
  }
  if (run.length < WARN_DAYS) return null;
  const latest = run[run.length - 1];
  return {
    days: run.length,
    since: run[0].date,
    rhrUp: latest.rhr.z * latest.rhr.sd,
    hrvDown: -latest.hrv.z * latest.hrv.sd,
    respUp: latest.resp.z * latest.resp.sd
  };
}

/** Recovery band for colour and copy. */
export function band(recovery) {
  if (!Number.isFinite(recovery)) return 'none';
  if (recovery >= GREEN) return 'green';
  if (recovery >= AMBER) return 'amber';
  return 'red';
}

/** Last N days of rows, trailing from the newest date present. */
export function lastDays(days, n) {
  if (!n || n <= 0) return days;
  return days.slice(-n);
}

/**
 * Collapse rows into buckets of `size` days, taking the median of `field` in
 * each. A year of daily points in 300px of width is not a chart, it is a
 * texture; this is what makes long ranges readable. Chunked from the newest
 * backwards so the most recent bucket is always whole.
 */
export function bucketBy(days, size, field) {
  if (size <= 1 || days.length <= size) return days;
  const out = [];
  for (let end = days.length; end > 0; end -= size) {
    const chunk = days.slice(Math.max(0, end - size), end);
    const value = median(chunk.map((d) => d[field]));
    out.unshift({
      date: chunk[chunk.length - 1].date,
      from: chunk[0].date,
      span: chunk.length,
      [field]: value
    });
  }
  return out;
}

/**
 * How many days each point should cover so the line stays legible.
 * One point per ~4px of chart, rounded to whole weeks past a fortnight.
 */
export function bucketSizeFor(count, width) {
  const target = Math.max(24, Math.floor(width / 4));
  if (count <= target) return 1;
  const raw = Math.ceil(count / target);
  return raw <= 2 ? raw : Math.ceil(raw / 7) * 7;
}
