// Frontend client for the dashboard backend (which proxies to Companion).

import type { Church } from './types';

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
  const res = await fetch(url, { headers: requestHeaders() });
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
    headers: { 'Content-Type': 'application/json', ...requestHeaders() },
    body: JSON.stringify({ mode, overridePin }),
  });
  if (res.status === 403) {
    const body = await res.clone().json().catch(() => ({}));
    if (body.error === 'override_required') throw new OverrideRequiredError();
  }
  await requireOk(res);
  return res.json() as Promise<RoomState>;
}

// ── Admin auth (bearer token in localStorage) ─────────────────────────────────

const TOKEN_KEY = 'pm_admin_token';
const STATION_KEY = 'pm_station_token';
export const getToken = () => localStorage.getItem(TOKEN_KEY);
export const setToken = (t: string) => {
  localStorage.setItem(TOKEN_KEY, t);
  window.dispatchEvent(new Event('prodmesh:auth-changed'));
};
export const clearToken = () => {
  localStorage.removeItem(TOKEN_KEY);
  window.dispatchEvent(new Event('prodmesh:auth-changed'));
};

export const getStationToken = () => localStorage.getItem(STATION_KEY);
export const setStationToken = (token: string) => localStorage.setItem(STATION_KEY, token);
export const clearStationIdentity = () => {
  localStorage.removeItem(STATION_KEY);
  localStorage.removeItem(TOKEN_KEY);
  window.dispatchEvent(new Event('prodmesh:auth-changed'));
};

function requestHeaders(): Record<string, string> {
  const t = getToken();
  const station = getStationToken();
  return {
    ...(t ? { Authorization: `Bearer ${t}` } : {}),
    ...(station ? { 'X-Prodmesh-Station': station } : {}),
  };
}

function promptForAuth(permission?: string) {
  window.dispatchEvent(new CustomEvent('prodmesh:auth-required', { detail: { permission } }));
}

async function requireOk(res: Response) {
  if (res.status === 401 || res.status === 403) {
    const body = await res.clone().json().catch(() => ({}));
    if (body.error === 'permission_required') promptForAuth(body.permission);
  }
  if (!res.ok) throw new Error((await res.json().catch(() => null))?.error ?? `HTTP ${res.status}`);
}

export interface Station {
  id: string;
  name: string;
  campusId: string | null;
  roomId: string | null;
}

export interface ManagedStation extends Station {
  createdAt: number;
  lastSeen: number;
  current: boolean;
}

export interface CurrentUser {
  id: string;
  username: string;
  displayName: string;
  planningCenterPersonId: string | null;
  avatarUrl?: string | null;
}

export interface AuthStatus {
  authenticated: boolean;
  admin: boolean;
  setupNeeded: boolean;
  user: CurrentUser | null;
  permissions: string[];
  station: Station | null;
}

export const getAuthStatus = () =>
  fetch('/api/auth/status', { headers: requestHeaders() }).then((r) => {
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return r.json() as Promise<AuthStatus>;
  });

export async function loginAdmin(pin: string): Promise<boolean> {
  const res = await fetch('/api/auth/admin', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...requestHeaders() },
    body: JSON.stringify({ pin }),
  });
  if (!res.ok) return false;
  const { token } = await res.json();
  setToken(token);
  return true;
}

export async function logoutAdmin(): Promise<void> {
  await fetch('/api/auth/logout', { method: 'POST', headers: requestHeaders() }).catch(() => {});
  clearToken();
}

