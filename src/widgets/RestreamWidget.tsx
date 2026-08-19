import { Radio } from 'lucide-react';
import { integrationTopic, useTopic } from '../lib/stream';
import type { WidgetProps } from './types';

type State = { connected: boolean; status?: string; title?: string; startedAt?: number | null; error?: string; disabled?: boolean };

export function RestreamWidget(_props: WidgetProps) {
  // One server-side producer polls Restream while anybody is watching, on the
  // shared stream — not an interval per widget per tab (ADR 0010).
  const state = useTopic<State>(integrationTopic('restream'));
  if (!state) return <p className="wgt__empty">Checking Restream…</p>;
  if (state.disabled) return <p className="wgt__empty">Restream is disabled in Admin → Integrations.</p>;
  const status = state.status ?? 'offline';
  return <section className="wgt"><div className="wgt__head"><Radio size={16} /><span className="wgt__title">Restream</span><span className={`wgt__status ${status === 'live' ? 'wgt__status--live' : ''}`}>{status}</span></div><strong className="pcw__title">{state.title ?? 'No active broadcast'}</strong><p className="wgt__detail">{state.connected ? 'Restream account connected' : state.error ?? 'Connect Restream in Settings'}</p></section>;
}
