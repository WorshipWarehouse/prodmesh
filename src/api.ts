// Frontend client for the dashboard backend (which proxies to Companion).

export interface RoomMode {
  id: string;
  label: string;
  color: string;
  isStandby: boolean;
}

export interface RoomMeta {
  id: string;
  name: string;
  hasCompanion: boolean;
  modes: RoomMode[];
}

export interface RoomState {
  mode: string | null;
  raw: string;
  online: boolean;
  source: 'companion' | 'mock';
  error?: string;
}

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json() as Promise<T>;
}

export const getRoom = (id: string) =>
  getJson<RoomMeta>(`/api/rooms/${encodeURIComponent(id)}`);

export const getRoomState = (id: string) =>
  getJson<RoomState>(`/api/rooms/${encodeURIComponent(id)}/state`);

export async function setRoomMode(id: string, mode: string): Promise<RoomState> {
  const res = await fetch(`/api/rooms/${encodeURIComponent(id)}/mode`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ mode }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json() as Promise<RoomState>;
}
