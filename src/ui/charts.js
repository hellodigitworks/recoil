// Time-series charts: the metric history, sleep stages and bedtimes.
// Comparison charts live in charts-compare.js; primitives in chart-core.js.
//
// Three rules this file exists to enforce:
//   1. No hover tooltips. They do not exist on touch. Charts drive a readout
//      element above them instead, so scrubbing updates text you can read while
//      your thumb is on the glass.
//   2. Never draw more points than the width can show. A year of daily values
//      in 300px is a texture, not a chart, so long ranges collapse to buckets
//      and pinching back in restores the detail.
//   3. Animate through the Web Animations API, never a transition kicked off
//      from requestAnimationFrame, so a chart rendered in a backgrounded tab is
//      still correct.

import { median, bucketBy, bucketSizeFor } from '../data/stats.js';
import { el, mount, play, animatePath, grow, reduceMotion, shortDate, longDate } from './chart-core.js';

export { shortDate, longDate };
export { barChart, deltaBars, scatterChart, ledgerChart, dayBars } from './charts-compare.js';

/* ------------------------------------------------------------- time chart -- */

/**
 * Zoomable time series. Owns its own visible window, so pinching re-renders at
 * a finer bucket size rather than just magnifying pixels.
 *
 * @param {object} o
 * @param {HTMLElement} o.container
 * @param {Array}  o.rows      day rows, ascending
 * @param {string} o.field     key on each row
 * @param {number} [o.scale]   multiplier applied for display (e.g. minutes to hours)
 * @param {number} o.height
 * @param {(v:number,row:any)=>string} o.format
 * @param {HTMLElement} [o.readout]
 * @param {Array}  [o.bands]   meaning bands drawn behind, in display units
 * @param {boolean}[o.showBaseline]
 * @param {string} [o.mark]    ISO date to call out, for "here is the day you picked"
 * @param {boolean}[o.daily]   never bucket. Only for windows short enough that
 *   every day fits, where a bucket median would misreport the marked day.
 * @param {(row:any)=>void} [o.onPick] a tap, as opposed to a drag, opens that
 *   day. Scrubbing is how you read a chart; tapping is how you leave one.
 */
