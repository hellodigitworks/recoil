// Guards the bug this whole rebuild exists to fix: the old function called a
// v4 path that does not exist with limit=3650 which is illegal, then silently
// served random numbers when Whoop said no.

import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { handler } = require('../netlify/functions/whoop.js');

let calls = [];
let queue = [];

function reply({ status = 200, body = {}, headers = {} }) {
  return {
    status, ok: status >= 200 && status < 300,
    headers: { get: (k) => headers[k.toLowerCase()] ?? null },
    text: async () => (typeof body === 'string' ? body : JSON.stringify(body))
  };
}

beforeEach(() => {
  calls = [];
  queue = [];
  global.fetch = async (url, init) => {
    calls.push({ url, init });
    const next = queue.shift();
    if (!next) throw new Error('unexpected fetch: ' + url);
    if (next instanceof Error) throw next;
    return reply(next);
  };
});

const invoke = (params, token = 'tok') => handler({
  httpMethod: 'GET',
  headers: token ? { authorization: 'Bearer ' + token } : {},
  queryStringParameters: params
});

test('calls Whoop API v2 with a legal page size', async () => {
  queue = [{ body: { records: [{ id: 1 }], next_token: null } }];
  await invoke({ collection: 'cycle' });

  const url = new URL(calls[0].url);
  assert.equal(url.origin + url.pathname, 'https://api.prod.whoop.com/developer/v2/cycle');
  assert.equal(url.searchParams.get('limit'), '25', 'Whoop rejects anything above 25');
  assert.equal(calls[0].init.headers.Authorization, 'Bearer tok');
});

test('every collection maps to its real v2 path', async () => {
  const expected = {
    cycle: '/developer/v2/cycle',
    recovery: '/developer/v2/recovery',
    sleep: '/developer/v2/activity/sleep',
    workout: '/developer/v2/activity/workout'
  };
  for (const [collection, path] of Object.entries(expected)) {
    calls = [];
    queue = [{ body: { records: [], next_token: null } }];
    await invoke({ collection });
    assert.equal(new URL(calls[0].url).pathname, path);
  }
});

test('walks next_token to the end and concatenates the pages', async () => {
  queue = [
    { body: { records: [{ id: 1 }, { id: 2 }], next_token: 'p2' } },
    { body: { records: [{ id: 3 }], next_token: 'p3' } },
    { body: { records: [{ id: 4 }], next_token: null } }
  ];
  const res = await invoke({ collection: 'cycle' });
  const body = JSON.parse(res.body);

  assert.equal(res.statusCode, 200);
  assert.equal(calls.length, 3);
  assert.equal(new URL(calls[1].url).searchParams.get('nextToken'), 'p2');
  assert.equal(new URL(calls[2].url).searchParams.get('nextToken'), 'p3');
  assert.deepEqual(body.records.map((r) => r.id), [1, 2, 3, 4]);
  assert.equal(body.done, true);
  assert.equal(body.next_token, null);
});

test('passes start and resumes from a caller-supplied token', async () => {
  queue = [{ body: { records: [], next_token: null } }];
  await invoke({ collection: 'sleep', start: '2026-01-01T00:00:00.000Z', nextToken: 'resume-me' });
  const url = new URL(calls[0].url);
  assert.equal(url.searchParams.get('start'), '2026-01-01T00:00:00.000Z');
  assert.equal(url.searchParams.get('nextToken'), 'resume-me');
});

test('a Whoop error is surfaced, never replaced with invented data', async () => {
  queue = [{ status: 500, body: 'upstream exploded' }];
  const res = await invoke({ collection: 'cycle' });
  const body = JSON.parse(res.body);

  assert.equal(res.statusCode, 502);
  assert.equal(body.error, 'whoop_error');
  assert.equal(body.whoopStatus, 500);
  assert.match(body.whoopBody, /upstream exploded/);
  assert.equal(body.records, undefined, 'no fallback records of any kind');
});

test('401 from Whoop is reported as an expired token', async () => {
  queue = [{ status: 401, body: 'Unauthorized' }];
  const res = await invoke({ collection: 'cycle' });
  assert.equal(res.statusCode, 401);
  assert.equal(JSON.parse(res.body).error, 'token_expired');
});

test('429 is waited out when there is time budget left', async () => {
  queue = [
    { status: 429, headers: { 'retry-after': '0' } },
    { body: { records: [{ id: 9 }], next_token: null } }
  ];
  const res = await invoke({ collection: 'workout' });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(JSON.parse(res.body).records.map((r) => r.id), [9]);
});

test('partial progress survives a mid-walk network drop', async () => {
  queue = [
    { body: { records: [{ id: 1 }], next_token: 'p2' } },
    new Error('socket hang up')
  ];
  const res = await invoke({ collection: 'cycle' });
  const body = JSON.parse(res.body);
  assert.equal(res.statusCode, 200);
  assert.equal(body.records.length, 1);
  assert.equal(body.next_token, 'p2', 'caller can resume from here');
  assert.equal(body.done, false);
});

test('a network failure on the first page is an error, not an empty success', async () => {
  queue = [new Error('dns is having a day')];
  const res = await invoke({ collection: 'cycle' });
  assert.equal(res.statusCode, 502);
  assert.equal(JSON.parse(res.body).error, 'whoop_unreachable');
});

test('missing token is refused before any request goes out', async () => {
  const res = await invoke({ collection: 'cycle' }, null);
  assert.equal(res.statusCode, 401);
  assert.equal(JSON.parse(res.body).error, 'not_connected');
  assert.equal(calls.length, 0);
});

test('an unknown collection is rejected by name', async () => {
  const res = await invoke({ collection: 'physiological_cycles' });
  assert.equal(res.statusCode, 400);
  assert.match(JSON.parse(res.body).message, /physiological_cycles/);
  assert.equal(calls.length, 0);
});

test('CORS preflight is answered', async () => {
  const res = await handler({ httpMethod: 'OPTIONS', headers: {}, queryStringParameters: {} });
  assert.equal(res.statusCode, 204);
  assert.equal(res.headers['Access-Control-Allow-Origin'], '*');
});

test('the mock data generator is gone from the source', async () => {
  const { readFileSync } = await import('node:fs');
  const src = readFileSync(new URL('../netlify/functions/whoop.js', import.meta.url), 'utf8');
  assert.doesNotMatch(src, /Math\.random/, 'no invented numbers may live in this file');
  assert.doesNotMatch(src, /mockData|generateMockData/);
  assert.doesNotMatch(src, /\/v4\/|physiological_cycles/, 'the endpoint that never existed');
});
