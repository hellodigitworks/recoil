// Navigation without a visible URL.
//
// The app used to live in `location.hash`, which meant the browser's back
// button left the app entirely and every screen wrote its path into the address
// bar. This keeps real history entries — so back, forward and the phone's
// edge-swipe all work — while the address bar never changes. Paths are carried
// in `history.state`, not in the URL.
//
// Nothing here is deep-linkable, by design: a Recoil screen is a place inside a
// session, not a document with an address.

/** Current internal path, e.g. `/day/2026-07-27/hrv`. */
let path = '/';

/** How many entries this app has pushed. Below one, there is nothing to pop. */
let pushes = 0;

/** 'fwd' or 'back'. Screens read this to pick their entry animation. */
let dir = 'fwd';

let onRoute = () => {};

const depth = (p) => (p === '/' ? 0 : p.split('/').filter(Boolean).length);

export const currentPath = () => path;
export const direction = () => dir;

export function initRouter(handler) {
  onRoute = handler;
  history.replaceState({ recoil: '/' }, '', location.pathname + location.search);
  window.addEventListener('popstate', (event) => {
    const next = (event.state && event.state.recoil) || '/';
    dir = depth(next) <= depth(path) ? 'back' : 'fwd';
    path = next;
    pushes = Math.max(0, pushes - 1);
    onRoute();
  });
}

/**
 * @param {string} next
 * @param {{replace?: boolean, back?: boolean}} [o] `back` forces the reverse
 *   animation for a move that is sideways in depth but backwards in feel.
 */
export function go(next, { replace = false, back = false } = {}) {
  if (next === path) { onRoute(); return; }
  dir = back || depth(next) < depth(path) ? 'back' : 'fwd';
  path = next;
  if (replace) {
    history.replaceState({ recoil: next }, '', location.pathname + location.search);
  } else {
    history.pushState({ recoil: next }, '', location.pathname + location.search);
    pushes += 1;
  }
  onRoute();
}

/**
 * The back arrow. Pops a real history entry where there is one, so the arrow
 * and the browser's own button stay in step; falls back to a known screen on a
 * cold load where nothing has been pushed yet.
 */
export function back(fallback = '/') {
  if (pushes > 0) history.back();
  else go(fallback, { back: true });
}
