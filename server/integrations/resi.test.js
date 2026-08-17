import test from 'node:test';
import assert from 'node:assert/strict';
import { normalize } from './resi.js';

test('Resi normalization makes healthy live telemetry safe for widgets', () => {
  const state = normalize({
    broadcast: {
      title: 'Sunday service', live: true, startedAt: '2026-08-16T14:30:00Z',
      encoder: { online: true, name: 'FOH encoder' },
      video: { status: 'good' }, audio: { status: 'good' },
      analytics: { currentViewers: 127, peakViewers: 164, totalViews: 238 },
    },
  });
  assert.equal(state.connected, true);
  assert.equal(state.live, true);
  assert.equal(state.health, 'healthy');
  assert.equal(state.viewers, 127);
  assert.equal(state.peakViewers, 164);
  assert.equal(state.encoder.online, true);
});

test('Resi normalization distinguishes warnings and encoder failure', () => {
  const warning = normalize({ stream: { live: true }, health: { status: 'degraded', warnings: ['Network jitter'] } });
  assert.equal(warning.health, 'warning');
  assert.deepEqual(warning.warnings, ['Network jitter']);

  const offline = normalize({ encoder: { online: false }, status: 'offline' });
  assert.equal(offline.live, false);
  assert.equal(offline.health, 'offline');
});
