// Every line this app says out loud.
//
// The numbers are never softened, never rounded to flatter, never invented. The
// sentence around them is allowed to have a pulse. Nothing here changes a value,
// a threshold or a comparison. It only decides how the app talks about one.
//
// Lines rotate, seeded off the date they describe, so the same day always reads
// the same but two days in a row never do. A health screen you have already read
// the joke on is a health screen you stop reading.

import { hm } from './metrics.js';

/** Stable small hash. Same seed always lands on the same line. */
function hash(seed) {
  let h = 0;
  for (const ch of String(seed)) h = (h * 31 + ch.charCodeAt(0)) | 0;
  return Math.abs(h);
}

/** Deterministic pick. `salt` lets two lines on one screen differ. */
export const pick = (list, seed, salt = '') => list[hash(seed + salt) % list.length];

/* ----------------------------------------------------------------- verdict -- */

// Headline word, then the line under it. The word carries the band colour, so
// it has to survive on its own at a glance.
const VERDICT = {
  green: {
    words: ['Recovered', 'Loaded', 'Green light', 'Fully charged', 'Dangerous'],
    lines: [
      'Your body signed the permission slip. Go use it.',
      'Whatever you did last night, do it again tonight.',
      'This is the version of you other people should be worried about.',
      'Today is yours. Spend it badly.',
      'Green across the board. Go be insufferable about it.'
    ]
  },
  amber: {
    words: ['Middling', 'Half charged', 'Warm', 'Cruising', 'Passable'],
    lines: [
      'Enough in the tank for something honest. Not for something stupid.',
      'Show up. Just do not try to prove anything.',
      'You are fine. Not fabulous. Fine.',
      'Move, but leave a little on the table.',
      'Not your day to be a hero. Still a perfectly good day.'
    ]
  },
  red: {
    words: ['Low', 'Empty', 'Running on fumes', 'Depleted', 'Flat'],
    lines: [
      'Today is for snacks and lying down. Records can wait.',
      'Your body is asking nicely. Listen before it stops asking nicely.',
      'Be a couch. Be an excellent couch.',
      'Nothing to prove today. Rest is the workout.',
      'Push now and you will pay for it twice.'
    ]
  }
};

const NO_SCORE = [
  'Whoop has not made its mind up about you yet. It scores this after your next sleep.',
  'No score yet. Whoop is still thinking about you.',
  'Unscored. Sleep on it, literally.'
];

const DEBT_LINE = [
  (d) => `You are <b>${hm(d)}</b> light. Your body is keeping receipts.`,
  (d) => `<b>${hm(d)}</b> short of what you needed. It noticed.`,
  (d) => `Owing <b>${hm(d)}</b>. That bill comes due eventually.`
];

const SLEPT_ENOUGH = [
  'Sleep did its job. Rare and beautiful.',
  'You actually slept enough. Look at you.',
  'Sleep covered what you needed. No notes.'
];

/**
 * The line under the big ring. `band` is Whoop's own zone, not ours.
 * @param {string} band green | amber | red | none
 * @param {number|null} debtMin positive means short
 * @param {string} seed usually the date, so the day reads the same all day
 */
export function verdict(band, debtMin, seed) {
  const sleepBit = !Number.isFinite(debtMin) ? ''
    : debtMin > 45 ? ' ' + pick(DEBT_LINE, seed, 'debt')(debtMin)
    : ' ' + pick(SLEPT_ENOUGH, seed, 'slept');
  const set = VERDICT[band];
  if (!set) return `<span class="detail">${pick(NO_SCORE, seed, 'none')}</span>`;
  return `<b class="${band}">${pick(set.words, seed, 'w')}</b>` +
    `<span class="detail">${pick(set.lines, seed, 'l')}${sleepBit}</span>`;
}

/* ------------------------------------------------------ one day, one metric -- */

// Said when a day's value sits close enough to your own normal that the gap is
// noise. Direction-free on purpose.
const ON_NORMAL = [
  'Right on your normal. Boringly consistent, which is the whole point.',
  'Textbook you. Nothing to see, which is the good outcome.',
  'Dead on your usual. Your body is nothing if not predictable.'
];

const BETTER = [
  'Better than your usual. Take the win.',
  'Above your normal. Whatever you are doing, keep doing it.',
  'Your body outdid itself here.',
  'That is the direction you want, and you got there.'
];

