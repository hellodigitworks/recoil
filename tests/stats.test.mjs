import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as S from '../src/data/stats.js';

const day = (date, extra = {}) => ({
  date, recovery: null, asleepMin: null, hrv: null, rhr: null, strain: null, bedtimeMin: null, ...extra
});

const run = (n, extra) => Array.from({ length: n }, (_, i) => {
  const d = new Date(Date.UTC(2026, 0, 1 + i)).toISOString().slice(0, 10);
  return day(d, typeof extra === 'function' ? extra(i) : extra);
});

test('mean and median ignore nulls and NaN', () => {
  assert.equal(S.mean([1, 2, 3, null, NaN]), 2);
  assert.equal(S.median([5, 1, 3]), 3);
  assert.equal(S.median([4, 1, 3, 2]), 2.5);
  assert.equal(S.mean([]), null);
  assert.equal(S.median([]), null);
});

test('pearson refuses to report on fewer than three pairs', () => {
  assert.equal(S.pearson([1, 2], [1, 2]), null);
  assert.equal(S.pearson([1, 2, 3], [2, 4, 6]), 1);
  assert.equal(S.pearson([1, 2, 3], [6, 4, 2]), -1);
  assert.equal(S.pearson([1, 1, 1], [1, 2, 3]), null, 'zero variance has no correlation');
});

test('rollingBaseline is a trailing median, one value per day', () => {
  const days = run(5, (i) => ({ recovery: [10, 20, 30, 40, 50][i] }));
  const base = S.rollingBaseline(days, 'recovery', 3);
  assert.equal(base.length, 5);
  assert.equal(base[0], 10);
  assert.equal(base[2], 20, 'median of 10,20,30');
  assert.equal(base[4], 40, 'median of 30,40,50');
});

test('trendPerMonth reports direction and needs enough points', () => {
  assert.equal(S.trendPerMonth(run(5, (i) => ({ hrv: 50 + i })), 'hrv'), null, 'too few days');
  const rising = S.trendPerMonth(run(30, (i) => ({ hrv: 50 + i })), 'hrv');
  assert.ok(Math.abs(rising - 30) < 0.001, 'one unit a day is 30 a month');
  assert.ok(S.trendPerMonth(run(30, (i) => ({ hrv: 90 - i })), 'hrv') < 0);
  assert.equal(S.trendPerMonth(run(30, () => ({ hrv: 60 })), 'hrv'), 0);
});

test('bedtimeAxis puts 11pm and 1am next to each other', () => {
  assert.equal(S.bedtimeAxis(18 * 60), 0);
  assert.equal(S.bedtimeAxis(23 * 60), 300);
  assert.equal(S.bedtimeAxis(1 * 60), 420, '1am sits after 11pm, not 22 hours before it');
  assert.equal(S.bedtimeAxis(null), null);
});

test('clockLabel renders 24h time', () => {
  assert.equal(S.clockLabel(23 * 60 + 45), '23:45');
  assert.equal(S.clockLabel(90), '01:30');
  assert.equal(S.clockLabel(null), '—');
});

test('bedtimeVsRecovery buckets by hour and drops thin buckets', () => {
  // Six nights at 11pm scoring 80, six at 2am scoring 50, one lone 4am night.
  const days = [
    ...run(6, () => ({ bedtimeMin: 23 * 60, recovery: 80 })),
    ...run(6, () => ({ bedtimeMin: 2 * 60, recovery: 50 })),
    day('2026-02-01', { bedtimeMin: 4 * 60, recovery: 10 })
  ];
  const out = S.bedtimeVsRecovery(days);
  assert.equal(out.n, 13);
  assert.deepEqual(out.rows.map((r) => r.label), ['23:00', '02:00']);
  assert.equal(out.rows[0].value, 80);
  assert.equal(out.rows[1].value, 50);
  assert.ok(out.r < -0.8, 'later bedtime, lower recovery');
});

