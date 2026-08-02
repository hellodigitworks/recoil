// Charts that compare groups rather than track time: bucket bars, signed
// deltas, a scatter with its binned mean, and a running ledger.
//
// Same rules as the time charts. No hover tooltips, nothing drawn denser than
// the pixels allow, and every animation through the Web Animations API so the
// base style is the finished state.

import { el, mount, animatePath, grow, reduceMotion, shortDate } from './chart-core.js';

/* -------------------------------------------------------------- bar chart -- */

/**
 * Bucketed comparison. Thin buckets are drawn faded so a bar built on three
 * nights cannot pose as one built on sixty.
 */
export function barChart({ container, rows, height = 180, format, accentBest }) {
  container.style.userSelect = 'none';
  const { svg, width } = mount(container, height);
  const pad = { l: 34, r: 10, t: 16, b: 30 };
  if (!rows.length) {
    svg.appendChild(el('text', { x: width / 2, y: height / 2, 'text-anchor': 'middle', class: 'c-empty' }, 'Not enough data yet'));
    return;
  }

  const vals = rows.map((r) => r.value).filter(Number.isFinite);
  const lo = Math.min(0, ...vals);
  const hi = Math.max(...vals) * 1.1 || 1;
  const Y = (v) => pad.t + (1 - (v - lo) / (hi - lo)) * (height - pad.t - pad.b);
  const maxN = Math.max(...rows.map((r) => r.n || 1));
  const best = accentBest ? Math.max(...vals) : null;

  svg.appendChild(el('line', { x1: pad.l, x2: width - pad.r, y1: Y(lo), y2: Y(lo), class: 'c-grid' }));

  const slot = (width - pad.l - pad.r) / rows.length;
  const bw = Math.max(6, Math.min(44, slot * 0.6));
  rows.forEach((r, i) => {
    if (!Number.isFinite(r.value)) return;
    const x = pad.l + i * slot + (slot - bw) / 2;
    const y = Y(r.value), h = Math.max(1, Y(lo) - Y(r.value));
    const isBest = best != null && r.value === best;
    const rect = el('rect', {
      x, y, width: bw, height: h, rx: Math.min(8, bw / 2),
      class: 'c-bar' + (isBest ? ' is-best' : ''),
      // Everything is one ink. The best bar is the solid one, and the rest fade
      // with how few nights they were built from, so weight carries both the
      // ranking and the sample size without a second colour.
      opacity: isBest ? 1 : 0.26 + 0.32 * ((r.n || 1) / maxN)
    });
    svg.appendChild(rect);
    grow(rect, 'bottom', i);
    svg.appendChild(el('text', { x: x + bw / 2, y: height - 16, 'text-anchor': 'middle', class: 'c-axis' }, r.label));
    svg.appendChild(el('text', { x: x + bw / 2, y: height - 4, 'text-anchor': 'middle', class: 'c-axis c-faint' }, 'n ' + (r.n || 0)));
    if (format) svg.appendChild(el('text', { x: x + bw / 2, y: y - 6, 'text-anchor': 'middle', class: 'c-val' }, format(r.value)));
  });
}

/** Signed horizontal bars around a zero line. Workout impact. */
export function deltaBars({ container, rows, format }) {
  container.style.userSelect = 'none';
  const rowH = 34;
  const height = Math.max(80, rows.length * rowH + 16);
  const { svg, width } = mount(container, height);
  if (!rows.length) {
    svg.appendChild(el('text', { x: width / 2, y: height / 2, 'text-anchor': 'middle', class: 'c-empty' }, 'Need 3+ sessions of a sport to judge it'));
    return;
  }
  // Three columns: sport, bar, value. The value column is reserved up front or
  // a long bar runs straight under its own number.
  const labelW = Math.min(104, width * 0.30);
  const valueW = 78;
  const zone = Math.max(60, width - labelW - valueW - 12);
  const mid = labelW + zone / 2;
  const max = Math.max(...rows.map((r) => Math.abs(r.delta || 0)), 1);

  svg.appendChild(el('line', { x1: mid, x2: mid, y1: 6, y2: height - 6, class: 'c-ref' }));
  rows.forEach((r, i) => {
    const y = 10 + i * rowH;
    const w = (Math.abs(r.delta) / max) * (zone / 2);
    const positive = r.delta >= 0;
    const rect = el('rect', {
      x: positive ? mid : mid - w, y, width: Math.max(2, w), height: rowH - 14, rx: 6,
      class: 'c-bar ' + (positive ? 'is-good' : 'is-bad')
    });
    svg.appendChild(rect);
    grow(rect, positive ? 'left' : 'right', i);
    svg.appendChild(el('text', { x: labelW - 10, y: y + rowH / 2 - 3, 'text-anchor': 'end', class: 'c-axis' }, r.sport.toUpperCase()));
    svg.appendChild(el('text', { x: width - 6, y: y + rowH / 2 - 3, 'text-anchor': 'end', class: 'c-val' }, format(r)));
  });
}

