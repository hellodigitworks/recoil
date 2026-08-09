// Patterns, Activities, Records and one workout: the screens that read the
// whole history at once rather than a single day. Every finding here states its
// sample size, because a number drawn from four nights is not a finding.

import * as S from '../data/stats.js';
import * as C from './charts.js';
import { hm, METRICS, BEHAVIOUR_TILES, fmtValue } from './metrics.js';
import { go } from './router.js';

const $ = (id) => document.getElementById(id);

const escapeHtml = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
// A run of digits, set in the mono face while the words around it stay in
// Delight. The inner group has to end on a digit: without it, "4440." swallows
// the full stop into the mono span, whose sidebearings then leave what looks
// like a gap before the punctuation.
const nums = (s) => escapeHtml(s).replace(/([+\-−]?\d(?:[\d.,:]*\d)?%?)/g, '<span class="num">$1</span>');

/* ---------------------------------------------------------------- patterns -- */

/** Metrics worth a year-on-year read, and how to say each one out loud. */
const YEAR_METRICS = [
  { field: 'recovery', label: 'Recovery', unit: '%', better: 'up', digits: 0 },
  { field: 'hrv', label: 'HRV', unit: 'ms', better: 'up', digits: 0 },
  { field: 'rhr', label: 'Resting HR', unit: 'bpm', better: 'down', digits: 0 }
];

/**
 * You against you, a year ago.
 *
 * Hidden outright until there is a second year to compare against, rather than
 * shown empty. A findings screen that promises six answers and delivers a
 * shrug is worse than one that promises five.
 */
function renderYearOnYear(days) {
  const block = $('p-year-block');
  const found = YEAR_METRICS
    .map((m) => ({ ...m, cmp: S.versusLastYear(days, m.field) }))
    .filter((m) => m.cmp);

  block.hidden = found.length === 0;
  // The lede counts the findings actually on the screen. Promising six and
  // showing five is the kind of small lie this app is built not to tell.
  $('p-lede').textContent = (found.length ? 'Six' : 'Five')
    + ' questions the Whoop app will never answer about you. Every one shows its'
    + ' sample size, so you can tell a real finding from a flattering coincidence.';
  if (!found.length) return;

  C.barChart({
    container: $('p-year'),
    // Two bars per metric would need a grouped chart; recovery is the headline,
    // so it gets the picture and the rest get the sentence.
    rows: [
      { label: 'Last year', value: found[0].cmp.then },
      { label: 'Now', value: found[0].cmp.now }
    ],
    format: (v) => v.toFixed(found[0].digits) + found[0].unit,
    accentBest: true
  });

  const say = found.map((m) => {
    const { delta, now } = m.cmp;
    const improved = m.better === 'up' ? delta > 0 : delta < 0;
    const size = Math.abs(delta);
    if (size < (m.field === 'hrv' ? 1.5 : 1)) return `${m.label} has not moved.`;
    return `${m.label} is ${improved ? 'better' : 'worse'} by ${size.toFixed(m.digits)}${m.unit}, now ${now.toFixed(m.digits)}${m.unit}.`;
  });

  const lead = found[0].cmp;
  const verdict = Math.abs(lead.delta) < 1
    ? 'A year of training and you are exactly where you started. That is either maintenance or a plateau, and only you know which.'
    : lead.delta > 0
      ? 'A year on, you are genuinely in better shape. Not a feeling, a measurement.'
      : 'A year on, you are worse off than you were. Worth knowing before it becomes two.';

  $('p-year-say').innerHTML = nums(`${verdict} ${say.join(' ')}`);
  setConf('p-year-conf', {
    text: `${lead.nowNights} days now vs ${lead.thenNights} days around ${lead.thenLabel}`,
    weak: Math.min(lead.nowNights, lead.thenNights) < 20
  });
}

