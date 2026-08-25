import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { APP_VERSION } from '../src/version.js';

const root = new URL('../', import.meta.url);

test('the version shown in Settings matches the one the cache is keyed on', async () => {
  // Two numbers in two files that have to agree. If sw.js is bumped and
  // src/version.js is not, Settings reports a build that is not what deployed,
  // which is worse than showing nothing at all.
  const sw = await readFile(new URL('sw.js', root), 'utf8');
  const match = sw.match(/^const VERSION = 'recoil-v(\d+)';$/m);
  assert.ok(match, 'sw.js VERSION should read recoil-v<number>');
  assert.equal(Number(match[1]), APP_VERSION);
});

test('every module the app loads is in the offline shell', async () => {
  // A module missing from SHELL works online and breaks the moment the phone
  // has no signal, which is the one situation the shell exists for.
  const sw = await readFile(new URL('sw.js', root), 'utf8');
  const listed = new Set([...sw.matchAll(/'(\/src\/[^']+)'/g)].map((m) => m[1]));

  const html = await readFile(new URL('index.html', root), 'utf8');
  const entry = html.match(/<script type="module" src="([^"]+)"/);
  assert.ok(entry, 'index.html should load a module entry point');

  const seen = new Set();
  const walk = async (path) => {
    if (seen.has(path)) return;
    seen.add(path);
    const source = await readFile(new URL('.' + path, root), 'utf8');
    for (const m of source.matchAll(/from\s+'([^']+\.js)'/g)) {
      const resolved = new URL(m[1], 'http://x' + path).pathname;
      await walk(resolved);
    }
    // The worker is fetched rather than imported, so it is found this way.
    for (const m of source.matchAll(/new URL\('([^']+\.js)',\s*import\.meta\.url\)/g)) {
      await walk(new URL(m[1], 'http://x' + path).pathname);
    }
  };
  await walk(entry[1]);

  const missing = [...seen].filter((p) => !listed.has(p));
  assert.deepEqual(missing, [], 'these modules are not cached for offline use');
});
