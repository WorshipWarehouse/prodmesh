import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.PRODMESH_DATA_DIR ??= mkdtempSync(join(tmpdir(), 'prodmesh-appconfig-'));
const cfg = await import('./appConfig.js');
const { seedChurch } = await import('./topologySeed.js');

test('first boot seeds the topology from topologySeed.js', () => {
  const church = cfg.getChurch();
  assert.equal(church.name, seedChurch.name);
  assert.equal(church.sites.length, seedChurch.sites.length);
  const seedTiles = seedChurch.sites.flatMap((s) => s.auditoriums).flatMap((a) => a.tiles);
  const storedTiles = church.sites.flatMap((s) => s.auditoriums).flatMap((a) => a.tiles);
  assert.equal(storedTiles.length, seedTiles.length);
  // Round-trip fidelity: per-type leaf fields survive the JSON column.
  const companion = storedTiles.find((t) => t.id === 'north-main-companion');
  assert.equal(companion.host, '192.0.2.31');
  const share = storedTiles.find((t) => t.type === 'screenshare' && t.username);
  assert.ok(share.host);
});

test('replaceChurch validates, normalizes, and persists atomically', () => {
  const church = cfg.getChurch();
  const next = structuredClone(church);
  next.name = '  Grace Community Production  ';
  next.sites[0].auditoriums[0].tiles.push({
    id: 'new-tile', type: 'link', label: ' Stream Deck ', url: 'http://192.0.2.200', junk: 'dropped',
  });
  const stored = cfg.replaceChurch(next);
  assert.equal(stored.name, 'Grace Community Production');
  const added = stored.sites[0].auditoriums[0].tiles.find((t) => t.id === 'new-tile');
  assert.equal(added.label, 'Stream Deck');
  assert.equal(added.url, 'http://192.0.2.200');
  assert.equal('junk' in added, false);
  // And it round-trips through a fresh read.
  assert.deepEqual(cfg.getChurch(), stored);
});

test('replaceChurch rejects bad trees without destroying the stored one', () => {
  const before = cfg.getChurch();
  assert.throws(() => cfg.replaceChurch({ name: 'X', sites: [] }), /At least one site/);
  assert.throws(
    () => cfg.replaceChurch({
      name: 'X',
      sites: [{ id: 'a', name: 'A', status: 'active', auditoriums: [{ id: 'a', name: 'Dup', tiles: [] }] }],
    }),
    /Duplicate id/,
  );
  assert.throws(
    () => cfg.replaceChurch({
      name: 'X',
      sites: [{
        id: 'a', name: 'A', status: 'active',
        auditoriums: [{ id: 'r', name: 'R', tiles: [{ id: 't', type: 'link', label: 'L', url: 'ftp://nope' }] }],
      }],
    }),
    /url must start/,
  );
  assert.deepEqual(cfg.getChurch(), before);
});