export function confidence(n, r) {
  if (n < 20) return { text: `Only ${n} days of overlap. A rumour, not a fact.`, weak: true };
  if (r == null) return { text: `${n} days. No usable correlation.`, weak: true };
  const strength = Math.abs(r) > 0.4 ? 'a clear' : Math.abs(r) > 0.2 ? 'a mild' : 'almost no';
  return { text: `${n} days · r ${r.toFixed(2)} · ${strength} relationship`, weak: Math.abs(r) <= 0.2 };
}

function setConf(id, { text, weak }) {
  const node = $(id);
  node.innerHTML = nums(text);
  node.className = 'chip' + (weak ? ' weak' : '');
}

/* -------------------------------------------------- findings from Apple -- */

/** Movement fields in the order they answer the question best, and the words
    each one needs so the sentence under the chart is about that thing and not
    a template with a metric name dropped into it. */
const MOVE_FIELDS = [
  { field: 'steps', by: 'how many steps you took', noun: 'walking' },
  { field: 'walkKm', by: 'how far you walked', noun: 'walking' },
  { field: 'exerciseMin', by: 'how long you moved', noun: 'movement' },
  { field: 'flights', by: 'how many floors you climbed', noun: 'climbing' }
];

/** How a metric's own value reads on a band label: "6.2km", "1h 20m", "8400". */
function shortValue(key, v) {
  const meta = METRICS[key];
  if (!meta) return String(Math.round(v));
  if (meta.asTime) return hm(v);
  return fmtValue(meta, v) + (meta.unit || '');
}

/** The movement metric with the most days behind it, or null. */
function moveFinding(days) {
  let best = null;
  for (const move of MOVE_FIELDS) {
    const result = S.vsNextRecovery(days, move.field, { format: (v) => shortValue(move.field, v) });
    if (!result.rows.length) continue;
    if (!best || result.n > best.result.n) best = { ...move, result };
  }
  return best;
}

/** Weight against resting heart rate, the one body pair worth a sentence. */
function bodyFinding(days) {
  const pair = S.pairedCorrelation(days, 'weightKg', 'rhr');
  return pair.n >= 20 && pair.r != null ? pair : null;
}

function lifeFindings(days) {
  return S.lifeImpact(days, BEHAVIOUR_TILES).filter((row) => Math.abs(row.delta) >= 0.5);
}

/**
 * How many findings the Patterns screen will actually show, so Today can say a
 * number that turns out to be true when you tap through to it.
 */
export function findingCount(days) {
  return 5
    + (S.versusLastYear(days, 'recovery') ? 1 : 0)
    + (moveFinding(days) ? 1 : 0)
    + (lifeFindings(days).length ? 1 : 0)
    + (bodyFinding(days) ? 1 : 0);
}

/** Number the visible blocks in order, so nothing reads 06, 08. */
function renumber() {
  let n = 0;
  document.querySelectorAll('#screen-patterns > section').forEach((block) => {
    if (block.hidden) return;
    const eyebrow = block.querySelector('.eyebrow');
    if (eyebrow) eyebrow.textContent = String(++n).padStart(2, '0');
  });
}

