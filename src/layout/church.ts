import { createContext, useContext } from 'react';
import type { Church } from '../types';

// The institution topology (name → sites → rooms → Quick Access tiles),
// served by GET /api/config and owned by Admin → Campuses. AppShell fetches
// it once at boot and provides it here; it refetches when anything dispatches
// a 'prodmesh:config-changed' window event (the Campuses editor does on save).
export const EMPTY_CHURCH: Church = { name: 'Production Dashboard', sites: [] };

export const ChurchContext = createContext<Church>(EMPTY_CHURCH);

export const useChurch = () => useContext(ChurchContext);
