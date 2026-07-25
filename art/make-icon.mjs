// ProdMesh app icon generator → art/prodmesh-icon.svg
//
// The icon is the architecture: every room and device connected through one
// hub (the server the whole dashboard runs through), drawn in the app's own
// design tokens — and one node at the edge is LIVE.
//
//   node art/make-icon.mjs
//
// PNG render (transparent outside the rounded tile — qlmanage flattens alpha,
// headless Chrome doesn't):
//   cd art && "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
//     --headless=new --disable-gpu --screenshot=prodmesh-icon.png \
//     --window-size=1024,1024 --default-background-color=00000000 \
//     "file://$PWD/prodmesh-icon.svg"
//
// Pure shapes, no SVG filters (glows are concentric translucent circles), so
// every renderer — Slack's uploader included — draws it identically.

import { writeFileSync } from 'node:fs';

const S = 1024;
const CX = S / 2;
const CY = S / 2;

// Design tokens (src/styles/tokens.css)
const BG_TOP = '#131b24';
const BG_BOTTOM = '#090d11';
const ACCENT = '#52a8ff';
const ACCENT_BRIGHT = '#9fd0ff';
const TEXT = '#edf2f7';
const DANGER = '#ff6b6b';

// Outer nodes: angle (deg), distance from center, radius. Slightly irregular
// so it reads as a real mesh, not a clip-art atom. Node 0 (upper right) is
// the live room.
const NODES = [
  { a: -52, d: 312, r: 46, live: true },
  { a: 0, d: 296, r: 34 },
  { a: 52, d: 318, r: 40 },
  { a: 116, d: 300, r: 34 },
  { a: 168, d: 322, r: 42 },
  { a: 220, d: 292, r: 34 },
  { a: 272, d: 310, r: 38 },
];

const pt = ({ a, d }) => {
  const rad = (a * Math.PI) / 180;
  return { x: CX + d * Math.cos(rad), y: CY + d * Math.sin(rad) };
};

const nodes = NODES.map((n) => ({ ...n, ...pt(n) }));

const line = (p, q, w, opacity, color = ACCENT) =>
  `<line x1="${p.x.toFixed(1)}" y1="${p.y.toFixed(1)}" x2="${q.x.toFixed(1)}" y2="${q.y.toFixed(1)}" stroke="${color}" stroke-width="${w}" stroke-linecap="round" opacity="${opacity}"/>`;

const circle = (x, y, r, fill, opacity = 1) =>
  `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${r}" fill="${fill}" opacity="${opacity}"/>`;

// Spokes: every room connects to the hub.
const spokes = nodes
  .map((n) => line({ x: CX, y: CY }, n, n.live ? 15 : 12, n.live ? 0.75 : 0.5))
  .join('\n  ');

// Cross-links between a few neighbors: it's a mesh, not a star.
const cross = [
  [0, 1],
  [2, 3],
  [4, 5],
  [5, 6],
]
  .map(([i, j]) => line(nodes[i], nodes[j], 7, 0.22))
  .join('\n  ');

// Outer nodes: soft halo + core (live node in red, with a bigger halo).
const outer = nodes
  .map((n) =>
    n.live
      ? [
          circle(n.x, n.y, n.r * 2.1, DANGER, 0.16),
          circle(n.x, n.y, n.r * 1.45, DANGER, 0.3),
          circle(n.x, n.y, n.r, DANGER),
          circle(n.x, n.y, n.r * 0.45, '#ffd7d7'),
        ].join('\n  ')
      : [
          circle(n.x, n.y, n.r * 1.6, ACCENT, 0.18),
          circle(n.x, n.y, n.r, ACCENT),
          circle(n.x, n.y, n.r * 0.45, ACCENT_BRIGHT),
        ].join('\n  '),
  )
  .join('\n  ');

// Hub: layered glow, accent ring, near-white core — the server everything
// flows through.
const hub = [
  circle(CX, CY, 190, ACCENT, 0.1),
  circle(CX, CY, 150, ACCENT, 0.16),
  `<circle cx="${CX}" cy="${CY}" r="112" fill="${BG_BOTTOM}" stroke="${ACCENT}" stroke-width="16"/>`,
  circle(CX, CY, 64, ACCENT_BRIGHT),
  circle(CX, CY, 34, TEXT),
].join('\n  ');

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${S}" height="${S}" viewBox="0 0 ${S} ${S}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="${BG_TOP}"/>
      <stop offset="1" stop-color="${BG_BOTTOM}"/>
    </linearGradient>
  </defs>
  <rect width="${S}" height="${S}" rx="224" fill="url(#bg)"/>
  ${cross}
  ${spokes}
  ${outer}
  ${hub}
</svg>
`;

writeFileSync(new URL('./prodmesh-icon.svg', import.meta.url), svg);
console.log('wrote art/prodmesh-icon.svg');