function renderApplePatterns(days) {
  const move = moveFinding(days);
  $('p-move-block').hidden = !move;
  if (move) {
    const { result, by, noun } = move;
    $('p-move-head').textContent = noun === 'walking'
      ? 'Does walking more actually help?'
      : 'Does moving more actually help?';
    $('p-move-readout').textContent = `Next morning's recovery, by ${by}`;
    C.barChart({ container: $('p-move'), rows: result.rows, format: (v) => Math.round(v) + '%', accentBest: true });

    const first = result.rows[0];
    const last = result.rows[result.rows.length - 1];
    const gap = last.value - first.value;
    $('p-move-say').innerHTML = Math.abs(gap) < 1
      ? nums(`Your ${noun} barely touches the next morning. Whatever you do, recovery comes back around ${Math.round(result.overall)}%. Worth knowing before you blame a quiet day for a bad number.`)
      : gap > 0
        ? nums(`Your busiest days for ${noun}, ${last.label}, come back at ${Math.round(last.value)}% the next morning. Your quietest, ${first.label}, come back at ${Math.round(first.value)}%. That is ${Math.abs(gap).toFixed(1)} points, free, for moving.`)
        : nums(`More ${noun} costs you. The ${last.label} days come back at ${Math.round(last.value)}%, against ${Math.round(first.value)}% on the ${first.label} days. ${Math.abs(gap).toFixed(1)} points, in the wrong direction.`);
    setConf('p-move-conf', confidence(result.n, result.r));
  }

  const life = lifeFindings(days);
  $('p-life-block').hidden = !life.length;
  if (life.length) {
    C.deltaBars({
      container: $('p-life'),
      rows: life.map((row) => ({
        sport: METRICS[row.field].label,
        delta: row.delta,
        n: row.n
      })),
      format: (r) => `${r.delta >= 0 ? '+' : '−'}${Math.abs(r.delta).toFixed(1)} · ${r.n}`
    });
    const top = life[0];
    const meta = METRICS[top.field];
    $('p-life-say').innerHTML = nums(
      `${meta.label} is the one that shows. On your top third of days, around ${shortValue(top.field, top.highValue)}, ` +
      `you wake up ${Math.abs(top.delta).toFixed(1)} points ${top.delta >= 0 ? 'better' : 'worse'} than on your bottom third, around ${shortValue(top.field, top.lowValue)}. ` +
      'Everything below it moves you less.');
    setConf('p-life-conf', {
      text: `${life.length} of ${BEHAVIOUR_TILES.length} possible · anything under 20 overlapping days is hidden`,
      weak: life.length < 2
    });
  }

  const body = bodyFinding(days);
  $('p-body-block').hidden = !body;
  if (body) {
    const strength = Math.abs(body.r);
    $('p-body-say').innerHTML = strength < 0.2
      ? nums(`Your weight and your resting heart rate are not moving together. Over ${body.n} days one says nothing about the other, which means the scale is not the thing to watch here.`)
      : body.r > 0
        ? nums(`Your resting heart rate rises with your weight. Over ${body.n} days they move together, which is the most boring and most reliable fitness signal there is.`)
        : nums(`Your resting heart rate falls as your weight rises. Over ${body.n} days that usually means the weight is going on as training, not as decline.`);
    setConf('p-body-conf', confidence(body.n, body.r));
  }
}

