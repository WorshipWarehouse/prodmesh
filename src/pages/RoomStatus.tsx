import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  getRoom,
  getRoomState,
  setRoomMode,
  type RoomMeta,
  type RoomMode,
  type RoomState,
} from '../api';
import { Clock } from '../components/Clock';
import logoUrl from '../assets/logo.png';

const POLL_MS = 4000;

export function RoomStatus() {
  const { roomId = '' } = useParams();
  const [room, setRoom] = useState<RoomMeta | null>(null);
  const [state, setState] = useState<RoomState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<RoomMode | null>(null); // confirm dialog
  const [busy, setBusy] = useState(false);

  // Load room metadata once.
  useEffect(() => {
    let active = true;
    getRoom(roomId)
      .then((r) => active && setRoom(r))
      .catch(() => active && setError('Room not found'));
    return () => {
      active = false;
    };
  }, [roomId]);

  const refresh = useCallback(async () => {
    try {
      setState(await getRoomState(roomId));
    } catch {
      /* keep last state; the online badge will reflect trouble */
    }
  }, [roomId]);

  // Poll current state.
  useEffect(() => {
    refresh();
    const id = setInterval(refresh, POLL_MS);
    return () => clearInterval(id);
  }, [refresh]);

  const confirmMode = useCallback(async () => {
    if (!pending) return;
    setBusy(true);
    try {
      const next = await setRoomMode(roomId, pending.id);
      setState(next);
    } catch {
      /* surfaced via state badge on next poll */
    } finally {
      setBusy(false);
      setPending(null);
      refresh();
    }
  }, [pending, roomId, refresh]);

  if (error) {
    return (
      <div className="status status--error">
        <p>{error}</p>
        <Link className="status__back" to="/">
          ← Quick Access
        </Link>
      </div>
    );
  }

  if (!room || !state) {
    return <div className="status status--loading">Loading…</div>;
  }

  const currentMode = room.modes.find((m) => m.id === state.mode) ?? null;
  const inStandby = currentMode?.isStandby ?? false;

  // Active modes are always shown; the Standby button only when not already idle.
  const buttons = room.modes.filter((m) => !m.isStandby || !inStandby);

  return (
    <div className="status">
      <header className="status__header">
        <div className="app__brand">
          <img className="app__logo" src={logoUrl} alt="" />
          <div>
            <h1 className="status__room">{room.name}</h1>
            <p className="app__subtitle">Room Status</p>
          </div>
        </div>
        <Clock />
      </header>

      <section
        className="status__current"
        style={{ ['--mode-color' as string]: currentMode?.color ?? '#6b7280' }}
      >
        <span className="status__label">Current mode</span>
        <span className="status__mode">{currentMode?.label ?? 'Unknown'}</span>
        <span className={`status__conn status__conn--${state.online ? 'on' : 'off'}`}>
          {state.online ? '● Companion live' : '○ Demo mode (Companion offline)'}
        </span>
      </section>

      <section className="status__actions">
        <h2 className="status__prompt">Set the room to…</h2>
        <div className="status__buttons">
          {buttons.map((mode) => {
            const isActive = mode.id === state.mode;
            return (
              <button
                key={mode.id}
                type="button"
                className={`mode-btn${isActive ? ' mode-btn--active' : ''}${
                  mode.isStandby ? ' mode-btn--standby' : ''
                }`}
                style={{ ['--mode-color' as string]: mode.color }}
                disabled={isActive}
                onClick={() => setPending(mode)}
              >
                <span className="mode-btn__label">{mode.label}</span>
                {isActive && <span className="mode-btn__active">Active now</span>}
              </button>
            );
          })}
        </div>
      </section>

      <footer className="status__footer">
        <Link className="status__back" to="/">
          ← Quick Access
        </Link>
      </footer>

      {pending && (
        <div className="confirm" role="dialog" aria-modal="true">
          <div className="confirm__card">
            <p className="confirm__text">
              Switch <strong>{room.name}</strong> to{' '}
              <strong style={{ color: pending.color }}>{pending.label}</strong>?
            </p>
            <div className="confirm__buttons">
              <button
                type="button"
                className="confirm__cancel"
                onClick={() => setPending(null)}
                disabled={busy}
              >
                Cancel
              </button>
              <button
                type="button"
                className="confirm__ok"
                style={{ ['--mode-color' as string]: pending.color }}
                onClick={confirmMode}
                disabled={busy}
              >
                {busy ? 'Working…' : `Yes, ${pending.label}`}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
