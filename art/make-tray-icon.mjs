// Menu-bar (tray) icon → desktop/assets/trayTemplate.png (+ @2x)
//
//   node art/make-tray-icon.mjs
//
// Written pixel by pixel in pure Node rather than rendered from the SVG,
// because the app icon's PNG was produced by driving headless Chrome by hand
// (see make-icon.mjs) and that cannot run in CI. A 16px monochrome glyph is
// small enough to draw arithmetically, which makes it reproducible on any
// machine with no toolchain at all — the same reasoning as vendoring assets
// instead of hotlinking them.
//
// macOS "template" images are drawn from ALPHA ONLY; the OS recolours them for
// light and dark menu bars. So every pixel is black and the shape lives
// entirely in the alpha channel. Windows shows the same file in colour, where
// black-on-transparent reads correctly against the default taskbar.
//
// The glyph is the product: one hub with rooms connected to it.

import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'desktop', 'assets');

function crc32(buf) {
  let c = ~0;
  for (const byte of buf) {
    c ^= byte;
    for (let k = 0; k < 8; k += 1) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

/** Encode RGBA pixels (Uint8Array, size*size*4) as a PNG buffer. */
function png(size, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type: RGBA
  // Each scanline is prefixed with its filter type (0 = none).
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y += 1) {
    raw[y * (size * 4 + 1)] = 0;
    rgba.subarray(y * size * 4, (y + 1) * size * 4)
      .forEach((v, i) => { raw[y * (size * 4 + 1) + 1 + i] = v; });
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/**
 * Coverage of a disc at a pixel, sampled 3x3 for cheap antialiasing. Without
 * it a 16px circle looks like a lego brick.
 */
function disc(px, py, cx, cy, r) {
  let hits = 0;
  for (let sy = 0; sy < 3; sy += 1) {
    for (let sx = 0; sx < 3; sx += 1) {
      const x = px + (sx + 0.5) / 3;
      const y = py + (sy + 0.5) / 3;
      if ((x - cx) ** 2 + (y - cy) ** 2 <= r * r) hits += 1;
    }
  }
  return hits / 9;
}

/** Coverage of a line segment, same 3x3 sampling. */
function line(px, py, x1, y1, x2, y2, w) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len2 = dx * dx + dy * dy;
  let hits = 0;
  for (let sy = 0; sy < 3; sy += 1) {
    for (let sx = 0; sx < 3; sx += 1) {
      const x = px + (sx + 0.5) / 3;
      const y = py + (sy + 0.5) / 3;
      const t = Math.max(0, Math.min(1, ((x - x1) * dx + (y - y1) * dy) / len2));
      const d2 = (x - (x1 + t * dx)) ** 2 + (y - (y1 + t * dy)) ** 2;
      if (d2 <= (w / 2) ** 2) hits += 1;
    }
  }
  return hits / 9;
}

function draw(size) {
  const s = size / 16; // authored at 16px, scaled up for @2x
  const c = size / 2;
  const rgba = new Uint8Array(size * size * 4);

  const hubR = 2.6 * s;
  const nodeR = 1.5 * s;
  const orbit = 5.6 * s;
  const spokeW = 1.1 * s;
  // Four rooms around one hub. Rotated an eighth-turn so the spokes land on
  // diagonals — at 16px, axis-aligned spokes disappear into the pixel grid.
  const nodes = [0, 1, 2, 3].map((i) => {
    const a = (Math.PI / 4) + (i * Math.PI) / 2;
    return [c + Math.cos(a) * orbit, c + Math.sin(a) * orbit];
  });

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      let a = disc(x, y, c, c, hubR);
      for (const [nx, ny] of nodes) {
        a = Math.max(a, line(x, y, c, c, nx, ny, spokeW));
        a = Math.max(a, disc(x, y, nx, ny, nodeR));
      }
      const i = (y * size + x) * 4;
      rgba[i] = 0; // template images are alpha-only; RGB must be black
      rgba[i + 1] = 0;
      rgba[i + 2] = 0;
      rgba[i + 3] = Math.round(Math.min(1, a) * 255);
    }
  }
  return png(size, rgba);
}

mkdirSync(OUT, { recursive: true });
writeFileSync(join(OUT, 'trayTemplate.png'), draw(16));
writeFileSync(join(OUT, 'trayTemplate@2x.png'), draw(32));
console.log(`Wrote ${join(OUT, 'trayTemplate.png')} (16px + @2x)`);
