import type { ComponentType } from 'react';
import type { ViewKind } from '../lib/gridLayout';

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
//  Not everything on a screen is a widget — but Run of Show turned out to be.
//  ADR 0010 kept its Start/End/Prev/Next as a page component on the grounds
//  that "no dashboard would ever place it"; a producer's dashboard is exactly
//  where you want Next under your thumb. What made it placeable is permission
//  gating: a widget that acts can offer its controls to whoever may use them
//  and say so plainly to whoever may not. `kinds` is how it stays off a
//  display, which is defined as non-interactive.
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

/** Size on a View's 2D canvas, in grid units. */
export interface WidgetSize {
  w: number;
  h: number;
}

export interface WidgetDef {
  /** Shown in the layout picker. */
  title: string;
  /** One line on what it shows — the picker's subtitle. */
  description: string;
  component: ComponentType<WidgetProps>;

  /** Size in grid units on a View canvas (6 wide on a dashboard, 3 on a
   *  display) — what it gets when first placed. */
  size: WidgetSize;

  /**
   * How far it may be stretched, if at all. Both default to `size`, i.e. one
   * authored size and no handle.
   *
   * Most widgets stay fixed on purpose: a 1×1 loudness meter and a 6×5 one are
   * two designs, not one design scaled, and a resize handle would only produce
   * the bad version of both. A range is for a widget whose content genuinely
   * continues past its edge — Run of Show, whose order of service SCROLLS, so
   * more height is more list rather than more whitespace.
   */
  minSize?: WidgetSize;
  maxSize?: WidgetSize;

  /**
   * One per view? Defaults to true.
   *
   * A flag rather than a blanket rule, because the real invariant is that a
   * placement be IDENTIFIABLE. Today most widgets carry no config, so the type
   * alone identifies them and one-per-view falls out for free. A future
   * multi-instance widget — two Smaart engines in one room, one for the stream
   * and one for the house — sets `unique: false` and earns an identity in its
   * config. Mirrored in server/validate.js, which is authoritative.
   */
  unique?: boolean;

  /** Which view kinds may hold it. Defaults to both. A widget that takes
   *  actions must exclude 'display': a display is DEFINED as non-interactive. */
  kinds?: ViewKind[];

  /**
   * LEGACY: column span on the 12-column FLOW grid (`.widgets`,
   * `.ros__widgets`), which reflows to one column below 880px. Different
   * question from `size`, and not convertible: `third` is 4/12, `w:2` is 2/6,
   * and `two-thirds` has no clean 6-column equivalent. Dies with spanColumns()
   * the day Run of Show renders a stored view instead of a hard-coded row.
   */
  defaultSpan: WidgetSpan;
}

export type WidgetType =
  | 'countdown'
  | 'loudness'
  | 'loudness-trend'
  | 'viewers'
  | 'run-of-show'
  | 'now-next'
  | 'room-mode'
  | 'clock';

/** May this widget go on a view of this kind? */
export const widgetAllowedOn = (def: WidgetDef, kind: ViewKind): boolean =>
  (def.kinds ?? ['dashboard', 'display']).includes(kind);

export const widgetMin = (def: WidgetDef): WidgetSize => def.minSize ?? def.size;
export const widgetMax = (def: WidgetDef): WidgetSize => def.maxSize ?? def.size;

/** Can this widget be stretched at all, on either axis? */
export const widgetResizable = (def: WidgetDef): boolean => {
  const min = widgetMin(def);
  const max = widgetMax(def);
  return max.w > min.w || max.h > min.h;
};

/** One per view unless it says otherwise. */
export const widgetIsUnique = (def: WidgetDef): boolean => def.unique !== false;

export type { ViewKind };
