// Recoil — screens and wiring.
//
// Today is the root and snaps through three full-height panes. Every number on
// it opens its own screen. Text is Inter Tight; only numerals are set in the mono
// face, which is why strings go through `nums()` before they reach innerHTML.
//
// Navigation is real history with no visible URL — see router.js.

import * as S from '../data/stats.js';
import * as C from './charts.js';
import { METRICS, CORE_TILES, MORE_TILES, fmtValue, deltaUnit, deltaNoise, hm } from './metrics.js';
import { sync, derive, hasCache, clearCache, isConnected } from '../data/sync.js';
import { startAuth, handleCallback, describeSyncError } from './connect.js';
import { renderPatterns, renderRecords, renderActivities, renderSession } from './analysis.js';
import { renderMetric, renderDayMetric, setSleepTarget } from './screens-metric.js';
import { initRouter, currentPath, direction, go, back } from './router.js';
import { initPull } from './pull.js';
import { applyTheme, initSettings, renderSettings } from './settings.js';
import * as V from './voice.js';

const $ = (id) => document.getElementById(id);
// `trend` is the window the metric screen is showing: unit, and how many
// periods back from the newest day.
//
// `selectedDay` is the day you last chose, and it survives everything: opening a
// metric, coming back, leaving the day screen and tapping the date again. Losing
// the day you picked the moment you looked at anything on it was the single most
// annoying thing about this app.
const state = {
  days: [], workouts: [], syncedAt: null, counts: {},
  // A month, not a week. Landing on the current week means landing on however
  // many days have happened since Monday, which on a Monday is one bar.
  trend: { unit: 'M', offset: 0 },
  selectedDay: null
};

/**
 * Attach values this app computes rather than reads. Whoop has its own sleep
 * consistency score; `rhythm` is ours, from the spread of your bed and wake
 * times, and both are shown so neither has to be taken on faith.
 */
function decorate(result) {
  const rhythm = S.rhythmSeries(result.days, 7);
  result.days.forEach((d, i) => { d.rhythm = rhythm[i].score; });
  return result;
}

const escapeHtml = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/**
 * Wrap runs of digits so they render in JetBrains Mono while the surrounding
 * words stay in Inter Tight. Escapes first — sport names come from Whoop, not us.
 */
const nums = (s) => escapeHtml(s).replace(/([+\-−]?\d[\d.,:]*%?)/g, '<span class="num">$1</span>');

/* ------------------------------------------------------------------ chrome -- */

/**
 * Publish the scroll area's real height. Snap panes and single-screen views
 * size off this rather than a viewport unit, so the header and the safe area
 * are already accounted for.
 */
function measurePane() {
  const h = $('view').clientHeight;
  if (h > 0) document.documentElement.style.setProperty('--pane-h', h + 'px');
}

/**
 * Keep that measurement honest.
 *
 * A resize listener is not enough: on a phone the address bar collapses and
 * expands as you scroll, which changes the usable height without always firing
 * a resize you can trust the timing of. ResizeObserver sees every change.
 */
function watchPaneHeight() {
  if (typeof ResizeObserver !== 'function') return;
  let last = 0;
  new ResizeObserver(() => {
    const h = $('view').clientHeight;
    if (!h || Math.abs(h - last) < 2) return;
    last = h;
    document.documentElement.style.setProperty('--pane-h', h + 'px');
  }).observe($('view'));
}

/**
 * Register the offline shell.
 *
 * Deliberately not awaited and deliberately silent. Offline support is a bonus
 * on top of a working app, so a browser that refuses it, or a page served over
 * plain http where it is unavailable, must still boot normally.
 */
function registerWorker() {
  if (!('serviceWorker' in navigator)) return;
  navigator.serviceWorker.register('/sw.js').catch(() => {});
}

/**
 * @param {string} id
 * @param {{back?: string|false, snap?: boolean}} o `back` is the path the arrow
 *   falls back to on a cold load, so a metric opened from a day returns to that
 *   day rather than dumping you home.
 */
