import { execFile } from 'node:child_process';
import { basename } from 'node:path';
import { promisify } from 'node:util';
import type { Repository, SshTarget, TicketLocation, Worktree } from '@claude-alive/core';
import { repoIdFor, worktreeIdFor } from '@claude-alive/core/runs/repoId';
import { sshBaseArgs, shellQuote } from './executors/sshExecutor.js';

const run = promisify(execFile);

export type GitExec = (args: string[], cwd: string) => Promise<string | null>;

/** Runs `ssh <args>` and returns its stdout. Injectable so tests need no host. */
export type SshRun = (args: string[]) => Promise<string>;

export interface ResolvedLocation {
  repository: Repository;
  worktree: Worktree;
}

/** What one probe of a working directory answers. `null` = git said nothing. */
interface GitFacts {
  top: string | null;
  branch: string | null;
  gitDir: string | null;
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

/** `dev@host` / `host:port` — inlined to keep this module free of the ticket barrel. */
function sshDisplay(t: SshTarget): string {
  const at = t.user ? `${t.user}@${t.host}` : t.host;
  return t.port && t.port !== 22 ? `${at}:${t.port}` : at;
}

/**
 * The host-scoping key for a location. Two machines can hold the same absolute
 * path, so the key is what keeps them apart in the run tree.
 */
export function locationKeyFor(location?: TicketLocation | null): string | undefined {
  if (location?.kind === 'ssh' && location.ssh) return `ssh:${sshDisplay(location.ssh)}`;
  return undefined;
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

/** Three questions, three `git` invocations, short-circuited on a non-repo. */
async function probeWithExec(exec: GitExec, cwd: string): Promise<GitFacts> {
  const top = await exec(['rev-parse', '--show-toplevel'], cwd);
  if (top === null) return { top: null, branch: null, gitDir: null };
  return {
    top,
    branch: await exec(['rev-parse', '--abbrev-ref', 'HEAD'], cwd),
    gitDir: await exec(['rev-parse', '--absolute-git-dir'], cwd),
  };
}

/**
 * The same three questions on a remote host, in ONE ssh round trip.
 *
 * Running local git in a remote path is not merely useless: when the remote
 * path happens to exist on this machine too, local git answers about the WRONG
 * checkout, and the sidebar then shows — and hands the ticket composer — a
 * local root for a remote repository. A path that does not exist remotely
 * yields no output and degrades to the non-git fallback, same as locally.
 */
async function probeOverSsh(target: SshTarget, cwd: string, sshRun?: SshRun): Promise<GitFacts> {
  const remote =
    `cd ${shellQuote(cwd)} 2>/dev/null || exit 0; ` +
    't=$(git rev-parse --show-toplevel 2>/dev/null); ' +
    'b=$(git rev-parse --abbrev-ref HEAD 2>/dev/null); ' +
    'g=$(git rev-parse --absolute-git-dir 2>/dev/null); ' +
    'echo "top=$t"; echo "branch=$b"; echo "gitdir=$g"';
  try {
    const args = [...sshBaseArgs(target), remote];
    const stdout = sshRun
      ? await sshRun(args)
      : (await run('ssh', args, { timeout: 10_000 })).stdout;
    const fields = new Map<string, string>();
    for (const line of stdout.split('\n')) {
      const at = line.indexOf('=');
      if (at > 0) fields.set(line.slice(0, at), line.slice(at + 1).trim());
    }
    const pick = (k: string) => {
      const v = fields.get(k);
      return v && v.length > 0 ? v : null;
    };
    return { top: pick('top'), branch: pick('branch'), gitDir: pick('gitdir') };
  } catch {
    // Unreachable host / auth failure: treat it as "not a git checkout" rather
    // than failing the mirror, exactly as a local git failure does.
    return { top: null, branch: null, gitDir: null };
  }
}

/**
 * Resolve a working directory into its repository + worktree.
 *
 * Never throws: a directory that is not a git repository becomes its own
 * non-git "repository" so every run still lands somewhere in the tree.
 *
 * Pass `location` for a run that executes off-machine — it both scopes the ids
 * to that host and makes the probe run there, and it is recorded on the
 * repository so consumers can tell a remote root from a local one.
 */
export async function resolveCwd(
  cwd: string,
  opts: {
    locationKey?: string;
    location?: TicketLocation;
    exec?: GitExec;
    sshRun?: SshRun;
    now?: () => number;
  } = {},
): Promise<ResolvedLocation> {
  const { location, exec, sshRun, now = Date.now } = opts;
  const locationKey = opts.locationKey ?? locationKeyFor(location);
  const key = `${locationKey ?? 'local'}::${cwd}`;
  const hit = cache.get(key);
  if (hit && now() - hit.at < CACHE_TTL_MS) return hit.value;

  const facts = exec
    ? await probeWithExec(exec, cwd)
    : location?.kind === 'ssh' && location.ssh
      ? await probeOverSsh(location.ssh, cwd, sshRun)
      : await probeWithExec(defaultExec, cwd);

  const isGit = facts.top !== null;
  const root = facts.top ?? cwd;
  const branch = isGit ? facts.branch ?? '' : '';

  const repoId = repoIdFor(root, locationKey);
  const resolved: ResolvedLocation = {
    repository: {
      repoId,
      root,
      name: basename(root) || root,
      isGit,
      ...(location ? { location } : {}),
    },
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
      isPrimary: isGit ? !(facts.gitDir ?? '').includes('/worktrees/') : true,
    },
  };
  cache.set(key, { at: now(), value: resolved });
  return resolved;
}
