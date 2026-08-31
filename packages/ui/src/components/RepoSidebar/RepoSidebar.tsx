import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Run, RunTree, Worktree } from '@claude-alive/core';
import { Badge, EmptyState, HierarchyIcon, StatusDot, space, text, toneColor, type BadgeTone } from '../ui/index.ts';
import type { Selection, SelectionAction } from '../../state/selection.ts';
import { isRepoExpanded, type ExpandState } from '../../state/sidebarExpand.ts';
import { RunCard } from '../RunCard.tsx';
import { dispatchOpenRun } from '../../state/openRun.ts';
import { useNow } from '../../views/dashboard/hooks/useNow.ts';
import { formatAge } from '../../utils/age.ts';
import {
  buildTree, oldestOpenAge, openCostUsd, runLastActivityAt,
  type RepoNode, type WorktreeNode,
} from './runTree.ts';

const STATE_TONE: Record<Run['state'], BadgeTone> = {
  running: 'blue',
  waiting: 'amber',
  closed: 'neutral',
  abandoned: 'neutral',
};

const STATE_LABEL: Record<Run['state'], string> = {
  running: 'sidebar.stateRunning',
  waiting: 'sidebar.stateWaiting',
  closed: 'sidebar.stateClosed',
  abandoned: 'sidebar.stateAbandoned',
};

