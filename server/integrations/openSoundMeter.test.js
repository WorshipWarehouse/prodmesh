import test from 'node:test';
import assert from 'node:assert/strict';
import { sampleFromPacket } from './openSoundMeter.js';

const packet = JSON.stringify({
  api: 'Open Sound Meter',
  message: 'levels',
  source: 'house-spl',
  objectName: 'House SPL',
  data: {
    A: { Fast: -61.6, Slow: -63.9 },
    C: { Fast: -58.2, Slow: -59.1 },
    Z: { Fast: -55.8 },
  },
});

test('converts Open Sound Meter Remote API levels to SPL', () => {
  const parsed = sampleFromPacket(packet, { weighting: 'A', response: 'Fast' });
  assert.equal(parsed.sourceId, 'house-spl');
  assert.equal(parsed.sample.spl, 78.4);
});

test('uses the configured weighting, response, and selected source', () => {
  const parsed = sampleFromPacket(packet, { sourceId: 'house-spl', weighting: 'C', response: 'Slow' });
  assert.equal(parsed.sample.spl, 80.9);
  assert.equal(sampleFromPacket(packet, { sourceId: 'stage', weighting: 'C', response: 'Slow' }), null);
});

test('floors OSM full-scale silence at zero SPL and ignores malformed packets', () => {
  const silent = JSON.stringify({ api: 'Open Sound Meter', message: 'levels', data: { A: { Slow: -160 } } });
  assert.equal(sampleFromPacket(silent, { weighting: 'A', response: 'Slow' }).sample.spl, 0);
  assert.equal(sampleFromPacket('{not json}', { weighting: 'A', response: 'Slow' }), null);
});
