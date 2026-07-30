import { createContext, useContext } from 'react';
import type { Church } from '../types';
import { ALL_CAMPUSES } from './campus';

// The institution topology (name → sites → rooms → Quick Access tiles),
// served by GET /api/config and owned by Admin → Campuses. AppShell fetches
// it once at boot and provides it here; it refetches when anything dispatches
// a 'prodmesh:config-changed' window event (the Campuses editor does on save).
export const EMPTY_CHURCH: Church = { name: 'Production Dashboard', sites: [] };

export const ChurchContext = createContext<Church>(EMPTY_CHURCH);

export const useChurch = () => useContext(ChurchContext);

/**
 * Room display name for cross-campus views. Campuses reuse room names
 * ("Main Auditorium" exists at North Campus AND South Campus), so any list that
 * can span campuses prefixes the campus name — but only when it has to:
 * viewing a single campus, or a name that already carries it, stays short.
 */
export function roomLabel(
  name: string,
  site: string | null | undefined,
  church: Church,
  campusId: string,
): string {
  if (campusId !== ALL_CAMPUSES) return name; // single-campus view — no ambiguity
  const siteName = site ? church.sites.find((s) => s.id === site)?.name : undefined;
  if (!siteName || name.toLowerCase().includes(siteName.toLowerCase())) return name;
  return `${siteName} · ${name}`;
}
