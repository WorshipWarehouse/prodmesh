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
  site: string | null;
  hasCompanion: boolean;
  modes: RoomMode[];
}

export interface Protection {
  active: boolean;
  label: string | null;
  lockedModes: string[];
  enforced: boolean;
}

export interface RoomState {
  mode: string | null;
  raw: string;
  online: boolean;
  source: 'companion' | 'mock';
  protection: Protection;
  error?: string;
}

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json() as Promise<T>;
}

export const getRoom = (id: string) =>
  getJson<RoomMeta>(`/api/rooms/${encodeURIComponent(id)}`);

export const getRooms = () => getJson<RoomMeta[]>('/api/rooms');

export const getRoomState = (id: string) =>
  getJson<RoomState>(`/api/rooms/${encodeURIComponent(id)}/state`);

/** Thrown when a mode change is locked and the override PIN was missing/wrong. */
export class OverrideRequiredError extends Error {
  constructor() {
    super('override_required');
    this.name = 'OverrideRequiredError';
  }
}

export async function setRoomMode(
  id: string,
  mode: string,
  overridePin?: string,
): Promise<RoomState> {
  const res = await fetch(`/api/rooms/${encodeURIComponent(id)}/mode`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ mode, overridePin }),
  });
  if (res.status === 403) {
    const body = await res.json().catch(() => ({}));
    if (body.error === 'override_required') throw new OverrideRequiredError();
  }
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json() as Promise<RoomState>;
}

// ── Admin auth (bearer token in localStorage) ─────────────────────────────────

const TOKEN_KEY = 'pm_admin_token';
export const getToken = () => localStorage.getItem(TOKEN_KEY);
export const setToken = (t: string) => localStorage.setItem(TOKEN_KEY, t);
export const clearToken = () => localStorage.removeItem(TOKEN_KEY);

function authHeaders(): Record<string, string> {
  const t = getToken();
  return t ? { Authorization: `Bearer ${t}` } : {};
}

export interface AuthStatus {
  admin: boolean;
  setupNeeded: boolean;
}

export const getAuthStatus = () =>
  fetch('/api/auth/status', { headers: authHeaders() }).then(
    (r) => r.json() as Promise<AuthStatus>,
  );

export async function loginAdmin(pin: string): Promise<boolean> {
  const res = await fetch('/api/auth/admin', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pin }),
  });
  if (!res.ok) return false;
  const { token } = await res.json();
  setToken(token);
  return true;
}

export async function logoutAdmin(): Promise<void> {
  await fetch('/api/auth/logout', { method: 'POST', headers: authHeaders() }).catch(() => {});
  clearToken();
}

// ── Settings ──────────────────────────────────────────────────────────────────

export interface ScheduleWindow {
  id: string;
  label: string;
  days: number[];
  start: string;
  end: string;
  lock: string[];
}

export interface Settings {
  pins: { adminSet: boolean; overrideSet: boolean };
  schedules: Record<string, ScheduleWindow[]>;
}

export const getSettings = () =>
  fetch('/api/settings', { headers: authHeaders() }).then((r) => {
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return r.json() as Promise<Settings>;
  });

/** Set/clear PINs. Empty string clears; undefined leaves unchanged. Admin
 *  bootstrap (first admin PIN) works without a token. */
