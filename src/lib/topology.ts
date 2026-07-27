import type { Church } from '../types';

// Ids for sites, rooms and tiles. The server accepts only lowercase letters,
// digits and dashes (validate.js TOPO_ID) and rejects duplicates anywhere in
// the tree, so both editors that mint ids — the setup wizard and Admin →
// Campuses — derive them the same way here.

/** A url-safe id from a human label, made unique against `taken`. */
export function slugId(label: string, taken: Set<string>) {
  const base = label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'item';
  let id = base;
  for (let n = 2; taken.has(id); n += 1) id = `${base}-${n}`;
  taken.add(id);
  return id;
}

/** Every id already used in the tree — ids must be unique across all levels. */
export function allIds(church: Church) {
  const ids = new Set<string>();
  for (const site of church.sites) {
    ids.add(site.id);
    for (const room of site.auditoriums) {
      ids.add(room.id);
      for (const tile of room.tiles) ids.add(tile.id);
    }
  }
  return ids;
}

/**
 * The draft as the server wants it. Existing ids are reused rather than
 * regenerated: a resumed wizard must not orphan the stations, schedules and
 * saved links that already point at a room.
 *
 * Each new room gets a Room Status tile, so its card on Home opens onto
 * something instead of being an empty box.
 */
export function buildChurch(
  existing: Church,
  name: string,
  campusName: string,
  roomNames: string[],
): Church {
  const site = existing.sites[0];
  const taken = allIds(existing);
  const siteId = site?.id ?? slugId(campusName, taken);

  const auditoriums = roomNames.map((roomName, i) => {
    const prev = site?.auditoriums[i];
    const id = prev?.id ?? slugId(roomName, taken);
    const tiles = prev?.tiles ?? [
      { id: slugId(`${id}-status`, taken), type: 'route' as const, label: 'Room Status', to: `/room/${id}` },
    ];
    return { id, name: roomName, tiles };
  });

  return {
    ...existing,
    name: name.trim(),
    sites: [
      { id: siteId, name: campusName.trim(), status: 'active' as const, auditoriums },
      ...existing.sites.slice(1),
    ],
  };
}
