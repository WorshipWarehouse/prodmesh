import test from 'node:test';
import assert from 'node:assert/strict';
import { parseActive, mapIndexToItemId, isConfigured } from './proPresenter.js';

test('isConfigured needs a host', () => {
  assert.equal(isConfigured(null), false);
  assert.equal(isConfigured({ port: 62202 }), false);
  assert.equal(isConfigured({ host: '127.0.0.1' }), true);
});

test('parseActive pulls the active playlist item (fields nested under .id)', () => {
  // Shape verified against the live ProPresenter API.
  const body = {
    presentation: {
      playlist: { uuid: 'p1', name: 'Colossians …', index: 2 },
      item: { uuid: 'pres1', name: 'Break Out', index: 4294967295 },
      playlist_item: {
        id: { uuid: 'i5', name: 'Break Out', index: 5 },
        type: 'presentation',
        is_pco: true,
      },
    },
  };
  assert.deepEqual(parseActive(body), {
    index: 5,
    name: 'Break Out',
    uuid: 'i5',
    playlistName: 'Colossians …',
  });
  // Nothing triggered → playlist_item is null.
  assert.deepEqual(parseActive({ presentation: { playlist: null, playlist_item: null } }), {
    index: null, name: null, uuid: null, playlistName: null,
  });
});

// PC items (subset) vs ProPresenter names that differ in spacing/case/suffix.
const items = [
  { id: 'a', title: 'Pre-Service Slides' },
  { id: 'b', title: 'Welcome/Communication' },
  { id: 'c', title: 'Breakout' },
  { id: 'd', title: 'Great Is Thy Faithfulness (Beginning To End)' },
  { id: 'e', title: 'Jesus Christ Over Everything' },
];

test('mapIndexToItemId matches by index (primary)', () => {
  assert.equal(mapIndexToItemId(items, { index: 2, name: 'Break Out' }), 'c');
  assert.equal(mapIndexToItemId(items, { index: 0, name: 'Pre Service' }), 'a');
  assert.equal(mapIndexToItemId(items, { index: 4, name: 'Jesus Christ Over Everything - [ NOW ]' }), 'e');
});

test('mapIndexToItemId falls back to name when index is off', () => {
  // index points out of range → name match rescues it
  assert.equal(mapIndexToItemId(items, { index: 99, name: 'Breakout' }), 'c');
});

test('mapIndexToItemId returns null when nothing is active', () => {
  assert.equal(mapIndexToItemId(items, { index: null, name: null }), null);
  assert.equal(mapIndexToItemId(items, null), null);
});
