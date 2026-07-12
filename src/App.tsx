import { Routes, Route, Navigate } from 'react-router-dom';
import { AppShell } from './layout/AppShell';
import { Home } from './pages/Home';
import { Services } from './pages/Services';
import { Analytics } from './pages/Analytics';
import { RoomStatus } from './pages/RoomStatus';
import { EventDetail } from './pages/EventDetail';
import { RoomShowRedirect } from './pages/RoomShowRedirect';
import { RunOfShow } from './pages/RunOfShow';
import { ServiceReport } from './pages/ServiceReport';
import { Settings } from './pages/Settings';
import './styles/index.css';

export default function App() {
  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route path="/" element={<Home />} />
        <Route path="/services" element={<Services />} />
        <Route path="/analytics" element={<Analytics />} />
        <Route path="/admin" element={<Navigate to="/admin/general" replace />} />
        <Route path="/admin/general" element={<Settings section="general" />} />
        <Route path="/admin/users" element={<Settings section="users" />} />
        <Route path="/admin/checklists" element={<Settings section="checklists" />} />
        {/* Room-level pages, reached from Home cards / Services rows.
            Room-Mac homepages point at /room/:id — these paths are stable. */}
        <Route path="/room/:roomId" element={<RoomStatus />} />
        <Route path="/room/:roomId/event/:planId" element={<EventDetail />} />
        <Route path="/room/:roomId/show" element={<RoomShowRedirect />} />
        <Route path="/room/:roomId/run/:planId" element={<RunOfShow />} />
        <Route path="/room/:roomId/run/:planId/report" element={<ServiceReport />} />
        {/* Old bookmark */}
        <Route path="/settings" element={<Navigate to="/admin/general" replace />} />
      </Route>
    </Routes>
  );
}
