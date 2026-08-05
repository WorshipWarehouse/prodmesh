// Widget registry — the single place that knows what each widget type is.
//
// Same shape as src/tiles/registry.tsx, which is the pattern that already
// works here: a new widget is one entry plus one component, and everything
// that places widgets picks it up automatically. The point of the indirection
// is that a stored dashboard layout can name a widget by STRING — so a layout
// is data, and placing one is not a code change.
//
// Adding a widget = a type in ./types.ts and one entry here.

import { ClockWidget } from './ClockWidget';
import { CountdownWidget } from './CountdownWidget';
import { NowNextWidget } from './NowNextWidget';
import { RoomModeWidget } from './RoomModeWidget';
import { RunOfShowWidget } from './RunOfShowWidget';
import { LoudnessWidget } from './LoudnessWidget';
import { LoudnessTrendWidget } from './LoudnessTrendWidget';
import { ViewersWidget } from './ViewersWidget';
import type { WidgetDef, WidgetType } from './types';

export const widgetRegistry: Record<WidgetType, WidgetDef> = {
  countdown: {
    title: 'Countdown',
    description: 'Time until the service starts, following the room’s ProPresenter timer.',
    component: CountdownWidget,
    size: { w: 2, h: 1 },
    defaultSpan: 'third',
  },

  loudness: {
    title: 'Loudness',
    description: 'Live SPL against the room’s target and limit, with C-A when available.',
    component: LoudnessWidget,
    size: { w: 2, h: 1 },
    defaultSpan: 'third',
  },

  'loudness-trend': {
    title: 'Loudness trend',
    description: 'The shape of the last quarter hour, for a mix that creeps up.',
    component: LoudnessTrendWidget,
    size: { w: 2, h: 1 },
    defaultSpan: 'third',
  },

  viewers: {
    title: 'Live viewers',
    description: 'Concurrent YouTube viewers while the room is streaming.',
    component: ViewersWidget,
    // One number and a label — the only one of the three narrow enough for a
    // single cell. Countdown carries three lines of text and loudness a meter
    // with a stats line, and both look squeezed at half this.
    size: { w: 1, h: 1 },
    defaultSpan: 'third',
  },

  'run-of-show': {
    title: 'Run of Show',
    description: 'The order of service, what is live now, and the controls to move it.',
    component: RunOfShowWidget,
    size: { w: 2, h: 3 },
    // The only widget with a range, and the reason the range exists: its list
    // scrolls, so the extra rows are more of the service rather than padding.
    minSize: { w: 2, h: 3 },
    maxSize: { w: 2, h: 5 },
    // It takes actions, and a display is DEFINED as non-interactive. The
    // server enforces this too; the palette just never offers it.
    kinds: ['dashboard'],
    defaultSpan: 'third',
  },

  'now-next': {
    title: 'Now & Next',
    description: 'The current item and the one after it, large enough to read across a room.',
    component: NowNextWidget,
    size: { w: 3, h: 1 },
    defaultSpan: 'two-thirds',
  },

  'room-mode': {
    title: 'Room mode',
    description: 'What mode the room is in, in its own colour. Read-only.',
    component: RoomModeWidget,
    // Two columns because this one shows WORDS. "Sunday Service" in a single
    // cell is either three characters wide or clipped.
    size: { w: 2, h: 1 },
    defaultSpan: 'third',
  },

  clock: {
    title: 'Clock',
    description: 'The time of day, with seconds.',
    component: ClockWidget,
    // Also two: "10:42:07" at the size that makes a clock worth putting on a
    // wall does not fit one column, and dropping the seconds to make it fit
    // would remove the reason a booth wants a clock.
    size: { w: 2, h: 1 },
    defaultSpan: 'third',
  },
};

export const widgetTypes = Object.keys(widgetRegistry) as WidgetType[];

export const isWidgetType = (v: string): v is WidgetType => v in widgetRegistry;
