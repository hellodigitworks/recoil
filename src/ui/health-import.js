// Picking the Apple Health export, and saying what came out of it.
//
// The reading itself happens in a worker (src/data/health-worker.js) so the
// phone stays usable for the several minutes a large export takes. Everything
// here is the part you can see: the progress line, what was found, and — just
// as important — what was not.

import { saveImport, clearHealth, fieldCoverage } from '../data/health.js';
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
  $('act-health-clear').hidden = !health;

  if (!health || !health.days || !Object.keys(health.days).length) {
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

/* ------------------------------------------------------------------ wiring -- */

/**
 * @param {{onImported: (health: object|null) => void}} ctx `onImported` gets the
 *   new store, or null after a clear, and is what makes the rest of the app
 *   re-read itself.
 */
export function initHealthImport({ onImported }) {
  const input = $('health-file');

  $('act-health-pick').addEventListener('click', () => input.click());

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
