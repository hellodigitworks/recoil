// Tokens, cache and the paged pull.
//
// Raw Whoop records are what gets cached, not the normalised rows. If the
// mapping in normalize.js ever changes, everything re-derives from cache with
// no re-download.

import { mergeById, normalize } from './normalize.js';

const TOKEN_KEY = 'recoil.v1.tokens';
const RAW_KEY = 'recoil.v1.raw';
const LEGACY_TOKEN_KEY = 'whoop_token';

const COLLECTIONS = [
  { name: 'cycle', idKey: 'id' },
  { name: 'recovery', idKey: 'cycle_id' },
  { name: 'sleep', idKey: 'id' },
  { name: 'workout', idKey: 'id' }
];

/** Re-sync a few days back so records Whoop rescored overnight get corrected. */
const OVERLAP_DAYS = 5;

/** Refresh this far before actual expiry so a slow request can't straddle it. */
const REFRESH_MARGIN_MS = 5 * 60 * 1000;

export class WhoopError extends Error {
  constructor(message, detail = {}) {
    super(message);
    this.name = 'WhoopError';
    Object.assign(this, detail);
  }
}

/* ---------------------------------------------------------------- tokens -- */

export function getTokens() {
  try {
    const stored = JSON.parse(localStorage.getItem(TOKEN_KEY) || 'null');
    if (stored && stored.access_token) return stored;
  } catch { /* fall through to legacy */ }

  // Carry over a session from the previous build so this isn't a forced logout.
  const legacy = localStorage.getItem(LEGACY_TOKEN_KEY);
  if (legacy) {
    const migrated = { access_token: legacy, refresh_token: null, expires_at: 0 };
    setTokens(migrated);
    localStorage.removeItem(LEGACY_TOKEN_KEY);
    return migrated;
  }
  return null;
}

export function setTokens({ access_token, refresh_token, expires_in, expires_at }) {
  const existing = (() => { try { return JSON.parse(localStorage.getItem(TOKEN_KEY) || 'null'); } catch { return null; } })();
  localStorage.setItem(TOKEN_KEY, JSON.stringify({
    access_token,
    // Whoop rotates the refresh token; never let a missing one wipe a good one.
    refresh_token: refresh_token || (existing && existing.refresh_token) || null,
    expires_at: expires_at || (Date.now() + (Number(expires_in) || 3600) * 1000)
  }));
}

export function clearTokens() {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(LEGACY_TOKEN_KEY);
}

export function isConnected() {
  return !!getTokens();
}

async function refreshTokens(tokens) {
  if (!tokens.refresh_token) {
    throw new WhoopError('Your Whoop session expired. Everything below is your real cached history; only new days are missing.', {
      code: 'reconnect',
      hint: 'Tap reconnect. This happens hourly until Whoop grants the "offline" scope to this app.'
    });
  }
  const res = await fetch('/.netlify/functions/oauth-refresh', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refresh_token: tokens.refresh_token })
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body.access_token) {
    throw new WhoopError(body.message || 'Whoop refused to refresh the session.', {
      code: 'reconnect', whoopStatus: body.whoopStatus, whoopBody: body.whoopBody
    });
  }
  setTokens(body);
  return getTokens();
}

async function validToken() {
  let tokens = getTokens();
  if (!tokens) throw new WhoopError('Not connected to Whoop.', { code: 'not_connected' });
  if (tokens.expires_at && Date.now() > tokens.expires_at - REFRESH_MARGIN_MS) {
    tokens = await refreshTokens(tokens);
  }
  return tokens.access_token;
}

/* ----------------------------------------------------------------- cache -- */

export function loadRaw() {
  try {
    const parsed = JSON.parse(localStorage.getItem(RAW_KEY) || 'null');
    if (parsed && parsed.collections) return parsed;
  } catch { /* corrupt cache is the same as no cache */ }
  return { collections: { cycle: [], recovery: [], sleep: [], workout: [] }, syncedAt: null };
}

