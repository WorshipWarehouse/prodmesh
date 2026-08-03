import type { ComponentType } from 'react';

// ─────────────────────────────────────────────────────────────────────────────
//  Widget contract.
//
//  A widget is addressed by a STRING type and given a room plus a small config
//  object — nothing else. That constraint is the whole point: a stored
//  dashboard layout is data (`{type, roomId, config, span}`), so a widget can
//  only be placed from data if it can get everything it needs from data.
//
//  Which means widgets fetch their own state rather than receiving it as
//  props. That reads like duplicated work and isn't: subscriptions refcount
//  through useTopic, and requests share a cache key through useQuery (see
//  lib/keys.ts), so a widget on a page that already wanted the same data costs
//  nothing extra.
//
//  Not everything on a screen is a widget. A page's own control surface —
//  Run of Show's Start/End/Prev/Next — stays a page component, because no
//  dashboard would ever place it and giving it a config contract would be
//  inventing a requirement to satisfy a pattern.
// ─────────────────────────────────────────────────────────────────────────────

/** Per-instance settings from a stored layout. Every field is optional: a
 *  widget must render something sensible knowing only its room. */
export interface WidgetConfig {
  /** Pin to one Planning Center plan. Omitted = follow the room's next service. */
  planId?: string;
  /** Which service time within that plan. Omitted = the plan's first service. */
  timeId?: string;
}

export interface WidgetProps {
  roomId: string;
  config: WidgetConfig;
}

/** Column count on the 12-col grid, or one of the legacy names. */
export type WidgetSpan = 'half' | 'third' | 'two-thirds' | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12;

// Named spans predate the numeric ones and stay as aliases — they read better
// at call sites that only ever wanted "half", and a stored layout wants to say
// 5 without inventing a name for it.
const SPAN_COLUMNS: Record<string, number> = { half: 6, third: 4, 'two-thirds': 8 };

/**
 * Resolve a span to a column count, or null if it isn't one.
 *
 * The range check looks redundant against `WidgetSpan` and is not: spans
 * arrive from a stored layout, i.e. from the database, where the type is a
 * promise the data has never been asked to keep.
 */
export function spanColumns(span: WidgetSpan | undefined): number | null {
  if (span == null) return null;
  const n = typeof span === 'number' ? span : SPAN_COLUMNS[span];
  return Number.isInteger(n) && n >= 1 && n <= 12 ? n : null;
}

export interface WidgetDef {
  /** Shown in a future layout picker. */
  title: string;
  /** One line on what it shows — the picker's subtitle. */
  description: string;
  component: ComponentType<WidgetProps>;
  defaultSpan: WidgetSpan;
}

export type WidgetType = 'countdown' | 'loudness' | 'viewers';
