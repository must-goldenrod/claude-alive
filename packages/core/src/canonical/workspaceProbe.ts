/**
 * Workspace identity probe (spec §F.5).
 *
 * Resolves a chosen cwd into a stable `WorkspaceIdentity`: the git repository
 * root when there is one, otherwise the folder itself. Uses an injected
 * `CommandRunner` (same contract as the doctor) so it is deterministic in tests
 * and reusable over SSH — a remote probe is the same logic with a different
 * runner.
 *
 * Two rules are load-bearing:
 *  - Every probe is read-only. Nothing here mutates a repository.
 *  - Remote-url credentials are stripped before the value is ever returned, so a
 *    token in a remote can never reach the database or the UI (§N.1).
 */

import type { CommandRunner } from './doctor.js';
import type { RepositoryIdentity, WorkspaceIdentity } from './workspace.js';

export interface WorkspaceProbeInput {
  /** Directory the user chose; may be anywhere inside a repository. */
  cwd: string;
  locationId: string;
  /** Caller-minted id (ULID) for a new workspace. */
  workspaceId: string;
  /** User-assigned name; always wins the display (§F.5 rule 5). */
  customName?: string;
}

/** Cross-platform basename; core also runs in the browser, so no node:path. */
export function basename(path: string): string {
  const parts = path.split(/[/\\]/).filter(Boolean);
  return parts.length > 0 ? parts[parts.length - 1] : path;
}

/**
 * Canonicalize a root path for use as a workspace key (§F.5). Trims, collapses
 * duplicate separators, and drops a trailing separator so `/repo/alpha`,
 * `/repo/alpha/`, and `/repo//alpha` are one workspace.
 *
 * Deliberately does NOT case-fold: case sensitivity is filesystem-dependent, and
 * folding would merge genuinely distinct directories on Linux. Symlink
 * resolution needs filesystem access and belongs to the caller's runner.
 */
export function canonicalizeRootPath(path: string): string {
  const trimmed = path.trim().replace(/\/{2,}/g, '/');
  return trimmed.length > 1 ? trimmed.replace(/\/+$/, '') : trimmed;
}

/**
 * Parse a git remote into a credential-free identity. Handles https, `ssh://`,
 * and scp-style (`git@host:owner/repo`) forms; returns null when the value is
 * not a recognisable remote.
 */
export function normalizeRemoteUrl(url: string): RepositoryIdentity | null {
  const raw = url.trim();
  if (raw.length === 0) return null;

  let host: string | undefined;
  let path: string | undefined;

  const scp = raw.match(/^(?:[^@/]+@)?([^/:]+):(.+)$/);
  const uri = raw.match(/^[a-z][a-z0-9+.-]*:\/\/(?:[^@/]*@)?([^/:]+)(?::\d+)?\/(.+)$/i);

  if (uri) {
    host = uri[1];
    path = uri[2];
  } else if (scp && !raw.includes('://')) {
    host = scp[1];
    path = scp[2];
  } else {
    return null;
  }

  const segments = path.replace(/\.git$/i, '').split('/').filter(Boolean);
  if (segments.length === 0) return null;

  const name = segments[segments.length - 1];
  const owner = segments.slice(0, -1).join('/') || undefined;
  const scheme = uri ? raw.slice(0, raw.indexOf('://')) : 'https';

  return {
    // Rebuilt from parsed parts, so any userinfo in the input is dropped.
    remoteUrlNormalized: `${scheme}://${host}/${[owner, name].filter(Boolean).join('/')}`,
    host,
    owner,
    name,
  };
}

async function tryGit(runner: CommandRunner, cwd: string, args: string[]): Promise<string | null> {
  try {
    const result = await runner('git', ['-C', cwd, ...args]);
    if (!result.ok) return null;
    const out = result.stdout.trim();
    return out.length > 0 ? out : null;
  } catch {
    // A missing/failing git is a normal outcome: the folder simply is not a repo.
    return null;
  }
}

export async function probeWorkspace(
  input: WorkspaceProbeInput,
  runner: CommandRunner,
): Promise<WorkspaceIdentity> {
  const cwd = canonicalizeRootPath(input.cwd);

  const toplevel = await tryGit(runner, cwd, ['rev-parse', '--show-toplevel']);
  const rootPath = toplevel ? canonicalizeRootPath(toplevel) : cwd;
  const kind = toplevel ? 'git' : 'folder';

  let repo: RepositoryIdentity | undefined;
  if (toplevel) {
    const remote = await tryGit(runner, rootPath, ['remote', 'get-url', 'origin']);
    repo = remote ? (normalizeRemoteUrl(remote) ?? undefined) : undefined;
  }

  // Display priority (§F.5): custom name → repository name → folder basename.
  const displayName = input.customName ?? repo?.name ?? basename(rootPath);

  return {
    workspaceId: input.workspaceId,
    locationId: input.locationId,
    rootPath,
    kind,
    displayName,
    ...(input.customName ? { customName: input.customName } : {}),
    ...(repo ? { repo } : {}),
  };
}
