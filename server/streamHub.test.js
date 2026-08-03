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

const fakeRes = () => {
  const written = [];
  return { written, write: (chunk) => written.push(chunk) };
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

test('unsubscribe is idempotent and forgets the connection entirely', () => {
  const log = [];
  hub.registerTopic('thing:*', { stop: () => log.push('stop') });
  const res = fakeRes();
  hub.subscribe(res, ['thing:one']);
  hub.unsubscribe(res);
  hub.unsubscribe(res);
  assert.deepEqual(log, ['stop'], 'a double close must not stop the producer twice');
});
