// ─────────────────────────────────────────────────────────────────────────────
//  SEED MODE  —  "is this a real install, or a dev/test box?"
//
//  Several stores ship first-run defaults that are really demo-fixture
//  data (the topology seed's campuses and device IPs; the example Sunday lock
//  on room "north-main"). Tests and dev are built on that fixture, so it
//  cannot simply be deleted — but a church installing prodmesh must never see
//  it. Every store that seeds asks here, so they all answer the question the
//  same way.
//
//  PRODMESH_SEED=demo|empty forces it either way; otherwise "am I a real
//  install?" is NODE_ENV=production without the local-test flag.
// ─────────────────────────────────────────────────────────────────────────────

export function wantsDemoSeed() {
  const explicit = String(process.env.PRODMESH_SEED ?? '').toLowerCase();
  if (explicit === 'demo') return true;
  if (explicit === 'empty' || explicit === 'none') return false;
  return process.env.PRODMESH_LOCAL_TEST === '1' || process.env.NODE_ENV !== 'production';
}
