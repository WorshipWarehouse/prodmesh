import test from 'node:test';
import assert from 'node:assert/strict';
import { parseTransport } from './integrations/proPresenter.js';

// The payloads below are VERBATIM from ProPresenter 21.4 on 2026-08-10 (see
// docs/INTEGRATION-NOTES.md). They are the whole point of this file: the
// obvious implementation passes invented fixtures and fails against these.

const PLAYING = {
  is_playing: true,
  uuid: 'FA0CF82E-FF52-48E0-BB19-80DAAA1551D6',
  name: '260712 splits_2.mov',
  artist: '',
  audio_only: false,
  duration: 116.86675262451172,
};

// Stopped. Note what did NOT change: uuid, name and duration are all still
// there, and /v1/status/layers still says media:true. Only is_playing moved.
const STOPPED = { ...PLAYING, is_playing: false };

// A layer nothing has ever played on.
const EMPTY = {
  is_playing: false, uuid: '', name: '', artist: '', audio_only: true, duration: 0,
};

test('parseTransport reports a playing video', () => {
  assert.deepEqual(parseTransport(PLAYING), {
    name: '260712 splits_2.mov',
    duration: 116.86675262451172,
    audioOnly: false,
  });
});

test('parseTransport reports NOTHING for a stopped video', () => {
  // The trap this whole feature turns on. ProPresenter keeps a stopped video's
  // identity indefinitely, so every intuitive test — a non-empty uuid, a
  // duration above zero, the media layer flag — stays true forever and pins a
  // dead counter on a wall. is_playing is the only field that means "moving".
  assert.equal(parseTransport(STOPPED), null);
  assert.notEqual(STOPPED.uuid, '', 'the uuid survives, which is why uuid is not the test');
  assert.ok(STOPPED.duration > 0, 'and so does the duration');
});

test('parseTransport reports nothing for an idle layer or a missing body', () => {
  assert.equal(parseTransport(EMPTY), null);
  assert.equal(parseTransport(null), null);
  assert.equal(parseTransport(undefined), null);
  assert.equal(parseTransport({}), null);
});

test('parseTransport refuses a playing item with no usable duration', () => {
  // Division by this drives a progress bar. A zero or a string would render a
  // NaN width, which browsers silently drop — a bar that is simply never there.
  for (const duration of [0, -1, null, undefined, 'x', NaN]) {
    assert.equal(parseTransport({ ...PLAYING, duration }), null, `duration ${duration}`);
  }
});

test('parseTransport keeps audio-only playback distinguishable', () => {
  // Same transport, no picture. Worth knowing about rather than dropping: a
  // click track or a bed running under a talk is still something playing.
  const audio = parseTransport({ ...PLAYING, audio_only: true });
  assert.equal(audio.audioOnly, true);
});

test('parseTransport tolerates a missing name', () => {
  assert.equal(parseTransport({ ...PLAYING, name: '' }).name, null);
});
