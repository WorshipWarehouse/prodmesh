import { useCallback, useEffect, useState } from 'react';
import {
  getAuthStatus,
  loginAdmin,
  logoutAdmin,
  setPins,
  getSettings,
  saveSchedules,
  getRooms,
  getVersion,
  triggerUpdate,
  type RoomMeta,
  type ScheduleWindow,
} from '../api';
type Phase = 'loading' | 'setup' | 'login' | 'admin';
const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function Settings() {
  const [phase, setPhase] = useState<Phase>('loading');

  const refreshStatus = useCallback(async () => {
    const s = await getAuthStatus();
    setPhase(s.admin ? 'admin' : s.setupNeeded ? 'setup' : 'login');
  }, []);

  useEffect(() => {
    refreshStatus();
  }, [refreshStatus]);

  return (
    <div className="settings">
      <div className="pagehead">
        <div>
          <h1 className="pagehead__title">Settings</h1>
          <p className="pagehead__sub">Admin</p>
        </div>
      </div>

      {phase === 'loading' && <p className="settings__muted">Loading…</p>}
      {phase === 'setup' && <SetupForm onDone={refreshStatus} />}
      {phase === 'login' && <LoginForm onDone={refreshStatus} />}
      {phase === 'admin' && <AdminPanels onLogout={refreshStatus} />}
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
function AdminPanels({ onLogout }: { onLogout: () => void }) {
  return (
    <>
      <div className="settings__toolbar">
        <button className="btn" onClick={async () => { await logoutAdmin(); onLogout(); }}>
          Log out
        </button>
      </div>
      <SecurityPanel />
      <SystemPanel />
      <SchedulesPanel />
    </>
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
                  <label key={m.id} className="lockchk">
                    <input type="checkbox" checked={w.lock.includes(m.id)}
                      onChange={() => editWindow(room.id, i, {
                        lock: w.lock.includes(m.id) ? w.lock.filter((x) => x !== m.id) : [...w.lock, m.id],
                      })} />
                    {m.label}
                  </label>
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
