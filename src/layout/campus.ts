import { createContext, useContext } from 'react';

// The campus (site) filter selected in the sidebar. 'all' = no filter.
// Pages read this to scope what they show; rooms carry a `site` id from the
// server, and the campus list itself comes from dashboard.config sites.
export const ALL_CAMPUSES = 'all';

export const CampusContext = createContext<{
  campusId: string;
  setCampusId: (id: string) => void;
}>({ campusId: ALL_CAMPUSES, setCampusId: () => {} });

export const useCampus = () => useContext(CampusContext);

/** Whether a room/site belongs to the selected campus. Rooms without a site
 *  are never hidden — misconfiguration shouldn't make a room invisible. */
export function inCampus(campusId: string, site: string | null | undefined) {
  return campusId === ALL_CAMPUSES || !site || site === campusId;
}
