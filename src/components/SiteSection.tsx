import type { Site } from '../types';
import { AuditoriumCard } from './AuditoriumCard';

export function SiteSection({ site }: { site: Site }) {
  return (
    <section className={`site site--${site.status}`}>
      <header className="site__header">
        <h2 className="site__name">{site.name}</h2>
        {site.status === 'disabled' && (
          <span className="site__badge">DISABLED</span>
        )}
      </header>
      <div className="site__auditoriums">
        {site.auditoriums.map((auditorium) => (
          <AuditoriumCard key={auditorium.id} auditorium={auditorium} />
        ))}
      </div>
    </section>
  );
}
