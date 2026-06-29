import { Link } from 'react-router-dom';
import type { Tile as TileData } from '../types';
import { tileRegistry } from '../tiles/registry';

export function Tile({ tile }: { tile: TileData }) {
  const behavior = tileRegistry[tile.type];
  const href = behavior.href(tile);

  // Per-tile emoji override wins; otherwise an image icon (if any); else emoji.
  const iconEl =
    tile.icon != null ? (
      <span className="tile__icon" aria-hidden>
        {tile.icon}
      </span>
    ) : behavior.iconImage ? (
      <img className="tile__icon-img" src={behavior.iconImage} alt="" aria-hidden />
    ) : (
      <span className="tile__icon" aria-hidden>
        {behavior.icon}
      </span>
    );

  const inner = (
    <>
      {iconEl}
      <span className="tile__text">
        <span className="tile__label">{tile.label}</span>
        {tile.note && <span className="tile__note">{tile.note}</span>}
      </span>
    </>
  );

  const style = { ['--accent' as string]: behavior.accent };

  // Non-clickable tiles (placeholders) render as a dimmed div.
  if (!href) {
    return (
      <div className="tile tile--disabled" style={style}>
        {inner}
      </div>
    );
  }

  // Internal navigation uses the SPA router so there's no full page reload.
  if (tile.type === 'route') {
    return (
      <Link className="tile" to={href} style={style}>
        {inner}
      </Link>
    );
  }

  return (
    <a
      className="tile"
      href={href}
      target={behavior.target ?? '_self'}
      rel={behavior.target === '_blank' ? 'noopener noreferrer' : undefined}
      style={style}
    >
      {inner}
    </a>
  );
}
