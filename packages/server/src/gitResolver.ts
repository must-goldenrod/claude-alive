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

/** cwd(+locationKey) → resolution. Git is slow enough that repeating it per run hurts. */
const cache = new Map<string, ResolvedLocation>();

export function clearGitCache(): void {
  cache.clear();
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
  opts: { locationKey?: string; exec?: GitExec } = {},
): Promise<ResolvedLocation> {
  const { locationKey, exec = defaultExec } = opts;
  const key = `${locationKey ?? 'local'}::${cwd}`;
  const hit = cache.get(key);
  if (hit) return hit;

  const top = await exec(['rev-parse', '--show-toplevel'], cwd);
  const isGit = top !== null;
  const root = top ?? cwd;
  const branch = isGit ? (await exec(['rev-parse', '--abbrev-ref', 'HEAD'], cwd)) ?? '' : '';

  const repoId = repoIdFor(root, locationKey);
  const resolved: ResolvedLocation = {
    repository: { repoId, root, name: basename(root) || root, isGit },
    worktree: {
      worktreeId: worktreeIdFor(repoId, root),
      repoId,
      path: root,
      branch,
      // The toplevel equals the repo root for the primary tree; a linked
      // worktree resolves to its own root, so this is true there too. The
      // branch name is what actually distinguishes them in the UI.
      isPrimary: branch === 'main' || branch === 'master',
    },
  };
  cache.set(key, resolved);
  return resolved;
}