const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/**
 * One bar per day across a week or a month, with the period average behind it.
 *
 * A week gets its weekday and date under each bar and its value above; a month
 * has too many days for that, so it labels only the ends and the value is left
 * to the readout.
 *
 * Drag across it to read a day, tap one to open it — the same two gestures the
 * time chart uses, so a chart never behaves differently from the one before it.
 */
export function dayBars({ container, rows, field, scale = 1, unit, height = 240, format, average, readout, label, idle, onPick }) {
  container.style.userSelect = 'none';
  const { svg, width } = mount(container, height);
  const pad = { l: 34, r: 10, t: 22, b: unit === 'W' ? 34 : 22 };
  if (readout) readout.textContent = idle || '';
  if (!rows.length) {
    svg.appendChild(el('text', { x: width / 2, y: height / 2, 'text-anchor': 'middle', class: 'c-empty' }, 'Nothing recorded in this window'));
    if (readout) readout.textContent = 'No days in this window';
    return;
  }
  const vals = rows.map((r) => (r[field] == null ? null : r[field] * scale));
  const finite = vals.filter(Number.isFinite);
  if (!finite.length) {
    svg.appendChild(el('text', { x: width / 2, y: height / 2, 'text-anchor': 'middle', class: 'c-empty' }, 'Nothing scored in this window'));
    if (readout) readout.textContent = `${rows.length} days, none of them scored`;
    return;
  }
  const hi = Math.max(...finite) * 1.12;
  const Y = (v) => pad.t + (1 - v / hi) * (height - pad.t - pad.b);

  svg.appendChild(el('line', { x1: pad.l, x2: width - pad.r, y1: Y(0), y2: Y(0), class: 'c-grid' }));
  svg.appendChild(el('text', { x: pad.l - 8, y: Y(hi * 0.9) + 3.5, 'text-anchor': 'end', class: 'c-axis' }, String(Math.round(hi * 0.9))));

  if (Number.isFinite(average)) {
    svg.appendChild(el('line', { x1: pad.l, x2: width - pad.r, y1: Y(average), y2: Y(average), class: 'c-ref' }));
  }

  const slot = (width - pad.l - pad.r) / rows.length;
  const bw = Math.max(2, Math.min(unit === 'W' ? 34 : 12, slot * 0.62));
  const showEvery = unit === 'W' ? 1 : Math.ceil(rows.length / 6);

  rows.forEach((r, i) => {
    const v = vals[i];
    const x = pad.l + i * slot + (slot - bw) / 2;
    if (Number.isFinite(v)) {
      const y = Y(v), h = Math.max(1, Y(0) - Y(v));
      const rect = el('rect', { x, y, width: bw, height: h, rx: Math.min(5, bw / 2), class: 'c-bar' });
      svg.appendChild(rect);
      grow(rect, 'bottom', i);
      if (unit === 'W' && format) {
        svg.appendChild(el('text', { x: x + bw / 2, y: y - 6, 'text-anchor': 'middle', class: 'c-val' }, format(v)));
      }
    }
    if (i % showEvery === 0) {
      const d = new Date(Date.parse(r.date + 'T00:00:00Z'));
      if (unit === 'W') {
        svg.appendChild(el('text', { x: x + bw / 2, y: height - 18, 'text-anchor': 'middle', class: 'c-axis' }, DOW[d.getUTCDay()]));
        svg.appendChild(el('text', { x: x + bw / 2, y: height - 5, 'text-anchor': 'middle', class: 'c-axis c-faint' }, String(d.getUTCDate())));
      } else {
        svg.appendChild(el('text', { x: x + bw / 2, y: height - 5, 'text-anchor': 'middle', class: 'c-axis' }, String(d.getUTCDate())));
      }
    }
  });

  /* ------------------- read a day, or open it ------------------- */

  const guide = el('line', { y1: pad.t, y2: height - pad.b, class: 'c-guide', opacity: 0 });
  svg.appendChild(guide);
  const hit = el('rect', { x: 0, y: 0, width, height, fill: 'transparent', class: 'c-hit' });
  svg.appendChild(hit);

  let at = -1;
  let tap = null;
  const rest = () => { guide.setAttribute('opacity', 0); if (readout) readout.textContent = idle || ''; };

  const scrubAt = (clientX) => {
    const box = svg.getBoundingClientRect();
    const px = ((clientX - box.left) / box.width) * width;
    let i = Math.floor((px - pad.l) / slot);
    i = Math.max(0, Math.min(rows.length - 1, i));
    at = i;
    const x = pad.l + i * slot + slot / 2;
    guide.setAttribute('x1', x); guide.setAttribute('x2', x); guide.setAttribute('opacity', 0.45);
    if (readout && label) readout.textContent = label(vals[i], rows[i]);
  };

  hit.addEventListener('pointerdown', (ev) => {
    hit.setPointerCapture?.(ev.pointerId);
    tap = { x: ev.clientX, y: ev.clientY, t: ev.timeStamp };
    scrubAt(ev.clientX);
  });
  hit.addEventListener('pointermove', (ev) => {
    if (ev.pointerType === 'mouse' && !ev.buttons) { scrubAt(ev.clientX); return; }
    if (tap && (Math.abs(ev.clientX - tap.x) > 7 || Math.abs(ev.clientY - tap.y) > 7)) tap = null;
    scrubAt(ev.clientX);
  });
  const release = (ev) => {
    if (tap && onPick && ev.timeStamp - tap.t < 400 && at >= 0) {
      const row = rows[at];
      tap = null;
      rest();
      onPick(row);
      return;
    }
    tap = null;
    rest();
  };
  hit.addEventListener('pointerup', release);
  hit.addEventListener('pointercancel', rest);
  hit.addEventListener('pointerleave', (ev) => { if (ev.pointerType === 'mouse') rest(); });
}

