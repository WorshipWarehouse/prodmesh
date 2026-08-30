// ─────────────────────────────────────────────────────────────────────────────
//  THE SEAL  —  what a process must do once its data directory has been
//  replaced underneath it.
//
//  A restore overwrites prodmesh.db while this process still has the OLD
//  database open. SQLite in WAL mode does not tolerate that: the old
//  connection holds its own view of the file, and when it is closed — which is
//  exactly what the operator does next, because the UI tells them to restart —
//  it writes that view back over the restored bytes. The restore lands on
//  disk, survives until the restart, and is then silently undone. Measured,
//  not theorised: it happens with no intervening writes at all.
//
//  settings.json and secrets.json fail the same way for a different reason:
//  both are memoised in module state and written back WHOLE, so one setting
//  saved after a restore rewrites the restored file from the old install's
//  memory — including the admin PIN that came out of the backup.
//
//  So a restored process is finished. It cannot serve the old installation
//  (its data is gone) and it cannot serve the new one (its memory is wrong).
//  Sealing says so out loud instead of running on and looking fine, which is
//  the failure this whole file exists to prevent.
// ─────────────────────────────────────────────────────────────────────────────

/** Read by the operator, whose server just came back from the dead. */
export const SEALED_MESSAGE =
  'Backup restored. Restart prodmesh to finish — until then this process is still running on the data the backup replaced.';

let sealedAt = null;

/** Called by the restore, immediately before anything is overwritten. */
export function seal() {
  sealedAt ??= Date.now();
  return sealedAt;
}

export const isSealed = () => sealedAt != null;

/**
 * Refuse to touch replaced state. Anything that reads or writes the data
 * directory calls this first, so a stray poll cannot reopen the database or
 * flush a stale cache over a restored file.
 */
export function assertNotSealed() {
  if (sealedAt == null) return;
  const err = new Error(SEALED_MESSAGE);
  err.code = 'restored';
  throw err;
}

/** Tests only: a seal is one-way for the life of a real process. */
export function unsealForTest() {
  sealedAt = null;
}
