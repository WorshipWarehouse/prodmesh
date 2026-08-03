import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, beforeEach, vi } from 'vitest';
import { FakeEventSource } from './fakeEventSource';
import { resetStream } from '../lib/stream';
import { clearQueryCache } from '../lib/useQuery';

// Every page holds a shared EventSource through useTopic, and jsdom has none.
// Stubbing it here rather than per file means a component that grows a live
// topic doesn't break the tests of whatever happens to render it.
beforeEach(() => {
  FakeEventSource.instances = [];
  vi.stubGlobal('EventSource', FakeEventSource);
});

afterEach(() => {
  cleanup();
  // Both live-data layers are module singletons. Without clearing them a test
  // silently inherits the previous one's values — and since widgets fetch
  // their own data through the shared cache, that now reaches much further
  // than the page under test.
  resetStream();
  clearQueryCache();
  localStorage.clear();
});
