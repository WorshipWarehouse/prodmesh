// Shared useQuery cache keys.
//
// A widget is only free to be placed anywhere if fetching its own data costs
// nothing extra when the page around it already wanted that data — which is
// true exactly when both sides use the SAME key. A typo doesn't break
// anything visibly, it just silently doubles the request, so the keys live
// here rather than being spelled out at each call site.

export const planKey = (roomId: string, planId: string) => `plan:${roomId}:${planId}`;
export const reportKey = (roomId: string, planId: string, timeId: string | null) =>
  `report:${roomId}:${planId}:${timeId ?? ''}`;
export const roomServiceKey = (roomId: string) => `room-service:${roomId}`;
export const roomStateKey = (roomId: string) => `room-state:${roomId}`;
