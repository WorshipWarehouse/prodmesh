import { useEffect, useState } from 'react';
import { ChevronDown, ChevronRight, Play, Radio, Square } from 'lucide-react';
import {
  clearShowConfig,
  getPpPlaylist,
  getYouTubeBroadcasts,
  saveShowConfig,
  type PlanItem,
  type PlanTime,
  type PpPlaylist,
  type ShowConfig,
  type YouTubeBroadcast,
} from '../api';
import { Widget } from './Widget';
import { SelectField } from './SelectField';

// Pre-created broadcasts usually share a title ("Sunday Service"), so the
// scheduled time is what actually tells them apart — show it always.
function broadcastLabel(b: YouTubeBroadcast) {
  const when = b.actualStart ?? b.scheduledStart;
  const stamp = when
    ? new Date(when).toLocaleString([], {
        month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
      })
    : 'no date';
  return `${b.live ? '● LIVE · ' : ''}${stamp} · ${b.title}`;
}

const EMPTY: ShowConfig = { startItemId: null, endItemId: null, map: {}, videos: {} };

// Per-event show automation (one config per event, shared by all its service
// times): which PC item autostarts the show, which one auto-completes it at
// its last slide, and manual PC→PP mapping overrides for when the orders
// drift apart.
export function ShowConfigWidget({
  roomId,
  planId,
  items,
  times,
  saved,
}: {
  roomId: string;
  planId: string;
  items: PlanItem[];
  times: PlanTime[];
  saved: ShowConfig | null;
}) {
  const [draft, setDraft] = useState<ShowConfig>(saved ?? EMPTY);
  const [persisted, setPersisted] = useState<ShowConfig | null>(saved); // what the server has
  const [pp, setPp] = useState<PpPlaylist | null | undefined>(undefined); // undefined = loading
  const [mapOpen, setMapOpen] = useState(false);
  const [ytOpen, setYtOpen] = useState(false);
  const [casts, setCasts] = useState<YouTubeBroadcast[] | null | undefined>(undefined);
  const [castErr, setCastErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    getPpPlaylist(roomId, planId)
      .then((r) => setPp(r.playlist))
      .catch(() => setPp(null));
  }, [roomId, planId]);

  useEffect(() => {
    // Only when the section is opened — the listing costs ~201 YouTube quota
    // units, which is fine for a deliberate action and wasteful on every page
    // view of an event nobody is pinning.
    if (!ytOpen || casts !== undefined) return;
    getYouTubeBroadcasts(roomId)
      .then((r) => {
        setCasts(r.configured ? r.broadcasts : null);
        setCastErr(r.error ?? null);
      })
      .catch((e) => {
        setCasts([]);
        setCastErr(e instanceof Error ? e.message : String(e));
      });
  }, [ytOpen, casts, roomId]);

  const trackable = items.filter((i) => (i.type ?? 'item') !== 'header');
  const serviceTimes = times.filter((t) => t.type === 'service');
  const pinCount = Object.keys(draft.videos ?? {}).length;
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
    <SelectField
      className="showcfg__select"
      value={value ?? ''}
      onChange={(e) => onChange(e.target.value || null)}
    >
      <option value="">{placeholder}</option>
      {trackable.map((i) => (
        <option key={i.id} value={i.id}>
          {i.title}
        </option>
      ))}
    </SelectField>
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

      {serviceTimes.length > 0 && (
        <>
          <button className="showcfg__maptoggle" onClick={() => setYtOpen((o) => !o)}>
            {ytOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
            YouTube broadcast
            {pinCount > 0 && (
              <span className="showcfg__mapcount">{pinCount} pinned</span>
            )}
          </button>

          {ytOpen && (
            casts === undefined ? (
              <p className="svc__muted">Loading broadcasts…</p>
            ) : casts === null ? (
              <p className="svc__muted">
                This room has no YouTube channel set — add one on the room’s configuration page.
              </p>
            ) : (
              <div className="showcfg__map">
                <p className="widget__hint">
                  Each service records whichever broadcast is live at the time, which is normally
                  right even when the channel pre-creates one per service. Pin a specific broadcast
                  only to override that.
                </p>
                {castErr && <p className="showcfg__mismatch">Couldn’t list broadcasts: {castErr}</p>}
                {serviceTimes.map((t) => (
                  <div key={t.id} className="showcfg__row">
                    <span className="showcfg__label">
                      <Radio size={12} /> {t.name}
                      {t.startsAt && (
                        <span className="showcfg__when">
                          {new Date(t.startsAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
                        </span>
                      )}
                    </span>
                    <SelectField
                      className="showcfg__select"
                      value={draft.videos?.[t.id] ?? ''}
                      onChange={(e) => {
                        const v = e.target.value;
                        setDraft((d) => {
                          const videos = { ...(d.videos ?? {}) };
                          if (v) videos[t.id] = v;
                          else delete videos[t.id];
                          return { ...d, videos };
                        });
                      }}
                    >
                      <option value="">Auto — whatever is live</option>
                      {casts.map((b) => (
                        <option key={b.videoId} value={b.videoId}>
                          {broadcastLabel(b)}
                        </option>
                      ))}
                      {/* A pin whose broadcast has since left the live/scheduled
                          list must stay selectable, or saving would silently
                          drop it. */}
                      {draft.videos?.[t.id] && !casts.some((b) => b.videoId === draft.videos[t.id]) && (
                        <option value={draft.videos[t.id]}>{draft.videos[t.id]} (not listed)</option>
                      )}
                    </SelectField>
                  </div>
                ))}
              </div>
            )
          )}
        </>
      )}

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
            {pp.matched ? (
              <p className="widget__hint">
                Mapping against this event’s playlist (“{pp.playlistName}”). Items map
                automatically by order — override only the ones that drifted.
              </p>
            ) : (
              <p className="showcfg__mismatch">
                Couldn’t find this event’s playlist in ProPresenter — showing the open one
                (“{pp.playlistName}”), which looks like a <em>different</em> service. Push this
                plan from Planning Center first, or map with care.
              </p>
            )}
            {trackable.map((it) => (
              <div key={it.id} className="showcfg__maprow">
                <span className="showcfg__pcitem">{it.title}</span>
                <SelectField
                  className="showcfg__select"
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
                </SelectField>
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
