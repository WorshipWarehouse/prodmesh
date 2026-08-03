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
import type { WidgetDef, WidgetType } from './types';

export const widgetRegistry: Record<WidgetType, WidgetDef> = {
  countdown: {
    title: 'Countdown',
    description: 'Time until the service starts, following the room’s ProPresenter timer.',
    component: CountdownWidget,
    defaultSpan: 'third',
  },

  loudness: {
    title: 'Loudness',
    description: 'Live SPL against the room’s target and limit, with C-A when available.',
    component: LoudnessWidget,
    defaultSpan: 'third',
  },
};

export const widgetTypes = Object.keys(widgetRegistry) as WidgetType[];

export const isWidgetType = (v: string): v is WidgetType => v in widgetRegistry;
