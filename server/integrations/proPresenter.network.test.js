// Network-path tests for the ProPresenter client (the parsers have their own
// pure tests in proPresenter.test.js) — reads and the run-state poller against
// a fake PP HTTP server.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readActive, readSlide, readTimers, pollRunState } from './proPresenter.js';
import { fakeProPresenter } from './fakeProPresenter.js';

const pp = (srv) => ({ host: '127.0.0.1', port: srv.port() });

async function waitFor(predicate, what, timeoutMs = 4000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    if (predicate()) return;
    await new Promise((r) => setTimeout(r, 15));
  }
  assert.fail(`timed out waiting for ${what}`);
}

test('readActive fetches and parses the active playlist item', async () => {
  const srv = await fakeProPresenter({ playlistName: 'Sunday Morning' });
  try {
    srv.setActive(2, 'Announcements');
    const active = await readActive(pp(srv));
    assert.deepEqual(active, {
      index: 2,
      name: 'Announcements',
      uuid: 'item-2',
      arrangementUuid: null,
      arrangementName: null,
      playlistName: 'Sunday Morning',
    });
    assert.deepEqual(srv.seen.paths, ['/v1/playlist/active']);

    // Nothing triggered → all-null shape, not an error.
    srv.setActive(null);
    assert.equal((await readActive(pp(srv))).index, null);
  } finally {
    await srv.close();
  }
});

test('readSlide fetches the current slide position', async () => {
  const srv = await fakeProPresenter();
  try {
    srv.setActive(4, 'Praise');
    srv.setSlide(3);
    assert.deepEqual(await readSlide(pp(srv)), {
      slideIndex: 3,
      presUuid: 'pres-4',
      presName: 'Praise',
    });
  } finally {
    await srv.close();
  }
});

test('readTimers merges /v1/timers definitions with /v1/timers/current values', async () => {
  const srv = await fakeProPresenter();
  try {
    srv.setTimers(
      [{ id: { name: 'Service Start Timer', index: 0, uuid: '1DD1' }, count_down_to_time: { time_of_day: 19800, period: 'pm' } }],
      [{ id: { uuid: '1DD1', name: 'Service Start Timer', index: 0 }, time: '00:07:30', state: 'running' }],
    );
    const [t] = await readTimers(pp(srv));
    assert.deepEqual(t, {
      uuid: '1DD1',
      name: 'Service Start Timer',
      state: 'running',
      remainingSeconds: 450,
      targetSecondsOfDay: 63000,
      countsDownToTime: true,
    });
  } finally {
    await srv.close();
  }
});

test('pollRunState reports the initial state, then only changes', async () => {
  const srv = await fakeProPresenter();
  const ctl = new AbortController();
  const states = [];
  try {
    srv.setActive(0, 'Countdown');
    srv.setSlide(0);
    srv.setSlideCount(4);
    const done = pollRunState(pp(srv), (s) => states.push(s), ctl.signal, 30);

    await waitFor(() => states.length >= 1, 'the initial state');
    assert.deepEqual(states[0], {
      itemIndex: 0,
      itemName: 'Countdown',
      slideIndex: 0,
      slideCount: 4,
      presName: 'Countdown',
    });

    // Nothing changes → several polls, zero further callbacks.
    await new Promise((r) => setTimeout(r, 150));
    assert.equal(states.length, 1, 'no change must not re-emit');

    srv.setSlide(1);
    await waitFor(() => states.length >= 2, 'the slide advance');
    assert.equal(states.at(-1).slideIndex, 1);
    assert.equal(states.at(-1).slideCount, 4);

    // New item → new presentation → the slide count refreshes.
    srv.setActive(3, 'Worship Set');
    srv.setSlide(0);
    srv.setSlideCount(9);
    await waitFor(
      () => states.at(-1).itemIndex === 3 && states.at(-1).slideCount === 9,
      'the item change with a fresh slide count',
    );
    assert.equal(states.at(-1).itemName, 'Worship Set');

    ctl.abort();
    await done; // resolves cleanly on abort
  } finally {
    ctl.abort();
    await srv.close();
  }
});

test('pollRunState tolerates two consecutive failures and recovers', async () => {
  const srv = await fakeProPresenter();
  const ctl = new AbortController();
  const states = [];
  try {
    srv.setActive(1, 'Welcome');
    srv.setSlide(0);
    const done = pollRunState(pp(srv), (s) => states.push(s), ctl.signal, 30);
    await waitFor(() => states.length >= 1, 'the initial state');

    // One poll cycle = 2 requests (readActive + readSlide), so 4 failing
    // requests = exactly 2 failed cycles — under the 3-strike limit.
    srv.failNextRequests(4);
    srv.setSlide(2);
    await waitFor(() => states.some((s) => s.slideIndex === 2), 'recovery after 2 failed cycles');

    ctl.abort();
    await done;
  } finally {
    ctl.abort();
    await srv.close();
  }
});

test('pollRunState throws after three consecutive failures (server gone)', async () => {
  const srv = await fakeProPresenter();
  const ctl = new AbortController();
  try {
    srv.setActive(1, 'Welcome');
    const states = [];
    const done = pollRunState(pp(srv), (s) => states.push(s), ctl.signal, 30);
    await waitFor(() => states.length >= 1, 'the initial state');

    srv.failNextRequests(Infinity); // PP is now persistently broken
    await assert.rejects(done, /ProPresenter 500/);
  } finally {
    ctl.abort();
    await srv.close();
  }
});
