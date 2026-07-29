// People search against the LIVE path — its own file because configuring
// credentials flips isConfigured() for the whole module, and every other test
// in planningCenter.test.js is written against mock mode.
//
// The stub below mimics what Services /people actually does, which is the
// whole reason this code looks the way it does: it PAGES, and it IGNORES every
// filter param it is given (verified live 2026-07-29 — where[…], ?q= and
// ?search= all came back with an identical total_count).
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
    status: 'active',
    archived_at: null,
    email_address: `${fullName.split(' ')[0].toLowerCase()}@church.test`,
    phone_number: '555-0100',
    birthdate: '1988-04-02',
    ...extra,
  },
});

const calls = [];

/** Serves `roster` the way Services does: 100 per page, filters ignored. */
function stubPlanningCenter(roster) {
  globalThis.fetch = async (url) => {
    calls.push(String(url));
    const offset = Number(new URL(String(url)).searchParams.get('offset') ?? 0);
    return {
      ok: true,
      status: 200,
      json: async () => ({
        data: roster.slice(offset, offset + 100),
        meta: { total_count: roster.length },
      }),
    };
  };
}

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
  calls.length = 0;
  pco.clearCache();
});

test('finds someone past the first page of the roster', async () => {
  // The reported bug: Grace Community has 139 people in Services and their tech
  // director sat at #113, so a search that read one page found "some people"
  // and silently missed the rest.
  const roster = [
    ...Array.from({ length: 112 }, (_, i) => person(`${1000 + i}`, `Volunteer ${i} Person`)),
    person('142095475', 'Arturo Ortega'),
    ...Array.from({ length: 26 }, (_, i) => person(`${2000 + i}`, `Later ${i} Person`)),
  ];
  stubPlanningCenter(roster);

  const results = await pco.searchPeople('arturo');
  assert.deepEqual(results.map((p) => p.id), ['142095475']);
  assert.equal(calls.length, 2, 'paged through the whole roster');
});

test('a search returns names and photos — never contact details', async () => {
  stubPlanningCenter([person('900001', 'Avery Stone')]);
  const results = await pco.searchPeople('avery');

  assert.deepEqual(results, [
    { id: '900001', name: 'Avery Stone', avatarUrl: 'https://pc.test/900001.jpg', inactive: false },
  ]);
  // Explicit, because "it isn't in the assert above" is easy to regress into.
  const keys = Object.keys(results[0]);
  assert.ok(!keys.some((k) => /email|phone|address|birth/i.test(k)), keys.join());
});

test('nothing the admin types is ever sent to Planning Center', async () => {
  stubPlanningCenter([person('1', 'Avery Stone')]);
  await pco.searchPeople('../../people/v2/people?where[x]=1');

  for (const call of calls) {
    const url = new URL(call);
    assert.equal(url.pathname, '/services/v2/people');
    assert.deepEqual([...url.searchParams.keys()].sort(), ['offset', 'per_page']);
  }
});

test('every word typed has to appear', async () => {
  stubPlanningCenter([person('1', 'Avery Stone'), person('2', 'Avery Torres')]);
  assert.deepEqual((await pco.searchPeople('avery h')).map((p) => p.name), ['Avery Stone']);
});

test('people who still serve come first, and inactive ones say so', async () => {
  // Only eight rows show, so ordering decides who is seen at all — but an
  // inactive volunteer can still need a login, so they stay findable.
  stubPlanningCenter([
    person('1', 'Avery Zither', { status: 'inactive', archived_at: '2025-01-01T00:00:00Z' }),
    person('2', 'Avery Stone'),
  ]);
  const results = await pco.searchPeople('avery');
  assert.deepEqual(results.map((p) => p.name), ['Avery Stone', 'Avery Zither']);
  assert.deepEqual(results.map((p) => p.inactive), [false, true]);
});

test('a one-letter query never reaches Planning Center', async () => {
  stubPlanningCenter([person('1', 'Avery Stone')]);
  assert.deepEqual(await pco.searchPeople('m'), []);
  assert.deepEqual(await pco.searchPeople(''), []);
  assert.equal(calls.length, 0);
});

test('the roster is fetched once, not per search', async () => {
  stubPlanningCenter([person('1', 'Avery Stone'), person('2', 'Arturo Ortega')]);
  await pco.searchPeople('avery');
  await pco.searchPeople('Avery'); // same search, different shift key
  await pco.searchPeople('arturo'); // different search, same roster
  assert.equal(calls.length, 1);
});

test('a warm-up and a search that overlap share one fetch', async () => {
  // The picker warms the roster as it mounts and searches a keystroke later,
  // so these two genuinely overlap: caching the resolved value rather than the
  // in-flight promise fetched the whole roster twice, every time.
  stubPlanningCenter([person('1', 'Avery Stone')]);
  await Promise.all([pco.getPeopleRoster(), pco.searchPeople('avery')]);
  assert.equal(calls.length, 1);
});

test('a failed request throws rather than reading as "nobody by that name"', async () => {
  globalThis.fetch = async () => ({ ok: false, status: 500, json: async () => ({}) });
  await assert.rejects(() => pco.searchPeople('avery'));
});
