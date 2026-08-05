import { useTopic, roomTopic } from '../lib/stream';
import { usePlan } from './usePlan';
import type { ShowState } from '../api';
import type { WidgetProps } from './types';

// What is happening and what is next — the two facts everyone in the building
// wants, sized to be read from across a room.
//
// The condensed relative of the run-of-show widget, and the reason there are
// two: an order of service is information-dense and belongs on a desk, while a
// stage screen or a multiview tile has room for exactly one line of each.

export function NowNextWidget({ roomId, config }: WidgetProps) {
  const show = useTopic<ShowState>(roomTopic.show(roomId));
  const { plan, planId, timeId } = usePlan(roomId, config);

  // Only this service's show. A different one being live in the room says
  // nothing about the service this widget was placed for.
  const live =
    show?.active && (!planId || show.planId === planId) && (!timeId || show.timeId === timeId)
      ? show
      : null;

  const trackable = plan?.items.filter((i) => (i.type ?? 'item') !== 'header') ?? [];
  const idx = trackable.findIndex((i) => i.id === live?.current?.itemId);
  const current = idx >= 0 ? trackable[idx] : null;
  const next = idx >= 0 ? trackable[idx + 1] : trackable[0];

  // Nothing running and nothing scheduled is not a state worth a card. The
  // grid holds the space either way — the cell is positioned by the layout,
  // not by what is inside it.
  if (!live && !next) return null;

  return (
    <div className="nownext">
      <div className="nownext__row nownext__row--now">
        <span className="nownext__label">Now</span>
        <span className="nownext__title">{current?.title ?? (live ? '—' : 'Not started')}</span>
      </div>
      <div className="nownext__row">
        <span className="nownext__label">Next</span>
        <span className="nownext__title nownext__title--next">{next?.title ?? 'End of service'}</span>
      </div>
    </div>
  );
}