export function timeChart(o) {
  const { container, rows, field, scale = 1, height, format, readout, bands, months, mark, daily = false, showBaseline = true, onPick } = o;
  // Visible window as indices into rows. Reset whenever the data changes.
  let view = { start: 0, end: rows.length };
  const MIN_SPAN = 7;

  container.style.userSelect = 'none';
  container.style.webkitUserSelect = 'none';

  function draw() {
    const { svg, width } = mount(container, height);
    const pad = { l: 38, r: 12, t: 14, b: 22 };
    const plotW = width - pad.l - pad.r;
    const plotH = height - pad.t - pad.b;

    const windowRows = rows.slice(view.start, view.end);
    if (!windowRows.length) return;

    const size = daily ? 1 : bucketSizeFor(windowRows.length, plotW);
    const points = bucketBy(windowRows, size, field)
      .map((r) => ({ row: r, v: r[field] == null ? null : r[field] * scale }));
    const vals = points.map((p) => p.v).filter(Number.isFinite);
    if (!vals.length) {
      svg.appendChild(el('text', { x: width / 2, y: height / 2, 'text-anchor': 'middle', class: 'c-empty' }, 'No data in this range'));
      return;
    }

    // Baseline is a rolling median across the visible points, not the raw days,
    // so it stays smooth at every zoom level.
    const base = showBaseline ? points.map((_, i) => {
      const from = Math.max(0, i - Math.round(30 / size) + 1);
      return median(points.slice(from, i + 1).map((p) => p.v));
    }) : null;

    let lo = Math.min(...vals), hi = Math.max(...vals);
    if (base) { const b = base.filter(Number.isFinite); if (b.length) { lo = Math.min(lo, ...b); hi = Math.max(hi, ...b); } }
    const spread = hi - lo || 1;
    lo -= spread * 0.14; hi += spread * 0.14;

    const X = (i) => pad.l + (points.length < 2 ? 0.5 : i / (points.length - 1)) * plotW;
    const Y = (v) => pad.t + (1 - (v - lo) / (hi - lo)) * plotH;

    for (const b of bands || []) {
      const y1 = Y(Math.min(b.to, hi)), y2 = Y(Math.max(b.from, lo));
      if (y2 > y1) svg.appendChild(el('rect', { x: pad.l, y: y1, width: plotW, height: y2 - y1, fill: b.color, opacity: 0.08 }));
    }

    // Two gridlines. Any more is decoration.
    for (const t of [0, 1]) {
      const v = lo + (hi - lo) * (t ? 0.9 : 0.1);
      svg.appendChild(el('line', { x1: pad.l, x2: width - pad.r, y1: Y(v), y2: Y(v), class: 'c-grid' }));
      svg.appendChild(el('text', { x: pad.l - 8, y: Y(v) + 3.5, 'text-anchor': 'end', class: 'c-axis' }, String(Math.round(v))));
    }

    if (base) {
      let d = '', open = false;
      base.forEach((v, i) => {
        if (!Number.isFinite(v)) { open = false; return; }
        d += (open ? 'L' : 'M') + X(i) + ' ' + Y(v) + ' '; open = true;
      });
      svg.appendChild(el('path', { d, fill: 'none', class: 'c-baseline' }));
    }

    let d = '', open = false;
    points.forEach((p, i) => {
      if (!Number.isFinite(p.v)) { open = false; return; }
      d += (open ? 'L' : 'M') + X(i) + ' ' + Y(p.v) + ' '; open = true;
    });
    // With month averages drawn on top, the daily line is context, not the
    // subject, so it drops back rather than competing with them.
    const line = el('path', { d, fill: 'none', class: 'c-line' + ((months || []).length ? ' is-context' : '') });
    svg.appendChild(line);
    animatePath(line);

    // Month averages drawn over the daily line, each labelled with its change.
    // At six months the daily line is texture; these are the actual story.
    for (const m of months || []) {
      if (!Number.isFinite(m.value)) continue;
      const inMonth = windowRows.map((r, i) => (r.date.slice(0, 7) === m.key ? i : -1)).filter((i) => i >= 0);
      if (!inMonth.length) continue;
      const x1 = X(Math.round(inMonth[0] / size));
      const x2 = X(Math.round(inMonth[inMonth.length - 1] / size));
      const y = Y(m.value);
      svg.appendChild(el('line', { x1, x2, y1: y, y2: y, class: 'c-month' }));
      svg.appendChild(el('text', { x: (x1 + x2) / 2, y: y - 7, 'text-anchor': 'middle', class: 'c-val' }, String(Math.round(m.value))));
      if (m.change != null && Math.abs(m.change) >= 1) {
        svg.appendChild(el('text', {
          x: (x1 + x2) / 2, y: y + 15, 'text-anchor': 'middle',
          class: 'c-val ' + (m.change > 0 ? 'is-up' : 'is-down')
        }, `${m.change > 0 ? '+' : '−'}${Math.abs(m.change).toFixed(0)}%`));
      }
    }

    // The day you arrived from, called out inside its own history. Buckets carry
    // the span they cover, so a marked day still lands on the right point once a
    // long range has collapsed the daily detail.
    if (mark) {
      const mi = points.findIndex((p) => mark <= p.row.date && mark >= (p.row.from || p.row.date));
      if (mi >= 0) {
        const x = X(mi);
        svg.appendChild(el('line', { x1: x, x2: x, y1: pad.t, y2: height - pad.b, class: 'c-mark' }));
        if (Number.isFinite(points[mi].v)) {
          svg.appendChild(el('circle', { cx: x, cy: Y(points[mi].v), r: 4.5, class: 'c-mark-dot' }));
        }
      }
    }

    svg.appendChild(el('text', { x: pad.l, y: height - 6, class: 'c-axis' }, shortDate(windowRows[0].date)));
    svg.appendChild(el('text', { x: width - pad.r, y: height - 6, 'text-anchor': 'end', class: 'c-axis' }, shortDate(windowRows[windowRows.length - 1].date)));
    if (size > 1) {
      svg.appendChild(el('text', { x: width / 2, y: height - 6, 'text-anchor': 'middle', class: 'c-axis c-faint' },
        size >= 7 ? `${size / 7}-WEEK MEDIAN` : `${size}-DAY MEDIAN`));
    }

    const guide = el('line', { y1: pad.t, y2: height - pad.b, class: 'c-guide', opacity: 0 });
    const dot = el('circle', { r: 4, class: 'c-dot', opacity: 0 });
    svg.appendChild(guide); svg.appendChild(dot);

    const hit = el('rect', { x: 0, y: 0, width, height, fill: 'transparent', class: 'c-hit' });
    svg.appendChild(hit);

    // Resting state of the readout. With a marked day the chart is about that
    // day, so it reads that day rather than whatever sits at the right edge.
    const idle = () => {
      const at = mark ? points.find((p) => mark <= p.row.date && mark >= (p.row.from || p.row.date)) : null;
      const p = at && Number.isFinite(at.v) ? at : [...points].reverse().find((q) => Number.isFinite(q.v));
      return p ? format(p.v, p.row) : '';
    };
    if (readout) readout.textContent = idle();

    /* ------- gestures: one pointer scrubs, two pinch and pan ------- */
    const active = new Map();
    let pinch = null;
    // A tap has to be told apart from a drag, or every scrub would navigate.
    let tap = null;
    let at = -1;

    const scrubAt = (clientX) => {
      const box = svg.getBoundingClientRect();
      const px = ((clientX - box.left) / box.width) * width;
      let i = Math.round(((px - pad.l) / plotW) * (points.length - 1));
      i = Math.max(0, Math.min(points.length - 1, i));
      at = i;
      const p = points[i];
      guide.setAttribute('x1', X(i)); guide.setAttribute('x2', X(i)); guide.setAttribute('opacity', 0.45);
      if (Number.isFinite(p.v)) {
        dot.setAttribute('cx', X(i)); dot.setAttribute('cy', Y(p.v)); dot.setAttribute('opacity', 1);
      } else dot.setAttribute('opacity', 0);
      if (readout) readout.textContent = Number.isFinite(p.v) ? format(p.v, p.row) : shortDate(p.row.date) + ' · NO DATA';
    };

    const clearScrub = () => {
      guide.setAttribute('opacity', 0); dot.setAttribute('opacity', 0);
      if (readout) readout.textContent = idle();
    };

    /** Rescale the window about a fraction of its width, then redraw. */
    const zoomTo = (span, anchorFraction) => {
      const total = rows.length;
      span = Math.max(MIN_SPAN, Math.min(total, Math.round(span)));
      const focus = view.start + (view.end - view.start) * anchorFraction;
      let start = Math.round(focus - span * anchorFraction);
      start = Math.max(0, Math.min(total - span, start));
      const next = { start, end: start + span };
      if (next.start === view.start && next.end === view.end) return;
      view = next;
      draw();
    };

    hit.addEventListener('pointerdown', (ev) => {
      hit.setPointerCapture?.(ev.pointerId);
      active.set(ev.pointerId, ev);
      if (active.size === 2) {
        const [a, b] = [...active.values()];
        pinch = { dist: Math.abs(a.clientX - b.clientX) || 1, span: view.end - view.start };
        tap = null;
        clearScrub();
      } else if (active.size === 1) {
        tap = { x: ev.clientX, y: ev.clientY, t: ev.timeStamp };
        scrubAt(ev.clientX);
      }
    });

    hit.addEventListener('pointermove', (ev) => {
      if (!active.has(ev.pointerId)) {
        // Mouse hover with no button down still scrubs; touch needs contact.
        if (ev.pointerType === 'mouse' && !ev.buttons) scrubAt(ev.clientX);
        return;
      }
      active.set(ev.pointerId, ev);
      if (tap && (Math.abs(ev.clientX - tap.x) > 7 || Math.abs(ev.clientY - tap.y) > 7)) tap = null;
      if (active.size >= 2 && pinch) {
        const [a, b] = [...active.values()];
        const dist = Math.abs(a.clientX - b.clientX) || 1;
        const box = svg.getBoundingClientRect();
        const mid = ((a.clientX + b.clientX) / 2 - box.left) / box.width;
        zoomTo(pinch.span * (pinch.dist / dist), Math.max(0, Math.min(1, mid)));
      } else {
        scrubAt(ev.clientX);
      }
    });

    const release = (ev) => {
      active.delete(ev.pointerId);
      if (active.size < 2) pinch = null;
      // Under 400ms and barely moved: that was a tap on a day, not a scrub.
      if (tap && onPick && ev.timeStamp - tap.t < 400 && at >= 0) {
        const picked = points[at];
        tap = null;
        clearScrub();
        onPick(picked.row);
        return;
      }
      tap = null;
      if (active.size === 0) clearScrub();
    };
    hit.addEventListener('pointerup', release);
    hit.addEventListener('pointercancel', release);
    hit.addEventListener('pointerleave', (ev) => { if (ev.pointerType === 'mouse') clearScrub(); });

    // Trackpad pinch arrives as a ctrl-modified wheel event.
    hit.addEventListener('wheel', (ev) => {
      if (!ev.ctrlKey) return;
      ev.preventDefault();
      const box = svg.getBoundingClientRect();
      zoomTo((view.end - view.start) * (1 + ev.deltaY / 200), (ev.clientX - box.left) / box.width);
    }, { passive: false });

    hit.addEventListener('dblclick', () => { view = { start: 0, end: rows.length }; draw(); });
  }

  draw();
  return { reset: () => { view = { start: 0, end: rows.length }; draw(); } };
}

