import '@testing-library/jest-dom/vitest';
import '@claude-alive/i18n';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { RunTree } from '@claude-alive/core';
import { RepoSidebar } from '../RepoSidebar.tsx';
import { EMPTY_SELECTION } from '../../../state/selection.ts';
import { EMPTY_EXPAND, toggleRepo } from '../../../state/sidebarExpand.ts';

const TREE: RunTree = {
  repositories: [{ repoId: 'r1', root: '/r/alive', name: 'alive', isGit: true }],
  worktrees: [
    { worktreeId: 'w1', repoId: 'r1', path: '/r/alive', branch: 'main', isPrimary: true },
    { worktreeId: 'w2', repoId: 'r1', path: '/r/wt', branch: 'feat/x', isPrimary: false },
  ],
  runs: [
    { runId: 'ticket:t1', repoId: 'r1', worktreeId: 'w1', kind: 'ticket', sourceId: 't1',
      title: '위임 모델 확장', state: 'running', startedAt: 1000, meta: { seq: 12 } },
    { runId: 'ticket:t2', repoId: 'r1', worktreeId: 'w1', kind: 'ticket', sourceId: 't2',
      title: '끝난 일', state: 'closed', startedAt: 900, outcome: '완료', closedAt: 1200 },
  ],
};

function setup(overrides: Partial<Parameters<typeof RepoSidebar>[0]> = {}) {
  const onAction = vi.fn();
  const onNewRun = vi.fn();
  const onCloseRun = vi.fn();
  const onAbandonRun = vi.fn();
  const onToggleRepo = vi.fn();
  render(
    <RepoSidebar
      tree={TREE}
      selection={EMPTY_SELECTION}
      onAction={onAction}
      expand={EMPTY_EXPAND}
      onToggleRepo={onToggleRepo}
      onNewRun={onNewRun}
      onCloseRun={onCloseRun}
      onAbandonRun={onAbandonRun}
      {...overrides}
    />,
  );
  return { onAction, onNewRun, onCloseRun, onAbandonRun, onToggleRepo };
}

afterEach(cleanup);

