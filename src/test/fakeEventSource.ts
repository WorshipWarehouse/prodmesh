import { act, waitFor } from '@testing-library/react';
import { expect } from 'vitest';

// jsdom has no EventSource, and every page now holds one through useTopic — so
// this is stubbed globally in setup.ts rather than per test file. Tests that
// care about pushed values drive it with emitTopic(); the rest simply need it
// to exist so the shared stream module can "connect".

export class FakeEventSource {
  static instances: FakeEventSource[] = [];
  url: string;
  closed = false;
  private listeners = new Map<string, Set<(e: MessageEvent) => void>>();

  constructor(url: string) {
    this.url = url;
    FakeEventSource.instances.push(this);
  }

  addEventListener(type: string, fn: (e: MessageEvent) => void) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type)!.add(fn);
  }

  removeEventListener(type: string, fn: (e: MessageEvent) => void) {
    this.listeners.get(type)?.delete(fn);
  }

  close() {
    this.closed = true;
  }

  emit(type: string, data: unknown) {
    for (const fn of this.listeners.get(type) ?? new Set()) {
      fn({ data: JSON.stringify(data) } as MessageEvent);
    }
  }
}

/** The live connection, once the stream module's debounced connect has fired. */
export async function liveSource() {
  await waitFor(() => expect(FakeEventSource.instances.at(-1)).toBeTruthy());
  return FakeEventSource.instances.at(-1)!;
}

/** Push one or more `{topic, data}` frames the way the server does. */
export async function emitTopic(frames: Record<string, unknown>) {
  const es = await liveSource();
  act(() => {
    for (const [topic, data] of Object.entries(frames)) es.emit('msg', { topic, data });
  });
}
