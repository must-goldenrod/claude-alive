import '@testing-library/jest-dom/vitest';
import '@claude-alive/i18n';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { MobileTicketCompose } from '../MobileTicketCompose.tsx';

afterEach(cleanup);

beforeEach(() => {
  // The branch list comes from the allowlisted endpoint; stub it so the
  // composer renders deterministically.
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ current: 'main', branches: ['main', 'dev'] }), { status: 200 })));
});

const projects = [
  { path: '/Users/me/work/app', name: 'app' },
  { path: '/Users/me/work/site', name: 'site' },
];

const solve = () => screen.getByRole('button', { name: /Solve|만들기|생성/i });
const goalBox = () => screen.getByPlaceholderText(/목표|goal/i);

describe('MobileTicketCompose', () => {
  it('will not submit without a goal — the one field that cannot be guessed', () => {
    render(<MobileTicketCompose projects={projects} onCancel={() => {}} onCreate={vi.fn()} />);
    expect(solve()).toBeDisabled();
  });

  it('preselects the only project so a one-project user types nothing but the goal', async () => {
    const onCreate = vi.fn(async () => null);
    render(<MobileTicketCompose projects={[projects[0]!]} onCancel={() => {}} onCreate={onCreate} />);
    fireEvent.change(goalBox(), { target: { value: '버그 수정' } });
    fireEvent.click(solve());
    await waitFor(() =>
      expect(onCreate).toHaveBeenCalledWith(
        expect.objectContaining({ goal: '버그 수정', cwd: '/Users/me/work/app', preset: 'standard' }),
      ),
    );
  });

  it('picks a folder from a bottom sheet rather than an inline list', async () => {
    const onCreate = vi.fn(async () => null);
    render(<MobileTicketCompose projects={projects} onCancel={() => {}} onCreate={onCreate} />);
    // Nothing is chosen yet, so the field invites a choice.
    fireEvent.click(screen.getByRole('button', { name: /폴더|folder/i }));
    fireEvent.click(await screen.findByRole('button', { name: 'site' }));
    fireEvent.change(goalBox(), { target: { value: '작업' } });
    fireEvent.click(solve());
    await waitFor(() => expect(onCreate).toHaveBeenCalledWith(expect.objectContaining({ cwd: '/Users/me/work/site' })));
  });

  it('carries the chosen run profile', async () => {
    const onCreate = vi.fn(async () => null);
    render(<MobileTicketCompose projects={[projects[0]!]} onCancel={() => {}} onCreate={onCreate} />);
    fireEvent.change(goalBox(), { target: { value: '작업' } });
    fireEvent.click(screen.getByRole('radio', { name: /심층|Deep/ }));
    fireEvent.click(solve());
    await waitFor(() => expect(onCreate).toHaveBeenCalledWith(expect.objectContaining({ preset: 'deep' })));
  });

  it('carries the three run switches, which default on as they do on the desktop', async () => {
    const onCreate = vi.fn(async () => null);
    render(<MobileTicketCompose projects={[projects[0]!]} onCancel={() => {}} onCreate={onCreate} />);
    fireEvent.change(goalBox(), { target: { value: '작업' } });
    const switches = screen.getAllByRole('switch');
    expect(switches).toHaveLength(3);
    expect(switches.every((s) => s.getAttribute('aria-checked') === 'true')).toBe(true);
    fireEvent.click(switches[2]!);
    fireEvent.click(solve());
    await waitFor(() =>
      expect(onCreate).toHaveBeenCalledWith(
        expect.objectContaining({ orchestrated: true, autoCommit: true, panelReview: false }),
      ),
    );
  });

  it('offers local and ssh, and defaults to local', () => {
    render(<MobileTicketCompose projects={projects} onCancel={() => {}} onCreate={vi.fn()} />);
    const local = screen.getByRole('radio', { name: /로컬|Local/ });
    expect(local).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('radio', { name: /SSH/i })).toBeInTheDocument();
  });

  it('shows the branch the folder is on once one is chosen', async () => {
    render(<MobileTicketCompose projects={[projects[0]!]} onCancel={() => {}} onCreate={vi.fn()} />);
    expect(await screen.findByRole('button', { name: 'main' })).toBeInTheDocument();
  });

  it('shows the server error instead of failing silently', async () => {
    render(
      <MobileTicketCompose
        projects={[projects[0]!]}
        onCancel={() => {}}
        onCreate={async () => 'cwd is not in the ticket-root allowlist'}
      />,
    );
    fireEvent.change(goalBox(), { target: { value: '작업' } });
    fireEvent.click(solve());
    expect(await screen.findByText(/allowlist/)).toBeInTheDocument();
  });

  it('tells the user what to do when no project is available', async () => {
    render(<MobileTicketCompose projects={[]} onCancel={() => {}} onCreate={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /폴더|folder/i }));
    expect(await screen.findByText(/CLAUDE_ALIVE_TICKET_ROOTS/)).toBeInTheDocument();
  });
});
