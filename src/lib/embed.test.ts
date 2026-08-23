import { describe, expect, it } from 'vitest';
import { EMBED_SANDBOX, safeEmbedUrl } from './embed';

describe('third-party embeds', () => {
  it('refuses every scheme except https', () => {
    // `new URL()` was the only check here once, and it parses all of these
    // happily — it is a parser, not a safety check.
    expect(safeEmbedUrl('javascript:alert(1)')).toBeNull();
    expect(safeEmbedUrl('data:text/html,<script>alert(1)</script>')).toBeNull();
    expect(safeEmbedUrl('file:///etc/passwd')).toBeNull();
    // Plaintext is refused too: mixed content in the browser, and the church's
    // stream in the clear on its own network.
    expect(safeEmbedUrl('http://player.example/embed')).toBeNull();
    expect(safeEmbedUrl('https://player.example/embed')?.href).toBe('https://player.example/embed');
  });

  it('treats missing and malformed input as no embed, never as a broken frame', () => {
    expect(safeEmbedUrl(null)).toBeNull();
    expect(safeEmbedUrl(undefined)).toBeNull();
    expect(safeEmbedUrl('')).toBeNull();
    expect(safeEmbedUrl('not a url')).toBeNull();
  });

  it('keeps top-level navigation and popups out of the sandbox', () => {
    // The failure this prevents is a booth display leaving the dashboard
    // mid-service because an embedded page redirected the tab. Scripts and
    // same-origin are required for the players to run at all; everything else
    // stays off, so assert on what is ABSENT.
    const granted = EMBED_SANDBOX.split(' ');
    expect(granted).toContain('allow-scripts');
    expect(granted).toContain('allow-same-origin');
    for (const capability of [
      'allow-top-navigation',
      'allow-top-navigation-by-user-activation',
      'allow-popups',
      'allow-forms',
      'allow-downloads',
      'allow-modals',
      'allow-pointer-lock',
    ]) {
      expect(granted).not.toContain(capability);
    }
  });
});
