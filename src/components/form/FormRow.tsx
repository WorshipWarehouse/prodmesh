import type { ReactNode } from 'react';

// A grid row of Fields sharing the 40px control baseline. `card` frames the
// row (used per Companion mode) so it still reads as one unit when it wraps;
// below ~720px card rows reflow into a two-column grid (see form.css).
export function FormRow({ card = false, children }: { card?: boolean; children: ReactNode }) {
  return <div className={`formrow${card ? ' formrow--card' : ''}`}>{children}</div>;
}
