// Builders that produce records shaped exactly like Whoop API v2 responses.
// Tests assert against these rather than against hand-written flat objects, so
// a mistake in the mapping layer cannot be papered over by a matching fixture.

export const IST = '+05:30';

const mins = (m) => m * 60000;

export function cycle({ id, start, tz = IST, strain = 12.4, scored = true, avgHr = 68, maxHr = 141 }) {
  return {
    id,
    user_id: 1,
    created_at: start,
    updated_at: start,
    start,
    end: null,
    timezone_offset: tz,
    score_state: scored ? 'SCORED' : 'PENDING_SCORE',
    score: scored ? { strain, kilojoule: 8288.297, average_heart_rate: avgHr, max_heart_rate: maxHr } : null
  };
}

export function recovery({ cycleId, sleepId, score = 71, rhr = 58, hrv = 84.3, spo2 = 96.4, scored = true, calibrating = false }) {
  return {
    cycle_id: cycleId,
    sleep_id: sleepId,
    user_id: 1,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    score_state: scored ? 'SCORED' : 'UNSCORABLE',
    score: scored ? {
      user_calibrating: calibrating,
      recovery_score: score,
      resting_heart_rate: rhr,
      hrv_rmssd_milli: hrv,
      spo2_percentage: spo2,
      skin_temp_celsius: 33.7
    } : null
  };
}

export function sleepRecord({
  id, start, end, tz = IST, nap = false, scored = true,
  light = 240, deep = 90, rem = 100, awake = 30, perf = 88
}) {
  // in_bed deliberately includes awake time, which is how Whoop reports it.
  const inBed = light + deep + rem + awake;
  return {
    id,
    v1_id: 1,
    user_id: 1,
    created_at: start,
    updated_at: start,
    start,
    end,
    timezone_offset: tz,
    nap,
    score_state: scored ? 'SCORED' : 'PENDING_SCORE',
    score: scored ? {
      stage_summary: {
        total_in_bed_time_milli: mins(inBed),
        total_awake_time_milli: mins(awake),
        total_no_data_time_milli: 0,
        total_light_sleep_time_milli: mins(light),
        total_slow_wave_sleep_time_milli: mins(deep),
        total_rem_sleep_time_milli: mins(rem),
        sleep_cycle_count: 4,
        disturbance_count: 9
      },
      sleep_needed: {
        baseline_milli: mins(450),
        need_from_sleep_debt_milli: mins(20),
        need_from_recent_strain_milli: mins(10),
        need_from_recent_nap_milli: 0
      },
      respiratory_rate: 15.4,
      sleep_performance_percentage: perf,
      sleep_consistency_percentage: 74,
      sleep_efficiency_percentage: 92.5
    } : null
  };
}

export function workout({ id, start, end, sport = 'padel', strain = 9.8, tz = IST, scored = true }) {
  return {
    id,
    v1_id: 1,
    user_id: 1,
    created_at: start,
    updated_at: start,
    start,
    end,
    timezone_offset: tz,
    sport_name: sport,
    sport_id: 248,
    score_state: scored ? 'SCORED' : 'PENDING_SCORE',
    score: scored ? {
      strain,
      average_heart_rate: 132,
      max_heart_rate: 171,
      kilojoule: 1569.34,
      percent_recorded: 100,
      distance_meter: 1772.77,
      altitude_gain_meter: 12,
      altitude_change_meter: 0,
      zone_durations: { zone_zero_milli: 0, zone_one_milli: 1000, zone_two_milli: 2000, zone_three_milli: 0, zone_four_milli: 0, zone_five_milli: 0 }
    } : null
  };
}

/** A continuous run of days with controllable recovery/sleep, for stats tests. */
export function series(n, fn) {
  const out = { cycle: [], recovery: [], sleep: [], workout: [] };
  for (let i = 0; i < n; i++) {
    const day = new Date(Date.UTC(2026, 0, 1 + i));
    const iso = day.toISOString().slice(0, 10);
    const spec = fn(i, iso) || {};
    if (spec.skip) continue;
    const cid = 1000 + i;
    const sid = 'sleep-' + i;
    // 08:00 IST start keeps the local calendar date equal to `iso`.
    out.cycle.push(cycle({ id: cid, start: `${iso}T02:30:00.000Z`, strain: spec.strain ?? 10 }));
    out.recovery.push(recovery({ cycleId: cid, sleepId: sid, score: spec.recovery ?? 60, rhr: spec.rhr ?? 58, hrv: spec.hrv ?? 80 }));
    const bed = spec.bedHour ?? 23;
    const bedUtc = new Date(Date.UTC(2026, 0, 1 + i, bed - 5, 30 - 30));
    if (bed < 6) bedUtc.setUTCDate(bedUtc.getUTCDate());
    out.sleep.push(sleepRecord({
      id: sid,
      start: bedUtc.toISOString(),
      end: `${iso}T02:00:00.000Z`,
      light: spec.light ?? 240, deep: spec.deep ?? 90, rem: spec.rem ?? 100, awake: 30
    }));
    if (spec.sport) {
      out.workout.push(workout({ id: 'w-' + i, start: `${iso}T11:00:00.000Z`, end: `${iso}T12:00:00.000Z`, sport: spec.sport, strain: spec.workoutStrain ?? 10 }));
    }
  }
  return out;
}
