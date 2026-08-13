import { useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, ListVideo, MonitorPlay } from 'lucide-react';
import { proPresenterControl, type ProPresenterState } from '../api';
import { roomTopic, useTopic } from '../lib/stream';
import type { WidgetProps } from './types';

const useProPresenterState = (roomId: string) => useTopic<ProPresenterState>(roomTopic.proPresenter(roomId));
const fmt = (n: number | null) => n == null ? '—' : `${Math.floor(n / 60)}:${String(n % 60).padStart(2, '0')}`;

export function ProPresenterSlides({ roomId }: WidgetProps) {
  const state = useProPresenterState(roomId); const runtime = state?.runtime;
  if (!runtime) return <p className="wgt__empty">ProPresenter offline</p>;
  const item = state?.focusedPlaylist?.items.find((x) => x.presentationUuid === runtime.activePresentationUuid);
  const cue = item?.slides[runtime.activeCueIndex ?? -1];
  return <section className="ppwidget"><h3><MonitorPlay size={15} /> {item?.title ?? 'ProPresenter'}</h3><strong>{cue ? `Slide ${cue.number}` : 'No active slide'}</strong><p>{cue?.text || 'No slide text available'}</p>{cue?.section && <small>{cue.section}</small>}{runtime.video && <small>{runtime.video.name} · {fmt(runtime.video.seconds)} / {fmt(runtime.video.duration)}</small>}</section>;
}

export function SlideNotes({ roomId }: WidgetProps) {
  const state = useProPresenterState(roomId); const rt = state?.runtime;
  const item = state?.focusedPlaylist?.items.find((x) => x.presentationUuid === rt?.activePresentationUuid);
  const note = item?.slides[rt?.activeCueIndex ?? -1]?.note;
  return note ? <section className="ppwidget"><h3>Slide notes</h3><p>{note}</p></section> : <p className="wgt__empty">No slide notes</p>;
}

export function ProPresenterTimers({ roomId }: WidgetProps) {
  const timers = useProPresenterState(roomId)?.runtime?.timers ?? [];
  return <section className="ppwidget"><h3>ProPresenter timers</h3>{timers.length ? timers.map((timer) => <p key={timer.uuid ?? timer.name}><strong>{fmt(timer.remainingSeconds)}</strong> {timer.name} · {timer.state}</p>) : <p>No timers</p>}</section>;
}

type Action = 'previous' | 'next' | 'previous-item' | 'next-item' | 'presentation' | 'cue';
function action(roomId: string, config: WidgetProps['config'], actionName: Action, playlistIndex?: number, cueIndex?: number) {
  if (!config.slideControls) return;
  return proPresenterControl(roomId, { viewId: config.viewId, widgetId: config.widgetId, action: actionName, playlistIndex, cueIndex }).catch(() => {});
}

export function ProPresenterControls({ roomId, config }: WidgetProps) {
  const state = useProPresenterState(roomId); const disabled = !config.slideControls;
  return <section className="ppwidget ppwidget--controls"><h3>ProPresenter controls</h3><p>{state?.runtime?.activePresentationUuid ? 'Connected' : 'Waiting for ProPresenter'}</p><div className="ppcontrols"><button disabled={disabled} onClick={() => action(roomId, config, 'previous-item')}>Previous item</button><button disabled={disabled} onClick={() => action(roomId, config, 'next-item')}>Next item</button><button disabled={disabled} onClick={() => action(roomId, config, 'previous')}><ChevronLeft /> Previous slide</button><button disabled={disabled} onClick={() => action(roomId, config, 'next')}>Next slide <ChevronRight /></button></div></section>;
}

export function ProPresenterPlaylist({ roomId, config }: WidgetProps) {
  const state = useProPresenterState(roomId); const active = state?.runtime; const ref = useRef<HTMLDivElement>(null);
  const storageKey = `prodmesh.pp.keyboard.${config.viewId}.${config.widgetId}`;
  const [keyboard, setKeyboard] = useState(() => config.keyboardControls && localStorage.getItem(storageKey) !== 'off');
  const activeKey = `${active?.activePresentationUuid}:${active?.activeCueIndex}`;
  useEffect(() => {
    if (!config.followActive || !ref.current) return;
    const node = ref.current.querySelector('[data-active-cue="true"]');
    node?.scrollIntoView({ block: 'nearest' });
  }, [activeKey, config.followActive]);
  useEffect(() => {
    if (!keyboard || !config.slideControls) return;
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.matches('input, textarea, select, [contenteditable="true"]')) return;
      if (event.key === 'ArrowLeft') { event.preventDefault(); action(roomId, config, 'previous'); }
      if (event.key === 'ArrowRight' || event.key === ' ') { event.preventDefault(); action(roomId, config, 'next'); }
    };
    window.addEventListener('keydown', onKey); return () => window.removeEventListener('keydown', onKey);
  }, [keyboard, config, roomId]);
  if (!state?.focusedPlaylist) return <p className="wgt__empty">No focused playlist</p>;
  const switchKeyboard = () => { const next = !keyboard; setKeyboard(next); localStorage.setItem(storageKey, next ? 'on' : 'off'); };
  return <section className={`ppwidget ppwidget--playlist ppwidget--${config.density ?? 'comfortable'}`} ref={ref}><header><h3><ListVideo size={15} /> {state.focusedPlaylist.name ?? 'Focused playlist'}</h3>{config.keyboardControls && <label><input type="checkbox" checked={keyboard} disabled={!config.slideControls} onChange={switchKeyboard} /> Keyboard</label>}</header>{state.focusedPlaylist.items.map((item) => <div className={item.presentationUuid === active?.activePresentationUuid ? 'ppitem ppitem--active' : 'ppitem'} key={`${item.index}:${item.title}`}><button disabled={!config.slideControls || !item.triggerable} onClick={() => action(roomId, config, 'presentation', item.index)}>{item.title}{item.presentationTitle && item.presentationTitle !== item.title ? ` [${item.presentationTitle}]` : ''}{item.isPco && ' (Planning Center)'}</button>{item.slides.map((cue) => <button key={cue.index} data-active-cue={item.presentationUuid === active?.activePresentationUuid && cue.index === active?.activeCueIndex} className={cue.index === active?.activeCueIndex && item.presentationUuid === active?.activePresentationUuid ? 'ppcue ppcue--active' : 'ppcue'} disabled={!config.slideControls} onClick={() => action(roomId, config, 'cue', item.index, cue.index)}>{cue.section && <small style={{ color: cue.color ?? undefined }}>{cue.section}</small>}<span>{cue.number}. {cue.text || 'Blank'}</span></button>)}</div>)}</section>;
}
