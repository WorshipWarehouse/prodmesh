// ─────────────────────────────────────────────────────────────────────────────
//  ATOMIC JSON WRITES  —  crash-safe persistence for the file stores.
//
//  writeFileSync alone can leave a half-written file if the box dies mid-write.
//  Writing to a temp file and rename()ing over the target is atomic on
//  APFS/ext4: readers see the old version or the new one, never a torn file.
//
//  Single-writer by design (ADR 0004): all writes happen on this process's
//  event loop, so one shared temp name per target is safe.
// ─────────────────────────────────────────────────────────────────────────────

import { writeFileSync, renameSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export function writeJsonAtomic(file, value) {
  mkdirSync(dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, JSON.stringify(value, null, 2));
  renameSync(tmp, file);
}
