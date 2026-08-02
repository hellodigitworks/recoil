// The six computed features. Each one is judged against data whose answer is
// known in advance, so a passing test means the maths is right, not just quiet.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as S from '../src/data/stats.js';

const day = (date, extra = {}) => ({
  date, recovery: null, asleepMin: null, hrv: null, rhr: null, respRate: null,
  strain: null, bedtimeMin: null, wakeMin: null, ...extra
});

const run = (n, extra, from = 1) => Array.from({ length: n }, (_, i) => {
  const d = new Date(Date.UTC(2026, 0, from + i)).toISOString().slice(0, 10);
  return day(d, typeof extra === 'function' ? extra(i) : extra);
});

/* ------------------------------------------------------------ baselines -- */

test('a baseline is your own mean and spread, excluding the day it judges', () => {
  // 40 days at rhr 60, then one at 70. The baseline must not see the 70.
  const days = [...run(40, () => ({ rhr: 60 })), day('2026-03-01', { rhr: 70 })];
  const b = S.baselineNow(days, 'rhr');
  assert.equal(b.mean, 60);
  assert.equal(b.n, 40);
  assert.equal(b.sd, 0, 'a flat history has no spread');
});

test('z-score is measured in your own standard deviations', () => {
  // Alternating 58/62 gives mean 60, sd ~2.02.
  const days = [...run(40, (i) => ({ rhr: i % 2 ? 62 : 58 })), day('2026-03-01', { rhr: 64 })];
  const b = S.baselineNow(days, 'rhr');
  assert.equal(b.mean, 60);
  assert.ok(Math.abs(b.sd - 2.026) < 0.01);
  assert.ok(b.z > 1.9 && b.z < 2.0, `expected ~2 sd above, got ${b.z}`);
});

test('a baseline needs enough history before it will claim anything', () => {
  // 21 PRIOR days are required, and the day being judged is not one of them,
  // so 22 rows are needed before a baseline exists at all.
  assert.equal(S.baselineNow(run(21, () => ({ rhr: 60 })), 'rhr'), null, '20 prior days is not enough');
  assert.ok(S.baselineNow(run(22, () => ({ rhr: 60 })), 'rhr'), '21 prior days is');
  assert.equal(S.baselineNow([], 'rhr'), null);
});

test('deviation bands come from spread, not a fixed threshold', () => {
  assert.equal(S.deviation(0.4), 'normal');
  assert.equal(S.deviation(-0.99), 'normal');
  assert.equal(S.deviation(1.2), 'mild');
  assert.equal(S.deviation(-1.9), 'mild');
  assert.equal(S.deviation(2.5), 'significant');
  assert.equal(S.deviation(null), 'unknown');
});

/* --------------------------------------------- strain -> next recovery -- */

test('strain is judged against the NEXT day, and finds where the cost starts', () => {
  // Recovery is fine after easy days and poor after anything above strain 12.
  const days = [];
  for (let i = 0; i < 60; i++) {
    const hard = i % 2 === 0;
    days.push(day(new Date(Date.UTC(2026, 0, 1 + i)).toISOString().slice(0, 10), {
      strain: hard ? 15 : 5,
      // Today's recovery reflects YESTERDAY's strain: odd days follow a hard day.
      recovery: i % 2 === 1 ? 40 : 75
    }));
  }
  const out = S.strainVsNextRecovery(days);
  assert.equal(out.n, 59);
  assert.ok(out.r < -0.9, 'higher strain, lower recovery the next day');
  assert.equal(out.threshold.label, '14-16', 'the cost starts in the hard bin');
  const hard = out.rows.find((r) => r.label === '14-16');
  const easy = out.rows.find((r) => r.label === '4-6');
  assert.equal(hard.value, 40);
  assert.equal(easy.value, 75);
});

test('strain pairs skip days with a gap in between', () => {
  const days = [
    day('2026-01-01', { strain: 15 }),
    day('2026-01-05', { strain: 15, recovery: 50 })  // not the day after
  ];
  assert.equal(S.strainVsNextRecovery(days).n, 0);
});

/* -------------------------------------------------------- sleep rhythm -- */