describe('RepoSidebar', () => {
  it('lists repositories with their open count', () => {
    setup();
    expect(screen.getByText('alive')).toBeInTheDocument();
    expect(screen.getByTestId('repo-open-count-r1')).toHaveTextContent('1');
  });

  it('shows branches under an expanded repository', () => {
    setup();
    expect(screen.getByText('main')).toBeInTheDocument();
    expect(screen.getByText('feat/x')).toBeInTheDocument();
  });

  it('hides closed runs behind a toggle', () => {
    setup();
    expect(screen.queryByText('끝난 일')).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId('show-closed-w1'));
    expect(screen.getByText('끝난 일')).toBeInTheDocument();
  });

  it('clicking a repository dispatches selectRepo', () => {
    const { onAction } = setup();
    fireEvent.click(screen.getByTestId('repo-row-r1'));
    expect(onAction).toHaveBeenCalledWith({ type: 'selectRepo', repoId: 'r1' });
  });

  it('clicking a branch dispatches selectWorktree', () => {
    const { onAction } = setup();
    fireEvent.click(screen.getByTestId('worktree-row-w1'));
    expect(onAction).toHaveBeenCalledWith({ type: 'selectWorktree', repoId: 'r1', worktreeId: 'w1' });
  });

  it('clicking a run dispatches focusRun with the whole run', () => {
    const { onAction } = setup();
    fireEvent.click(screen.getByTestId('run-row-ticket:t1'));
    expect(onAction).toHaveBeenCalledWith({ type: 'focusRun', run: TREE.runs[0] });
  });

  it('the new-run button reports the worktree it was pressed in', () => {
    const { onNewRun } = setup();
    fireEvent.click(screen.getByTestId('new-run-w2'));
    expect(onNewRun).toHaveBeenCalledWith(TREE.worktrees[1]);
  });

  it('the summary line reports the total open count', () => {
    setup();
    expect(screen.getByTestId('open-summary')).toHaveTextContent('1');
  });

  it('renders an empty state when there are no repositories', () => {
    setup({ tree: { repositories: [], worktrees: [], runs: [] } });
    expect(screen.getByTestId('sidebar-empty')).toBeInTheDocument();
  });

  it('marks the selected repository', () => {
    setup({ selection: { ...EMPTY_SELECTION, repoId: 'r1' } });
    expect(screen.getByTestId('repo-row-r1')).toHaveAttribute('data-selected', 'true');
  });
  it('shows no run card while nothing is focused', () => {
    setup();
    expect(screen.queryByTestId('run-close')).not.toBeInTheDocument();
  });

  it('renders the focused run card so closing is reachable from any view', () => {
    setup({ selection: { ...EMPTY_SELECTION, repoId: 'r1', worktreeId: 'w1', runId: 'ticket:t1' } });
    expect(screen.getByTestId('run-close')).toBeInTheDocument();
  });

  it('closing the focused run reports the run id and the typed outcome', () => {
    const { onCloseRun } = setup({
      selection: { ...EMPTY_SELECTION, repoId: 'r1', worktreeId: 'w1', runId: 'ticket:t1' },
    });
    fireEvent.click(screen.getByTestId('run-close'));
    const input = screen.getByTestId('run-outcome');
    fireEvent.change(input, { target: { value: '확장 완료' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onCloseRun).toHaveBeenCalledWith('ticket:t1', '확장 완료');
  });
  it('shows what the open runs have cost so far', () => {
    const tree = {
      ...TREE,
      runs: TREE.runs.map((r) =>
        r.runId === 'ticket:t1' ? { ...r, meta: { ...r.meta, costUsd: 1.5 } } : r,
      ),
    };
    setup({ tree });
    expect(screen.getByTestId('open-spend')).toHaveTextContent('$1.50');
  });

  it('omits the spend figure when nothing has cost anything', () => {
    setup();
    expect(screen.queryByTestId('open-spend')).not.toBeInTheDocument();
  });

  it('the chevron toggles only its own repository and never filters', () => {
    const { onToggleRepo, onAction } = setup();
    fireEvent.click(screen.getByTestId('repo-toggle-r1'));
    expect(onToggleRepo).toHaveBeenCalledWith('r1');
    expect(onAction).not.toHaveBeenCalled();
  });

  it('states whether a repository is expanded', () => {
    setup();
    expect(screen.getByTestId('repo-toggle-r1')).toHaveAttribute('aria-expanded', 'true');
    cleanup();
    setup({ expand: toggleRepo(EMPTY_EXPAND, 'r1') });
    expect(screen.getByTestId('repo-toggle-r1')).toHaveAttribute('aria-expanded', 'false');
  });

  it('hides the branches of a collapsed repository, keeping the repo itself', () => {
    setup({ expand: toggleRepo(EMPTY_EXPAND, 'r1') });
    expect(screen.getByTestId('repo-row-r1')).toBeInTheDocument();
    expect(screen.queryByTestId('worktree-row-w1')).not.toBeInTheDocument();
  });

  it('offers an all-projects row that clears the filter', () => {
    const { onAction } = setup({ selection: { ...EMPTY_SELECTION, repoId: 'r1' } });
    const all = screen.getByTestId('all-repos');
    expect(all).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(all);
    expect(onAction).toHaveBeenCalledWith({ type: 'clear' });
  });

  it('marks the all-projects row as active while nothing is filtered', () => {
    setup();
    expect(screen.getByTestId('all-repos')).toHaveAttribute('aria-pressed', 'true');
  });

  it('names the run state in words, not only by colour', () => {
    setup();
    expect(screen.getByTestId('run-state-ticket:t1')).toHaveTextContent(/running|실행중/);
  });

  it('shows a last-activity age on every run row', () => {
    setup();
    expect(screen.getByTestId('run-age-ticket:t1')).toBeInTheDocument();
  });

  it('shows only the first line of a multi-line goal', () => {
    const tree: RunTree = {
      ...TREE,
      runs: [{ ...TREE.runs[0]!, title: '첫 줄\n둘째 줄' }],
    };
    setup({ tree });
    expect(screen.queryByText(/둘째 줄/)).not.toBeInTheDocument();
  });
});
