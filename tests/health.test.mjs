import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseHealthExport, msOf, HEALTH_FIELDS, __test } from '../src/data/health-parse.js';
import { mergeHealth, mergeImport, sanitiseDaily } from '../src/data/health.js';

const { tagEnd, attr, decodeEntities, sportName, convert, dateOf, consume, newSink, finalise } = __test;

/** A stream of the given chunks, the way the zip reader hands one over. */
function streamOf(chunks) {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    }
  });
}

const parse = (xml, chunkSize) => parseHealthExport(
  streamOf(chunkSize ? xml.match(new RegExp(`[\\s\\S]{1,${chunkSize}}`, 'g')) : [xml])
);

/* --------------------------------------------------------------- scanning -- */

test('tagEnd ignores a > inside an attribute value', () => {
  const tag = '<Record sourceName="Sleep > Wake" value="1"/>';
  assert.equal(tagEnd(tag, 0), tag.length - 1);
  assert.equal(tagEnd('<Record value="1"', 0), -1);
});

test('attr reads one attribute without parsing the tag', () => {
  const tag = '<Record type="HKQuantityTypeIdentifierStepCount" value="812"/>';
  assert.equal(attr(tag, 'type'), 'HKQuantityTypeIdentifierStepCount');
  assert.equal(attr(tag, 'value'), '812');
  assert.equal(attr(tag, 'missing'), null);
  // Must not match a name that merely ends with the one asked for.
  assert.equal(attr('<Workout totalDistance="5"/>', 'Distance'), null);
});

test('decodeEntities handles named and numeric escapes', () => {
  assert.equal(decodeEntities('Runna &amp; Co'), 'Runna & Co');
  assert.equal(decodeEntities('caf&#233;'), 'café');
  assert.equal(decodeEntities('plain'), 'plain');
});

test('sportName turns a HealthKit constant into words', () => {
  assert.equal(sportName('HKWorkoutActivityTypeRunning'), 'Running');
  assert.equal(sportName('HKWorkoutActivityTypeHighIntensityIntervalTraining'), 'High Intensity Interval Training');
  assert.equal(sportName(null), 'Activity');
});

test('msOf parses Health timestamps Safari would refuse', () => {
  assert.equal(msOf('2026-08-09 07:14:22 +0530'), Date.parse('2026-08-09T07:14:22+05:30'));
  assert.equal(msOf('2026-08-09 07:14:22 -0500'), Date.parse('2026-08-09T07:14:22-05:00'));
  assert.ok(Number.isNaN(msOf('rubbish')));
});

test('dateOf takes the local calendar date, not a UTC one', () => {
  // 23:40 in India is already the next day in UTC. The export's own date wins.
  assert.equal(dateOf('2026-08-09 23:40:00 +0530'), '2026-08-09');
});

test('convert normalises whatever unit the source app used', () => {
  assert.equal(convert(1, 'mi', 'km'), 1.609344);
  assert.equal(convert(220, 'lb', 'kg').toFixed(2), '99.79');
  assert.equal(convert(500, 'mL', 'L'), 0.5);
  // Body fat arrives as a fraction from some apps and a percentage from others.
  assert.equal(convert(0.18, '%', 'pct').toFixed(1), '18.0');
  assert.equal(convert(18, '%', 'pct'), 18);
  // An unknown unit is left alone rather than scaled by a guess.
  assert.equal(convert(7, 'furlongs', 'km'), 7);
});

/* ---------------------------------------------------------------- parsing -- */