test('sleepHoursVsRecovery finds the point where more sleep stops paying', () => {
  const days = [
    ...run(5, () => ({ asleepMin: 300, recovery: 40 })),   // 5.0h
    ...run(5, () => ({ asleepMin: 420, recovery: 75 })),   // 7.0h
    ...run(5, () => ({ asleepMin: 480, recovery: 76 }))    // 8.0h
  ];
  const out = S.sleepHoursVsRecovery(days);
  assert.deepEqual(out.rows.map((r) => r.label), ['5.0h', '7.0h', '8.0h']);
  assert.equal(out.sweetSpot.label, '7.0h', '8h is only 1 point better, so 7h is the number');
  assert.ok(out.r > 0.8);
});

test('workoutImpact judges a workout by the NEXT day', () => {
  const days = [
    day('2026-01-01', { recovery: 60 }),
    day('2026-01-02', { recovery: 30 }), // after padel on the 1st
    day('2026-01-03', { recovery: 60 }),
    day('2026-01-04', { recovery: 30 }),
    day('2026-01-05', { recovery: 60 }),
    day('2026-01-06', { recovery: 30 }),
    day('2026-01-07', { recovery: 90 })
  ];
  const workouts = [
    { id: 'a', date: '2026-01-01', sport: 'padel', strain: 12, durationMin: 60 },
    { id: 'b', date: '2026-01-03', sport: 'padel', strain: 12, durationMin: 60 },
    { id: 'c', date: '2026-01-05', sport: 'padel', strain: 12, durationMin: 60 },
    { id: 'd', date: '2026-01-06', sport: 'yoga', strain: 3, durationMin: 40 }
  ];
  const out = S.workoutImpact(days, workouts);
  assert.equal(out.rows.length, 1, 'yoga has one session, below the minimum of three');
  assert.equal(out.rows[0].sport, 'padel');
  assert.equal(out.rows[0].nextRecovery, 30, 'the day after padel, every time');
  assert.ok(out.rows[0].delta < 0);
});

test('weekShape starts on Monday and keeps every weekday', () => {
  const shape = S.weekShape(run(28, (i) => ({ recovery: 50 + i })));
  assert.equal(shape.length, 7);
  assert.equal(shape[0].label, 'Monday');
  assert.equal(shape[6].label, 'Sunday');
  assert.ok(shape.every((s) => s.n === 4));
});

test('weekdayOf is not shifted by the machine timezone', () => {
  assert.equal(S.weekdayOf('2026-01-01'), 4, '1 Jan 2026 is a Thursday');
  assert.equal(S.weekdayOf('2026-01-04'), 0, 'Sunday');
});

test('longestStreak needs consecutive calendar days', () => {
  const days = [
    day('2026-01-01', { recovery: 70 }),
    day('2026-01-02', { recovery: 70 }),
    day('2026-01-05', { recovery: 70 }), // gap breaks it
    day('2026-01-06', { recovery: 70 }),
    day('2026-01-07', { recovery: 70 })
  ];
  const streak = S.longestStreak(days, (d) => d.recovery >= S.GREEN);
  assert.equal(streak.length, 3);
  assert.equal(streak.from, '2026-01-05');
  assert.equal(streak.to, '2026-01-07');
});

test('longestStreak returns zero when nothing qualifies', () => {
  const streak = S.longestStreak(run(5, () => ({ recovery: 10 })), (d) => d.recovery >= S.GREEN);
  assert.equal(streak.length, 0);
  assert.equal(streak.from, null);
});

test('bestWeek finds the strongest 7-day window', () => {
  const days = run(21, (i) => ({ recovery: i < 14 ? 40 : 90 }));
  const best = S.bestWeek(days);
  assert.equal(best.value, 90);
  assert.equal(best.to, '2026-01-21');
});

