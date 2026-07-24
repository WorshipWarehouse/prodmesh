// A fake ProPresenter 7.9+ HTTP API for tests (imitates the fakeSmaart pattern
// in smaart.test.js). Response shapes mirror the live-API fixtures in
// proPresenter.test.js: playlist_item fields nested under `.id`, slide position
// under `presentation_index`, timers split across /v1/timers (definitions) and
// /v1/timers/current (live values).
//
// Mutable state via setters, so a test can walk PP through a service:
//   srv.setActive(index, name)  — the active playlist item (null = nothing)
//   srv.setSlide(i)             — current slide index
//   srv.setSlideCount(n)        — slides in the active presentation
//   srv.setTimers(defs, currents)
//   srv.failNextRequests(n)     — next n requests answer HTTP 500 (Infinity = forever)

import http from 'node:http';

export async function fakeProPresenter({ playlistUuid = 'pl-1', playlistName = 'Sunday - Weekend Service' } = {}) {
  const state = {
    active: null, // { index, name, uuid }
    slideIndex: 0,
    slideCount: 5,
    timers: { defs: [], currents: [] },
  };
  const seen = { requests: 0, paths: [] };
  let failRemaining = 0;

  // Distinct presentation uuid per playlist item, so the poller's slide-count
  // cache refreshes when the active item changes (as it does live).
  const presUuid = () => (state.active ? `pres-${state.active.index}` : null);

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
    switch (req.url) {
      case '/v1/playlist/active':
        return json({
          presentation: {
            playlist: { uuid: playlistUuid, name: playlistName, index: 0 },
            playlist_item: a
              ? {
                  id: { uuid: a.uuid, name: a.name, index: a.index },
                  type: 'presentation',
                  presentation_info: { arrangement_uuid: '', arrangement_name: '' },
                }
              : null,
          },
        });
      case '/v1/presentation/slide_index':
        return json({
          presentation_index: a
            ? { index: state.slideIndex, presentation_id: { uuid: presUuid(), name: a.name } }
            : null,
        });
      case '/v1/presentation/active':
        return json({
          presentation: {
            id: { uuid: presUuid(), name: a?.name ?? '' },
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
    setTimers(defs, currents) {
      state.timers = { defs, currents };
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
