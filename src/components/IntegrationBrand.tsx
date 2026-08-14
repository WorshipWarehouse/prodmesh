import type { ReactNode } from 'react';
import proPresenterLogo from '../assets/integrations/propresenter.png';
import planningCenterLogo from '../assets/integrations/planning-center.png';
import slackLogo from '../assets/integrations/slack.png';
import youTubeLogo from '../assets/integrations/youtube.png';
import restreamLogo from '../assets/integrations/restream.png';
import companionLogo from '../assets/integrations/companion.png';

/** The integrations shown in Settings and in the widget picker. Keeping their
 * identity here means a widget and its configuration card always use the same
 * label, colour and compact brand mark. */
export type IntegrationId =
  | 'prodmesh' | 'propresenter' | 'planning-center' | 'restream'
  | 'youtube' | 'slack' | 'companion' | 'analysis' | 'captions';

export const integrationInfo: Record<IntegrationId, { name: string; mark: string; logo?: string }> = {
  prodmesh: { name: 'ProdMesh', mark: 'PM' },
  propresenter: { name: 'ProPresenter', mark: 'P', logo: proPresenterLogo },
  'planning-center': { name: 'Planning Center', mark: 'PC', logo: planningCenterLogo },
  restream: { name: 'Restream', mark: 'R', logo: restreamLogo },
  youtube: { name: 'YouTube', mark: '▶', logo: youTubeLogo },
  slack: { name: 'Slack', mark: 'S', logo: slackLogo },
  companion: { name: 'Bitfocus Companion', mark: 'C', logo: companionLogo },
  analysis: { name: 'Audio analysis', mark: 'A' },
  captions: { name: 'Captions', mark: 'CC' },
};

export function IntegrationBrand({ integration, label = false }: { integration: IntegrationId; label?: boolean }) {
  const info = integrationInfo[integration];
  return (
    <span className={`integration-brand integration-brand--${integration}`} title={info.name}>
      <span className="integration-brand__mark" aria-hidden>
        {info.logo ? <img src={info.logo} alt="" /> : info.mark}
      </span>
      {label && <span className="integration-brand__label">{info.name}</span>}
    </span>
  );
}

export function IntegrationTitle({ integration, children }: { integration: IntegrationId; children: ReactNode }) {
  return <span className="integration-title"><IntegrationBrand integration={integration} />{children}</span>;
}
