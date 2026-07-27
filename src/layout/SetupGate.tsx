import { useEffect, useState, type ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { getSetupState } from '../api';

/** Dispatched by the wizard's last step so the gate stops redirecting. */
export const SETUP_COMPLETE_EVENT = 'prodmesh:setup-complete';

// An unclaimed install has no admin PIN and no campuses — the app underneath
// is an empty shell with a station dialog on top, which is a poor first thing
// for a church to meet. Every route redirects to the wizard until setup is
// stamped complete.
//
// Fails OPEN: if /api/setup can't be reached, the app renders. A booth screen
// on a Sunday morning must not be held hostage by a setup check.
export function SetupGate({ children }: { children: ReactNode }) {
  const [checked, setChecked] = useState(false);
  const [needed, setNeeded] = useState(false);
  const location = useLocation();

  useEffect(() => {
    let cancelled = false;
    getSetupState()
      .then((s) => { if (!cancelled) setNeeded(s.needed); })
      .catch(() => {})
      .finally(() => { if (!cancelled) setChecked(true); });

    // Finishing happens in the same tick as the wizard's own navigation, so
    // the gate is already up to date by the time it sees the new route — no
    // refetch, and no bounce back into setup.
    const done = () => setNeeded(false);
    window.addEventListener(SETUP_COMPLETE_EVENT, done);
    return () => {
      cancelled = true;
      window.removeEventListener(SETUP_COMPLETE_EVENT, done);
    };
  }, []);

  // Nothing until the answer is in: rendering the shell first would flash an
  // empty dashboard before the redirect.
  if (!checked) return null;
  if (needed && location.pathname !== '/setup') return <Navigate to="/setup" replace />;
  if (!needed && location.pathname === '/setup') return <Navigate to="/" replace />;
  return <>{children}</>;
}
