import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Run, RunTree, Worktree } from '@claude-alive/core';
import { Badge, EmptyState, StatusDot, space, text, type BadgeTone } from '../ui/index.ts';
import type { Selection, SelectionAction } from '../../state/selection.ts';
import { RunCard } from '../RunCard.tsx';
import { buildTree, oldestOpenAge, type RepoNode, type WorktreeNode } from './runTree.ts';

const STATE_TONE: Record<Run['state'], BadgeTone> = {
  running: 'blue',
  waiting: 'amber',
  closed: 'neutral',
  abandoned: 'neutral',
};

interface RepoSidebarProps {
  tree: RunTree;
  selection: Selection;
  onAction: (action: SelectionAction) => void;
  onNewRun: (worktree: Worktree) => void;
  /** File the focused run away with a one-line result. */
  onCloseRun: (runId: string, outcome: string) => void;
  /** File the focused run away without a result. */
  onAbandonRun: (runId: string) => void;
}

/**
 * The one hierarchy every view shares: repo → branch/worktree → run.
 *
 * It owns no data of its own; it renders whatever `buildTree` produced and
 * reports clicks upward as selection actions.
 */
export function RepoSidebar({
  tree, selection, onAction, onNewRun, onCloseRun, onAbandonRun,
}: RepoSidebarProps) {
  const { t } = useTranslation();
  const nodes = buildTree(tree, selection);
  const openCount = nodes.reduce((sum, n) => sum + n.openCount, 0);
  const oldest = oldestOpenAge(tree, Date.now());

  return (
    <nav
      aria-label={t('sidebar.title')}
      style={{
        width: 280,
        flexShrink: 0,
        height: '100%',
        overflowY: 'auto',
        borderRight: '1px solid var(--border-color)',
        background: 'var(--bg-primary)',
        padding: space[3],
        boxSizing: 'border-box',
        fontFamily: 'var(--font-ui)',
      }}
    >
      <button
        type="button"
        data-testid="open-summary"
        onClick={() => onAction({ type: 'toggleOpenOnly' })}
        style={{
          display: 'flex', alignItems: 'center', gap: space[2], width: '100%',
          padding: space[2], marginBottom: space[3],
          border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)',
          background: selection.openOnly ? 'rgba(88,166,255,0.10)' : 'transparent',
          color: 'var(--text-secondary)', fontSize: text.sm, cursor: 'pointer',
        }}
      >
        <span>{t('sidebar.openSummary', { count: openCount })}</span>
        {oldest !== null && (
          <span style={{ marginLeft: 'auto', fontFamily: 'var(--font-mono)', fontSize: text.xs, opacity: 0.7 }}>
            {t('sidebar.oldest', { age: formatAge(oldest) })}
          </span>
        )}
      </button>

      {nodes.length === 0 ? (
        <div data-testid="sidebar-empty">
          <EmptyState message={t('sidebar.noRepos')} />
        </div>
      ) : (
        nodes.map((node) => (
          <RepoRow
            key={node.repo.repoId}
            node={node}
            selection={selection}
            onAction={onAction}
            onNewRun={onNewRun}
            onCloseRun={onCloseRun}
            onAbandonRun={onAbandonRun}
          />
        ))
      )}
    </nav>
  );
}

function RepoRow({
  node, selection, onAction, onNewRun, onCloseRun, onAbandonRun,
}: {
  node: RepoNode;
  selection: Selection;
  onAction: (a: SelectionAction) => void;
  onNewRun: (w: Worktree) => void;
  onCloseRun: (runId: string, outcome: string) => void;
  onAbandonRun: (runId: string) => void;
}) {
  const selected = selection.repoId === node.repo.repoId;
  const select = () => onAction({ type: 'selectRepo', repoId: node.repo.repoId });
  return (
    <div style={{ marginBottom: space[2] }}>
      <div
        role="button"
        tabIndex={0}
        data-testid={`repo-row-${node.repo.repoId}`}
        data-selected={selected ? 'true' : 'false'}
        onClick={select}
        onKeyDown={(e) => { if (e.key === 'Enter') select(); }}
        style={{
          display: 'flex', alignItems: 'center', gap: space[2],
          padding: space[2], borderRadius: 'var(--radius-md)',
          background: selected ? 'rgba(88,166,255,0.10)' : 'transparent',
          color: 'var(--text-primary)', fontSize: text.base, fontWeight: 600, cursor: 'pointer',
        }}
      >
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {node.repo.name ?? node.repo.root}
        </span>
        <span style={{ marginLeft: 'auto' }} data-testid={`repo-open-count-${node.repo.repoId}`}>
          <Badge tone={node.openCount > 0 ? 'amber' : 'neutral'}>{node.openCount}</Badge>
        </span>
      </div>

      {node.worktrees.map((wt) => (
        <WorktreeRow
          key={wt.worktree.worktreeId}
          node={wt}
          selection={selection}
          onAction={onAction}
          onNewRun={onNewRun}
          onCloseRun={onCloseRun}
          onAbandonRun={onAbandonRun}
        />
      ))}
    </div>
  );
}

