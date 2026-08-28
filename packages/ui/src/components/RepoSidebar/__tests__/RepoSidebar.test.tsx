import '@testing-library/jest-dom/vitest';
import '@claude-alive/i18n';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { RunTree } from '@claude-alive/core';
import { RepoSidebar } from '../RepoSidebar.tsx';
import { EMPTY_SELECTION } from '../../../state/selection.ts';

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
  render(
    <RepoSidebar tree={TREE} selection={EMPTY_SELECTION} onAction={onAction} onNewRun={onNewRun} {...overrides} />,
  );
  return { onAction, onNewRun };
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
});
