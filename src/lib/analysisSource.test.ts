import { describe, expect, it } from 'vitest';
import { analysisIntegration, analysisWidgetTitle } from './analysisSource';

describe('analysis source presentation', () => {
  it('gives each configured SPL provider its own widget title and brand', () => {
    expect(analysisWidgetTitle('loudness', 'smaart')).toBe('Smaart Decibel Meter');
    expect(analysisWidgetTitle('loudness-trend', 'rta')).toBe('ProdMesh RTA Trend');
    expect(analysisWidgetTitle('loudness', 'open-sound-meter')).toBe('Open Sound Meter Decibel Meter');
    expect(analysisIntegration('open-sound-meter')).toBe('open-sound-meter');
  });

  it('keeps the generic fallback for rooms without an analysis source', () => {
    expect(analysisWidgetTitle('loudness', null)).toBeNull();
    expect(analysisIntegration(null)).toBe('analysis');
  });
});
