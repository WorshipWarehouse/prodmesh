import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Check, Trash2 } from 'lucide-react';
import {
  deleteView,
  getView,
  requestAuth,
  saveView,
  type View,
  type ViewPlacement,
} from '../api';
import { SelectField } from '../components/SelectField';
import { ViewEditor } from '../views/ViewEditor';
import { useDraft } from '../components/form/useDraft';
import { useQuery, invalidate } from '../lib/useQuery';
import { viewKey, viewsKey } from '../lib/keys';
import { gridFor } from '../lib/gridLayout';
import { useCan, useIdentity } from '../lib/identity';

// Arranging one view. Nothing is destructive until Save: the whole layout goes
// up in one PUT, and the server replaces it transactionally.

const EDIT = 'views.edit';
const EDIT_LABEL = 'Edit dashboards & displays';

interface Draft {
  name: string;
  slug: string;
  scale: number;
  widgets: ViewPlacement[];
}

const toDraft = (view: View): Draft => ({
  name: view.name,
  slug: view.slug,
  scale: view.scale ?? 1,
  widgets: view.widgets,
});

/** Matches SCALES in server/validate.js. */
const SCALES = [1, 1.25, 1.5, 2, 2.5, 3];

function Editor({ view }: { view: View }) {
  const navigate = useNavigate();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const grid = gridFor(view.kind)!;

  const form = useDraft<Draft>(toDraft(view), async (draft) => {
    const stored = await saveView(view.id, {
      name: draft.name,
      slug: draft.slug,
      scale: draft.scale,
      // Placement ids are the server's; it mints new ones on every replace, so
      // sending ours back would be noise. Geometry and type are the payload.
      widgets: draft.widgets.map(({ type, x, y, w, h, config }) => ({ type, x, y, w, h, config })),
    });
    invalidate('view');
    return toDraft(stored);
  });

  const destroy = async () => {
    await deleteView(view.id);
    invalidate(viewsKey(view.roomId));
    navigate(`/room/${view.roomId}/views`, { replace: true });
  };

  const label = view.kind === 'display' ? 'display' : 'dashboard';

  return (
    <div className="viewpage">
      <div className="editbar">
        <label className="editbar__name">
          <span className="sr-only">Name</span>
          <input
            className="field"
            value={form.draft.name}
            maxLength={60}
            onChange={(e) => form.patch({ name: e.target.value })}
          />
        </label>

        <span className="editbar__slug mono" title="The address this view lives at">
          /{form.draft.slug}
        </span>

        {/* A display is read at a distance — from the back of a room, or as
            one tile of a video wall where the whole 3×3 lands in a few hundred
            pixels. Per view, because those two screens are not the same
            problem. Meaningless for a dashboard, which is read at a desk. */}
        {view.kind === 'display' && (
          <label className="editbar__scale">
            <span>Scale</span>
            <SelectField
              value={String(form.draft.scale)}
              onChange={(e) => form.patch({ scale: Number(e.target.value) })}
            >
              {SCALES.map((s) => <option key={s} value={s}>{Math.round(s * 100)}%</option>)}
            </SelectField>
          </label>
        )}

        <div className="editbar__actions">
          {form.savedFlash && <span className="editbar__saved"><Check size={14} /> Saved</span>}
          {form.err && <span className="editbar__err">{form.err}</span>}
          <button
            type="button"
            className="iconbtn iconbtn--danger"
            aria-label={`Delete this ${label}`}
            title={`Delete this ${label}`}
            onClick={() => setConfirmDelete(true)}
          >
            <Trash2 size={15} />
          </button>
          <button className="btn btn--sm" disabled={!form.dirty || form.busy} onClick={form.reset}>
            Discard
          </button>
          <Link className="btn btn--sm" to={viewHref(view)}>Done</Link>
          <button
            className="btn btn--primary btn--sm"
            disabled={!form.dirty || form.busy}
            onClick={form.submit}
          >
            Save layout
          </button>
        </div>
      </div>

      <ViewEditor
        view={{ ...view, ...form.draft }}
        grid={grid}
        onChange={(widgets) => form.patch({ widgets })}
      />

      {confirmDelete && (
        <div className="confirm" role="dialog" aria-modal="true" aria-labelledby="del-view">
          <div className="confirm__card">
            <p className="eyebrow">Delete</p>
            <p className="confirm__text" id="del-view">
              Delete <strong>{view.name}</strong>? Any screen pointed at it will stop working.
            </p>
            <div className="confirm__buttons">
              <button className="confirm__cancel" onClick={() => setConfirmDelete(false)}>Cancel</button>
              <button className="confirm__ok confirm__ok--danger" onClick={destroy}>Delete</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// "Done" goes to the thing you were arranging: a dashboard in the shell, a
// display full-screen as the wall will show it.
const viewHref = (view: View) =>
  view.kind === 'display'
    ? `/display/${view.roomId}/${view.slug}`
    : `/room/${view.roomId}/view/${view.slug}`;

export function ViewEditorPage() {
  const { roomId = '', slug = '' } = useParams();
  const canEdit = useCan(EDIT);
  const loggedIn = Boolean(useIdentity()?.authenticated);
  const viewQ = useQuery(viewKey(roomId, slug), () => getView(roomId, slug), { staleMs: 60_000 });
  const view = viewQ.data?.view ?? null;

  if (viewQ.error) {
    return (
      <div className="pagemsg">
        <p>Dashboard not found</p>
        <Link className="backlink" to={`/room/${roomId}/views`}>← All dashboards</Link>
      </div>
    );
  }
  if (!canEdit) {
    // "Log in" and "your account can't" are different problems with different
    // fixes; saying the wrong one sends someone round the loop they just
    // failed. Same distinction the show controls make.
    return (
      <div className="pagemsg">
        {loggedIn ? (
          <p>Your account cannot edit dashboards.</p>
        ) : (
          <>
            <p>Log in to edit dashboards.</p>
            <button className="btn btn--sm" onClick={() => requestAuth(EDIT, EDIT_LABEL)}>
              Log in
            </button>
          </>
        )}
        <Link className="backlink" to={`/room/${roomId}/views`}>← All dashboards</Link>
      </div>
    );
  }
  if (!view) return <div className="pagemsg">Loading…</div>;

  // Keyed on the view so the draft starts from the right layout when someone
  // moves between editors without unmounting the route.
  return <Editor key={view.id} view={view} />;
}
