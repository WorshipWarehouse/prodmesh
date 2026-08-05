import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.PRODMESH_DATA_DIR = mkdtempSync(join(tmpdir(), 'prodmesh-views-'));
const views = await import('./views.js');
const { getDb } = await import('./db.js');

// Sizes are enforced per widget now, so a fixture has to be one the widget is
// allowed to be.
const SIZES = { countdown: [2, 1], loudness: [2, 1], viewers: [1, 1], 'run-of-show': [2, 3] };
const at = (type, x, y, w, h) => {
  const [dw, dh] = SIZES[type] ?? [1, 1];
  return { type, x, y, w: w ?? dw, h: h ?? dh };
};

test('create → read → replace round-trips, and returns what was STORED', () => {
  const made = views.createView({ roomId: 'r1', kind: 'dashboard', name: 'FOH', slug: 'foh' });
  assert.equal(made.kind, 'dashboard');
  assert.equal(made.columns, 6);
  assert.equal(made.maxRows, null);
  assert.deepEqual(made.widgets, []);

  const saved = views.replaceView(made.id, {
    name: 'Front of House',
    slug: 'foh',
    widgets: [at('viewers', 4, 1), at('loudness', 0, 0)],
  });
  // Normalised on the way in: reading order, not the order sent.
  assert.deepEqual(saved.widgets.map((w) => w.type), ['loudness', 'viewers']);
  assert.equal(saved.name, 'Front of House');
  // A fresh read equals the returned value — the caller sees storage, not input.
  assert.deepEqual(views.getView(made.id), saved);
});

test('a rejected save leaves the stored view untouched', () => {
  const made = views.createView({ roomId: 'r2', kind: 'dashboard', name: 'Booth', slug: 'booth' });
  const good = views.replaceView(made.id, {
    name: 'Booth', slug: 'booth', widgets: [at('countdown', 0, 0)],
  });

  assert.throws(() => views.replaceView(made.id, {
    name: 'Booth', slug: 'booth',
    widgets: [at('loudness', 0, 0), at('viewers', 1, 0)], // overlap
  }), /overlap/);

  assert.deepEqual(views.getView(made.id), good, 'validated before anything was written');
});

test('slug is unique per room, and free to repeat across rooms', () => {
  views.createView({ roomId: 'r3', kind: 'dashboard', name: 'Main', slug: 'main' });
  assert.throws(
    () => views.createView({ roomId: 'r3', kind: 'display', name: 'Main wall', slug: 'main' }),
    /already has a view called "main"/,
  );
  // Different room, same slug — fine.
  assert.doesNotThrow(() => views.createView({ roomId: 'r4', kind: 'dashboard', name: 'Main', slug: 'main' }));
});

test('getViewByKey resolves a slug OR an id, so renaming cannot orphan a screen', () => {
  const made = views.createView({ roomId: 'r5', kind: 'display', name: 'Wall', slug: 'wall' });
  assert.equal(views.getViewByKey('r5', 'wall').id, made.id);
  assert.equal(views.getViewByKey('r5', made.id).id, made.id);
  views.replaceView(made.id, { name: 'Wall', slug: 'multiview', widgets: [] });
  assert.equal(views.getViewByKey('r5', 'wall'), null, 'the old slug is gone…');
  assert.equal(views.getViewByKey('r5', made.id).slug, 'multiview', '…but the id still resolves');
  assert.equal(views.getViewByKey('r5', 'multiview').id, made.id);
});

test('deleteView leaves no orphan placements', () => {
  // The schema declares ON DELETE CASCADE, but prodmesh never issues
  // PRAGMA foreign_keys — so the cascade does not fire and the store deletes
  // placements itself. Without that, these rows would silently accumulate
  // forever. This test is the reason to know that.
  const made = views.createView({ roomId: 'r6', kind: 'dashboard', name: 'Temp', slug: 'temp' });
  views.replaceView(made.id, {
    name: 'Temp', slug: 'temp', widgets: [at('countdown', 0, 0), at('loudness', 2, 0)],
  });
  const count = () =>
    getDb().prepare('SELECT COUNT(*) AS n FROM view_widgets WHERE view_id = ?').get(made.id).n;
  assert.equal(count(), 2);

  const deleted = views.deleteView(made.id);
  assert.equal(deleted.name, 'Temp', 'returns what was deleted, for the audit trail');
  assert.equal(views.getView(made.id), null);
  assert.equal(count(), 0, 'placements went with it');
  assert.equal(views.deleteView(made.id), null, 'deleting twice is not an error');
});

test('listViews is per room and omits placements', () => {
  views.createView({ roomId: 'r7', kind: 'dashboard', name: 'One', slug: 'one' });
  const two = views.createView({ roomId: 'r7', kind: 'display', name: 'Two', slug: 'two' });
  views.replaceView(two.id, { name: 'Two', slug: 'two', widgets: [at('viewers', 0, 0)] });

  const list = views.listViews('r7');
  assert.deepEqual(list.map((v) => v.slug), ['one', 'two']);
  assert.equal('widgets' in list[1], false, 'the index does not carry every layout');
  assert.deepEqual(views.listViews('nobody'), []);
});

test('kind is fixed at creation — a display cannot become a dashboard', () => {
  const made = views.createView({ roomId: 'r8', kind: 'display', name: 'Wall', slug: 'wall' });
  // A payload claiming dashboard is ignored, so the 3x3 bound still applies.
  assert.throws(
    // 2 wide at column 2 fits a dashboard's 6 columns and not a display's 3.
    () => views.replaceView(made.id, { kind: 'dashboard', name: 'Wall', slug: 'wall', widgets: [at('countdown', 2, 0)] }),
    /does not fit a display/,
  );
});
