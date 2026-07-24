import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowDown, ArrowUp, CircleUser, MonitorCog, Trash2 } from 'lucide-react';
import { Checkbox } from '../components/Checkbox';
import { HelpTip } from '../components/HelpTip';
import { SelectField } from '../components/SelectField';
import { useChurch } from '../layout/church';
import {
  getAuthStatus,
  loginAdmin,
  setPins,
  getSettings,
  saveSchedules,
  getRooms,
  getVersion,
  triggerUpdate,
  getChecklistTemplates,
  saveChecklistTemplate,
  deleteChecklistTemplate,
  getUserDirectory,
  createUser,
  createGroup,
  setUserGroups,
  getStations,
  updateStation,
  revokeStation,
  getServerLog,
  getAuditLog,
  getConfig,
  saveConfig,
  getRoomConnectivity,
  savePcServiceTypes,
  saveAnalysis,
  saveProPresenter,
  saveCompanion,
  type PcServiceType,
  type AnalysisConfig,
  type ProPresenterConfig,
  type CompanionConfig,
  type ModeConfig,
  type RoomConnectivity,
  type ServerLogTail,
  type AuditEntry,
  type RoomMeta,
  type ScheduleWindow,
  type ChecklistTemplatesInfo,
  type TemplateItem,
  type UserDirectory,
  type ManagedStation,
} from '../api';
import type { Church, Site, Tile } from '../types';
type Phase = 'loading' | 'setup' | 'login' | 'admin';
const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

type AdminSection = 'general' | 'campuses' | 'room' | 'users' | 'stations' | 'checklists' | 'logs';

export function Settings({ section = 'general' }: { section?: AdminSection }) {
  const [phase, setPhase] = useState<Phase>('loading');

  const refreshStatus = useCallback(async () => {
    const s = await getAuthStatus();
    setPhase(s.admin ? 'admin' : s.setupNeeded ? 'setup' : 'login');
  }, []);

  useEffect(() => {
    refreshStatus();
    window.addEventListener('prodmesh:auth-changed', refreshStatus);
    return () => window.removeEventListener('prodmesh:auth-changed', refreshStatus);
  }, [refreshStatus]);

  const titles = {
    general: 'General',
    users: 'Users & access',
    stations: 'Stations',
    campuses: 'Campuses',
    room: 'Room configuration',
    checklists: 'Checklists',
    logs: 'Logs',
  } as const;

  return (
    <div className="settings">
      <div className="pagehead">
        <div>
          <p className="eyebrow">Administration</p>
          <h1 className="pagehead__title">{titles[section]}</h1>
        </div>
      </div>

      {phase === 'loading' && <p className="settings__muted">Loading…</p>}
      {phase === 'setup' && <SetupForm onDone={refreshStatus} />}
      {phase === 'login' && <LoginForm onDone={refreshStatus} />}
      {phase === 'admin' && <AdminPanels section={section} />}
    </div>
  );
}

// ── First-run: create the Admin PIN ───────────────────────────────────────────
function SetupForm({ onDone }: { onDone: () => void }) {
  const [pin, setPin] = useState('');
  const [confirm, setConfirm] = useState('');
  const [err, setErr] = useState<string | null>(null);

  const submit = async () => {
    if (pin.length < 4) return setErr('Use at least 4 digits.');
    if (pin !== confirm) return setErr('PINs do not match.');
    await setPins({ admin: pin });
    await loginAdmin(pin);
    onDone();
  };

  return (
    <section className="panel">
      <h2 className="panel__title">Create Admin PIN</h2>
      <p className="settings__muted">This protects Settings and system updates.</p>
      <input className="field" type="password" inputMode="numeric" placeholder="New admin PIN"
        value={pin} onChange={(e) => setPin(e.target.value)} />
      <input className="field" type="password" inputMode="numeric" placeholder="Confirm PIN"
        value={confirm} onChange={(e) => setConfirm(e.target.value)} />
      {err && <p className="settings__error">{err}</p>}
      <button className="btn btn--primary" onClick={submit}>Create PIN</button>
    </section>
  );
}

