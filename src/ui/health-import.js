// Picking the Apple Health export, keeping a copy of it, and refreshing it.
//
// The reading itself happens in a worker (src/data/health-worker.js) so the
// phone stays usable for the several minutes a large export takes. Everything
// here is the part you can see: the progress line, what was found, what was
// not, the backup file, and the one tap that goes and fetches today.

import {
  saveImport, clearHealth, fieldCoverage, loadHealth,
  toBackup, restoreBackup, lastTouched
} from '../data/health.js';
import { listEntries, findEntry, entryStream } from '../data/health-zip.js';
import { parseHealthExport, HEALTH_FIELDS } from '../data/health-parse.js';
import { METRICS } from './metrics.js';
import { longDate } from './charts.js';

const $ = (id) => document.getElementById(id);
const escapeHtml = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
// A run of digits, set in the mono face while the words around it stay in
// Delight. The inner group has to end on a digit: without it, "4440." swallows
// the full stop into the mono span, whose sidebearings then leave what looks
// like a gap before the punctuation.
const nums = (s) => escapeHtml(s).replace(/([+\-−]?\d(?:[\d.,:]*\d)?%?)/g, '<span class="num">$1</span>');

/** Everything the app knows how to read, so absences can be named out loud. */
const READABLE = HEALTH_FIELDS.filter((f) => METRICS[f]);

function setProgress(pct, words) {
  const status = $('health-status');
  let bar = status.querySelector('.progress .bar i');
  if (!bar) {
    status.innerHTML = '<div class="progress is-measured"><div class="bar"><i></i></div><div class="note"></div></div>';
    bar = status.querySelector('.progress .bar i');
  }
  bar.style.width = Math.max(2, Math.min(100, pct)) + '%';
  status.querySelector('.note').innerHTML = nums(words);
}

function setError(message) {
  $('health-status').innerHTML =
    `<div class="notice is-error"><h3>That did not read</h3><p>${escapeHtml(message)}</p></div>`;
}

/**
 * Read the file, preferring a worker.
 *
 * The fallback runs the same code on the main thread. It locks the interface up
 * for the duration, which is bad, but a browser that cannot spawn a module
 * worker should still be able to do the import rather than be told no.
 */
function readExport(file, onProgress) {
  return new Promise((resolve, reject) => {
    let worker;
    try {
      worker = new Worker(new URL('../data/health-worker.js', import.meta.url), { type: 'module' });
    } catch {
      readExportInline(file, onProgress).then(resolve, reject);
      return;
    }
    worker.onmessage = ({ data }) => {
      if (data.type === 'progress') { onProgress(data.pct); return; }
      worker.terminate();
      if (data.type === 'done') resolve(data.result);
      else reject(new Error(data.message));
    };
    worker.onerror = () => {
      worker.terminate();
      readExportInline(file, onProgress).then(resolve, reject);
    };
    worker.postMessage({ file });
  });
}

async function readExportInline(file, onProgress) {
  const entries = await listEntries(file);
  const entry = findEntry(entries, '/export.xml') || findEntry(entries, 'export.xml');
  if (!entry) throw new Error('No export.xml inside that zip. Pick the file Health gave you, not one you unzipped.');
  const total = entry.uncompressedSize || 0;
  return parseHealthExport(await entryStream(file, entry), {
    onProgress: (chars) => onProgress(total ? Math.min(99, Math.floor((chars / total) * 100)) : 0)
  });
}

/* ---------------------------------------------------------------- report -- */

const list = (names) => names.length <= 1
  ? names.join('')
  : names.slice(0, -1).join(', ') + ' and ' + names[names.length - 1];

/**
 * A tile label mid-sentence. Lowercased, unless it carries a capital of its
 * own past the first letter, which is what keeps "BMI" and "VO2 max" from
 * coming out as "bmi" and "vo2 max".
 */
const spoken = (field) => {
  const { label } = METRICS[field];
  return /[A-Z]/.test(label.slice(1)) ? label : label.toLowerCase();
};

/**
 * What is held, and what is missing.
 *
 * The empty half matters as much as the full one. An iPhone with no watch
 * records steps and almost nothing else, and being told that plainly is better
 * than wondering why the caffeine chart never appeared.
 */
