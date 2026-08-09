// Apple Health's export.xml -> one row per day.
//
// The export is a flat list of every sample the phone has ever recorded, which
// on a few years of use is millions of elements. Nothing here keeps a sample.
// Each one is folded into its day the moment it is read and thrown away, so
// memory stays flat whether the file is 40 MB or a gigabyte.
//
// It is a scanner rather than an XML parser on purpose. Every element that
// matters is a start tag with all its data in attributes, so the children can
// be skipped without understanding them, and a real parser would want the
// document in memory to do it.
//
// Whoop's own numbers are deliberately not read back out of Health. Recovery,
// HRV, resting heart rate and sleep come from the Whoop API, which is the
// better copy. What is taken here is only what Whoop cannot see.

/** Where each type lands, and how a day's worth of it is combined.
 *  `unit` names the family to convert into; absent means take the number as is. */
const TYPES = {
  // Movement. The phone in your pocket records all of this on its own.
  HKQuantityTypeIdentifierStepCount: { field: 'steps', how: 'sum', dp: 0 },
  HKQuantityTypeIdentifierDistanceWalkingRunning: { field: 'walkKm', how: 'sum', unit: 'km', dp: 2 },
  HKQuantityTypeIdentifierFlightsClimbed: { field: 'flights', how: 'sum', dp: 0 },
  HKQuantityTypeIdentifierAppleExerciseTime: { field: 'exerciseMin', how: 'sum', unit: 'min', dp: 0 },

  // Body. Only ever there if a scale or an app is writing it.
  HKQuantityTypeIdentifierBodyMass: { field: 'weightKg', how: 'last', unit: 'kg', dp: 1 },
  HKQuantityTypeIdentifierBodyFatPercentage: { field: 'bodyFatPct', how: 'last', unit: 'pct', dp: 1 },
  HKQuantityTypeIdentifierBodyMassIndex: { field: 'bmi', how: 'last', dp: 1 },
  HKQuantityTypeIdentifierVO2Max: { field: 'vo2max', how: 'last', dp: 1 },

  // Intake. Only ever there if you log it.
  HKQuantityTypeIdentifierDietaryCaffeine: { field: 'caffeineMg', how: 'sum', unit: 'mg', dp: 0 },
  HKQuantityTypeIdentifierNumberOfAlcoholicBeverages: { field: 'drinks', how: 'sum', dp: 1 },
  HKQuantityTypeIdentifierDietaryWater: { field: 'waterL', how: 'sum', unit: 'L', dp: 2 },
  HKQuantityTypeIdentifierDietaryEnergyConsumed: { field: 'kcalIn', how: 'sum', unit: 'kcal', dp: 0 },
  HKQuantityTypeIdentifierDietaryProtein: { field: 'proteinG', how: 'sum', unit: 'g', dp: 0 },

  // Environment and mind.
  HKQuantityTypeIdentifierTimeInDaylight: { field: 'daylightMin', how: 'sum', unit: 'min', dp: 0 },
  HKQuantityTypeIdentifierHeadphoneAudioExposure: { field: 'headphoneDb', how: 'mean', dp: 1 },
  HKCategoryTypeIdentifierMindfulSession: { field: 'mindfulMin', how: 'duration', dp: 0 }
};

/** Health writes whatever unit the source app used, so nothing can be assumed. */
const CONVERSIONS = {
  km: { km: 1, mi: 1.609344, m: 0.001, ft: 0.0003048, yd: 0.0009144 },
  kg: { kg: 1, g: 0.001, lb: 0.45359237, st: 6.35029318 },
  mg: { mg: 1, g: 1000, mcg: 0.001, µg: 0.001 },
  L: { L: 1, mL: 0.001, fl_oz_us: 0.0295735296, fl_oz_imp: 0.0284130625, cup_us: 0.2365882365 },
  kcal: { kcal: 1, Cal: 1, cal: 0.001, kJ: 0.239005736, J: 0.000239005736 },
  g: { g: 1, mg: 0.001, mcg: 0.000001, oz: 28.349523125, lb: 453.59237 },
  min: { min: 1, hr: 60, s: 1 / 60, ms: 1 / 60000 }
};