/**
 * Scatter with a binned mean drawn over it. Every raw pair stays visible so the
 * spread is honest, and the heavy line is what the eye should follow.
 *
 * @param {object} o
 * @param {Array<{x:number,y:number}>} o.points
 * @param {Array<{key:number,value:number,n:number}>} o.bins  bucket means, x in the same units
 * @param {number} [o.reference]  horizontal line, e.g. your overall average
 * @param {number} [o.threshold]  vertical line, e.g. where the cost begins
 */
export function scatterChart({ container, points, bins, reference, threshold, height = 220, xLabel, yLabel }) {
  container.style.userSelect = 'none';
  const { svg, width } = mount(container, height);
  const pad = { l: 34, r: 12, t: 14, b: 30 };
  if (!points.length) {
    svg.appendChild(el('text', { x: width / 2, y: height / 2, 'text-anchor': 'middle', class: 'c-empty' }, 'Not enough paired days yet'));
    return;
  }
  const xs = points.map((p) => p.x), ys = points.map((p) => p.y);
  const x0 = Math.min(...xs), x1 = Math.max(...xs) || 1;
  const y0 = Math.min(0, ...ys), y1 = Math.max(...ys);
  const X = (v) => pad.l + ((v - x0) / (x1 - x0 || 1)) * (width - pad.l - pad.r);
  const Y = (v) => pad.t + (1 - (v - y0) / (y1 - y0 || 1)) * (height - pad.t - pad.b);

  for (const t of [0, 1]) {
    const v = y0 + (y1 - y0) * (t ? 0.9 : 0.1);
    svg.appendChild(el('line', { x1: pad.l, x2: width - pad.r, y1: Y(v), y2: Y(v), class: 'c-grid' }));
    svg.appendChild(el('text', { x: pad.l - 8, y: Y(v) + 3.5, 'text-anchor': 'end', class: 'c-axis' }, String(Math.round(v))));
  }
  if (Number.isFinite(reference)) {
    svg.appendChild(el('line', { x1: pad.l, x2: width - pad.r, y1: Y(reference), y2: Y(reference), class: 'c-ref' }));
  }
  if (Number.isFinite(threshold)) {
    svg.appendChild(el('line', { x1: X(threshold), x2: X(threshold), y1: pad.t, y2: height - pad.b, class: 'c-ref-bad' }));
  }

  for (const p of points) {
    svg.appendChild(el('circle', { cx: X(p.x), cy: Y(p.y), r: 2.2, class: 'c-point', opacity: 0.45 }));
  }

  const usable = (bins || []).filter((b) => Number.isFinite(b.value));
  if (usable.length > 1) {
    const d = usable.map((b, i) => `${i ? 'L' : 'M'}${X(b.key + 1)} ${Y(b.value)}`).join(' ');
    const path = el('path', { d, fill: 'none', class: 'c-line' });
    svg.appendChild(path);
    animatePath(path);
    for (const b of usable) svg.appendChild(el('circle', { cx: X(b.key + 1), cy: Y(b.value), r: 3.4, class: 'c-dot' }));
  }

  if (xLabel) svg.appendChild(el('text', { x: width / 2, y: height - 6, 'text-anchor': 'middle', class: 'c-axis c-faint' }, xLabel));
  if (yLabel) svg.appendChild(el('text', { x: pad.l, y: pad.t - 4, class: 'c-axis c-faint' }, yLabel));
}

