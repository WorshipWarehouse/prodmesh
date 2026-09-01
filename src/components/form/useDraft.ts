import { useEffect, useRef, useState } from 'react';

// How many mounted drafts have unsaved edits. The app uses a plain
// <BrowserRouter>, so there is no route blocker to hook into — while any
// draft is dirty we warn before the tab unloads instead.
let dirtyDrafts = 0;
const warnUnload = (e: BeforeUnloadEvent) => {
  e.preventDefault();
  e.returnValue = '';
};

// What EditorSection needs from a useDraft instance.
export interface DraftForm {
  dirty: boolean;
  busy: boolean;
  err: string;
  savedFlash: boolean;
  /** Resolves true when the save stuck — a dialog closes on that, and stays
   *  open with the error otherwise. */
  submit: () => Promise<boolean>;
}

// The draft/dirty/save state machine every connectivity editor shares:
// - draft starts from `initial`; dirty compares it (JSON) to the baseline
// - submit() runs `save`, which sends the payload and returns the next draft
//   from the server response (the round-trip keeps normalized values)
// - savedFlash shows success and clears itself after ~2.5s
export function useDraft<T extends object>(initial: T, save: (draft: T) => Promise<T>) {
  const [draft, setDraft] = useState(initial);
  const [baseline, setBaseline] = useState(() => JSON.stringify(initial));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [savedFlash, setSavedFlash] = useState(false);
  const flashTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const dirty = JSON.stringify(draft) !== baseline;

  useEffect(() => () => clearTimeout(flashTimer.current), []);

  useEffect(() => {
    if (!dirty) return;
    dirtyDrafts += 1;
    if (dirtyDrafts === 1) window.addEventListener('beforeunload', warnUnload);
    return () => {
      dirtyDrafts -= 1;
      if (dirtyDrafts === 0) window.removeEventListener('beforeunload', warnUnload);
    };
  }, [dirty]);

  const patch = (p: Partial<T>) => setDraft((d) => ({ ...d, ...p } as T));

  /** Throw the edits away and go back to what is stored. The baseline is the
   *  only copy of that, which is why this belongs here rather than in callers
   *  keeping a second one that can drift after a save. */
  const reset = () => { setDraft(JSON.parse(baseline) as T); setErr(''); };

  const submit = async () => {
    setErr(''); setSavedFlash(false); setBusy(true);
    try {
      const stored = await save(draft);
      setDraft(stored);
      setBaseline(JSON.stringify(stored));
      setSavedFlash(true);
      clearTimeout(flashTimer.current);
      flashTimer.current = setTimeout(() => setSavedFlash(false), 2500);
      return true;
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      return false;
    } finally { setBusy(false); }
  };

  return { draft, setDraft, patch, reset, dirty, busy, err, savedFlash, submit };
}
