import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useDraft } from './useDraft';

afterEach(() => {
  vi.useRealTimers();
});

describe('useDraft', () => {
  it('tracks dirty against the baseline and round-trips the saved draft', async () => {
    const save = vi.fn(async (d: { host: string }) => ({ host: d.host.trim() }));
    const { result } = renderHook(() => useDraft({ host: 'a' }, save));

    expect(result.current.dirty).toBe(false);
    act(() => result.current.patch({ host: ' b ' }));
    expect(result.current.dirty).toBe(true);

    await act(() => result.current.submit());
    expect(save).toHaveBeenCalledWith({ host: ' b ' });
    // The draft adopts the server-normalized value and becomes the baseline.
    expect(result.current.draft).toEqual({ host: 'b' });
    expect(result.current.dirty).toBe(false);
    expect(result.current.savedFlash).toBe(true);
  });

  it('clears the saved flash after ~2.5s', async () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useDraft({ v: 1 }, async (d) => d));

    act(() => result.current.patch({ v: 2 }));
    await act(() => result.current.submit());
    expect(result.current.savedFlash).toBe(true);

    act(() => { vi.advanceTimersByTime(2400); });
    expect(result.current.savedFlash).toBe(true);
    act(() => { vi.advanceTimersByTime(200); });
    expect(result.current.savedFlash).toBe(false);
  });

  it('surfaces a save error and stays dirty', async () => {
    const { result } = renderHook(() => useDraft({ v: 1 }, async () => {
      throw new Error('server said no');
    }));

    act(() => result.current.patch({ v: 2 }));
    await act(() => result.current.submit());
    expect(result.current.err).toBe('server said no');
    expect(result.current.dirty).toBe(true);
    expect(result.current.savedFlash).toBe(false);
    expect(result.current.busy).toBe(false);
  });

  it('guards against unload only while a mounted draft is dirty', async () => {
    const add = vi.spyOn(window, 'addEventListener');
    const remove = vi.spyOn(window, 'removeEventListener');
    const { result, unmount } = renderHook(() => useDraft({ v: 1 }, async (d) => d));

    expect(add).not.toHaveBeenCalledWith('beforeunload', expect.any(Function));
    act(() => result.current.patch({ v: 2 }));
    expect(add).toHaveBeenCalledWith('beforeunload', expect.any(Function));
    expect(remove).not.toHaveBeenCalledWith('beforeunload', expect.any(Function));

    // Saving makes the draft clean again — the guard lifts.
    await act(() => result.current.submit());
    expect(remove).toHaveBeenCalledWith('beforeunload', expect.any(Function));

    act(() => result.current.patch({ v: 3 }));
    unmount();
    // Unmounting the last dirty draft also lifts the guard.
    const removed = remove.mock.calls.filter(([type]) => type === 'beforeunload');
    expect(removed.length).toBe(2);
  });
});
