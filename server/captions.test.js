import test from 'node:test';
import assert from 'node:assert/strict';
import * as pmc from './integrations/prodmeshCaption.js';
import * as prodcom from './integrations/prodcom.js';
import * as captions from './integrations/captions.js';

// Two apps that agree about nothing: an integer channel vs a UUID, two message
// types vs one boolean, a heartbeat you ignore vs one you must answer. What is
// tested here is that both arrive as the same CaptionLine, because everything
// above this layer is written once.

// ── ProdMesh Caption ────────────────────────────────────────────────────────
// Payloads verbatim from that project's docs/api.md.

test('prodmesh-caption: a partial is a live line', () => {
  const out = pmc.parseFrame({
    type: 'partial', ch: 2, utt: 12, rev: 3, text: 'and so we come to the',
    t0: 4.5, t1: 6.25, wall_ms: 1786415674778, seq: 1433,
  });
  assert.equal(out.kind, 'line');
  assert.deepEqual(out.line, {
    id: '2:12', ch: '2', text: 'and so we come to the', live: true, at: 1786415674778, rev: 3,
  });
});

test('prodmesh-caption: a final settles the SAME line, not a new one', () => {
  // The documented rule: a final supersedes every partial with the same
  // (ch, utt). Sharing the id is what lets a transcript replace in place — get
  // this wrong and every sentence appears twice, once half-finished.
  const partial = pmc.parseFrame({ type: 'partial', ch: 2, utt: 12, rev: 3, text: 'and so we', wall_ms: 1 });
  const final = pmc.parseFrame({
    type: 'final', ch: 2, utt: 12, rev: 4, text: 'And so we come to the reading.',
    wall_ms: 2, conf: 0.87,
  });
  assert.equal(final.line.id, partial.line.id);
  assert.equal(final.line.live, false);
  assert.equal(partial.line.live, true);
});

test('prodmesh-caption: the roster calls the channel `id`, lines call it `ch`', () => {
  // Same number, two names, and mixing them up loses every speaker's colour.
  const out = pmc.parseFrame({
    type: 'channels', device: 'Dante Virtual Soundcard', backend: 'apple', sample_rate: 48000,
    channels: [{ id: 2, name: 'Pastor', color: '#e0603a', locale: '' }],
  });
  assert.deepEqual(out.channels, [{ ch: '2', name: 'Pastor', color: '#e0603a' }]);
  assert.equal(pmc.parseFrame({ type: 'partial', ch: 2, utt: 1, text: 'x' }).line.ch, '2');
});

test('prodmesh-caption: tick is health, and the rest is noise', () => {
  assert.equal(pmc.parseFrame({ type: 'tick', clients: 3 }).kind, 'tick');
  for (const type of ['welcome', 'speech', 'state', 'error', 'replay_begin']) {
    assert.equal(pmc.parseFrame({ type }).kind, 'ignore', type);
  }
  // An empty text is not a line; it would render as a blank speaker bubble.
  assert.equal(pmc.parseFrame({ type: 'final', ch: 1, utt: 1, text: '' }).kind, 'ignore');
});

// ── ProdCom ─────────────────────────────────────────────────────────────────
// TranscriptEntry is schema'd; the frame WRAPPING it is not, which is why
// parseFrame identifies an entry by shape. See docs/INTEGRATION-NOTES.md.

const ENTRY = {
  id: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
  channelId: 'c3d4e5f6-a7b8-9012-cdef-123456789012',
  channelName: 'Stage Left TB',
  text: 'two bars then straight into the chorus',
  source: 'audio',
  inProgress: false,
  hasBeenSeen: false,
  date: '2026-04-13T14:30:00Z',
  completeDate: '2026-04-13T14:30:04Z',
};

test('prodcom: inProgress is the live flag, not a separate message type', () => {
  const settled = prodcom.parseFrame(ENTRY);
  assert.equal(settled.kind, 'line');
  assert.equal(settled.line.live, false);
  assert.equal(settled.line.text, ENTRY.text);
  assert.equal(settled.line.ch, ENTRY.channelId);
  assert.equal(settled.line.name, 'Stage Left TB');
  assert.equal(settled.line.at, Date.parse('2026-04-13T14:30:04Z'), 'completeDate wins when present');

  const live = prodcom.parseFrame({ ...ENTRY, inProgress: true, completeDate: null });
  assert.equal(live.line.live, true);
  assert.equal(live.line.at, Date.parse('2026-04-13T14:30:00Z'), 'falls back to date');
  assert.equal(live.line.id, settled.line.id, 'the entry id survives, so it settles in place');
});

test('prodcom: an entry is found bare OR inside whatever wrapper is used', () => {
  // The spec says only "each event is a JSON object representing a transcript
  // entry" — it never shows the envelope. Guessing one wrong would mean a
  // transcript that is simply always empty, with no error anywhere.
  const wrapped = [
    { data: ENTRY },
    { type: 'transcript', data: ENTRY },
    { type: 'transcript.updated', entry: ENTRY },
    { payload: ENTRY },
    { transcript: ENTRY },
  ];
  for (const frame of wrapped) {
    const out = prodcom.parseFrame(frame);
    assert.equal(out.kind, 'line', JSON.stringify(frame).slice(0, 40));
    assert.equal(out.line.text, ENTRY.text);
  }
});

