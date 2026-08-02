// The two screens built around a single number: one metric across time, and
// one metric on one day.

import * as S from '../data/stats.js';
import * as C from './charts.js';
import { METRICS, BASELINE_METRICS, hm, fmtValue, deltaUnit, deltaNoise } from './metrics.js';
import * as V from './voice.js';
import { go } from './router.js';

const $ = (id) => document.getElementById(id);
const escapeHtml = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const nums = (s) => escapeHtml(s).replace(/([+\-−]?\d[\d.,:]*%?)/g, '<span class="num">$1</span>');

const TARGET_KEY = 'recoil.v1.sleep_target';
export const sleepTarget = () => Number(localStorage.getItem(TARGET_KEY)) || S.DEFAULT_SLEEP_TARGET_MIN;
export const setSleepTarget = (min) => localStorage.setItem(TARGET_KEY, String(min));

/* -------------------------------------------------------------- day metric -- */

// The context chart puts the chosen day inside its own neighbourhood rather than
// at the right-hand edge, where a marker reads as "the end of the data" instead
// of "here". Days after it are only shown when they exist.
const CONTEXT_BEFORE = 60;
const CONTEXT_AFTER = 30;

/**
 * One metric, on one day. This is where you land from a day tile: the value in
 * full, everything Whoop recorded around it, and then that day marked inside its
 * own history so a number has somewhere to stand.
 */
export function renderDayMetric(state, date, key) {
  const meta = METRICS[key];
  const days = state.days;
  if (!meta || !days.length) { go('/day', { back: true }); return; }

  const i = days.findIndex((d) => d.date === date);
  if (i === -1) { go('/day/' + date, { replace: true }); return; }
  const day = days[i];
  const value = meta.get(day);

  $('dm-date').textContent = C.longDate(date);
  $('dm-title').textContent = meta.label;
  $('dm-value').innerHTML = value == null ? '—'
    : nums(fmtValue(meta, value)) + (meta.unit ? `<small>${escapeHtml(meta.unit)}</small>` : '');

  // Judged against the 30 days up to that date, so a day in March is measured
  // against the shape you were in during March.
  const recent = days.slice(Math.max(0, i - 29), i + 1);
  const baseline = S.median(recent.map(meta.get));
  const chip = $('dm-chip');
  if (!Number.isFinite(value) || !Number.isFinite(baseline)) {
    chip.className = 'chip weak';
    chip.textContent = Number.isFinite(value) ? 'NO NORMAL YET' : 'NOT SCORED';
  } else {
    const delta = value - baseline;
    const better = meta.better === 'down' ? delta < 0 : delta > 0;
    const loud = Math.abs(delta) > deltaNoise(meta);
    chip.className = 'chip' + (!loud || meta.better === 'neutral' ? '' : better ? ' is-up' : ' is-down');
    chip.innerHTML = nums(`${fmtValue(meta, delta, { signed: true })}${deltaUnit(meta)} vs your normal`);
  }
  $('dm-say').textContent = V.daySay(meta, value, baseline, date);

  renderDayFacts(day, key, meta, baseline);

  // Sleep is the only metric with a shape worth drawing for a single day.
  const isSleep = key === 'sleep' || key === 'sleepPerf' || key === 'sleepEff' || key === 'sleepDebt';
  $('dm-night').hidden = !isSleep || !Number.isFinite(day.asleepMin);
  if (!$('dm-night').hidden) {
    $('dm-night-say').textContent = V.nightSay(day, date);
    C.nightStages({ container: $('dm-night-chart'), row: day });
  }

  // Rank across everything ever recorded, in the direction that counts as good.
  const scored = days.filter((d) => Number.isFinite(meta.get(d)));
  let rankLine = '';
  if (Number.isFinite(value) && scored.length > 1) {
    const desc = meta.better !== 'down';
    const sorted = [...scored].sort((a, b) => (desc ? meta.get(b) - meta.get(a) : meta.get(a) - meta.get(b)));
    const rank = sorted.findIndex((d) => d.date === date) + 1;
    rankLine = V.rankSay(rank, scored.length, meta.better);
  }
  $('dm-rank').innerHTML = rankLine ? nums(rankLine) : 'Not scored, so there is nothing to rank.';

  const rows = days.slice(Math.max(0, i - CONTEXT_BEFORE), Math.min(days.length, i + CONTEXT_AFTER + 1));
  C.timeChart({
    container: $('dm-chart'),
    // Daily, never bucketed: on a screen about one specific day, a point that is
    // secretly a two-day median would be reporting the wrong number.
    rows, field: meta.field, scale: meta.scale ?? 1, height: 230, mark: date, daily: true,
    bands: meta.bands ? [
      { from: S.GREEN, to: 100, color: 'var(--good)' },
      { from: S.AMBER, to: S.GREEN, color: 'var(--warn)' },
      { from: 0, to: S.AMBER, color: 'var(--bad)' }
    ] : null,
    format: (v, r) => `${C.shortDate(r.date)} · ${fmtValue(meta, v)}${deltaUnit(meta)}`,
    readout: $('dm-readout'),
    // Scrubbing is how you read a chart on a phone; tapping through is how you
    // leave one. Both from the same drag.
    onPick: (row) => { if (row?.date) go('/day/' + (row.from || row.date)); }
  });

  $('dm-full').dataset.key = key;
  $('dm-full').querySelector('.sub').innerHTML =
    nums(`Every ${meta.label.toLowerCase()} you have on record, week by week`);
}

