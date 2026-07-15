import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowDown, ArrowUp, CircleUser, MonitorCog, Trash2, Zap } from 'lucide-react';
import { Checkbox } from '../components/Checkbox';
import { SelectField } from '../components/SelectField';
import { church } from '../config/dashboard.config';
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
  type ServerLogTail,
  type AuditEntry,
  type RoomMeta,
  type ScheduleWindow,
  type ChecklistTemplatesInfo,
  type TemplateItem,
  type UserDirectory,
  type ManagedStation,
} from '../api';
type Phase = 'loading' | 'setup' | 'login' | 'admin';
const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

type AdminSection = 'general' | 'users' | 'stations' | 'checklists' | 'logs';

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
    general: ['General', 'Security, schedules, and system maintenance'],
    users: ['Users & access', 'Operators, permission groups, and Planning Center identities'],
    stations: ['Stations', 'Registered browsers, assignments, and recent activity'],
    checklists: ['Checklists', 'Startup checklist templates by event type'],
    logs: ['Logs', 'Server process log and the audit trail'],
  } as const;

  return (
    <div className="settings">
      <div className="pagehead">
        <div>
          <p className="eyebrow">Administration</p>
          <h1 className="pagehead__title">{titles[section][0]}</h1>
          <p className="pagehead__sub">{titles[section][1]}</p>
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
      {section === 'users' && <UserManagementPanel />}
      {section === 'stations' && <StationsPanel />}
      {section === 'checklists' && <ChecklistsPanel />}
      {section === 'logs' && <LogsPanel />}
    </>
  );
}

// ── Users, permission groups, and ACLs ───────────────────────────────────────
export function UserManagementPanel() {
  const [directory, setDirectory] = useState<UserDirectory | null>(null);
  const [user, setUser] = useState({ displayName: '', username: '', pin: '', planningCenterPersonId: '' });
  const [userGroups, setUserGroupsDraft] = useState<string[]>([]);
  const [groupName, setGroupName] = useState('');
  const [groupPermissions, setGroupPermissions] = useState<string[]>([]);
  const [msg, setMsg] = useState('');

  const refresh = () => getUserDirectory().then(setDirectory).catch((err) => setMsg(String(err)));
  useEffect(() => { refresh(); }, []);

  if (!directory) return null;

  const addUser = async () => {
    setMsg('');
    try {
      await createUser({
        ...user,
        planningCenterPersonId: user.planningCenterPersonId || null,
        groupIds: userGroups,
      });
      setUser({ displayName: '', username: '', pin: '', planningCenterPersonId: '' });
      setUserGroupsDraft([]);
      setMsg('User created.');
      refresh();
    } catch (err) { setMsg(err instanceof Error ? err.message : String(err)); }
  };

  const addGroup = async () => {
    setMsg('');
    try {
      await createGroup(groupName, groupPermissions);
      setGroupName(''); setGroupPermissions([]); setMsg('Permission group created.');
      refresh();
    } catch (err) { setMsg(err instanceof Error ? err.message : String(err)); }
  };

  const toggle = (values: string[], value: string) =>
    values.includes(value) ? values.filter((x) => x !== value) : [...values, value];

  return (
    <section className="panel users">
      <div>
        <p className="section-label">Access control</p>
        <h2 className="panel__title">Users &amp; permissions</h2>
      </div>
      <p className="settings__muted">
        Users authenticate at a named station. Their effective access is the union of every assigned group; Administrators always have all permissions.
      </p>

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
      {msg && <p className={msg.includes('created') ? 'settings__ok' : 'settings__muted'}>{msg}</p>}
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
  const [message, setMessage] = useState('');
  const [revokeTarget, setRevokeTarget] = useState<ManagedStation | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [stationResult, roomResult] = await Promise.all([getStations(), getRooms()]);
      setStations(stationResult.stations);
      setRooms(roomResult);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const remove = async () => {
    if (!revokeTarget) return;
    setMessage('');
    try {
      const result = await revokeStation(revokeTarget.id);
      setRevokeTarget(null);
      if (!result.current) {
        setMessage('Station revoked. Its browser will be asked to register again.');
        refresh();
      }
    } catch (err) {
      setMessage(err instanceof Error ? err.message : String(err));
    }
  };

  if (loading) return <p className="settings__muted">Loading stations…</p>;

  return (
    <section className="panel stations">
      <div>
        <p className="section-label">Browser identity</p>
        <h2 className="panel__title">Registered stations</h2>
      </div>
      <p className="settings__muted">
        Stations identify where actions originate. Revoking one removes its registration and signs out sessions created there.
      </p>

      <div className="stations__list">
        {stations.length === 0 && <p className="settings__muted">No registered stations.</p>}
        {stations.map((station) => (
          <StationEditor
            key={station.id}
            station={station}
            rooms={rooms}
            onSaved={(updated) => {
              setStations((all) => all.map((entry) => entry.id === updated.id ? { ...updated, current: station.current } : entry));
              setMessage('Station updated.');
            }}
            onRevoke={() => setRevokeTarget(station)}
          />
        ))}
      </div>
      {message && <p className="settings__muted">{message}</p>}

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
  const [msg, setMsg] = useState<string | null>(null);

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
      setMsg('Template saved.');
    } catch (err) {
      setMsg(`Couldn’t save: ${err instanceof Error ? err.message : err}`);
    }
  };

  const removeTemplate = async () => {
    const templates = await deleteChecklistTemplate(selected);
    setInfo((x) => x && { ...x, templates });
    setDraft(templates[selected] ?? null);
    setMsg(selected === DEFAULT_KEY ? 'Default template removed.' : 'Now using the Default template.');
  };

  const hasOwn = Boolean(info.templates[selected]);

  return (
    <section className="panel">
      <h2 className="panel__title">Checklists</h2>
      <p className="settings__muted">
        Startup checklist per event type — it runs on that event’s detail page in whichever room
        hosts it. Automated items (<Zap size={11} />) set the room’s mode when checked; lockouts
        still apply.
      </p>

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
            {msg && <span className="settings__ok">{msg}</span>}
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
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    getSettings().then((s) => setOverrideSet(s.pins.overrideSet)).catch(() => {});
  }, []);

  const saveAdmin = async () => {
    if (adminPin.length < 4) return setMsg('Admin PIN must be ≥ 4 digits.');
    await setPins({ admin: adminPin });
    setAdminPin(''); setMsg('Admin PIN updated.');
  };
  const saveOverride = async () => {
    if (overridePin.length < 4) return setMsg('Override PIN must be ≥ 4 digits.');
    await setPins({ override: overridePin });
    setOverridePin(''); setOverrideSet(true); setMsg('Override PIN updated.');
  };
  const clearOverride = async () => {
    await setPins({ override: '' });
    setOverrideSet(false); setMsg('Override PIN cleared — mode locks are now inactive.');
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
      {msg && <p className="settings__ok">{msg}</p>}
    </section>
  );
}

