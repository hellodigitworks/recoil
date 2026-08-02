import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalize, mergeById, localDate, localMinutes, offsetMinutes } from '../src/data/normalize.js';
import { cycle, recovery, sleepRecord, workout, IST } from './fixtures.mjs';

test('offsetMinutes parses Whoop timezone offsets', () => {
  assert.equal(offsetMinutes('+05:30'), 330);
  assert.equal(offsetMinutes('-05:00'), -300);
  assert.equal(offsetMinutes('+00:00'), 0);
  assert.equal(offsetMinutes('nonsense'), 0);
  assert.equal(offsetMinutes(undefined), 0);
});

test('localDate uses the record timezone, not the viewer', () => {
  // 20:00 UTC is already the next calendar day in India.
  assert.equal(localDate('2026-03-14T20:00:00.000Z', IST), '2026-03-15');
  assert.equal(localDate('2026-03-14T20:00:00.000Z', '+00:00'), '2026-03-14');
  // And back the other way in New York.
  assert.equal(localDate('2026-03-15T02:00:00.000Z', '-05:00'), '2026-03-14');
});

test('localMinutes returns minutes past local midnight', () => {
  assert.equal(localMinutes('2026-03-14T18:30:00.000Z', IST), 0);       // midnight IST
  assert.equal(localMinutes('2026-03-14T17:30:00.000Z', IST), 23 * 60); // 11pm IST
});

test('a cycle plus its recovery and sleep become one day row', () => {
  const { days } = normalize({
    cycle: [cycle({ id: 1, start: '2026-03-14T02:30:00.000Z', strain: 14.62 })],
    recovery: [recovery({ cycleId: 1, sleepId: 's1', score: 80, rhr: 61, hrv: 76 })],
    sleep: [sleepRecord({ id: 's1', start: '2026-03-13T17:40:00.000Z', end: '2026-03-14T02:00:00.000Z' })],
    workout: []
  });

  assert.equal(days.length, 1);
  const d = days[0];
  assert.equal(d.date, '2026-03-14');
  assert.equal(d.strain, 14.6);
  assert.equal(d.recovery, 80);
  assert.equal(d.rhr, 61);
  assert.equal(d.hrv, 76);
  assert.equal(d.sleepId, 's1');
});

test('asleep is the stages summed, not time in bed', () => {
  const { days } = normalize({
    cycle: [cycle({ id: 1, start: '2026-03-14T02:30:00.000Z' })],
    recovery: [recovery({ cycleId: 1, sleepId: 's1' })],
    sleep: [sleepRecord({ id: 's1', start: '2026-03-13T17:40:00.000Z', end: '2026-03-14T02:00:00.000Z', light: 240, deep: 90, rem: 100, awake: 30 })],
    workout: []
  });
  assert.equal(days[0].asleepMin, 430);  // 240 + 90 + 100
  assert.equal(days[0].inBedMin, 460);   // includes the 30 awake
  assert.equal(days[0].awakeMin, 30);
});

test('sleep debt is what you came up short, never credit for a lie-in', () => {
  const build = (light, deep, rem) => normalize({
    cycle: [cycle({ id: 1, start: '2026-03-14T02:30:00.000Z' })],
    recovery: [recovery({ cycleId: 1, sleepId: 's1' })],
    // The fixture's sleep_needed sums to 480 minutes.
    sleep: [sleepRecord({ id: 's1', start: '2026-03-13T17:40:00.000Z', end: '2026-03-14T02:00:00.000Z', light, deep, rem })],
    workout: []
  }).days[0];

  const short = build(200, 80, 80); // 360 asleep against 480 needed
  assert.equal(short.sleepNeededMin, 480);
  assert.equal(short.sleepDebtMin, 120);

  const over = build(320, 110, 120); // 550 asleep, comfortably past what was needed
  assert.equal(over.sleepDebtMin, 0, 'oversleeping is not credit you can draw on');
});

test('calories are converted from Whoop kilojoules', () => {
  const { days } = normalize({
    cycle: [cycle({ id: 1, start: '2026-03-14T02:30:00.000Z' })],
    recovery: [], sleep: [], workout: []
  });
  assert.equal(days[0].kilojoule, 8288);
  assert.equal(days[0].calories, Math.round(8288 * 0.239006));
});

test('unscored records leave score fields null instead of guessing', () => {
  const { days } = normalize({
    cycle: [cycle({ id: 1, start: '2026-03-14T02:30:00.000Z', scored: false })],
    recovery: [recovery({ cycleId: 1, sleepId: 's1', scored: false })],
    sleep: [sleepRecord({ id: 's1', start: '2026-03-13T17:40:00.000Z', end: '2026-03-14T02:00:00.000Z', scored: false })],
    workout: []
  });
  const d = days[0];
  assert.equal(d.strain, null);
  assert.equal(d.recovery, null);
  assert.equal(d.asleepMin, null);
  assert.equal(d.sleepId, 's1', 'the sleep is still linked, just unscored');
});

