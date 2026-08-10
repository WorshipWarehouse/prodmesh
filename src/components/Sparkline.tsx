import { useId } from 'react';

// A tiny inline-SVG line chart.
//
// Deliberately not a charting library: the no-runtime-CDN rule means anything
// added is bundled, and a booth machine downloading ~100kB of charting for one
// 200px curve is a bad trade. If 1.5's dashboards need real charts — axes,
// tooltips, zoom — that is a deliberate decision to make then, not one to
// smuggle in now.
//
// viewBox scaling means it renders at whatever size CSS gives it, and
// preserveAspectRatio="none" lets it stretch to the container's width without
// the caller measuring anything.

/** A value above which the curve changes colour. `tone` names a CSS class. */
export interface SparkBand {
  from: number;
  tone: 'warn' | 'over';
}

export function Sparkline({
  points,
  label,
  className,
  bounds,
  bands,
}: {
  points: number[];
  /** Describes the curve for screen readers — an SVG of a shape is otherwise mute. */
  label: string;
  className?: string;
  /**
   * Fix the vertical scale instead of fitting it to the data.
   *
   * Auto-fitting is right when only the SHAPE matters (viewer counts have no
   * meaningful absolute scale). It is wrong wherever a threshold exists: a
   * half-decibel wobble auto-fitted fills the whole box and reads as a
   * dramatic climb. A fixed window makes a flat line genuinely mean "flat".
   */
  bounds?: { min: number; max: number };
  /** Thresholds, in the same units as `points`. Sorted internally. */
  bands?: SparkBand[];
}) {
  const gradientId = useId();
  if (points.length < 2) return null;

  const W = 240;
  const H = 48;
  const PAD = 2; // keep the 2px stroke from clipping at the extremes

  const max = bounds ? bounds.max : Math.max(...points);
  const min = bounds ? bounds.min : Math.min(...points);
  // A perfectly flat line would divide by zero; draw it through the middle.
  const span = max - min || 1;
  const x = (i: number) => (i / (points.length - 1)) * W;
  // Clamped, because a fixed window can be exceeded — a room CAN go past the
  // top of the scale, and the path must not escape the viewBox when it does.
  const y = (v: number) =>
    PAD + (1 - Math.max(0, Math.min(1, (v - min) / span))) * (H - PAD * 2);

  const line = points.map((v, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
  // Closed back along the baseline so the area under the curve can be filled.
  const area = `${line} L${W},${H} L0,${H} Z`;

  // Bands become a vertical gradient with HARD stops — two at each boundary,
  // so it reads as bands rather than a wash. This colours the line by height
  // for free, which is the whole trick: no splitting the path into segments
  // and no gaps where a segment crosses a threshold between samples.
  const ordered = [...(bands ?? [])].sort((a, b) => b.from - a.from);
  const stops: { at: number; tone: string }[] = [];
  if (ordered.length) {
    stops.push({ at: 0, tone: ordered[0].tone });
    for (const [i, band] of ordered.entries()) {
      const at = Math.max(0, Math.min(1, (y(band.from) - PAD) / (H - PAD * 2)));
      stops.push({ at, tone: band.tone });
      stops.push({ at, tone: ordered[i + 1]?.tone ?? 'ok' });
    }
    stops.push({ at: 1, tone: 'ok' });
  }
  const paint = stops.length ? `url(#${gradientId})` : undefined;

  return (
    <svg
      className={['spark', className].filter(Boolean).join(' ')}
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="none"
      role="img"
      aria-label={label}
    >
      {stops.length > 0 && (
        <defs>
          {/* userSpaceOnUse so the stops are in viewBox coordinates — the same
              ones y() produces — rather than relative to the path's bounding
              box, which moves with the data. */}
          <linearGradient id={gradientId} gradientUnits="userSpaceOnUse" x1={0} y1={0} x2={0} y2={H}>
            {stops.map((s, i) => (
              <stop key={i} offset={s.at} className={`spark__stop spark__stop--${s.tone}`} />
            ))}
          </linearGradient>
        </defs>
      )}

      {/* Drawn UNDER the curve: without a visible boundary the colour change
          says something happened but not what, and "what" is the number the
          room agreed on. */}
      {ordered.map((band) => (
        <line
          key={band.from}
          className={`spark__mark spark__mark--${band.tone}`}
          x1={0}
          x2={W}
          y1={y(band.from)}
          y2={y(band.from)}
        />
      ))}

      <path className="spark__area" d={area} style={paint ? { fill: paint } : undefined} />
      <path className="spark__line" d={line} style={paint ? { stroke: paint } : undefined} />
    </svg>
  );
}
