import { Routes, Route } from 'react-router-dom';
import { QuickAccess } from './pages/QuickAccess';
import { RoomStatus } from './pages/RoomStatus';
import './App.css';

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<QuickAccess />} />
      <Route path="/room/:roomId" element={<RoomStatus />} />
    </Routes>
  );
}
