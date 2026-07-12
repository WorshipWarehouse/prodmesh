import { describe, expect, it } from 'vitest';
import { church } from './dashboard.config';

describe('dashboard configuration invariants', () => {
  it('has stable, globally unique site, room, and tile IDs', () => {
    const ids = new Set<string>();
    const add = (id: string) => {
      expect(id).toMatch(/^[a-z0-9][a-z0-9-]*$/);
      expect(ids.has(id), `Duplicate dashboard ID: ${id}`).toBe(false);
      ids.add(id);
    };

    expect(church.name.trim()).not.toBe('');
    church.sites.forEach((site) => {
      add(site.id);
      site.auditoriums.forEach((room) => {
        add(room.id);
        room.tiles.forEach((tile) => add(tile.id));
      });
    });
  });

  it('only exposes complete launcher targets for actionable tiles', () => {
    for (const site of church.sites) {
      for (const room of site.auditoriums) {
        for (const tile of room.tiles) {
          if (tile.type === 'route') expect(tile.to).toMatch(/^\//);
          if (tile.type === 'link') expect(tile.url).toMatch(/^https?:\/\//);
          if (tile.type === 'companion' || tile.type === 'screenshare') {
            expect(tile.host.trim(), `${tile.id} needs a host`).not.toBe('');
          }
        }
      }
    }
  });
});