export async function setPins(pins: { admin?: string; override?: string }): Promise<void> {
  const res = await fetch('/api/settings/pins', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify(pins),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
}

export async function saveSchedules(
  schedules: Record<string, ScheduleWindow[]>,
): Promise<void> {
  const res = await fetch('/api/settings/schedules', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify({ schedules }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
}

// ── Checklist templates (per event type, edited in Admin) ────────────────────

export interface TemplateItem {
  id?: string; // omitted for new items — the server assigns a stable slug
  label: string;
  action?: { type: 'mode'; mode: string } | null;
}

export interface ChecklistTemplatesInfo {
  templates: Record<string, TemplateItem[]>; // keyed by service type id, '*' = default
  serviceTypes: { id: string; name: string }[];
  modes: { id: string; label: string }[];
}

export const getChecklistTemplates = () =>
  getJson<ChecklistTemplatesInfo>('/api/checklist-templates');

export async function saveChecklistTemplate(
  serviceTypeId: string,
  items: TemplateItem[],
): Promise<Record<string, TemplateItem[]>> {
  const res = await fetch(`/api/checklist-templates/${encodeURIComponent(serviceTypeId)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify({ items }),
  });
  if (!res.ok) throw new Error((await res.json().catch(() => null))?.error ?? `HTTP ${res.status}`);
  return ((await res.json()) as { templates: Record<string, TemplateItem[]> }).templates;
}

export async function deleteChecklistTemplate(
  serviceTypeId: string,
): Promise<Record<string, TemplateItem[]>> {
  const res = await fetch(`/api/checklist-templates/${encodeURIComponent(serviceTypeId)}`, {
    method: 'DELETE',
    headers: authHeaders(),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return ((await res.json()) as { templates: Record<string, TemplateItem[]> }).templates;
}

// ── System ────────────────────────────────────────────────────────────────────

export interface Version {
  commit: string;
  subject: string;
}

export const getVersion = () => getJson<Version>('/api/system/version');

// ── Planning Center Services ──────────────────────────────────────────────────

export interface PlanTime {
  id: string;
  name: string | null;
  startsAt: string | null;
  endsAt: string | null;
  type: string | null;
}

export interface PlanItem {
  id: string;
  sequence: number | null;
  title: string;
  type: string | null;
  length: number | null;
  key: string | null; // song key, e.g. "D"
  leader: string | null; // from the item's "Leader" note
  description: string | null;
}

export interface ServicePlan {
  id: string;
  serviceTypeId: string;
  serviceTypeName: string;
  title: string;
  seriesTitle: string | null;
  dates: string | null;
  sortDate: string | null;
  times: PlanTime[];
  items: PlanItem[];
  _mock?: boolean;
}

export interface RoomService {
  configured: boolean;
  live: boolean;
  plans: ServicePlan[];
  error?: string;
}

export interface ServicesOverview {
  live: boolean;
  services: {
    roomId: string;
    roomName: string;
    serviceType: string;
    next: ServicePlan | null;
    error?: string;
  }[];
}

export const getRoomService = (id: string) =>
  getJson<RoomService>(`/api/rooms/${encodeURIComponent(id)}/service`);

export const getRoomPlan = (id: string, planId: string) =>
  getJson<{ live: boolean; plan: ServicePlan }>(
    `/api/rooms/${encodeURIComponent(id)}/plan/${encodeURIComponent(planId)}`,
  );

// ── Event Detail (times + notes + startup checklist for one event) ────────────

export interface PlanNote {
  category: string | null;
  content: string;
}

export interface ChecklistItem {
  id: string;
  label: string;
  action: { type: 'mode'; mode: string } | null;
  done: boolean;
  doneAt: number | null;
}

export interface ShowConfig {
  startItemId: string | null; // PP lands on this PC item → show autostarts
  endItemId: string | null; // last slide of this PC item → show auto-completes
  map: Record<string, { ppIndex: number; ppName: string | null } | null>;
}

export interface PpPlaylist {
  playlistName: string | null;
  items: { index: number; name: string; type: string }[];
}

export interface EventDetail {
  live: boolean;
  plan: ServicePlan;
  detail: { artwork: string | null; notes: PlanNote[] };
  checklist: ChecklistItem[];
  showConfig: ShowConfig | null;
}

export const getEventDetail = (id: string, planId: string) =>
  getJson<EventDetail>(
    `/api/rooms/${encodeURIComponent(id)}/event/${encodeURIComponent(planId)}`,
  );

export async function saveShowConfig(
  id: string,
  planId: string,
  config: ShowConfig,
): Promise<ShowConfig> {
  const res = await fetch(
    `/api/rooms/${encodeURIComponent(id)}/event/${encodeURIComponent(planId)}/show-config`,
    { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(config) },
  );
  if (!res.ok) throw new Error((await res.json().catch(() => null))?.error ?? `HTTP ${res.status}`);
  return ((await res.json()) as { showConfig: ShowConfig }).showConfig;
}

export async function clearShowConfig(id: string, planId: string): Promise<void> {
  const res = await fetch(
    `/api/rooms/${encodeURIComponent(id)}/event/${encodeURIComponent(planId)}/show-config`,
    { method: 'DELETE' },
  );
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
}

export const getPpPlaylist = (id: string) =>
  getJson<{ playlist: PpPlaylist | null }>(`/api/rooms/${encodeURIComponent(id)}/pp-playlist`);

export const setChecklistItem = (id: string, planId: string, itemId: string, done: boolean) =>
  postJson<{ checklist: ChecklistItem[] }>(
    `/api/rooms/${encodeURIComponent(id)}/event/${encodeURIComponent(planId)}/checklist/${encodeURIComponent(itemId)}`,
    { done },
  );

export interface ReportItem {
  itemName: string;
  plannedLength: number | null;
  actualSeconds: number;
  delta: number | null;
  ongoing: boolean;
}

export interface SplReport {
  count: number;
  leq: number | null; // energy-averaged dB over the captured window
  peak: number | null;
  from: number;
  to: number;
  target: number | null; // room's dB goal (e.g. 90)
  limit: number | null; // do-not-exceed (e.g. 95)
}

export interface TimingReport {
  items: ReportItem[];
  totals: { planned: number; actual: number; delta: number };
  startedAt?: number | null;
  completedAt?: number | null;
  spl?: SplReport | null;
}

export const getReport = (id: string, planId: string, timeId?: string | null) =>
  getJson<TimingReport>(
    `/api/rooms/${encodeURIComponent(id)}/plan/${encodeURIComponent(planId)}/report` +
      (timeId ? `?time=${encodeURIComponent(timeId)}` : ''),
  );

// ── Show session (server-coordinated Run of Show) ─────────────────────────────

export interface ShowCurrent {
  itemId: string | null;
  itemIndex: number | null;
  itemName: string | null;
  slideIndex: number | null;
  slideCount: number | null;
}

export interface PpTimer {
  uuid: string | null;
  name: string;
  state: string; // 'running' | 'stopped' | …
  remainingSeconds: number | null;
  targetSecondsOfDay: number | null; // seconds since midnight, or null
  countsDownToTime: boolean;
}

export interface SplState {
  current: number; // latest sample, dB
  avg: number | null; // running Leq — only while a show is live
  peak: number | null; // show peak — only while a show is live
  target: number | null;
  limit: number | null;
}

export interface ShowState {
  active: boolean;
  roomId?: string;
  planId?: string;
  timeId?: string;
  startedAt?: number;
  follow?: boolean;
  ppConnected?: boolean | null;
  current?: ShowCurrent;
  timer?: PpTimer | null;
  spl?: SplState | null;
}

export const getShow = (roomId: string) =>
  getJson<ShowState>(`/api/rooms/${encodeURIComponent(roomId)}/show`);

async function postJson<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json() as Promise<T>;
}

export const startShow = (roomId: string, planId: string, timeId: string) =>
  postJson<ShowState>(`/api/rooms/${encodeURIComponent(roomId)}/show/start`, { planId, timeId });

export const endShow = (roomId: string) =>
  postJson<ShowState>(`/api/rooms/${encodeURIComponent(roomId)}/show/end`, {});

export const setShowCurrent = (roomId: string, body: { itemId?: string; follow?: boolean }) =>
  postJson<ShowState>(`/api/rooms/${encodeURIComponent(roomId)}/show/current`, body);

export const getServicesOverview = () => getJson<ServicesOverview>('/api/services');

// ── History (Analytics) ──────────────────────────────────────────────────────

export interface HistoryShow {
  instanceId: string;
  roomId: string | null;
  roomName: string | null;
  site: string | null;
  planId: string | null;
  timeId: string | null;
  planTitle: string | null;
  serviceTypeName: string | null;
  dates: string | null;
  timeName: string | null;
  timeStartsAt: string | null;
  startedAt: number | null;
  completedAt: number | null;
  itemCount: number;
  totals: { planned: number; actual: number; delta: number };
  spl: SplReport | null;
}

export const getHistory = () => getJson<{ shows: HistoryShow[] }>('/api/history');

export const getAbout = () => getJson<{ name: string; version: string }>('/api/about');

export const triggerUpdate = () =>
  fetch('/api/system/update', { method: 'POST', headers: authHeaders() }).then((r) => {
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return r.json();
  });
