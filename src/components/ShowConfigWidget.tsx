import { useEffect, useState } from 'react';
import { ChevronDown, ChevronRight, Play, Square } from 'lucide-react';
import {
  clearShowConfig,
  getPpPlaylist,
  saveShowConfig,
  type PlanItem,
  type PpPlaylist,
  type ShowConfig,
} from '../api';
import { Widget } from './Widget';

const EMPTY: ShowConfig = { startItemId: null, endItemId: null, map: {} };

// Per-event show automation (one config per event, shared by all its service
// times): which PC item autostarts the show, which one auto-completes it at
// its last slide, and manual PC→PP mapping overrides for when the orders
// drift apart.
export function ShowConfigWidget({
  roomId,
  planId,
  items,
  saved,
}: {
  roomId: string;
  planId: string;
  items: PlanItem[];
  saved: ShowConfig | null;
}) {
  const [draft, setDraft] = useState<ShowConfig>(saved ?? EMPTY);
  const [persisted, setPersisted] = useState<ShowConfig | null>(saved); // what the server has
  const [pp, setPp] = useState<PpPlaylist | null | undefined>(undefined); // undefined = loading
  const [mapOpen, setMapOpen] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    getPpPlaylist(roomId)
      .then((r) => setPp(r.playlist))
      .catch(() => setPp(null));
  }, [roomId]);

  const trackable = items.filter((i) => (i.type ?? 'item') !== 'header');
  const ppItems = (pp?.items ?? []).filter((i) => i.type !== 'header');
  const overrideCount = Object.values(draft.map).filter(Boolean).length;

  const save = async () => {
    setMsg(null);
    try {
      const next = await saveShowConfig(roomId, planId, draft);
      setDraft(next);
      setPersisted(next);
      setMsg('Saved — automation is armed for this event.');
    } catch (err) {
      setMsg(`Couldn’t save: ${err instanceof Error ? err.message : err}`);
    }
  };

  const clear = async () => {
    await clearShowConfig(roomId, planId);
    setDraft(EMPTY);
    setPersisted(null);
    setMsg('Cleared — this event starts and ends manually.');
  };

  const itemSelect = (
    value: string | null,
    onChange: (v: string | null) => void,
    placeholder: string,
  ) => (
    <select
      className="field field--sm showcfg__select"
      value={value ?? ''}
      onChange={(e) => onChange(e.target.value || null)}
    >
      <option value="">{placeholder}</option>
      {trackable.map((i) => (
        <option key={i.id} value={i.id}>
          {i.title}
        </option>
      ))}
    </select>
  );

  return (
    <Widget
      title="Show Automation"
      meta={
        persisted?.startItemId || persisted?.endItemId ? (
          <span className="svc__badge svc__badge--live">● armed</span>
        ) : (
          <span className="svc__badge svc__badge--mock">○ manual</span>
        )
      }
    >
      <p className="widget__hint">
        The show follows the ProPresenter operator — pre-service slides can loop between services
        without tripping anything. Applies to every service time of this event.
      </p>

      <div className="showcfg__row">
        <span className="showcfg__label">
          <Play size={13} /> Start when PP lands on
        </span>
        {itemSelect(draft.startItemId, (v) => setDraft((d) => ({ ...d, startItemId: v })), 'Never (start manually)')}
      </div>

      <div className="showcfg__row">
        <span className="showcfg__label">
          <Square size={12} /> Complete at last slide of
        </span>
        {itemSelect(draft.endItemId, (v) => setDraft((d) => ({ ...d, endItemId: v })), 'Never (end manually)')}
      </div>

      <button className="showcfg__maptoggle" onClick={() => setMapOpen((o) => !o)}>
        {mapOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        ProPresenter mapping
        {overrideCount > 0 && <span className="showcfg__mapcount">{overrideCount} override{overrideCount > 1 ? 's' : ''}</span>}
      </button>

      {mapOpen &&
        (pp === undefined ? (
          <p className="svc__muted">Checking ProPresenter…</p>
        ) : pp === null ? (
          <p className="svc__muted">
            ProPresenter isn’t reachable (or has no playlist open). Open this service’s playlist in
            PP, then reload to map items.
          </p>
        ) : (
          <div className="showcfg__map">
            <p className="widget__hint">
              Items map automatically by playlist order (“{pp.playlistName}”). Override only the
              ones that drifted.
            </p>
            {trackable.map((it) => (
              <div key={it.id} className="showcfg__maprow">
                <span className="showcfg__pcitem">{it.title}</span>
                <select
                  className="field field--sm showcfg__select"
                  value={draft.map[it.id]?.ppIndex ?? ''}
                  onChange={(e) =>
                    setDraft((d) => ({
                      ...d,
                      map: {
                        ...d.map,
                        [it.id]: e.target.value
                          ? {
                              ppIndex: Number(e.target.value),
                              ppName: ppItems.find((p) => p.index === Number(e.target.value))?.name ?? null,
                            }
                          : null,
                      },
                    }))
                  }
                >
                  <option value="">Auto</option>
                  {ppItems.map((p) => (
                    <option key={p.index} value={p.index}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </div>
            ))}
          </div>
        ))}

      <div className="showcfg__actions">
        <button className="btn btn--primary btn--sm" onClick={save}>
          Save automation
        </button>
        {(persisted?.startItemId || persisted?.endItemId || overrideCount > 0) && (
          <button className="btn btn--ghost btn--sm" onClick={clear}>
            Clear
          </button>
        )}
      </div>
      {msg && <p className="showcfg__msg">{msg}</p>}
    </Widget>
  );
}