/** Stacked sleep stages, one column per night. */
export function stageChart({ container, rows, height = 200 }) {
  container.style.userSelect = 'none';
  const { svg, width } = mount(container, height);
  const pad = { l: 32, r: 8, t: 12, b: 20 };
  const withSleep = rows.filter((r) => Number.isFinite(r.asleepMin));
  if (!withSleep.length) {
    svg.appendChild(el('text', { x: width / 2, y: height / 2, 'text-anchor': 'middle', class: 'c-empty' }, 'No sleep stages yet'));
    return;
  }
  // Columns thinner than a pixel are noise, so collapse to bucket means.
  const plotW = width - pad.l - pad.r;
  const size = Math.max(1, Math.ceil(rows.length / Math.floor(plotW / 3)));
  const cols = [];
  for (let end = rows.length; end > 0; end -= size) {
    const chunk = rows.slice(Math.max(0, end - size), end);
    cols.unshift({
      date: chunk[chunk.length - 1].date,
      deepMin: median(chunk.map((c) => c.deepMin)) || 0,
      remMin: median(chunk.map((c) => c.remMin)) || 0,
      lightMin: median(chunk.map((c) => c.lightMin)) || 0,
      awakeMin: median(chunk.map((c) => c.awakeMin)) || 0
    });
  }

  const maxT = Math.max(...cols.map((c) => c.deepMin + c.remMin + c.lightMin + c.awakeMin), 60);
  for (const t of [0, 1]) {
    const y = pad.t + (1 - t) * (height - pad.t - pad.b);
    svg.appendChild(el('line', { x1: pad.l, x2: width - pad.r, y1: y, y2: y, class: 'c-grid' }));
    svg.appendChild(el('text', { x: pad.l - 8, y: y + 3.5, 'text-anchor': 'end', class: 'c-axis' }, Math.round((maxT * t) / 60) + 'h'));
  }
  const slot = plotW / cols.length;
  const bw = Math.max(1.5, slot * 0.72);
  cols.forEach((c, i) => {
    let y = height - pad.b;
    const x = pad.l + i * slot + (slot - bw) / 2;
    for (const stage of ['awakeMin', 'lightMin', 'remMin', 'deepMin']) {
      const h = (c[stage] / maxT) * (height - pad.t - pad.b);
      if (h <= 0) continue;
      y -= h;
      svg.appendChild(el('rect', { x, y, width: bw, height: h, class: 'c-stage ' + stage.replace('Min', '') }));
    }
  });
  svg.appendChild(el('text', { x: pad.l, y: height - 5, class: 'c-axis' }, shortDate(rows[0].date)));
  svg.appendChild(el('text', { x: width - pad.r, y: height - 5, 'text-anchor': 'end', class: 'c-axis' }, shortDate(rows[rows.length - 1].date)));
}

