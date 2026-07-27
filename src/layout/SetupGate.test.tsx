import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { SETUP_COMPLETE_EVENT, SetupGate } from './SetupGate';

const api = vi.hoisted(() => ({ getSetupState: vi.fn() }));

vi.mock('../api', async (importOriginal) => ({
  ...await importOriginal<typeof import('../api')>(),
  ...api,
}));

const renderAt = (path: string) =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <SetupGate>
        <Routes>
          <Route path="/" element={<p>dashboard</p>} />
          <Route path="/setup" element={<p>wizard</p>} />
        </Routes>
      </SetupGate>
    </MemoryRouter>,
  );

describe('SetupGate', () => {
  beforeEach(() => vi.clearAllMocks());

  it('sends an unclaimed install to the wizard', async () => {
    api.getSetupState.mockResolvedValue({ needed: true, completedAt: null, adminPinSet: false, hasCampus: false });
    renderAt('/');
    expect(await screen.findByText('wizard')).toBeInTheDocument();
  });

  it('leaves a configured install alone', async () => {
    api.getSetupState.mockResolvedValue({ needed: false, completedAt: 1, adminPinSet: true, hasCampus: true });
    renderAt('/');
    expect(await screen.findByText('dashboard')).toBeInTheDocument();
  });

  it('sends a finished install away from the wizard', async () => {
    api.getSetupState.mockResolvedValue({ needed: false, completedAt: 1, adminPinSet: true, hasCampus: true });
    renderAt('/setup');
    expect(await screen.findByText('dashboard')).toBeInTheDocument();
  });

  it('stops redirecting the moment setup completes', async () => {
    // The wizard's last step announces before it navigates, so the gate is
    // already settled when the new route renders — otherwise finishing setup
    // would bounce straight back into it.
    api.getSetupState.mockResolvedValue({ needed: true, completedAt: null, adminPinSet: false, hasCampus: false });
    renderAt('/');
    await screen.findByText('wizard');

    window.dispatchEvent(new Event(SETUP_COMPLETE_EVENT));

    expect(await screen.findByText('dashboard')).toBeInTheDocument();
  });

  it('fails open when the server cannot be reached', async () => {
    // A booth screen on a Sunday morning must not be held hostage by a setup
    // check that timed out.
    api.getSetupState.mockRejectedValue(new Error('offline'));
    renderAt('/');
    await waitFor(() => expect(screen.getByText('dashboard')).toBeInTheDocument());
  });
});