export function renderHealth(health, fit = {}) {
  const facts = $('health-facts');
  const note = $('health-note');
  const has = !!(health && health.days && Object.keys(health.days).length);

  $('act-health-clear').hidden = !has;
  // Nothing to back up before there is anything to lose.
  $('health-keep-block').hidden = !has;
  // The Shortcut block stands on its own: its whole job is naming a Shortcut,
  // which you do before the first top-up rather than after it.
  $('health-shortcut-block').hidden = !hasShortcuts();

  if (!has) {
    facts.hidden = true;
    note.hidden = true;
    return;
  }

  const coverage = fieldCoverage(health);
  const found = READABLE.filter((f) => coverage[f]);
  const missing = READABLE.filter((f) => !coverage[f]);
  const dates = Object.keys(health.days).sort();

  facts.hidden = false;
  facts.innerHTML = [
    ['Days read', String(dates.length)],
    ['Oldest', longDate(dates[0])],
    ['Newest', longDate(dates[dates.length - 1])],
    ['Matched to Whoop', String(fit.covered ?? 0)],
    ['Outside that range', String(fit.outside ?? 0)],
    ['Sessions Whoop missed', String(fit.added ?? 0)],
    ['Numbers found', `${found.length} of ${READABLE.length}`],
    ['Last updated', agoWords(lastTouched(health))],
    ['Written by', health.sources && health.sources.length ? health.sources.slice(0, 3).join(', ') : '—']
  ].map(([k, v]) => `<div><dt>${escapeHtml(k)}</dt><dd>${nums(v)}</dd></div>`).join('');

  const lines = [];
  if (found.length) lines.push(`Reading ${list(found.map(spoken))}.`);
  if (missing.length) {
    lines.push(`Nothing at all for ${list(missing.map(spoken))} — those only exist if an app on your phone writes them, and none did.`);
  }
  if (fit.outside) lines.push(`${fit.outside} days sit outside your Whoop history and are held but not shown, because there is no recovery to read them against.`);
  note.hidden = !lines.length;
  note.innerHTML = nums(lines.join(' '));
}

/* ------------------------------------------------- backup, and refreshing -- */

const SHORTCUT_KEY = 'recoil.v1.shortcut';
const DEFAULT_SHORTCUT = 'Recoil daily';

export const shortcutName = () => localStorage.getItem(SHORTCUT_KEY) || DEFAULT_SHORTCUT;

/**
 * Shortcuts is an Apple app, and `shortcuts://` only goes anywhere on Apple
 * platforms. Offering the button on a Windows laptop would be a button that
 * does nothing, so the check is on the platform rather than on hope.
 */
export const hasShortcuts = () =>
  /iPhone|iPad|iPod|Macintosh/.test(navigator.userAgent) ||
  (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

/** Hand off to Shortcuts. It runs, then opens Recoil again with the numbers. */
export function runShortcut() {
  location.href = 'shortcuts://run-shortcut?name=' + encodeURIComponent(shortcutName());
}

/** "just now", "3h ago", "2 days ago". */
export function agoWords(iso) {
  const t = Date.parse(iso || '');
  if (Number.isNaN(t)) return 'never';
  const mins = Math.round((Date.now() - t) / 60000);
  if (mins < 2) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return days === 1 ? 'yesterday' : `${days} days ago`;
}

const dayGap = (from, to) =>
  Math.round((Date.parse(to + 'T00:00:00Z') - Date.parse(from + 'T00:00:00Z')) / 86400000);

/**
 * How far behind the Apple Health numbers are, said next to the numbers.
 *
 * Measured against the newest Whoop day rather than against the clock, and
 * against the data rather than against when a button was last pressed. What
 * matters is whether the step count on that tile is this morning's, and a
 * restored backup is not fresh just because the restore was.
 *
 * Whoop puts its own sync time on Today. This is the same courtesy for the half
 * of the data that cannot go and refresh itself.
 */
export function renderHealthAge(health, days = []) {
  const line = $('health-age');
  const last = health && health.last;
  if (!last || !days.length) { line.hidden = true; return; }

  const behind = dayGap(last, days[days.length - 1].date);
  line.hidden = false;
  line.classList.toggle('is-old', behind >= 2);
  $('health-age-words').textContent = 'Apple Health · ' + (
    behind <= 0 ? 'up to date'
      : behind === 1 ? 'a day behind'
        : `${behind} days behind`
  );
  // Nothing to press on a platform with no Shortcuts app.
  $('health-age-refresh').hidden = !hasShortcuts();
}

function downloadJson(name, payload) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(payload)], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  // Revoking immediately can beat the download in Safari.
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