/**
 * One night as a single horizontal bar, in the order you actually live it:
 * awake at the top of the stack on the day chart, but read left to right here
 * as deep, REM, light, awake. Widths are real minutes, so a shallow night looks
 * shallow rather than merely shorter.
 */
export function nightStages({ container, row, height = 58 }) {
  const { svg, width } = mount(container, height);
  const parts = [
    { key: 'deep', label: 'Deep', min: row.deepMin },
    { key: 'rem', label: 'REM', min: row.remMin },
    { key: 'light', label: 'Light', min: row.lightMin },
    { key: 'awake', label: 'Awake', min: row.awakeMin }
  ].filter((p) => Number.isFinite(p.min) && p.min > 0);

  if (!parts.length) {
    svg.appendChild(el('text', { x: width / 2, y: height / 2, 'text-anchor': 'middle', class: 'c-empty' }, 'No stages for this night'));
    return;
  }

  const total = parts.reduce((a, p) => a + p.min, 0);
  const barH = 22;
  let x = 0;
  for (const p of parts) {
    const w = (p.min / total) * width;
    const rect = el('rect', { x, y: 4, width: Math.max(1, w), height: barH, class: 'c-stage ' + p.key, rx: 3 });
    svg.appendChild(rect);
    // Only label a slice wide enough to hold its own text, or the labels stack
    // on top of each other and the bar stops being readable.
    if (w > 46) {
      svg.appendChild(el('text', { x: x + w / 2, y: barH + 22, 'text-anchor': 'middle', class: 'c-axis' }, p.label));
      svg.appendChild(el('text', { x: x + w / 2, y: barH + 34, 'text-anchor': 'middle', class: 'c-val' }, hmShort(p.min)));
    }
    x += w;
  }
}

