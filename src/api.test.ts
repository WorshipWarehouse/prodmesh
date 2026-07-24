// Contract tests for the fetch wrapper itself. Every UI test mocks ../api
// wholesale, so this file is where header attachment, error translation, and
// the override/permission protocols are verified against real fetch calls.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getRoom,
  getRoomState,
  setRoomMode,
  setToken,
  setStationToken,
  OverrideRequiredError,
} from './api';

// Minimal Response stand-in — enough for getJson/requireOk (ok, status,
// json, and the clone() requireOk uses to double-read 403 bodies).
function jsonRes(status: number, body: unknown) {
  const res = {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    clone: () => res,
  };
  return res;
}

const fetchMock = vi.fn();

beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('request headers', () => {
  it('attaches bearer and station tokens from localStorage', async () => {
    setToken('admin-tok');
    setStationToken('station-tok');
    fetchMock.mockResolvedValue(jsonRes(200, { id: 'main' }));

    await getRoom('main');

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/rooms/main');
    expect(init.headers).toMatchObject({
      Authorization: 'Bearer admin-tok',
      'X-Prodmesh-Station': 'station-tok',
    });
  });

  it('sends no auth headers when nothing is stored, and URL-encodes room ids', async () => {
    fetchMock.mockResolvedValue(jsonRes(200, {}));

    await getRoomState('room one');

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/rooms/room%20one/state');
    expect(init.headers).not.toHaveProperty('Authorization');
    expect(init.headers).not.toHaveProperty('X-Prodmesh-Station');
  });
});

describe('error translation', () => {
  it('getJson throws HTTP <status> on a non-OK response', async () => {
    fetchMock.mockResolvedValue(jsonRes(500, {}));
    await expect(getRoom('main')).rejects.toThrow('HTTP 500');
  });

  it('setRoomMode turns 403 override_required into OverrideRequiredError', async () => {
    fetchMock.mockResolvedValue(jsonRes(403, { error: 'override_required', mode: 'off' }));
    await expect(setRoomMode('main', 'off')).rejects.toBeInstanceOf(OverrideRequiredError);
  });

  it('403 permission_required fires the auth-required event and throws', async () => {
    fetchMock.mockResolvedValue(
      jsonRes(403, { error: 'permission_required', permission: 'rooms.control' }),
    );
    const seen = vi.fn();
    const listener = (e: Event) => seen((e as CustomEvent).detail);
    window.addEventListener('prodmesh:auth-required', listener);

    await expect(setRoomMode('main', 'show')).rejects.toThrow('permission_required');
    expect(seen).toHaveBeenCalledWith({ permission: 'rooms.control' });
    window.removeEventListener('prodmesh:auth-required', listener);
  });

  it('propagates the server error message from the response body', async () => {
    fetchMock.mockResolvedValue(jsonRes(400, { error: 'unknown mode' }));
    await expect(setRoomMode('main', 'nope')).rejects.toThrow('unknown mode');
  });
});

describe('happy path', () => {
  it('setRoomMode POSTs the mode + PIN and returns the new state', async () => {
    const next = { mode: 'off', raw: 'off', online: true, source: 'companion' };
    fetchMock.mockResolvedValue(jsonRes(200, next));

    const state = await setRoomMode('main', 'off', '4457');

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/rooms/main/mode');
    expect(init.method).toBe('POST');
    expect(init.headers['Content-Type']).toBe('application/json');
    expect(JSON.parse(init.body)).toEqual({ mode: 'off', overridePin: '4457' });
    expect(state).toEqual(next);
  });
});
