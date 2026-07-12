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
import { getAbout, getAuthStatus, logoutAdmin, type AuthStatus, type Station } from '../api';
import { church } from '../config/dashboard.config';
import { ALL_CAMPUSES, CampusContext } from './campus';
import { Clock } from '../components/Clock';
import { SelectField } from '../components/SelectField';
import { IdentityDialog } from '../components/IdentityDialog';
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
  const [identity, setIdentity] = useState<AuthStatus | null>(null);
  const [identityOpen, setIdentityOpen] = useState(false);

  useEffect(() => {
    getAbout().then((a) => setVersion(a.version)).catch(() => {});
    getAuthStatus().then((s) => {
      setIdentity(s);
      if (!s.station) setIdentityOpen(true);
    }).catch(() => setIdentityOpen(true));
  }, []);

  useEffect(() => {
    const open = () => setIdentityOpen(true);
    window.addEventListener('prodmesh:auth-required', open);
    return () => window.removeEventListener('prodmesh:auth-required', open);
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

  const stationName = identity?.station?.name ?? 'Unregistered station';
  const operatorName = identity?.user?.displayName ?? 'Read-only';

  const lock = async () => {
    await logoutAdmin();
    setIdentity(await getAuthStatus());
  };

  const stationRegistered = async (_station: Station) => {
    const next = await getAuthStatus();
    setIdentity(next);
    setIdentityOpen(false);
  };

  return (
    <CampusContext.Provider value={campus}>
      <div className={`shell${collapsed ? ' shell--rail' : ''}`}>
        <aside className="sidebar">
          <div className="sidebar__brand">
            <img className="sidebar__logo" src={logoUrl} alt="" title={church.name} />
            <div className="sidebar__brandtext rail-hide">
              <span className="sidebar__church">{church.name}</span>
              <SelectField
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
              </SelectField>
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
            <button
              className="sidebar__user"
              title={identity?.authenticated ? `Lock ${operatorName}` : 'Log in'}
              onClick={identity?.authenticated ? lock : () => setIdentityOpen(true)}
            >
              <CircleUser size={19} className="sidebar__icon" />
              <div className="sidebar__label rail-hide">
                <span className="sidebar__username">{operatorName}</span>
                <span className="sidebar__version">{stationName}{version ? ` · v${version}` : ''}</span>
              </div>
            </button>
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
        {identityOpen && (
          <IdentityDialog
            stationRequired={!identity?.station}
            campusId={campusId}
            status={identity}
            onStation={stationRegistered}
            onLogin={(next) => { setIdentity(next); setIdentityOpen(false); }}
            onClose={() => setIdentityOpen(false)}
          />
        )}
      </div>
    </CampusContext.Provider>
  );
}