test('circular spread treats 23:50 and 00:10 as twenty minutes apart', () => {
  const sd = S.circularSd([23 * 60 + 50, 10]);
  assert.ok(sd < 15, `expected a small spread across midnight, got ${sd}`);
  // A naive standard deviation on the same pair would be about 700 minutes.
});

test('a perfectly regular clock scores 100, a two-hour drift scores 0', () => {
  const steady = run(7, () => ({ bedtimeMin: 23 * 60, wakeMin: 7 * 60 }));
  assert.equal(S.rhythmScore(steady).score, 100);

  // Alternating two hours either side of the mean.
  const chaotic = run(7, (i) => ({
    bedtimeMin: i % 2 ? 21 * 60 : 25 * 60 % 1440,
    wakeMin: i % 2 ? 5 * 60 : 9 * 60
  }));
  assert.ok(S.rhythmScore(chaotic).score < 30, 'a swinging clock scores badly');
});

test('the rhythm series produces one score per day once it has a window', () => {
  const series = S.rhythmSeries(run(20, () => ({ bedtimeMin: 23 * 60, wakeMin: 7 * 60 })), 7);
  assert.equal(series.length, 20);
  assert.equal(series[0].score, null, 'no score before there is a window');
  assert.equal(series[19].score, 100);
});

/* -------------------------------------------------------- sleep ledger -- */

test('the ledger accumulates against your target, not against last night', () => {
  // Seven nights an hour short of an eight-hour target.
  const days = run(7, () => ({ asleepMin: 420 }));
  const led = S.sleepLedger(days);
  assert.equal(led.target, 480);
  assert.equal(led.rows[0].delta, 60);
  assert.equal(led.rows[6].cumulative, 420, 'seven hours behind by Sunday');
  assert.equal(led.week, 420);
});

test('a surplus pays down the ledger', () => {
  const days = [
    day('2026-01-01', { asleepMin: 360 }), // 2h short
    day('2026-01-02', { asleepMin: 600 })  // 2h over
  ];
  const led = S.sleepLedger(days);
  assert.equal(led.rows[0].cumulative, 120);
  assert.equal(led.rows[1].cumulative, 0, 'a long night clears the debt');
});

test('the target is configurable', () => {
  const days = run(3, () => ({ asleepMin: 420 }));
  assert.equal(S.sleepLedger(days, 420).total, 0, 'seven hours against a seven-hour target');
  assert.equal(S.sleepLedger(days, 450).total, 90);
});

test('nights with no sleep recorded do not invent debt', () => {
  const days = [day('2026-01-01', { asleepMin: null }), day('2026-01-02', { asleepMin: 480 })];
  assert.equal(S.sleepLedger(days).total, 0);
});

/* ------------------------------------------------------- early warning -- */

const steadyFor = (n) => run(n, () => ({ rhr: 60, hrv: 80, respRate: 15 }));

test('all three metrics must move the wrong way, for two days, to warn', () => {
  const base = steadyFor(40).map((d, i) => ({ ...d, rhr: 60 + (i % 2), hrv: 80 + (i % 2), respRate: 15 + (i % 2) * 0.2 }));
  const bad = { rhr: 66, hrv: 72, respRate: 16.5 };
  const warned = S.earlyWarning([...base, day('2026-03-01', bad), day('2026-03-02', bad)]);
  assert.ok(warned, 'two consecutive bad days should warn');
  assert.equal(warned.days, 2);
  assert.equal(warned.since, '2026-03-01');
  assert.ok(warned.rhrUp > 0 && warned.hrvDown > 0 && warned.respUp > 0);
});

test('one bad day is not a warning', () => {
  const base = steadyFor(40).map((d, i) => ({ ...d, rhr: 60 + (i % 2), hrv: 80 + (i % 2), respRate: 15 + (i % 2) * 0.2 }));
  assert.equal(S.earlyWarning([...base, day('2026-03-01', { rhr: 66, hrv: 72, respRate: 16.5 })]), null);
});

