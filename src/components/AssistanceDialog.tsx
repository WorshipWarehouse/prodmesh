import { useState } from 'react';
import { BellRing, X } from 'lucide-react';
import { requestAssistance } from '../api';
import { invalidate } from '../lib/useQuery';

// "What's going on?" — an optional note so the team can send the RIGHT
// person (audio problem → audio tech). Styled in the identity dialog's
// language. Sending with no note still works: a panicking volunteer must
// never be blocked on writing prose.
export function AssistanceDialog({ onClose }: { onClose: () => void }) {
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await requestAssistance(message.trim() || undefined);
      invalidate('assistance');
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="identity" role="dialog" aria-modal="true" aria-labelledby="assist-title">
      <div className="identity__card">
        <button className="identity__close" onClick={onClose} aria-label="Close">
          <X size={17} />
        </button>
        <div className="identity__mark">
          <BellRing size={22} />
        </div>
        <p className="eyebrow">Request assistance</p>
        <h2 id="assist-title">What’s going on?</h2>
        <p className="identity__hint">
          A quick note helps send the right person. The tech team is notified either way.
        </p>
        <label className="identity__field">
          <span>Problem (optional)</span>
          <textarea
            className="field assistdlg__msg"
            rows={3}
            maxLength={300}
            autoFocus
            placeholder="e.g. No sound from the pulpit mic"
            value={message}
            onChange={(e) => setMessage(e.target.value)}
          />
        </label>
        <button className="btn btn--primary identity__submit" disabled={busy} onClick={submit}>
          {busy ? 'Notifying…' : 'Notify the tech team'}
        </button>
        {error && <p className="identity__error">{error}</p>}
      </div>
    </div>
  );
}
