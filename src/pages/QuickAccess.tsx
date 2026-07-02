import { church } from '../config/dashboard.config';
import { SiteSection } from '../components/SiteSection';
import { ServicesOverview } from '../components/ServicesOverview';

export function QuickAccess() {
  return (
    <div className="launcher">
      <ServicesOverview />
      {church.sites.map((site) => (
        <SiteSection key={site.id} site={site} />
      ))}
      <footer className="launcher__footer">
        Production launcher · edit{' '}
        <code>src/config/dashboard.config.ts</code> to add machines &amp; tools
      </footer>
    </div>
  );
}
