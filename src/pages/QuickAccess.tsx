import { church } from '../config/dashboard.config';
import { SiteSection } from '../components/SiteSection';
import { Clock } from '../components/Clock';
import logoUrl from '../assets/logo.png';

export function QuickAccess() {
  return (
    <div className="app">
      <header className="app__header">
        <div className="app__brand">
          <img className="app__logo" src={logoUrl} alt="" />
          <div>
            <h1 className="app__title">{church.name}</h1>
            <p className="app__subtitle">Quick Access</p>
          </div>
        </div>
        <Clock />
      </header>

      <main className="app__sites">
        {church.sites.map((site) => (
          <SiteSection key={site.id} site={site} />
        ))}
      </main>

      <footer className="app__footer">
        Production launcher · edit{' '}
        <code>src/config/dashboard.config.ts</code> to add machines &amp; tools
      </footer>
    </div>
  );
}