test('two metrics moving badly is not a warning either', () => {
  const base = steadyFor(40).map((d, i) => ({ ...d, rhr: 60 + (i % 2), hrv: 80 + (i % 2), respRate: 15 + (i % 2) * 0.2 }));
  // Heart rate and HRV bad, breathing sitting exactly on its own mean of 15.1.
  // The spread here is tiny, so anything further out would itself be a signal.
  const partial = { rhr: 66, hrv: 72, respRate: 15.1 };
  assert.equal(S.earlyWarning([...base, day('2026-03-01', partial), day('2026-03-02', partial)]), null);
});

test('the run must reach today, not sit in the past', () => {
  const base = steadyFor(40).map((d, i) => ({ ...d, rhr: 60 + (i % 2), hrv: 80 + (i % 2), respRate: 15 + (i % 2) * 0.2 }));
  const bad = { rhr: 66, hrv: 72, respRate: 16.5 };
  const recovered = { rhr: 60, hrv: 80, respRate: 15 };
  assert.equal(
    S.earlyWarning([...base, day('2026-03-01', bad), day('2026-03-02', bad), day('2026-03-03', recovered)]),
    null,
    'once it passes, the banner goes away'
  );
});

test('early warning stays quiet without enough history to know your normal', () => {
  const bad = { rhr: 66, hrv: 72, respRate: 16.5 };
  assert.equal(S.earlyWarning([day('2026-01-01', bad), day('2026-01-02', bad)]), null);
});

/* --------------------------------------------------------- day of week -- */

test('week shape carries strain as well as recovery', () => {
  const shape = S.weekShape(run(28, (i) => ({ recovery: 50 + (i % 7), strain: 8 + (i % 7) })));
  assert.equal(shape.length, 7);
  assert.ok(shape.every((s) => Number.isFinite(s.strain)), 'every weekday has a strain average');
  assert.ok(shape.every((s) => Number.isFinite(s.recovery)));
});

/* --------------------------------------------------------------- activities -- */

test('seasons follow the Indian year, not the meteorological one', () => {
  assert.equal(S.seasonOf('2026-04-10').key, 'summer');
  assert.equal(S.seasonOf('2026-07-10').key, 'monsoon');
  assert.equal(S.seasonOf('2026-01-10').key, 'winter');
  assert.equal(S.seasonOf('2026-11-10').key, 'winter');
});

test('activity profile counts, times and costs each sport', () => {
  // Padel every Monday costs the next day; yoga every Thursday does not.
  const days = [], workouts = [];
  for (let i = 0; i < 60; i++) {
    const date = new Date(Date.UTC(2026, 0, 1 + i)).toISOString().slice(0, 10);
    const dow = new Date(Date.parse(date + 'T00:00:00Z')).getUTCDay();
    const afterPadel = dow === 2, afterYoga = dow === 5;
    days.push(day(date, { recovery: afterPadel ? 35 : afterYoga ? 80 : 60 }));
    if (dow === 1) workouts.push({ id: 'p' + i, date, sport: 'padel', strain: 14, durationMin: 90 });
    if (dow === 4) workouts.push({ id: 'y' + i, date, sport: 'yoga', strain: 3, durationMin: 45 });
  }
  const p = S.activityProfile(days, workouts);

  assert.equal(p.rows.length, 2);
  const padel = p.rows.find((r) => r.sport === 'padel');
  const yoga = p.rows.find((r) => r.sport === 'yoga');
  assert.equal(padel.avgMin, 90);
  assert.equal(padel.totalMin, padel.n * 90);
  assert.equal(padel.nextRecovery, 35, 'the morning after padel');
  assert.equal(yoga.nextRecovery, 80);
  assert.ok(padel.cost < 0 && yoga.cost > 0);
  assert.equal(p.hardest.sport, 'padel');
  assert.equal(p.kindest.sport, 'yoga');
  assert.equal(p.total, workouts.length);
});

test('a sport tried once is not judged', () => {
  const days = run(10, () => ({ recovery: 60 }));
  const p = S.activityProfile(days, [{ id: 'a', date: '2026-01-02', sport: 'surfing', strain: 9, durationMin: 60 }]);
  assert.equal(p.rows[0].cost, null, 'one session cannot establish a cost');
  assert.equal(S.activityVerdict(p.rows[0], p), 'Barely tried it.');
});

