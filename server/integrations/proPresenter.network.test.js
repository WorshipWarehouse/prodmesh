// Network-path tests for the ProPresenter client (the parsers have their own
// pure tests in proPresenter.test.js) — reads and the run-state poller against
// a fake PP HTTP server.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readActive, readSlide, readTimers, readPlaylistItems, pollRunState } from './proPresenter.js';
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
      totalCues: null,
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

    // A poll cycle starts with readSlide, which fails the whole cycle, so 2
    // failing requests = exactly 2 failed cycles — under the 3-strike limit.
    srv.failNextRequests(2);
    srv.setSlide(2);
    await waitFor(() => states.some((s) => s.slideIndex === 2), 'recovery after 2 failed cycles');

    ctl.abort();
    await done;
  } finally {
    ctl.abort();
    await srv.close();
  }
});

// ── ProPresenter 21 ──────────────────────────────────────────────────────────
//  /v1/playlist/active answers all-null mid-show and uuid playlist routes 404
//  (see the compatibility block in proPresenter.js) — the client resolves the
//  live item by presentation uuid instead.

test('readActive resolves the live item on PP 21 (focused hit, drift scan, library miss)', async () => {
  const srv = await fakeProPresenter({ pp21: true, playlistName: 'Sunday Morning' });
  try {
    srv.setPlaylistItems(['Pre-Service Slides', 'Announcements', 'Worship']);

    // Common case: triggering an item also selects it → focused direct hit.
    srv.setActive(1, 'Announcements');
    srv.setFocusedIndex(1);
    let active = await readActive(pp(srv));
    assert.equal(active.index, 1);
    assert.equal(active.name, 'Announcements');
    assert.equal(active.playlistName, 'Sunday Morning');
    assert.ok(!srv.seen.paths.includes('/v1/playlist/0/0'), 'direct hit needs no playlist fetch');

    // Selection drifted (operator arrowing around) → scan the playlist items.
    srv.setActive(2, 'Worship');
    srv.setFocusedIndex(0);
    active = await readActive(pp(srv));
    assert.equal(active.index, 2);
    assert.equal(active.name, 'Worship');
    assert.ok(srv.seen.paths.includes('/v1/playlist/0/0'), 'scan fetches by index path');

    // A presentation launched outside the playlist resolves to nothing —
    // and the miss is remembered, so repeats don't refetch the playlist.
    srv.setActive(7, 'Library Slide');
    assert.equal((await readActive(pp(srv))).index, null);
    const fetches = srv.seen.paths.filter((p) => p === '/v1/playlist/0/0').length;
    assert.equal((await readActive(pp(srv))).index, null);
    assert.equal(srv.seen.paths.filter((p) => p === '/v1/playlist/0/0').length, fetches);
  } finally {
    await srv.close();
  }
});

test('pollRunState tracks a PP 21 service end to end', async () => {
  const srv = await fakeProPresenter({ pp21: true });
  const ctl = new AbortController();
  const states = [];
  try {
    srv.setPlaylistItems(['Countdown', 'Welcome', 'Worship Set']);
    srv.setActive(0, 'Countdown');
    srv.setFocusedIndex(0);
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

    srv.setActive(2, 'Worship Set');
    srv.setFocusedIndex(2);
    srv.setSlide(0);
    srv.setSlideCount(9);
    await waitFor(
      () => states.at(-1).itemIndex === 2 && states.at(-1).slideCount === 9,
      'the item change with a fresh slide count',
    );
    assert.equal(states.at(-1).itemName, 'Worship Set');

    ctl.abort();
    await done;
  } finally {
    ctl.abort();
    await srv.close();
  }
});

test('pollRunState prefers PP 21.4 total_cues and skips the presentation read', async () => {
  const srv = await fakeProPresenter({ pp21: true });
  const ctl = new AbortController();
  const states = [];
  try {
    srv.setPlaylistItems(['Riverside']);
    srv.setActive(0, 'Riverside');
    srv.setFocusedIndex(0);
    srv.setSlide(1);
    srv.setSlideCount(21); // the raw group sum — WRONG for this arrangement
    srv.setTotalCues(35); // what PP itself says the arrangement plays
    const done = pollRunState(pp(srv), (s) => states.push(s), ctl.signal, 30);

    await waitFor(() => states.length >= 1, 'the initial state');
    assert.equal(states[0].slideCount, 35);
    assert.ok(
      !srv.seen.paths.includes('/v1/presentation/active'),
      'total_cues makes the presentation read unnecessary',
    );

    ctl.abort();
    await done;
  } finally {
    ctl.abort();
    await srv.close();
  }
});

test('readPlaylistItems addresses playlists by uuid on PP 7 and index path on PP 21', async () => {
  const plan = { title: 'Weekend Service', dates: 'July 26, 2026' };
  for (const pp21 of [false, true]) {
    const srv = await fakeProPresenter({ pp21 });
    try {
      srv.setPlaylistItems(['Pre-Service Slides', 'Announcements']);
      const got = await readPlaylistItems(pp(srv), undefined, plan);
      assert.equal(got.matched, true, `pp21=${pp21}`);
      assert.deepEqual(
        got.items.map((it) => it.name),
        ['Pre-Service Slides', 'Announcements'],
        `pp21=${pp21}`,
      );
      const wanted = pp21 ? '/v1/playlist/0/0' : '/v1/playlist/pl-1';
      assert.ok(srv.seen.paths.includes(wanted), `pp21=${pp21} fetched ${wanted}`);
    } finally {
      await srv.close();
    }
  }
});

test('readPlaylistItems without a plan falls back to the focused playlist on PP 21', async () => {
  const srv = await fakeProPresenter({ pp21: true });
  try {
    srv.setPlaylistItems(['Pre-Service Slides']);
    const got = await readPlaylistItems(pp(srv));
    assert.equal(got.matched, false);
    assert.deepEqual(got.items.map((it) => it.name), ['Pre-Service Slides']);
  } finally {
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
