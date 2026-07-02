import { useEffect, useState } from 'react';
import { Link, NavLink, Outlet, matchPath, useLocation, useNavigate } from 'react-router-dom';
import { getRooms, type RoomMeta } from '../api';
import { church } from '../config/dashboard.config';
import { Clock } from '../components/Clock';
import logoUrl from '../assets/logo.png';

// Persistent chrome: brand → home, room switcher, contextual room tabs,
// clock, settings gear. Pages render inside <Outlet /> and own no chrome.
export function AppShell() {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const [rooms, setRooms] = useState<RoomMeta[]>([]);

  useEffect(() => {
    getRooms().then(setRooms).catch(() => {});
  }, []);

  // The layout route doesn't receive child-route params — read the room from
  // the path itself so the switcher and tabs stay in sync on any room page.
  const match = matchPath('/room/:roomId/*', pathname) ?? matchPath('/room/:roomId', pathname);
  const roomId = match?.params.roomId ?? '';
  const inShow = /^\/room\/[^/]+\/(run|show)/.test(pathname);

  return (
    <div className="shell">
      <header className="topbar">
        <Link to="/" className="topbar__brand">
          <img className="topbar__logo" src={logoUrl} alt="" />
          <span className="topbar__name">{church.name}</span>
        </Link>

        <div className="roomswitch">
          <select
            value={roomId}
            onChange={(e) => e.target.value && navigate(`/room/${e.target.value}`)}
            aria-label="Switch room"
          >
            <option value="">Rooms…</option>
            {rooms.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </select>
        </div>

        {roomId && (
          <nav className="topbar__nav">
            <NavLink
              to={`/room/${roomId}`}
              end
              className={({ isActive }) => `tab${isActive ? ' tab--active' : ''}`}
            >
              Status
            </NavLink>
            <Link to={`/room/${roomId}/show`} className={`tab${inShow ? ' tab--active' : ''}`}>
              Run of Show
            </Link>
          </nav>
        )}

        <div className="topbar__spacer" />
        <Clock compact />
        <Link className="gear" to="/settings" title="Settings" aria-label="Settings">
          ⚙️
        </Link>
      </header>

      <main className="shell__main">
        <Outlet />
      </main>
    </div>
  );
}
