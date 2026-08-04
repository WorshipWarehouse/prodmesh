import { createContext, useContext } from 'react';
import type { AuthStatus } from '../api';

// Who is operating this station, and what they are allowed to do.
//
// AppShell already fetches /api/auth/status at boot and refetches on
// 'prodmesh:auth-changed'; this publishes that one copy so a page can gate a
// control instead of discovering the refusal by pressing it.
//
// The server remains the boundary — every gated route checks the permission
// again. This is guidance, not enforcement.
export const IdentityContext = createContext<AuthStatus | null>(null);

export const useIdentity = () => useContext(IdentityContext);

export function can(identity: AuthStatus | null, permission: string): boolean {
  // Unknown identity answers YES: the status request has not landed yet (or
  // failed), and a control that starts disabled and enables a moment later
  // reads as broken. Guessing wrong this way costs a clear error message from
  // the server; guessing wrong the other way makes a permitted operator think
  // they are locked out mid-service.
  if (!identity) return true;
  return identity.permissions.includes('*') || identity.permissions.includes(permission);
}

export const useCan = (permission: string) => can(useIdentity(), permission);
