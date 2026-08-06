import test from 'node:test';
import assert from 'node:assert/strict';
import * as health from './health.js';
import { publicHealth } from './roomHealth.js';

// The probe loop itself is network and refcounting; what is tested here is the
// step that decides what leaves the building — because this topic is readable
// by a screen with nobody logged in, and the route sharing the same probe
// needs config.manage.

const AT = 1_700_000_000_000;
const room = (over = {}) => ({ id: 'r1', name: 'Room', ...over });

/** Probe output shaped like connectivityStatus really returns it — including
 *  the strings that make redaction necessary in the first place. */
const chatty = {
  planningCenter: { ok: false, at: AT, detail: 'HTTP 401 from https://api.planningcenteronline.com/services/v2/…' },
  proPresenter: { ok: true, at: AT, detail: 'BOOTH-MAC-01.local · Main Presenter' },
  companion: { ok: true, at: AT, detail: '$(roomState) = "SUNDAY"' },
  analysis: { ok: false, at: AT, detail: 'connect ECONNREFUSED 192.0.2.40:26000' },
};

test('publicHealth carries no host, port, banner or error text', () => {
  const out = publicHealth(room(), chatty, AT);
  const json = JSON.stringify(out);
  for (const leak of [
    '192.0.2.40', '26000', 'ECONNREFUSED', // where the device is, and how it failed
    'BOOTH-MAC-01', '.local', // the PP machine's own name — ppro.ping returns it
    'roomState', 'SUNDAY', // the Companion variable and its value
    'planningcenteronline', '401', // the API path and its status
  ]) {
    assert.ok(!json.includes(leak), `leaked ${JSON.stringify(leak)} in ${json}`);
  }
});

test('publicHealth reports state, and only from a fixed field list', () => {
  const out = publicHealth(room(), chatty, AT);
  assert.equal(out.at, AT);
  assert.deepEqual(out.integrations, [
    { id: 'planningCenter', label: 'Planning Center', state: 'down' },
    { id: 'proPresenter', label: 'ProPresenter', state: 'ok' },
    { id: 'companion', label: 'Companion', state: 'ok' },
    { id: 'analysis', label: 'Analysis', state: 'down' },
  ]);
  // An allowlist, not a denylist: a new field on the probe result must not
  // appear here by default.
  for (const i of out.integrations) {
    assert.deepEqual(Object.keys(i).sort(), ['id', 'label', 'state']);
  }
});

test('an unconfigured integration is absent, not a grey dot', () => {
  // roomStatus returns null for anything the room has not configured. A room
  // that does not stream has nothing to say about YouTube, and a permanent
  // grey dot is the noise that teaches people to ignore the dots.
  const out = publicHealth(room(), {
    planningCenter: null, proPresenter: null,
    companion: { ok: true, at: AT, detail: 'x' }, analysis: null,
  }, AT);
  assert.deepEqual(out.integrations.map((i) => i.id), ['companion']);
});

test('mock and never-contacted are distinct from down', () => {
  // Three different claims. Calling a simulated dev room "down" would train
  // people to ignore red; calling an uncontacted one down sends somebody to
  // the booth for nothing.
  const out = publicHealth(room(), {
    planningCenter: { ok: null, at: AT, detail: 'Not contacted since server start' },
    proPresenter: null,
    companion: { ok: null, mock: true, at: AT, detail: 'Simulated' },
    analysis: { ok: false, at: AT, detail: 'nope' },
  }, AT);
  assert.deepEqual(
    out.integrations.map((i) => [i.id, i.state]),
    [['planningCenter', 'unknown'], ['companion', 'mock'], ['analysis', 'down']],
  );
});

test('YouTube is read from the health registry, never probed', () => {
  // Every request to YouTube is metered Google quota, so a status widget left
  // up on a wall must not buy its dot. Its state is whatever the last REAL
  // request recorded — which happens while the room is streaming, i.e. exactly
  // when the answer matters.
  health.reset();
  const yt = room({ youtube: { channelId: 'UC_test_channel' } });
  const none = { planningCenter: null, proPresenter: null, companion: null, analysis: null };

  assert.deepEqual(publicHealth(yt, none, AT).integrations, [
    { id: 'youtube', label: 'YouTube', state: 'unknown' },
  ]);

  health.report('youtube@UC_test_channel', false, 'quota exceeded');
  assert.equal(publicHealth(yt, none, AT).integrations[0].state, 'down');

  health.report('youtube@UC_test_channel', true);
  assert.equal(publicHealth(yt, none, AT).integrations[0].state, 'ok');

  // And the channel id, which IS in the health key, does not ride along.
  assert.ok(!JSON.stringify(publicHealth(yt, none, AT)).includes('UC_test_channel'));
  health.reset();
});
