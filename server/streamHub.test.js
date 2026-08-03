// The topic hub in isolation. reset() drops every registration, including the
// app's own — so this file must never import ./index.js. The endpoint that
// rides on the hub is exercised in streamApi.test.js, which needs the real
// registrations intact and therefore has to be a separate process.

import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.PRODMESH_DATA_DIR = mkdtempSync(join(tmpdir(), 'prodmesh-hub-'));
const hub = await import('./streamHub.js');

// `accepts` models the socket buffer: once it is 0, write() returns false the
// way Node's does when the kernel buffer is full, and nothing moves until the
// test fires 'drain'.
const fakeRes = (accepts = Infinity) => {
  const written = [];
  const drainListeners = [];
  return {
    written,
    write(chunk) {
      written.push(chunk);
      accepts -= 1;
      // Node accepts the write that fills the buffer and returns false on it:
      // "taken, now stop". Anything after that is buffered in memory — which
      // is precisely the growth conflation exists to prevent.
      return accepts > 0;
    },
    once(event, fn) {
      if (event === 'drain') drainListeners.push(fn);
    },
    /** Let the socket accept `n` more writes and deliver the drain event. */
    drain(n) {
      accepts = n;
      const fns = drainListeners.splice(0);
      for (const fn of fns) fn();
    },
  };
};

const frames = (res) =>
  res.written.filter((c) => !c.startsWith(':')).map((c) => JSON.parse(c.split('data: ')[1]));

beforeEach(() => hub.reset());

test('a producer starts on the first subscriber and stops on the last', () => {
  const log = [];
  hub.registerTopic('thing:*', {
    start: (id) => log.push(`start:${id}`),
    stop: (id) => log.push(`stop:${id}`),
  });

  const a = fakeRes();
  const b = fakeRes();
  hub.subscribe(a, ['thing:one']);
  hub.subscribe(b, ['thing:one']);
  assert.deepEqual(log, ['start:one'], 'the second subscriber must not restart the producer');
  assert.equal(hub.subscriberCount('thing:one'), 2);

  hub.unsubscribe(a);
  assert.deepEqual(log, ['start:one'], 'still watched — the producer keeps running');

  hub.unsubscribe(b);
  assert.deepEqual(log, ['start:one', 'stop:one']);
  assert.equal(hub.subscriberCount('thing:one'), 0);
});

test('subscribing twice to the same topic refcounts once', () => {
  const log = [];
  hub.registerTopic('thing:*', { start: () => log.push('start'), stop: () => log.push('stop') });
  const a = fakeRes();
  hub.subscribe(a, ['thing:one', 'thing:one']);
  hub.unsubscribe(a);
  assert.deepEqual(log, ['start', 'stop']);
});

test('unknown and invalid topics are dropped, valid siblings still connect', () => {
  hub.registerTopic('room:*:spl', { valid: (id) => id === 'known' });

  assert.equal(hub.isValidTopic('room:known:spl'), true);
  assert.equal(hub.isValidTopic('room:ghost:spl'), false, 'valid() must gate unknown rooms');
  assert.equal(hub.isValidTopic('nothing:publishes:this'), false);
  assert.equal(hub.isValidTopic('room:known'), false, 'segment count must match');

  // One dead widget in a saved dashboard must not cost the others their data.
  const res = fakeRes();
  hub.subscribe(res, ['room:ghost:spl', 'made:up', 'room:known:spl']);
  assert.equal(hub.subscriberCount('room:known:spl'), 1);
  assert.equal(hub.subscriberCount('room:ghost:spl'), 0);
});

test('a joiner gets the snapshot; publish reaches only that topic', () => {
  hub.registerTopic('room:*:spl', { snapshot: (id) => ({ id, current: 85 }) });
  hub.registerTopic('room:*:show', { snapshot: () => ({ active: false }) });

  const res = fakeRes();
  hub.subscribe(res, ['room:a:spl', 'room:a:show']);
  assert.deepEqual(frames(res), [
    { topic: 'room:a:spl', data: { id: 'a', current: 85 } },
    { topic: 'room:a:show', data: { active: false } },
  ]);

  hub.publish('room:a:spl', { current: 91 });
  hub.publish('room:b:spl', { current: 70 }); // nobody is watching room b
  assert.deepEqual(frames(res).at(-1), { topic: 'room:a:spl', data: { current: 91 } });
  assert.equal(frames(res).length, 3);
});

test('a topic with no snapshot replays its last published value to a joiner', () => {
  hub.registerTopic('thing:*', {});
  const first = fakeRes();
  hub.subscribe(first, ['thing:one']);
  hub.publish('thing:one', { n: 1 });

  const second = fakeRes();
  hub.subscribe(second, ['thing:one']);
  assert.deepEqual(frames(second), [{ topic: 'thing:one', data: { n: 1 } }]);
});

