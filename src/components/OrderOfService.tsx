import { Clapperboard, Dot, Music, Play, User } from 'lucide-react';
import type { PlanItem } from '../api';

export function fmtLength(sec: number | null) {
  if (!sec) return '';
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return s ? `${m}:${String(s).padStart(2, '0')}` : `${m} min`;
}

interface Props {
  items: PlanItem[];
  /** When set, the matching item is highlighted as the current position. */
  currentId?: string | null;
  /** When set, non-header items become clickable to set the current position. */
  onSelect?: (id: string) => void;
}

export function OrderOfService({ items, currentId, onSelect }: Props) {
  return (
    <ul className="svc__items">
      {items.map((it) => {
        const type = it.type ?? 'item';
        if (type === 'header') {
          return (
            <li key={it.id} className="svc__item svc__item--header">
              <span className="svc__item-title">{it.title}</span>
            </li>
          );
        }
        const icon =
          type === 'song' ? <Music size={14} /> : type === 'media' ? <Clapperboard size={14} /> : <Dot size={18} />;
        const isCurrent = currentId != null && it.id === currentId;
        const clickable = Boolean(onSelect);
        return (
          <li
            key={it.id}
            className={`svc__item svc__item--${type}${isCurrent ? ' svc__item--current' : ''}${clickable ? ' svc__item--clickable' : ''}`}
            onClick={clickable ? () => onSelect!(it.id) : undefined}
          >
            <span className="svc__item-icon" aria-hidden>
              {isCurrent ? <Play size={13} fill="currentColor" /> : icon}
            </span>
            <span className="svc__item-title">{it.title}</span>
            {it.leader && (
              <span className="svc__item-leader" title="Leader">
                <User size={12} /> {it.leader}
              </span>
            )}
            {it.key && <span className="svc__item-key" title="Key">{it.key}</span>}
            {it.length ? <span className="svc__item-len">{fmtLength(it.length)}</span> : null}
          </li>
        );
      })}
    </ul>
  );
}
