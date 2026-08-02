// Everything you have ever done, sport by sport.
//
// Written to answer the questions a person actually asks about their own
// training: how often, when in the year, and what it takes out of you the next
// morning. Numbers only ever appear alongside the count they came from.

import { mean } from './stats.js';

/** Seasons as they are actually lived in western India, not meteorologically. */
export const SEASONS = [
  { key: 'summer', label: 'Summer', months: [2, 3, 4] },
  { key: 'monsoon', label: 'Monsoon', months: [5, 6, 7, 8] },
  { key: 'winter', label: 'Winter', months: [9, 10, 11, 0, 1] }
];

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'];

export const seasonOf = (iso) => {
  const m = new Date(Date.parse(iso + 'T00:00:00Z')).getUTCMonth();
  return SEASONS.find((s) => s.months.includes(m));
};

/**
 * Everything you have ever done, per sport, described the way a person would
 * ask about it: how often, how hard, when in the year, and what it costs you
 * the next morning.
 */
export function activityProfile(days, workouts) {
  const recoveryByDate = new Map(days.filter((d) => Number.isFinite(d.recovery)).map((d) => [d.date, d.recovery]));
  const overall = mean([...recoveryByDate.values()]);
  const nextDay = (iso) => recoveryByDate.get(new Date(Date.parse(iso + 'T00:00:00Z') + 86400000).toISOString().slice(0, 10));

  const bySport = new Map();
  for (const w of workouts) {
    if (!bySport.has(w.sport)) {
      bySport.set(w.sport, { sport: w.sport, sessions: [], months: new Array(12).fill(0), seasons: {} });
    }
    const e = bySport.get(w.sport);
    e.sessions.push(w);
    const t = Date.parse(w.date + 'T00:00:00Z');
    if (!Number.isNaN(t)) {
      e.months[new Date(t).getUTCMonth()] += 1;
      const s = seasonOf(w.date);
      if (s) e.seasons[s.key] = (e.seasons[s.key] || 0) + 1;
    }
  }

  const rows = [...bySport.values()].map((e) => {
    const dates = e.sessions.map((s) => s.date).sort();
    const after = e.sessions.map((s) => nextDay(s.date)).filter(Number.isFinite);
    const peakMonth = e.months.indexOf(Math.max(...e.months));
    const peakSeason = SEASONS
      .map((s) => ({ ...s, n: e.seasons[s.key] || 0 }))
      .sort((a, b) => b.n - a.n)[0];
    const totalMin = e.sessions.reduce((s, w) => s + (w.durationMin || 0), 0);

    return {
      sport: e.sport,
      n: e.sessions.length,
      totalMin,
      avgMin: mean(e.sessions.map((s) => s.durationMin)),
      avgStrain: mean(e.sessions.map((s) => s.strain)),
      maxStrain: Math.max(...e.sessions.map((s) => s.strain ?? 0)),
      // Null rather than zero when there are too few next-days to judge.
      nextRecovery: after.length >= 3 ? mean(after) : null,
      cost: after.length >= 3 && overall != null ? mean(after) - overall : null,
      first: dates[0],
      last: dates[dates.length - 1],
      peakMonth: MONTH_NAMES[peakMonth],
      peakSeason,
      months: e.months
    };
  }).sort((a, b) => b.n - a.n);

  // Where the year actually goes, across everything.
  const seasonTotals = SEASONS.map((s) => ({
    ...s,
    n: workouts.filter((w) => seasonOf(w.date)?.key === s.key).length
  })).sort((a, b) => b.n - a.n);

  const judged = rows.filter((r) => r.cost != null);
  return {
    rows,
    overall,
    total: workouts.length,
    totalMin: rows.reduce((s, r) => s + r.totalMin, 0),
    busiestSeason: seasonTotals[0],
    seasonTotals,
    hardest: judged.length ? judged.reduce((a, b) => (b.cost < a.cost ? b : a)) : null,
    kindest: judged.length ? judged.reduce((a, b) => (b.cost > a.cost ? b : a)) : null
  };
}

/** A short human read on what a sport is to you. */
export function activityVerdict(row, profile) {
  if (row.n < 3) return 'Barely tried it.';
  if (row.avgStrain != null && row.avgStrain < 6) return 'Leisure. Costs you almost nothing.';
  if (profile.hardest && row.sport === profile.hardest.sport && row.cost < -3) return 'This is what wrecks you.';
  if (row.cost != null && row.cost > 2) return 'You come back better after this.';
  if (row === profile.rows[0]) return 'Your main sport.';
  return 'Sits in the middle. No real cost.';
}
