import { Routes, Route } from 'react-router-dom';
import { AppShell } from './layout/AppShell';
import { QuickAccess } from './pages/QuickAccess';
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
        <Route path="/" element={<QuickAccess />} />
        <Route path="/room/:roomId" element={<RoomStatus />} />
        <Route path="/room/:roomId/event/:planId" element={<EventDetail />} />
        <Route path="/room/:roomId/show" element={<RoomShowRedirect />} />
        <Route path="/room/:roomId/run/:planId" element={<RunOfShow />} />
        <Route path="/room/:roomId/run/:planId/report" element={<ServiceReport />} />
        <Route path="/settings" element={<Settings />} />
      </Route>
    </Routes>
  );
}
