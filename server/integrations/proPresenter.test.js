import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseActive,
  mapIndexToItemId,
  isConfigured,
  slideTotal,
  targetSecondsOfDay,
  parseHms,
  parseTimers,
  pickTimer,
} from './proPresenter.js';

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
        presentation_info: { arrangement_name: 'AOW', arrangement_uuid: 'arr-aow' },
      },
    },
  };
  assert.deepEqual(parseActive(body), {
    index: 5,
    name: 'Break Out',
    uuid: 'i5',
    arrangementUuid: 'arr-aow',
    arrangementName: 'AOW',
    playlistName: 'Colossians …',
  });
  // Nothing triggered → playlist_item is null.
  assert.deepEqual(parseActive({ presentation: { playlist: null, playlist_item: null } }), {
    index: null, name: null, uuid: null, arrangementUuid: null, arrangementName: null, playlistName: null,
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

test('slideTotal sums raw groups when no arrangement is selected', () => {
  const pres = {
    current_arrangement: '',
    groups: [
      { uuid: 'g1', slides: [1] },
      { uuid: 'g2', slides: [1, 2, 3] },
      { uuid: 'g3', slides: [1, 2] },
    ],
    arrangements: [{ id: { uuid: 'a1' }, groups: ['g1', 'g2'] }],
  };
  assert.equal(slideTotal(pres), 6);
});

test('slideTotal expands the selected arrangement (groups repeat)', () => {
  const pres = {
    current_arrangement: 'a1',
    groups: [
      { uuid: 'v', slides: [1, 2] }, // verse: 2 slides
      { uuid: 'c', slides: [1] }, // chorus: 1 slide
    ],
    arrangements: [{ id: { uuid: 'a1' }, groups: ['v', 'c', 'v', 'c', 'c'] }], // 2+1+2+1+1 = 7
  };
  assert.equal(slideTotal(pres), 7);
});

test('slideTotal selects the arrangement from the playlist item (uuid, then name)', () => {
  const pres = {
    current_arrangement: '', // presentation does not report it — item does
    groups: [
      { uuid: 'v', slides: [1, 2] },
      { uuid: 'c', slides: [1] },
    ],
    arrangements: [
      { id: { uuid: 'now', name: 'NOW' }, groups: ['v', 'c'] }, // 3
      { id: { uuid: 'aow', name: 'AOW' }, groups: ['v', 'c', 'v', 'c', 'c'] }, // 7
    ],
  };
  assert.equal(slideTotal(pres, { uuid: 'aow' }), 7);
  assert.equal(slideTotal(pres, { name: 'AOW' }), 7);
  assert.equal(slideTotal(pres, { uuid: 'now' }), 3);
  // Unknown arrangement → raw group sum fallback.
  assert.equal(slideTotal(pres, { uuid: 'nope', name: 'nope' }), 3);
});

test('slideTotal handles null', () => {
  assert.equal(slideTotal(null), null);
});

// ── Timers (fixtures are real /v1/timers + /v1/timers/current payloads) ──────

test('targetSecondsOfDay normalizes the 12-hour time_of_day + period', () => {
  assert.equal(targetSecondsOfDay({ time_of_day: 25200, period: 'am' }), 25200); // 7:00 AM
  assert.equal(targetSecondsOfDay({ time_of_day: 19800, period: 'pm' }), 63000); // 5:30 PM
  assert.equal(targetSecondsOfDay({ time_of_day: 1800, period: 'pm' }), 45000); // 12:30 PM
  // Robust if PP ever reports absolute seconds with a redundant period.
  assert.equal(targetSecondsOfDay({ time_of_day: 63000, period: 'pm' }), 63000);
  assert.equal(targetSecondsOfDay(null), null);
});

test('parseHms parses remaining time', () => {
  assert.equal(parseHms('07:29:00'), 26940);
  assert.equal(parseHms('00:00:05'), 5);
  assert.equal(parseHms('garbage'), null);
  assert.equal(parseHms(null), null);
});

const TIMER_DEFS = [
  {
    id: { name: 'Service Start Timer', index: 0, uuid: '1DD1' },
    allows_overrun: false,
    count_down_to_time: { time_of_day: 19800, period: 'pm' },
  },
];
const TIMER_CURRENT = [
  { id: { uuid: '1DD1', name: 'Service Start Timer', index: 0 }, time: '07:29:00', state: 'running' },
];

test('parseTimers merges definitions with live values', () => {
  const [t] = parseTimers(TIMER_DEFS, TIMER_CURRENT);
  assert.equal(t.name, 'Service Start Timer');
  assert.equal(t.state, 'running');
  assert.equal(t.remainingSeconds, 26940);
  assert.equal(t.targetSecondsOfDay, 63000);
  assert.equal(t.countsDownToTime, true);
});

test('pickTimer prefers the configured name, then count-down-to-time', () => {
  const timers = [
    { name: 'Sermon Elapsed', countsDownToTime: false },
    { name: 'Service Start Timer', countsDownToTime: true },
  ];
  assert.equal(pickTimer(timers, 'Sermon Elapsed').name, 'Sermon Elapsed');
  assert.equal(pickTimer(timers).name, 'Service Start Timer'); // no config → countdown
  assert.equal(pickTimer([{ name: 'Only', countsDownToTime: false }]).name, 'Only');
  assert.equal(pickTimer([]), null);
});
