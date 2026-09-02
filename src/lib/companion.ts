// Companion's official browser control surface.  It owns the buttons, live
// feedback, page navigation and websocket connection; ProdMesh deliberately
// does not attempt to copy that control logic.

const EMULATOR_ID = /^[A-Za-z0-9_-]{1,80}$/;

/** Build the documented Companion emulator URL for a configured room.
 * Companion normally serves its LAN UI over HTTP, so this is intentionally
 * separate from safeEmbedUrl(), which is for internet players and HTTPS only. */
export function companionEmulatorUrl(host?: string, port?: number, emulator?: string): URL | null {
  if (!host) return null;
  const id = String(emulator || 'main').trim();
  if (!EMULATOR_ID.test(id)) return null;
  try {
    const url = new URL(`/emulator/${encodeURIComponent(id)}`, `http://${host}:${port ?? 8000}`);
    // The sandbox grants same-origin so Companion can retain its own session.
    // Never turn that into a same-origin frame if an admin accidentally points
    // it back at this ProdMesh server.
    if (typeof window !== 'undefined' && url.origin === window.location.origin) return null;
    return url;
  } catch {
    return null;
  }
}