const WORSE = [
  'Below your usual. Not a crisis, just worth clocking.',
  'Off your normal. One day is a blip, three is a pattern.',
  'Your body was working harder than it likes here.',
  'That is the wrong direction. Nothing a decent night will not fix.'
];

const NEUTRAL_OFF = [
  'Off your usual, which is neither good nor bad. It is just what happened.',
  'Different to your normal. This one is context, not a verdict.',
  'A departure from your usual. Worth knowing, not worth worrying about.'
];

const NO_BASELINE = [
  'No normal to measure this against yet. Give it a month.',
  'Not enough history to say whether this is you or not.',
  'Still learning what normal looks like for you.'
];

const NOT_SCORED = [
  'Nothing recorded for this one.',
  'No number here. Strap off, or Whoop never scored it.',
  'Blank. Whoop has nothing for this.'
];

/**
 * How a single day's value reads against your own recent normal.
 * @param {object} meta METRICS entry
 * @param {number|null} value display units
 * @param {number|null} baseline display units
 * @param {string} seed
 */
export function daySay(meta, value, baseline, seed) {
  if (!Number.isFinite(value)) return pick(NOT_SCORED, seed, meta.field);
  if (!Number.isFinite(baseline)) return pick(NO_BASELINE, seed, meta.field);
  const delta = value - baseline;
  const noise = Math.max(Math.abs(baseline) * 0.04, meta.asTime ? 5 : 0.05);
  if (Math.abs(delta) <= noise) return pick(ON_NORMAL, seed, meta.field);
  if (meta.better === 'neutral') return pick(NEUTRAL_OFF, seed, meta.field);
  const good = meta.better === 'down' ? delta < 0 : delta > 0;
  return pick(good ? BETTER : WORSE, seed, meta.field);
}

/** Where a day ranks in the whole history. Rank 1 is the best of that metric. */
export function rankSay(rank, total, better) {
  if (!rank || !total) return '';
  if (better === 'neutral') return `${ordinal(rank)} highest of your ${total} recorded days.`;
  if (rank === 1) return `Your best ever, out of ${total} recorded days. Frame it.`;
  if (rank === total) return `Your worst ever, out of ${total} recorded days. It happens.`;
  if (rank <= 3) return `${ordinal(rank)} best of your ${total} recorded days. Show off.`;
  const pct = Math.round((rank / total) * 100);
  if (pct <= 10) return `Top ${pct}% of your ${total} recorded days.`;
  if (pct >= 90) return `Bottom ${101 - pct}% of your ${total} recorded days.`;
  return `${ordinal(rank)} of ${total} recorded days. Mid-table.`;
}

export function ordinal(n) {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

/* ------------------------------------------------------------------ nights -- */

const NIGHT_GOOD = [
  'Deep and REM both showed up. That is the night doing real work.',
  'A proper night. Your brain and your body both got paid.',
  'Solid split. Nothing was skipped.'
];

const NIGHT_SHALLOW = [
  'Light-heavy night. Time in bed is not the same as time repairing.',
  'You were horizontal more than you were asleep.',
  'Plenty of hours, not much of the good stuff.'
];

const NIGHT_BROKEN = [
  'Broken up. Something kept pulling you back out.',
  'You spent real time awake in there.',
  'Restless. That awake time is not free.'
];

/** One night, read as a sentence rather than a stack of minutes. */
export function nightSay(row, seed) {
  const asleep = row.asleepMin;
  if (!Number.isFinite(asleep)) return 'No stages recorded for this night.';
  const restorative = (row.deepMin || 0) + (row.remMin || 0);
  const awakeShare = Number.isFinite(row.awakeMin) && row.inBedMin ? row.awakeMin / row.inBedMin : 0;
  if (awakeShare > 0.14) return pick(NIGHT_BROKEN, seed, 'n');
  if (restorative / asleep < 0.38) return pick(NIGHT_SHALLOW, seed, 'n');
  return pick(NIGHT_GOOD, seed, 'n');
}

/* ------------------------------------------------------------ early warning -- */

export const WARN_LEAD = [
  'Three things are pointing the same wrong way.',
  'Your body is flagging something before you feel it.',
  'This is the pattern that shows up before you get ill.'
];

export const WARN_WHY =
  'None of these alone would have said anything. Together they usually mean something is coming, or you have not absorbed what you have been doing to yourself.';