// ── Login with Admin PIN ───────────────────────────────────────────────────────
function LoginForm({ onDone }: { onDone: () => void }) {
  const [pin, setPin] = useState('');
  const [err, setErr] = useState<string | null>(null);

  const submit = async () => {
    setErr(null);
    if (await loginAdmin(pin)) onDone();
    else setErr('Incorrect PIN.');
  };

  return (
    <section className="panel">
      <h2 className="panel__title">Enter Admin PIN</h2>
      <input className="field" type="password" inputMode="numeric" placeholder="Admin PIN"
        value={pin} onChange={(e) => setPin(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && submit()} autoFocus />
      {err && <p className="settings__error">{err}</p>}
      <button className="btn btn--primary" onClick={submit}>Unlock</button>
    </section>
  );
}

// ── Admin panels ───────────────────────────────────────────────────────────────
function AdminPanels({ section }: { section: AdminSection }) {
  return (
    <>
      {section === 'general' && <><SecurityPanel /><SystemPanel /><SchedulesPanel /></>}
      {section === 'campuses' && <CampusesPanel />}
      {section === 'room' && <RoomConfigPanel />}
      {section === 'users' && <UserManagementPanel />}
      {section === 'stations' && <StationsPanel />}
      {section === 'checklists' && <ChecklistsPanel />}
      {section === 'logs' && <LogsPanel />}
    </>
  );
}

// ── Save/action feedback ─────────────────────────────────────────────────────
//  Success is green, errors are red — a panel must never announce a failure in
//  the success color, so panels carry the kind alongside the text.
type Feedback = { kind: 'ok' | 'err'; text: string } | null;
const ok = (text: string): Feedback => ({ kind: 'ok', text });
const fail = (err: unknown): Feedback => ({
  kind: 'err',
  text: err instanceof Error ? err.message : String(err),
});
function Msg({ msg, inline = false }: { msg: Feedback; inline?: boolean }) {
  if (!msg) return null;
  const cls = msg.kind === 'ok' ? 'settings__ok' : 'settings__error';
  return inline ? <span className={cls}>{msg.text}</span> : <p className={cls}>{msg.text}</p>;
}

// ── Users, permission groups, and ACLs ───────────────────────────────────────
export function UserManagementPanel() {
  const [directory, setDirectory] = useState<UserDirectory | null>(null);
  const [user, setUser] = useState({ displayName: '', username: '', pin: '', planningCenterPersonId: '' });
  const [userGroups, setUserGroupsDraft] = useState<string[]>([]);
  const [groupName, setGroupName] = useState('');
  const [groupPermissions, setGroupPermissions] = useState<string[]>([]);
  const [msg, setMsg] = useState<Feedback>(null);

  const refresh = () => getUserDirectory().then(setDirectory).catch((err) => setMsg(fail(err)));
  useEffect(() => { refresh(); }, []);

  if (!directory) return null;

  const addUser = async () => {
    setMsg(null);
    try {
      await createUser({
        ...user,
        planningCenterPersonId: user.planningCenterPersonId || null,
        groupIds: userGroups,
      });
      setUser({ displayName: '', username: '', pin: '', planningCenterPersonId: '' });
      setUserGroupsDraft([]);
      setMsg(ok('User created.'));
      refresh();
    } catch (err) { setMsg(fail(err)); }
  };

  const addGroup = async () => {
    setMsg(null);
    try {
      await createGroup(groupName, groupPermissions);
      setGroupName(''); setGroupPermissions([]); setMsg(ok('Permission group created.'));
      refresh();
    } catch (err) { setMsg(fail(err)); }
  };

  const toggle = (values: string[], value: string) =>
    values.includes(value) ? values.filter((x) => x !== value) : [...values, value];

  return (
    <section className="panel users">
      <div>
        <p className="section-label">Access control</p>
        <h2 className="panel__title">Users &amp; permissions
          <HelpTip text="Access is the union of a user's groups. Administrators always have every permission." />
        </h2>
      </div>

      <div className="users__grid">
        <div className="users__editor">
          <h3>Create user</h3>
          <input className="field" placeholder="Display name" value={user.displayName} onChange={(e) => setUser({ ...user, displayName: e.target.value })} />
          <input className="field" placeholder="Username" autoCapitalize="none" value={user.username} onChange={(e) => setUser({ ...user, username: e.target.value })} />
          <input className="field" placeholder="PIN" type="password" inputMode="numeric" value={user.pin} onChange={(e) => setUser({ ...user, pin: e.target.value })} />
          <input className="field" placeholder="Planning Center person ID (optional)" value={user.planningCenterPersonId} onChange={(e) => setUser({ ...user, planningCenterPersonId: e.target.value })} />
          <div className="users__checks">
            {directory.groups.map((group) => (
              <Checkbox key={group.id} label={group.name} checked={userGroups.includes(group.id)} onChange={() => setUserGroupsDraft(toggle(userGroups, group.id))} />
            ))}
          </div>
          <button className="btn btn--primary" disabled={!user.displayName || !user.username || user.pin.length < 4} onClick={addUser}>Create user</button>
        </div>

        <div className="users__editor">
          <h3>Create permission group</h3>
          <input className="field" placeholder="Group name" value={groupName} onChange={(e) => setGroupName(e.target.value)} />
          <div className="users__checks users__checks--permissions">
            {directory.permissions.map((permission) => (
              <Checkbox key={permission.id} label={<><strong>{permission.label}</strong><small>{permission.id}</small></>} checked={groupPermissions.includes(permission.id)} onChange={() => setGroupPermissions(toggle(groupPermissions, permission.id))} />
            ))}
          </div>
          <button className="btn btn--primary" disabled={groupName.trim().length < 2} onClick={addGroup}>Create group</button>
        </div>
      </div>

      <div className="users__list">
        <h3>Current users</h3>
        {directory.users.length === 0 && <p className="settings__muted">No named users yet. The existing Admin PIN remains available for bootstrap access.</p>}
        {directory.users.map((entry) => (
          <div className="users__row" key={entry.id}>
            <div className="users__identity">
              <span className="users__avatar" role="img" aria-label={`${entry.displayName} avatar`}>
                {entry.avatarUrl
                  ? <img src={entry.avatarUrl} alt="" />
                  : <CircleUser size={28} />}
              </span>
              <span><strong>{entry.displayName}</strong><small>@{entry.username}{entry.planningCenterPersonId ? ` · PCO ${entry.planningCenterPersonId}` : ''}</small></span>
            </div>
            <div className="users__groups">
              {directory.groups.map((group) => {
                const checked = entry.groups.some((g) => g.id === group.id);
                return <Checkbox key={group.id} label={group.name} checked={checked} onChange={async () => {
                  const next = toggle(entry.groups.map((g) => g.id), group.id);
                  await setUserGroups(entry.id, next);
                  refresh();
                }} />;
              })}
            </div>
          </div>
        ))}
      </div>
      <Msg msg={msg} />
    </section>
  );
}

// ── Registered browser stations ─────────────────────────────────────────────
function relativeTime(timestamp: number) {
  const seconds = Math.max(0, Math.round((Date.now() - timestamp) / 1000));
  if (seconds < 60) return 'Just now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours}h ago`;
  return new Date(timestamp).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
}

export function StationsPanel() {
  const [stations, setStations] = useState<ManagedStation[]>([]);
  const [rooms, setRooms] = useState<RoomMeta[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<Feedback>(null);
  const [revokeTarget, setRevokeTarget] = useState<ManagedStation | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [stationResult, roomResult] = await Promise.all([getStations(), getRooms()]);
      setStations(stationResult.stations);
      setRooms(roomResult);
    } catch (err) {
      setMessage(fail(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const remove = async () => {
    if (!revokeTarget) return;
    setMessage(null);
    try {
      const result = await revokeStation(revokeTarget.id);
      setRevokeTarget(null);
      if (!result.current) {
        setMessage(ok('Station revoked. Its browser will be asked to register again.'));
        refresh();
      }
    } catch (err) {
      setMessage(fail(err));
    }
  };

  if (loading) return <p className="settings__muted">Loading stations…</p>;

  return (
    <section className="panel stations">
      <div>
        <p className="section-label">Browser identity</p>
        <h2 className="panel__title">Registered stations
          <HelpTip text="A station identifies which browser an action came from. Revoking one signs out its sessions and returns that browser to first-run registration." />
        </h2>
      </div>

      <div className="stations__list">
        {stations.length === 0 && <p className="settings__muted">No registered stations.</p>}
        {stations.map((station) => (
          <StationEditor
            key={station.id}
            station={station}
            rooms={rooms}
            onSaved={(updated) => {
              setStations((all) => all.map((entry) => entry.id === updated.id ? { ...updated, current: station.current } : entry));
              setMessage(ok('Station updated.'));
            }}
            onRevoke={() => setRevokeTarget(station)}
          />
        ))}
      </div>
      <Msg msg={message} />

      {revokeTarget && (
        <div className="confirm" role="dialog" aria-modal="true" aria-labelledby="revoke-station-title">
          <div className="confirm__card">
            <p className="eyebrow">Revoke station</p>
            <p className="confirm__text" id="revoke-station-title">
              Unregister <strong>{revokeTarget.name}</strong>? Its browser will return to station registration.
            </p>
            <div className="confirm__buttons">
              <button className="confirm__cancel" onClick={() => setRevokeTarget(null)}>Cancel</button>
              <button className="confirm__ok" onClick={remove}>Revoke station</button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

function StationEditor({
  station,
  rooms,
  onSaved,
  onRevoke,
}: {
  station: ManagedStation;
  rooms: RoomMeta[];
  onSaved: (station: ManagedStation) => void;
  onRevoke: () => void;
}) {
  const church = useChurch();
  const [name, setName] = useState(station.name);
  const [campusId, setCampusId] = useState(station.campusId ?? '');
  const [roomId, setRoomId] = useState(station.roomId ?? '');
  const [busy, setBusy] = useState(false);

  const campusRooms = rooms.filter((room) => !campusId || room.site === campusId);
  const dirty = name !== station.name || campusId !== (station.campusId ?? '') || roomId !== (station.roomId ?? '');

  const save = async () => {
    setBusy(true);
    try {
      onSaved(await updateStation(station.id, {
        name,
        campusId: campusId || null,
        roomId: roomId || null,
      }));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="stations__row">
      <div className="stations__identity">
        <span className="stations__icon"><MonitorCog size={19} /></span>
        <span>
          <strong>{station.name}</strong>
          <small>{station.current ? 'CURRENT STATION · ' : ''}Last seen {relativeTime(station.lastSeen)}</small>
        </span>
      </div>
      <div className="stations__fields">
        <label><span>Name</span><input className="field" value={name} onChange={(event) => setName(event.target.value)} /></label>
        <label>
          <span>Campus</span>
          <SelectField value={campusId} onChange={(event) => {
            setCampusId(event.target.value);
            if (roomId && rooms.find((room) => room.id === roomId)?.site !== event.target.value) setRoomId('');
          }}>
            <option value="">Unassigned</option>
            {church.sites.filter((site) => site.status === 'active').map((site) => <option key={site.id} value={site.id}>{site.name}</option>)}
          </SelectField>
        </label>
        <label>
          <span>Room</span>
          <SelectField value={roomId} onChange={(event) => {
            const nextRoom = rooms.find((room) => room.id === event.target.value);
            setRoomId(event.target.value);
            if (nextRoom) setCampusId(nextRoom.site ?? '');
          }}>
            <option value="">No room</option>
            {campusRooms.map((room) => <option key={room.id} value={room.id}>{room.name}</option>)}
          </SelectField>
        </label>
      </div>
      <div className="stations__actions">
        <button className="btn btn--primary btn--sm" disabled={!dirty || busy || name.trim().length < 2} onClick={save}>Save</button>
        <button className="btn btn--ghost btn--sm stations__revoke" onClick={onRevoke}><Trash2 size={13} /> Revoke</button>
      </div>
    </div>
  );
}

// ── Checklist templates (per event type) ──────────────────────────────────────
const DEFAULT_KEY = '*';

function ChecklistsPanel() {
  const [info, setInfo] = useState<ChecklistTemplatesInfo | null>(null);
  const [selected, setSelected] = useState(DEFAULT_KEY);
  const [draft, setDraft] = useState<TemplateItem[] | null>(null);
  const [msg, setMsg] = useState<Feedback>(null);

  useEffect(() => {
    getChecklistTemplates()
      .then((i) => {
        setInfo(i);
        setDraft(i.templates[DEFAULT_KEY] ?? null);
      })
      .catch(() => {});
  }, []);

  if (!info) return null;

  const typeName = (id: string) =>
    id === DEFAULT_KEY
      ? 'Default (any other event)'
      : info.serviceTypes.find((s) => s.id === id)?.name ?? `Type ${id}`;

  // Event types worth listing: the default, everything mapped on a room, plus
  // any template saved for a type we no longer map (so it stays editable).
  const typeIds = [
    DEFAULT_KEY,
    ...info.serviceTypes.map((s) => s.id),
    ...Object.keys(info.templates).filter(
      (id) => id !== DEFAULT_KEY && !info.serviceTypes.some((s) => s.id === id),
    ),
  ];

  const pick = (id: string) => {
    setSelected(id);
    setDraft(info.templates[id] ?? null);
    setMsg(null);
  };

  const edit = (i: number, patch: Partial<TemplateItem>) =>
    setDraft((d) => d!.map((it, j) => (j === i ? { ...it, ...patch } : it)));
  const move = (i: number, delta: number) =>
    setDraft((d) => {
      const next = [...d!];
      const j = i + delta;
      if (j < 0 || j >= next.length) return d!;
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });

  const save = async () => {
    setMsg(null);
    try {
      const templates = await saveChecklistTemplate(selected, draft ?? []);
      setInfo((x) => x && { ...x, templates });
      setDraft(templates[selected] ?? []);
      setMsg(ok('Template saved.'));
    } catch (err) {
      setMsg(fail(err));
    }
  };

  const removeTemplate = async () => {
    setMsg(null);
    try {
      const templates = await deleteChecklistTemplate(selected);
      setInfo((x) => x && { ...x, templates });
      setDraft(templates[selected] ?? null);
      setMsg(ok(selected === DEFAULT_KEY ? 'Default template removed.' : 'Now using the Default template.'));
    } catch (err) {
      setMsg(fail(err));
    }
  };

  const hasOwn = Boolean(info.templates[selected]);

  return (
    <section className="panel">
      <h2 className="panel__title">Checklists</h2>

      <div className="tpl-types">
        {typeIds.map((id) => (
          <button
            key={id}
            className={`typebtn${selected === id ? ' typebtn--on' : ''}`}
            onClick={() => pick(id)}
          >
            {typeName(id)}
            {id !== DEFAULT_KEY && !info.templates[id] && (
              <span className="typebtn__uses">default</span>
            )}
          </button>
        ))}
      </div>

      {draft === null ? (
        <div className="tpl-fallback">
          <p className="settings__muted">
            <strong>{typeName(selected)}</strong> uses the Default template
            {(info.templates[DEFAULT_KEY] ?? []).length
              ? ` (${info.templates[DEFAULT_KEY]!.length} items)`
              : ' (currently empty)'}
            .
          </p>
          <button
            className="btn btn--sm"
            onClick={() => setDraft(structuredClone(info.templates[DEFAULT_KEY] ?? []))}
          >
            Customize for this event type
          </button>
        </div>
      ) : (
        <>
          {draft.length === 0 && <p className="settings__muted">No items yet.</p>}
          {draft.map((it, i) => (
            <div key={it.id ?? `new-${i}`} className="tpl-item">
              <div className="tpl-item__order">
                <button className="orderbtn" disabled={i === 0} onClick={() => move(i, -1)} aria-label="Move up">
                  <ArrowUp size={13} />
                </button>
                <button className="orderbtn" disabled={i === draft.length - 1} onClick={() => move(i, 1)} aria-label="Move down">
                  <ArrowDown size={13} />
                </button>
              </div>
              <input
                className="field tpl-item__label"
                value={it.label}
                placeholder="What needs to happen?"
                onChange={(e) => edit(i, { label: e.target.value })}
              />
              <SelectField
                className="tpl-item__action"
                value={it.action?.mode ?? ''}
                onChange={(e) =>
                  edit(i, { action: e.target.value ? { type: 'mode', mode: e.target.value } : null })
                }
              >
                <option value="">Manual check</option>
                {info.modes.map((m) => (
                  <option key={m.id} value={m.id}>
                    ⚡ Set room to {m.label}
                  </option>
                ))}
              </SelectField>
              <button
                className="btn btn--ghost btn--sm"
                onClick={() => setDraft((d) => d!.filter((_, j) => j !== i))}
              >
                Remove
              </button>
            </div>
          ))}
          <div className="settings__toolbar">
            <button className="btn btn--sm" onClick={() => setDraft((d) => [...(d ?? []), { label: '' }])}>
              + Item
            </button>
            <button className="btn btn--primary" onClick={save}>
              Save template
            </button>
            {hasOwn && selected !== DEFAULT_KEY && (
              <button className="btn btn--ghost" onClick={removeTemplate}>
                Remove (use Default)
              </button>
            )}
            <Msg msg={msg} inline />
          </div>
        </>
      )}
    </section>
  );
}

function SecurityPanel() {
  const [overrideSet, setOverrideSet] = useState(false);
  const [adminPin, setAdminPin] = useState('');
  const [overridePin, setOverridePin] = useState('');
  const [msg, setMsg] = useState<Feedback>(null);

  useEffect(() => {
    getSettings().then((s) => setOverrideSet(s.pins.overrideSet)).catch(() => {});
  }, []);

  const saveAdmin = async () => {
    if (adminPin.length < 4) return setMsg(fail('Admin PIN must be ≥ 4 digits.'));
    try {
      await setPins({ admin: adminPin });
      setAdminPin(''); setMsg(ok('Admin PIN updated.'));
    } catch (err) { setMsg(fail(err)); }
  };
  const saveOverride = async () => {
    if (overridePin.length < 4) return setMsg(fail('Override PIN must be ≥ 4 digits.'));
    try {
      await setPins({ override: overridePin });
      setOverridePin(''); setOverrideSet(true); setMsg(ok('Override PIN updated.'));
    } catch (err) { setMsg(fail(err)); }
  };
  const clearOverride = async () => {
    try {
      await setPins({ override: '' });
      setOverrideSet(false); setMsg(ok('Override PIN cleared — mode locks are now inactive.'));
    } catch (err) { setMsg(fail(err)); }
  };

  return (
    <section className="panel">
      <h2 className="panel__title">Security</h2>
      <div className="panel__row">
        <div>
          <div className="panel__label">Admin PIN</div>
          <div className="settings__muted">Protects Settings + system updates.</div>
        </div>
        <div className="panel__controls">
          <input className="field field--sm" type="password" inputMode="numeric" placeholder="New admin PIN"
            value={adminPin} onChange={(e) => setAdminPin(e.target.value)} />
          <button className="btn" onClick={saveAdmin}>Update</button>
        </div>
      </div>
      <div className="panel__row">
        <div>
          <div className="panel__label">Override PIN {overrideSet
            ? <span className="pill pill--on">set</span>
            : <span className="pill pill--off">not set</span>}</div>
          <div className="settings__muted">Unlocks locked mode changes during protected windows.</div>
        </div>
        <div className="panel__controls">
          <input className="field field--sm" type="password" inputMode="numeric" placeholder="New override PIN"
            value={overridePin} onChange={(e) => setOverridePin(e.target.value)} />
          <button className="btn" onClick={saveOverride}>Update</button>
          {overrideSet && <button className="btn btn--ghost" onClick={clearOverride}>Clear</button>}
        </div>
      </div>
      <Msg msg={msg} />
    </section>
  );
}

function SystemPanel() {
  const [version, setVersion] = useState<{ commit: string; subject: string } | null>(null);
  const [status, setStatus] = useState<Feedback>(null);

  const load = useCallback(() => getVersion().then(setVersion).catch(() => {}), []);
  useEffect(() => { load(); }, [load]);

  const update = async () => {
    setStatus(ok('Starting update…'));
    const before = version?.commit;
    try {
      await triggerUpdate();
    } catch {
      return setStatus(fail('Could not start update.'));
    }
    setStatus(ok('Updating & restarting… (this page may briefly disconnect)'));
    let tries = 0;
    const iv = setInterval(async () => {
      tries += 1;
      try {
        const v = await getVersion();
        if (v.commit !== before && v.commit !== 'unknown') {
          setVersion(v); setStatus(ok(`Updated to ${v.commit}.`)); clearInterval(iv);
        }
      } catch { /* server restarting */ }
      if (tries > 40) { setStatus(fail('Update taking longer than expected — check the box.')); clearInterval(iv); }
    }, 3000);
  };

  return (
    <section className="panel">
      <h2 className="panel__title">System</h2>
      <div className="panel__row">
        <div>
          <div className="panel__label">Version</div>
          <div className="settings__muted">
            {version ? <><code>{version.commit}</code> — {version.subject}</> : '…'}
          </div>
        </div>
        <div className="panel__controls">
          <button className="btn btn--primary" onClick={update}>Update now</button>
        </div>
      </div>
      <Msg msg={status} />
    </section>
  );
}

function SchedulesPanel() {
  const [rooms, setRooms] = useState<RoomMeta[]>([]);
  const [schedules, setSchedules] = useState<Record<string, ScheduleWindow[]>>({});
  const [msg, setMsg] = useState<Feedback>(null);

  useEffect(() => {
    Promise.all([getRooms(), getSettings()])
      .then(([r, s]) => { setRooms(r); setSchedules(s.schedules ?? {}); })
      .catch(() => {});
  }, []);

  const windowsFor = (roomId: string) => schedules[roomId] ?? [];
  const update = (roomId: string, next: ScheduleWindow[]) =>
    setSchedules((s) => ({ ...s, [roomId]: next }));

  const addWindow = (roomId: string) =>
    update(roomId, [...windowsFor(roomId), {
      // Not crypto.randomUUID() — that requires a secure context (https/localhost)
      // and would throw when a room Mac opens the app over http://<ip>.
      id: `w-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      label: 'New window', days: [0], start: '08:00', end: '12:00', lock: [],
    }]);

  const editWindow = (roomId: string, i: number, patch: Partial<ScheduleWindow>) =>
    update(roomId, windowsFor(roomId).map((w, j) => (j === i ? { ...w, ...patch } : w)));

  const removeWindow = (roomId: string, i: number) =>
    update(roomId, windowsFor(roomId).filter((_, j) => j !== i));

  const save = async () => {
    setMsg(null);
    try {
      await saveSchedules(schedules);
      setMsg(ok('Schedules saved.'));
    } catch (err) { setMsg(fail(err)); }
  };

  return (
    <section className="panel">
      <h2 className="panel__title">Schedules &amp; Locks</h2>

      {rooms.map((room) => (
        <div key={room.id} className="sched-room">
          <div className="sched-room__head">
            <h3 className="sched-room__name">{room.name}</h3>
            <button className="btn btn--sm" onClick={() => addWindow(room.id)}>+ Window</button>
          </div>
          {windowsFor(room.id).length === 0 && <p className="settings__muted">No windows.</p>}
          {windowsFor(room.id).map((w, i) => (
            <div key={w.id} className="sched-win">
              <input className="field field--sm" value={w.label}
                onChange={(e) => editWindow(room.id, i, { label: e.target.value })} />
              <div className="sched-days">
                {DAY_LABELS.map((d, di) => (
                  <button key={di} type="button"
                    className={`daybtn${w.days.includes(di) ? ' daybtn--on' : ''}`}
                    onClick={() => editWindow(room.id, i, {
                      days: w.days.includes(di) ? w.days.filter((x) => x !== di) : [...w.days, di].sort(),
                    })}>{d}</button>
                ))}
              </div>
              <input className="field field--time" type="time" value={w.start}
                onChange={(e) => editWindow(room.id, i, { start: e.target.value })} />
              <span className="sched-dash">–</span>
              <input className="field field--time" type="time" value={w.end}
                onChange={(e) => editWindow(room.id, i, { end: e.target.value })} />
              <div className="sched-locks">
                <span className="settings__muted">Lock:</span>
                {room.modes.map((m) => (
                  <Checkbox key={m.id} className="lockchk" label={m.label}
                    checked={w.lock.includes(m.id)}
                      onChange={() => editWindow(room.id, i, {
                        lock: w.lock.includes(m.id) ? w.lock.filter((x) => x !== m.id) : [...w.lock, m.id],
                      })} />
                ))}
              </div>
              <button className="btn btn--ghost btn--sm" onClick={() => removeWindow(room.id, i)}>Remove</button>
            </div>
          ))}
        </div>
      ))}
      <div className="settings__toolbar">
        <button className="btn btn--primary" onClick={save}>Save schedules</button>
        <Msg msg={msg} inline />
      </div>
    </section>
  );
}

// ── Logs: server process log + audit trail ─────────────────────────────────────
export function LogsPanel() {
  const [tab, setTab] = useState<'server' | 'audit'>('server');
  return (
    <>
      <div className="logtabs">
        <button className={`typebtn${tab === 'server' ? ' typebtn--on' : ''}`} onClick={() => setTab('server')}>
          Server log
        </button>
        <button className={`typebtn${tab === 'audit' ? ' typebtn--on' : ''}`} onClick={() => setTab('audit')}>
          Audit trail
        </button>
      </div>
      {tab === 'server' ? <ServerLogViewer /> : <AuditTrail />}
    </>
  );
}

function ServerLogViewer() {
  const [log, setLog] = useState<ServerLogTail | null>(null);
  const [lines, setLines] = useState(500);
  const [follow, setFollow] = useState(true);
  const [filter, setFilter] = useState('');
  const [error, setError] = useState('');
  const preRef = useRef<HTMLPreElement>(null);

  const refresh = useCallback(async () => {
    try {
      setLog(await getServerLog(lines));
      setError('');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [lines]);

  useEffect(() => {
    refresh();
    if (!follow) return;
    const t = setInterval(refresh, 5000);
    return () => clearInterval(t);
  }, [refresh, follow]);

  const shown = (log?.lines ?? []).filter(
    (line) => !filter || line.toLowerCase().includes(filter.toLowerCase()),
  );

  // Keep the newest lines in view as the log grows (unless filtering around).
  useEffect(() => {
    const el = preRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [shown.length, log?.size]);

  return (
    <section className="panel logview">
      <div>
        <p className="section-label">Diagnostics</p>
        <h2 className="panel__title">Server log</h2>
      </div>

      <div className="logview__controls">
        <input
          className="field logview__filter"
          placeholder="Filter lines… (e.g. smaart, autostart)"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
        <SelectField value={lines} onChange={(e) => setLines(Number(e.target.value))} aria-label="Lines to show">
          <option value={200}>Last 200</option>
          <option value={500}>Last 500</option>
          <option value={1000}>Last 1,000</option>
          <option value={2000}>Last 2,000</option>
        </SelectField>
        <Checkbox label="Auto-refresh" checked={follow} onChange={(e) => setFollow(e.target.checked)} />
      </div>

      {log && !log.exists && (
        <p className="settings__muted">
          No log file yet at <code>{log.file}</code> — it appears when prodmesh runs as the
          installed service (deploy/install-service.sh).
        </p>
      )}
      {log?.exists && (
        <>
          <pre ref={preRef} className="logview__pre" data-testid="server-log">
            {shown.join('\n') || (filter ? 'No lines match the filter.' : 'Log is empty.')}
          </pre>
          <p className="settings__muted logview__meta">
            {shown.length === log.lines.length
              ? `${log.lines.length} lines`
              : `${shown.length} of ${log.lines.length} lines`}
            {log.size != null && <> · {Math.max(1, Math.round(log.size / 1024))} KB</>}
            {log.mtime != null && <> · updated {relativeTime(log.mtime)}</>}
          </p>
        </>
      )}
      {error && <p className="settings__error">{error}</p>}
    </section>
  );
}

function AuditTrail() {
  const [entries, setEntries] = useState<AuditEntry[] | null>(null);
  const [error, setError] = useState('');

  const refresh = useCallback(async () => {
    try {
      setEntries((await getAuditLog(200)).entries);
      setError('');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  return (
    <section className="panel audittrail">
      <div className="audittrail__head">
        <div>
          <p className="section-label">Accountability</p>
          <h2 className="panel__title">Audit trail
            <HelpTip text="Every consequential action, who did it, and from which station. The most recent 200 entries." />
          </h2>
        </div>
        <button className="btn" onClick={refresh}>Refresh</button>
      </div>


      {error && <p className="settings__error">{error}</p>}
      {entries && entries.length === 0 && <p className="settings__muted">Nothing recorded yet.</p>}
      {entries && entries.length > 0 && (
        <div className="audittrail__scroll">
          <table className="audittrail__table">
            <thead>
              <tr><th>When</th><th>User</th><th>Station</th><th>Action</th><th>Result</th></tr>
            </thead>
            <tbody>
              {entries.map((entry) => (
                <tr key={entry.id}>
                  <td className="audittrail__when" title={new Date(entry.ts).toLocaleString()}>
                    {relativeTime(entry.ts)}
                  </td>
                  <td>{entry.userName ?? <span className="settings__muted">anonymous</span>}</td>
                  <td>{entry.stationName ?? <span className="settings__muted">—</span>}</td>
                  <td className="audittrail__action">
                    {entry.action}
                    {(entry.roomId || entry.resourceId) && (
                      <span className="settings__muted"> · {entry.roomId ?? `${entry.resourceType}:${entry.resourceId}`}</span>
                    )}
                  </td>
                  <td>
                    <span className={`audittrail__result audittrail__result--${entry.result === 'allowed' ? 'ok' : 'denied'}`}>
                      {entry.result}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

// ── Campuses: institution name, sites, rooms, Quick Access tiles ──────────────
// Edits a local draft of the whole tree; Save replaces it transactionally on
// the server (PUT /api/config). Nothing is destructive until Save.

const TILE_TYPE_LABELS: Record<Tile['type'], string> = {
  route: 'Room Status link',
  companion: 'Companion',
  screenshare: 'Screen Sharing (Mac)',
  link: 'Web link',
  placeholder: 'Placeholder',
};

const TILE_ICONS: Array<[string, string]> = [
  ['🎛️', 'Console'],
  ['🎚️', 'Faders'],
  ['💡', 'Lighting'],
  ['🎬', 'Video'],
  ['🎥', 'Camera'],
  ['📷', 'PTZ camera'],
  ['📖', 'ProPresenter'],
  ['⏺️', 'Recorder'],
  ['⏱️', 'Timecode'],
  ['🎧', 'Comms'],
  ['🔊', 'Audio'],
  ['🖥️', 'Computer'],
  ['🌐', 'Network device'],
];

function slugId(label: string, taken: Set<string>) {
  const base = label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'item';
  let id = base;
  for (let n = 2; taken.has(id); n += 1) id = `${base}-${n}`;
  taken.add(id);
  return id;
}

function allIds(church: Church) {
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

// Shared draft plumbing: both the overview and the room page edit a local
// copy of the whole tree and save it transactionally (PUT /api/config).
function useChurchDraft() {
  const [draft, setDraft] = useState<Church | null>(null);
  const [baseline, setBaseline] = useState('');
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');

  useEffect(() => {
    getConfig().then((c) => {
      setDraft(c);
      setBaseline(JSON.stringify(c));
    }).catch((e) => setErr(e instanceof Error ? e.message : String(e)));
  }, []);

  const update = (fn: (next: Church) => void) => {
    setMsg('');
    setDraft((cur) => {
      const next = structuredClone(cur!);
      fn(next);
      return next;
    });
  };

  const save = async () => {
    setErr('');
    try {
      const stored = await saveConfig(draft!);
      setDraft(stored);
      setBaseline(JSON.stringify(stored));
      setMsg('Saved.');
      window.dispatchEvent(new Event('prodmesh:config-changed'));
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  };

  return {
    draft,
    baseline,
    dirty: draft != null && JSON.stringify(draft) !== baseline,
    msg,
    err,
    update,
    save,
  };
}

const moveIn = <T,>(arr: T[], from: number, dir: -1 | 1) => {
  const to = from + dir;
  if (to < 0 || to >= arr.length) return;
  [arr[from], arr[to]] = [arr[to], arr[from]];
};

// The overview: institution name, sites, and each site's rooms as rows that
// link into their own configuration page.
export function CampusesPanel() {
  const { draft, baseline, dirty, msg, err, update, save } = useChurchDraft();
  const [selectedSite, setSelectedSite] = useState('');

  if (!draft) return err ? <p className="settings__error">{err}</p> : <p className="settings__muted">Loading…</p>;

  const site = draft.sites.find((s) => s.id === selectedSite) ?? draft.sites[0];
  // Rooms that exist on the server (vs. added to this unsaved draft) — a new
  // room's page can only load after the draft is saved.
  const savedRoomIds = new Set(
    (JSON.parse(baseline || '{"sites":[]}') as Church).sites.flatMap((s) => s.auditoriums).map((r) => r.id),
  );

  return (
    <section className="panel campuses">
      <div className="campuses__head">
        <div>
          <p className="section-label">Topology</p>
          <h2 className="panel__title">Campuses
            <HelpTip text="Changes apply everywhere when you save — nothing is final until then." />
          </h2>
        </div>
        <button className="btn btn--primary" onClick={save} disabled={!dirty}>
          {dirty ? 'Save changes' : 'Saved'}
        </button>
      </div>


      <label className="lfield campuses__institution">
        <span>Institution name</span>
        <input className="field" value={draft.name}
          onChange={(e) => update((n) => { n.name = e.target.value; })} />
      </label>

      <div className="campuses__sitebar">
        {draft.sites.map((s) => (
          <button key={s.id}
            className={`typebtn${s.id === site?.id ? ' typebtn--on' : ''}`}
            onClick={() => setSelectedSite(s.id)}>
            {s.name || s.id}
            {s.status !== 'active' && <span className="typebtn__uses">off</span>}
          </button>
        ))}
        <button className="btn" onClick={() => update((n) => {
          const id = slugId('new-site', allIds(n));
          n.sites.push({ id, name: 'New Site', status: 'disabled', auditoriums: [] });
          setSelectedSite(id);
        })}>+ Add site</button>
      </div>

      {site && (
        <div className="campuses__site" key={site.id}>
          <div className="campuses__siterow">
            <label className="lfield"><span>Site name</span>
              <input className="field" value={site.name}
                onChange={(e) => update((n) => { n.sites.find((s) => s.id === site.id)!.name = e.target.value; })} />
            </label>
            <label className="lfield"><span>Status</span>
              <SelectField value={site.status}
                onChange={(e) => update((n) => { n.sites.find((s) => s.id === site.id)!.status = e.target.value as Site['status']; })}>
                <option value="active">Active</option>
                <option value="disabled">Disabled</option>
              </SelectField>
            </label>
            <div className="campuses__rowactions">
              <button className="iconbtn" title="Move site left" aria-label="Move site left"
                onClick={() => update((n) => moveIn(n.sites, n.sites.findIndex((s) => s.id === site.id), -1))}><ArrowUp size={14} /></button>
              <button className="iconbtn" title="Move site right" aria-label="Move site right"
                onClick={() => update((n) => moveIn(n.sites, n.sites.findIndex((s) => s.id === site.id), 1))}><ArrowDown size={14} /></button>
              <button className="iconbtn iconbtn--danger" title="Remove site" aria-label="Remove site"
                onClick={() => update((n) => {
                  n.sites = n.sites.filter((s) => s.id !== site.id);
                  setSelectedSite(n.sites[0]?.id ?? '');
                })}><Trash2 size={14} /></button>
            </div>
          </div>

          <div className="campuses__roomlist">
            {site.auditoriums.length === 0 && <p className="settings__muted">No rooms yet.</p>}
            {site.auditoriums.map((room, roomIdx) => (
              <div className="campuses__roomrow" key={room.id}>
                <div className="campuses__roominfo">
                  <strong>{room.name}</strong>
                  <small>{room.tiles.length} tile{room.tiles.length === 1 ? '' : 's'}</small>
                </div>
                {savedRoomIds.has(room.id)
                  ? <Link className="btn" to={`/admin/campuses/${room.id}`}>Configure</Link>
                  : <span className="settings__muted campuses__unsaved">save to configure</span>}
                <div className="campuses__rowactions">
                  <button className="iconbtn" title="Move room up" aria-label="Move room up"
                    onClick={() => update((n) => moveIn(n.sites.find((s) => s.id === site.id)!.auditoriums, roomIdx, -1))}><ArrowUp size={14} /></button>
                  <button className="iconbtn" title="Move room down" aria-label="Move room down"
                    onClick={() => update((n) => moveIn(n.sites.find((s) => s.id === site.id)!.auditoriums, roomIdx, 1))}><ArrowDown size={14} /></button>
                  <button className="iconbtn iconbtn--danger" title="Remove room" aria-label="Remove room"
                    onClick={() => update((n) => {
                      const s = n.sites.find((x) => x.id === site.id)!;
                      s.auditoriums = s.auditoriums.filter((r) => r.id !== room.id);
                    })}><Trash2 size={14} /></button>
                </div>
              </div>
            ))}
          </div>

          <button className="btn" onClick={() => update((n) => {
            const id = slugId(`${site.id}-room`, allIds(n));
            n.sites.find((s) => s.id === site.id)!.auditoriums.push({ id, name: 'New Room', tiles: [] });
          })}>+ Add room</button>
        </div>
      )}

      {err && <p className="settings__error">{err}</p>}
      {msg && <p className="settings__ok">{msg}</p>}
    </section>
  );
}

// One room's configuration page (/admin/campuses/:roomId): identity, Quick
// Access tiles, and (soon) integration connectivity as rooms.config.js
// migrates into the database.
export function RoomConfigPanel() {
  const { roomId } = useParams();
  const { draft, dirty, msg, err, update, save } = useChurchDraft();

  if (!draft) return err ? <p className="settings__error">{err}</p> : <p className="settings__muted">Loading…</p>;

  const owner = draft.sites.find((s) => s.auditoriums.some((r) => r.id === roomId));
  const room = owner?.auditoriums.find((r) => r.id === roomId);

  if (!owner || !room) {
    return (
      <section className="panel">
        <p className="settings__error">No room "{roomId}" exists.</p>
        <Link className="btn" to="/admin/campuses">← All campuses</Link>
      </section>
    );
  }

  // Locate this room inside a draft copy, wherever it currently lives.
  const findRoom = (n: Church) => {
    const s = n.sites.find((x) => x.auditoriums.some((r) => r.id === roomId))!;
    return { site: s, room: s.auditoriums.find((r) => r.id === roomId)! };
  };

  return (
    <>
      <section className="panel campuses">
        <div className="campuses__head">
          <div>
            <p className="section-label"><Link className="campuses__back" to="/admin/campuses">← All campuses</Link></p>
            <h2 className="panel__title">{room.name}</h2>
          </div>
          <button className="btn btn--primary" onClick={save} disabled={!dirty}>
            {dirty ? 'Save changes' : 'Saved'}
          </button>
        </div>

        <div className="campuses__siterow">
          <label className="lfield"><span>Room name</span>
            <input className="field" value={room.name}
              onChange={(e) => update((n) => { findRoom(n).room.name = e.target.value; })} />
          </label>
          <label className="lfield"><span>Site</span>
            <SelectField value={owner.id}
              onChange={(e) => update((n) => {
                const from = findRoom(n);
                const dest = n.sites.find((x) => x.id === e.target.value)!;
                from.site.auditoriums = from.site.auditoriums.filter((r) => r.id !== roomId);
                dest.auditoriums.push(from.room);
              })}>
              {draft.sites.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </SelectField>
          </label>
          <label className="lfield"><span>Room ID</span>
            <input className="field" value={room.id} disabled
              title="Stable identifier — links this room to its server integrations" />
          </label>
        </div>

        {err && <p className="settings__error">{err}</p>}
        {msg && <p className="settings__ok">{msg}</p>}
      </section>

      <section className="panel campuses">
        <div>
          <p className="section-label">Launcher</p>
          <h2 className="panel__title">Quick Access tiles
            <HelpTip text="The shortcuts this room shows on Home." />
          </h2>
        </div>

        <div className="campuses__room">
          {room.tiles.map((tile, tileIdx) => (
            <TileEditor key={tile.id} tile={tile}
              onChange={(patch) => update((n) => { findRoom(n).room.tiles[tileIdx] = patch; })}
              onMove={(dir) => update((n) => moveIn(findRoom(n).room.tiles, tileIdx, dir))}
              onRemove={() => update((n) => {
                const r = findRoom(n).room;
                r.tiles = r.tiles.filter((t) => t.id !== tile.id);
              })}
            />
          ))}
          <button className="btn campuses__addtile" onClick={() => update((n) => {
            const id = slugId(`${roomId}-tile`, allIds(n));
            findRoom(n).room.tiles.push({ id, type: 'link', label: 'New tile', url: 'http://' });
          })}>+ Add tile</button>
        </div>
      </section>

      <ConnectivityPanel roomId={roomId!} />
    </>
  );
}

function TileEditor({ tile, onChange, onMove, onRemove }: {
  tile: Tile;
  onChange: (tile: Tile) => void;
  onMove: (dir: -1 | 1) => void;
  onRemove: () => void;
}) {
  const set = (field: string, value: string) => {
    const next = { ...tile } as Record<string, unknown>;
    if (value === '') delete next[field];
    else next[field] = value;
    onChange(next as unknown as Tile);
  };

  const retype = (type: Tile['type']) => {
    const base = { id: tile.id, label: tile.label, note: tile.note, icon: tile.icon };
    if (type === 'companion') onChange({ ...base, type, host: '' });
    else if (type === 'screenshare') onChange({ ...base, type, host: '' });
    else if (type === 'link') onChange({ ...base, type, url: 'http://' });
    else if (type === 'route') onChange({ ...base, type, to: '/' });
    else onChange({ ...base, type });
  };

  const t = tile as unknown as Record<string, string | undefined>;

  return (
    <div className="campuses__tile">
      <label className="lfield"><span>Type</span>
        <SelectField value={tile.type} onChange={(e) => retype(e.target.value as Tile['type'])}>
          {Object.entries(TILE_TYPE_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </SelectField>
      </label>
      <label className="lfield campuses__tileicon"><span>Icon</span>
        <SelectField value={tile.icon ?? ''} onChange={(e) => set('icon', e.target.value)}>
          <option value="">Default</option>
          {TILE_ICONS.map(([emoji, name]) => <option key={emoji} value={emoji}>{emoji} {name}</option>)}
        </SelectField>
      </label>
      <label className="lfield"><span>Label</span>
        <input className="field" value={tile.label}
          onChange={(e) => onChange({ ...tile, label: e.target.value })} />
      </label>
      <label className="lfield campuses__grow"><span>Note</span>
        <input className="field" placeholder="Optional" value={tile.note ?? ''}
          onChange={(e) => set('note', e.target.value)} />
      </label>

      {(tile.type === 'companion' || tile.type === 'screenshare') && (
        <label className="lfield"><span>Host</span>
          <input className="field" placeholder="IP or hostname" value={t.host ?? ''}
            onChange={(e) => set('host', e.target.value)} />
        </label>
      )}
      {tile.type === 'companion' && (
        <label className="lfield campuses__tileport"><span>Port</span>
          <input className="field" placeholder="8000" value={t.port ?? ''}
            onChange={(e) => set('port', e.target.value)} />
        </label>
      )}
      {tile.type === 'screenshare' && (
        <label className="lfield"><span>Mac username</span>
          <input className="field" placeholder="Optional" value={t.username ?? ''}
            onChange={(e) => set('username', e.target.value)} />
        </label>
      )}
      {tile.type === 'link' && (
        <label className="lfield campuses__grow"><span>URL</span>
          <input className="field" placeholder="http://…" value={t.url ?? ''}
            onChange={(e) => set('url', e.target.value)} />
        </label>
      )}
      {tile.type === 'route' && (
        <label className="lfield campuses__grow"><span>Route</span>
          <input className="field" placeholder="/room/…" value={t.to ?? ''}
            onChange={(e) => set('to', e.target.value)} />
        </label>
      )}

      <div className="campuses__rowactions">
        <button className="iconbtn" title="Move tile up" aria-label="Move tile up" onClick={() => onMove(-1)}><ArrowUp size={14} /></button>
        <button className="iconbtn" title="Move tile down" aria-label="Move tile down" onClick={() => onMove(1)}><ArrowDown size={14} /></button>
        <button className="iconbtn iconbtn--danger" title="Remove tile" aria-label="Remove tile" onClick={onRemove}><Trash2 size={14} /></button>
      </div>
    </div>
  );
}

// Connectivity: per-room integration config served from SQLite. First
// migrated integration: Planning Center service types. The rest still live in
// server/rooms.config.js and move here one at a time.
function ConnectivityPanel({ roomId }: { roomId: string }) {
  const [conn, setConn] = useState<RoomConnectivity | null>(null);
  const [err, setErr] = useState('');

  useEffect(() => {
    getRoomConnectivity(roomId)
      .then(setConn)
      .catch((e) => setErr(e instanceof Error ? e.message : String(e)));
  }, [roomId]);

  return (
    <section className="panel campuses">
      <div>
        <p className="section-label">Connectivity</p>
        <h2 className="panel__title">Integrations</h2>
      </div>

      {err && <p className="settings__error">{err}</p>}
      {!conn && !err && <p className="settings__muted">Loading…</p>}

      {conn && !conn.hasServerRoom && (
        <p className="settings__muted">
          The server doesn't know a room <code>{roomId}</code> — save the campus
          configuration above, then reload this page.
        </p>
      )}

      {conn?.hasServerRoom && (
        <>
          <CompanionEditor roomId={roomId} initial={conn.companion} />
          <PcServiceTypesEditor roomId={roomId} initial={conn.planningCenter?.serviceTypes ?? []} />
          <AnalysisEditor roomId={roomId} initial={conn.analysis} />
          <ProPresenterEditor roomId={roomId} initial={conn.proPresenter} />
        </>
      )}
    </section>
  );
}

function PcServiceTypesEditor({ roomId, initial }: { roomId: string; initial: PcServiceType[] }) {
  const [types, setTypes] = useState<PcServiceType[]>(initial);
  const [baseline, setBaseline] = useState(JSON.stringify(initial));
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  const dirty = JSON.stringify(types) !== baseline;

  const save = async () => {
    setErr(''); setMsg(''); setBusy(true);
    try {
      const stored = await savePcServiceTypes(roomId, types);
      setTypes(stored.serviceTypes);
      setBaseline(JSON.stringify(stored.serviceTypes));
      setMsg('Saved.');
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally { setBusy(false); }
  };

  return (
    <div className="pctypes">
      <div className="campuses__head">
        <div>
          <h3 className="pctypes__title">Planning Center service types
            <HelpTip text="The event types this room hosts. The ID is in the Planning Center Services URL for that service type." />
          </h3>
        </div>
        <button className="btn btn--primary" onClick={save} disabled={!dirty || busy}>
          {busy ? 'Saving…' : dirty ? 'Save service types' : 'Saved'}
        </button>
      </div>

      {types.length === 0 && <p className="settings__muted">None — this room shows no Planning Center events.</p>}
      {types.map((st, i) => (
        <div className="campuses__tile" key={i}>
          <label className="lfield campuses__grow"><span>Name</span>
            <input className="field" placeholder="e.g. Sunday" value={st.name}
              onChange={(e) => setTypes((all) => all.map((x, j) => j === i ? { ...x, name: e.target.value } : x))} />
          </label>
          <label className="lfield"><span>Service type ID</span>
            <input className="field" placeholder="e.g. 500001" inputMode="numeric" value={st.id}
              onChange={(e) => setTypes((all) => all.map((x, j) => j === i ? { ...x, id: e.target.value } : x))} />
          </label>
          <div className="campuses__rowactions">
            <button className="iconbtn iconbtn--danger" title="Remove service type" aria-label="Remove service type"
              onClick={() => setTypes((all) => all.filter((_, j) => j !== i))}><Trash2 size={14} /></button>
          </div>
        </div>
      ))}
      <button className="btn campuses__addtile" onClick={() => setTypes((all) => [...all, { id: '', name: '' }])}>
        + Add service type
      </button>

      {err && <p className="settings__error">{err}</p>}
      {msg && <p className="settings__ok">{msg}</p>}
    </div>
  );
}

// Draft form state for the analysis source — everything as strings so the
// inputs stay controlled; the server normalizes numbers on save.
interface AnalysisDraft {
  source: 'none' | 'smaart' | 'rta';
  host: string;
  port: string;
  target: string;
  limit: string;
  metric: string;
  password: string;
  logControl: boolean;
}

function toDraft(cfg: AnalysisConfig | null): AnalysisDraft {
  return {
    source: cfg ? cfg.source : 'none',
    host: cfg?.host ?? '',
    port: cfg?.port != null ? String(cfg.port) : '',
    target: cfg?.target != null ? String(cfg.target) : '',
    limit: cfg?.limit != null ? String(cfg.limit) : '',
    metric: cfg?.metric ?? '',
    password: '',
    logControl: Boolean(cfg?.logControl),
  };
}

function AnalysisEditor({ roomId, initial }: { roomId: string; initial: AnalysisConfig | null }) {
  const [draft, setDraft] = useState<AnalysisDraft>(() => toDraft(initial));
  const [baseline, setBaseline] = useState(() => JSON.stringify(toDraft(initial)));
  const [hasPassword, setHasPassword] = useState(Boolean(initial?.hasPassword));
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  const dirty = JSON.stringify(draft) !== baseline;
  const set = (patch: Partial<AnalysisDraft>) => setDraft((d) => ({ ...d, ...patch }));

  if (initial?.mock) {
    return (
      <div className="pctypes">
        <h3 className="pctypes__title">Analysis source
          <HelpTip text="Where this room's SPL numbers come from." />
        </h3>
        <p className="settings__muted">Simulated meter (dev room).</p>
      </div>
    );
  }

  const save = async () => {
    setErr(''); setMsg(''); setBusy(true);
    try {
      const stored = await saveAnalysis(
        roomId,
        draft.source === 'none'
          ? null
          : {
              source: draft.source,
              host: draft.host,
              port: draft.port === '' ? undefined : Number(draft.port),
              target: draft.target === '' ? undefined : Number(draft.target),
              limit: draft.limit === '' ? undefined : Number(draft.limit),
              metric: draft.metric || undefined,
              logControl: draft.source === 'smaart' && draft.logControl ? true : undefined,
              // Omit password unless typed — omitted keeps the stored one.
              ...(draft.password ? { password: draft.password } : {}),
            },
      );
      const next = toDraft(stored);
      setDraft(next);
      setBaseline(JSON.stringify(next));
      setHasPassword(Boolean(stored?.hasPassword));
      setMsg('Saved.');
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally { setBusy(false); }
  };

  return (
    <div className="pctypes">
      <div className="campuses__head">
        <h3 className="pctypes__title">Analysis source
          <HelpTip text="Where this room's SPL numbers come from — a Smaart rig or the free ProdMesh Remote RTA app. Target and limit set the dB goals on the live meter and show reports." />
        </h3>
        <button className="btn btn--primary" onClick={save} disabled={!dirty || busy}>
          {busy ? 'Saving…' : dirty ? 'Save analysis source' : 'Saved'}
        </button>
      </div>

      <div className="campuses__tile">
        <label className="lfield"><span>Source</span>
          <SelectField value={draft.source}
            onChange={(e) => set({ source: e.target.value as AnalysisDraft['source'] })}>
            <option value="none">None</option>
            <option value="smaart">Smaart</option>
            <option value="rta">ProdMesh Remote RTA</option>
          </SelectField>
        </label>
        {draft.source !== 'none' && (
          <>
            <label className="lfield campuses__grow"><span>Host</span>
              <input className="field" placeholder="e.g. 192.0.2.7" value={draft.host}
                onChange={(e) => set({ host: e.target.value })} />
            </label>
            <label className="lfield"><span>Port</span>
              <input className="field campuses__tileport" inputMode="numeric"
                placeholder={draft.source === 'smaart' ? '26000' : '8517'} value={draft.port}
                onChange={(e) => set({ port: e.target.value })} />
            </label>
          </>
        )}
      </div>

      {draft.source !== 'none' && (
        <div className="campuses__tile">
          <label className="lfield"><span>Target dB</span>
            <input className="field campuses__tileport" inputMode="numeric" placeholder="e.g. 90"
              value={draft.target} onChange={(e) => set({ target: e.target.value })} />
          </label>
          <label className="lfield"><span>Limit dB</span>
            <input className="field campuses__tileport" inputMode="numeric" placeholder="e.g. 95"
              value={draft.limit} onChange={(e) => set({ limit: e.target.value })} />
          </label>
          <label className="lfield campuses__grow"><span>Metric</span>
            <input className="field" placeholder={draft.source === 'smaart' ? 'SPL A Slow' : 'slow_db'}
              value={draft.metric} onChange={(e) => set({ metric: e.target.value })} />
          </label>
          {draft.source === 'smaart' && (
            <label className="lfield"><span>API password</span>
              <input className="field" type="password" autoComplete="off"
                placeholder={hasPassword ? 'unchanged' : 'none'} value={draft.password}
                onChange={(e) => set({ password: e.target.value })} />
            </label>
          )}
        </div>
      )}

      {draft.source === 'smaart' && (
        <div className="campuses__tile">
          <Checkbox
            label={<>Start/stop SPL logging with shows
              <HelpTip text="Show start turns Smaart's SPL logging on; show end turns it off (only if the show turned it on). Needs a calibrated input in Smaart." />
            </>}
            checked={draft.logControl}
            onChange={(e) => set({ logControl: e.target.checked })}
          />
        </div>
      )}

      {err && <p className="settings__error">{err}</p>}
      {msg && <p className="settings__ok">{msg}</p>}
    </div>
  );
}

// Draft form state for Companion + modes — everything stringly for controlled
// inputs; the server normalizes on save. A mode's button is optional: leaving
// page/row/col empty saves a mode with no Companion button.
interface ModeDraft {
  id: string;
  label: string;
  color: string;
  match: string;
  page: string;
  row: string;
  column: string;
  isStandby: boolean;
}

interface CompanionDraft {
  mock: boolean;
  host: string;
  port: string;
  variable: string;
  modes: ModeDraft[];
}

function toModeDraft(m: ModeConfig): ModeDraft {
  return {
    id: m.id,
    label: m.label,
    color: m.color,
    match: m.match,
    page: m.press ? String(m.press.page) : '',
    row: m.press ? String(m.press.row) : '',
    column: m.press ? String(m.press.column) : '',
    isStandby: Boolean(m.isStandby),
  };
}

function toCompanionDraft(cfg: CompanionConfig | null): CompanionDraft {
  return {
    mock: cfg ? cfg.mock : true,
    host: cfg?.host ?? '',
    port: cfg?.port != null ? String(cfg.port) : '',
    variable: cfg?.variable ?? '',
    modes: (cfg?.modes ?? []).map(toModeDraft),
  };
}

function CompanionEditor({ roomId, initial }: { roomId: string; initial: CompanionConfig | null }) {
  const [draft, setDraft] = useState<CompanionDraft>(() => toCompanionDraft(initial));
  const [baseline, setBaseline] = useState(() => JSON.stringify(toCompanionDraft(initial)));
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  const dirty = JSON.stringify(draft) !== baseline;
  const set = (patch: Partial<CompanionDraft>) => setDraft((d) => ({ ...d, ...patch }));
  const setMode = (i: number, patch: Partial<ModeDraft>) =>
    setDraft((d) => ({ ...d, modes: d.modes.map((m, j) => (j === i ? { ...m, ...patch } : m)) }));
  const moveMode = (i: number, dir: -1 | 1) =>
    setDraft((d) => {
      const j = i + dir;
      if (j < 0 || j >= d.modes.length) return d;
      const modes = [...d.modes];
      [modes[i], modes[j]] = [modes[j], modes[i]];
      return { ...d, modes };
    });

  const save = async () => {
    setErr(''); setMsg(''); setBusy(true);
    try {
      const stored = await saveCompanion(roomId, {
        mock: draft.mock,
        host: draft.host || undefined,
        port: draft.port === '' ? undefined : Number(draft.port),
        variable: draft.variable || undefined,
        modes: draft.modes.map((m) => ({
          id: m.id,
          label: m.label,
          color: m.color,
          match: m.match,
          ...(m.page === '' && m.row === '' && m.column === ''
            ? {}
            : { press: { page: Number(m.page), row: Number(m.row), column: Number(m.column) } }),
          ...(m.isStandby ? { isStandby: true } : {}),
        })),
      });
      const next = toCompanionDraft(stored);
      setDraft(next);
      setBaseline(JSON.stringify(next));
      setMsg('Saved.');
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally { setBusy(false); }
  };

  return (
    <div className="pctypes">
      <div className="campuses__head">
        <h3 className="pctypes__title">Companion &amp; modes
          <HelpTip text="The room's Bitfocus Companion install. Each mode presses a Companion button (page/row/column) and shows as active when the state variable matches its value. Every Companion lays its buttons out differently — set each mode's location to match this room's." />
        </h3>
        <button className="btn btn--primary" onClick={save} disabled={!dirty || busy}>
          {busy ? 'Saving…' : dirty ? 'Save Companion' : 'Saved'}
        </button>
      </div>

      <div className="campuses__tile">
        <Checkbox
          label={<>Simulated
            <HelpTip text="No Companion yet — room state is kept in memory so every screen still works. Untick when this room's Companion has the state variable and buttons set up." />
          </>}
          checked={draft.mock}
          onChange={(e) => set({ mock: e.target.checked })}
        />
        <label className="lfield campuses__grow"><span>Host</span>
          <input className="field" placeholder="e.g. 192.0.2.31" value={draft.host}
            onChange={(e) => set({ host: e.target.value })} />
        </label>
        <label className="lfield"><span>Port</span>
          <input className="field campuses__tileport" inputMode="numeric" placeholder="8000"
            value={draft.port} onChange={(e) => set({ port: e.target.value })} />
        </label>
        <label className="lfield"><span>State variable</span>
          <input className="field" placeholder="roomState" value={draft.variable}
            onChange={(e) => set({ variable: e.target.value })} />
        </label>
      </div>

      {draft.modes.map((m, i) => (
        <div className="campuses__tile" key={i}>
          <label className="lfield campuses__modecolor"><span>Color</span>
            <input className="field" type="color" value={m.color}
              onChange={(e) => setMode(i, { color: e.target.value })} />
          </label>
          <label className="lfield"><span>Label</span>
            <input className="field" value={m.label}
              onChange={(e) => setMode(i, { label: e.target.value })} />
          </label>
          <label className="lfield"><span>ID</span>
            <input className="field" placeholder="e.g. sunday" value={m.id}
              onChange={(e) => setMode(i, { id: e.target.value })} />
          </label>
          <label className="lfield"><span>Match</span>
            <input className="field" placeholder="e.g. SUNDAY" value={m.match}
              onChange={(e) => setMode(i, { match: e.target.value })} />
          </label>
          <label className="lfield campuses__tileport"><span>Page</span>
            <input className="field" inputMode="numeric" value={m.page}
              onChange={(e) => setMode(i, { page: e.target.value })} />
          </label>
          <label className="lfield campuses__tileport"><span>Row</span>
            <input className="field" inputMode="numeric" value={m.row}
              onChange={(e) => setMode(i, { row: e.target.value })} />
          </label>
          <label className="lfield campuses__tileport"><span>Col</span>
            <input className="field" inputMode="numeric" value={m.column}
              onChange={(e) => setMode(i, { column: e.target.value })} />
          </label>
          <Checkbox label="Standby" checked={m.isStandby}
            onChange={(e) => setMode(i, { isStandby: e.target.checked })} />
          <div className="campuses__rowactions">
            <button className="iconbtn" title="Move mode up" aria-label="Move mode up"
              onClick={() => moveMode(i, -1)}><ArrowUp size={14} /></button>
            <button className="iconbtn" title="Move mode down" aria-label="Move mode down"
              onClick={() => moveMode(i, 1)}><ArrowDown size={14} /></button>
            <button className="iconbtn iconbtn--danger" title="Remove mode" aria-label="Remove mode"
              onClick={() => setDraft((d) => ({ ...d, modes: d.modes.filter((_, j) => j !== i) }))}>
              <Trash2 size={14} /></button>
          </div>
        </div>
      ))}

      <div>
        <button className="btn" onClick={() => setDraft((d) => ({
          ...d,
          modes: [...d.modes, {
            id: '', label: '', color: '#5b8def', match: '',
            page: '', row: '', column: '', isStandby: false,
          }],
        }))}>+ Add mode</button>
      </div>

      {err && <p className="settings__error">{err}</p>}
      {msg && <p className="settings__ok">{msg}</p>}
    </div>
  );
}

// Draft form state for ProPresenter — an empty host means "not in this room"
// and saves as a clear.
interface PpDraft {
  host: string;
  port: string;
  timer: string;
}

function toPpDraft(cfg: ProPresenterConfig | null): PpDraft {
  return {
    host: cfg?.host ?? '',
    port: cfg?.port != null ? String(cfg.port) : '',
    timer: cfg?.timer ?? '',
  };
}

function ProPresenterEditor({ roomId, initial }: { roomId: string; initial: ProPresenterConfig | null }) {
  const [draft, setDraft] = useState<PpDraft>(() => toPpDraft(initial));
  const [baseline, setBaseline] = useState(() => JSON.stringify(toPpDraft(initial)));
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  const dirty = JSON.stringify(draft) !== baseline;
  const set = (patch: Partial<PpDraft>) => setDraft((d) => ({ ...d, ...patch }));

  const save = async () => {
    setErr(''); setMsg(''); setBusy(true);
    try {
      const stored = await saveProPresenter(
        roomId,
        draft.host.trim()
          ? {
              host: draft.host,
              port: draft.port === '' ? undefined : Number(draft.port),
              timer: draft.timer || undefined,
            }
          : null,
      );
      const next = toPpDraft(stored);
      setDraft(next);
      setBaseline(JSON.stringify(next));
      setMsg('Saved.');
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally { setBusy(false); }
  };

  return (
    <div className="pctypes">
      <div className="campuses__head">
        <h3 className="pctypes__title">ProPresenter
          <HelpTip text="The room's ProPresenter API (official, 7.9+) — drives Run of Show tracking and the service countdown. Leave the host empty if the room has no ProPresenter." />
        </h3>
        <button className="btn btn--primary" onClick={save} disabled={!dirty || busy}>
          {busy ? 'Saving…' : dirty ? 'Save ProPresenter' : 'Saved'}
        </button>
      </div>

      <div className="campuses__tile">
        <label className="lfield campuses__grow"><span>Host</span>
          <input className="field" placeholder="e.g. 192.0.2.74" value={draft.host}
            onChange={(e) => set({ host: e.target.value })} />
        </label>
        <label className="lfield"><span>Port</span>
          <input className="field campuses__tileport" inputMode="numeric" placeholder="62202"
            value={draft.port} onChange={(e) => set({ port: e.target.value })} />
        </label>
        <label className="lfield campuses__grow"><span>Countdown timer</span>
          <input className="field" placeholder="First countdown timer" value={draft.timer}
            onChange={(e) => set({ timer: e.target.value })} />
        </label>
      </div>

      {err && <p className="settings__error">{err}</p>}
      {msg && <p className="settings__ok">{msg}</p>}
    </div>
  );
}