function WorktreeRow({
  node, selection, onAction, onNewRun, onCloseRun, onAbandonRun,
}: {
  node: WorktreeNode;
  selection: Selection;
  onAction: (a: SelectionAction) => void;
  onNewRun: (w: Worktree) => void;
  onCloseRun: (runId: string, outcome: string) => void;
  onAbandonRun: (runId: string) => void;
}) {
  const { t } = useTranslation();
  const [showClosed, setShowClosed] = useState(false);
  const selected = selection.worktreeId === node.worktree.worktreeId;
  const select = () =>
    onAction({ type: 'selectWorktree', repoId: node.worktree.repoId, worktreeId: node.worktree.worktreeId });

  const open = node.runs.filter((r) => r.state === 'running' || r.state === 'waiting');
  const closed = node.runs.filter((r) => r.state === 'closed' || r.state === 'abandoned');
  const shown = showClosed ? [...open, ...closed] : open;

  return (
    <div style={{ marginLeft: space[3] }}>
      <div
        role="button"
        tabIndex={0}
        data-testid={`worktree-row-${node.worktree.worktreeId}`}
        data-selected={selected ? 'true' : 'false'}
        onClick={select}
        onKeyDown={(e) => { if (e.key === 'Enter') select(); }}
        style={{
          display: 'flex', alignItems: 'center', gap: space[2],
          padding: `${space[1]} ${space[2]}`, borderRadius: 'var(--radius-sm)',
          background: selected ? 'rgba(88,166,255,0.08)' : 'transparent',
          color: 'var(--text-secondary)', fontFamily: 'var(--font-mono)', fontSize: text.sm, cursor: 'pointer',
        }}
      >
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {node.worktree.branch || t('sidebar.detached')}
        </span>
        <span style={{ marginLeft: 'auto', display: 'flex', gap: space[1], alignItems: 'center' }}>
          <Badge tone={node.openCount > 0 ? 'amber' : 'neutral'}>{node.openCount}</Badge>
          <button
            type="button"
            data-testid={`new-run-${node.worktree.worktreeId}`}
            title={t('sidebar.newRun')}
            onClick={(e) => { e.stopPropagation(); onNewRun(node.worktree); }}
            style={{
              border: 'none', background: 'transparent', color: 'var(--text-secondary)',
              cursor: 'pointer', fontSize: text.base, lineHeight: 1, padding: 0,
            }}
          >
            +
          </button>
        </span>
      </div>

      {shown.map((run) => (
        <div key={run.runId}>
          <div
          role="button"
          tabIndex={0}
          data-testid={`run-row-${run.runId}`}
          data-selected={selection.runId === run.runId ? 'true' : 'false'}
          onClick={() => onAction({ type: 'focusRun', run })}
          onKeyDown={(e) => { if (e.key === 'Enter') onAction({ type: 'focusRun', run }); }}
          style={{
            display: 'flex', alignItems: 'center', gap: space[2],
            marginLeft: space[3], padding: `${space[1]} ${space[2]}`,
            borderRadius: 'var(--radius-sm)',
            background: selection.runId === run.runId ? 'rgba(88,166,255,0.14)' : 'transparent',
            color: 'var(--text-primary)', fontSize: text.sm, cursor: 'pointer',
          }}
        >
          <StatusDot tone={STATE_TONE[run.state]} pulse={run.state === 'running'} />
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {run.meta?.seq !== undefined ? `#${run.meta.seq} ` : ''}{run.title}
          </span>
          </div>
          {/* The focused run expands in place. Closing lives here rather than in
              one view so a run can be filed away from wherever you noticed it. */}
          {selection.runId === run.runId && (
            <div style={{ marginLeft: space[3], marginTop: space[1], marginBottom: space[2] }}>
              <RunCard
                run={run}
                onOpen={(target) => onAction({ type: 'focusRun', run: target })}
                onClose={onCloseRun}
                onAbandon={onAbandonRun}
              />
            </div>
          )}
        </div>
      ))}

      {closed.length > 0 && (
        <button
          type="button"
          data-testid={`show-closed-${node.worktree.worktreeId}`}
          onClick={() => setShowClosed((v) => !v)}
          style={{
            marginLeft: space[3], padding: `${space[1]} ${space[2]}`,
            border: 'none', background: 'transparent', color: 'var(--text-secondary)',
            fontSize: text.xs, opacity: 0.6, cursor: 'pointer',
          }}
        >
          {t('sidebar.showClosed', { count: closed.length })}
        </button>
      )}
    </div>
  );
}

/** Coarse age for the summary line: minutes under an hour, then hours, then days. */
function formatAge(ms: number): string {
  const minutes = Math.floor(ms / 60000);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}