function convert(value, unit, family) {
  if (!family) return value;
  // Body fat is written as a percentage by some apps and a fraction by others.
  // Nobody is at one percent, so a value at or under 1 is the fraction.
  if (family === 'pct') return value <= 1 ? value * 100 : value;
  const table = CONVERSIONS[family];
  if (!table) return value;
  const factor = table[unit];
  // An unrecognised unit is left alone rather than silently scaled wrong.
  return factor == null ? value : value * factor;
}

/* ----------------------------------------------------------- tag scanning -- */

/**
 * The `>` that closes the tag starting at `from`.
 *
 * A `>` inside a quoted attribute value is legal XML, and source names in a
 * real export do contain punctuation, so the quotes have to be counted rather
 * than trusting the first one found.
 */
function tagEnd(buf, from) {
  let at = from;
  for (;;) {
    const gt = buf.indexOf('>', at);
    if (gt < 0) return -1;
    let quotes = 0;
    for (let i = from; i < gt; i++) if (buf.charCodeAt(i) === 34) quotes++;
    if (quotes % 2 === 0) return gt;
    at = gt + 1;
  }
}

/**
 * One attribute, without parsing the rest of the tag.
 *
 * Almost every element in the file is a heart rate or an energy sample that
 * this app ignores, so the type is read with this and the tag abandoned before
 * anything more expensive happens. That single check is most of the speed.
 */
function attr(tag, name) {
  const key = ' ' + name + '="';
  const i = tag.indexOf(key);
  if (i < 0) return null;
  const start = i + key.length;
  const end = tag.indexOf('"', start);
  return end < 0 ? null : tag.slice(start, end);
}

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

function decodeEntities(s) {
  if (!s || s.indexOf('&') < 0) return s;
  return s.replace(/&(#x?[0-9a-fA-F]+|[a-z]+);/g, (whole, body) => {
    if (body[0] === '#') {
      const code = body[1] === 'x' || body[1] === 'X'
        ? parseInt(body.slice(2), 16)
        : parseInt(body.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : whole;
    }
    return ENTITIES[body] ?? whole;
  });
}

/**
 * "2026-08-09 07:14:22 +0530" -> "2026-08-09".
 *
 * Health already writes every timestamp in the clock the phone was on at the
 * time, so the first ten characters are the local calendar date and no
 * timezone maths is needed or wanted here.
 */
const dateOf = (stamp) => (stamp && stamp.length >= 10 ? stamp.slice(0, 10) : null);

/**
 * Health writes "2026-08-09 07:14:22 +0530". That is not ISO 8601 twice over —
 * a space where the T belongs, and an offset with no colon — and Safari refuses
 * both, so it is rebuilt rather than patched.
 */
const STAMP = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})(?:\s*([+-])(\d{2}):?(\d{2}))?/;

export function msOf(stamp) {
  const m = stamp && stamp.match(STAMP);
  if (!m) return NaN;
  return Date.parse(`${m[1]}T${m[2]}${m[3] ? `${m[3]}${m[4]}:${m[5]}` : 'Z'}`);
}

/** "HKWorkoutActivityTypeHighIntensityIntervalTraining" -> "High Intensity Interval Training". */
function sportName(raw) {
  if (!raw) return 'Activity';
  const bare = raw.replace(/^HKWorkoutActivityType/, '');
  const words = bare.replace(/([a-z0-9])([A-Z])/g, '$1 $2').trim();
  return words || 'Activity';
}

/* --------------------------------------------------------------- the sink -- */

function newSink() {
  return {
    days: new Map(),
    workouts: [],
    sources: new Map(),
    counts: {},
    last: null // the workout a WorkoutStatistics belongs to
  };
}

