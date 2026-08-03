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

export function Sparkline({
  points,
  label,
  className,
}: {
  points: number[];
  /** Describes the curve for screen readers — an SVG of a shape is otherwise mute. */
  label: string;
  className?: string;
}) {
  if (points.length < 2) return null;

  const W = 240;
  const H = 48;
  const PAD = 2; // keep the 2px stroke from clipping at the extremes

  const max = Math.max(...points);
  const min = Math.min(...points);
  // A perfectly flat line would divide by zero; draw it through the middle.
  const span = max - min || 1;
  const x = (i: number) => (i / (points.length - 1)) * W;
  const y = (v: number) => PAD + (1 - (v - min) / span) * (H - PAD * 2);

  const line = points.map((v, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
  // Closed back along the baseline so the area under the curve can be filled.
  const area = `${line} L${W},${H} L0,${H} Z`;

  return (
    <svg
      className={['spark', className].filter(Boolean).join(' ')}
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="none"
      role="img"
      aria-label={label}
    >
      <path className="spark__area" d={area} />
      <path className="spark__line" d={line} />
    </svg>
  );
}
