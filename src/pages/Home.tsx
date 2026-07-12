import { useEffect, useState } from 'react';
import { getRooms, type RoomMeta } from '../api';
import { church } from '../config/dashboard.config';
import { inCampus, useCampus, ALL_CAMPUSES } from '../layout/campus';
import { RoomCard } from '../components/RoomCard';
import { SiteSection } from '../components/SiteSection';
import { ChevronDown, Network } from 'lucide-react';

// Campus overview: every room as a live status card, then the Quick Access
// launcher (Companion / Screen Sharing / device UIs) for the same campus.
export function Home() {
  const { campusId } = useCampus();
  const [rooms, setRooms] = useState<RoomMeta[]>([]);

  useEffect(() => {
    getRooms().then(setRooms).catch(() => {});
  }, []);

  const visibleRooms = rooms.filter((r) => inCampus(campusId, r.site));
  const visibleSites = church.sites.filter(
    (s) => campusId === ALL_CAMPUSES || s.id === campusId,
  );
  const campusName =
    campusId === ALL_CAMPUSES
      ? 'All campuses'
      : church.sites.find((s) => s.id === campusId)?.name ?? campusId;

  return (
    <div className="home">
      <div className="pagehead">
        <div>
          <p className="eyebrow">Operations overview</p>
          <h1 className="pagehead__title">Home</h1>
          <p className="pagehead__sub">{campusName} · current room state and next activity</p>
        </div>
      </div>

      <section className="home__overview" aria-labelledby="rooms-heading">
        <div className="home__section-head">
          <div>
            <p className="section-label">Room network</p>
            <h2 id="rooms-heading">Live room status</h2>
          </div>
          <span className="home__room-count mono">{visibleRooms.length.toString().padStart(2, '0')} ROOMS</span>
        </div>
        <div className="home__rooms">
          {visibleRooms.map((r) => (
            <RoomCard key={r.id} room={r} />
          ))}
          {rooms.length > 0 && visibleRooms.length === 0 && (
            <p className="svc__muted">No rooms at this campus yet.</p>
          )}
        </div>
      </section>

      <details className="home__tools">
        <summary className="home__tools-summary">
          <span className="home__tools-icon"><Network size={17} /></span>
          <span>
            <strong>Infrastructure &amp; quick access</strong>
            <small>Companion, screen sharing, and device interfaces</small>
          </span>
          <ChevronDown className="home__tools-chevron" size={17} />
        </summary>
        <div className="home__tools-body">
          {visibleSites.map((site) => (
            <SiteSection key={site.id} site={site} />
          ))}
        </div>
      </details>
    </div>
  );
}
