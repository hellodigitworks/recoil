// Trend windows: the week, month and six months a trend view steps through,
// and the comparison with the window immediately before.
//
// Weeks run Monday to Sunday and months are calendar months, because those are
// the periods you actually live in. Stepping back therefore lands on clean
// boundaries instead of drifting by a few days each time.

import { mean } from './stats.js';

const iso = (d) => d.toISOString().slice(0, 10);
const utc = (s) => new Date(Date.parse(s + 'T00:00:00Z'));

export const TREND_UNITS = [
  { key: 'W', label: 'week', months: 0 },
  { key: 'M', label: 'month', months: 1 },
  { key: '6M', label: '6 months', months: 6 },
  { key: '1Y', label: 'year', months: 12 },
  { key: 'ALL', label: 'all time', months: null }
];

/** Units where the daily line is texture and the month averages are the story. */
export const isLongRange = (unit) => unit === '6M' || unit === '1Y' || unit === 'ALL';

/**
 * The window a trend view is showing. `offset` steps backwards: 0 is the period
 * containing `anchor`, -1 the one before it.
 *
 * Weeks run Monday to Sunday and months are calendar months, because those are
 * the periods you actually live in. Six months is six whole calendar months so
 * stepping back lands on clean boundaries rather than drifting.
 */
export function periodBounds(anchor, unit, offset = 0) {
  const a = utc(anchor);
  if (unit === 'W') {
    const dow = (a.getUTCDay() + 6) % 7; // Monday = 0
    const from = new Date(a); from.setUTCDate(a.getUTCDate() - dow + offset * 7);
    const to = new Date(from); to.setUTCDate(from.getUTCDate() + 6);
    return { from: iso(from), to: iso(to) };
  }
  const months = (TREND_UNITS.find((u) => u.key === unit) || {}).months || 1;
  const end = new Date(Date.UTC(a.getUTCFullYear(), a.getUTCMonth() + 1 + offset * months, 0));
  const start = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth() - months + 1, 1));
  return { from: iso(start), to: iso(end) };
}

/**
 * Rows inside a window, plus the equivalent window immediately before it.
 * "All time" has no window and nothing to compare against, so it returns the
 * whole history and an empty prior period rather than inventing one.
 */
export function periodSlice(days, anchor, unit, offset = 0) {
  if (unit === 'ALL') {
    return days.length
      ? { from: days[0].date, to: days[days.length - 1].date, rows: days, prevRows: [], prev: null }
      : { from: anchor, to: anchor, rows: [], prevRows: [], prev: null };
  }
  const now = periodBounds(anchor, unit, offset);
  const prev = periodBounds(anchor, unit, offset - 1);
  const within = (b) => days.filter((d) => d.date >= b.from && d.date <= b.to);
  return { ...now, rows: within(now), prevRows: within(prev), prev };
}

/**
 * Average across a window and how it compares with the window before, which is
 * the comparison that actually tells you whether anything changed.
 */
export function periodSummary(slice, field) {
  const now = mean(slice.rows.map((d) => d[field]));
  const before = mean(slice.prevRows.map((d) => d[field]));
  const change = now != null && before != null && before !== 0
    ? ((now - before) / Math.abs(before)) * 100 : null;
  return { average: now, previous: before, change, n: slice.rows.filter((d) => Number.isFinite(d[field])).length };
}

const MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Per-calendar-month means inside a window, with each month's change on the last. */
export function monthlyMeans(rows, field) {
  const buckets = new Map();
  for (const d of rows) {
    const key = d.date.slice(0, 7);
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(d[field]);
  }
  const out = [...buckets.entries()].sort().map(([key, vals]) => ({
    key,
    label: MONTH_SHORT[Number(key.slice(5, 7)) - 1],
    value: mean(vals),
    n: vals.filter((v) => Number.isFinite(v)).length
  }));
  out.forEach((m, i) => {
    const prior = out[i - 1];
    m.change = i && prior.value != null && m.value != null && prior.value !== 0
      ? ((m.value - prior.value) / Math.abs(prior.value)) * 100 : null;
  });
  return out;
}

/** Human label for the window, matching how the period reads on screen. */
export function periodLabel(bounds, unit) {
  const f = utc(bounds.from), t = utc(bounds.to);
  const d = (x) => `${x.getUTCDate()} ${MONTH_SHORT[x.getUTCMonth()].toUpperCase()}`;
  const my = (x) => `${MONTH_SHORT[x.getUTCMonth()].toUpperCase()} ${x.getUTCFullYear()}`;
  if (unit === 'M') return my(f);
  if (unit === 'ALL') return `${my(f)} — ${my(t)}`;
  if (unit === '1Y') return `${my(f)} — ${my(t)}`;
  return `${d(f)} — ${d(t)}`;
}
