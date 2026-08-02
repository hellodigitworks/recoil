// Whoop API v2 records -> flat daily rows.
//
// The API hands back four separate collections with nested `score` objects and
// millisecond durations. Everything downstream wants one row per day with plain
// numbers, so all the joining and unit conversion happens here and nowhere else.

/** Whoop only fills in `score` when it has finished scoring the record. */
const SCORED = 'SCORED';

/** "+05:30" -> 330, "-05:00" -> -300. Anything unparseable -> 0 (treat as UTC). */
export function offsetMinutes(offset) {
  if (typeof offset !== 'string') return 0;
  const m = offset.match(/^([+-])(\d{2}):?(\d{2})$/);
  if (!m) return 0;
  const sign = m[1] === '-' ? -1 : 1;
  return sign * (Number(m[2]) * 60 + Number(m[3]));
}

/**
 * Calendar date at the record's own timezone, not the viewer's.
 * Shifting the instant then reading it as UTC gives the local calendar date.
 */
export function localDate(iso, offset) {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return null;
  return new Date(t + offsetMinutes(offset) * 60000).toISOString().slice(0, 10);
}

/** Minutes since local midnight, 0-1439. */
export function localMinutes(iso, offset) {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return null;
  const d = new Date(t + offsetMinutes(offset) * 60000);
  return d.getUTCHours() * 60 + d.getUTCMinutes();
}

const min = (milli) => (typeof milli === 'number' ? milli / 60000 : null);
const round1 = (n) => (typeof n === 'number' ? Math.round(n * 10) / 10 : null);

function scoreOf(record) {
  return record && record.score_state === SCORED && record.score ? record.score : null;
}

/** Empty day row. Keys are fixed so charts can rely on their presence. */
function blankDay(date) {
  return {
    date,
    cycleId: null, tz: null,
    strain: null, avgHr: null, maxHr: null, kilojoule: null,
    recovery: null, rhr: null, hrv: null, spo2: null, skinTemp: null,
    sleepId: null, sleepStart: null, sleepEnd: null, bedtimeMin: null, wakeMin: null,
    asleepMin: null, inBedMin: null, awakeMin: null,
    lightMin: null, deepMin: null, remMin: null,
    sleepCycles: null, disturbances: null,
    sleepPerf: null, sleepEff: null, sleepConsistency: null,
    respRate: null, sleepNeededMin: null, sleepDebtMin: null,
    calories: null,
    napMin: 0, workoutCount: 0, workoutStrain: null
  };
}

/** Whoop reports energy in kilojoules; nobody thinks in kilojoules. */
const KJ_TO_KCAL = 0.239006;

function applySleep(row, sleepRecord) {
  const s = scoreOf(sleepRecord);
  row.sleepId = sleepRecord.id;
  row.sleepStart = sleepRecord.start;
  row.sleepEnd = sleepRecord.end;
  row.bedtimeMin = localMinutes(sleepRecord.start, sleepRecord.timezone_offset);
  row.wakeMin = localMinutes(sleepRecord.end, sleepRecord.timezone_offset);
  if (!s) return;

  const st = s.stage_summary || {};
  row.inBedMin = min(st.total_in_bed_time_milli);
  row.awakeMin = min(st.total_awake_time_milli);
  row.lightMin = min(st.total_light_sleep_time_milli);
  row.deepMin = min(st.total_slow_wave_sleep_time_milli);
  row.remMin = min(st.total_rem_sleep_time_milli);
  // Whoop's in-bed total includes awake time, so asleep is the stages summed.
  const stages = [row.lightMin, row.deepMin, row.remMin].filter((v) => v != null);
  row.asleepMin = stages.length ? stages.reduce((a, b) => a + b, 0) : null;
  row.sleepCycles = st.sleep_cycle_count ?? null;
  row.disturbances = st.disturbance_count ?? null;
  row.sleepPerf = s.sleep_performance_percentage ?? null;
  row.sleepEff = round1(s.sleep_efficiency_percentage);
  row.sleepConsistency = s.sleep_consistency_percentage ?? null;
  row.respRate = round1(s.respiratory_rate);

  const need = s.sleep_needed || {};
  const needParts = [
    need.baseline_milli, need.need_from_sleep_debt_milli,
    need.need_from_recent_strain_milli, need.need_from_recent_nap_milli
  ].filter((v) => typeof v === 'number');
  row.sleepNeededMin = needParts.length ? min(needParts.reduce((a, b) => a + b, 0)) : null;

  // Positive means you came up short. Clamped at zero: sleeping past what you
  // needed is not credit you can draw on.
  if (row.sleepNeededMin != null && row.asleepMin != null) {
    row.sleepDebtMin = Math.max(0, row.sleepNeededMin - row.asleepMin);
  }
}

