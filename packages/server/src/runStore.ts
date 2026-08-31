import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { Repository, Run, RunKind, RunMeta, RunState, RunTree, Worktree } from '@claude-alive/core';
import { mergeTouchedFiles } from '@claude-alive/core';
import type { ResolvedLocation } from './gitResolver.js';

export interface RunUpsert {
  runId: string;
  location: ResolvedLocation;
  kind: RunKind;
  sourceId: string;
  title: string;
  /** Adapters only ever report `running` or `waiting`. */
  state: Extract<RunState, 'running' | 'waiting'>;
  startedAt: number;
  /** When the source last did something. Defaults to `startedAt`. */
  lastActivityAt?: number;
  meta?: RunMeta;
}

export interface RunStore {
  load(): Promise<void>;
  tree(): RunTree;
  upsert(input: RunUpsert): Run;
  close(runId: string, outcome: string): Run | null;
  /** Record a file this run wrote to. No-op for an unknown run or a repeat path. */
  recordTouchedFile(runId: string, path: string): Run | null;
  abandon(runId: string): Run | null;
  subscribe(fn: (run: Run) => void): () => void;
  flush(): Promise<void>;
}

interface Persisted {
  repositories: Repository[];
  worktrees: Worktree[];
  runs: Run[];
}

const EMPTY: Persisted = { repositories: [], worktrees: [], runs: [] };

export function createRunStore({ file }: { file: string }): RunStore {
  let repositories = new Map<string, Repository>();
  let worktrees = new Map<string, Worktree>();
  let runs = new Map<string, Run>();
  const listeners = new Set<(run: Run) => void>();
  let flushing: Promise<void> | null = null;
  let dirty = false;

  async function write(): Promise<void> {
    if (!dirty) return;
    dirty = false;
    const data: Persisted = {
      repositories: [...repositories.values()],
      worktrees: [...worktrees.values()],
      runs: [...runs.values()],
    };
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, JSON.stringify(data, null, 2), 'utf-8');
  }

  async function scheduleFlush(): Promise<void> {
    if (flushing) return flushing;
    flushing = (async () => {
      // Coalesce a burst of updates into one write.
      await new Promise((resolve) => setTimeout(resolve, 50));
      await write();
      flushing = null;
    })();
    return flushing;
  }

  function emit(run: Run): void {
    for (const fn of listeners) fn(run);
    dirty = true;
    void scheduleFlush();
  }

  return {
    async load() {
      let parsed: Persisted = EMPTY;
      try {
        const raw = await readFile(file, 'utf-8');
        const json: unknown = JSON.parse(raw);
        if (json && typeof json === 'object' && Array.isArray((json as Persisted).runs)) {
          parsed = json as Persisted;
        }
      } catch {
        parsed = EMPTY;
      }
      repositories = new Map(parsed.repositories.map((x) => [x.repoId, x]));
      worktrees = new Map(parsed.worktrees.map((x) => [x.worktreeId, x]));
      runs = new Map(parsed.runs.map((x) => [x.runId, x]));
    },

    tree() {
      return {
        repositories: [...repositories.values()],
        worktrees: [...worktrees.values()],
        runs: [...runs.values()],
      };
    },

    upsert(input) {
      repositories.set(input.location.repository.repoId, input.location.repository);
      worktrees.set(input.location.worktree.worktreeId, input.location.worktree);

      const prior = runs.get(input.runId);
      // A human's close is final. Adapters keep reporting the underlying source
      // long after the human filed it away; honouring those reports would
      // resurrect closed work and make the "open" count meaningless.
      const state: RunState =
        prior && (prior.state === 'closed' || prior.state === 'abandoned') ? prior.state : input.state;

      const next: Run = {
        runId: input.runId,
        repoId: input.location.repository.repoId,
        worktreeId: input.location.worktree.worktreeId,
        kind: input.kind,
        sourceId: input.sourceId,
        title: input.title,
        state,
        startedAt: prior?.startedAt ?? input.startedAt,
        // Activity only ever moves forward: an adapter re-reporting an older
        // snapshot must not make a run look staler than it is.
        lastActivityAt: Math.max(
          input.lastActivityAt ?? input.startedAt,
          prior?.lastActivityAt ?? 0,
        ),
        meta: input.meta ?? prior?.meta,
      };
      if (prior?.outcome !== undefined) next.outcome = prior.outcome;
      if (prior?.closedAt !== undefined) next.closedAt = prior.closedAt;
      if (prior?.touchedFiles !== undefined) next.touchedFiles = prior.touchedFiles;

      runs.set(next.runId, next);
      emit(next);
      return next;
    },

    recordTouchedFile(runId, path) {
      const prior = runs.get(runId);
      if (!prior) return null;
      const touchedFiles = mergeTouchedFiles(prior.touchedFiles, path);
      // Unchanged list = a duplicate or a full list; skip the write and the
      // broadcast rather than churning every client on a repeated edit.
      if (touchedFiles === prior.touchedFiles) return prior;
      const next: Run = { ...prior, touchedFiles, lastActivityAt: Date.now() };
      runs.set(runId, next);
      emit(next);
      return next;
    },

    close(runId, outcome) {
      const prior = runs.get(runId);
      if (!prior) return null;
      const closedAt = Date.now();
      const next: Run = {
        ...prior,
        state: 'closed',
        outcome: outcome.trim().slice(0, 300),
        closedAt,
        lastActivityAt: closedAt,
      };
      runs.set(runId, next);
      emit(next);
      return next;
    },

    abandon(runId) {
      const prior = runs.get(runId);
      if (!prior) return null;
      const closedAt = Date.now();
      const next: Run = { ...prior, state: 'abandoned', closedAt, lastActivityAt: closedAt };
      delete next.outcome;
      runs.set(runId, next);
      emit(next);
      return next;
    },

    subscribe(fn) {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },

    async flush() {
      if (flushing) await flushing;
      await write();
    },
  };
}