test('prodcom: heartbeat is called out so the watcher can echo it', () => {
  // Documented: the connection is DROPPED if the client does not echo. A
  // passive reader dies after one interval, which looks like a flaky network.
  assert.equal(prodcom.parseFrame({ type: 'heartbeat' }).kind, 'heartbeat');
  assert.equal(prodcom.parseFrame({ type: 'welcome' }).kind, 'ignore');
});

test('prodcom: nothing that is not an entry is mistaken for one', () => {
  for (const frame of [null, {}, { type: 'automation' }, { data: { text: 'x' } }, { data: 'text' }]) {
    assert.equal(prodcom.parseFrame(frame).kind, 'ignore', JSON.stringify(frame));
  }
  // channelId without text, and text without channelId, are both not entries.
  assert.equal(prodcom.parseFrame({ text: 'hi', inProgress: false }).kind, 'ignore');
  assert.equal(prodcom.parseFrame({ channelId: 'x', inProgress: false }).kind, 'ignore');
});

// ── The dispatcher ──────────────────────────────────────────────────────────

test('captions: both sources produce the same shape of line', () => {
  const a = pmc.parseFrame({ type: 'final', ch: 2, utt: 12, text: 'hello', wall_ms: 5 }).line;
  const b = prodcom.parseFrame(ENTRY).line;
  const shape = (l) => Object.keys(l).filter((k) => k !== 'name').sort();
  assert.deepEqual(shape(a), shape(b));
  for (const l of [a, b]) {
    assert.equal(typeof l.id, 'string');
    assert.equal(typeof l.ch, 'string', 'an int channel and a UUID both arrive as strings');
    assert.equal(typeof l.live, 'boolean');
    assert.equal(typeof l.at, 'number');
  }
});

test('captions: configuration and ports', () => {
  assert.deepEqual(captions.sourceNames.sort(), ['prodcom', 'prodmesh-caption']);
  assert.equal(captions.defaultPort('prodmesh-caption'), 8518);
  assert.equal(captions.defaultPort('prodcom'), 24480);

  assert.equal(captions.isConfigured({ source: 'prodcom', host: '192.0.2.9' }), true);
  assert.equal(captions.isConfigured({ source: 'prodcom' }), false, 'no host');
  assert.equal(captions.isConfigured({ source: 'nope', host: 'h' }), false);
  assert.equal(captions.isConfigured(null), false);

  // An explicit port beats the default; the health key never carries the PSK.
  assert.equal(captions.port({ source: 'prodcom', host: 'h', port: 9999 }), 9999);
  const key = captions.healthKey({ source: 'prodcom', host: '192.0.2.9', key: 'sup3rsecret' });
  assert.equal(key, 'captions@192.0.2.9:24480');
  assert.ok(!key.includes('sup3rsecret'));
});

// ── The rolling window ──────────────────────────────────────────────────────

const { fold } = await import('./captionWatcher.js');

const line = (over = {}) => ({ id: 'a', ch: '1', text: 't', live: false, at: 1, rev: 0, ...over });

test('fold: a partial grows in place instead of appending', () => {
  // Without replace-by-id a sentence appears once per partial, each a few
  // words longer than the last — the single most obvious way to get this wrong.
  let w = [];
  w = fold(w, line({ id: '2:12', text: 'and so', live: true, rev: 1 }));
  w = fold(w, line({ id: '2:12', text: 'and so we come', live: true, rev: 2 }));
  w = fold(w, line({ id: '2:12', text: 'And so we come to the reading.', live: false, rev: 3 }));
  assert.equal(w.length, 1);
  assert.equal(w[0].text, 'And so we come to the reading.');
  assert.equal(w[0].live, false);
});

test('fold: a stale revision never overwrites a newer one', () => {
  // Both sources coalesce, so partials genuinely arrive out of order.
  let w = fold([], line({ id: 'x', text: 'newer', live: true, rev: 5 }));
  w = fold(w, line({ id: 'x', text: 'older', live: true, rev: 2 }));
  assert.equal(w[0].text, 'newer');
});

test('fold: a settled line is never reopened by a late partial', () => {
  let w = fold([], line({ id: 'x', text: 'Final text.', live: false, rev: 9 }));
  w = fold(w, line({ id: 'x', text: 'final te', live: true, rev: 99 }));
  assert.equal(w[0].text, 'Final text.');
  assert.equal(w[0].live, false);
});

test('fold: different utterances stack, oldest first, bounded', () => {
  let w = [];
  for (let i = 0; i < 6; i += 1) w = fold(w, line({ id: `u${i}`, text: `line ${i}` }), 4);
  assert.equal(w.length, 4);
  assert.deepEqual(w.map((l) => l.text), ['line 2', 'line 3', 'line 4', 'line 5']);
});

test('fold: two speakers mid-sentence at once do not collide', () => {
  // The whole use case is more than one person talking to the band.
  let w = [];
  w = fold(w, line({ id: '2:1', ch: '2', text: 'gtr', live: true }));
  w = fold(w, line({ id: '6:1', ch: '6', text: 'dr', live: true }));
  w = fold(w, line({ id: '2:1', ch: '2', text: 'guitar down', live: false }));
  assert.equal(w.length, 2);
  assert.deepEqual(w.map((l) => [l.ch, l.text]), [['2', 'guitar down'], ['6', 'dr']]);
});
