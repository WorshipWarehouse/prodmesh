import type { ReactNode } from 'react';
import { spanColumns, type WidgetSpan } from '../widgets/types';

// Dashboard building blocks: pages compose Widgets into a WidgetGrid.
// A new feature is a new Widget dropped into the grid — not a page rewrite.

export function WidgetGrid({ children }: { children: ReactNode }) {
  return <div className="widgets">{children}</div>;
}

export function Widget({
  title,
  meta,
  span,
  className,
  children,
}: {
  title?: string;
  meta?: ReactNode; // badges / actions in the header's right corner
  /** Columns on the 12-col grid at ≥880px; always full width below. */
  span?: WidgetSpan;
  className?: string;
  children: ReactNode;
}) {
  const cols = spanColumns(span);
  const cls = ['widget', cols && `widget--span-${cols}`, className].filter(Boolean).join(' ');
  return (
    <section className={cls}>
      {(title || meta) && (
        <div className="widget__head">
          {title ? <h2 className="widget__title">{title}</h2> : <span />}
          {meta && <div className="widget__meta">{meta}</div>}
        </div>
      )}
      {children}
    </section>
  );
}