/**
 * Running total against a target, with zero marked. Above the line is debt.
 * Filled, because the area between you and zero is the thing being measured.
 */
export function ledgerChart({ container, rows, height = 200, format }) {
  container.style.userSelect = 'none';
  const { svg, width } = mount(container, height);
  const pad = { l: 40, r: 12, t: 14, b: 22 };
  const vals = rows.map((r) => r.cumulative).filter(Number.isFinite);
  if (!vals.length) {
    svg.appendChild(el('text', { x: width / 2, y: height / 2, 'text-anchor': 'middle', class: 'c-empty' }, 'No sleep recorded yet'));
    return;
  }
  const lo = Math.min(0, ...vals), hi = Math.max(0, ...vals);
  const span = hi - lo || 1;
  const X = (i) => pad.l + (rows.length < 2 ? 0.5 : i / (rows.length - 1)) * (width - pad.l - pad.r);
  const Y = (v) => pad.t + (1 - (v - lo + span * 0.08) / (span * 1.16)) * (height - pad.t - pad.b);

  const zero = Y(0);
  const area = rows.map((r, i) => `${i ? 'L' : 'M'}${X(i)} ${Y(r.cumulative)}`).join(' ')
    + ` L${X(rows.length - 1)} ${zero} L${X(0)} ${zero} Z`;
  svg.appendChild(el('path', { d: area, class: 'c-area' }));

  svg.appendChild(el('line', { x1: pad.l, x2: width - pad.r, y1: zero, y2: zero, class: 'c-zero' }));
  svg.appendChild(el('text', { x: pad.l - 8, y: zero + 3.5, 'text-anchor': 'end', class: 'c-axis' }, '0'));
  svg.appendChild(el('text', { x: pad.l - 8, y: Y(hi) + 3.5, 'text-anchor': 'end', class: 'c-axis' }, format ? format(hi) : String(Math.round(hi))));

  const line = el('path', { d: rows.map((r, i) => `${i ? 'L' : 'M'}${X(i)} ${Y(r.cumulative)}`).join(' '), fill: 'none', class: 'c-line' });
  svg.appendChild(line);
  animatePath(line);

  svg.appendChild(el('text', { x: pad.l, y: height - 5, class: 'c-axis' }, shortDate(rows[0].date)));
  svg.appendChild(el('text', { x: width - pad.r, y: height - 5, 'text-anchor': 'end', class: 'c-axis' }, shortDate(rows[rows.length - 1].date)));
}
