import type { ReactNode } from 'react';
import { HelpTip } from '../HelpTip';
import type { DraftForm } from './useDraft';

// Section wrapper for a useDraft-backed editor: title + one primary save
// action, with the error/success line adjacent to the content it belongs to.
export function EditorSection({ title, help, saveLabel, form, children }: {
  title: string;
  help?: string;
  saveLabel: string;
  form: DraftForm;
  children: ReactNode;
}) {
  return (
    <div className="fsection">
      <div className="fsection__head">
        <h3 className="fsection__title">{title}
          {help && <HelpTip text={help} />}
        </h3>
        <button className="btn btn--primary" onClick={form.submit} disabled={!form.dirty || form.busy}>
          {form.busy ? 'Saving…' : form.dirty ? saveLabel : 'Saved'}
        </button>
      </div>
      {children}
      {form.err && <p className="fsection__error">{form.err}</p>}
      {form.savedFlash && <p className="fsection__ok">Saved.</p>}
    </div>
  );
}
