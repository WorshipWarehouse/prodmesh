// System: about/version, show history, self-update, logs, and the audit trail.

import express from 'express';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { readFileSync } from 'node:fs';

import { rooms } from '../roomsStore.js';
import * as pco from '../integrations/planningCenter.js';
import * as timeline from '../timeline.js';
import * as summaries from '../showSummaries.js';
import * as show from '../showManager.js';
import * as settings from '../settings.js';
import * as auth from '../authStore.js';
import * as health from '../health.js';
import { requirePermission } from '../httpAuth.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const repoRoot = join(__dirname, '..', '..');

const router = express.Router();

const pkg = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8'));
router.get('/api/about', (_req, res) => res.json({ name: 'prodmesh', version: pkg.version }));

// Shows recorded before label-stamping existed (or while PC was unreachable)
// have no planTitle. Resolve those plans directly by id — Planning Center
// serves past plans fine, they just fall out of the "upcoming" list — and
// stamp the result into the timeline so it's a one-time repair per show.
const backfillDone = new Set(); // instanceIds tried this boot (hit or miss)
async function backfillLabels(row) {
  if (row.planTitle != null || !row.roomId || !row.planId) return;
  if (backfillDone.has(row.instanceId)) return;
  backfillDone.add(row.instanceId);
  for (const st of rooms[row.roomId]?.planningCenter?.serviceTypes ?? []) {
    const plan = await pco.getPlan(st, row.planId);
    if (!plan) continue; // not this service type (or PC not live)
    const time = await pco
      .getPlanTimes(st, row.planId)
      .then((ts) => ts.find((t) => t.id === row.timeId) ?? null)
      .catch(() => null);
    timeline.ensure(row.instanceId, {
      planTitle: plan.title,
      serviceTypeName: plan.serviceTypeName,
      dates: plan.dates,
      timeName: time?.name ?? null,
      timeStartsAt: time?.startsAt ?? null,
    });
    summaries.refresh(row.instanceId); // the repaired labels reach the summary
    return;
  }
}

// Every recorded show, newest first — powers the Analytics history view.
// Served from show_summaries (one indexed query); live shows get their row
// refreshed first so mid-show history stays current. Labels (planTitle etc.)
// are stamped at show start; unlabeled rows get a backfill attempt above.
router.get('/api/history', async (_req, res) => {
  summaries.syncFromTimelines(); // once per boot: legacy timelines → rows
  for (const id of show.activeInstanceIds()) summaries.refresh(id);
  await Promise.all(summaries.listAll().map(backfillLabels));
  const shows = summaries.listAll().map((row) => {
    const room = rooms[row.roomId] ?? null;
    return {
      instanceId: row.instanceId,
      roomId: row.roomId,
      roomName: room?.name ?? row.roomId ?? null,
      site: room?.site ?? null,
      planId: row.planId,
      timeId: row.timeId,
      planTitle: row.planTitle,
      serviceTypeName: row.serviceTypeName,
      dates: row.dates,
      timeName: row.timeName,
      timeStartsAt: row.timeStartsAt,
      startedAt: row.startedAt,
      completedAt: row.completedAt,
      itemCount: row.itemCount,
      totals: {
        planned: row.plannedSeconds,
        actual: row.actualSeconds,
        delta: row.actualSeconds - row.plannedSeconds,
      },
      spl: row.spl
        ? { ...row.spl, target: room?.analysis?.target ?? null, limit: room?.analysis?.limit ?? null }
        : null,
    };
  });
  res.json({ shows });
});

// ── System (version + self-update) ─────────────────────────────────────────────

router.get('/api/system/version', (_req, res) => {
  res.json(settings.getVersion());
});

// Per-integration transport health (recorded by the integration clients).
// Public read like the connectivity GET — keys carry hostnames, nothing secret.
router.get('/api/system/health', (_req, res) => {
  res.json({ integrations: health.snapshot(), now: Date.now() });
});

// Trigger a self-update (git pull + build + service restart). Runs detached so
// it survives this process being restarted by the service manager; the client
// polls /api/system/version to see the new commit land.
router.post('/api/system/update', requirePermission('system.update'), (_req, res) => {
  const script = join(repoRoot, 'deploy', 'update.sh');
  try {
    const child = spawn('bash', [script], {
      cwd: repoRoot,
      detached: true,
      stdio: 'ignore',
    });
    child.unref();
    res.json({ started: true });
  } catch (err) {
    res.status(500).json({ error: String(err.message ?? err) });
  }
});

// ── Logs (Admin → Logs) ────────────────────────────────────────────────────────

// Tail of the server process log. The installed service (install-service.sh)
// writes stdout/stderr to <repo>/logs/server.log; PRODMESH_LOG_FILE overrides
// (tests, unusual deployments). Reads at most the last 512 KB.
router.get('/api/system/logs', requirePermission('system.logs'), async (req, res) => {
  const file = process.env.PRODMESH_LOG_FILE ?? join(repoRoot, 'logs', 'server.log');
  const lines = Math.max(50, Math.min(2000, Number(req.query.lines) || 500));
  try {
    const { stat, open } = await import('node:fs/promises');
    const info = await stat(file);
    const readFrom = Math.max(0, info.size - 512 * 1024);
    const fh = await open(file, 'r');
    let text;
    try {
      const { buffer, bytesRead } = await fh.read({
        buffer: Buffer.alloc(info.size - readFrom),
        position: readFrom,
      });
      text = buffer.toString('utf8', 0, bytesRead);
    } finally {
      await fh.close();
    }
    const all = text.split('\n');
    if (all.at(-1) === '') all.pop();
    if (readFrom > 0) all.shift(); // first line may be a partial from mid-file
    res.json({
      exists: true,
      file,
      size: info.size,
      mtime: info.mtimeMs,
      truncated: readFrom > 0 || all.length > lines,
      lines: all.slice(-lines),
    });
  } catch (err) {
    if (err.code === 'ENOENT') {
      return res.json({ exists: false, file, lines: [] });
    }
    res.status(500).json({ error: String(err.message ?? err) });
  }
});

// The audit trail (named-user actions with station context) from SQLite.
router.get('/api/system/audit', requirePermission('system.logs'), (req, res) => {
  res.json({ entries: auth.listAudit(req.query.limit) });
});

export default router;