/** Everything Whoop recorded around one number, so it is not a lone figure. */
function renderDayFacts(day, key, meta, baseline) {
  const clock = (m) => (Number.isFinite(m) ? String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(Math.round(m % 60)).padStart(2, '0') : '—');
  const sleepFacts = [
    ['Asleep', hm(day.asleepMin)],
    ['In bed', hm(day.inBedMin)],
    ['Awake', hm(day.awakeMin)],
    ['Deep', hm(day.deepMin)],
    ['REM', hm(day.remMin)],
    ['Light', hm(day.lightMin)],
    ['Fell asleep', clock(day.bedtimeMin)],
    ['Woke', clock(day.wakeMin)],
    ['Needed', hm(day.sleepNeededMin)],
    ['Short by', hm(day.sleepDebtMin)],
    ['Efficiency', day.sleepEff == null ? '—' : day.sleepEff.toFixed(1) + '%'],
    ['Cycles', day.sleepCycles == null ? '—' : String(day.sleepCycles)],
    ['Disturbances', day.disturbances == null ? '—' : String(day.disturbances)],
    ['Naps', day.napMin ? hm(day.napMin) : 'none']
  ];
  const dayFacts = [
    ['Your normal', Number.isFinite(baseline) ? fmtValue(meta, baseline) + deltaUnit(meta) : '—'],
    ['Recovery', day.recovery == null ? '—' : Math.round(day.recovery) + '%'],
    ['Strain', day.strain == null ? '—' : day.strain.toFixed(1)],
    ['Sleep', hm(day.asleepMin)],
    ['Resting HR', day.rhr == null ? '—' : day.rhr + ' bpm'],
    ['HRV', day.hrv == null ? '—' : Math.round(day.hrv) + ' ms'],
    ['Calories', day.calories == null ? '—' : day.calories + ' kcal'],
    ['Sessions', String(day.workoutCount || 0)]
  ];
  const isSleepish = ['sleep', 'sleepPerf', 'sleepEff', 'sleepDebt', 'sleepConsistency', 'respRate', 'spo2'].includes(key);
  const facts = isSleepish ? sleepFacts : dayFacts;

  $('dm-facts').innerHTML = facts.map(([k, v]) =>
    `<div><dt>${escapeHtml(k)}</dt><dd>${nums(v)}</dd></div>`).join('');
}

/* ------------------------------------------------------------------ metric -- */

/**
 * How tall the main chart should be: whatever is left under the header block,
 * within reason. Capped so a tall screen does not stretch one line into a
 * poster, floored so a short one stays readable.
 */
function chartHeight() {
  const view = $('view').clientHeight;
  const head = $('screen-metric').querySelector('.head').offsetHeight;
  const chrome = 96; // readout, legend and the gap above them
  return Math.round(Math.max(190, Math.min(400, view - head - chrome)));
}

