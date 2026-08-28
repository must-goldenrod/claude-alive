/**
 * Repo → worktree → run hierarchy (spec 2026-08-28).
 *
 * A Run does NOT own its content. Ticket bodies, session transcripts and
 * terminal buffers stay in their existing stores; a Run only records where the
 * work lives, whether it is still open, and what the human said when closing it.
 */

export type RunKind = 'ticket' | 'terminal' | 'agent';

/** `waiting` = the run needs a human (ticket decision, agent waiting). */
export type RunState = 'running' | 'waiting' | 'closed' | 'abandoned';

export interface Repository {
  repoId: string;
  /** Absolute path of the git toplevel, or of the directory itself when not a repo. */
  root: string;
  /** Human alias, when one was set. Falls back to the root's basename in the UI. */
  name?: string;
  isGit: boolean;
}

export interface Worktree {
  worktreeId: string;
  repoId: string;
  path: string;
  /** Branch name, or an empty string when detached / not a repo. */
  branch: string;
  /** True for the repository's main working tree. */
  isPrimary: boolean;
}

/** Extra facts shown on the run card. All optional — kinds report different things. */
export interface RunMeta {
  model?: string;
  costUsd?: number;
  durationMs?: number;
  /** Ticket's human-facing sequence number (#12). */
  seq?: number;
  /** Agent's one-line answer, used to prefill the close input. */
  headline?: string;
}

export interface Run {
  runId: string;
  repoId: string;
  worktreeId: string;
  kind: RunKind;
  /** Id in the owning store: ticket id, terminal tabId, or claude session id. */
  sourceId: string;
  title: string;
  state: RunState;
  /** One line the human wrote when closing. Absent while open. */
  outcome?: string;
  startedAt: number;
  closedAt?: number;
  meta?: RunMeta;
  /**
   * Absolute paths this run wrote to, in first-touched order. Accumulated from
   * `PostToolUse`; absent on runs that predate the feature or wrote nothing.
   */
  touchedFiles?: string[];
}

/** What the whole tree looks like over the wire. */
export interface RunTree {
  repositories: Repository[];
  worktrees: Worktree[];
  runs: Run[];
}

/** States the UI counts as "still needs attention". */
export const RUN_OPEN_STATES: readonly RunState[] = ['running', 'waiting'];

export function isRunOpen(state: RunState): boolean {
  return RUN_OPEN_STATES.includes(state);
}
