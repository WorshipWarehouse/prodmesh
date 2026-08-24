import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { RestreamWidget } from './RestreamWidget';
import { EMBED_ALLOW, EMBED_SANDBOX } from '../lib/embed';
import { emitTopic } from '../test/fakeEventSource';
import type { WidgetConfig } from './types';

// The preview frame is the one place in this widget where a URL from somebody
// else's API becomes an `<iframe src>`, and until now nothing asserted on it —
// `embed.test.ts` covers `safeEmbedUrl()` and the sandbox string, neither of
// which is the host pin. So these tests fix the CURRENT behaviour of that path
// in place: what is framed, what is refused, and what is silently dropped.
// Where a case is a known gap rather than a decision it says so.

const show = (config: WidgetConfig = { videoPreview: true }) =>
  render(<RestreamWidget roomId="north-main" config={config} />);

const push = (data: unknown) => emitTopic({ 'integration:restream': data });

/** A live broadcast with one destination, which is what a preview needs. */
const broadcast = (channel: Partial<{ name: string; url: string | null; embedUrl: string | null }>) => ({
  connected: true,
  status: 'live',
  title: 'Sunday Morning',
  viewers: 120,
  channels: [{ id: '7', name: 'YouTube', viewers: 120, url: null, embedUrl: null, ...channel }],
});

const frame = () => document.querySelector('iframe');

describe('RestreamWidget preview', () => {
  it('rewrites a youtu.be link to a nocookie embed', async () => {
    show();
    await push(broadcast({ url: 'https://youtu.be/abc123' }));
    expect(await screen.findByTitle('Restream live stream preview')).toBeInTheDocument();
    expect(frame()).toHaveAttribute('src', 'https://www.youtube-nocookie.com/embed/abc123');
  });

  it('rewrites a watch URL to a nocookie embed', async () => {
    show();
    await push(broadcast({ url: 'https://www.youtube.com/watch?v=abc123&t=90' }));
    await screen.findByTitle('Restream live stream preview');
    // The timestamp goes with it: this is a live preview, not a seek.
    expect(frame()).toHaveAttribute('src', 'https://www.youtube-nocookie.com/embed/abc123');
  });

  it('passes an /embed/ URL through as it arrived', async () => {
    show();
    await push(broadcast({ embedUrl: 'https://www.youtube.com/embed/abc123' }));
    await screen.findByTitle('Restream live stream preview');
    expect(frame()).toHaveAttribute('src', 'https://www.youtube.com/embed/abc123');
  });

  it('prefers the embed URL over the destination URL', async () => {
    show();
    await push(broadcast({ embedUrl: 'https://www.youtube.com/embed/from-embed', url: 'https://youtu.be/from-url' }));
    await screen.findByTitle('Restream live stream preview');
    expect(frame()).toHaveAttribute('src', 'https://www.youtube.com/embed/from-embed');
  });

  it('pins the host: an unrecognised HTTPS embed URL never reaches the frame', async () => {
    // The guard for the decision in #14. Both values arrive verbatim from
    // Restream, and HTTPS alone is not enough to earn an iframe — the URL has
    // to be one of the shapes this widget knows how to embed.
    show();
    await push(broadcast({ embedUrl: 'https://player.example.invalid/?token=abc' }));
    await screen.findByText('Sunday Morning');
    expect(frame()).toBeNull();
  });

  it('falls back to the destination URL when the embed URL is refused', async () => {
    // Refusing a value must not cost the preview when the other one is good.
    show();
    await push(broadcast({ embedUrl: 'https://player.example.invalid/?token=abc', url: 'https://youtu.be/abc123' }));
    await screen.findByTitle('Restream live stream preview');
    expect(frame()).toHaveAttribute('src', 'https://www.youtube-nocookie.com/embed/abc123');
  });

  it('refuses plaintext and non-HTTP schemes outright', async () => {
    // `new URL()` parses every one of these happily; none of them may be framed.
    for (const url of ['http://www.youtube.com/watch?v=abc123', 'javascript:alert(1)', 'data:text/html,<script>1</script>']) {
      const view = show();
      await push(broadcast({ embedUrl: url }));
      await screen.findByText('Sunday Morning');
      expect(frame()).toBeNull();
      view.unmount();
    }
  });

  it('drops YouTube URLs it does not recognise — a known gap, not a decision', async () => {
    // Both of these are legitimate YouTube links Restream could plausibly
    // return, and both currently produce no preview at all. Recorded so the
    // behaviour is visible; widening the pin to cover them is a separate
    // change, and wants a real captured `channel.embedUrl` behind it.
    for (const url of ['https://www.youtube.com/live/abc123', 'https://www.youtube-nocookie.com/embed/abc123']) {
      const view = show();
      await push(broadcast({ embedUrl: url }));
      await screen.findByText('Sunday Morning');
      expect(frame()).toBeNull();
      view.unmount();
    }
  });

  it('previews only a YouTube destination', async () => {
    // Restream lists every destination; the others have their own embedding
    // rules and this widget does not guess at them.
    show();
    await push(broadcast({ name: 'Facebook', url: 'https://www.facebook.com/church/videos/123' }));
    await screen.findByText('Sunday Morning');
    expect(frame()).toBeNull();
  });

  it('carries the shared sandbox and permissions on every frame it does render', async () => {
    // The failure this prevents is a booth display leaving the dashboard
    // mid-service, so assert the frame gets the fence — not just a src.
    show();
    await push(broadcast({ url: 'https://youtu.be/abc123' }));
    await screen.findByTitle('Restream live stream preview');
    expect(frame()).toHaveAttribute('sandbox', EMBED_SANDBOX);
    expect(frame()).toHaveAttribute('allow', EMBED_ALLOW);
    expect(frame()?.getAttribute('sandbox')).not.toContain('allow-top-navigation');
  });

  it('renders no preview unless the widget was configured for one', async () => {
    show({});
    await push(broadcast({ url: 'https://youtu.be/abc123' }));
    await screen.findByText('Sunday Morning');
    expect(frame()).toBeNull();
  });

  it('renders no preview when the broadcast is not live', async () => {
    show();
    await push({ ...broadcast({ url: 'https://youtu.be/abc123' }), status: 'offline' });
    await screen.findByText(/Restream account connected/);
    expect(frame()).toBeNull();
  });
});
