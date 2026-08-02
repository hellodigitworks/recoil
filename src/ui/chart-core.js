// Chart primitives: the SVG canvas, the animation contract, and date labels.
//
// Everything animates through the Web Animations API rather than a transition
// kicked off from requestAnimationFrame. The element's base style is always the
// finished state, so a chart rendered in a backgrounded tab is still correct
// when you look at it.

const NS = 'http://www.w3.org/2000/svg';
const EASE = 'cubic-bezier(.22,.61,.36,1)';
export const reduceMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

export function el(tag, attrs = {}, text) {
  const node = document.createElementNS(NS, tag);
  for (const k in attrs) if (attrs[k] != null) node.setAttribute(k, attrs[k]);
  if (text != null) node.textContent = text;
  return node;
}

export function mount(container, height) {
  const width = Math.max(240, Math.round(container.getBoundingClientRect().width) || 320);
  const svg = el('svg', { viewBox: `0 0 ${width} ${height}`, width: '100%', role: 'img', focusable: 'false' });
  // Pin the height. With height:auto the browser derives it from the viewBox
  // ratio, so a container measured at zero renders hundreds of pixels tall.
  svg.style.height = height + 'px';
  container.replaceChildren(svg);
  return { svg, width, height };
}

export function play(node, frames, { duration = 520, delay = 0 } = {}) {
  if (reduceMotion() || typeof node.animate !== 'function') return;
  node.animate(frames, { duration, delay, easing: EASE, fill: 'backwards' });
}

export function animatePath(path) {
  const len = path.getTotalLength();
  if (!len || !Number.isFinite(len)) return;
  path.style.strokeDasharray = String(len);
  play(path, [{ strokeDashoffset: len }, { strokeDashoffset: 0 }], { duration: 900 });
}

/** Scale a shape in from nothing, pinned to an edge. */
export function grow(node, origin, i = 0) {
  node.style.transformBox = 'fill-box';
  node.style.transformOrigin = origin === 'bottom' ? '50% 100%' : origin === 'right' ? '100% 50%' : '0% 50%';
  play(node, [{ transform: `${origin === 'bottom' ? 'scaleY' : 'scaleX'}(0)` }, { transform: 'none' }], { delay: i * 22 });
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "26 JUL". Built by hand so it cannot pick up the locale's punctuation. */
export function shortDate(iso) {
  const t = Date.parse(iso + 'T00:00:00Z');
  if (Number.isNaN(t)) return iso;
  const d = new Date(t);
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()].toUpperCase()}`;
}

export function longDate(iso) {
  const t = Date.parse(iso + 'T00:00:00Z');
  if (Number.isNaN(t)) return iso;
  const d = new Date(t);
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()].toUpperCase()} ${d.getUTCFullYear()}`;
}

