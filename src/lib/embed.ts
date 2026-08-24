// ─────────────────────────────────────────────────────────────────────────────
//  THIRD-PARTY EMBEDS  —  the rules for putting somebody else's page inside a
//  dashboard, on a screen nobody is standing at.
//
//  Copy this into any widget that embeds a livestream, player or preview.
//  Both existing embeds (Resi's player, Restream's YouTube preview) go through
//  it, and a new one should too rather than reinventing the check.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The sandbox every third-party embed gets.
 *
 * What this does NOT do is the part people expect: a cross-origin frame is
 * already walled off from our DOM, our localStorage (where the admin bearer
 * token lives) and our cookies by the same-origin policy. `sandbox` adds
 * nothing there.
 *
 * What it does buy is the thing that actually bites a booth screen: without
 * it, an embedded page can navigate the whole tab. A display running unattended
 * and full-screen would simply leave the dashboard mid-service — no exploit
 * required, a redirect on the far end is enough. Popups, form submission and
 * downloads go with it.
 *
 * `allow-scripts` and `allow-same-origin` are both required or the players do
 * not run. Granting both to a CROSS-ORIGIN frame is fine and is not the
 * well-known footgun — that warning is about sandboxing a SAME-ORIGIN frame,
 * where the pair lets the child reach back into its parent. These frames are
 * always another origin, and top-level navigation stays blocked either way.
 */
export const EMBED_SANDBOX = 'allow-scripts allow-same-origin allow-presentation';

/** What an embed is allowed to ask the browser for. */
export const EMBED_ALLOW = 'autoplay; fullscreen; picture-in-picture';

/**
 * Parse a URL that is about to become an `<iframe src>`, or refuse it.
 *
 * HTTPS only. `new URL()` on its own is not a safety check — it happily parses
 * `javascript:`, `data:` and `file:`, and a plain `http:` embed is both a
 * mixed-content failure in a browser and a plaintext stream on the church's
 * network.
 *
 * Deliberately no hostname allowlist here. Restream's preview adds one on top
 * (see `RestreamWidget`) because that host set is small, known and ours to
 * decide. Resi's player URL is typed by an administrator and their player
 * hostnames are not documented anywhere we can verify, so an allowlist would be
 * a guess that breaks real installs rather than a control. Add one per
 * integration once its hosts are actually known — not here.
 */
export function safeEmbedUrl(raw: string | null | undefined): URL | null {
  if (!raw) return null;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  return url.protocol === 'https:' ? url : null;
}