test('records picks real extremes and tolerates missing metrics', () => {
  const days = [
    day('2026-01-01', { recovery: 40, asleepMin: 300, strain: 5, rhr: 60, hrv: 70 }),
    day('2026-01-02', { recovery: 95, asleepMin: 540, strain: 18.2, rhr: 52, hrv: 110 }),
    day('2026-01-03', {})
  ];
  const workouts = [{ id: 'w', date: '2026-01-02', sport: 'padel', strain: 15.1, durationMin: 120 }];
  const r = S.records(days, workouts);
  assert.equal(r.bestRecovery.recovery, 95);
  assert.equal(r.worstRecovery.recovery, 40);
  assert.equal(r.longestSleep.asleepMin, 540);
  assert.equal(r.shortestSleep.asleepMin, 300);
  assert.equal(r.lowestRhr.rhr, 52);
  assert.equal(r.highestHrv.hrv, 110);
  assert.equal(r.hardestWorkout.strain, 15.1);
  assert.equal(r.longestWorkout.durationMin, 120);
});

test('records on empty history returns nulls rather than throwing', () => {
  const r = S.records([], []);
  assert.equal(r.bestRecovery, null);
  assert.equal(r.hardestWorkout, null);
  assert.equal(r.greenStreak.length, 0);
  assert.equal(r.bestWeek, null);
});

test('band matches Whoop recovery zones', () => {
  assert.equal(S.band(90), 'green');
  assert.equal(S.band(67), 'green');
  assert.equal(S.band(66), 'amber');
  assert.equal(S.band(34), 'amber');
  assert.equal(S.band(33), 'red');
  assert.equal(S.band(null), 'none');
});

test('bucketBy takes the median per chunk, counting back from the newest', () => {
  const days = run(10, (i) => ({ recovery: (i + 1) * 10 }));
  const out = S.bucketBy(days, 5, 'recovery');
  assert.equal(out.length, 2);
  assert.equal(out[0].recovery, 30, 'days 1-5 -> median 30');
  assert.equal(out[1].recovery, 80, 'days 6-10 -> median 80');
  assert.equal(out[1].date, '2026-01-10', 'labelled with the newest day in the chunk');
  assert.equal(out[1].from, '2026-01-06');
  assert.equal(out[1].span, 5);
});

test('bucketBy leaves short or unbucketed series alone', () => {
  const days = run(4, () => ({ recovery: 50 }));
  assert.equal(S.bucketBy(days, 5, 'recovery'), days, 'fewer rows than the bucket');
  assert.equal(S.bucketBy(days, 1, 'recovery'), days, 'bucket of one is a no-op');
});

test('a ragged final chunk keeps its real span rather than being padded', () => {
  const out = S.bucketBy(run(11, (i) => ({ recovery: i })), 5, 'recovery');
  assert.equal(out.length, 3);
  assert.equal(out[0].span, 1, 'the leftover day survives as its own point');
  assert.equal(out[0].date, '2026-01-01');
});

test('bucketSizeFor keeps daily detail until the width runs out', () => {
  assert.equal(S.bucketSizeFor(30, 300), 1, '30 points in 300px is comfortable');
  assert.equal(S.bucketSizeFor(90, 300), 2, 'a fortnight of crowding pairs days up');
  assert.equal(S.bucketSizeFor(400, 300), 7, 'a year collapses to whole weeks');
  assert.equal(S.bucketSizeFor(1200, 300), 21);
  assert.equal(S.bucketSizeFor(10, 40), 1, 'the floor stops a narrow chart over-bucketing');
});

test('bucketing a year leaves a readable number of points', () => {
  const days = run(365, (i) => ({ recovery: 50 + (i % 7) }));
  const size = S.bucketSizeFor(days.length, 300);
  const out = S.bucketBy(days, size, 'recovery');
  assert.ok(out.length <= 75, `expected a readable series, got ${out.length} points`);
  assert.ok(out.every((r) => Number.isFinite(r.recovery)));
});