const EXPORT = `<?xml version="1.0" encoding="UTF-8"?>
<HealthData locale="en_IN">
 <Record type="HKQuantityTypeIdentifierStepCount" sourceName="iPhone" unit="count" startDate="2026-08-09 08:00:00 +0530" endDate="2026-08-09 08:10:00 +0530" value="1200"/>
 <Record type="HKQuantityTypeIdentifierStepCount" sourceName="iPhone" unit="count" startDate="2026-08-09 19:00:00 +0530" endDate="2026-08-09 19:10:00 +0530" value="2400"/>
 <Record type="HKQuantityTypeIdentifierStepCount" sourceName="iPhone" unit="count" startDate="2026-08-10 09:00:00 +0530" endDate="2026-08-10 09:10:00 +0530" value="900"/>
 <Record type="HKQuantityTypeIdentifierDistanceWalkingRunning" sourceName="iPhone" unit="mi" startDate="2026-08-09 08:00:00 +0530" endDate="2026-08-09 08:10:00 +0530" value="1"/>
 <Record type="HKQuantityTypeIdentifierBodyMass" sourceName="Scale" unit="kg" startDate="2026-08-09 07:00:00 +0530" endDate="2026-08-09 07:00:00 +0530" value="70.4"/>
 <Record type="HKQuantityTypeIdentifierBodyMass" sourceName="Scale" unit="kg" startDate="2026-08-09 21:00:00 +0530" endDate="2026-08-09 21:00:00 +0530" value="71.2"/>
 <Record type="HKQuantityTypeIdentifierHeartRate" sourceName="Whoop" unit="count/min" startDate="2026-08-09 08:00:00 +0530" endDate="2026-08-09 08:00:00 +0530" value="61"/>
 <Record type="HKCategoryTypeIdentifierMindfulSession" sourceName="Calm" startDate="2026-08-09 06:00:00 +0530" endDate="2026-08-09 06:12:00 +0530" value="HKCategoryValueNotApplicable">
  <MetadataEntry key="HKTimeZone" value="Asia/Kolkata"/>
 </Record>
 <Record type="HKQuantityTypeIdentifierHeadphoneAudioExposure" sourceName="iPhone" unit="dBASPL" startDate="2026-08-09 12:00:00 +0530" endDate="2026-08-09 12:30:00 +0530" value="70"/>
 <Record type="HKQuantityTypeIdentifierHeadphoneAudioExposure" sourceName="iPhone" unit="dBASPL" startDate="2026-08-09 13:00:00 +0530" endDate="2026-08-09 13:30:00 +0530" value="80"/>
 <StateOfMind startDate="2026-08-09 22:00:00 +0530" endDate="2026-08-09 22:00:00 +0530" kind="dailyMood" valence="0.5"/>
 <Workout workoutActivityType="HKWorkoutActivityTypeCycling" duration="60" durationUnit="min" sourceName="Strava" startDate="2026-08-09 17:00:00 +0530" endDate="2026-08-09 18:00:00 +0530">
  <WorkoutStatistics type="HKQuantityTypeIdentifierDistanceCycling" sum="24" unit="km"/>
  <WorkoutStatistics type="HKQuantityTypeIdentifierActiveEnergyBurned" sum="600" unit="kcal"/>
 </Workout>
</HealthData>`;

test('parses an export into daily rows', async () => {
  const result = await parse(EXPORT);

  assert.equal(result.days['2026-08-09'].steps, 3600);   // summed
  assert.equal(result.days['2026-08-10'].steps, 900);
  assert.equal(result.days['2026-08-09'].walkKm, 1.61);  // miles converted
  assert.equal(result.days['2026-08-09'].weightKg, 71.2); // latest of the day
  assert.equal(result.days['2026-08-09'].mindfulMin, 12); // from the interval
  assert.equal(result.days['2026-08-09'].headphoneDb, 75); // averaged
  assert.equal(result.days['2026-08-09'].mood, 75);       // −1..1 rescaled

  assert.equal(result.first, '2026-08-09');
  assert.equal(result.last, '2026-08-10');
});

test('leaves Whoop\'s own numbers alone', async () => {
  const result = await parse(EXPORT);
  // Heart rate is in the file and deliberately not read: the Whoop API is the
  // better copy and this app already has it.
  for (const row of Object.values(result.days)) {
    assert.equal(row.rhr, undefined);
    assert.equal(row.hrv, undefined);
  }
});

test('reads a workout and the statistics that follow it', async () => {
  const { workouts } = await parse(EXPORT);
  assert.equal(workouts.length, 1);
  assert.equal(workouts[0].sport, 'Cycling');
  assert.equal(workouts[0].durationMin, 60);
  assert.equal(workouts[0].source, 'Strava');
  assert.equal(workouts[0].distanceM, 24000);
  assert.equal(workouts[0].strain, null); // Apple has no strain and never will
});

test('the result is identical however the stream is chopped up', async () => {
  const whole = await parse(EXPORT);
  // 7 bytes splits mid-tag, mid-attribute and mid-value on every element.
  const shredded = await parse(EXPORT, 7);
  assert.deepEqual(shredded.days, whole.days);
  assert.deepEqual(shredded.workouts, whole.workouts);
});

test('an unfinished element is held back whole, not half-read', () => {
  const sink = newSink();
  const partial = '<Record type="HKQuantityTypeIdentifierStepCount" value="1"';
  const tail = consume(sink, 'junk before ' + partial);
  assert.equal(tail, partial);           // waiting for its closing >
  assert.equal(finalise(sink).first, null); // and nothing counted yet
});

test('HEALTH_FIELDS has no duplicates and covers what is parsed', () => {
  // A field added to TYPES but forgotten in HEALTH_FIELDS would be parsed,
  // stored, and then invisible everywhere in the app.
  assert.equal(new Set(HEALTH_FIELDS).size, HEALTH_FIELDS.length);
  for (const field of ['steps', 'weightKg', 'caffeineMg', 'mood', 'mindfulMin']) {
    assert.ok(HEALTH_FIELDS.includes(field), `${field} is missing from HEALTH_FIELDS`);
  }
});

/* ---------------------------------------------------------------- merging -- */

