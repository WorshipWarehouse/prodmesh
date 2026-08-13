import express from 'express';
import { rooms } from '../roomsStore.js';
import * as pp from '../integrations/proPresenter.js';
import * as views from '../views.js';
import { requirePermission, auditSuccess } from '../httpAuth.js';

const router = express.Router();
const id = (value) => /^[a-z0-9-]{8,}$/i.test(String(value));
const index = (value) => Number.isInteger(value) && value >= 0 && value <= 10_000;

function room(req, res) {
  const value = rooms[req.params.id];
  if (!value) { res.status(404).json({ error: 'Unknown room' }); return null; }
  if (!pp.isConfigured(value.proPresenter)) { res.status(409).json({ error: 'ProPresenter is not configured' }); return null; }
  return value;
}

router.get('/api/rooms/:id/propresenter', async (req, res) => {
  const value = room(req, res); if (!value) return;
  try { res.json(await pp.readConsoleState(value.proPresenter)); }
  catch { res.status(502).json({ error: 'ProPresenter unavailable' }); }
});

router.get('/api/rooms/:id/propresenter/thumbnail/:presentationUuid/:cueIndex', async (req, res) => {
  const value = room(req, res); if (!value) return;
  const cueIndex = Number(req.params.cueIndex);
  if (!id(req.params.presentationUuid) || !index(cueIndex)) return res.status(400).json({ error: 'Invalid thumbnail target' });
  const image = await pp.readThumbnail(value.proPresenter, req.params.presentationUuid, cueIndex).catch(() => null);
  if (!image) return res.status(404).end();
  res.set({ 'Content-Type': image.type, 'Cache-Control': 'private, max-age=300' }).send(image.bytes);
});

// Read-only raw shape aid for site verification when a new PP version lands.
router.get('/api/rooms/:id/propresenter/diagnostics', requirePermission('config.manage'), async (req, res) => {
  const value = room(req, res); if (!value) return;
  try { res.json(await pp.readConsoleState(value.proPresenter)); }
  catch { res.status(502).json({ error: 'ProPresenter unavailable' }); }
});

router.post('/api/rooms/:id/propresenter/control', requirePermission('propresenter.control'), async (req, res) => {
  const value = room(req, res); if (!value) return;
  const { viewId, widgetId, action, playlistIndex, cueIndex, presentationUuid, isPco } = req.body ?? {};
  if (!id(viewId) || !id(widgetId) || !['previous', 'next', 'previous-item', 'next-item', 'presentation', 'cue'].includes(action)) {
    return res.status(400).json({ error: 'Invalid ProPresenter control request' });
  }
  const widget = views.getWidget(viewId, widgetId);
  if (!widget || widget.roomId !== value.id || widget.viewKind !== 'dashboard'
    || !['propresenter-playlist', 'propresenter-controls'].includes(widget.type) || !widget.config?.slideControls) {
    return res.status(403).json({ error: 'Control is not enabled for this widget' });
  }
  if ((action === 'presentation' || action === 'cue') && !index(playlistIndex)) return res.status(400).json({ error: 'Invalid playlist index' });
  if (action === 'cue' && !index(cueIndex)) return res.status(400).json({ error: 'Invalid cue index' });
  try {
    if (action === 'previous-item') await pp.controlAdjacentItem(value.proPresenter, -1);
    else if (action === 'next-item') await pp.controlAdjacentItem(value.proPresenter, 1);
    else await pp.control(value.proPresenter, action, { playlistIndex, cueIndex, presentationUuid: id(presentationUuid) ? presentationUuid : null, isPco: Boolean(isPco) });
    auditSuccess(req, 'propresenter.control', { resourceType: 'view-widget', resourceId: widgetId, details: { action } });
    res.json({ ok: true });
  } catch (err) { res.status(502).json({ error: String(err.message ?? err) }); }
});

export default router;