function bump(sink, date, spec, value, stamp) {
  if (!date || !Number.isFinite(value)) return;
  let day = sink.days.get(date);
  if (!day) { day = {}; sink.days.set(date, day); }
  let acc = day[spec.field];
  if (!acc) { acc = day[spec.field] = { sum: 0, n: 0, at: '', v: null }; }
  if (spec.how === 'last') {
    if (stamp >= acc.at) { acc.at = stamp; acc.v = value; }
  } else {
    acc.sum += value;
    acc.n += 1;
  }
  sink.counts[spec.field] = (sink.counts[spec.field] || 0) + 1;
}

function noteSource(sink, name) {
  if (!name) return;
  sink.sources.set(name, (sink.sources.get(name) || 0) + 1);
}

function onRecord(sink, tag) {
  const spec = TYPES[attr(tag, 'type')];
  if (!spec) return;
  const start = attr(tag, 'startDate');
  const date = dateOf(start);
  if (!date) return;

  if (spec.how === 'duration') {
    const minutes = (msOf(attr(tag, 'endDate')) - msOf(start)) / 60000;
    if (Number.isFinite(minutes) && minutes > 0) bump(sink, date, spec, minutes, start);
  } else {
    const value = Number(attr(tag, 'value'));
    if (Number.isFinite(value)) bump(sink, date, spec, convert(value, attr(tag, 'unit'), spec.unit), start);
  }
  noteSource(sink, decodeEntities(attr(tag, 'sourceName')));
}

function onStateOfMind(sink, tag) {
  const start = attr(tag, 'startDate');
  const date = dateOf(start);
  const valence = Number(attr(tag, 'valence'));
  if (!date || !Number.isFinite(valence)) return;
  // Health scores mood from −1 to +1. Nobody reads a mood of −0.4; 0 to 100
  // matches every other score in this app.
  bump(sink, date, { field: 'mood', how: 'mean' }, ((valence + 1) / 2) * 100, start);
}

function onWorkout(sink, tag) {
  const start = attr(tag, 'startDate');
  const date = dateOf(start);
  if (!date) return;
  const durationUnit = attr(tag, 'durationUnit') || 'min';
  const duration = Number(attr(tag, 'duration'));
  const source = decodeEntities(attr(tag, 'sourceName')) || 'Apple Health';
  const ms = msOf(start);
  const workout = {
    // The instant, not the timestamp: the id ends up in a URL when the session
    // opens, and Health's own stamps carry a space and a plus sign.
    id: 'apple:' + (Number.isFinite(ms) ? ms : start.replace(/\D/g, '')),
    date,
    sport: sportName(decodeEntities(attr(tag, 'workoutActivityType'))),
    start,
    end: attr(tag, 'endDate'),
    durationMin: Number.isFinite(duration) ? Math.round(convert(duration, durationUnit, 'min')) : null,
    strain: null,
    avgHr: null,
    maxHr: null,
    kilojoule: null,
    distanceM: null,
    source
  };
  sink.workouts.push(workout);
  sink.last = workout;
  noteSource(sink, source);
}

/** Newer exports keep a workout's distance and energy in child elements. */
function onWorkoutStatistics(sink, tag) {
  const w = sink.last;
  if (!w) return;
  const type = attr(tag, 'type');
  const sum = Number(attr(tag, 'sum'));
  if (!Number.isFinite(sum)) return;
  const unit = attr(tag, 'unit');
  if (type === 'HKQuantityTypeIdentifierActiveEnergyBurned') {
    w.kilojoule = Math.round(convert(sum, unit, 'kcal') / 0.239005736) || null;
  } else if (type && type.startsWith('HKQuantityTypeIdentifierDistance')) {
    w.distanceM = Math.round(convert(sum, unit, 'km') * 1000) || null;
  }
}