const day = (date, extra = {}) => ({ date, recovery: null, workoutCount: 0, ...extra });

test('merge decorates the Whoop days it can reach and drops the rest', () => {
  const days = [day('2026-08-09'), day('2026-08-10')];
  const health = {
    days: {
      '2026-08-08': { steps: 100 }, // before the Whoop history
      '2026-08-09': { steps: 3600 },
      '2026-08-11': { steps: 200 }  // after it
    },
    workouts: []
  };
  const merged = mergeHealth(days, [], health);
  assert.equal(merged.days[0].steps, 3600);
  assert.equal(merged.days[1].steps, undefined);
  assert.equal(merged.days.length, 2); // no new rows invented
  assert.equal(merged.covered, 1);
  assert.equal(merged.outside, 2);
});

test('an Apple workout Whoop already has is not added twice', () => {
  const days = [day('2026-08-09')];
  const whoop = [{
    id: 'w1', date: '2026-08-09', sport: 'cycling',
    start: '2026-08-09T11:30:00.000Z', end: '2026-08-09T12:30:00.000Z'
  }];
  const health = {
    days: {},
    workouts: [{
      id: 'apple:1', date: '2026-08-09', sport: 'Cycling',
      start: '2026-08-09 17:05:00 +0530', end: '2026-08-09 18:05:00 +0530', source: 'Strava'
    }]
  };
  const merged = mergeHealth(days, whoop, health);
  assert.equal(merged.added, 0);
  assert.equal(merged.workouts.length, 1);
});

test('a session Whoop missed is added, and the day counts it', () => {
  const days = [day('2026-08-09')];
  const health = {
    days: {},
    workouts: [{
      id: 'apple:1', date: '2026-08-09', sport: 'Padel',
      start: '2026-08-09 06:00:00 +0530', end: '2026-08-09 07:00:00 +0530', source: 'Strava'
    }]
  };
  const merged = mergeHealth(days, [], health);
  assert.equal(merged.added, 1);
  assert.equal(merged.days[0].workoutCount, 1);
  // Rewritten to a real ISO instant so it sorts against the Whoop ones.
  assert.equal(merged.workouts[0].start, '2026-08-09T00:30:00.000Z');
});

test('merge is a no-op with nothing imported', () => {
  const days = [day('2026-08-09')];
  const merged = mergeHealth(days, [], null);
  assert.equal(merged.days, days);
  assert.equal(merged.covered, 0);
});

/* ------------------------------------------------------- the daily top-up -- */

test('sanitiseDaily keeps only real numbers on a real date', () => {
  const { days, count } = sanitiseDaily([
    { date: '2026-08-09', steps: 8421, walkKm: 6.1 },
    { date: '2026-08-10', steps: '2200' },          // strings from a Shortcut
    { date: 'yesterday', steps: 5000 },             // not a date
    { date: '2026-02-31', steps: 5000 },            // not a day that exists
    { date: '2026-08-11', rhr: 48 },                // not a field we accept
    { date: '2026-08-12', steps: 'lots' },          // not a number
    null
  ]);
  assert.equal(count, 2);
  assert.deepEqual(days['2026-08-09'], { steps: 8421, walkKm: 6.1 });
  assert.deepEqual(days['2026-08-10'], { steps: 2200 });
  assert.equal(days['2026-08-11'], undefined);
});

test('a re-import wins on its own days and leaves newer ones alone', () => {
  const existing = { days: { '2026-08-08': { steps: 1 }, '2026-08-09': { steps: 2 } }, sources: ['Shortcut'] };
  const fresh = { days: { '2026-08-08': { steps: 8000, walkKm: 5 } }, sources: ['iPhone'], workouts: [] };
  const merged = mergeImport(fresh, existing);

  // The export is complete for the day it covers, so it replaces it whole
  // rather than merging field by field.
  assert.deepEqual(merged.days['2026-08-08'], { steps: 8000, walkKm: 5 });
  // The day the Shortcut sent after the export was taken has to survive it.
  assert.deepEqual(merged.days['2026-08-09'], { steps: 2 });
  assert.deepEqual(merged.sources, ['iPhone', 'Shortcut']);
  assert.equal(merged.first, '2026-08-08');
  assert.equal(merged.last, '2026-08-09');
});

test('the first import has nothing to merge against', () => {
  const merged = mergeImport({ days: { '2026-08-08': { steps: 10 } }, sources: ['iPhone'], workouts: [] }, null);
  assert.deepEqual(Object.keys(merged.days), ['2026-08-08']);
  assert.deepEqual(merged.sources, ['iPhone']);
});

test('sanitiseDaily takes a single object as well as a list', () => {
  const { count, days } = sanitiseDaily({ date: '2026-08-09', caffeineMg: 180 });
  assert.equal(count, 1);
  assert.deepEqual(days['2026-08-09'], { caffeineMg: 180 });
});