test('the retained value is dropped once the producer stops', () => {
  hub.registerTopic('thing:*', {});
  const a = fakeRes();
  hub.subscribe(a, ['thing:one']);
  hub.publish('thing:one', { n: 1 });
  hub.unsubscribe(a); // producer stopped — anything retained is stale by definition

  const b = fakeRes();
  hub.subscribe(b, ['thing:one']);
  assert.deepEqual(frames(b), [], 'a joiner must not be painted with a stale value');
});

test('topics per connection are capped', () => {
  hub.registerTopic('thing:*', {});
  const res = fakeRes();
  hub.subscribe(res, Array.from({ length: hub.MAX_TOPICS + 25 }, (_, i) => `thing:${i}`));
  const held = Array.from({ length: hub.MAX_TOPICS + 25 }, (_, i) => `thing:${i}`)
    .filter((t) => hub.subscriberCount(t) > 0);
  assert.equal(held.length, hub.MAX_TOPICS);
});

test('a custom sink replaces the default frame writer', () => {
  hub.registerTopic('thing:*', { snapshot: () => 1 });
  const got = [];
  const res = fakeRes();
  hub.subscribe(res, ['thing:one'], (topic, data) => got.push([topic, data]));
  hub.publish('thing:one', 2);
  assert.deepEqual(got, [['thing:one', 1], ['thing:one', 2]]);
  assert.deepEqual(res.written, [], 'the sink owns the wire; nothing default-writes');
});

// ── Backpressure ─────────────────────────────────────────────────────────────

test('a backed-up subscriber gets the LATEST value per topic, not a backlog', () => {
  hub.registerTopic('room:*:spl', {});
  const res = fakeRes(1); // accepts the first write, then reports full
  hub.subscribe(res, ['room:a:spl']);

  hub.publish('room:a:spl', { current: 80 }); // goes out, socket now full
  hub.publish('room:a:spl', { current: 81 }); // conflated…
  hub.publish('room:a:spl', { current: 82 }); // …superseded
  hub.publish('room:a:spl', { current: 83 }); // …superseded again
  assert.equal(res.written.length, 1, 'nothing queues behind a full socket');

  res.drain(10);
  assert.equal(res.written.length, 2, 'one catch-up frame, not three');
  assert.deepEqual(frames(res).at(-1), { topic: 'room:a:spl', data: { current: 83 } });
});

test('conflation is per topic — a room\'s loudness never supersedes its mode', () => {
  hub.registerTopic('room:*:spl', {});
  hub.registerTopic('room:*:mode', {});
  const res = fakeRes(1);
  hub.subscribe(res, ['room:a:spl', 'room:a:mode']);

  hub.publish('room:a:spl', { current: 80 }); // out; socket full after this
  hub.publish('room:a:spl', { current: 88 });
  hub.publish('room:a:mode', { mode: 'show' });
  hub.publish('room:a:spl', { current: 91 });

  res.drain(10);
  const delivered = frames(res).slice(1);
  assert.deepEqual(delivered, [
    { topic: 'room:a:spl', data: { current: 91 } },
    { topic: 'room:a:mode', data: { mode: 'show' } },
  ]);
});

test('a socket still full after draining keeps conflating', () => {
  hub.registerTopic('thing:*', {});
  const res = fakeRes(1);
  hub.subscribe(res, ['thing:a', 'thing:b']);

  hub.publish('thing:a', 1); // out; full
  hub.publish('thing:a', 2);
  hub.publish('thing:b', 3);

  res.drain(0); // room for exactly one, then full again
  assert.equal(res.written.length, 2);
  hub.publish('thing:b', 4); // must conflate, not queue

  res.drain(10);
  assert.deepEqual(frames(res).at(-1), { topic: 'thing:b', data: 4 });
  assert.equal(res.written.length, 3, 'b was delivered once, at its newest value');
});

test('the frame is serialized once per publish, not once per subscriber', () => {
  let serialized = 0;
  hub.registerTopic('thing:*', {});
  const subs = Array.from({ length: 5 }, () => fakeRes());
  for (const res of subs) hub.subscribe(res, ['thing:one']);

  // A value that counts how often JSON.stringify walks it.
  hub.publish('thing:one', { toJSON: () => { serialized += 1; return 'v'; } });

  assert.equal(serialized, 1, 'one serialization for the whole fan-out');
  for (const res of subs) assert.equal(res.written.length, 1, 'every subscriber still got it');
});

test('a dropped connection takes its conflated frames with it', () => {
  hub.registerTopic('thing:*', {});
  const res = fakeRes(1);
  hub.subscribe(res, ['thing:one']);
  hub.publish('thing:one', 1);
  hub.publish('thing:one', 2); // pending

  hub.unsubscribe(res);
  res.drain(10); // the drain fires after the client is gone
  assert.equal(res.written.length, 1, 'nothing is written to a closed connection');
});

test('unsubscribe is idempotent and forgets the connection entirely', () => {
  const log = [];
  hub.registerTopic('thing:*', { stop: () => log.push('stop') });
  const res = fakeRes();
  hub.subscribe(res, ['thing:one']);
  hub.unsubscribe(res);
  hub.unsubscribe(res);
  assert.deepEqual(log, ['stop'], 'a double close must not stop the producer twice');
});
