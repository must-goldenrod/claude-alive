import { createHash } from 'node:crypto';

/** Strip trailing separators so `/a/b` and `/a/b/` collapse to one id. */
function normalizePath(p: string): string {
  const trimmed = p.trim();
  if (trimmed.length <= 1) return trimmed;
  return trimmed.replace(/\/+$/, '');
}

function shortHash(input: string): string {
  return createHash('sha1').update(input).digest('hex').slice(0, 12);
}

/**
 * Stable id for a repository.
 *
 * `locationKey` scopes the id to a host so the same absolute path on two
 * different machines never collapses into one repository. Pass the ssh target
 * (e.g. `ssh:build@10.0.0.2`) for remote runs; omit it for local ones.
 */
export function repoIdFor(root: string, locationKey?: string): string {
  return shortHash(`${locationKey ?? 'local'}::${normalizePath(root)}`);
}

/** Stable id for one worktree inside a repository. */
export function worktreeIdFor(repoId: string, path: string): string {
  return shortHash(`${repoId}::${normalizePath(path)}`);
}
