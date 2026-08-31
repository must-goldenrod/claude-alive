import { execFile } from 'node:child_process';
import { basename } from 'node:path';
import { promisify } from 'node:util';
import type { Repository, Worktree } from '@claude-alive/core';
import { repoIdFor, worktreeIdFor } from '@claude-alive/core/runs/repoId';

const run = promisify(execFile);

export type GitExec = (args: string[], cwd: string) => Promise<string | null>;

export interface ResolvedLocation {
  repository: Repository;
  worktree: Worktree;
}

/**
 * cwd(+locationKey) → resolution. Git is slow enough that repeating it per run
 * hurts, but the entry cannot live forever: `branch` changes whenever anyone
 * checks something out, here or in a terminal, and an immortal cache pinned the
 * sidebar to whatever branch was current the first time a run was mirrored.
 */
const CACHE_TTL_MS = 10_000;
const cache = new Map<string, { at: number; value: ResolvedLocation }>();

export function clearGitCache(): void {
  cache.clear();
}

/** Forget one working directory, e.g. right after checking a branch out in it. */
export function invalidateGitCache(cwd: string): void {
  for (const key of [...cache.keys()]) {
    if (key.endsWith(`::${cwd}`)) cache.delete(key);
  }
}

/** Real git. Returns null instead of throwing so a non-repo degrades quietly. */
const defaultExec: GitExec = async (args, cwd) => {
  try {
    const { stdout } = await run('git', args, { cwd, timeout: 3000 });
    const line = stdout.trim();
    return line.length > 0 ? line : null;
  } catch {
    return null;
  }
};

/**
 * Resolve a working directory into its repository + worktree.
 *
 * Never throws: a directory that is not a git repository becomes its own
 * non-git "repository" so every run still lands somewhere in the tree.
 */
export async function resolveCwd(
  cwd: string,
  opts: { locationKey?: string; exec?: GitExec; now?: () => number } = {},
): Promise<ResolvedLocation> {
  const { locationKey, exec = defaultExec, now = Date.now } = opts;
  const key = `${locationKey ?? 'local'}::${cwd}`;
  const hit = cache.get(key);
  if (hit && now() - hit.at < CACHE_TTL_MS) return hit.value;

  const top = await exec(['rev-parse', '--show-toplevel'], cwd);
  const isGit = top !== null;
  const root = top ?? cwd;
  const branch = isGit ? (await exec(['rev-parse', '--abbrev-ref', 'HEAD'], cwd)) ?? '' : '';
  const gitDir = isGit ? await exec(['rev-parse', '--absolute-git-dir'], cwd) : null;

  const repoId = repoIdFor(root, locationKey);
  const resolved: ResolvedLocation = {
    repository: { repoId, root, name: basename(root) || root, isGit },
    worktree: {
      worktreeId: worktreeIdFor(repoId, root),
      repoId,
      path: root,
      branch,
      // A linked worktree's git-dir lives under the main one as
      // `.../.git/worktrees/<name>`; the primary checkout's does not. That is
      // the actual distinction. Keying off the branch name instead called a
      // main checkout on a feature branch "not primary", which is how selecting
      // a repo could point the composer at the wrong folder.
      isPrimary: isGit ? !(gitDir ?? '').includes('/worktrees/') : true,
    },
  };
  cache.set(key, { at: now(), value: resolved });
  return resolved;
}
