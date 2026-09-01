import { useEffect, useRef, useState } from 'react';
import { getConfig, saveConfig } from '../api';
import type { Church, Tile } from '../types';

// Plumbing the Admin pages share. Split out of Settings.tsx when the room
// configuration page moved to its own file: both need the church draft and
// the feedback line, and a page importing from the page that imports it is a
// cycle that works right up until somebody hoists a constant.

export type Feedback = { kind: 'ok' | 'err'; text: string } | null;
export const ok = (text: string): Feedback => ({ kind: 'ok', text });
export const fail = (err: unknown): Feedback => ({
  kind: 'err',
  text: err instanceof Error ? err.message : String(err),
});

export function Msg({ msg, inline = false }: { msg: Feedback; inline?: boolean }) {
  if (!msg) return null;
  const cls = msg.kind === 'ok' ? 'settings__ok' : 'settings__error';
  return inline ? <span className={cls}>{msg.text}</span> : <p className={cls}>{msg.text}</p>;
}

export const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export const TILE_TYPE_LABELS: Record<Tile['type'], string> = {
  route: 'Room Status link',
  companion: 'Bitfocus Companion',
  screenshare: 'Screen Sharing (Mac)',
  link: 'Web link',
  placeholder: 'Placeholder',
};

export const TILE_ICONS: Array<[string, string]> = [
  ['🎛️', 'Console'],
  ['🎚️', 'Faders'],
  ['💡', 'Lighting'],
  ['🎬', 'Video'],
  ['🎥', 'Camera'],
  ['📷', 'PTZ camera'],
  ['📖', 'ProPresenter'],
  ['⏺️', 'Recorder'],
  ['⏱️', 'Timecode'],
  ['🎧', 'Comms'],
  ['🔊', 'Audio'],
  ['🖥️', 'Computer'],
  ['🌐', 'Network device'],
];

// Shared draft plumbing: both the overview and the room page edit a local
// copy of the whole tree and save it transactionally (PUT /api/config).
export function useChurchDraft() {
  const [draft, setDraft] = useState<Church | null>(null);
  const [baseline, setBaseline] = useState('');
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  // The latest draft, for a save started from a callback whose closure
  // predates the edit it is saving (a dialog's Save).
  const latest = useRef<Church | null>(null);
  latest.current = draft;

  useEffect(() => {
    getConfig().then((c) => {
      setDraft(c);
      setBaseline(JSON.stringify(c));
    }).catch((e) => setErr(e instanceof Error ? e.message : String(e)));
  }, []);

  const update = (fn: (next: Church) => void) => {
    setMsg('');
    setDraft((cur) => {
      const next = structuredClone(cur!);
      fn(next);
      return next;
    });
  };

  /**
   * Save the draft — as it stands, or with `patch` applied to a copy first.
   * The patch form exists for dialogs: `update()` queues a render, and a save
   * fired in the same tick would send the draft as it WAS. Resolves true when
   * it stuck, so a dialog can close on success and stay open on an error.
   */
  const save = async (patch?: (next: Church) => void) => {
    setErr('');
    setBusy(true);
    try {
      let next = latest.current!;
      if (patch) {
        next = structuredClone(next);
        patch(next);
      }
      const stored = await saveConfig(next);
      setDraft(stored);
      setBaseline(JSON.stringify(stored));
      setMsg('Saved.');
      window.dispatchEvent(new Event('prodmesh:config-changed'));
      return true;
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      return false;
    } finally {
      setBusy(false);
    }
  };

  return {
    draft,
    baseline,
    dirty: draft != null && JSON.stringify(draft) !== baseline,
    busy,
    msg,
    err,
    update,
    save,
  };
}

export const moveIn = <T,>(arr: T[], from: number, dir: -1 | 1) => {
  const to = from + dir;
  if (to < 0 || to >= arr.length) return;
  [arr[from], arr[to]] = [arr[to], arr[from]];
};
