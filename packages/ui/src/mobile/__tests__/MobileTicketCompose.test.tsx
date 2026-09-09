import '@testing-library/jest-dom/vitest';
import '@claude-alive/i18n';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { describe, it, expect, afterEach, vi } from 'vitest';
import { MobileTicketCompose } from '../MobileTicketCompose.tsx';

afterEach(cleanup);

const projects = [
  { path: '/Users/me/work/app', name: 'app' },
  { path: '/Users/me/work/site', name: 'site' },
];

describe('MobileTicketCompose', () => {
  it('will not submit without a goal — the one field that cannot be guessed', () => {
    render(<MobileTicketCompose projects={projects} onCancel={() => {}} onCreate={vi.fn()} />);
    expect(screen.getByRole('button', { name: /만들기|Create/ })).toBeDisabled();
  });

  it('preselects the only project so a one-project user types nothing but the goal', () => {
    const onCreate = vi.fn(async () => null);
    render(<MobileTicketCompose projects={[projects[0]!]} onCancel={() => {}} onCreate={onCreate} />);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '버그 수정' } });
    fireEvent.click(screen.getByRole('button', { name: /만들기|Create/ }));
    expect(onCreate).toHaveBeenCalledWith('버그 수정', '/Users/me/work/app', 'standard');
  });

  it('sends the project the user picked', async () => {
    const onCreate = vi.fn(async () => null);
    render(<MobileTicketCompose projects={projects} onCancel={() => {}} onCreate={onCreate} />);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '작업' } });
    fireEvent.click(screen.getByRole('radio', { name: 'site' }));
    fireEvent.click(screen.getByRole('button', { name: /만들기|Create/ }));
    await waitFor(() => expect(onCreate).toHaveBeenCalledWith('작업', '/Users/me/work/site', 'standard'));
  });

  it('carries the chosen run profile', async () => {
    const onCreate = vi.fn(async () => null);
    render(<MobileTicketCompose projects={[projects[0]!]} onCancel={() => {}} onCreate={onCreate} />);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '작업' } });
    fireEvent.click(screen.getByRole('radio', { name: /심층|Deep/ }));
    fireEvent.click(screen.getByRole('button', { name: /만들기|Create/ }));
    await waitFor(() => expect(onCreate).toHaveBeenCalledWith('작업', '/Users/me/work/app', 'deep'));
  });

  it('shows the server error instead of failing silently', async () => {
    render(
      <MobileTicketCompose
        projects={[projects[0]!]}
        onCancel={() => {}}
        onCreate={async () => 'cwd is not in the ticket-root allowlist'}
      />,
    );
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '작업' } });
    fireEvent.click(screen.getByRole('button', { name: /만들기|Create/ }));
    expect(await screen.findByText(/allowlist/)).toBeInTheDocument();
  });

  it('tells the user what to do when no project is available', () => {
    render(<MobileTicketCompose projects={[]} onCancel={() => {}} onCreate={vi.fn()} />);
    expect(screen.getByText(/CLAUDE_ALIVE_TICKET_ROOTS/)).toBeInTheDocument();
  });
});
