import { Routes, Route } from 'react-router-dom';
import { QuickAccess } from './pages/QuickAccess';
import { RoomStatus } from './pages/RoomStatus';
import { Settings } from './pages/Settings';
import './App.css';

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<QuickAccess />} />
      <Route path="/room/:roomId" element={<RoomStatus />} />
      <Route path="/settings" element={<Settings />} />
    </Routes>
  );
}