export function renderPatterns(state) {
  const days = state.days;

  renderYearOnYear(days);

  const bed = S.bedtimeVsRecovery(days);
  C.barChart({ container: $('p-bed'), rows: bed.rows, format: (v) => Math.round(v) + '%', accentBest: true });
  const best = bed.rows.length ? bed.rows.reduce((a, b) => (b.value > a.value ? b : a)) : null;
  const worst = bed.rows.length ? bed.rows.reduce((a, b) => (b.value < a.value ? b : a)) : null;
  $('p-bed-say').innerHTML = best && worst && best !== worst
    ? nums(`Asleep around ${best.label} and you wake up at ${Math.round(best.value)}%. Around ${worst.label} and it is ${Math.round(worst.value)}%. That is ${Math.round(best.value - worst.value)} points, free, for going to bed earlier.`)
    : 'Not enough nights at each bedtime to compare yet.';
  setConf('p-bed-conf', confidence(bed.n, bed.r));

  const sl = S.sleepHoursVsRecovery(days);
  C.barChart({ container: $('p-sleep'), rows: sl.rows, format: (v) => Math.round(v) + '%', accentBest: true });
  $('p-sleep-say').innerHTML = sl.sweetSpot
    ? nums(`Past ${sl.sweetSpot.label} asleep, your recovery stops caring. That is your number. Not the eight hours everyone repeats at you.`)
    : 'Not enough scored nights yet to find your number.';
  setConf('p-sleep-conf', confidence(sl.n, sl.r));

  const wo = S.workoutImpact(days, state.workouts);
  C.deltaBars({ container: $('p-workout'), rows: wo.rows, format: (r) => `${r.delta >= 0 ? '+' : '−'}${Math.abs(r.delta).toFixed(1)} · ${r.n}` });
  $('p-workout-say').innerHTML = wo.rows.length >= 2
    ? nums(`${wo.rows[0].sport} leaves you ${wo.rows[0].delta >= 0 ? '+' : '−'}${Math.abs(wo.rows[0].delta).toFixed(1)} points above your average next-day recovery. ${wo.rows[wo.rows.length - 1].sport} costs you ${Math.abs(wo.rows[wo.rows.length - 1].delta).toFixed(1)}. Measured against your overall ${Math.round(wo.overall)}%.`)
    : 'Need three sessions of two different sports before this says anything worth reading.';
  setConf('p-workout-conf', { text: `${wo.n} workouts logged · sports under 3 sessions hidden`, weak: wo.rows.length < 2 });

  const week = S.weekShape(days);
  C.barChart({ container: $('p-week'), rows: week.map((w) => ({ label: w.short.toUpperCase(), value: w.recovery, n: w.n })), format: (v) => Math.round(v) + '%', accentBest: true });
  C.barChart({ container: $('p-week-strain'), rows: week.map((w) => ({ label: w.short.toUpperCase(), value: w.strain, n: w.n })), format: (v) => v.toFixed(1) });
  const scoredWeek = week.filter((w) => Number.isFinite(w.recovery));
  if (scoredWeek.length >= 5) {
    const hi = scoredWeek.reduce((a, b) => (b.recovery > a.recovery ? b : a));
    const lo = scoredWeek.reduce((a, b) => (b.recovery < a.recovery ? b : a));
    const hardest = week.filter((w) => Number.isFinite(w.strain)).reduce((a, b) => (b.strain > a.strain ? b : a), week[0]);
    $('p-week-say').innerHTML = nums(
      `${hi.label} is when you are at your best, ${Math.round(hi.recovery)}%. ${lo.label} is where you fall apart, ${Math.round(lo.recovery)}%, on ${(lo.sleepH ?? 0).toFixed(1)}h of sleep. ` +
      `And you go hardest on ${hardest.label}, which may explain a few things.`);
  } else {
    $('p-week-say').textContent = 'Not enough scored days to see the shape of your week yet.';
  }
  setConf('p-week-conf', { text: `${days.length} days across ${scoredWeek.length} weekdays with data`, weak: scoredWeek.length < 5 });

  // 05 — does a hard day actually cost you tomorrow, and past what strain?
  const sv = S.strainVsNextRecovery(days);
  C.scatterChart({
    container: $('p-strain'),
    points: sv.points.map((p) => ({ x: p.strain, y: p.recovery })),
    bins: sv.rows,
    reference: sv.overall,
    threshold: sv.threshold ? sv.threshold.key : null,
    xLabel: 'Strain today', yLabel: 'Recovery tomorrow'
  });
  $('p-strain-say').innerHTML = sv.threshold
    ? nums(`Push past a strain of about ${sv.threshold.key} and tomorrow morning sends you the bill. Days in the ${sv.threshold.label} band come back at ${Math.round(sv.threshold.value)}%, against your ${Math.round(sv.overall)}% average.`)
    : sv.rows.length
      ? nums(`No strain band reliably costs you anything. Your next-day recovery sits around ${Math.round(sv.overall)}% whatever you throw at it. Enviable.`)
      : 'Not enough back-to-back scored days yet.';
  setConf('p-strain-conf', confidence(sv.n, sv.r));

  renderApplePatterns(days);
  renumber();

  const shown = document.querySelectorAll('#screen-patterns > section:not([hidden])').length;
  $('p-lede').innerHTML = nums(
    `${shown} questions the Whoop app will never answer about you. ` +
    'Every one shows its sample size, so you can tell a real finding from a flattering coincidence.');
}