export function saveRaw(store) {
  try {
    localStorage.setItem(RAW_KEY, JSON.stringify(store));
    return true;
  } catch (e) {
    // Quota blown. Drop the oldest third and try once more rather than losing
    // the whole cache and forcing a full re-download.
    for (const name of Object.keys(store.collections)) {
      const list = store.collections[name];
      store.collections[name] = list.slice(Math.floor(list.length / 3));
    }
    try { localStorage.setItem(RAW_KEY, JSON.stringify(store)); return true; } catch { return false; }
  }
}

export function clearCache() {
  localStorage.removeItem(RAW_KEY);
}

/** Newest record instant across all cached collections, as an ISO string. */
function latestInstant(collections) {
  let newest = null;
  for (const name of ['cycle', 'sleep', 'workout']) {
    for (const r of collections[name] || []) {
      if (r.start && (!newest || r.start > newest)) newest = r.start;
    }
  }
  return newest;
}

/* ------------------------------------------------------------------ pull -- */

async function fetchCollection(name, { start, onPage }) {
  const records = [];
  let nextToken = null;
  let guard = 0;

  do {
    const token = await validToken();
    const params = new URLSearchParams({ collection: name });
    if (start) params.set('start', start);
    if (nextToken) params.set('nextToken', nextToken);

    const res = await fetch('/.netlify/functions/whoop?' + params, {
      headers: { Authorization: 'Bearer ' + token }
    });
    const body = await res.json().catch(() => ({}));

    if (res.status === 401) {
      // One forced refresh, then let the next loop pass retry with a new token.
      if (guard === 0 && getTokens()?.refresh_token) {
        await refreshTokens(getTokens());
        guard += 1;
        continue;
      }
      throw new WhoopError(body.message || 'Whoop rejected the session.', { code: 'reconnect', ...body });
    }
    if (!res.ok) {
      throw new WhoopError(body.message || `Sync failed on ${name} (HTTP ${res.status}).`, {
        code: body.error || 'whoop_error', whoopStatus: body.whoopStatus, whoopBody: body.whoopBody
      });
    }

    records.push(...(body.records || []));
    nextToken = body.next_token || null;
    guard += 1;
    if (onPage) onPage(records.length, records);
  } while (nextToken && guard < 400);

  return records;
}

/**
 * Pull everything missing and return normalised data.
 * @param {(p:{phase:string, collection:string, records:number, reachedBack:string|null})=>void} onProgress
 */
export async function sync(onProgress = () => {}) {
  const store = loadRaw();
  const cachedLatest = latestInstant(store.collections);
  const isBackfill = !cachedLatest;

  // Incremental runs re-ask for a few days of overlap; a backfill asks for all.
  const start = cachedLatest
    ? new Date(Date.parse(cachedLatest) - OVERLAP_DAYS * 86400000).toISOString()
    : null;

  for (const { name, idKey } of COLLECTIONS) {
    onProgress({ phase: isBackfill ? 'backfill' : 'update', collection: name, records: 0, reachedBack: null });
    const fresh = await fetchCollection(name, {
      start,
      onPage: (count, all) => {
        const oldest = all.reduce((acc, r) => (r.start && (!acc || r.start < acc) ? r.start : acc), null);
        onProgress({
          phase: isBackfill ? 'backfill' : 'update',
          collection: name,
          records: count,
          reachedBack: oldest ? oldest.slice(0, 10) : null
        });
      }
    });
    store.collections[name] = mergeById(store.collections[name], fresh, idKey);
  }

  store.syncedAt = new Date().toISOString();
  const saved = saveRaw(store);
  return { ...derive(store), saved };
}

/** Normalise whatever is in cache without hitting the network. */
export function derive(store = loadRaw()) {
  const { days, workouts } = normalize(store.collections);
  return {
    days,
    workouts,
    syncedAt: store.syncedAt,
    counts: Object.fromEntries(Object.entries(store.collections).map(([k, v]) => [k, v.length]))
  };
}

export function hasCache() {
  const store = loadRaw();
  return (store.collections.cycle || []).length > 0;
}
