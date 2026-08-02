// Whoop API v2 page-batching proxy.
//
// The browser drives pagination so it can show real progress and so we never
// blow the 10s function budget on a full-history backfill. Each invocation
// walks as many 25-record pages as it can inside a soft time budget, then hands
// back whatever it collected plus the token to resume from.
//
// There is no mock data in this file and there must never be again. If Whoop
// says no, the caller gets Whoop's exact status and body.

const WHOOP_BASE = 'https://api.prod.whoop.com/developer/v2';

// Whoop caps `limit` at 25. Asking for more is a 400, not a bigger page.
const PAGE_SIZE = 25;

// Netlify's free-tier function ceiling is 10s. Stop walking pages at 6s so
// there is room to serialise and return.
const TIME_BUDGET_MS = 6000;

// Backstop so a malformed next_token cycle can't spin forever.
const MAX_PAGES_PER_CALL = 40;

const COLLECTIONS = {
  cycle: '/cycle',
  recovery: '/recovery',
  sleep: '/activity/sleep',
  workout: '/activity/workout'
};

const CORS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type',
  'Access-Control-Allow-Methods': 'GET, OPTIONS'
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function json(statusCode, body) {
  return { statusCode, headers: CORS, body: JSON.stringify(body) };
}

function buildUrl(path, { start, end, nextToken }) {
  const url = new URL(WHOOP_BASE + path);
  url.searchParams.set('limit', String(PAGE_SIZE));
  if (start) url.searchParams.set('start', start);
  if (end) url.searchParams.set('end', end);
  if (nextToken) url.searchParams.set('nextToken', nextToken);
  return url.toString();
}

/**
 * Fetch one page. Resolves to a discriminated result rather than throwing so
 * the caller can decide between "return partial progress" and "surface error".
 */
async function fetchPage(url, token) {
  let res;
  try {
    res = await fetch(url, {
      headers: { Authorization: 'Bearer ' + token, Accept: 'application/json' },
      signal: AbortSignal.timeout(8000)
    });
  } catch (e) {
    return { kind: 'network', message: e.name === 'TimeoutError' ? 'Whoop did not respond in 8s' : e.message };
  }

  const text = await res.text();

  if (res.status === 429) {
    // A literal "0" means retry now, so it cannot be treated as missing.
    const raw = res.headers.get('retry-after');
    const parsed = raw == null || raw === '' ? NaN : Number(raw);
    const retryAfter = Number.isFinite(parsed) ? parsed : 2;
    return { kind: 'rate-limited', retryAfterMs: retryAfter * 1000 };
  }

  if (!res.ok) {
    return { kind: 'http', status: res.status, body: text.slice(0, 600) };
  }

  try {
    return { kind: 'ok', data: JSON.parse(text) };
  } catch {
    return { kind: 'http', status: res.status, body: 'Whoop returned non-JSON: ' + text.slice(0, 300) };
  }
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };

  const auth = event.headers.authorization || event.headers.Authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
  if (!token) {
    return json(401, { error: 'not_connected', message: 'No Whoop access token was sent.' });
  }

  const q = event.queryStringParameters || {};
  const path = COLLECTIONS[q.collection];
  if (!path) {
    return json(400, {
      error: 'bad_collection',
      message: `Unknown collection "${q.collection}". Expected one of: ${Object.keys(COLLECTIONS).join(', ')}.`
    });
  }

  const startedAt = Date.now();
  const records = [];
  let nextToken = q.nextToken || null;
  let pages = 0;

  while (pages < MAX_PAGES_PER_CALL) {
    const url = buildUrl(path, { start: q.start, end: q.end, nextToken });
    const result = await fetchPage(url, token);

    if (result.kind === 'rate-limited') {
      const remaining = TIME_BUDGET_MS - (Date.now() - startedAt);
      // Only wait it out if we can afford to. Otherwise hand the token back and
      // let the browser resume on the next call.
      if (result.retryAfterMs < remaining) {
        await sleep(result.retryAfterMs);
        continue;
      }
      break;
    }

    if (result.kind === 'network') {
      if (records.length) break; // keep partial progress, browser resumes
      return json(502, { error: 'whoop_unreachable', message: result.message });
    }

    if (result.kind === 'http') {
      if (result.status === 401) {
        return json(401, {
          error: 'token_expired',
          message: 'Whoop rejected the access token.',
          whoopStatus: 401,
          whoopBody: result.body
        });
      }
      return json(502, {
        error: 'whoop_error',
        message: `Whoop returned ${result.status} for ${q.collection}.`,
        whoopStatus: result.status,
        whoopBody: result.body,
        requestedUrl: url.replace(/nextToken=[^&]+/, 'nextToken=…')
      });
    }

    const page = result.data || {};
    if (Array.isArray(page.records)) records.push(...page.records);
    pages += 1;
    nextToken = page.next_token || null;

    if (!nextToken) break;
    if (Date.now() - startedAt > TIME_BUDGET_MS) break;
  }

  return json(200, {
    collection: q.collection,
    records,
    next_token: nextToken,
    done: !nextToken,
    pages,
    elapsedMs: Date.now() - startedAt
  });
};
