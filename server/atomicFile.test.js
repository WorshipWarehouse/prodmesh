import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writeJsonAtomic } from './atomicFile.js';

const dir = mkdtempSync(join(tmpdir(), 'prodmesh-atomic-'));

test('writes valid JSON, creating parent dirs, leaving no temp file', () => {
  const file = join(dir, 'nested', 'deep', 'thing.json');
  writeJsonAtomic(file, { a: 1 });
  assert.deepEqual(JSON.parse(readFileSync(file, 'utf8')), { a: 1 });
  assert.equal(existsSync(`${file}.tmp`), false);
});

test('overwrites an existing file in place', () => {
  const file = join(dir, 'thing.json');
  writeJsonAtomic(file, { v: 1 });
  writeJsonAtomic(file, { v: 2 });
  assert.deepEqual(JSON.parse(readFileSync(file, 'utf8')), { v: 2 });
});