function show(id, { back: backTo = false, snap = false } = {}) {
  const screen = $(id);
  document.querySelectorAll('.screen').forEach((s) => s.classList.remove('is-active', 'slide-fwd', 'slide-back'));
  $('back').hidden = !backTo;
  $('back').dataset.to = backTo || '/';
  // Screens that carry their own date do not get the header's. Two dates
  // disagreeing in one view reads as a bug even when both are correct.
  $('today-date').hidden = ['screen-day', 'screen-daymetric', 'screen-session', 'screen-connect'].includes(id);
  // The entry screen is the whole screen. Its wordmark is the only one.
  document.body.classList.toggle('entry', id === 'screen-connect');
  $('view').classList.toggle('is-snapping', snap);
  $('view').scrollTop = 0;
  if (screen) {
    screen.classList.add('is-active', direction() === 'back' ? 'slide-back' : 'slide-fwd');
  }
  // The entry screen hides the header, which changes how tall the scroll area
  // is. Re-measure now or that screen centres against a stale height.
  measurePane();
}

function notice(target, { title, body, detail, hint, error = false }) {
  const box = document.createElement('div');
  box.className = 'notice' + (error ? ' is-error' : '');
  box.innerHTML = '<h3></h3><div class="msg"></div>';
  box.querySelector('h3').textContent = title;
  box.querySelector('.msg').textContent = body || '';
  if (hint) { const p = document.createElement('p'); p.className = 'hint'; p.textContent = hint; box.appendChild(p); }
  if (detail) { const pre = document.createElement('pre'); pre.textContent = detail; box.appendChild(pre); }
  target.replaceChildren(box);
  // #sync-status sits above the scroller, so writing into it changes how much
  // room the panes have. Re-measure here rather than waiting on the observer:
  // a pane sized against the old height is exactly the dead strip this
  // arrangement exists to remove.
  measurePane();
  return box;
}

/** Attach the way out of a dead end. An error with no next move is half a screen. */
function addOut(box, label, onClick) {
  let outs = box.querySelector('.outs');
  if (!outs) { outs = document.createElement('div'); outs.className = 'outs'; box.appendChild(outs); }
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'ghost';
  btn.textContent = label;
  btn.addEventListener('click', onClick);
  outs.appendChild(btn);
  return btn;
}

/* ------------------------------------------------------------------- today -- */

/**
 * The line under the ring. Voice picks the words, seeded off the date, so one
 * day always reads the same and two days running never do.
 */
function verdictFor(day) {
  return V.verdict(S.band(day?.recovery), day?.sleepDebtMin, day?.date || '');
}

/**
 * @param {string} key metric
 * @param {object} day the row being described
 * @param {Array} recent the days its baseline is drawn from
 * @param {string} [from] when set, the tile belongs to that day and opens that
 *   day's own detail instead of the whole-history trend.
 */
function buildTile(key, day, recent, from) {
  const meta = METRICS[key];
  const value = meta.get(day);
  const baseline = S.median(recent.map(meta.get));

  const btn = document.createElement('button');
  btn.className = 'tile';
  btn.type = 'button';
  btn.innerHTML =
    `<span class="k">${escapeHtml(meta.label)}</span>` +
    `<span class="v">${nums(fmtValue(meta, value))}${meta.unit ? `<small>${escapeHtml(meta.unit)}</small>` : ''}</span>` +
    '<span class="d"></span>';
  btn.addEventListener('click', () => go(from ? `/day/${from}/${key}` : '/m/' + key));

  const d = btn.querySelector('.d');
  if (!Number.isFinite(baseline)) {
    d.textContent = 'NO BASELINE YET';
  } else if (!Number.isFinite(value)) {
    // Today is not scored yet. Showing your normal beats blaming the baseline.
    d.innerHTML = nums(`NORMAL ${fmtValue(meta, baseline)}${meta.unit}`);
  } else {
    const delta = value - baseline;
    d.innerHTML = nums(`${fmtValue(meta, delta, { signed: true })}${deltaUnit(meta)} VS NORMAL`);
    if (meta.better !== 'neutral' && Math.abs(delta) > deltaNoise(meta)) {
      d.classList.add((meta.better === 'down' ? delta < 0 : delta > 0) ? 'up' : 'dn');
    }
  }
  return btn;
}