function SystemPanel() {
  const [version, setVersion] = useState<{ commit: string; subject: string } | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  const load = useCallback(() => getVersion().then(setVersion).catch(() => {}), []);
  useEffect(() => { load(); }, [load]);

  const update = async () => {
    setStatus('Starting update…');
    const before = version?.commit;
    try {
      await triggerUpdate();
    } catch {
      return setStatus('Could not start update.');
    }
    setStatus('Updating & restarting… (this page may briefly disconnect)');
    let tries = 0;
    const iv = setInterval(async () => {
      tries += 1;
      try {
        const v = await getVersion();
        if (v.commit !== before && v.commit !== 'unknown') {
          setVersion(v); setStatus(`Updated to ${v.commit}.`); clearInterval(iv);
        }
      } catch { /* server restarting */ }
      if (tries > 40) { setStatus('Update taking longer than expected — check the box.'); clearInterval(iv); }
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
      {status && <p className="settings__ok">{status}</p>}
    </section>
  );
}

function SchedulesPanel() {
  const [rooms, setRooms] = useState<RoomMeta[]>([]);
  const [schedules, setSchedules] = useState<Record<string, ScheduleWindow[]>>({});
  const [msg, setMsg] = useState<string | null>(null);

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
    await saveSchedules(schedules);
    setMsg('Schedules saved.');
  };

  return (
    <section className="panel">
      <h2 className="panel__title">Schedules &amp; Locks</h2>
      <p className="settings__muted">
        During a window, the listed modes require the Override PIN. (Locks are
        inactive until an Override PIN is set.)
      </p>
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
        {msg && <span className="settings__ok">{msg}</span>}
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
          <h2 className="panel__title">Audit trail</h2>
        </div>
        <button className="btn" onClick={refresh}>Refresh</button>
      </div>
      <p className="settings__muted">
        Who did what, from which station. The most recent 200 entries.
      </p>

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
