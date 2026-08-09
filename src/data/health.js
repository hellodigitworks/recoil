// Where the Apple Health rows live, and how they join the Whoop ones.
//
// IndexedDB rather than localStorage, which the Whoop cache already fills a
// good part of. A decade of daily rows is small, but "small" and "fits beside
// everything else in a 5 MB box" are different claims, and an import that
// silently fails to save at the end is the worst possible outcome.
//
// Nothing here ever leaves the device.

import { HEALTH_FIELDS, msOf } from './health-parse.js';

const DB_NAME = 'recoil';
const DB_VERSION = 1;
const STORE = 'health';
const KEY = 'apple';

/** Two workouts this close together are the same session seen twice. */
const SAME_SESSION_MS = 20 * 60 * 1000;

function openDb() {
  return new Promise((resolve, reject) => {
    if (!('indexedDB' in self)) { reject(new Error('This browser has no local database.')); return; }
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE)) request.result.createObjectStore(STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('Could not open the local database.'));
  });
}

function transact(mode, run) {
  return openDb().then((db) => new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const request = run(tx.objectStore(STORE));
    tx.oncomplete = () => { db.close(); resolve(request ? request.result : undefined); };
    tx.onerror = () => { db.close(); reject(tx.error || new Error('The local database refused that.')); };
  }));
}

/** @returns {Promise<{days:object, workouts:Array, sources:Array, counts:object, importedAt:string}|null>} */
export function loadHealth() {
  return transact('readonly', (store) => store.get(KEY)).then((v) => v || null).catch(() => null);
}

export function saveHealth(payload) {
  return transact('readwrite', (store) => store.put(payload, KEY));
}

export function clearHealth() {
  return transact('readwrite', (store) => store.delete(KEY)).catch(() => {});
}

/**
 * A fresh export laid over whatever is already held.
 *
 * Not a straight replace. The export is complete for every day it covers, so it
 * wins outright on those dates and on the workout list. But an export made last
 * night knows nothing about today, and the Shortcut may already have sent it —
 * replacing the store would throw that day away every time you re-export.
 */
export function mergeImport(result, existing = null) {
  const days = { ...((existing && existing.days) || {}), ...result.days };
  const dates = Object.keys(days).sort();
  return {
    ...result,
    days,
    first: dates[0] || null,
    last: dates[dates.length - 1] || null,
    sources: [...new Set([...(result.sources || []), ...((existing && existing.sources) || [])])]
  };
}

/** @returns {Promise<object>} the store as it stands after the import. */
export async function saveImport(result) {
  const health = { ...mergeImport(result, await loadHealth()), importedAt: new Date().toISOString() };
  await saveHealth(health);
  return health;
}

/* --------------------------------------------------------------- merging -- */

const dayKeys = (health) => (health && health.days ? Object.keys(health.days) : []);

/**
 * Whoop workouts win. An Apple one is only kept when nothing Whoop recorded
 * covers the same stretch of time, which is how a Strava ride done without the
 * strap shows up without every session appearing twice.
 */
function gapWorkouts(whoopWorkouts, appleWorkouts, from, to) {
  const byDate = new Map();
  for (const w of whoopWorkouts) {
    const start = Date.parse(w.start);
    const end = Date.parse(w.end);
    if (!Number.isFinite(start)) continue;
    if (!byDate.has(w.date)) byDate.set(w.date, []);
    byDate.get(w.date).push([start, Number.isFinite(end) ? end : start]);
  }

  const shifted = (date, days) =>
    new Date(Date.parse(date + 'T00:00:00Z') + days * 86400000).toISOString().slice(0, 10);

  const kept = [];
  for (const w of appleWorkouts) {
    // Outside the Whoop history there is nothing to show it against, and it
    // would stretch every chart and streak in the app to reach it.
    if (from && w.date < from) continue;
    if (to && w.date > to) continue;

    const start = msOf(w.start);
    const end = msOf(w.end);
    if (!Number.isFinite(start)) continue;
    const finish = Number.isFinite(end) ? end : start;

    // A session either side of midnight lands on the neighbouring date.
    const near = [shifted(w.date, -1), w.date, shifted(w.date, 1)]
      .flatMap((d) => byDate.get(d) || []);
    const clash = near.some(([s, e]) =>
      (start < e && finish > s) || Math.abs(start - s) < SAME_SESSION_MS);
    if (!clash) kept.push({ ...w, start: new Date(start).toISOString(), end: Number.isFinite(end) ? new Date(end).toISOString() : null });
  }
  return kept;
}

