// Assigning a display to a station. Separate file because it needs its own
// boot state — one process per file.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.PRODMESH_DATA_DIR = mkdtempSync(join(tmpdir(), 'prodmesh-stationview-'));
process.env.PRODMESH_LOCAL_TEST = '1';
const auth = await import('./authStore.js');
const views = await import('./views.js');

const ROOM = 'north-main';
const OTHER = 'north-youth';

const station = auth.registerStation({ name: 'Multiview Pi', roomId: ROOM });
const display = views.createView({ roomId: ROOM, kind: 'display', name: 'Wall', slug: 'wall' });
const dashboard = views.createView({ roomId: ROOM, kind: 'dashboard', name: 'FOH', slug: 'foh' });
const elsewhere = views.createView({ roomId: OTHER, kind: 'display', name: 'Youth', slug: 'youth' });

const base = { name: 'Multiview Pi', roomId: ROOM, campusId: null, roomOnly: false };

test('a display can be assigned, and resolves on the very first request', () => {
  const saved = auth.updateStation(station.id, { ...base, viewId: display.id });
  assert.equal(saved.viewId, display.id);
  assert.equal(saved.viewName, 'Wall');

  // The slug has to come back with the STATION, not from a second call: a Pi
  // has to know where to send itself before it can ask for anything else.
  const resolved = auth.resolveStation(station.token);
  assert.equal(resolved.viewSlug, 'wall');
  assert.equal(resolved.viewKind, 'display');
  assert.equal(resolved.roomId, ROOM);
});

test('the pairing rules are enforced where the caller cannot notice them', () => {
  // A dashboard is interactive by definition; a display screen has no mouse.
  assert.throws(
    () => auth.updateStation(station.id, { ...base, viewId: dashboard.id }),
    /Only a display can be assigned/,
  );
  // The foyer screen must not end up showing the youth room's service.
  assert.throws(
    () => auth.updateStation(station.id, { ...base, viewId: elsewhere.id }),
    /belongs to another room/,
  );
  // And a station standing in no room has no display to show.
  assert.throws(
    () => auth.updateStation(station.id, { ...base, roomId: null, viewId: display.id }),
    /belongs to another room/,
  );
  assert.throws(
    () => auth.updateStation(station.id, { ...base, viewId: 'no-such-view' }),
    /Unknown view/,
  );

  // None of that changed what was stored.
  assert.equal(auth.resolveStation(station.token).viewSlug, 'wall');
});

test('deleting the view leaves the station usable rather than pointing at nothing', () => {
  // No foreign key fires here (prodmesh never enables them), so the row keeps
  // a dangling id — the LEFT JOIN is what turns that back into "unassigned".
  views.deleteView(display.id);

  const resolved = auth.resolveStation(station.token);
  assert.equal(resolved.viewId, null);
  assert.equal(resolved.viewSlug, null);
  assert.equal(resolved.name, 'Multiview Pi', 'the station itself survives');
  assert.equal(auth.listStations().find((s) => s.id === station.id).viewName, null);
});

test('assignment can be cleared', () => {
  const again = views.createView({ roomId: ROOM, kind: 'display', name: 'Wall 2', slug: 'wall-2' });
  auth.updateStation(station.id, { ...base, viewId: again.id });
  assert.equal(auth.resolveStation(station.token).viewSlug, 'wall-2');

  auth.updateStation(station.id, { ...base, viewId: null });
  assert.equal(auth.resolveStation(station.token).viewId, null);
});
