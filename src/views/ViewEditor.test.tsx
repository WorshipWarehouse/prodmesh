import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { ViewEditor } from './ViewEditor';
import { GRID } from '../lib/gridLayout';
import type { View, ViewPlacement } from '../api';

// Driven by the Add button and the keyboard, NOT by simulated pointer events.
// jsdom has no layout, so every rect is zero and a fake drag would certify
// nothing. That is also why those two paths exist: they are the complete,
// testable editor, and dragging is an enhancement on top.

vi.mock('../api', async (importOriginal) => ({
  ...await importOriginal<typeof import('../api')>(),
  getRoomService: vi.fn().mockResolvedValue({ configured: true, live: true, plans: [] }),
  getRoomPlan: vi.fn().mockResolvedValue({ live: true, plan: null }),
  getReport: vi.fn().mockResolvedValue({ items: [], totals: { planned: 0, actual: 0, delta: 0 }, completedAt: null }),
}));

const view = (widgets: ViewPlacement[], kind: View['kind'] = 'dashboard'): View => ({
  id: 'v1', roomId: 'north-main', kind, name: 'FOH', slug: 'foh',
  columns: kind === 'display' ? 3 : 6, maxRows: kind === 'display' ? 3 : null,
  scale: 1, position: 0, createdAt: 0, updatedAt: 0, widgets,
});

/** Stateful host, so a change actually comes back as new props. */
function Harness({ kind = 'dashboard' as View['kind'], initial = [] as ViewPlacement[] }) {
  const [widgets, setWidgets] = useState(initial);
  return (
    <ViewEditor
      view={view(widgets, kind)}
      grid={kind === 'display' ? GRID.display : GRID.dashboard}
      onChange={setWidgets}
    />
  );
}

const cells = () => [...document.querySelectorAll<HTMLElement>('.viewcell')];
const at = (type: string) => cells().find((c) => c.dataset.widget === type)!;
const status = () => screen.getByRole('status').textContent;

