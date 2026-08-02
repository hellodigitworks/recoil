// Pull to refresh, in words.
//
// No spinner anywhere in this app. Pulling reveals a single line of type that
// says what is happening — Pull, Release, Checking Whoop, Synced — which is the
// same voice the rest of the screens are written in and costs no artwork.
//
// The gesture is claimed from the browser only while it is genuinely a pull:
// finger down at the very top of the scroller, moving down. Anything else, and
// the touch is handed straight back so ordinary scrolling never feels sticky.

/** How far the finger can drag the strip open. */
const MAX = 92;
/** Past this, releasing syncs. */
const TRIP = 60;
/** A trackpad's overscroll is reported in far smaller steps than a finger's. */
const WHEEL_TRIP = 110;

export function initPull({ view, node, word, onRefresh }) {
  let startY = null;
  let dist = 0;
  let busy = false;
  let wheelAt = 0;
  let wheelSum = 0;

  const say = (text) => { word.textContent = text; };
  const open = (px) => { node.style.height = Math.round(px) + 'px'; };

  function settle(delay = 0) {
    node.classList.add('is-settling');
    setTimeout(() => {
      open(0);
      node.classList.remove('is-armed');
      view.classList.remove('is-pulling');
      setTimeout(() => node.classList.remove('is-settling'), 260);
    }, delay);
  }

  function reset() {
    startY = null;
    dist = 0;
    wheelSum = 0;
    settle();
  }

  async function fire() {
    if (busy) return;
    busy = true;
    startY = null;
    wheelSum = 0;
    node.classList.add('is-settling', 'is-armed');
    open(TRIP);
    say('Checking Whoop');
    try {
      const outcome = await onRefresh();
      say(outcome || 'Up to date');
    } catch {
      // The sync path puts the real error on screen itself. This line only has
      // to admit that the pull did not work.
      say('Could not reach Whoop');
    }
    // Long enough to read the word, short enough not to be in the way.
    settle(900);
    setTimeout(() => { busy = false; }, 1200);
  }

  /* ------------------------------------------------------------- touch -- */

  // The entry screen hides the strip and has nothing to sync. Pulling there
  // would fire a request against a session that does not exist yet.
  const off = () => node.offsetParent === null;

  view.addEventListener('touchstart', (event) => {
    if (busy || off() || event.touches.length !== 1 || view.scrollTop > 0) { startY = null; return; }
    startY = event.touches[0].clientY;
    dist = 0;
    node.classList.remove('is-settling');
  }, { passive: true });

  view.addEventListener('touchmove', (event) => {
    if (startY == null || busy) return;
    const raw = event.touches[0].clientY - startY;
    // Scrolled away, or pulling upwards: not our gesture.
    if (raw <= 0 || view.scrollTop > 0) {
      if (dist > 0) reset(); else startY = null;
      return;
    }
    // Resistance, so the strip never tracks the finger one for one.
    dist = Math.min(MAX, raw * 0.5);
    if (dist > 2) {
      event.preventDefault();
      view.classList.add('is-pulling');
    }
    open(dist);
    node.classList.toggle('is-armed', dist >= TRIP);
    say(dist >= TRIP ? 'Release' : 'Pull');
  }, { passive: false });

  const lift = () => {
    if (startY == null || busy) return;
    if (dist >= TRIP) fire();
    else reset();
  };
  view.addEventListener('touchend', lift);
  view.addEventListener('touchcancel', reset);

  /* ---------------------------------------------------------- trackpad -- */

  // On a laptop there is no pull, so overscrolling upwards stands in for it.
  // The run has to be continuous: a pause of a quarter second ends it, which
  // keeps a flick at the top of a list from syncing by accident.
  view.addEventListener('wheel', (event) => {
    if (busy || off() || event.ctrlKey || view.scrollTop > 0 || event.deltaY >= 0) return;
    const now = event.timeStamp;
    if (now - wheelAt > 250) wheelSum = 0;
    wheelAt = now;
    wheelSum += -event.deltaY;
    node.classList.remove('is-settling');
    const shown = Math.min(MAX, (wheelSum / WHEEL_TRIP) * TRIP);
    open(shown);
    node.classList.toggle('is-armed', wheelSum >= WHEEL_TRIP);
    say(wheelSum >= WHEEL_TRIP ? 'Let go to sync' : 'Keep pulling');
    if (wheelSum >= WHEEL_TRIP * 1.6) fire();
    clearTimeout(view._pullIdle);
    view._pullIdle = setTimeout(() => {
      if (busy) return;
      if (wheelSum >= WHEEL_TRIP) fire(); else reset();
    }, 260);
  }, { passive: true });

  return { refresh: fire };
}
