import { ExternalLink, WifiOff } from 'lucide-react';
import { getRoomConnectivity } from '../api';
import { EMBED_ALLOW, EMBED_SANDBOX } from '../lib/embed';
import { companionEmulatorUrl } from '../lib/companion';
import { useQuery } from '../lib/useQuery';

/**
 * A room-scoped view of Companion's own emulator. The iframe is purposeful:
 * Companion owns button rendering and its websocket feedback protocol, so the
 * exact same live surface works here, in the dashboard, and on a Stream Deck
 * emulator without recreating buttons or actions in ProdMesh.
 */
export function CompanionSurface({ roomId, className = '' }: { roomId: string; className?: string }) {
  const connection = useQuery(`room-connectivity:${roomId}`, () => getRoomConnectivity(roomId), { staleMs: 15_000 }).data?.companion;
  const url = companionEmulatorUrl(connection?.host, connection?.port, connection?.emulator);

  if (!connection || connection.mock || !url) {
    return (
      <div className={`companion-surface companion-surface--empty ${className}`.trim()}>
        <WifiOff size={18} aria-hidden />
        <span>Companion emulator is not configured for this room.</span>
      </div>
    );
  }

  return (
    <div className={`companion-surface ${className}`.trim()}>
      <div className="companion-surface__bar">
        <span>Emulator: {connection.emulator || 'main'}</span>
        <a href={url.href} target="_blank" rel="noopener noreferrer">
          Open in Companion <ExternalLink size={13} aria-hidden />
        </a>
      </div>
      <iframe
        className="companion-surface__frame"
        title={`Bitfocus Companion for ${roomId}`}
        src={url.href}
        sandbox={EMBED_SANDBOX}
        allow={EMBED_ALLOW}
      />
    </div>
  );
}