export function renderMetric(state, key, rerender) {
  const meta = METRICS[key];
  if (!meta) { go('/', { back: true }); return; }
  const scale = meta.scale ?? 1;
  const days = state.days;
  if (!days.length) return;

  const anchor = days[days.length - 1].date;
  const { unit, offset } = state.trend;
  const slice = S.periodSlice(days, anchor, unit, offset);
  const summary = S.periodSummary(slice, meta.field);
  const rows = slice.rows;

  $('metric-title').textContent = meta.label;
  $('metric-blurb').textContent = meta.phrase;
  $('range').textContent = unit === 'ALL' ? 'All' : unit;
  $('period-label').textContent = S.periodLabel(slice, unit);
  // You cannot walk past today, and there is no point walking past your history.
  // All time is the whole history, so there is nowhere to step to.
  $('period-next').disabled = unit === 'ALL' || offset >= 0;
  $('period-prev').disabled = unit === 'ALL' || slice.from <= days[0].date;

  $('metric-now').innerHTML = summary.average == null ? '—'
    : nums(fmtValue(meta, summary.average * scale)) + (meta.unit ? `<small>${escapeHtml(meta.unit)}</small>` : '');

  const chg = $('metric-change');
  if (summary.change == null) {
    chg.className = 'chip weak';
    chg.textContent = summary.n ? 'NO PRIOR PERIOD' : 'NO DATA';
  } else {
    const better = meta.better === 'down' ? summary.change < 0 : summary.change > 0;
    const meaningful = Math.abs(summary.change) >= 3;
    chg.className = 'chip' + (!meaningful || meta.better === 'neutral' ? '' : better ? ' is-up' : ' is-down');
    const word = (S.TREND_UNITS.find((u) => u.key === unit) || {}).label || 'period';
    chg.innerHTML = nums(`${summary.change >= 0 ? '+' : '−'}${Math.abs(summary.change).toFixed(0)}% vs prior ${word}`);
  }

  const trendNode = $('metric-trend');
  if (summary.average == null) {
    trendNode.textContent = 'Nothing recorded in this window. A clean slate, technically.';
  } else if (summary.change == null) {
    trendNode.innerHTML = nums(`${summary.n} days in here. Nothing earlier to hold it up against yet.`);
  } else {
    const better = meta.better === 'down' ? summary.change < 0 : summary.change > 0;
    const flat = Math.abs(summary.change) < 3;
    trendNode.innerHTML = flat
      ? 'Flat against the period before. Nothing has moved, which is its own kind of answer.'
      : nums(`${summary.change > 0 ? 'Up' : 'Down'} ${Math.abs(summary.change).toFixed(0)}% on the period before.`)
        + (meta.better === 'neutral' ? ' Make of that what you like.' : better ? ' That is the direction you want. Keep going.' : ' Wrong direction. Worth a look.');
  }

  // A week or a month is few enough days to draw one bar each. Six months is
  // not, so that view shows the daily line with each month's average over it.
  const chart = $('metric-chart');
  if (S.isLongRange(unit)) {
    C.timeChart({
      container: chart, rows, field: meta.field, scale, height: chartHeight(),
      bands: meta.bands ? [
        { from: S.GREEN, to: 100, color: 'var(--good)' },
        { from: S.AMBER, to: S.GREEN, color: 'var(--warn)' },
        { from: 0, to: S.AMBER, color: 'var(--bad)' }
      ] : null,
      months: S.monthlyMeans(rows, meta.field).map((m) => ({ ...m, value: m.value == null ? null : m.value * scale })),
      format: (v, r) => `${C.shortDate(r.date)} · ${fmtValue(meta, v)}${deltaUnit(meta)}`,
      readout: $('metric-readout'),
      onPick: (row) => { if (row?.date) go('/day/' + (row.from || row.date)); }
    });
    $('metric-legend').hidden = false;
  } else {
    C.dayBars({
      container: chart, rows, field: meta.field, scale, unit,
      height: Math.min(chartHeight(), 300),
      format: (v) => fmtValue(meta, v),
      average: summary.average == null ? null : summary.average * scale,
      readout: $('metric-readout'),
      label: (v, r) => `${C.shortDate(r.date)} · ${v == null ? 'NO DATA' : fmtValue(meta, v) + deltaUnit(meta)}`,
      idle: `${summary.n} ${summary.n === 1 ? 'day' : 'days'} recorded · drag to read`,
      onPick: (row) => { if (row?.date) go('/day/' + row.date); }
    });
    $('metric-legend').hidden = true;
  }

  const personal = BASELINE_METRICS.includes(key) ? S.baselineNow(days, meta.field) : null;
  const dev = $('metric-deviation');
  dev.hidden = !personal || !Number.isFinite(personal.z);
  if (!dev.hidden) {
    const level = S.deviation(personal.z);
    dev.className = 'deviation is-' + level;
    dev.innerHTML =
      '<span class="eyebrow">Against your own baseline</span>' +
      `<p>${nums(`${Math.abs(personal.z).toFixed(1)} standard deviations ${personal.z > 0 ? 'above' : 'below'} your ${personal.n}-day normal of `)}` +
      `<b>${nums(fmtValue(meta, personal.mean) + deltaUnit(meta))}</b>.</p>` +
      `<span class="chip">${level === 'normal' ? 'Normal for you' : level === 'mild' ? 'Mild deviation' : 'Significant deviation'}</span>`;
  }

  const isSleep = key === 'sleep';
  $('metric-extra').hidden = !isSleep;
  if (isSleep) {
    C.stageChart({ container: $('stage-chart'), rows, height: 200 });
    C.bedtimeChart({ container: $('bed-chart'), rows, height: 200, readout: $('bed-readout') });
  }

  const isDebt = key === 'sleepDebt';
  $('metric-ledger').hidden = !isDebt;
  if (isDebt) renderLedger(rows, rerender);
}

/** Running sleep debt against a target you choose, not one Whoop chose. */
function renderLedger(rows) {
  const target = sleepTarget();
  const led = S.sleepLedger(rows, target);

  document.querySelectorAll('#sleep-target button').forEach((b) => {
    b.classList.toggle('is-on', Number(b.dataset.min) === target);
  });

  const owed = (m) => (m > 0 ? `${hm(m)} in the red` : m < 0 ? `${hm(-m)} in credit` : 'exactly level');
  $('ledger-say').innerHTML = nums(
    `Against ${hm(target)} a night you are ${owed(led.total)} across this window, and ` +
    `${owed(led.week)} over the last 7 days.`
  ) + (led.week > 120 ? ' Go to bed early once and most of that disappears.' : '');
  C.ledgerChart({ container: $('ledger-chart'), rows: led.rows, format: (v) => hm(v) });
}
