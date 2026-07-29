// People search against the LIVE path — its own file because configuring
// credentials flips isConfigured() for the whole module, and every other test
// in planningCenter.test.js is written against mock mode.
import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.PRODMESH_DATA_DIR = mkdtempSync(join(tmpdir(), 'prodmesh-pcpeople-'));
const secrets = await import('../secrets.js');
const pco = await import('./planningCenter.js');

// Measured before the credentials below exist: node:test starts running tests
// after the module body, so an assertion inside a test() would see a
// configured module no matter where the test sits in the file.
const unconfigured = { configured: pco.isConfigured(), results: await pco.searchPeople('avery') };
secrets.setSecrets({ 'planningCenter.appId': 'app-id', 'planningCenter.secret': 'app-secret' });

test('no token, no results — and no fabricated ones', () => {
  // Sample PLANS are fine; a sample person id is not. It gets written into a
  // user record, so once a real token is connected that account would carry
  // the identity of whoever actually owns that number.
  assert.equal(unconfigured.configured, false);
  assert.deepEqual(unconfigured.results, []);
});

// A PC person carries far more than we ask for; the payload says so.
const person = (id, fullName, extra = {}) => ({
  id,
  attributes: {
    full_name: fullName,
    photo_thumbnail_url: `https://pc.test/${id}.jpg`,
    email_address: `${fullName.split(' ')[0].toLowerCase()}@church.test`,
    phone_number: '555-0100',
    ...extra,
  },
});

const calls = [];
function stubFetch(people) {
  globalThis.fetch = async (url) => {
    calls.push(String(url));
    return { ok: true, status: 200, json: async () => ({ data: people }) };
  };
}

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
  calls.length = 0;
  pco.clearCache();
});

test('a search returns names and photos — never contact details', async () => {
  stubFetch([person('900001', 'Avery Stone')]);
  const results = await pco.searchPeople('avery');

  assert.deepEqual(results, [
    { id: '900001', name: 'Avery Stone', avatarUrl: 'https://pc.test/900001.jpg' },
  ]);
  // Explicit, because "it isn't in the assert above" is easy to regress into.
  const keys = Object.keys(results[0]);
  assert.ok(!keys.some((k) => /email|phone|address|birth/i.test(k)), keys.join());
});

test('the query travels as an encoded query param, never in the path', async () => {
  stubFetch([]);
  await pco.searchPeople('../../people/v2/people');

  const url = new URL(calls[0]);
  assert.equal(url.pathname, '/services/v2/people', 'path is fixed');
  assert.equal(url.searchParams.get('where[search_name_or_email]'), '../../people/v2/people');
});

test('rows that do not match the typed name are dropped', async () => {
  // PC ignores where[] params it does not recognize rather than erroring, so a
  // wrong param name returns the first page of EVERYBODY. Matching locally as
  // well turns that into "no results" instead of a wrong list of names.
  stubFetch([person('1', 'Aaron Abbott'), person('2', 'Avery Stone'), person('3', 'Zoe Young')]);
  const results = await pco.searchPeople('avery');
  assert.deepEqual(results.map((p) => p.id), ['2']);
});

test('every word typed has to appear', async () => {
  stubFetch([person('1', 'Avery Stone'), person('2', 'Avery Torres')]);
  assert.deepEqual((await pco.searchPeople('avery h')).map((p) => p.name), ['Avery Stone']);
});

test('a one-letter query never reaches Planning Center', async () => {
  stubFetch([person('1', 'Avery Stone')]);
  assert.deepEqual(await pco.searchPeople('m'), []);
  assert.deepEqual(await pco.searchPeople(''), []);
  assert.equal(calls.length, 0);
});

test('repeating a search is served from cache', async () => {
  stubFetch([person('1', 'Avery Stone')]);
  await pco.searchPeople('avery');
  await pco.searchPeople('Avery'); // same search, different shift key
  assert.equal(calls.length, 1);
});

test('a failed request throws rather than reading as "nobody by that name"', async () => {
  globalThis.fetch = async () => ({ ok: false, status: 500, json: async () => ({}) });
  await assert.rejects(() => pco.searchPeople('avery'));
});