function renderToday() {
  const days = state.days;
  const today = days[days.length - 1];
  if (!today) return;

  $('today-date').textContent = C.longDate(today.date);
  C.recoveryRing({ container: $('hero-ring'), value: today.recovery, band: S.band(today.recovery) });
  C.countUp($('hero-value'), today.recovery);
  $('hero-unit').hidden = !Number.isFinite(today.recovery);
  $('hero-verdict').innerHTML = verdictFor(today);

  renderWarning();
  renderTonight(days);
  const recent = S.lastDays(days, 30);
  $('tiles-core').replaceChildren(...CORE_TILES.map((k) => buildTile(k, today, recent)));
  $('tiles-more').replaceChildren(...MORE_TILES.map((k) => buildTile(k, today, recent)));

  const scored = days.filter((d) => Number.isFinite(d.recovery)).length;
  // The year-on-year finding only exists once there is a second year to
  // compare against, so the count is counted rather than asserted.
  const findings = 5 + (S.versusLastYear(days, 'recovery') ? 1 : 0);
  $('link-patterns').querySelector('.sub').innerHTML = nums(`${findings} findings · ${scored} scored days`);
  const sports = new Set(state.workouts.map((w) => w.sport)).size;
  $('link-activities').querySelector('.sub').innerHTML = nums(`${state.workouts.length} sessions · ${sports} sports`);
  const years = Math.max(1, Math.round(days.length / 365));
  $('link-records').querySelector('.sub').innerHTML = nums(`${days.length} days · ${years} ${years === 1 ? 'year' : 'years'} of bests`);
  renderSynced();
}

/**
 * The one number on Today you can act on rather than only read.
 *
 * Whoop tells you what you owe. It does not tell you what time to be asleep to
 * stop owing it. This works back from your own recent wake times, and says so,
 * because a bedtime derived from an alarm you never set is worthless.
 */
function renderTonight(days) {
  const box = $('tonight');
  const t = S.bedtimeTonight(days);
  box.hidden = !t;
  if (!t) return;

  $('tonight-time').textContent = S.clockLabel(t.asleepBy % 1440);
  const need = hm(t.needMin);
  const wake = S.clockLabel(t.wakeMin);
  const owed = t.debtMin > 0 ? ` You are ${hm(t.debtMin)} down, so this is the night to stop the rot.` : '';
  $('tonight-why').innerHTML = nums(
    `You need ${need} and you actually get up around ${wake}, judged on your last ${t.nights} nights.${owed}`
  );
}

/**
 * The one thing in this app that speaks without being asked. It only fires when
 * resting heart rate, HRV and respiratory rate are all moving the wrong way at
 * once, for two days running.
 */
function renderWarning() {
  const warn = S.earlyWarning(state.days);
  const box = $('warning');
  box.hidden = !warn;
  if (!warn) return;
  const seed = state.days[state.days.length - 1]?.date || '';
  box.innerHTML =
    '<span class="eyebrow">Heads up</span>' +
    `<p>${nums(`${V.pick(V.WARN_LEAD, seed, 'warn')} ${warn.days} days running now.`)}</p>` +
    '<ul>' +
    `<li>${nums(`Resting HR up ${warn.rhrUp.toFixed(1)} bpm on your normal`)}</li>` +
    `<li>${nums(`HRV down ${warn.hrvDown.toFixed(1)} ms`)}</li>` +
    `<li>${nums(`Breathing up ${warn.respUp.toFixed(2)} a minute`)}</li>` +
    '</ul>' +
    `<p class="why">${escapeHtml(V.WARN_WHY)}</p>`;
}

