import { useEffect, useState } from 'react';

export function Clock({ compact = false }: { compact?: boolean }) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);
  const time = now.toLocaleTimeString([], {
    hour: 'numeric',
    minute: '2-digit',
    second: '2-digit',
  });
  const date = now.toLocaleDateString([], {
    weekday: compact ? 'short' : 'long',
    month: compact ? 'short' : 'long',
    day: 'numeric',
  });
  return (
    <div className={`clock${compact ? ' clock--compact' : ''}`}>
      <span className="clock__time">{time}</span>
      <span className="clock__date">{date}</span>
    </div>
  );
}
