import { useEffect, useMemo, useRef, useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import {
  BarChart3,
  CalendarDays,
  CircleUser,
  ClipboardList,
  MonitorCog,
  LockKeyhole,
  ScrollText,
  Settings2,
  Users,
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
  { to: '/admin/general', label: 'Admin', icon: Wrench },
];

const ADMIN_NAV = [
  { to: '/admin/general', label: 'General', icon: Settings2 },
  { to: '/admin/users', label: 'Users & access', icon: Users },
  { to: '/admin/stations', label: 'Stations', icon: MonitorCog },
  { to: '/admin/checklists', label: 'Checklists', icon: ClipboardList },
  { to: '/admin/logs', label: 'Logs', icon: ScrollText },
];

// Persistent chrome: a left sidebar (collapsible to an icon rail) with the
// church brand + campus scope up top, global nav, and the user slot pinned at
// the bottom. Pages render inside <Outlet /> and own no chrome. Room-level
// pages (/room/…) still exist below this nav — Home/Services link into them.
export function AppShell() {
  const location = useLocation();
  const [collapsed, setCollapsed] = useState(
    () => localStorage.getItem('prodmesh.sidebar') === 'rail',
  );
  const [campusId, setCampusId] = useState(
    () => localStorage.getItem('prodmesh.campus') ?? ALL_CAMPUSES,
  );
  const [version, setVersion] = useState('');
  const [identity, setIdentity] = useState<AuthStatus | null>(null);
  const [identityOpen, setIdentityOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const [confirmLock, setConfirmLock] = useState(false);
  const accountRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    getAbout().then((a) => setVersion(a.version)).catch(() => {});
    getAuthStatus().then((s) => {
      setIdentity(s);
      if (!s.station) setIdentityOpen(true);
    }).catch(() => setIdentityOpen(true));
  }, []);

  useEffect(() => {
    if (!accountOpen) return;
    const dismiss = (event: PointerEvent) => {
      if (!accountRef.current?.contains(event.target as Node)) setAccountOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setAccountOpen(false);
    };
    document.addEventListener('pointerdown', dismiss);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('pointerdown', dismiss);
      document.removeEventListener('keydown', escape);
    };
  }, [accountOpen]);

  useEffect(() => {
    const open = () => setIdentityOpen(true);
    const refresh = () => getAuthStatus().then((status) => {
      setIdentity(status);
      if (!status.station) setIdentityOpen(true);
    }).catch(() => {});
    window.addEventListener('prodmesh:auth-required', open);
    window.addEventListener('prodmesh:auth-changed', refresh);
    return () => {
      window.removeEventListener('prodmesh:auth-required', open);
      window.removeEventListener('prodmesh:auth-changed', refresh);
    };
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
    setAccountOpen(false);
    setConfirmLock(false);
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
            {NAV.map(({ to, label, icon: Icon, end }) => {
              const adminActive = label === 'Admin' && location.pathname.startsWith('/admin');
              return (
                <div key={to} className="sidebar__navgroup">
                  <NavLink
                    to={to}
                    end={end}
                    title={label}
                    className={({ isActive }) => `sidebar__item${isActive || adminActive ? ' sidebar__item--active' : ''}`}
                  >
                    <Icon size={19} className="sidebar__icon" />
                    <span className="sidebar__label rail-hide">{label}</span>
                  </NavLink>
                  {adminActive && (
                    <div className="sidebar__subnav rail-hide">
                      {ADMIN_NAV.map(({ to: subTo, label: subLabel, icon: SubIcon }) => (
                        <NavLink key={subTo} to={subTo} className={({ isActive }) => `sidebar__subitem${isActive ? ' sidebar__subitem--active' : ''}`}>
                          <SubIcon size={13} /> {subLabel}
                        </NavLink>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </nav>

          <div className="sidebar__foot">
            <div className="sidebar__clock rail-hide">
              <Clock compact />
            </div>
            <div className="sidebar__account" ref={accountRef}>
              <button
                className="sidebar__user"
                title={identity?.authenticated ? `Account: ${operatorName}` : 'Log in'}
                onClick={identity?.authenticated ? () => setAccountOpen((open) => !open) : () => setIdentityOpen(true)}
              >
                {identity?.user?.avatarUrl ? (
                  <img className="sidebar__avatar" src={identity.user.avatarUrl} alt="" />
                ) : (
                  <CircleUser size={19} className="sidebar__icon" />
                )}
                <div className="sidebar__label rail-hide">
                  <span className="sidebar__username">{operatorName}</span>
                  <span className="sidebar__version">{stationName}{version ? ` · v${version}` : ''}</span>
                </div>
              </button>
              {accountOpen && identity?.authenticated && (
                <div className="accountmenu">
                  <div className="accountmenu__identity">
                    {identity.user?.avatarUrl ? <img src={identity.user.avatarUrl} alt="" /> : <CircleUser size={28} />}
                    <span><strong>{operatorName}</strong><small>@{identity.user?.username} · {stationName}</small></span>
                  </div>
                  <button onClick={() => setConfirmLock(true)}><LockKeyhole size={14} /> Lock station</button>
                </div>
              )}
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
        {confirmLock && (
          <div className="confirm" role="dialog" aria-modal="true" aria-labelledby="lock-title">
            <div className="confirm__card">
              <p className="eyebrow">Shared station</p>
              <p className="confirm__text" id="lock-title">Lock <strong>{stationName}</strong> and return to read-only mode?</p>
              <div className="confirm__buttons">
                <button className="confirm__cancel" onClick={() => setConfirmLock(false)}>Cancel</button>
                <button className="confirm__ok" onClick={lock}>Lock station</button>
              </div>
            </div>
          </div>
        )}
      </div>
    </CampusContext.Provider>
  );
}