const agoWords = () => {
  if (!state.syncedAt) return 'never synced';
  const mins = Math.round((Date.now() - Date.parse(state.syncedAt)) / 60000);
  if (mins < 1) return 'synced just now';
  if (mins < 60) return `synced ${mins} min ago`;
  const hours = Math.round(mins / 60);
  return hours < 24 ? `synced ${hours}h ago` : `synced ${Math.round(hours / 24)}d ago`;
};

function renderSynced() {
  const days = state.days;
  const range = days.length ? `${C.longDate(days[0].date)} — ${C.longDate(days[days.length - 1].date)}` : 'nothing yet';
  $('synced-line').innerHTML = nums(`${days.length} days · ${range} · ${agoWords()}`);
}

/* --------------------------------------------------------------------- day -- */

const ALL_TILES = [...CORE_TILES, ...MORE_TILES];
const shiftDate = (iso, days) => new Date(Date.parse(iso + 'T00:00:00Z') + days * 86400000).toISOString().slice(0, 10);

/** Clamp a requested date to the history you actually have, and remember it. */
function resolveDay(dateStr) {
  const days = state.days;
  const last = days[days.length - 1].date;
  const wanted = /^\d{4}-\d{2}-\d{2}$/.test(dateStr || '') ? dateStr : (state.selectedDay || last);
  const date = wanted > last ? last : wanted < days[0].date ? days[0].date : wanted;
  state.selectedDay = date;
  return date;
}

/**
 * Any single day, reachable from the date in the header. Getting back to a
 * specific past day is the thing the Whoop app is worst at.
 */
function renderDay(dateStr) {
  const days = state.days;
  if (!days.length) return;
  const first = days[0].date;
  const last = days[days.length - 1].date;
  const date = resolveDay(dateStr);

  const input = $('day-input');
  input.min = first;
  input.max = last;
  input.value = date;
  $('day-shown').textContent = C.longDate(date);
  // Stepping is bounded by the data you actually have, not by the calendar.
  $('day-prev').disabled = date <= first;
  $('day-next').disabled = date >= last;

  const i = days.findIndex((d) => d.date === date);
  const day = i === -1 ? null : days[i];
  $('day-body').hidden = !day;
  $('day-empty').hidden = !!day;
  if (!day) {
    // A blank day is a dead end unless it offers somewhere to go.
    const known = [...days].reverse().find((d) => d.date < date) || days[days.length - 1];
    $('day-empty-last').textContent = `Go to ${C.longDate(known.date)}`;
    $('day-empty-last').onclick = () => go('/day/' + known.date, { replace: true });
    return;
  }

  // Baseline is the 30 days up to that date, so a day in March is judged
  // against the shape you were in during March.
  const recent = days.slice(Math.max(0, i - 29), i + 1);

  C.recoveryRing({ container: $('day-ring'), value: day.recovery, band: S.band(day.recovery) });
  C.countUp($('day-value'), day.recovery);
  $('day-unit').hidden = !Number.isFinite(day.recovery);
  $('day-verdict').innerHTML = verdictFor(day);
  // Tiles here belong to this day, so they open this day rather than the trend.
  $('day-tiles').replaceChildren(...ALL_TILES.map((k) => buildTile(k, day, recent, date)));
}

/* ------------------------------------------------------------------ router -- */

