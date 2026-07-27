// Past a day, hours stop being readable: an event next Sunday counted down as
// "151:43:45", which nobody parses as six days. Seconds only matter close in,
// which is exactly when this falls back to the clock format.
export function hhmmss(totalSeconds: number) {
  const s = Math.max(0, Math.floor(totalSeconds));
  if (s >= 86400) {
    const d = Math.floor(s / 86400);
    const h = Math.floor((s % 86400) / 3600);
    return `${d}d ${String(h).padStart(2, '0')}h`;
  }
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return `${h ? `${h}:` : ''}${String(m).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}
