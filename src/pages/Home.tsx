import { useEffect, useState } from 'react';
import { getRooms, type RoomMeta } from '../api';
import { church } from '../config/dashboard.config';
import { inCampus, useCampus, ALL_CAMPUSES } from '../layout/campus';
import { RoomCard } from '../components/RoomCard';
import { SiteSection } from '../components/SiteSection';

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
          <h1 className="pagehead__title">Home</h1>
          <p className="pagehead__sub">{campusName} · rooms at a glance</p>
        </div>
      </div>

      <section className="home__rooms">
        {visibleRooms.map((r) => (
          <RoomCard key={r.id} room={r} />
        ))}
        {rooms.length > 0 && visibleRooms.length === 0 && (
          <p className="svc__muted">No rooms at this campus yet.</p>
        )}
      </section>

      <section className="home__tools">
        <h2 className="home__tools-title">Quick Access</h2>
        {visibleSites.map((site) => (
          <SiteSection key={site.id} site={site} />
        ))}
      </section>
    </div>
  );
}
