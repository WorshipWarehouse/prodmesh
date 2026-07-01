import { Routes, Route } from 'react-router-dom';
import { QuickAccess } from './pages/QuickAccess';
import { RoomStatus } from './pages/RoomStatus';
import { RunOfShow } from './pages/RunOfShow';
import { ServiceReport } from './pages/ServiceReport';
import { Settings } from './pages/Settings';
import './App.css';

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<QuickAccess />} />
      <Route path="/room/:roomId" element={<RoomStatus />} />
      <Route path="/room/:roomId/run/:planId" element={<RunOfShow />} />
      <Route path="/room/:roomId/run/:planId/report" element={<ServiceReport />} />
      <Route path="/settings" element={<Settings />} />
    </Routes>
  );
}
