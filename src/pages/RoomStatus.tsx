import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  getRoom,
  getRoomState,
  setRoomMode,
  OverrideRequiredError,
  type RoomMeta,
  type RoomMode,
  type RoomState,
} from '../api';
import { Widget, WidgetGrid } from '../components/Widget';
import { ServicePanel } from '../components/ServicePanel';

const POLL_MS = 4000;

export function RoomStatus() {
  const { roomId = '' } = useParams();
  const [room, setRoom] = useState<RoomMeta | null>(null);
  const [state, setState] = useState<RoomState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<RoomMode | null>(null); // confirm dialog
  const [pin, setPin] = useState('');
  const [pinError, setPinError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

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
      /* keep last state */
    }
  }, [roomId]);

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, POLL_MS);
    return () => clearInterval(id);
  }, [refresh]);

  const protection = state?.protection;
  const isLocked = useCallback(
    (modeId: string) =>
      Boolean(protection?.enforced && protection.lockedModes.includes(modeId)),
    [protection],
  );

  const openConfirm = (mode: RoomMode) => {
    setPin('');
    setPinError(null);
    setPending(mode);
  };

  const confirmMode = useCallback(async () => {
    if (!pending) return;
    const locked = isLocked(pending.id);
    if (locked && !pin) {
      setPinError('Enter the override PIN to continue.');
      return;
    }
    setBusy(true);
    setPinError(null);
    try {
      const next = await setRoomMode(roomId, pending.id, locked ? pin : undefined);
      setState(next);
      setPending(null);
    } catch (err) {
      if (err instanceof OverrideRequiredError) {
        setPinError('Incorrect override PIN.');
      } else {
        setPinError('Something went wrong — try again.');
      }
    } finally {
      setBusy(false);
      refresh();
    }
  }, [pending, roomId, pin, isLocked, refresh]);

  if (error) {
    return (
      <div className="pagemsg">
        <p>{error}</p>
        <Link className="backlink" to="/">
          ← Quick Access
        </Link>
      </div>
    );
  }

  if (!room || !state) {
    return <div className="pagemsg">Loading…</div>;
  }

  const currentMode = room.modes.find((m) => m.id === state.mode) ?? null;
  const inStandby = currentMode?.isStandby ?? false;
  const buttons = room.modes.filter((m) => !m.isStandby || !inStandby);
  const showProtection = Boolean(protection?.active && protection.enforced);

  return (
    <div className="status">
      <div className="pagehead">
        <div>
          <h1 className="pagehead__title">{room.name}</h1>
          <p className="pagehead__sub">Room Status</p>
        </div>
      </div>

      {showProtection && (
        <div className="protbar">
          🔒 <strong>{protection!.label}</strong> — locked:{' '}
          {protection!.lockedModes
            .map((id) => room.modes.find((m) => m.id === id)?.label ?? id)
            .join(', ')}{' '}
          <span className="protbar__hint">(override PIN required)</span>
        </div>
      )}

      <WidgetGrid>
        <Widget
          span="two-thirds"
          title="Room Mode"
          meta={
            <span className={`mode-hero__conn mode-hero__conn--${state.online ? 'on' : 'off'}`}>
              {state.online ? '● Companion live' : '○ Demo mode (Companion offline)'}
            </span>
          }
        >
          <div
            className="mode-hero"
            style={{ ['--mode-color' as string]: currentMode?.color ?? '#6b7280' }}
          >
            <span className="mode-hero__label">Current mode</span>
            <span className="mode-hero__mode">{currentMode?.label ?? 'Unknown'}</span>
          </div>

          <p className="widget__hint">Set the room to…</p>
          <div className="status__buttons">
            {buttons.map((mode) => {
              const isActive = mode.id === state.mode;
              const locked = isLocked(mode.id);
              return (
                <button
                  key={mode.id}
                  type="button"
                  className={`mode-btn${isActive ? ' mode-btn--active' : ''}${
                    mode.isStandby ? ' mode-btn--standby' : ''
                  }`}
                  style={{ ['--mode-color' as string]: mode.color }}
                  disabled={isActive}
                  onClick={() => openConfirm(mode)}
                >
                  <span className="mode-btn__label">
                    {locked && <span aria-label="locked">🔒 </span>}
                    {mode.label}
                  </span>
                  {isActive && <span className="mode-btn__active">Active now</span>}
                </button>
              );
            })}
          </div>
        </Widget>

        <ServicePanel roomId={roomId} span="third" />
      </WidgetGrid>

      {pending && (
        <div className="confirm" role="dialog" aria-modal="true">
          <div className="confirm__card">
            <p className="confirm__text">
              Switch <strong>{room.name}</strong> to{' '}
              <strong style={{ color: pending.color }}>{pending.label}</strong>?
            </p>

            {isLocked(pending.id) && (
              <div className="confirm__lock">
                <label className="confirm__lock-label" htmlFor="override-pin">
                  🔒 This change is locked ({protection!.label}). Enter override PIN:
                </label>
                <input
                  id="override-pin"
                  className="confirm__pin"
                  type="password"
                  inputMode="numeric"
                  autoComplete="off"
                  value={pin}
                  onChange={(e) => setPin(e.target.value)}
                  autoFocus
                />
              </div>
            )}

            {pinError && <p className="confirm__error">{pinError}</p>}

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
