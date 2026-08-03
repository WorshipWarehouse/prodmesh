import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, beforeEach, vi } from 'vitest';
import { FakeEventSource } from './fakeEventSource';
import { resetStream } from '../lib/stream';

// Every page holds a shared EventSource through useTopic, and jsdom has none.
// Stubbing it here rather than per file means a component that grows a live
// topic doesn't break the tests of whatever happens to render it.
beforeEach(() => {
  FakeEventSource.instances = [];
  vi.stubGlobal('EventSource', FakeEventSource);
});

afterEach(() => {
  cleanup();
  resetStream(); // the stream module is a singleton — drop its connection + cache
  localStorage.clear();
});