const hmShort = (m) => {
  const h = Math.floor(m / 60);
  const r = Math.round(m % 60);
  return h ? `${h}h ${r}m` : `${r}m`;
};

/** Bedtime scatter. Later nights sit lower. */
export function bedtimeChart({ container, rows, height = 200, readout }) {
  container.style.userSelect = 'none';
  const { svg, width } = mount(container, height);
  const pad = { l: 44, r: 10, t: 14, b: 22 };
  const axis = (m) => (m - 1080 + 1440) % 1440;
  const pts = rows.map((r, i) => ({ i, r, v: r.bedtimeMin == null ? null : axis(r.bedtimeMin) })).filter((p) => p.v != null);
  if (!pts.length) {
    svg.appendChild(el('text', { x: width / 2, y: height / 2, 'text-anchor': 'middle', class: 'c-empty' }, 'No bedtimes yet'));
    return;
  }
  const lo = Math.max(0, Math.min(...pts.map((p) => p.v)) - 40);
  const hi = Math.min(1440, Math.max(...pts.map((p) => p.v)) + 40);
  const X = (i) => pad.l + (rows.length < 2 ? 0.5 : i / (rows.length - 1)) * (width - pad.l - pad.r);
  const Y = (v) => pad.t + ((v - lo) / (hi - lo)) * (height - pad.t - pad.b);

  for (let mark = Math.ceil(lo / 120) * 120; mark <= hi; mark += 120) {
    svg.appendChild(el('line', { x1: pad.l, x2: width - pad.r, y1: Y(mark), y2: Y(mark), class: 'c-grid' }));
    svg.appendChild(el('text', { x: pad.l - 8, y: Y(mark) + 3.5, 'text-anchor': 'end', class: 'c-axis' },
      String(Math.floor(((mark + 1080) % 1440) / 60)).padStart(2, '0') + ':00'));
  }
  const oneAm = axis(60);
  if (oneAm > lo && oneAm < hi) svg.appendChild(el('line', { x1: pad.l, x2: width - pad.r, y1: Y(oneAm), y2: Y(oneAm), class: 'c-ref' }));

  for (const p of pts) {
    svg.appendChild(el('circle', { cx: X(p.i), cy: Y(p.v), r: 2.6, class: 'c-point' + (p.v > oneAm ? ' is-late' : '') }));
  }

  const clock = (m) => String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(Math.round(m % 60)).padStart(2, '0');
  const idle = () => {
    const last = pts[pts.length - 1];
    return `${shortDate(last.r.date)} · ASLEEP ${clock(last.r.bedtimeMin)}`;
  };
  if (readout) readout.textContent = idle();

  const hit = el('rect', { x: 0, y: 0, width, height, fill: 'transparent', class: 'c-hit' });
  svg.appendChild(hit);
  const guide = el('line', { y1: pad.t, y2: height - pad.b, class: 'c-guide', opacity: 0 });
  svg.appendChild(guide);

  const at = (clientX) => {
    const box = svg.getBoundingClientRect();
    let i = Math.round((((clientX - box.left) / box.width) * width - pad.l) / (width - pad.l - pad.r) * (rows.length - 1));
    i = Math.max(0, Math.min(rows.length - 1, i));
    const r = rows[i];
    guide.setAttribute('x1', X(i)); guide.setAttribute('x2', X(i)); guide.setAttribute('opacity', 0.45);
    if (readout) {
      readout.textContent = r.bedtimeMin == null
        ? `${shortDate(r.date)} · NO SLEEP LOGGED`
        : `${shortDate(r.date)} · ASLEEP ${clock(r.bedtimeMin)}` +
          (Number.isFinite(r.recovery) ? ` · RECOVERY ${Math.round(r.recovery)}%` : '');
    }
  };
  hit.addEventListener('pointerdown', (ev) => { hit.setPointerCapture?.(ev.pointerId); at(ev.clientX); });
  hit.addEventListener('pointermove', (ev) => { if (ev.buttons || ev.pointerType !== 'mouse') at(ev.clientX); });
  const off = () => { guide.setAttribute('opacity', 0); if (readout) readout.textContent = idle(); };
  hit.addEventListener('pointerup', off);
  hit.addEventListener('pointercancel', off);
  hit.addEventListener('pointerleave', off);
}

