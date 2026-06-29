// Tile registry — the single place that knows how each tile type behaves.
//
// Each entry maps a Tile.type to:
//   - icon:    a glyph shown on the tile
//   - accent:  a CSS color used for the tile's accent
//   - href:    where clicking the tile goes (or null for non-clickable tiles)
//   - target:  optional anchor target (e.g. '_blank' for web UIs)
//
// Adding a new module = add a type to src/types.ts and one entry here.

import type { Tile } from '../types';
import companionIcon from '../assets/companion.webp';

export interface TileBehavior {
  /** Emoji fallback icon (used when no `iconImage` and no per-tile `icon`). */
  icon: string;
  /** Optional image icon (imported asset) shown instead of the emoji. */
  iconImage?: string;
  accent: string;
  /** Resolve the destination for a tile, or null if it isn't clickable. */
  href: (tile: Tile) => string | null;
  /** Anchor target. External web UIs open in a new tab. */
  target?: '_blank' | '_self';
}

export const tileRegistry: Record<Tile['type'], TileBehavior> = {
  companion: {
    icon: '🎛️',
    iconImage: companionIcon,
    accent: '#5b8def',
    target: '_blank',
    href: (tile) => {
      if (tile.type !== 'companion') return null;
      const port = tile.port ?? 8000;
      const path =
        tile.view === 'tablet'
          ? '/tablet'
          : tile.view === 'emulator'
            ? '/emulator'
            : '/';
      return `http://${tile.host}:${port}${path}`;
    },
  },

  screenshare: {
    icon: '🖥️',
    accent: '#34c759',
    target: '_self',
    // vnc://host is handled by macOS and opens Screen Sharing.app directly.
    // A username (if set) is prefilled as vnc://user@host.
    href: (tile) => {
      if (tile.type !== 'screenshare') return null;
      const auth = tile.username ? `${encodeURIComponent(tile.username)}@` : '';
      return `vnc://${auth}${tile.host}`;
    },
  },

  link: {
    icon: '🔗',
    accent: '#af7bf0',
    target: '_blank',
    href: (tile) => (tile.type === 'link' ? tile.url : null),
  },

  route: {
    icon: '📊',
    accent: '#ffce54',
    target: '_self',
    // Internal navigation — the Tile component renders a router <Link> for these.
    href: (tile) => (tile.type === 'route' ? tile.to : null),
  },

  placeholder: {
    icon: '➕',
    accent: '#6b7280',
    href: () => null,
  },
};
