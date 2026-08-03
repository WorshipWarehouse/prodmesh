// The YouTube Live client: parsing, quota discipline, and the failure modes
// that are ordinary states rather than errors.

import test, { beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.PRODMESH_DATA_DIR = mkdtempSync(join(tmpdir(), 'prodmesh-yt-'));
process.env.PRODMESH_SECRET_YOUTUBE_APIKEY = 'test-key';

const yt = await import('./youtube.js');

// Stand-in for fetch, recording every call so quota behaviour is assertable.
let calls;
let handler;
let keepAlive;
const realFetch = globalThis.fetch;

beforeEach(() => {
  // watchViewers sleeps on UNREF'd timers on purpose — an idle watcher must
  // not hold an otherwise-finished process open. Under the test runner that
  // means the loop drains mid-await and the test is cancelled, so hold it.
  keepAlive = setInterval(() => {}, 1000);
  calls = [];
  handler = () => ({ items: [] });
  globalThis.fetch = async (url) => {
    const u = new URL(url);
    calls.push({ path: u.pathname.split('/').pop(), params: Object.fromEntries(u.searchParams) });
    const out = handler(u);
    if (out instanceof Error) throw out;
    if (out.__status) {
      return { ok: false, status: out.__status, json: async () => out.body };
    }
    return { ok: true, status: 200, json: async () => out };
  };
});
afterEach(() => {
  clearInterval(keepAlive);
  globalThis.fetch = realFetch;
});

const liveVideo = (viewers) => ({
  items: [{
    liveStreamingDetails: {
      actualStartTime: '2026-08-09T17:00:00Z',
      concurrentViewers: viewers == null ? undefined : String(viewers),
    },
    snippet: { title: 'Sunday Service' },
  }],
});

test('isConfigured needs somewhere to look', () => {
  assert.equal(yt.isConfigured(null), false);
  assert.equal(yt.isConfigured({}), false);
  assert.equal(yt.isConfigured({ channelId: 'UC123' }), true);
  assert.equal(yt.isConfigured({ videoId: 'abc' }), true);
  assert.equal(yt.isConfigured({ mock: true }), true);
});

test('readVideo parses the viewer count, which arrives as a STRING', () => {
  handler = () => liveVideo('1234');
  return yt.readVideo('vid1').then((v) => {
    assert.equal(v.live, true);
    assert.strictEqual(v.viewers, 1234, 'must be a number, not "1234"');
    assert.equal(v.title, 'Sunday Service');
  });
});

test('a hidden viewer counter reads as null, not zero and not an error', async () => {
  // The broadcaster can switch the count off. Zero would be a lie that lands
  // in a report; null means "not published".
  handler = () => liveVideo(null);
  const v = await yt.readVideo('vid1');
  assert.equal(v.live, true);
  assert.equal(v.viewers, null);
});

test('an ended broadcast is not live even though it has a start time', async () => {
  handler = () => ({
    items: [{
      liveStreamingDetails: {
        actualStartTime: '2026-08-09T17:00:00Z',
        actualEndTime: '2026-08-09T18:30:00Z',
        concurrentViewers: '5',
      },
      snippet: { title: 'Sunday Service' },
    }],
  });
  const v = await yt.readVideo('vid1');
  assert.equal(v.live, false);
});

test('an unknown video id is empty rather than an exception', async () => {
  handler = () => ({ items: [] });
  assert.deepEqual(await yt.readVideo('nope'), { live: false, viewers: null, title: null });
});

test('the API key never appears in an error message', async () => {
  handler = () => ({ __status: 404, body: {} });
  await assert.rejects(
    () => yt.readVideo('vid1'),
    (err) => {
      assert.ok(!err.message.includes('test-key'), `key leaked: ${err.message}`);
      assert.match(err.message, /HTTP 404/);
      return true;
    },
  );
});

test('quota exhaustion says so, instead of looking like a permissions problem', async () => {
  handler = () => ({
    __status: 403,
    body: { error: { errors: [{ reason: 'quotaExceeded' }] } },
  });
  await assert.rejects(() => yt.readVideo('vid1'), /quota exceeded/i);
});

test('watchViewers resolves the live video once, then polls only videos.list', async () => {
  // search.list costs 100 units against 10,000/day; videos.list costs 1. The
  // whole design of this module is that ratio, so it is worth asserting.
  handler = (u) =>
    u.pathname.endsWith('/search')
      ? { items: [{ id: { videoId: 'found1' } }] }
      : liveVideo(42);

  const seen = [];
  const ctl = new AbortController();
  const run = yt.watchViewers({ channelId: 'UC1' }, (s) => {
    seen.push(s);
    if (seen.length >= 3) ctl.abort();
  }, ctl.signal, 1);
  await run;

  const searches = calls.filter((c) => c.path === 'search').length;
  const reads = calls.filter((c) => c.path === 'videos').length;
  assert.equal(searches, 1, 'the expensive call must not repeat per poll');
  assert.ok(reads >= 3, `expected repeated cheap reads, got ${reads}`);
  assert.equal(seen[0].viewers, 42);
  assert.equal(seen[0].videoId, 'found1');
});

test('a configured video id skips the search entirely', async () => {
  handler = () => liveVideo(7);
  const ctl = new AbortController();
  await yt.watchViewers({ videoId: 'fixed1' }, () => ctl.abort(), ctl.signal, 1);
  assert.equal(calls.filter((c) => c.path === 'search').length, 0);
});

test('nothing live emits null — the ordinary state for most of the week', async () => {
  handler = (u) => (u.pathname.endsWith('/search') ? { items: [] } : liveVideo(1));
  const ctl = new AbortController();
  const seen = [];
  await yt.watchViewers({ channelId: 'UC1' }, (s) => { seen.push(s); ctl.abort(); }, ctl.signal, 1);
  assert.equal(seen[0], null);
});

test('a failing API never rejects at the caller — a show must not depend on it', async () => {
  handler = () => new Error('network down');
  const ctl = new AbortController();
  const seen = [];
  // Resolves rather than throws: showManager fires this and does not await it.
  await yt.watchViewers({ videoId: 'v' }, (s) => { seen.push(s); ctl.abort(); }, ctl.signal, 1);
  assert.equal(seen[0], null);
});

test('listBroadcasts merges live + scheduled and fetches times in ONE batched call', async () => {
  // search.list is 100 units each; videos.list takes up to 50 ids for 1. The
  // scheduled time is the whole reason for that third call — pre-created
  // broadcasts share a title and are only distinguishable by when they start.
  handler = (u) => {
    if (u.pathname.endsWith('/search')) {
      return u.searchParams.get('eventType') === 'live'
        ? { items: [{ id: { videoId: 'liveOne' } }] }
        : { items: [{ id: { videoId: 'later' } }, { id: { videoId: 'sooner' } }] };
    }
    return {
      items: [
        { id: 'later', snippet: { title: 'Sunday Service' },
          liveStreamingDetails: { scheduledStartTime: '2026-08-09T16:30:00Z' } },
        { id: 'sooner', snippet: { title: 'Sunday Service' },
          liveStreamingDetails: { scheduledStartTime: '2026-08-09T15:00:00Z' } },
        { id: 'liveOne', snippet: { title: 'Nights of Worship' },
          liveStreamingDetails: { actualStartTime: '2026-08-09T14:00:00Z' } },
      ],
    };
  };

  const out = await yt.listBroadcasts('UC1');
  assert.equal(calls.filter((c) => c.path === 'videos').length, 1, 'details must be ONE batched call');
  assert.equal(calls.find((c) => c.path === 'videos').params.id.split(',').length, 3);
  // Soonest first, so the live one (already started) leads.
  assert.deepEqual(out.map((b) => b.videoId), ['liveOne', 'sooner', 'later']);
  assert.equal(out[0].live, true);
  assert.equal(out[1].scheduledStart, '2026-08-09T15:00:00Z');
  // Identical titles: the caller needs the time to tell these apart.
  assert.equal(out[1].title, out[2].title);
});

test('listBroadcasts skips the details call when the channel has nothing on', async () => {
  handler = () => ({ items: [] });
  assert.deepEqual(await yt.listBroadcasts('UC1'), []);
  assert.equal(calls.filter((c) => c.path === 'videos').length, 0, 'no ids, no quota spent');
});

test('mock mode produces a plausible curve and makes no requests at all', async () => {
  const ctl = new AbortController();
  const seen = [];
  await yt.watchViewers({ mock: true }, (s) => { seen.push(s); ctl.abort(); }, ctl.signal, 1);
  assert.ok(seen[0].viewers >= 0);
  assert.equal(calls.length, 0, 'mock must never reach the network');
});