function route() {
  const path = currentPath();
  if (!isConnected()) { show('screen-connect'); return; }
  if (!state.days.length) { show('screen-loading'); return; }

  // One metric on one chosen day. Matched before the plain day route, and its
  // back arrow returns to that day rather than dumping you back on today.
  const dayMetric = path.match(/^\/day\/(\d{4}-\d{2}-\d{2})\/(\w+)$/);
  if (dayMetric) {
    state.selectedDay = dayMetric[1];
    show('screen-daymetric', { back: '/day/' + dayMetric[1] });
    renderDayMetric(state, dayMetric[1], dayMetric[2]);
    return;
  }
  const day = path.match(/^\/day(?:\/([\d-]+))?$/);
  if (day) { show('screen-day', { back: '/' }); renderDay(day[1]); return; }
  const metric = path.match(/^\/m\/(\w+)$/);
  if (metric) { show('screen-metric', { back: '/' }); renderMetric(state, metric[1]); return; }
  const session = path.match(/^\/session\/(.+)$/);
  if (session) {
    show('screen-session', { back: '/activities' });
    if (!renderSession(state, decodeURIComponent(session[1]))) go('/activities', { replace: true });
    return;
  }
  if (path === '/patterns') { show('screen-patterns', { back: '/' }); renderPatterns(state); return; }
  if (path === '/activities') { show('screen-activities', { back: '/' }); renderActivities(state); return; }
  if (path === '/records') { show('screen-records', { back: '/' }); renderRecords(state); return; }
  if (path === '/settings') { show('screen-settings', { back: '/' }); renderSettings(settingsCtx); return; }
  show('screen-today', { snap: true });
  renderToday();
}

/* -------------------------------------------------------------------- boot -- */

const statusNotice = (o) => notice($('sync-status'), o);

/** @returns {Promise<string>} the word the pull indicator should land on. */
/** Empty the status strip and give the panes their room back. */
function clearStatus() {
  $('sync-status').replaceChildren();
  measurePane();
}

async function runSync({ silent }) {
  const status = $('sync-status');
  if (!silent) {
    status.innerHTML = '<div class="progress"><div class="bar"><i></i></div><div class="note">Connecting to Whoop…</div></div>';
    measurePane();
  }
  const note = status.querySelector('.note');
  const before = state.days.length;
  try {
    const result = await sync((p) => {
      if (!note) return;
      const label = p.phase === 'backfill' ? 'Pulling your full history' : 'Checking for new days';
      note.innerHTML = nums(`${label} · ${p.collection} · ${p.records} records` + (p.reachedBack ? ` · back to ${p.reachedBack}` : ''));
    });
    Object.assign(state, decorate(result));
    if (result.saved) clearStatus();
    else {
      const box = statusNotice({ title: 'Loaded, but the cache is full', body: 'Your browser would not store the whole history, so the oldest records were dropped from the cache. Everything on screen is still real.' });
      addOut(box, 'Dismiss', clearStatus);
    }
    route();
    const added = state.days.length - before;
    return added > 0 ? `${added} new ${added === 1 ? 'day' : 'days'}` : 'Up to date';
  } catch (err) {
    describeSyncError(err, statusNotice);
    const box = $('sync-status').querySelector('.notice');
    if (box) addOut(box, 'Try again', () => runSync({ silent: false }));
    // With nothing cached there is no history to read, so "Reading your
    // history" under an error card would be a lie. Offer the way back in.
    if (state.days.length) route();
    else show('screen-connect');
    throw err;
  }
}

/** What the Settings screen needs from here, and nothing more. */
const settingsCtx = {
  state,
  ago: () => agoWords().replace('synced ', ''),
  sync: () => runSync({ silent: false }),
  rebuild: () => {
    clearCache();
    state.days = []; state.workouts = [];
    runSync({ silent: false }).catch(() => {});
  }
};

/** W → M → 6M → 1Y → All → W. */
function cycleRange() {
  const order = S.TREND_UNITS.map((u) => u.key);
  const at = order.indexOf(state.trend.unit);
  // Changing the unit returns you to the most recent period; staying at an
  // offset would land you somewhere arbitrary.
  state.trend = { unit: order[(at + 1) % order.length], offset: 0 };
  const btn = $('range');
  btn.classList.remove('is-ticking');
  void btn.offsetWidth; // restart the animation on a repeated tap
  btn.classList.add('is-ticking');
  route();
}

