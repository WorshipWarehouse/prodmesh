import { MessagesSquare } from 'lucide-react';
import { useTopic, roomTopic } from '../lib/stream';
import type { RoomCaptions } from '../api';
import type { WidgetProps } from './types';

// What the music director and monitor engineer are saying to the band.
//
// The readers are on stage with in-ears in, which is why this exists at all:
// the transcript is the only way the message arrives. It is also read from a
// booth desk, so ONE widget serves both and its density follows its size —
// see captions.css. Two columns is a bare transcript; three earns a speaker
// rail down the side.
//
// Newest at the BOTTOM, the way every messaging app has trained everyone to
// read. That is `column-reverse` on a scrollable list: the browser pins itself
// to the newest line for free and older ones scroll up, with no auto-scroll
// code to fight somebody who has deliberately scrolled back.

/** A speaker is talking iff they have an unfinished line right now.
 *
 *  Derived rather than subscribed. ProdMesh Caption does publish a `speech`
 *  event, but it is opt-in through the `events` list and sending that list at
 *  all silences the heartbeat (see INTEGRATION-NOTES) — trading the health
 *  check for a glow is a bad bargain. This costs nothing, clears itself
 *  because the engine finalises on silence, and works on ProdCom too, which
 *  has no speech event at all. */
const talking = (c: RoomCaptions, ch: string) =>
  c.up && c.lines.some((l) => l.ch === ch && l.live);

export function CaptionsWidget({ roomId }: WidgetProps) {
  const captions = useTopic<RoomCaptions>(roomTopic.captions(roomId));

  // No caption source configured publishes nothing at all — the room simply
  // has no such app, and a permanent "not configured" panel on a stage screen
  // is worse than an empty cell.
  if (!captions) return null;

  const byCh = new Map(captions.channels.map((c) => [c.ch, c]));
  const colorOf = (ch: string) => byCh.get(ch)?.color ?? null;
  const nameOf = (ch: string, fallback?: string | null) =>
    byCh.get(ch)?.name ?? fallback ?? `Channel ${ch}`;

  return (
    <div className="wgt wgt--captions">
      <div className="wgt__head">
        <span className="wgt__icon"><MessagesSquare size={16} /></span>
        <span className="wgt__title">Comms</span>
        {!captions.up && (
          <span className="wgt__status wgt__status--down">Not connected</span>
        )}
      </div>

      <div className="cap">
        <ul className="cap__lines">
          {/* Reversed in the DOM because the list renders column-reverse: the
              newest line is first here and lowest on screen. Grouping is
              computed BEFORE reversing, so "first of a run" means first in
              time rather than first on screen. */}
          {captions.lines
            .map((l, i, all) => ({ l, opens: i === 0 || all[i - 1].ch !== l.ch }))
            .reverse()
            .map(({ l, opens }) => (
              <li
                key={l.id}
                className={`cap__line${l.live ? ' cap__line--live' : ''}${opens ? ' cap__line--opens' : ''}`}
                style={colorOf(l.ch) ? ({ '--ch': colorOf(l.ch)! } as React.CSSProperties) : undefined}
              >
                {/* One speaker talking for a minute should not print their name
                    twenty times; the rule stays on so a CHANGE of speaker is
                    what catches the eye. The name is still announced for every
                    line, because a screen reader has no column to look up. */}
                <span className={`cap__who${opens ? '' : ' sr-only'}`}>
                  {nameOf(l.ch, l.name)}
                </span>
                <span className="cap__text">{l.text}</span>
              </li>
            ))}
        </ul>

        {/* Hidden by CSS until there is room for it. Rendered regardless so a
            resize needs no re-fetch and a screen reader always has the roster. */}
        {captions.channels.length > 0 && (
          <ul className="cap__rail">
            {captions.channels.map((c) => {
              const live = talking(captions, c.ch);
              return (
                <li
                  key={c.ch}
                  className={`cap__ch${live ? ' cap__ch--live' : ''}`}
                  style={c.color ? ({ '--ch': c.color } as React.CSSProperties) : undefined}
                >
                  <span className="cap__dot" aria-hidden />
                  <span className="cap__name">{c.name}</span>
                  {/* Never colour alone: the glow says "talking" to anyone who
                      can see it, and this says it to everyone else. */}
                  {live && <span className="sr-only">— speaking</span>}
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {captions.up && captions.lines.length === 0 && (
        <p className="wgt__detail">Listening…</p>
      )}
    </div>
  );
}
