import type { ReactNode } from 'react';

/** The integrations shown in Settings and in the widget picker. Keeping their
 * identity here means a widget and its configuration card always use the same
 * label, colour and compact brand mark. */
export type IntegrationId =
  | 'prodmesh' | 'propresenter' | 'planning-center' | 'restream'
  | 'youtube' | 'slack' | 'companion' | 'analysis' | 'captions';

export const integrationInfo: Record<IntegrationId, { name: string; mark: string }> = {
  prodmesh: { name: 'ProdMesh', mark: 'PM' },
  propresenter: { name: 'ProPresenter', mark: 'P' },
  'planning-center': { name: 'Planning Center', mark: 'PC' },
  restream: { name: 'Restream', mark: 'R' },
  youtube: { name: 'YouTube', mark: '▶' },
  slack: { name: 'Slack', mark: 'S' },
  companion: { name: 'Bitfocus Companion', mark: 'C' },
  analysis: { name: 'Audio analysis', mark: 'A' },
  captions: { name: 'Captions', mark: 'CC' },
};

export function IntegrationBrand({ integration, label = false }: { integration: IntegrationId; label?: boolean }) {
  const info = integrationInfo[integration];
  return (
    <span className={`integration-brand integration-brand--${integration}`} title={info.name}>
      <span className="integration-brand__mark" aria-hidden>{info.mark}</span>
      {label && <span className="integration-brand__label">{info.name}</span>}
    </span>
  );
}

export function IntegrationTitle({ integration, children }: { integration: IntegrationId; children: ReactNode }) {
  return <span className="integration-title"><IntegrationBrand integration={integration} />{children}</span>;
}