/**
 * Fold Apple's rows into the Whoop ones.
 *
 * Days Whoop has no record of are dropped rather than added. Every reading in
 * this app is a number against your recovery, so a day with steps and nothing
 * to judge them by has nothing to say, and adding them would put hundreds of
 * blank rows through the records, streaks and charts.
 *
 * @returns {{days:Array, workouts:Array, covered:number, outside:number, added:number}}
 */
export function mergeHealth(days, workouts, health) {
  if (!health || !health.days || !days.length) {
    return { days, workouts, covered: 0, outside: 0, added: 0 };
  }
  const from = days[0].date;
  const to = days[days.length - 1].date;

  let covered = 0;
  const merged = days.map((d) => {
    const extra = health.days[d.date];
    if (!extra) return d;
    covered += 1;
    return { ...d, ...extra };
  });

  const outside = dayKeys(health).filter((date) => date < from || date > to).length;
  const gaps = gapWorkouts(workouts, health.workouts || [], from, to);

  // Fold the gap-fillers into the per-day counts, or Activities shows a session
  // the day it belongs to says does not exist.
  if (gaps.length) {
    const index = new Map(merged.map((d) => [d.date, d]));
    for (const w of gaps) {
      const row = index.get(w.date);
      if (row) row.workoutCount = (row.workoutCount || 0) + 1;
    }
  }

  const allWorkouts = gaps.length
    ? [...workouts, ...gaps].sort((a, b) => (a.start < b.start ? -1 : 1))
    : workouts;

  return { days: merged, workouts: allWorkouts, covered, outside, added: gaps.length };
}

/** Which of the fields actually carry a number, and on how many days. */
export function fieldCoverage(health) {
  const counts = {};
  for (const row of Object.values((health && health.days) || {})) {
    for (const field of HEALTH_FIELDS) {
      if (Number.isFinite(row[field])) counts[field] = (counts[field] || 0) + 1;
    }
  }
  return counts;
}

/* ------------------------------------------------------ the daily top-up -- */

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * A date that is both the right shape and a day that exists.
 *
 * The shape check alone is not enough: Date.parse happily accepts 2026-02-31
 * and quietly hands back the 3rd of March, which would file a day's numbers
 * under a date the rest of the app has never heard of.
 */
function realDate(date) {
  if (!ISO_DATE.test(date)) return false;
  const t = Date.parse(date + 'T00:00:00Z');
  return Number.isFinite(t) && new Date(t).toISOString().slice(0, 10) === date;
}

/**
 * One or more days handed over by the Shortcut.
 *
 * This is the only place in the app where numbers arrive from outside, so
 * everything is checked: the shape, the date, the field names and that each
 * value is a real finite number. Anything unrecognised is dropped rather than
 * stored, because a bad row here would quietly poison a correlation later.
 *
 * @returns {{days:object, count:number}} only what survived
 */
export function sanitiseDaily(input) {
  const rows = Array.isArray(input) ? input : [input];
  const days = {};
  let count = 0;
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue;
    const date = String(row.date || row.d || '');
    if (!realDate(date)) continue;
    const clean = {};
    for (const field of HEALTH_FIELDS) {
      const value = Number(row[field]);
      if (row[field] != null && row[field] !== '' && Number.isFinite(value)) clean[field] = value;
    }
    if (!Object.keys(clean).length) continue;
    days[date] = { ...(days[date] || {}), ...clean };
    count += 1;
  }
  return { days, count };
}

/**
 * Merge a day or two over what is already stored. The newer numbers win for the
 * fields they carry and leave the rest of that day alone, so a Shortcut that
 * only sends steps cannot wipe the weight the export brought in.
 */
export async function applyDaily(input) {
  const { days, count } = sanitiseDaily(input);
  if (!count) return { count: 0, health: null };

  const existing = (await loadHealth()) || { days: {}, workouts: [], sources: [], counts: {} };
  for (const [date, row] of Object.entries(days)) {
    existing.days[date] = { ...(existing.days[date] || {}), ...row };
  }
  if (!existing.sources.includes('Shortcut')) existing.sources = [...existing.sources, 'Shortcut'];
  const dates = Object.keys(existing.days).sort();
  existing.first = dates[0] || null;
  existing.last = dates[dates.length - 1] || null;
  existing.updatedAt = new Date().toISOString();

  await saveHealth(existing);
  return { count, health: existing };
}
