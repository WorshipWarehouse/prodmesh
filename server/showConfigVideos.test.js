// Per-service-time YouTube pins.
//
// The case this exists for: a channel pre-creates one broadcast per service,
// so an 8:00 and a 9:30 on the SAME plan are different videos. A room-level
// pin would attribute both services to one broadcast and report identical
// numbers twice.

import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.PRODMESH_DATA_DIR = mkdtempSync(join(tmpdir(), 'prodmesh-yt-pin-'));
const showConfig = await import('./showConfig.js');
const connectivity = await import('./connectivity.js');

const ROOM = 'north-main';
const PLAN = 'plan-1';

beforeEach(() => showConfig.clearConfig(ROOM, PLAN));

test('two service times on one plan hold different broadcasts', () => {
  const saved = showConfig.setConfig(ROOM, PLAN, {
    videos: { 't-8am': 'vid8amAAA', 't-930': 'vid930BBB' },
  });
  assert.deepEqual(saved.videos, { 't-8am': 'vid8amAAA', 't-930': 'vid930BBB' });
  assert.deepEqual(showConfig.getConfig(ROOM, PLAN).videos, {
    't-8am': 'vid8amAAA',
    't-930': 'vid930BBB',
  });
});

test('the three states are distinct: absent = auto, null = not streamed, id = pinned', () => {
  // The absent/null distinction is load-bearing. A plan with five service
  // times often streams two; on auto the other three would record a broadcast
  // left running from an earlier service and attribute it to a service nobody
  // watched online.
  const saved = showConfig.setConfig(ROOM, PLAN, {
    videos: { 't-8am': 'vid8amAAA', 't-930': null, 't-11am': '' },
  });
  assert.equal(saved.videos['t-8am'], 'vid8amAAA', 'pinned');
  assert.equal(saved.videos['t-930'], null, 'not streamed — kept, not dropped');
  assert.equal('t-11am' in saved.videos, false, 'auto — the default is not stored');

  // And it survives the round trip through SQLite's JSON column.
  const read = showConfig.getConfig(ROOM, PLAN);
  assert.equal(read.videos['t-930'], null);
  assert.equal('t-930' in read.videos, true, 'null must not be lost as "absent"');
  assert.equal('t-11am' in read.videos, false);
});

test('pins survive alongside the automation settings in one record', () => {
  // Both editors write the same row; neither may erase the other.
  const saved = showConfig.setConfig(ROOM, PLAN, {
    startItemId: 'i-welcome',
    endItemId: 'i-message',
    videos: { 't-8am': 'vid8amAAA' },
  });
  assert.equal(saved.startItemId, 'i-welcome');
  assert.equal(saved.endItemId, 'i-message');
  assert.deepEqual(saved.videos, { 't-8am': 'vid8amAAA' });
});

test('a video id that could reshape a request URL is refused', () => {
  // Interpolated into a YouTube API URL — same reasoning as validateHost.
  for (const bad of ['../../evil', 'abc/def', 'a?b=c', 'a#b', 'a b', 'x'.repeat(33)]) {
    assert.throws(
      () => showConfig.setConfig(ROOM, PLAN, { videos: { 't-8am': bad } }),
      /video id/i,
      `should have refused ${JSON.stringify(bad)}`,
    );
  }
});

test('config with no videos key still validates, defaulting to no pins', () => {
  const saved = showConfig.setConfig(ROOM, PLAN, { startItemId: 'i-1' });
  assert.deepEqual(saved.videos, {});
});

test('the ROOM holds a channel and deliberately cannot hold a video', () => {
  const clean = connectivity.validateYouTube({ channelId: 'UCabc123', videoId: 'shouldBeIgnored' });
  assert.deepEqual(clean, { channelId: 'UCabc123' });
  assert.equal(connectivity.validateYouTube({ videoId: 'onlyAVideo' }), null,
    'a video alone must not configure a room — that is the mis-scoped pin this replaced');
});

test('a channel id that could reshape a request URL is refused', () => {
  for (const bad of ['UC/../x', 'UC?a=b', 'UC#frag', 'a'.repeat(65)]) {
    assert.throws(() => connectivity.validateYouTube({ channelId: bad }), /Channel ID/i);
  }
});
