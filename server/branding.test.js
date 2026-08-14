// Logo upload: the app's only file-upload path, so the validation IS the test.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.PRODMESH_DATA_DIR = mkdtempSync(join(tmpdir(), 'prodmesh-branding-'));
const branding = await import('./branding.js');

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64, 7)]);
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(64, 3)]);
const WEBP = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBP'), Buffer.alloc(64, 1)]);

test('accepts real raster images and reports the sniffed type', () => {
  for (const [buf, type, ext] of [[PNG, 'image/png', 'png'], [JPEG, 'image/jpeg', 'jpg'], [WEBP, 'image/webp', 'webp']]) {
    const meta = branding.setLogo(buf);
    assert.equal(meta.type, type);
    assert.equal(meta.ext, ext);
    const back = branding.readLogo();
    assert.equal(back.type, type);
    assert.ok(back.buffer.equals(buf));
  }
});

test('wraps a PNG logo in a standards-compliant ICO container for Safari', () => {
  const ico = branding.pngAsIco(PNG);
  assert.ok(ico);
  assert.equal(ico.readUInt16LE(0), 0);
  assert.equal(ico.readUInt16LE(2), 1);
  assert.equal(ico.readUInt16LE(4), 1);
  assert.equal(ico.readUInt32LE(18), 22);
  assert.ok(ico.subarray(22).equals(PNG));
});

test('refuses SVG — it is a script document, not an image', () => {
  const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
  assert.throws(() => branding.setLogo(svg), /PNG, JPEG, GIF or WebP/);
  // An SVG that lies about being a PNG by filename/Content-Type is still SVG:
  // the decision is made on bytes, which the caller cannot fake into a match.
  assert.equal(branding.sniff(svg), null);
});

test('refuses anything whose BYTES are not an image, whatever it claims', () => {
  for (const bad of [
    Buffer.from('<!doctype html><script>alert(1)</script>'),
    Buffer.from('#!/bin/sh\nrm -rf /\n'),
    Buffer.from('%PDF-1.4'),
    Buffer.alloc(0),
    Buffer.from('PNG'), // too short to sniff
  ]) {
    assert.throws(() => branding.setLogo(bad), /image|No image/i, `${JSON.stringify(bad.subarray(0, 12).toString())} must be refused`);
  }
});

test('enforces a size cap', () => {
  const huge = Buffer.concat([PNG, Buffer.alloc(branding.MAX_LOGO_BYTES + 1)]);
  assert.throws(() => branding.setLogo(huge), /under \d+ KB/);
});

test('stores exactly one file, named by US, and clearing removes it', () => {
  branding.setLogo(PNG);
  branding.setLogo(JPEG); // a different extension must not leave the PNG behind
  const dir = join(process.env.PRODMESH_DATA_DIR, 'branding');
  const files = readdirSync(dir).sort();
  assert.deepEqual(files, ['logo.jpg', 'logo.json'], `unexpected files: ${files}`);

  branding.clearLogo();
  assert.equal(branding.readLogo(), null);
  assert.equal(branding.getLogoMeta(), null);
  assert.equal(readdirSync(dir).length, 0);
});

test('lives outside the repo so update.sh does not see a dirty tree', () => {
  // deploy/update.sh aborts the whole self-update on `git status --porcelain`,
  // so an in-repo upload directory would break updates for every install the
  // first time someone changed their logo.
  const dir = join(process.env.PRODMESH_DATA_DIR, 'branding');
  assert.ok(dir.startsWith(process.env.PRODMESH_DATA_DIR));
  assert.ok(!existsSync(join(process.cwd(), 'branding')));
});
