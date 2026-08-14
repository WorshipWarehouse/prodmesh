import type { CaptionsConfig } from '../api';
import type { IntegrationId } from '../components/IntegrationBrand';

type CaptionSource = CaptionsConfig['source'] | null | undefined;

/** The captions widget represents the app actually feeding its transcript. */
export function captionIntegration(source: CaptionSource): IntegrationId {
  return source === 'prodcom' ? 'prodcom' : 'prodmesh';
}

/** A source-specific title makes the widget unambiguous on a busy dashboard. */
export function captionWidgetTitle(source: CaptionSource): string {
  if (source === 'prodmesh-caption') return 'ProdMesh Captions';
  if (source === 'prodcom') return 'ProdCom';
  return 'Captions';
}