test('lastDays trims from the newest end, and 0 means everything', () => {
  const days = run(10, () => ({}));
  assert.equal(S.lastDays(days, 3).length, 3);
  assert.equal(S.lastDays(days, 3)[2].date, '2026-01-10');
  assert.equal(S.lastDays(days, 0).length, 10);
  assert.equal(S.lastDays(days, 99).length, 10);
});

/* ------------------------------------------------------ bedtime tonight -- */

test('bedtime works back from your own wake time, not a default', () => {
  // Up at 07:00 (420), needing 8h (480): asleep by 23:00 the night before.
  const days = run(14, () => ({ wakeMin: 420, sleepNeededMin: 480, sleepDebtMin: 0 }));
  const t = S.bedtimeTonight(days);
  assert.equal(S.clockLabel(t.asleepBy % 1440), '23:00');
  assert.equal(t.needMin, 480);
  assert.equal(t.nights, 14);
});

test('an early riser gets an earlier target, from the same need', () => {
  const early = S.bedtimeTonight(run(14, () => ({ wakeMin: 300, sleepNeededMin: 480 })));
  const late = S.bedtimeTonight(run(14, () => ({ wakeMin: 600, sleepNeededMin: 480 })));
  assert.equal(S.clockLabel(early.asleepBy % 1440), '21:00');
  assert.equal(S.clockLabel(late.asleepBy % 1440), '02:00');
});

test('a target before midnight does not wrap into the next morning', () => {
  // Up at 05:00 needing 9h lands at 20:00 the previous evening, not 20:00 today.
  const t = S.bedtimeTonight(run(14, () => ({ wakeMin: 300, sleepNeededMin: 540 })));
  assert.ok(t.asleepBy >= 0 && t.asleepBy < 1440);
  assert.equal(S.clockLabel(t.asleepBy), '20:00');
});

test('bedtime refuses to guess from too few nights', () => {
  assert.equal(S.bedtimeTonight(run(2, () => ({ wakeMin: 420, sleepNeededMin: 480 }))), null);
  assert.equal(S.bedtimeTonight([]), null);
});

test('bedtime falls back to the flat target when Whoop gave no need', () => {
  const t = S.bedtimeTonight(run(14, () => ({ wakeMin: 420 })));
  assert.equal(t.needMin, S.DEFAULT_SLEEP_TARGET_MIN);
});

/* ------------------------------------------------------ versus last year -- */

const twoYears = (fn) => Array.from({ length: 800 }, (_, i) => {
  const d = new Date(Date.UTC(2025, 0, 1 + i)).toISOString().slice(0, 10);
  return day(d, fn(i));
});

test('a year of improvement is reported as improvement', () => {
  // Rises steadily, so the last 30 days beat the same window a year earlier.
  const days = twoYears((i) => ({ recovery: 40 + i * 0.03 }));
  const out = S.versusLastYear(days, 'recovery');
  assert.ok(out, 'expected a comparison with two years of data');
  assert.ok(out.delta > 0, `expected improvement, got ${out.delta}`);
  assert.ok(out.now > out.then);
  assert.ok(out.nowNights >= 14 && out.thenNights >= 10);
});

test('the window a year back is the same season, not the nearest days', () => {
  const days = twoYears((i) => ({ recovery: 50 }));
  const out = S.versusLastYear(days, 'recovery');
  // Anchor is the last date; thenLabel must be about 365 days before it.
  const gap = (Date.parse(days[days.length - 1].date) - Date.parse(out.thenLabel)) / 86400000;
  assert.ok(Math.abs(gap - 365) <= 1, `expected ~365 days back, got ${gap}`);
});

test('no second year means no comparison, rather than a flattering one', () => {
  assert.equal(S.versusLastYear(run(60, () => ({ recovery: 50 })), 'recovery'), null);
  assert.equal(S.versusLastYear([], 'recovery'), null);
});

test('a metric with no values yields nothing even across two years', () => {
  assert.equal(S.versusLastYear(twoYears(() => ({ recovery: null })), 'recovery'), null);
});