/* -------------------------------------------------------------- activities -- */

const MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Whoop hands sports back as "padel" and "weightlifting". In a sentence that
    reads like a typo, and CSS capitalisation cannot reach inside prose. */
const titled = (s) => String(s).replace(/\b[a-z]/g, (c) => c.toUpperCase());
const HEAT_DAYS = 371; // 53 whole weeks, so the grid never ends mid-column

/**
 * A year of days as squares, shaded by how hard you trained. Anything with no
 * session at all keeps the lightest step rather than disappearing, so a fallow
 * stretch reads as a fact and not as missing data.
 */
function heatGrid(days) {
  const grid = $('act-grid');
  const last = days[days.length - 1];
  if (!last) { grid.replaceChildren(); return; }

  const end = Date.parse(last.date + 'T00:00:00Z');
  const byDate = new Map(days.map((d) => [d.date, d]));

  // Quartiles of the days you actually trained, not quarters of the maximum.
  // Against the maximum one exceptional session drags every ordinary one down
  // into the palest step and the whole year reads as empty.
  const trained = days.map((d) => d.workoutStrain).filter((v) => Number.isFinite(v) && v > 0).sort((a, b) => a - b);
  const cut = (q) => (trained.length ? trained[Math.min(trained.length - 1, Math.floor(trained.length * q))] : Infinity);
  const q1 = cut(0.25), q2 = cut(0.5), q3 = cut(0.75);
  const step = (v) => {
    if (!Number.isFinite(v) || v <= 0) return 'h0';
    return v >= q3 ? 'h4' : v >= q2 ? 'h3' : v >= q1 ? 'h2' : 'h1';
  };

  // Columns are weeks, and the last column has to end on the newest day, so
  // the run is padded at the front to land on a Sunday.
  const startsBack = HEAT_DAYS - 1 + new Date(end).getUTCDay();
  const weeks = document.createElement('div');
  weeks.className = 'heat-weeks';
  const strip = document.createElement('div');
  strip.className = 'heat-months';
  let shownMonth = -1;

  for (let offset = startsBack; offset >= 0; offset -= 7) {
    const week = document.createElement('div');
    week.className = 'wk';
    let label = '';
    for (let d = 0; d < 7; d++) {
      const t = end - (offset - d) * 86400000;
      const iso = new Date(t).toISOString().slice(0, 10);
      const sq = document.createElement('button');
      sq.type = 'button';
      const row = byDate.get(iso);
      if (t > end || !row) {
        sq.className = 'sq is-void';
        sq.tabIndex = -1;
        sq.setAttribute('aria-hidden', 'true');
      } else {
        sq.className = 'sq ' + step(row.workoutStrain);
        const strain = Number.isFinite(row.workoutStrain) ? `strain ${row.workoutStrain.toFixed(1)}` : 'nothing logged';
        sq.title = `${C.longDate(iso)} · ${strain}`;
        sq.setAttribute('aria-label', sq.title);
        sq.addEventListener('click', () => go('/day/' + iso));
        const month = new Date(t).getUTCMonth();
        if (month !== shownMonth) { label = MONTH_SHORT[month]; shownMonth = month; }
      }
      week.appendChild(sq);
    }
    weeks.appendChild(week);
    const cell = document.createElement('span');
    cell.textContent = label;
    strip.appendChild(cell);
  }

  // Both rows live inside the same scroller, or the labels sit still while the
  // squares slide and every month ends up naming the wrong column.
  const inner = document.createElement('div');
  inner.className = 'heat-inner';
  inner.append(strip, weeks);
  grid.replaceChildren(inner);
  // A year is wider than a phone. Open on the end of it, which is now.
  grid.scrollLeft = grid.scrollWidth;
}