let restoreNoteTimer;

/**
 * The outcome of the last backup or restore.
 *
 * Cleared after a while on purpose. This one is about an action you just took,
 * so an error still sitting there tomorrow reads as a standing fault with the
 * app rather than as the file you picked being wrong once.
 */
function setRestoreNote(words, error = false) {
  const status = $('health-restore-status');
  status.innerHTML = error
    ? `<div class="notice is-error"><h3>That did not restore</h3><p>${escapeHtml(words)}</p></div>`
    : `<div class="progress"><div class="note">${nums(words)}</div></div>`;
  clearTimeout(restoreNoteTimer);
  restoreNoteTimer = setTimeout(() => status.replaceChildren(), 12000);
}

/** Say something after a button that otherwise gives no sign it worked. */
function flashLabel(button, word) {
  const original = button.dataset.label || button.textContent;
  button.dataset.label = original;
  button.textContent = word;
  button.disabled = true;
  setTimeout(() => { button.textContent = original; button.disabled = false; }, 1400);
}

/* ------------------------------------------------------------------ wiring -- */

/**
 * @param {{onImported: (health: object|null) => void}} ctx `onImported` gets the
 *   new store, or null after a clear, and is what makes the rest of the app
 *   re-read itself.
 */
export function initHealthImport({ onImported }) {
  const input = $('health-file');
  const restoreInput = $('health-restore-file');
  const nameField = $('shortcut-name');

  $('act-health-pick').addEventListener('click', () => input.click());

  /* -- backup ------------------------------------------------------------ */

  $('act-health-backup').addEventListener('click', async (event) => {
    const health = await loadHealth();
    if (!health || !Object.keys(health.days || {}).length) {
      setRestoreNote('Nothing to back up yet.');
      return;
    }
    const last = health.last || 'health';
    downloadJson(`recoil-health-${last}.json`, toBackup(health));
    flashLabel(event.currentTarget, 'Saved');
  });

  $('act-health-restore').addEventListener('click', () => restoreInput.click());

  restoreInput.addEventListener('change', async () => {
    const file = restoreInput.files && restoreInput.files[0];
    restoreInput.value = '';
    if (!file) return;
    try {
      const health = await restoreBackup(JSON.parse(await file.text()));
      setRestoreNote(`Restored · ${Object.keys(health.days).length} days held`);
      onImported(health);
    } catch (error) {
      setRestoreNote(
        error instanceof SyntaxError ? 'That file is not readable JSON.' : error.message,
        true
      );
    }
  });

  /* -- the Shortcut ------------------------------------------------------ */

  nameField.value = localStorage.getItem(SHORTCUT_KEY) || '';
  nameField.placeholder = DEFAULT_SHORTCUT;
  nameField.addEventListener('change', () => {
    const value = nameField.value.trim();
    if (value) localStorage.setItem(SHORTCUT_KEY, value);
    else localStorage.removeItem(SHORTCUT_KEY);
  });

  $('act-shortcut-run').addEventListener('click', runShortcut);
  $('health-age-refresh').addEventListener('click', runShortcut);

  $('act-health-clear').addEventListener('click', async () => {
    if (!confirm('Forget everything read from Apple Health? Your Whoop history is not touched.')) return;
    await clearHealth();
    $('health-status').replaceChildren();
    onImported(null);
  });

  input.addEventListener('change', async () => {
    const file = input.files && input.files[0];
    // Cleared straight away so picking the same file twice still fires.
    input.value = '';
    if (!file) return;

    const started = Date.now();
    setProgress(2, 'Opening the export');
    try {
      const result = await readExport(file, (pct) => setProgress(pct, `Reading your export · ${pct}%`));
      const health = await saveImport(result);

      const days = Object.keys(result.days).length;
      const seconds = Math.max(1, Math.round((Date.now() - started) / 1000));
      setProgress(100, `Done · ${days} days in ${seconds}s`);
      onImported(health);
    } catch (error) {
      setError(error && error.message ? error.message : 'The file could not be read.');
    }
  });
}
