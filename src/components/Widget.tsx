import type { ReactNode } from 'react';

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
  span?: 'half' | 'third' | 'two-thirds'; // grid width ≥880px; full width below
  className?: string;
  children: ReactNode;
}) {
  const cls = ['widget', span && `widget--${span}`, className].filter(Boolean).join(' ');
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
