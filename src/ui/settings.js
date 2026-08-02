// Settings: appearance, what data is held, and getting it back out.
//
// Everything the old Today footer used to shout about lives here instead, so
// the reading screens stay reading screens.

import { longDate } from './charts.js';
import { clearCache, clearTokens } from '../data/sync.js';

const $ = (id) => document.getElementById(id);
const escapeHtml = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const nums = (s) => escapeHtml(s).replace(/([+\-−]?\d[\d.,:]*%?)/g, '<span class="num">$1</span>');

const THEME_KEY = 'recoil.v1.theme';

/** 'system' | 'light' | 'dark'. */
export const theme = () => localStorage.getItem(THEME_KEY) || 'system';

/**
 * Paint the chosen theme. `data-theme` on the root is what the stylesheet keys
 * off; the browser chrome needs telling separately, or a light app sits under a
 * black status bar. On `system` the two media-scoped meta tags in the document
 * do that job, so the explicit one is removed again.
 */
export function applyTheme(next = theme()) {
  const root = document.documentElement;
  if (next === 'system') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', next);

  // A meta tag cannot be disabled, so the media query is what has to stop
  // matching. The original is stashed on the element the first time through.
  document.querySelectorAll('meta[name="theme-color"]:not(#theme-color-fixed)').forEach((m) => {
    if (!m.dataset.media) m.dataset.media = m.getAttribute('media') || 'all';
    m.media = next === 'system' ? m.dataset.media : 'not all';
  });

  let fixed = document.getElementById('theme-color-fixed');
  if (next === 'system') { fixed?.remove(); return; }
  if (!fixed) {
    fixed = document.createElement('meta');
    fixed.id = 'theme-color-fixed';
    fixed.name = 'theme-color';
    document.head.appendChild(fixed);
  }
  fixed.content = next === 'dark' ? '#000000' : '#ffffff';
}

export function setTheme(next) {
  localStorage.setItem(THEME_KEY, next);
  applyTheme(next);
}

/* -------------------------------------------------------------- export -- */

const cell = (v) => {
  if (v == null) return '';
  const s = String(v);
  return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
};

function download(name, rows) {
  const csv = rows.map((r) => r.map(cell).join(',')).join('\n');
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  // Revoking immediately can beat the download in Safari.
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

/** Every number this app holds, one row per day. */
export function exportDays(days) {
  if (!days.length) return false;
  const keys = Object.keys(days[0]).filter((k) => k !== 'tz');
  download(`recoil-days-${days[days.length - 1].date}.csv`, [keys, ...days.map((d) => keys.map((k) => d[k]))]);
  return true;
}

export function exportWorkouts(workouts) {
  if (!workouts.length) return false;
  const keys = Object.keys(workouts[0]);
  const last = workouts[workouts.length - 1].date;
  download(`recoil-workouts-${last}.csv`, [keys, ...workouts.map((w) => keys.map((k) => w[k]))]);
  return true;
}

/* -------------------------------------------------------------- screen -- */

/** Say something after a button that otherwise gives no sign it worked. */
function flash(button, word) {
  const original = button.dataset.label || button.textContent;
  button.dataset.label = original;
  button.textContent = word;
  button.disabled = true;
  setTimeout(() => { button.textContent = original; button.disabled = false; }, 1400);
}

/**
 * @param {object} o
 * @param {object} o.state the live app state, read at render time
 * @param {()=>string} o.ago how long ago the last sync was, in words
 * @param {()=>Promise<any>} o.sync
 * @param {()=>void} o.rebuild throw the cache away and pull it all again
 */
export function initSettings({ state, ago, sync, rebuild }) {
  $('theme').addEventListener('click', (event) => {
    const btn = event.target.closest('button');
    if (!btn) return;
    setTheme(btn.dataset.theme);
    renderSettings({ state, ago });
  });
  $('act-resync').addEventListener('click', (event) => {
    flash(event.currentTarget, 'Syncing…');
    sync().then(() => renderSettings({ state, ago })).catch(() => {});
  });
  $('act-reset').addEventListener('click', () => {
    if (!confirm('Throw away the cached copy of your Whoop data and pull it all again?')) return;
    rebuild();
  });
  $('act-disconnect').addEventListener('click', () => {
    if (!confirm('Forget this Whoop session and the cached history? You will have to log in again.')) return;
    clearCache();
    clearTokens();
    location.replace(location.pathname);
  });
  $('act-export-days').addEventListener('click', (event) =>
    flash(event.currentTarget, exportDays(state.days) ? 'Downloaded' : 'Nothing to export'));
  $('act-export-workouts').addEventListener('click', (event) =>
    flash(event.currentTarget, exportWorkouts(state.workouts) ? 'Downloaded' : 'No workouts'));
}

export function renderSettings({ state, ago }) {
  document.querySelectorAll('#theme button').forEach((b) => b.classList.toggle('is-on', b.dataset.theme === theme()));
  const days = state.days;
  $('set-facts').innerHTML = [
    ['Days held', String(days.length)],
    ['Oldest', days.length ? longDate(days[0].date) : '—'],
    ['Newest', days.length ? longDate(days[days.length - 1].date) : '—'],
    ['Last sync', ago()],
    ['Cycles', String(state.counts.cycle || 0)],
    ['Sleeps', String(state.counts.sleep || 0)],
    ['Workouts', String(state.counts.workout || 0)],
    ['Source', 'Whoop API v2']
  ].map(([k, v]) => `<div><dt>${escapeHtml(k)}</dt><dd>${nums(v)}</dd></div>`).join('');
}