export async function registerStation(input: { name: string; campusId?: string | null; roomId?: string | null }): Promise<Station> {
  const res = await fetch('/api/stations/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  await requireOk(res);
  const { station } = (await res.json()) as { station: Station & { token: string } };
  setStationToken(station.token);
  return station;
}

export const getStations = () => getJson<{ stations: ManagedStation[] }>('/api/stations');

export async function updateStation(
  stationId: string,
  input: { name: string; campusId: string | null; roomId: string | null },
): Promise<ManagedStation> {
  const res = await fetch(`/api/stations/${encodeURIComponent(stationId)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', ...requestHeaders() },
    body: JSON.stringify(input),
  });
  await requireOk(res);
  const station = ((await res.json()) as { station: ManagedStation }).station;
  if (station.current) window.dispatchEvent(new Event('prodmesh:auth-changed'));
  return station;
}

export async function revokeStation(stationId: string): Promise<{ current: boolean }> {
  const res = await fetch(`/api/stations/${encodeURIComponent(stationId)}`, {
    method: 'DELETE',
    headers: requestHeaders(),
  });
  await requireOk(res);
  const result = (await res.json()) as { current: boolean };
  if (result.current) clearStationIdentity();
  return result;
}

export async function loginUser(username: string, pin: string): Promise<AuthStatus> {
  const res = await fetch('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...requestHeaders() },
    body: JSON.stringify({ username, pin }),
  });
  if (!res.ok) throw new Error((await res.json().catch(() => null))?.error ?? 'Login failed');
  const { token } = await res.json();
  setToken(token);
  return getAuthStatus();
}

export interface PermissionGroup {
  id: string;
  name: string;
  systemKey: string | null;
  permissions: string[];
}

export interface ManagedUser extends CurrentUser {
  active: boolean;
  groups: PermissionGroup[];
  permissions: string[];
}

export interface UserDirectory {
  users: ManagedUser[];
  groups: PermissionGroup[];
  permissions: { id: string; label: string; description: string }[];
}

export const getUserDirectory = () => getJson<UserDirectory>('/api/users');

export async function createUser(input: {
  username: string;
  displayName: string;
  pin: string;
  planningCenterPersonId?: string | null;
  groupIds: string[];
}): Promise<ManagedUser> {
  const res = await fetch('/api/users', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...requestHeaders() },
    body: JSON.stringify(input),
  });
  await requireOk(res);
  return ((await res.json()) as { user: ManagedUser }).user;
}

export async function setUserGroups(userId: string, groupIds: string[]): Promise<ManagedUser> {
  const res = await fetch(`/api/users/${encodeURIComponent(userId)}/groups`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', ...requestHeaders() },
    body: JSON.stringify({ groupIds }),
  });
  await requireOk(res);
  return ((await res.json()) as { user: ManagedUser }).user;
}

export async function createGroup(name: string, permissions: string[]): Promise<PermissionGroup> {
  const res = await fetch('/api/groups', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...requestHeaders() },
    body: JSON.stringify({ name, permissions }),
  });
  await requireOk(res);
  return ((await res.json()) as { group: PermissionGroup }).group;
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
  fetch('/api/settings', { headers: requestHeaders() }).then((r) => {
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return r.json() as Promise<Settings>;
  });

/** Set/clear PINs. Empty string clears; undefined leaves unchanged. Admin
 *  bootstrap (first admin PIN) works without a token. */
export async function setPins(pins: { admin?: string; override?: string }): Promise<void> {
  const res = await fetch('/api/settings/pins', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...requestHeaders() },
    body: JSON.stringify(pins),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
}

export async function saveSchedules(
  schedules: Record<string, ScheduleWindow[]>,
): Promise<void> {
  const res = await fetch('/api/settings/schedules', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', ...requestHeaders() },
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
    headers: { 'Content-Type': 'application/json', ...requestHeaders() },
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
    headers: requestHeaders(),
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

// Institution topology (name, sites, Quick Access tiles) — server-owned per
// ADR 0009; the Admin → Campuses editor saves the whole tree transactionally.
export const getConfig = () => getJson<Church>('/api/config');

export async function saveConfig(church: Church): Promise<Church> {
  const res = await fetch('/api/config', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', ...requestHeaders() },
    body: JSON.stringify(church),
  });
  await requireOk(res);
  return res.json();
}

// Per-room integration connectivity (migrating out of rooms.config.js).
export interface PcServiceType {
  id: string;
  name: string;
}

export type AnalysisSource = 'smaart' | 'rta';

// The room's SPL source. `password` is write-only (send to change, omit to
// keep); reads report hasPassword instead. `mock` marks the dev fixture.
export interface AnalysisConfig {
  source: AnalysisSource;
  host: string;
  port?: number;
  target?: number;
  limit?: number;
  metric?: string;
  password?: string;
  hasPassword?: boolean;
  logControl?: boolean;
  mock?: boolean;
}

export interface ProPresenterConfig {
  host: string;
  port?: number;
  timer?: string;
}

export interface ModeConfig {
  id: string;
  label: string;
  color: string;
  match: string;
  press?: { page: number; row: number; column: number };
  isStandby?: boolean;
}

export interface CompanionConfig {
  mock: boolean;
  host?: string;
  port?: number;
  variable?: string;
  modes: ModeConfig[];
}

export interface RoomConnectivity {
  hasServerRoom: boolean;
  planningCenter: { serviceTypes: PcServiceType[] } | null;
  analysis: AnalysisConfig | null;
  proPresenter: ProPresenterConfig | null;
  companion: CompanionConfig | null;
}

export const getRoomConnectivity = (roomId: string) =>
  getJson<RoomConnectivity>(`/api/config/rooms/${roomId}/connectivity`);

export async function savePcServiceTypes(
  roomId: string,
  serviceTypes: PcServiceType[],
): Promise<{ serviceTypes: PcServiceType[] }> {
  const res = await fetch(`/api/config/rooms/${roomId}/connectivity/planning-center`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', ...requestHeaders() },
    body: JSON.stringify({ serviceTypes }),
  });
  await requireOk(res);
  return (await res.json()).planningCenter;
}

export async function saveAnalysis(
  roomId: string,
  analysis: AnalysisConfig | null,
): Promise<AnalysisConfig | null> {
  const res = await fetch(`/api/config/rooms/${roomId}/connectivity/analysis`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', ...requestHeaders() },
    body: JSON.stringify({ analysis }),
  });
  await requireOk(res);
  return (await res.json()).analysis;
}

export async function saveProPresenter(
  roomId: string,
  proPresenter: ProPresenterConfig | null,
): Promise<ProPresenterConfig | null> {
  const res = await fetch(`/api/config/rooms/${roomId}/connectivity/propresenter`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', ...requestHeaders() },
    body: JSON.stringify({ proPresenter }),
  });
  await requireOk(res);
  return (await res.json()).proPresenter;
}

export async function saveCompanion(
  roomId: string,
  companion: CompanionConfig,
): Promise<CompanionConfig> {
  const res = await fetch(`/api/config/rooms/${roomId}/connectivity/companion`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', ...requestHeaders() },
    body: JSON.stringify({ companion }),
  });
  await requireOk(res);
  return (await res.json()).companion;
}

export interface ServerLogTail {
  exists: boolean;
  file: string;
  size?: number;
  mtime?: number;
  truncated?: boolean;
  lines: string[];
}

export const getServerLog = (lines = 500) =>
  getJson<ServerLogTail>(`/api/system/logs?lines=${lines}`);

export interface AuditEntry {
  id: number;
  ts: number;
  action: string;
  result: string;
  resourceType: string | null;
  resourceId: string | null;
  roomId: string | null;
  planId: string | null;
  userName: string | null;
  username: string | null;
  stationName: string | null;
  details: Record<string, unknown> | null;
}

export const getAuditLog = (limit = 200) =>
  getJson<{ entries: AuditEntry[] }>(`/api/system/audit?limit=${limit}`);

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
  matched: boolean; // true = this is the plan's own playlist, not just PP's active one
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
    { method: 'PUT', headers: { 'Content-Type': 'application/json', ...requestHeaders() }, body: JSON.stringify(config) },
  );
  await requireOk(res);
  return ((await res.json()) as { showConfig: ShowConfig }).showConfig;
}

export async function clearShowConfig(id: string, planId: string): Promise<void> {
  const res = await fetch(
    `/api/rooms/${encodeURIComponent(id)}/event/${encodeURIComponent(planId)}/show-config`,
    { method: 'DELETE', headers: requestHeaders() },
  );
  await requireOk(res);
}

export const getPpPlaylist = (id: string, planId: string) =>
  getJson<{ playlist: PpPlaylist | null }>(
    `/api/rooms/${encodeURIComponent(id)}/event/${encodeURIComponent(planId)}/pp-playlist`,
  );

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
  ca?: { avg: number | null; max: number | null } | null; // when captured
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

// C-A ratio (C-weighted minus A-weighted level, dB): how much low-frequency
// energy rides under the mix. lo/hi = the target band configured in the
// analyzer app. Only present when the analysis source provides it (RTA).
export interface CaState {
  current: number;
  avg: number | null; // running mean — only while a show is live
  max: number | null; // show max — only while a show is live
  lo: number | null;
  hi: number | null;
}

export interface SplState {
  current: number; // latest sample, dB
  avg: number | null; // running Leq — only while a show is live
  peak: number | null; // show peak — only while a show is live
  target: number | null;
  limit: number | null;
  ca?: CaState | null;
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
    headers: { 'Content-Type': 'application/json', ...requestHeaders() },
    body: JSON.stringify(body),
  });
  await requireOk(res);
  return res.json() as Promise<T>;
}

export const startShow = (
  roomId: string,
  planId: string,
  timeId: string,
  opts?: { rehearsal?: boolean },
) =>
  postJson<ShowState>(`/api/rooms/${encodeURIComponent(roomId)}/show/start`, {
    planId,
    timeId,
    ...(opts?.rehearsal ? { rehearsal: true } : {}),
  });

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
  /** True for practice runs (timeId `rehearsal-*`) — excluded from real-service metrics. */
  rehearsal: boolean;
}

export const getHistory = () => getJson<{ shows: HistoryShow[] }>('/api/history');

/** Erase a recorded run (timing + loudness). Irreversible; requires history.delete. */
export async function deleteHistoryShow(instanceId: string): Promise<void> {
  const res = await fetch(`/api/history/${encodeURIComponent(instanceId)}`, {
    method: 'DELETE',
    headers: requestHeaders(),
  });
  await requireOk(res);
}

// ── Planning Center Calendar (room bookings) ─────────────────────────────────

export interface CalendarEvent {
  id: string;
  eventId: string | null;
  name: string;
  startsAt: string;
  endsAt: string | null;
  allDay: boolean;
  location: string | null;
  approval: string | null; // 'A' approved · 'P' pending · 'R' rejected
  roomIds: string[]; // matched against the live rooms map; [] = unmapped
}

export interface CalendarRange {
  live: boolean;
  /** Why we're not live: 'no-token' | 'not-granted' (Calendar not enabled for the PAT). */
  reason?: string;
  start: string;
  end: string;
  events: CalendarEvent[];
}

export const getCalendar = (start: string, end: string) =>
  getJson<CalendarRange>(
    `/api/calendar?start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}`,
  );

export const getAbout = () => getJson<{ name: string; version: string }>('/api/about');

// ── Assistance requests (the Lowe's aisle button) ────────────────────────────

export interface AssistanceState {
  active: boolean;
  requestedAt?: number;
  userName?: string | null;
}

export const getAssistance = () => getJson<AssistanceState>('/api/assistance');

export const requestAssistance = () => postJson<AssistanceState>('/api/assistance', {});

export async function dismissAssistance(): Promise<void> {
  const res = await fetch('/api/assistance', { method: 'DELETE', headers: requestHeaders() });
  await requireOk(res);
}

export const triggerUpdate = () =>
  fetch('/api/system/update', { method: 'POST', headers: requestHeaders() }).then((r) => {
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return r.json();
  });