function handleTag(sink, tag) {
  // Ordered by how often each appears, and the trailing space matters:
  // WorkoutStatistics, WorkoutEvent and WorkoutRoute all start with "<Workout".
  if (tag.startsWith('<Record ')) onRecord(sink, tag);
  else if (tag.startsWith('<WorkoutStatistics ')) onWorkoutStatistics(sink, tag);
  else if (tag.startsWith('<Workout ')) onWorkout(sink, tag);
  else if (tag.startsWith('<StateOfMind ')) onStateOfMind(sink, tag);
}

/** Consume every complete tag, hand back the unfinished tail. */
function consume(sink, buf) {
  let at = 0;
  for (;;) {
    const lt = buf.indexOf('<', at);
    if (lt < 0) return '';
    const end = tagEnd(buf, lt);
    if (end < 0) return buf.slice(lt);
    handleTag(sink, buf.slice(lt, end + 1));
    at = end + 1;
  }
}

/* ------------------------------------------------------------- finalising -- */

const ROUND = { 0: 1, 1: 10, 2: 100 };

function finalise(sink) {
  const days = {};
  for (const [date, acc] of sink.days) {
    const row = {};
    for (const [field, a] of Object.entries(acc)) {
      const spec = FIELD_SPECS[field];
      const how = spec ? spec.how : 'mean';
      let v = null;
      if (how === 'last') v = a.v;
      else if (how === 'mean') v = a.n ? a.sum / a.n : null;
      else v = a.sum;
      if (!Number.isFinite(v)) continue;
      const scale = ROUND[spec ? spec.dp : 0] ?? 1;
      row[field] = Math.round(v * scale) / scale;
    }
    if (Object.keys(row).length) days[date] = row;
  }

  const dates = Object.keys(days).sort();
  return {
    days,
    workouts: sink.workouts.sort((a, b) => (a.start < b.start ? -1 : 1)),
    sources: [...sink.sources.entries()].sort((a, b) => b[1] - a[1]).map(([name]) => name),
    counts: sink.counts,
    first: dates[0] || null,
    last: dates[dates.length - 1] || null
  };
}

/** field -> spec, so finalise knows how each accumulator collapses. */
const FIELD_SPECS = (() => {
  const out = { mood: { how: 'mean', dp: 0 } };
  for (const spec of Object.values(TYPES)) out[spec.field] = spec;
  return out;
})();

/** Every day field this file can produce, in the order a person would read them. */
export const HEALTH_FIELDS = [
  'steps', 'walkKm', 'flights', 'exerciseMin',
  'weightKg', 'bodyFatPct', 'bmi', 'vo2max',
  'caffeineMg', 'drinks', 'waterL', 'kcalIn', 'proteinG',
  'daylightMin', 'mindfulMin', 'headphoneDb', 'mood'
];

/**
 * Fold a whole export.xml into daily rows.
 *
 * @param {ReadableStream<Uint8Array>} stream decompressed export.xml
 * @param {{onProgress?: (chars:number)=>void}} options
 * @returns {Promise<{days:object, workouts:Array, sources:Array<string>, counts:object, first:string|null, last:string|null}>}
 */
export async function parseHealthExport(stream, { onProgress } = {}) {
  const reader = stream.pipeThrough(new TextDecoderStream()).getReader();
  const sink = newSink();
  let buf = '';
  let seen = 0;

  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    seen += value.length;
    buf = consume(sink, buf + value);
    // A tag that never closes would otherwise grow the buffer without limit.
    // Real elements are a few hundred characters, so this can only be a
    // truncated or corrupt file.
    if (buf.length > 4_000_000) throw new Error('The export looks damaged: an element never ends.');
    if (onProgress) onProgress(seen);
  }
  consume(sink, buf);
  return finalise(sink);
}

export const __test = { tagEnd, attr, decodeEntities, sportName, convert, dateOf, consume, newSink, finalise };