describe('ViewEditor', () => {
  it('Add places a widget at the first free cell and says where it went', async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await user.click(screen.getByRole('button', { name: 'Add Loudness' }));
    expect(at('loudness').style.gridColumn).toBe('1 / span 2');
    expect(status()).toBe('Loudness added at column 1, row 1.');

    // Find-first-fit, not "append": the next one goes beside it, not below.
    await user.click(screen.getByRole('button', { name: 'Add Countdown' }));
    expect(at('countdown').style.gridColumn).toBe('3 / span 2');
    expect(at('countdown').style.gridRow).toBe('1 / span 1');
  });

  it('a placed unique widget cannot be added twice', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const add = () => screen.getByRole('button', { name: 'Add Loudness' });

    expect(add()).toBeEnabled();
    await user.click(add());
    expect(add()).toBeDisabled();
    expect(screen.getByText('Already on this view')).toBeInTheDocument();

    // Removing it puts it back on offer.
    await user.click(screen.getByRole('button', { name: 'Remove Loudness' }));
    expect(cells()).toHaveLength(0);
    expect(add()).toBeEnabled();
  });

  it('packs a display into the gaps its widgets leave', async () => {
    const user = userEvent.setup();
    render(<Harness kind="display" />);

    // 2-wide on a 3-wide grid, so each leaves a single free column beside it.
    await user.click(screen.getByRole('button', { name: 'Add Countdown' }));
    expect(at('countdown').style.gridColumn).toBe('1 / span 2');
    await user.click(screen.getByRole('button', { name: 'Add Loudness' }));
    expect(at('loudness').style.gridRow).toBe('2 / span 1');

    // The 1-wide viewers fits that gap on row 1 rather than starting a row.
    await user.click(screen.getByRole('button', { name: 'Add Live viewers' }));
    expect(at('viewers').style.gridColumn).toBe('3 / span 1');
    expect(at('viewers').style.gridRow).toBe('1 / span 1');

    // All three placed and unique, so the palette offers nothing further.
    for (const name of ['Countdown', 'Loudness', 'Live viewers']) {
      expect(screen.getByRole('button', { name: `Add ${name}` })).toBeDisabled();
    }
  });

  it('says "No room left" rather than letting someone build a refused layout', async () => {
    // A display is a hard 3x3. Filled to a single free cell, nothing 2 wide
    // fits — the palette has to say that, not fail on save.
    render(<Harness kind="display" initial={[
      { id: 'a', type: 'loudness', x: 0, y: 0, w: 2, h: 3, config: {} },
      { id: 'b', type: 'viewers', x: 2, y: 0, w: 1, h: 2, config: {} },
    ]} />);

    const add = screen.getByRole('button', { name: 'Add Countdown' });
    expect(add).toBeDisabled();
    expect(add).toHaveAttribute('title', 'No room left');
    // Said on the entry itself, not only in a tooltip nobody hovers.
    const entry = screen.getByText('Countdown').closest('li')!;
    expect(within(entry).getByText('No room left')).toBeInTheDocument();
  });

  it('the keyboard moves a widget, announces it, and refuses a collision', async () => {
    const user = userEvent.setup();
    render(<Harness initial={[
      { id: 'a', type: 'countdown', x: 0, y: 0, w: 2, h: 1, config: {} },
      { id: 'b', type: 'loudness', x: 2, y: 0, w: 2, h: 1, config: {} },
    ]} />);

    const grip = screen.getByRole('button', { name: /Move Loudness/ });
    grip.focus();
    await user.keyboard('{Enter}');
    expect(grip).toHaveAttribute('aria-pressed', 'true');
    expect(status()).toBe('Loudness grabbed. Use the arrow keys.');

    await user.keyboard('{ArrowDown}');
    expect(at('loudness').style.gridRow).toBe('2 / span 1');
    expect(status()).toBe('Loudness at column 3, row 2.');

    // Now free to move left, because it dropped out of Countdown's row.
    await user.keyboard('{ArrowLeft}{ArrowLeft}');
    expect(at('loudness').style.gridColumn).toBe('1 / span 2');

    // Back up into Countdown is refused — and SAYS so, rather than silently
    // doing nothing, which is indistinguishable from a dead key.
    await user.keyboard('{ArrowUp}');
    expect(at('loudness').style.gridRow).toBe('2 / span 1');
    expect(status()).toBe('Loudness cannot move there.');

    // Off the left edge is refused too.
    await user.keyboard('{ArrowLeft}');
    expect(at('loudness').style.gridColumn).toBe('1 / span 2');
    expect(status()).toBe('Loudness cannot move there.');
  });

  it('Escape drops the grab, so the arrow keys stop moving things', async () => {
    const user = userEvent.setup();
    render(<Harness initial={[{ id: 'a', type: 'loudness', x: 0, y: 0, w: 2, h: 1, config: {} }]} />);

    const grip = screen.getByRole('button', { name: /Move Loudness/ });
    grip.focus();
    await user.keyboard('{Enter}{ArrowRight}');
    expect(at('loudness').style.gridColumn).toBe('2 / span 2');

    await user.keyboard('{Escape}');
    expect(screen.getByRole('button', { name: /Move Loudness/ })).toHaveAttribute('aria-pressed', 'false');
    await user.keyboard('{ArrowRight}');
    expect(at('loudness').style.gridColumn).toBe('2 / span 2');
  });

  it('the grip label carries the position, so it is not a mystery button', async () => {
    render(<Harness initial={[{ id: 'a', type: 'viewers', x: 4, y: 2, w: 2, h: 1, config: {} }]} />);
    expect(screen.getByRole('button', { name: 'Move Live viewers, column 5, row 3' })).toBeInTheDocument();
  });

  it('the palette shows each widget’s size, since the grid is what it competes for', () => {
    render(<Harness />);
    const loudness = screen.getByText('Loudness').closest('li')!;
    expect(within(loudness).getByText('2×1')).toBeInTheDocument();
  });
});
