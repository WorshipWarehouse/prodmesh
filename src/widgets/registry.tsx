// Widget registry — the single place that knows what each widget type is.
//
// Same shape as src/tiles/registry.tsx, which is the pattern that already
// works here: a new widget is one entry plus one component, and everything
// that places widgets picks it up automatically. The point of the indirection
// is that a stored dashboard layout can name a widget by STRING — so a layout
// is data, and placing one is not a code change.
//
// Adding a widget = a type in ./types.ts and one entry here.

import { CountdownWidget } from './CountdownWidget';
import { LoudnessWidget } from './LoudnessWidget';
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
};

export const widgetTypes = Object.keys(widgetRegistry) as WidgetType[];

export const isWidgetType = (v: string): v is WidgetType => v in widgetRegistry;
