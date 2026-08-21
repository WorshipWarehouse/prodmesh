import { Activity, Radio, UsersRound, Video } from 'lucide-react';
import { integrationTopic, useTopic } from '../lib/stream';
import type { ResiStatus } from '../api';
import type { WidgetProps } from './types';

/**
 * One server-side producer polls Resi while anybody is watching and publishes
 * on the shared stream (ADR 0010). Every Resi widget on the page reads the same
 * topic, so four of them cost one poll rather than four intervals per tab.
 *
 * The interval argument is gone deliberately: freshness is now the producer's
 * decision, and a widget cannot ask the service to be polled faster.
 */
function useResi() {
  return useTopic<ResiStatus & { disabled?: boolean }>(integrationTopic('resi'));
}

function statusLabel(state: ResiStatus) {
  if (!state.connected) return state.health === 'connection-lost' ? 'Connection lost' : 'Offline';
  if (!state.live) return 'Offline';
  return state.health;
}

function Head({ icon: Icon, state, title }: { icon: typeof Radio; state: ResiStatus; title: string }) {
  return <div className="wgt__head"><span className="wgt__icon"><Icon size={16} /></span><span className="wgt__title">{title}</span><span className={`wgt__status resi__status resi__status--${state.health}`}><span className="wgt__dot" />{statusLabel(state)}</span></div>;
}

function Embed({ state, config }: { state: ResiStatus; config: WidgetProps['config'] }) {
  if (!state.live) return <div className="resi__offline"><Video size={26} /><strong>No active livestream</strong><span>{state.connected ? 'Resi reports no active broadcast.' : state.error ?? 'Connect Resi in Settings.'}</span></div>;
  if (!state.playerUrl) return <div className="resi__offline"><Video size={26} /><strong>Player URL not configured</strong><span>Add the official Resi player URL in Admin → Integrations → Resi.</span></div>;
  let playerUrl: URL;
  try { playerUrl = new URL(state.playerUrl); } catch { return <div className="resi__offline"><strong>Invalid player URL</strong><span>Update the Resi player URL in Settings.</span></div>; }
  if (config.autoplay) playerUrl.searchParams.set('autoplay', '1');
  if (config.muted ?? true) playerUrl.searchParams.set('muted', '1');
  if (config.playerControls === false) playerUrl.searchParams.set('controls', '0');
  return <div className="resi__player" style={{ aspectRatio: config.aspectRatio ?? '16 / 9' }}><iframe src={playerUrl.href} title="Resi livestream" allow="autoplay; fullscreen; picture-in-picture" allowFullScreen /></div>;
}

export function ResiStreamWidget({ config }: WidgetProps) {
  const state = useResi();
  if (!state) return <p className="wgt__empty">Checking Resi…</p>;
  if (state.disabled) return <p className="wgt__empty">Resi is disabled in Admin → Integrations.</p>;
  return <section className="wgt resi"><Head icon={Radio} title="Resi livestream" state={state} /><Embed state={state} config={config} /></section>;
}

export function ResiHealthWidget() {
  const state = useResi();
  if (!state) return <p className="wgt__empty">Checking Resi…</p>;
  if (state.disabled) return <p className="wgt__empty">Resi is disabled in Admin → Integrations.</p>;
  const rows = [
    ['Encoder', state.encoder?.online == null ? null : state.encoder.online ? 'Online' : 'Offline'],
    ['Stream', state.live ? 'Live' : 'Offline'], ['Video', state.video], ['Audio', state.audio], ['Destination', state.destination],
  ].filter(([, detail]) => detail != null);
  return <section className="wgt resi resi--health"><Head icon={Activity} title="Resi stream health" state={state} /><strong className={`resi__health resi__health--${state.health}`}>{statusLabel(state).toUpperCase()}</strong>{rows.length ? <dl className="resi__facts">{rows.map(([label, detail]) => <div key={label}><dt>{label}</dt><dd>{detail}</dd></div>)}</dl> : <p className="wgt__detail">{state.error ?? 'No detailed Resi telemetry is available for this account.'}</p>}{state.warnings?.map((warning) => <p className="resi__notice" key={warning}>{warning}</p>)}{state.errors?.map((error) => <p className="resi__notice resi__notice--error" key={error}>{error}</p>)}</section>;
}

export function ResiViewersWidget() {
  const state = useResi();
  if (!state) return <p className="wgt__empty">Checking Resi…</p>;
  if (state.disabled) return <p className="wgt__empty">Resi is disabled in Admin → Integrations.</p>;
  return <section className="wgt resi resi--viewers"><Head icon={UsersRound} title="Resi live viewers" state={state} /><strong className="wgt__value">{state.live && state.viewers != null ? state.viewers.toLocaleString() : '—'}</strong><p className="wgt__detail">{state.live ? state.viewers == null ? 'Viewer count is not available from this Resi account.' : [state.peakViewers != null && `peak ${state.peakViewers.toLocaleString()}`, state.totalViews != null && `${state.totalViews.toLocaleString()} total views`, state.averageWatchTime && `avg watch ${state.averageWatchTime}`].filter(Boolean).join(' · ') || 'Live' : state.connected ? 'No active broadcast' : state.error ?? 'Resi connection lost'}</p></section>;
}

export function ResiBroadcastWidget({ config }: WidgetProps) {
  const state = useResi();
  if (!state) return <p className="wgt__empty">Checking Resi…</p>;
  if (state.disabled) return <p className="wgt__empty">Resi is disabled in Admin → Integrations.</p>;
  return <section className="wgt resi resi--broadcast"><Head icon={Radio} title={state.title || 'Resi broadcast'} state={state} /><Embed state={state} config={config} /><div className="resi__summary"><strong>{state.live && state.viewers != null ? `${state.viewers.toLocaleString()} viewers` : statusLabel(state)}</strong><span>{state.encoder?.online === true ? 'Encoder online' : state.encoder?.online === false ? 'Encoder offline' : state.connected ? 'Monitoring connected' : state.error ?? 'Connection lost'}</span></div></section>;
}