/** Sessions of one sport, newest first, each a way into its own screen. */
function sessionList(sessions) {
  const list = document.createElement('div');
  list.className = 'sessions';
  list.hidden = true;
  // Three unlabelled columns of numbers is a puzzle, not a table.
  const head = document.createElement('div');
  head.className = 'session is-head';
  head.innerHTML = '<span class="when">When</span><span class="dur">Length</span><span class="str">Strain</span>';
  list.appendChild(head);
  for (const w of [...sessions].reverse()) {
    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'session';
    row.innerHTML =
      `<span class="when">${escapeHtml(C.longDate(w.date))}</span>` +
      `<span class="dur">${w.durationMin == null ? '—' : escapeHtml(hm(w.durationMin))}</span>` +
      `<span class="str">${w.strain == null ? '—' : escapeHtml(w.strain.toFixed(1))}</span>`;
    row.addEventListener('click', () => go('/session/' + encodeURIComponent(w.id)));
    list.appendChild(row);
  }
  return list;
}

export function renderActivities(state) {
  const p = S.activityProfile(state.days, state.workouts);
  document.querySelectorAll('.heat-months').forEach((n) => n.remove());

  if (!p.rows.length) {
    $('act-year-section').hidden = true;
    $('activities').innerHTML =
      '<p class="lede">Not a single workout on record. Bold. Whoop only knows about a session if you started one on the strap or in the app.</p>';
    $('activities-say').textContent = '';
    return;
  }
  $('act-year-section').hidden = false;
  heatGrid(state.days);

  const hours = Math.round(p.totalMin / 60);
  const bits = [nums(`${p.total} sessions, ${p.rows.length} sports, ${hours} hours of your life.`)];
  if (p.busiestSeason?.n) bits.push(nums(`You come alive in ${p.busiestSeason.label.toLowerCase()}.`));
  if (p.hardest && p.hardest.cost < -2) {
    bits.push(nums(`${titled(p.hardest.sport)} is the one that wrecks you: ${Math.abs(p.hardest.cost).toFixed(1)} recovery points gone the next morning.`));
  }
  if (p.kindest && p.kindest.cost > 1 && p.kindest !== p.hardest) {
    bits.push(nums(`${titled(p.kindest.sport)} is the one you get away with.`));
  }
  $('activities-say').innerHTML = bits.join(' ');

  const bySport = new Map();
  for (const w of state.workouts) {
    if (!bySport.has(w.sport)) bySport.set(w.sport, []);
    bySport.get(w.sport).push(w);
  }

  $('activities').replaceChildren(...p.rows.map((r) => {
    const block = document.createElement('div');
    block.className = 'sport';
    const costText = r.cost == null
      ? 'too few to judge'
      : nums(`${r.cost >= 0 ? '+' : '−'}${Math.abs(r.cost).toFixed(1)}`);
    const costClass = r.cost == null ? '' : r.cost < -2 ? 'dn' : r.cost > 1 ? 'up' : '';

    const head = document.createElement('button');
    head.type = 'button';
    head.className = 'sport-head';
    head.setAttribute('aria-expanded', 'false');
    head.innerHTML =
      `<h3>${escapeHtml(r.sport)}</h3>` +
      `<span class="n">${nums(r.n + (r.n === 1 ? ' session' : ' sessions'))}</span>` +
      '<span class="caret" aria-hidden="true"></span>';

    const meta = document.createElement('div');
    meta.innerHTML =
      `<p class="verdict-line ${costClass}">${escapeHtml(S.activityVerdict(r, p))}</p>` +
      '<dl>' +
      `<div><dt>Time</dt><dd>${nums(hm(r.totalMin))}</dd></div>` +
      `<div><dt>Typical</dt><dd>${nums(r.avgMin ? `${Math.round(r.avgMin)} min` : '—')}</dd></div>` +
      `<div><dt>Strain</dt><dd>${nums(r.avgStrain != null ? r.avgStrain.toFixed(1) : '—')}</dd></div>` +
      `<div><dt>Next day</dt><dd class="${costClass}">${costText}</dd></div>` +
      `<div><dt>Peak</dt><dd>${escapeHtml(r.peakMonth)}</dd></div>` +
      `<div><dt>Last</dt><dd>${nums(C.longDate(r.last))}</dd></div>` +
      '</dl>';

    const list = sessionList(bySport.get(r.sport) || []);
    head.addEventListener('click', () => {
      const open = block.classList.toggle('is-open');
      list.hidden = !open;
      head.setAttribute('aria-expanded', String(open));
    });

    block.append(head, meta, list);
    return block;
  }));
}