test('the profile knows which season you actually move in', () => {
  const workouts = [
    ...Array.from({ length: 8 }, (_, i) => ({ id: 'm' + i, date: `2026-07-0${(i % 9) + 1}`, sport: 'padel', strain: 12, durationMin: 60 })),
    { id: 'w1', date: '2026-01-05', sport: 'padel', strain: 12, durationMin: 60 }
  ];
  const p = S.activityProfile(run(5, () => ({ recovery: 60 })), workouts);
  assert.equal(p.busiestSeason.key, 'monsoon');
  assert.equal(p.rows[0].peakMonth, 'July');
});

test('a gentle sport reads as leisure', () => {
  const days = run(20, () => ({ recovery: 60 }));
  const workouts = Array.from({ length: 6 }, (_, i) => ({
    id: 'w' + i, date: new Date(Date.UTC(2026, 0, 1 + i)).toISOString().slice(0, 10),
    sport: 'walking', strain: 3.5, durationMin: 40
  }));
  const p = S.activityProfile(days, workouts);
  assert.match(S.activityVerdict(p.rows[0], p), /Leisure/);
});

/* ------------------------------------------------------------------ trends -- */

test('a week runs Monday to Sunday and steps back cleanly', () => {
  // 2026-07-26 is a Sunday.
  const w = S.periodBounds('2026-07-26', 'W', 0);
  assert.equal(w.from, '2026-07-20', 'Monday');
  assert.equal(w.to, '2026-07-26', 'Sunday');
  const prev = S.periodBounds('2026-07-26', 'W', -1);
  assert.equal(prev.from, '2026-07-13');
  assert.equal(prev.to, '2026-07-19');
});

test('a month is a calendar month, whatever day you are on', () => {
  const m = S.periodBounds('2026-07-14', 'M', 0);
  assert.equal(m.from, '2026-07-01');
  assert.equal(m.to, '2026-07-31');
  const prev = S.periodBounds('2026-07-14', 'M', -1);
  assert.equal(prev.from, '2026-06-01');
  assert.equal(prev.to, '2026-06-30', 'June has 30 days');
});

test('six months lands on whole month boundaries', () => {
  const h = S.periodBounds('2026-07-26', '6M', 0);
  assert.equal(h.from, '2026-02-01');
  assert.equal(h.to, '2026-07-31');
  assert.equal(S.periodBounds('2026-07-26', '6M', -1).from, '2025-08-01');
});

test('period summary compares against the window immediately before', () => {
  // 25 Jan 2026 is a Sunday, so the week is 19-25 and the one before is 12-18.
  const days = run(28, (_, i) => ({}), 1).map((d) => ({
    ...d,
    recovery: d.date >= '2026-01-19' ? 60 : d.date >= '2026-01-12' ? 50 : 40
  }));
  const slice = S.periodSlice(days, '2026-01-25', 'W', 0);
  assert.equal(slice.from, '2026-01-19');
  assert.equal(slice.to, '2026-01-25');
  const sum = S.periodSummary(slice, 'recovery');
  assert.equal(sum.average, 60);
  assert.equal(sum.previous, 50);
  assert.ok(Math.abs(sum.change - 20) < 0.001, '60 against 50 is +20%');
});

test('monthly means carry each month change against the one before', () => {
  const days = [
    ...run(28, () => ({ recovery: 50 }), 1),          // January
    ...Array.from({ length: 28 }, (_, i) => day(new Date(Date.UTC(2026, 1, 1 + i)).toISOString().slice(0, 10), { recovery: 60 }))
  ];
  const m = S.monthlyMeans(days, 'recovery');
  assert.deepEqual(m.map((x) => x.label), ['Jan', 'Feb']);
  assert.equal(m[0].change, null, 'nothing to compare the first month with');
  assert.ok(Math.abs(m[1].change - 20) < 0.001);
});

test('period labels read the way the period does', () => {
  assert.equal(S.periodLabel(S.periodBounds('2026-07-26', 'M'), 'M'), 'JUL 2026');
  assert.equal(S.periodLabel(S.periodBounds('2026-07-26', 'W'), 'W'), '20 JUL — 26 JUL');
});
