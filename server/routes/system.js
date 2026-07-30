// System: about/version, show history, self-update, logs, and the audit trail.

import express from 'express';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { rooms } from '../roomsStore.js';
import * as pco from '../integrations/planningCenter.js';
import * as timeline from '../timeline.js';
import * as summaries from '../showSummaries.js';
import * as show from '../showManager.js';
import * as deployment from '../deployment.js';
import * as auth from '../authStore.js';
import * as splStore from '../splStore.js';
import * as health from '../health.js';
import { requirePermission, auditSuccess } from '../httpAuth.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const repoRoot = join(__dirname, '..', '..');

const router = express.Router();

// One source for the version, so /api/about and /api/system/version can't
// disagree about what is running.
router.get('/api/about', (_req, res) => res.json({ name: 'prodmesh', version: deployment.getVersion().version }));

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
// After-action reports across every room. Gated: this is the review surface,
// and it also drives outbound Planning Center calls via backfillLabels.
// Deliberately NOT gated alongside it: plan notes and song leaders on the Run
// of Show, which camera ops, switchers and FOH read anonymously to know who
// is next. Operational context stays open; retrospective analysis does not.
router.get('/api/history', requirePermission('reports.view'), async (_req, res) => {
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
      rehearsal: Boolean(row.timeId?.startsWith('rehearsal-')),
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

// Erase a recorded run (accidental start, invalid rehearsal). Removes the
// timeline JSON, the SPL samples, and the summary row — irreversible, so it's
// permission-gated, audited, and refused while that instance is live.
router.delete('/api/history/:instanceId', requirePermission('history.delete'), (req, res) => {
  const { instanceId } = req.params;
  if (show.activeInstanceIds().includes(instanceId)) {
    return res.status(409).json({ error: 'That show is live right now — end it first' });
  }
  if (!summaries.get(instanceId) && !timeline.get(instanceId)) {
    return res.status(404).json({ error: 'Unknown show instance' });
  }
  timeline.remove(instanceId);
  splStore.removeInstance(instanceId);
  summaries.remove(instanceId);
  auditSuccess(req, 'history.delete', { resourceType: 'show-instance', resourceId: instanceId });
  res.json({ ok: true });
});

// ── System (version + self-update) ─────────────────────────────────────────────

router.get('/api/system/version', (_req, res) => {
  res.json({
    ...deployment.getVersion(),
    deployment: deployment.kind(),
    update: deployment.updateCapability(),
  });
});

// Per-integration transport health (recorded by the integration clients).
//
// Deliberately still readable without a login — it is the first diagnostic
// when a room misbehaves, and a booth screen or a phone on the LAN should be
// able to answer "is Planning Center up?" without anyone signing in. But the
// keys are `proPresenter@192.0.2.15:1025`, i.e. a free inventory of the
// production VLAN, and lastError can carry a prefix of a device's response
// body. So anonymous callers get status without addresses; system.logs gets
// the detail (`?detail=1` to be explicit about wanting it).
function redactHealth(snap) {
  const out = {};
  for (const [key, entry] of Object.entries(snap)) {
    const name = key.split('@')[0]; // proPresenter@host:port → proPresenter
    // Several rooms can share an integration name once the host is dropped;
    // collapse to the worst state rather than letting one mask another.
    const prev = out[name];
    const merged = {
      ok: prev ? (prev.ok === false || entry.ok === false ? false : prev.ok ?? entry.ok) : entry.ok,
      lastSuccess: Math.max(prev?.lastSuccess ?? 0, entry.lastSuccess ?? 0) || null,
      consecutiveFailures: Math.max(prev?.consecutiveFailures ?? 0, entry.consecutiveFailures),
      // Keep the fact of an error and when, never its text.
      lastError: entry.lastError ? { ts: entry.lastError.ts } : (prev?.lastError ?? null),
    };
    out[name] = merged;
  }
  return out;
}

router.get('/api/system/health', (req, res) => {
  const detailed = auth.hasPermission(req.auth, 'system.logs') || req.legacyAdmin;
  const snap = health.snapshot();
  res.json({
    integrations: detailed ? snap : redactHealth(snap),
    redacted: !detailed,
    now: Date.now(),
  });
});

// Trigger a self-update (git pull + build + service restart). Runs detached so
// it survives this process being restarted by the service manager; the client
// polls /api/system/version to see the new commit land.
//
// Only a git checkout can do this. A container updates by being replaced, and
// a packaged copy by being reinstalled — so those are refused here rather than
// spawning a bash script that isn't there. 409, not 500: the request was
// well-formed and authorized, this install just doesn't work that way.
router.post('/api/system/update', requirePermission('system.update'), (_req, res) => {
  const capability = deployment.updateCapability();
  if (!capability.supported) {
    return res.status(409).json({ error: 'update_not_supported', ...capability });
  }
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
  const file = deployment.logFile();
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
      // The hint travels with the answer: "run install-service.sh" is wrong
      // advice inside a container, where output goes to the runtime instead.
      return res.json({ exists: false, file, hint: deployment.logHint(), lines: [] });
    }
    res.status(500).json({ error: String(err.message ?? err) });
  }
});

// The audit trail (named-user actions with station context) from SQLite.
router.get('/api/system/audit', requirePermission('system.logs'), (req, res) => {
  res.json({ entries: auth.listAudit(req.query.limit) });
});

export default router;