/** The one big number on Today. */
export function recoveryRing({ container, value, band, size = 200 }) {
  const stroke = 9, r = (size - stroke) / 2;
  const svg = el('svg', { viewBox: `0 0 ${size} ${size}`, class: 'ring band-' + band });
  container.querySelector('svg')?.remove();
  container.prepend(svg);
  const c = 2 * Math.PI * r;
  svg.appendChild(el('circle', { cx: size / 2, cy: size / 2, r, fill: 'none', 'stroke-width': stroke, class: 'ring-track' }));
  if (!Number.isFinite(value)) return;
  const filled = c * (1 - Math.max(0, Math.min(100, value)) / 100);
  const arc = el('circle', {
    cx: size / 2, cy: size / 2, r, fill: 'none', 'stroke-width': stroke, 'stroke-linecap': 'round',
    class: 'ring-arc', transform: `rotate(-90 ${size / 2} ${size / 2})`,
    'stroke-dasharray': c, 'stroke-dashoffset': filled
  });
  svg.appendChild(arc);
  play(arc, [{ strokeDashoffset: c }, { strokeDashoffset: filled }], { duration: 1000 });
}

/** Count a number up on first paint. Marks that data arrived. */
export function countUp(node, to, { decimals = 0, duration = 700 } = {}) {
  if (!Number.isFinite(to)) { node.textContent = '—'; return; }
  const fmt = (v) => v.toFixed(decimals);
  node.textContent = fmt(to); // final value first: a frame that never comes still leaves a number
  if (reduceMotion()) return;
  const start = performance.now();
  const step = (now) => {
    const t = Math.min(1, (now - start) / duration);
    node.textContent = fmt(to * (1 - Math.pow(1 - t, 3)));
    if (t < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}