interface RepoSidebarProps {
  tree: RunTree;
  selection: Selection;
  onAction: (action: SelectionAction) => void;
  /** Which repositories are collapsed. Independent of the filter. */
  expand: ExpandState;
  /** Toggle exactly one repository open/closed. */
  onToggleRepo: (repoId: string) => void;
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
 *
 * Two clicks live on a repo row and they mean different things: the chevron
 * expands it (sidebar-local), the name filters every view to it (app-wide).
 * They used to be the same click, which is why the sidebar read as if it were
 * randomly hiding work.
 */
export function RepoSidebar({
  tree, selection, onAction, expand, onToggleRepo, onNewRun, onCloseRun, onAbandonRun,
}: RepoSidebarProps) {
  const { t } = useTranslation();
  const now = useNow();
  const nodes = buildTree(tree, selection);
  const openCount = nodes.reduce((sum, n) => sum + n.openCount, 0);
  const oldest = oldestOpenAge(tree, now);
  const spend = openCostUsd(tree);
  const filtering = selection.repoId !== null || selection.worktreeId !== null;
  const filteredRepoName = filtering
    ? tree.repositories.find((r) => r.repoId === selection.repoId)?.name ?? selection.repoId
    : null;

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
      {/* Filtering used to be invisible: the choice persisted across reloads, so
          a board that looked empty was often just narrowed. This row states the
          filter and is the one place that clears it. */}
      <button
        type="button"
        data-testid="all-repos"
        aria-pressed={!filtering}
        onClick={() => onAction({ type: 'clear' })}
        style={{
          display: 'flex', alignItems: 'center', gap: space[2], width: '100%',
          padding: space[2], marginBottom: space[2],
          border: `1px solid ${filtering ? 'var(--accent-blue)' : 'var(--border-color)'}`,
          borderRadius: 'var(--radius-md)',
          background: filtering ? 'rgba(88,166,255,0.10)' : 'transparent',
          color: 'var(--text-primary)', fontSize: text.sm, fontWeight: 600, cursor: 'pointer',
          textAlign: 'left',
        }}
      >
        <span>{filtering ? t('sidebar.filteredBanner', { name: filteredRepoName }) : t('sidebar.allRepos')}</span>
        <span style={{ marginLeft: 'auto', fontSize: text.xs, fontWeight: 500, color: 'var(--text-secondary)' }}>
          {filtering ? t('sidebar.clearFilter') : t('sidebar.allReposHint')}
        </span>
      </button>

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
        <span style={{ marginLeft: 'auto', display: 'flex', gap: space[2], alignItems: 'baseline', fontFamily: 'var(--font-mono)', fontSize: text.xs, opacity: 0.75 }}>
          {spend > 0 && <span data-testid="open-spend">${spend.toFixed(2)}</span>}
          {oldest !== null && <span>{t('sidebar.oldest', { age: formatAge(oldest) })}</span>}
        </span>
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
            expanded={isRepoExpanded(expand, node.repo.repoId)}
            onToggleRepo={onToggleRepo}
            now={now}
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
  node, selection, expanded, onToggleRepo, now, onAction, onNewRun, onCloseRun, onAbandonRun,
}: {
  node: RepoNode;
  selection: Selection;
  expanded: boolean;
  onToggleRepo: (repoId: string) => void;
  now: number;
  onAction: (a: SelectionAction) => void;
  onNewRun: (w: Worktree) => void;
  onCloseRun: (runId: string, outcome: string) => void;
  onAbandonRun: (runId: string) => void;
}) {
  const { t } = useTranslation();
  const selected = selection.repoId === node.repo.repoId;
  const select = () => onAction({ type: 'selectRepo', repoId: node.repo.repoId });
  const name = node.repo.name ?? node.repo.root;
  return (
    <div style={{ marginBottom: space[2] }}>
      <div
        style={{
          display: 'flex', alignItems: 'center', gap: space[1],
          borderRadius: 'var(--radius-md)',
          background: selected ? 'rgba(88,166,255,0.10)' : 'transparent',
        }}
      >
        <button
          type="button"
          data-testid={`repo-toggle-${node.repo.repoId}`}
          aria-expanded={expanded}
          aria-label={expanded ? t('sidebar.collapse', { name }) : t('sidebar.expand', { name })}
          onClick={() => onToggleRepo(node.repo.repoId)}
          style={{
            border: 'none', background: 'transparent', color: 'var(--text-secondary)',
            cursor: 'pointer', padding: `${space[2]} 2px ${space[2]} ${space[2]}`,
            fontSize: 10, lineHeight: 1, width: 20, flexShrink: 0,
          }}
        >
          {expanded ? '▾' : '▸'}
        </button>
        <div
          role="button"
          tabIndex={0}
          data-testid={`repo-row-${node.repo.repoId}`}
          data-selected={selected ? 'true' : 'false'}
          onClick={select}
          onKeyDown={(e) => { if (e.key === 'Enter') select(); }}
          style={{
            display: 'flex', alignItems: 'center', gap: space[2], flex: 1, minWidth: 0,
            padding: `${space[2]} ${space[2]} ${space[2]} 0`,
            color: 'var(--text-primary)', fontSize: text.base, fontWeight: 600, cursor: 'pointer',
          }}
        >
          <HierarchyIcon level="repo" color="var(--accent-purple)" />
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {name}
          </span>
          <ActivityAge at={node.lastActivityAt} now={now} testId={`repo-age-${node.repo.repoId}`} />
          <span style={{ flexShrink: 0 }} data-testid={`repo-open-count-${node.repo.repoId}`}>
            <Badge tone={node.openCount > 0 ? 'amber' : 'neutral'}>{node.openCount}</Badge>
          </span>
        </div>
      </div>

      {expanded && node.worktrees.map((wt) => (
        <WorktreeRow
          key={wt.worktree.worktreeId}
          node={wt}
          selection={selection}
          now={now}
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
  node, selection, now, onAction, onNewRun, onCloseRun, onAbandonRun,
}: {
  node: WorktreeNode;
  selection: Selection;
  now: number;
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
        <HierarchyIcon level="branch" color="var(--accent-teal)" />
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {node.worktree.branch || t('sidebar.detached')}
        </span>
        <span style={{ marginLeft: 'auto', display: 'flex', gap: space[1], alignItems: 'center', flexShrink: 0 }}>
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
          <HierarchyIcon level={run.kind} color={toneColor[STATE_TONE[run.state]]} size={12} />
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {run.meta?.seq !== undefined ? `#${run.meta.seq} ` : ''}{firstLine(run.title)}
          </span>
          {/* State in words, not only a colour: "waiting" on this board means
              "finished, nobody filed it", which no dot can convey. */}
          <span
            data-testid={`run-state-${run.runId}`}
            style={{
              marginLeft: 'auto', flexShrink: 0, fontSize: text.xs,
              color: toneColor[STATE_TONE[run.state]], opacity: 0.85,
            }}
          >
            {t(STATE_LABEL[run.state])}
          </span>
          <ActivityAge at={runLastActivityAt(run)} now={now} testId={`run-age-${run.runId}`} noGrow />
          </div>
          {/* The focused run expands in place. Closing lives here rather than in
              one view so a run can be filed away from wherever you noticed it. */}
          {selection.runId === run.runId && (
            <div style={{ marginLeft: space[3], marginTop: space[1], marginBottom: space[2] }}>
              <RunCard
                run={run}
                onOpen={dispatchOpenRun}
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
          aria-expanded={showClosed}
          onClick={() => setShowClosed((v) => !v)}
          style={{
            marginLeft: space[3], padding: `${space[1]} ${space[2]}`,
            border: 'none', background: 'transparent', color: 'var(--text-secondary)',
            fontSize: text.xs, opacity: 0.6, cursor: 'pointer',
          }}
        >
          {showClosed ? '▾ ' : '▸ '}{t('sidebar.showClosed', { count: closed.length })}
        </button>
      )}
    </div>
  );
}

/** "2m ago" beside a row, or nothing at all when there is no activity to date. */
function ActivityAge({
  at, now, testId, noGrow,
}: {
  at: number | null;
  now: number;
  testId: string;
  noGrow?: boolean;
}) {
  const { t } = useTranslation();
  return (
    <span
      data-testid={testId}
      title={at === null ? t('sidebar.noActivity') : new Date(at).toLocaleString()}
      style={{
        marginLeft: noGrow ? undefined : 'auto',
        flexShrink: 0,
        fontFamily: 'var(--font-mono)',
        fontSize: text.xs,
        fontWeight: 400,
        color: 'var(--text-secondary)',
        opacity: 0.7,
      }}
    >
      {at === null ? '–' : t('sidebar.lastActivity', { age: formatAge(Math.max(0, now - at)) })}
    </span>
  );
}

/**
 * A run's title is the ticket's whole goal, which can run to thousands of
 * characters over many lines. Ellipsis alone does not help once newlines
 * collapse to spaces, so take the first meaningful line.
 */
function firstLine(title: string): string {
  return title.split('\n').find((l) => l.trim().length > 0)?.trim() ?? title;
}
