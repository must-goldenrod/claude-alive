import { useTranslation } from 'react-i18next';
import type { Run, RunTree, Worktree } from '@claude-alive/core';
import { Badge, EmptyState, HierarchyIcon, StatusDot, space, text, toneColor, type BadgeTone } from '../ui/index.ts';
import type { Selection, SelectionAction } from '../../state/selection.ts';
import { isRepoExpanded, isWorktreeExpanded, type ExpandState } from '../../state/sidebarExpand.ts';
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
  /** Which repositories and branches are collapsed. */
  expand: ExpandState;
  /** Toggle exactly one repository open/closed. */
  onToggleRepo: (repoId: string) => void;
  /** Toggle exactly one branch's ticket list open/closed. */
  onToggleWorktree: (worktreeId: string) => void;
  onNewRun: (worktree: Worktree) => void;
}

/**
 * The one hierarchy every view shares: repo → branch → ticket.
 *
 * Each depth behaves the same way, so there is one rule to learn rather than
 * three: clicking a row opens or closes what is under it AND points the rest of
 * the app at it. A chevron on the left states which way the row currently sits.
 *
 * The deepest row is a ticket, and clicking one opens its detail modal. Actions
 * (retry, reply, evaluate, delete) live there and only there — the sidebar used
 * to grow an inline card with its own close/abandon controls, which split the
 * same decisions across two places.
 */
export function RepoSidebar({
  tree, selection, onAction, expand, onToggleRepo, onToggleWorktree, onNewRun,
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
            expand={expand}
            onToggleRepo={onToggleRepo}
            onToggleWorktree={onToggleWorktree}
            now={now}
            onAction={onAction}
            onNewRun={onNewRun}
          />
        ))
      )}
    </nav>
  );
}

/** The ▾/▸ an expandable row carries, so its state is readable without clicking. */
function Chevron({ expanded }: { expanded: boolean }) {
  return (
    <span aria-hidden="true" style={{ width: 12, flexShrink: 0, fontSize: 10, color: 'var(--text-secondary)' }}>
      {expanded ? '▾' : '▸'}
    </span>
  );
}

function RepoRow({
  node, selection, expand, onToggleRepo, onToggleWorktree, now, onAction, onNewRun,
}: {
  node: RepoNode;
  selection: Selection;
  expand: ExpandState;
  onToggleRepo: (repoId: string) => void;
  onToggleWorktree: (worktreeId: string) => void;
  now: number;
  onAction: (a: SelectionAction) => void;
  onNewRun: (w: Worktree) => void;
}) {
  const selected = selection.repoId === node.repo.repoId;
  const expanded = isRepoExpanded(expand, node.repo.repoId);
  const name = node.repo.name ?? node.repo.root;

  // One click, two effects: fold the branches under this repo, and point the
  // board and the ticket composer at it. Selecting is not a toggle — the
  // all-projects row is the single way back to no filter, so a second click
  // still just folds.
  const activate = () => {
    onToggleRepo(node.repo.repoId);
    if (!selected) onAction({ type: 'selectRepo', repoId: node.repo.repoId });
  };

  return (
    <div style={{ marginBottom: space[2] }}>
      <div
        role="button"
        tabIndex={0}
        aria-expanded={expanded}
        data-testid={`repo-row-${node.repo.repoId}`}
        data-selected={selected ? 'true' : 'false'}
        onClick={activate}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); activate(); } }}
        style={{
          display: 'flex', alignItems: 'center', gap: space[2],
          padding: space[2], borderRadius: 'var(--radius-md)',
          background: selected ? 'rgba(88,166,255,0.10)' : 'transparent',
          color: 'var(--text-primary)', fontSize: text.base, fontWeight: 600, cursor: 'pointer',
        }}
      >
        <Chevron expanded={expanded} />
        <HierarchyIcon level="repo" color="var(--accent-purple)" />
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {name}
        </span>
        <ActivityAge at={node.lastActivityAt} now={now} testId={`repo-age-${node.repo.repoId}`} />
        <span style={{ flexShrink: 0 }} data-testid={`repo-open-count-${node.repo.repoId}`}>
          <Badge tone={node.openCount > 0 ? 'amber' : 'neutral'}>{node.openCount}</Badge>
        </span>
      </div>

      {expanded && node.worktrees.map((wt) => (
        <WorktreeRow
          key={wt.worktree.worktreeId}
          node={wt}
          selection={selection}
          expanded={isWorktreeExpanded(expand, wt.worktree.worktreeId)}
          onToggleWorktree={onToggleWorktree}
          now={now}
          onAction={onAction}
          onNewRun={onNewRun}
        />
      ))}
    </div>
  );
}

function WorktreeRow({
  node, selection, expanded, onToggleWorktree, now, onAction, onNewRun,
}: {
  node: WorktreeNode;
  selection: Selection;
  expanded: boolean;
  onToggleWorktree: (worktreeId: string) => void;
  now: number;
  onAction: (a: SelectionAction) => void;
  onNewRun: (w: Worktree) => void;
}) {
  const { t } = useTranslation();
  const selected = selection.worktreeId === node.worktree.worktreeId;

  const activate = () => {
    onToggleWorktree(node.worktree.worktreeId);
    if (!selected) {
      onAction({
        type: 'selectWorktree',
        repoId: node.worktree.repoId,
        worktreeId: node.worktree.worktreeId,
      });
    }
  };

  return (
    <div style={{ marginLeft: space[3] }}>
      <div
        role="button"
        tabIndex={0}
        aria-expanded={expanded}
        data-testid={`worktree-row-${node.worktree.worktreeId}`}
        data-selected={selected ? 'true' : 'false'}
        onClick={activate}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); activate(); } }}
        style={{
          display: 'flex', alignItems: 'center', gap: space[2],
          padding: `${space[1]} ${space[2]}`, borderRadius: 'var(--radius-sm)',
          background: selected ? 'rgba(88,166,255,0.08)' : 'transparent',
          color: 'var(--text-secondary)', fontFamily: 'var(--font-mono)', fontSize: text.sm, cursor: 'pointer',
        }}
      >
        <Chevron expanded={expanded} />
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

      {expanded && node.runs.map((run) => (
        <TicketRow key={run.runId} run={run} selection={selection} now={now} onAction={onAction} />
      ))}
    </div>
  );
}

/**
 * A ticket, at the depth of the branch it actually belongs to.
 *
 * Clicking opens the detail modal rather than expanding a second card here:
 * retry, reply, evaluate and delete all live in the modal, and offering a
 * subset of them inline meant the same ticket had two different control sets
 * depending on where you found it.
 */
function TicketRow({
  run, selection, now, onAction,
}: {
  run: Run;
  selection: Selection;
  now: number;
  onAction: (a: SelectionAction) => void;
}) {
  const { t } = useTranslation();
  const open = () => {
    onAction({ type: 'focusRun', run });
    dispatchOpenRun(run);
  };
  return (
    <div
      role="button"
      tabIndex={0}
      data-testid={`run-row-${run.runId}`}
      data-selected={selection.runId === run.runId ? 'true' : 'false'}
      onClick={open}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } }}
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
  );
}

/** "2m ago" beside a row, or a dash when there is no activity to date. */
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