/** 1-5 jump between screens, arrows walk, Escape goes back. */
function onKey(event) {
  if (event.metaKey || event.ctrlKey || event.altKey) return;
  const tag = event.target.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || event.target.isContentEditable) return;
  const path = currentPath();

  if (event.key === 'Escape') { if (!$('back').hidden) back($('back').dataset.to); return; }
  const jump = { 1: '/', 2: '/patterns', 3: '/activities', 4: '/records', 5: '/settings' }[event.key];
  if (jump) { event.preventDefault(); go(jump); return; }

  const step = event.key === 'ArrowLeft' ? -1 : event.key === 'ArrowRight' ? 1 : 0;
  if (!step || !state.days.length) return;
  event.preventDefault();

  // On the metric screen the arrows walk periods, because that is what the
  // stepper under the chart does. Everywhere else they walk days.
  if (/^\/m\//.test(path)) {
    if (state.trend.unit === 'ALL') return;
    state.trend.offset = Math.min(0, state.trend.offset + step);
    route();
    return;
  }
  const from = state.selectedDay || state.days[state.days.length - 1].date;
  const next = shiftDate(from, step);
  if (next < state.days[0].date || next > state.days[state.days.length - 1].date) return;
  const metric = path.match(/^\/day\/[\d-]+\/(\w+)$/);
  go(metric ? `/day/${next}/${metric[1]}` : '/day/' + next, { replace: /^\/day/.test(path) });
}

function wireChrome() {
  $('connect-btn').addEventListener('click', () => startAuth(statusNotice));
  $('back').addEventListener('click', () => back($('back').dataset.to || '/'));
  $('brand').addEventListener('click', () => go('/settings'));
  $('hero-ring').addEventListener('click', () => go('/m/recovery'));
  // No date in the path, so this reopens whichever day you last had open.
  $('today-date').addEventListener('click', () => go('/day'));
  $('dm-full').addEventListener('click', () => go('/m/' + $('dm-full').dataset.key));
  $('ses-day').addEventListener('click', () => go('/day/' + $('ses-day').dataset.date));
  $('day-input').addEventListener('change', (e) => { if (e.target.value) go('/day/' + e.target.value, { replace: true }); });
  $('day-prev').addEventListener('click', () => go('/day/' + shiftDate($('day-input').value, -1), { replace: true }));
  $('day-next').addEventListener('click', () => go('/day/' + shiftDate($('day-input').value, 1), { replace: true }));
  $('link-patterns').addEventListener('click', () => go('/patterns'));
  $('link-activities').addEventListener('click', () => go('/activities'));
  $('link-records').addEventListener('click', () => go('/records'));
  $('link-settings').addEventListener('click', () => go('/settings'));
  $('range').addEventListener('click', cycleRange);
  $('period-prev').addEventListener('click', () => { state.trend.offset -= 1; route(); });
  $('period-next').addEventListener('click', () => { state.trend.offset = Math.min(0, state.trend.offset + 1); route(); });
  $('sleep-target').addEventListener('click', (e) => {
    const btn = e.target.closest('button');
    if (!btn) return;
    setSleepTarget(btn.dataset.min);
    route();
  });

  initSettings(settingsCtx);

  window.addEventListener('keydown', onKey);
  let t;
  const onResize = () => { clearTimeout(t); t = setTimeout(() => { measurePane(); route(); }, 200); };
  window.addEventListener('resize', onResize);
  window.addEventListener('orientationchange', onResize);
}

async function boot() {
  applyTheme();
  wireChrome();
  initRouter(route);
  initPull({
    view: $('view'),
    node: $('pull'),
    word: $('pull-word'),
    onRefresh: () => runSync({ silent: true })
  });
  measurePane();
  watchPaneHeight();
  registerWorker();
  await handleCallback(statusNotice);
  if (!isConnected()) { show('screen-connect'); return; }

  // Cached data paints immediately; the network catches it up afterwards.
  if (hasCache()) {
    Object.assign(state, decorate(derive()));
    route();
    runSync({ silent: true }).catch(() => {});
  } else {
    show('screen-loading');
    await runSync({ silent: false }).catch(() => {});
  }
}

boot();