/**
 * @param {{cycle:Array, recovery:Array, sleep:Array, workout:Array}} raw
 * @returns {{days: Array, workouts: Array}} days ascending by date
 */
export function normalize(raw) {
  const cycles = raw.cycle || [];
  const recoveries = raw.recovery || [];
  const sleeps = raw.sleep || [];
  const workoutRecords = raw.workout || [];

  const sleepById = new Map(sleeps.map((s) => [s.id, s]));
  const recoveryByCycle = new Map(recoveries.map((r) => [r.cycle_id, r]));
  const byDate = new Map();

  const rowFor = (date) => {
    if (!byDate.has(date)) byDate.set(date, blankDay(date));
    return byDate.get(date);
  };

  // 1. Cycles set the spine: one physiological cycle per day.
  for (const cycle of cycles) {
    const date = localDate(cycle.start, cycle.timezone_offset);
    if (!date) continue;
    const row = rowFor(date);
    row.cycleId = cycle.id;
    row.tz = cycle.timezone_offset || null;
    const s = scoreOf(cycle);
    if (s) {
      row.strain = round1(s.strain);
      row.avgHr = s.average_heart_rate ?? null;
      row.maxHr = s.max_heart_rate ?? null;
      row.kilojoule = Math.round(s.kilojoule ?? 0) || null;
      row.calories = row.kilojoule ? Math.round(row.kilojoule * KJ_TO_KCAL) : null;
    }

    // 2. Recovery hangs off the cycle, and points at the sleep that produced it.
    const rec = recoveryByCycle.get(cycle.id);
    const rs = scoreOf(rec);
    if (rs && !rs.user_calibrating) {
      row.recovery = rs.recovery_score ?? null;
      row.rhr = rs.resting_heart_rate ?? null;
      row.hrv = round1(rs.hrv_rmssd_milli);
      row.spo2 = round1(rs.spo2_percentage);
      row.skinTemp = round1(rs.skin_temp_celsius);
    }
    if (rec && rec.sleep_id && sleepById.has(rec.sleep_id)) {
      applySleep(row, sleepById.get(rec.sleep_id));
    }
  }

  // 3. Any main sleep the recovery join missed still belongs to a day; naps are
  //    tracked separately so they never inflate "hours slept last night".
  for (const s of sleeps) {
    const date = localDate(s.end, s.timezone_offset);
    if (!date) continue;
    const row = rowFor(date);
    if (s.nap) {
      const sc = scoreOf(s);
      const st = (sc && sc.stage_summary) || {};
      const napStages = [st.total_light_sleep_time_milli, st.total_slow_wave_sleep_time_milli, st.total_rem_sleep_time_milli]
        .filter((v) => typeof v === 'number');
      if (napStages.length) row.napMin += min(napStages.reduce((a, b) => a + b, 0));
      continue;
    }
    if (!row.sleepId) applySleep(row, s);
  }

  // 4. Workouts are their own list, plus a per-day rollup for the daily view.
  const workouts = [];
  for (const w of workoutRecords) {
    const date = localDate(w.start, w.timezone_offset);
    if (!date) continue;
    const s = scoreOf(w);
    const startMs = Date.parse(w.start);
    const endMs = Date.parse(w.end);
    workouts.push({
      id: w.id,
      date,
      sport: w.sport_name || (w.sport_id != null ? `Activity ${w.sport_id}` : 'Activity'),
      start: w.start,
      end: w.end,
      durationMin: Number.isFinite(startMs) && Number.isFinite(endMs) ? Math.round((endMs - startMs) / 60000) : null,
      strain: s ? round1(s.strain) : null,
      avgHr: s ? s.average_heart_rate ?? null : null,
      maxHr: s ? s.max_heart_rate ?? null : null,
      kilojoule: s ? Math.round(s.kilojoule ?? 0) || null : null,
      distanceM: s ? Math.round(s.distance_meter ?? 0) || null : null
    });
    const row = rowFor(date);
    row.workoutCount += 1;
    if (s && typeof s.strain === 'number') {
      row.workoutStrain = round1((row.workoutStrain || 0) + s.strain);
    }
  }

  const days = [...byDate.values()].sort((a, b) => (a.date < b.date ? -1 : 1));
  workouts.sort((a, b) => (a.start < b.start ? -1 : 1));
  return { days, workouts };
}

/** Merge freshly synced records over cached ones, newest wins. Keyed by id. */
export function mergeById(existing, incoming, key = 'id') {
  const map = new Map();
  for (const r of existing || []) map.set(r[key], r);
  for (const r of incoming || []) map.set(r[key], r);
  return [...map.values()];
}
