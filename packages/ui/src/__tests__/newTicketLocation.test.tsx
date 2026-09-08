import '@testing-library/jest-dom/vitest';
import i18n from '@claude-alive/i18n';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { TicketLocation } from '@claude-alive/core';
import { NewTicketForm } from '../views/tickets/NewTicketForm.tsx';

const REMOTE: TicketLocation = {
  kind: 'ssh',
  ssh: { host: '10.0.0.2', user: 'build' },
  label: 'builder',
};

afterEach(cleanup);

/** Fill the goal and submit; the create button is the only enabled one. */
function submit() {
  fireEvent.change(screen.getByPlaceholderText(i18n.t('tickets.newGoalPlaceholder')), { target: { value: '작업' } });
  fireEvent.click(screen.getByRole('button', { name: i18n.t('tickets.create') }));
}

describe('NewTicketForm location', () => {
  it('submits a sidebar-seeded remote path with its host, not as a local run', async () => {
    const onCreate = vi.fn(async () => null);
    render(<NewTicketForm onCreate={onCreate} presetCwd="/srv/app" presetLocation={REMOTE} />);

    expect(screen.getByTestId('ticket-remote-note')).toHaveTextContent('build@10.0.0.2');
    submit();
    expect(onCreate).toHaveBeenCalledWith('작업', '/srv/app', REMOTE, false, expect.anything(), true, true);
  });

  it('keeps a local selection local', async () => {
    const onCreate = vi.fn(async () => null);
    render(<NewTicketForm onCreate={onCreate} presetCwd="/r/alive" />);

    expect(screen.queryByTestId('ticket-remote-note')).toBeNull();
    submit();
    expect(onCreate).toHaveBeenCalledWith('작업', '/r/alive', undefined, true, expect.anything(), true, true);
  });
});
