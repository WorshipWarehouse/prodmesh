import { useEffect, useMemo, useState } from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import {
  BarChart3,
  CalendarDays,
  CircleUser,
  Home as HomeIcon,
  PanelLeftClose,
  PanelLeftOpen,
  Wrench,
} from 'lucide-react';
import { getAbout } from '../api';
import { church } from '../config/dashboard.config';
import { ALL_CAMPUSES, CampusContext } from './campus';
import { Clock } from '../components/Clock';
import logoUrl from '../assets/logo.png';

const NAV = [
  { to: '/', label: 'Home', icon: HomeIcon, end: true },
  { to: '/services', label: 'Services', icon: CalendarDays },
  { to: '/analytics', label: 'Analytics', icon: BarChart3 },
  { to: '/admin', label: 'Admin', icon: Wrench },
];

// Persistent chrome: a left sidebar (collapsible to an icon rail) with the
// church brand + campus scope up top, global nav, and the user slot pinned at
// the bottom. Pages render inside <Outlet /> and own no chrome. Room-level
// pages (/room/…) still exist below this nav — Home/Services link into them.
export function AppShell() {
  const [collapsed, setCollapsed] = useState(
    () => localStorage.getItem('prodmesh.sidebar') === 'rail',
  );
  const [campusId, setCampusId] = useState(
    () => localStorage.getItem('prodmesh.campus') ?? ALL_CAMPUSES,
  );
  const [version, setVersion] = useState('');

  useEffect(() => {
    getAbout().then((a) => setVersion(a.version)).catch(() => {});
  }, []);

  const campus = useMemo(
    () => ({
      campusId,
      setCampusId: (id: string) => {
        setCampusId(id);
        localStorage.setItem('prodmesh.campus', id);
      },
    }),
    [campusId],
  );

  const toggle = () => {
    setCollapsed((c) => {
      localStorage.setItem('prodmesh.sidebar', c ? 'open' : 'rail');
      return !c;
    });
  };

  const campusName =
    campusId === ALL_CAMPUSES
      ? 'All Campuses'
      : church.sites.find((s) => s.id === campusId)?.name ?? campusId;

  return (
    <CampusContext.Provider value={campus}>
      <div className={`shell${collapsed ? ' shell--rail' : ''}`}>
        <aside className="sidebar">
          <div className="sidebar__brand">
            <img className="sidebar__logo" src={logoUrl} alt="" title={church.name} />
            <div className="sidebar__brandtext rail-hide">
              <span className="sidebar__church">{church.name}</span>
              <select
                className="sidebar__campus"
                value={campusId}
                onChange={(e) => campus.setCampusId(e.target.value)}
                aria-label="Campus"
              >
                <option value={ALL_CAMPUSES}>All Campuses</option>
                {church.sites.map((s) => (
                  <option key={s.id} value={s.id} disabled={s.status !== 'active'}>
                    {s.name}
                    {s.status !== 'active' ? ' (soon)' : ''}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <nav className="sidebar__nav">
            {NAV.map(({ to, label, icon: Icon, end }) => (
              <NavLink
                key={to}
                to={to}
                end={end}
                title={label}
                className={({ isActive }) => `sidebar__item${isActive ? ' sidebar__item--active' : ''}`}
              >
                <Icon size={19} className="sidebar__icon" />
                <span className="sidebar__label rail-hide">{label}</span>
              </NavLink>
            ))}
          </nav>

          <div className="sidebar__foot">
            <div className="sidebar__clock rail-hide">
              <Clock compact />
            </div>
            <div
              className="sidebar__user"
              title={`Booth station${version ? ` · prodmesh v${version}` : ''} — user accounts coming later`}
            >
              <CircleUser size={19} className="sidebar__icon" />
              <div className="sidebar__label rail-hide">
                <span className="sidebar__username">Booth station</span>
                {version && <span className="sidebar__version">v{version} · {campusName}</span>}
              </div>
            </div>
            <button
              className="sidebar__toggle"
              onClick={toggle}
              title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
              aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            >
              {collapsed ? <PanelLeftOpen size={17} /> : <PanelLeftClose size={17} />}
              <span className="sidebar__label rail-hide">Collapse</span>
            </button>
          </div>
        </aside>

        <main className="shell__main">
          <Outlet />
        </main>
      </div>
    </CampusContext.Provider>
  );
}
