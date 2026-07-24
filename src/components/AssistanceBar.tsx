import { useState } from 'react';
import { BellRing, CheckCircle2 } from 'lucide-react';
import { dismissAssistance, getAssistance } from '../api';
import { useQuery, invalidate } from '../lib/useQuery';

// The reminder that this station has called for help. Dismiss is pressed by
// the requester OR by whoever responds (they're standing at this screen) —
// it ✅s the original Slack message so the channel reads open/closed.
export function AssistanceBar({ enabled }: { enabled: boolean }) {
  const [busy, setBusy] = useState(false);
  const state = useQuery(enabled ? 'assistance' : null, getAssistance, {
    pollMs: 15_000,
    staleMs: 5_000,
  });
  if (!state.data?.active) return null;

  const at = state.data.requestedAt
    ? new Date(state.data.requestedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
    : null;

  const dismiss = async () => {
    setBusy(true);
    try {
      await dismissAssistance();
      invalidate('assistance');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="assistbar" role="status">
      <span className="assistbar__pulse">
        <BellRing size={15} />
      </span>
      <span className="assistbar__text">
        <strong>Assistance requested</strong>
        {at ? ` at ${at}` : ''} — the tech team has been notified. Sit tight, help is on the way.
      </span>
      <button className="btn btn--sm assistbar__dismiss" onClick={dismiss} disabled={busy}>
        <CheckCircle2 size={14} /> {busy ? 'Dismissing…' : 'Dismiss'}
      </button>
    </div>
  );
}
