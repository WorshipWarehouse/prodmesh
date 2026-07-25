// A fake ProPresenter HTTP API for tests (imitates the fakeSmaart pattern in
// smaart.test.js). Response shapes mirror the live-API fixtures in
// proPresenter.test.js: playlist_item fields nested under `.id`, slide position
// under `presentation_index`, timers split across /v1/timers (definitions) and
// /v1/timers/current (live values).
//
// Two personalities (both verified against live machines):
//   pp21: false (default) — ProPresenter 7: /v1/playlist/active reports the
//         live item; /v1/playlist/{uuid} resolves uuids.
//   pp21: true — ProPresenter 21: /v1/playlist/active answers all-null even
//         mid-show; /v1/playlist/{uuid} 404s (index paths only, e.g.
//         /v1/playlist/0/0); /v1/playlist/focused carries the playlist_item;
//         playlist items carry presentation_info.presentation_uuid.
//
// Mutable state via setters, so a test can walk PP through a service:
//   srv.setActive(index, name)   — the active playlist item (null = nothing)
//   srv.setSlide(i)              — current slide index
//   srv.setSlideCount(n)         — slides in the active presentation
//   srv.setTimers(defs, currents)
//   srv.setPlaylistItems(names)  — the playlist's items (pp21 resolution)
//   srv.setFocusedIndex(i)       — which item the pp21 UI has selected (null = none)
//   srv.failNextRequests(n)      — next n requests answer HTTP 500 (Infinity = forever)

import http from 'node:http';

export async function fakeProPresenter({
  playlistUuid = 'pl-1',
  playlistName = 'Sunday - Weekend Service',
  pp21 = false,
} = {}) {
  const state = {
    active: null, // { index, name, uuid }
    slideIndex: 0,
    slideCount: 5,
    timers: { defs: [], currents: [] },
    items: [], // [{ index, name }] — the playlist body (pp21 resolution path)
    focusedIndex: null, // pp21: which playlist item the UI has selected
    totalCues: null, // PP 21.4+: total_cues in slide_index
  };
  const seen = { requests: 0, paths: [] };
  let failRemaining = 0;

  // Distinct presentation uuid per playlist item, so the poller's slide-count
  // cache refreshes when the active item changes (as it does live).
  const presUuid = (index) => (index == null ? null : `pres-${index}`);

  const playlistItem = ({ index, name }) => ({
    id: { uuid: `item-${index}`, name, index },
    type: 'presentation',
    is_pco: true,
    presentation_info: { presentation_uuid: presUuid(index), arrangement_uuid: '', arrangement_name: '' },
  });

  const srv = http.createServer((req, res) => {
    seen.requests += 1;
    seen.paths.push(req.url);
    if (failRemaining > 0) {
      failRemaining -= 1;
      res.statusCode = 500;
      return res.end('simulated failure');
    }
    const json = (body) => {
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify(body));
    };
    const a = state.active;
    const playlistId = { uuid: playlistUuid, name: playlistName, index: 0 };
    const playlistBody = () => json({ id: playlistId, items: state.items.map(playlistItem) });

    // PP 21 addresses playlists by index path; PP 7 by uuid.
    if (pp21 && req.url === '/v1/playlist/0/0') return playlistBody();
    if (!pp21 && req.url === `/v1/playlist/${playlistUuid}`) return playlistBody();

    switch (req.url) {
      case '/version':
        return json({
          name: 'FAKE-PP',
          platform: 'test',
          host_description: pp21 ? 'ProPresenter 21.1' : 'ProPresenter 7.9',
          api_version: 'v1',
        });
      case '/v1/playlist/active':
        if (pp21) {
          // PP 21 answers all-null here even while a presentation is live.
          return json({
            presentation: { playlist: null, item: null, playlist_item: null },
            announcements: { playlist: null, item: null, playlist_item: null },
          });
        }
        return json({
          presentation: {
            playlist: playlistId,
            playlist_item: a
              ? {
                  id: { uuid: a.uuid, name: a.name, index: a.index },
                  type: 'presentation',
                  presentation_info: { arrangement_uuid: '', arrangement_name: '' },
                }
              : null,
          },
        });
      case '/v1/playlist/focused': {
        const f = state.items.find((it) => it.index === state.focusedIndex) ?? null;
        return json({
          playlist: playlistId,
          item: f ? { uuid: `item-${f.index}`, name: f.name, index: 4294967295 } : null,
          playlist_item: f ? playlistItem(f) : null,
        });
      }
      case '/v1/playlists':
        return json([
          {
            field_type: 'group',
            id: { uuid: 'group-1', name: 'SUNDAYS', index: 0 },
            children: [{ field_type: 'playlist', id: playlistId }],
          },
        ]);
      case '/v1/presentation/slide_index':
        return json({
          presentation_index: a
            ? {
                index: state.slideIndex,
                presentation_id: { uuid: presUuid(a.index), name: a.name },
                // PP 21.4+ reports the arrangement-aware total here.
                ...(state.totalCues != null ? { total_cues: state.totalCues } : {}),
              }
            : null,
        });
      case '/v1/presentation/active':
        return json({
          presentation: {
            id: { uuid: presUuid(a?.index), name: a?.name ?? '' },
            current_arrangement: '',
            groups: [{ uuid: 'g1', slides: Array.from({ length: state.slideCount }, () => ({})) }],
            arrangements: [],
          },
        });
      case '/v1/timers':
        return json(state.timers.defs);
      case '/v1/timers/current':
        return json(state.timers.currents);
      default:
        res.statusCode = 404;
        return res.end('not found');
    }
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));

  return {
    seen,
    setActive(index, name) {
      state.active = index == null ? null : { index, name, uuid: `item-${index}` };
    },
    setSlide(i) {
      state.slideIndex = i;
    },
    setSlideCount(n) {
      state.slideCount = n;
    },
    setTotalCues(n) {
      state.totalCues = n;
    },
    setTimers(defs, currents) {
      state.timers = { defs, currents };
    },
    setPlaylistItems(names) {
      state.items = names.map((name, index) => ({ index, name }));
    },
    setFocusedIndex(i) {
      state.focusedIndex = i;
    },
    failNextRequests(n) {
      failRemaining = n;
    },
    port: () => srv.address().port,
    close: () => {
      srv.closeAllConnections?.();
      return new Promise((r) => srv.close(r));
    },
  };
}