/** One session, in full. Reached from a sport, and it leads back to its day. */
export function renderSession(state, id) {
  const w = state.workouts.find((x) => String(x.id) === String(id));
  if (!w) return false;
  const day = state.days.find((d) => d.date === w.date);
  const next = state.days.find((d) => d.date === new Date(Date.parse(w.date + 'T00:00:00Z') + 86400000).toISOString().slice(0, 10));

  const clock = (iso) => {
    const t = Date.parse(iso);
    if (Number.isNaN(t) || !day?.tz) return '—';
    const shifted = new Date(t + offsetMin(day.tz) * 60000);
    return String(shifted.getUTCHours()).padStart(2, '0') + ':' + String(shifted.getUTCMinutes()).padStart(2, '0');
  };

  $('ses-date').textContent = C.longDate(w.date);
  $('ses-title').textContent = titled(w.sport);
  $('ses-strain').innerHTML = w.strain == null ? '—' : nums(w.strain.toFixed(1)) + '<small>strain</small>';

  const chip = $('ses-chip');
  const all = state.workouts.filter((x) => x.sport === w.sport && Number.isFinite(x.strain));
  const rank = all.length > 1 && Number.isFinite(w.strain)
    ? [...all].sort((a, b) => b.strain - a.strain).findIndex((x) => x.id === w.id) + 1
    : null;
  chip.className = 'chip' + (rank === 1 ? ' is-up' : '');
  // A session that came in through Apple Health has no strain and never will.
  // Saying where it came from explains the row of dashes below; "Not scored"
  // would read as something having gone wrong.
  chip.textContent = rank
    ? `${rank} of ${all.length} hardest ${titled(w.sport)}`
    : w.source ? `From ${w.source} · Whoop missed this one` : 'Not scored';

  const cost = next && Number.isFinite(next.recovery) ? next.recovery : null;
  $('ses-say').innerHTML = cost == null
    ? 'No recovery score the next morning, so there is nothing to charge this session against.'
    : nums(`You woke up the next day at ${Math.round(cost)}%.`) +
      (day && Number.isFinite(day.recovery)
        ? nums(` You went in on ${Math.round(day.recovery)}%.`)
        : '');

  const kcal = w.kilojoule ? Math.round(w.kilojoule * 0.239006) : null;
  $('ses-facts').innerHTML = [
    ['Started', clock(w.start)],
    ['Ended', clock(w.end)],
    ['Duration', w.durationMin == null ? '—' : hm(w.durationMin)],
    ['Strain', w.strain == null ? '—' : w.strain.toFixed(1)],
    ['Calories', kcal == null ? '—' : kcal + ' kcal'],
    ['Avg HR', w.avgHr == null ? '—' : w.avgHr + ' bpm'],
    ['Max HR', w.maxHr == null ? '—' : w.maxHr + ' bpm'],
    ['Distance', w.distanceM == null ? '—' : (w.distanceM / 1000).toFixed(2) + ' km'],
    ['Day strain', day?.strain == null ? '—' : day.strain.toFixed(1)],
    ['Next morning', cost == null ? '—' : Math.round(cost) + '%'],
    ['Recorded by', w.source || 'Whoop']
  ].map(([k, v]) => `<div><dt>${escapeHtml(k)}</dt><dd>${nums(v)}</dd></div>`).join('');

  $('ses-day').querySelector('.sub').innerHTML = nums(`Everything else that happened on ${C.longDate(w.date)}`);
  $('ses-day').dataset.date = w.date;
  return true;
}

