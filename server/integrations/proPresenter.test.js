import test from 'node:test';
import assert from 'node:assert/strict';
import { parseActive, mapIndexToItemId, isConfigured } from './proPresenter.js';

test('isConfigured needs a host', () => {
  assert.equal(isConfigured(null), false);
  assert.equal(isConfigured({ port: 62202 }), false);
  assert.equal(isConfigured({ host: '127.0.0.1' }), true);
});

test('parseActive pulls the active playlist item', () => {
  const body = {
    presentation: {
      playlist: { uuid: 'p1', name: 'Colossians …', index: 2 },
      item: { uuid: 'pres1', name: 'Goodness Of God' },
      playlist_item: { uuid: 'i7', name: 'Goodness Of God', index: 7 },
    },
  };
  assert.deepEqual(parseActive(body), {
    index: 7,
    name: 'Goodness Of God',
    uuid: 'i7',
    playlistName: 'Colossians …',
  });
  assert.deepEqual(parseActive({ presentation: null }), {
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
