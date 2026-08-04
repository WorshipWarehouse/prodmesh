import { Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { BookOpen, Search, X } from 'lucide-react';

// ─────────────────────────────────────────────────────────────────────────────
//  The documentation, inside the app.
//
//  A booth machine may have no route to the internet — which is precisely when
//  someone needs the page explaining why Smaart is reporting no SPL. So the
//  guide ships with the app rather than living only on the docs site.
//
//  The pages are rendered to HTML at BUILD time (see vite-plugin-help.ts), so
//  there is no markdown parser in the bundle, and they are behind a dynamic
//  import so none of it is downloaded until someone opens Help.
// ─────────────────────────────────────────────────────────────────────────────

interface HelpPage {
  slug: string;
  title: string;
  html: string;
  text: string;
}

// The one dynamic import: this is what keeps the guide out of the main bundle.
const loadPages = () => import('virtual:help-content').then((m) => m.default as HelpPage[]);

function Body({ onClose }: { onClose: () => void }) {
  const [pages, setPages] = useState<HelpPage[] | null>(null);
  const [slug, setSlug] = useState<string>('index');
  const [query, setQuery] = useState('');
  const article = useRef<HTMLDivElement>(null);

  useEffect(() => { loadPages().then(setPages); }, []);

  const matches = useMemo(() => {
    if (!pages) return [];
    const q = query.trim().toLowerCase();
    return q ? pages.filter((p) => p.text.includes(q) || p.title.toLowerCase().includes(q)) : pages;
  }, [pages, query]);

  const current = pages?.find((p) => p.slug === slug) ?? pages?.[0] ?? null;

  // Scroll back to the top when switching pages — otherwise arriving halfway
  // down a long page reads as the wrong page having opened.
  useEffect(() => { article.current?.scrollTo(0, 0); }, [slug]);

  // Cross-page links were rewritten at build time to #help/<slug>, so they can
  // be handled in here instead of navigating the browser away from the room
  // someone is in the middle of operating.
  const onClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const link = (e.target as HTMLElement).closest('a');
    if (!link) return;
    const href = link.getAttribute('href') ?? '';
    if (href.startsWith('#help/')) {
      e.preventDefault();
      const [page, hash] = href.slice('#help/'.length).split('#');
      setSlug(page);
      if (hash) {
        // After the new page renders, jump to the anchor within it.
        requestAnimationFrame(() => {
          article.current?.querySelector(`#${CSS.escape(hash)}`)?.scrollIntoView();
        });
      }
    } else if (/^https?:/.test(href)) {
      link.setAttribute('target', '_blank');
      link.setAttribute('rel', 'noreferrer noopener');
    }
  };

  if (!pages) return <div className="help__loading">Loading the guide…</div>;

  return (
    <>
      <div className="help__side">
        <div className="help__searchwrap">
          <Search size={14} className="help__searchicon" />
          <input
            className="field help__search"
            placeholder="Search the guide"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            autoFocus
          />
        </div>
        <nav className="help__nav">
          {matches.map((p) => (
            <button
              key={p.slug}
              className={`help__navitem${p.slug === current?.slug ? ' help__navitem--on' : ''}`}
              onClick={() => setSlug(p.slug)}
            >
              {p.title}
            </button>
          ))}
          {matches.length === 0 && <p className="help__none">Nothing matches “{query}”.</p>}
        </nav>
      </div>

      <div className="help__main">
        <div className="help__head">
          <h2 className="help__title">{current?.title}</h2>
          <button className="help__close" onClick={onClose} aria-label="Close help">
            <X size={17} />
          </button>
        </div>
        <div
          className="help__article"
          ref={article}
          onClick={onClick}
          // Built from our own repository files at build time — not user input,
          // and never fetched at runtime.
          dangerouslySetInnerHTML={{ __html: current?.html ?? '' }}
        />
      </div>
    </>
  );
}

export function HelpDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  // Escape closes it. Registered only while open so it cannot swallow the key
  // from a dialog underneath.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="help__scrim" onClick={onClose}>
      <div
        className="help"
        role="dialog"
        aria-modal="true"
        aria-label="prodmesh guide"
        onClick={(e) => e.stopPropagation()}
      >
        <Suspense fallback={<div className="help__loading">Loading the guide…</div>}>
          <Body onClose={onClose} />
        </Suspense>
      </div>
    </div>
  );
}

export const HelpIcon = BookOpen;
