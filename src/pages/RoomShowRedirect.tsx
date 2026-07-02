import { useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { getShow, getRoomService } from '../api';

// Target of the "Run of Show" tab: resolves to the active show if one is
// running, else the next upcoming service, else back to the room page.
export function RoomShowRedirect() {
  const { roomId = '' } = useParams();
  const navigate = useNavigate();

  useEffect(() => {
    let on = true;
    const go = (to: string) => on && navigate(to, { replace: true });
    (async () => {
      try {
        const show = await getShow(roomId);
        if (show.active && show.planId) {
          return go(`/room/${roomId}/run/${show.planId}?time=${show.timeId ?? 'default'}`);
        }
      } catch {
        /* fall through to the next plan */
      }
      try {
        const svc = await getRoomService(roomId);
        const plan = svc.plans[0];
        if (plan) {
          const t = plan.times.find((x) => x.type === 'service') ?? plan.times[0];
          return go(`/room/${roomId}/run/${plan.id}${t ? `?time=${t.id}` : ''}`);
        }
      } catch {
        /* no service info either */
      }
      go(`/room/${roomId}`);
    })();
    return () => {
      on = false;
    };
  }, [roomId, navigate]);

  return <div className="pagemsg">Finding the next service…</div>;
}