test('a recovery still calibrating is not reported as a score', () => {
  const { days } = normalize({
    cycle: [cycle({ id: 1, start: '2026-03-14T02:30:00.000Z' })],
    recovery: [recovery({ cycleId: 1, sleepId: 's1', score: 33, calibrating: true })],
    sleep: [], workout: []
  });
  assert.equal(days[0].recovery, null);
});

test('naps are counted apart from the night', () => {
  const { days } = normalize({
    cycle: [cycle({ id: 1, start: '2026-03-14T02:30:00.000Z' })],
    recovery: [recovery({ cycleId: 1, sleepId: 's1' })],
    sleep: [
      sleepRecord({ id: 's1', start: '2026-03-13T17:40:00.000Z', end: '2026-03-14T02:00:00.000Z', light: 240, deep: 90, rem: 100 }),
      sleepRecord({ id: 's2', start: '2026-03-14T08:00:00.000Z', end: '2026-03-14T09:00:00.000Z', nap: true, light: 30, deep: 10, rem: 5, awake: 0 })
    ],
    workout: []
  });
  assert.equal(days[0].asleepMin, 430, 'nap must not inflate hours slept');
  assert.equal(days[0].napMin, 45);
});

test('a main sleep with no recovery still lands on its wake date', () => {
  const { days } = normalize({
    cycle: [cycle({ id: 1, start: '2026-03-14T02:30:00.000Z' })],
    recovery: [],
    sleep: [sleepRecord({ id: 's1', start: '2026-03-13T17:40:00.000Z', end: '2026-03-14T02:00:00.000Z' })],
    workout: []
  });
  assert.equal(days.length, 1);
  assert.equal(days[0].sleepId, 's1');
  assert.equal(days[0].asleepMin, 430);
});

test('workouts roll up per day and keep their own list', () => {
  const { days, workouts } = normalize({
    cycle: [cycle({ id: 1, start: '2026-03-14T02:30:00.000Z' })],
    recovery: [], sleep: [],
    workout: [
      workout({ id: 'w1', start: '2026-03-14T11:00:00.000Z', end: '2026-03-14T12:30:00.000Z', sport: 'padel', strain: 9.8 }),
      workout({ id: 'w2', start: '2026-03-14T14:00:00.000Z', end: '2026-03-14T15:00:00.000Z', sport: 'weightlifting', strain: 6.2 })
    ]
  });
  assert.equal(days[0].workoutCount, 2);
  assert.equal(days[0].workoutStrain, 16);
  assert.equal(workouts.length, 2);
  assert.equal(workouts[0].sport, 'padel');
  assert.equal(workouts[0].durationMin, 90);
});

test('a workout with no sport_name is labelled, not dropped', () => {
  const w = workout({ id: 'w1', start: '2026-03-14T11:00:00.000Z', end: '2026-03-14T12:00:00.000Z' });
  delete w.sport_name;
  const { workouts } = normalize({ cycle: [], recovery: [], sleep: [], workout: [w] });
  assert.equal(workouts.length, 1);
  assert.equal(workouts[0].sport, 'Activity 248');
});

test('days come back sorted oldest first', () => {
  const { days } = normalize({
    cycle: [
      cycle({ id: 3, start: '2026-03-16T02:30:00.000Z' }),
      cycle({ id: 1, start: '2026-03-14T02:30:00.000Z' }),
      cycle({ id: 2, start: '2026-03-15T02:30:00.000Z' })
    ],
    recovery: [], sleep: [], workout: []
  });
  assert.deepEqual(days.map((d) => d.date), ['2026-03-14', '2026-03-15', '2026-03-16']);
});

test('mergeById dedupes and lets the fresh copy win', () => {
  const merged = mergeById(
    [{ id: 1, score: 'old' }, { id: 2, score: 'keep' }],
    [{ id: 1, score: 'new' }, { id: 3, score: 'added' }]
  );
  assert.equal(merged.length, 3);
  assert.equal(merged.find((r) => r.id === 1).score, 'new');
  assert.equal(merged.find((r) => r.id === 2).score, 'keep');
});

test('mergeById can key on cycle_id, which is how recovery is identified', () => {
  const merged = mergeById(
    [{ cycle_id: 7, v: 'old' }],
    [{ cycle_id: 7, v: 'new' }, { cycle_id: 8, v: 'x' }],
    'cycle_id'
  );
  assert.equal(merged.length, 2);
  assert.equal(merged.find((r) => r.cycle_id === 7).v, 'new');
});

test('empty input does not throw', () => {
  const out = normalize({});
  assert.deepEqual(out.days, []);
  assert.deepEqual(out.workouts, []);
});