/** "+05:30" -> 330. Local copy: this file must not depend on the data layer. */
function offsetMin(offset) {
  const m = String(offset).match(/^([+-])(\d{2}):?(\d{2})$/);
  if (!m) return 0;
  return (m[1] === '-' ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3]));
}

/* ----------------------------------------------------------------- records -- */

export function renderRecords(state) {
  const r = S.records(state.days, state.workouts);
  // A one-day streak reads as nonsense written as "3 Jun → 3 Jun".
  const span = (s) => (!s.from ? null : s.from === s.to ? C.longDate(s.from) : `${C.longDate(s.from)} — ${C.longDate(s.to)}`);
  const items = [
    ['Best recovery', r.bestRecovery && Math.round(r.bestRecovery.recovery), '%', r.bestRecovery && C.longDate(r.bestRecovery.date), r.bestRecovery?.date],
    ['Worst recovery', r.worstRecovery && Math.round(r.worstRecovery.recovery), '%', r.worstRecovery && C.longDate(r.worstRecovery.date), r.worstRecovery?.date],
    ['Longest sleep', r.longestSleep && hm(r.longestSleep.asleepMin), '', r.longestSleep && C.longDate(r.longestSleep.date), r.longestSleep?.date],
    ['Shortest sleep', r.shortestSleep && hm(r.shortestSleep.asleepMin), '', r.shortestSleep && C.longDate(r.shortestSleep.date), r.shortestSleep?.date],
    ['Highest strain', r.highestStrain && r.highestStrain.strain.toFixed(1), '', r.highestStrain && C.longDate(r.highestStrain.date), r.highestStrain?.date],
    ['Lowest resting HR', r.lowestRhr && r.lowestRhr.rhr, 'bpm', r.lowestRhr && C.longDate(r.lowestRhr.date), r.lowestRhr?.date],
    ['Highest HRV', r.highestHrv && Math.round(r.highestHrv.hrv), 'ms', r.highestHrv && C.longDate(r.highestHrv.date), r.highestHrv?.date],
    ['Longest green streak', r.greenStreak.length || null, r.greenStreak.length === 1 ? 'day' : 'days', span(r.greenStreak), r.greenStreak.from],
    ['Longest 7h+ run', r.sleepStreak.length || null, r.sleepStreak.length === 1 ? 'night' : 'nights', span(r.sleepStreak), r.sleepStreak.from],
    ['Best week', r.bestWeek && Math.round(r.bestWeek.value), '%', r.bestWeek && span({ from: r.bestWeek.from, to: r.bestWeek.to }), r.bestWeek?.from],
    ['Hardest workout', r.hardestWorkout && r.hardestWorkout.strain.toFixed(1), '', r.hardestWorkout && `${r.hardestWorkout.sport} · ${C.longDate(r.hardestWorkout.date)}`, r.hardestWorkout?.date],
    ['Longest workout', r.longestWorkout && r.longestWorkout.durationMin, 'min', r.longestWorkout && `${r.longestWorkout.sport} · ${C.longDate(r.longestWorkout.date)}`, r.longestWorkout?.date]
  ];

  $('records').replaceChildren(...items.map(([k, v, unit, when, date]) => {
    // A record with a day behind it is a way into that day. One without is
    // just a line of type, and must not pretend otherwise.
    const node = document.createElement(date ? 'button' : 'div');
    node.className = 'record' + (v == null ? ' is-empty' : '');
    if (date) {
      node.type = 'button';
      node.addEventListener('click', () => go('/day/' + date));
    }
    node.innerHTML =
      `<span class="k">${escapeHtml(k)}</span>` +
      `<span class="v num">${v == null ? '—' : escapeHtml(String(v)) + (unit ? `<small>${escapeHtml(unit)}</small>` : '')}</span>` +
      `<span class="w">${when ? escapeHtml(when) : 'nothing on record yet'}</span>`;
    return node;
  }));
}
