/**
 * Remote directory listing over SSH, for the ticket's remote folder picker.
 *
 * Lists sub-directories of a path on the remote host (`ssh host 'cd <path> &&
 * pwd && ls -1p | grep /$'`). The first output line is the resolved absolute
 * path (so `~` and relative navigation always yield an absolute cwd); the rest
 * are child directory names. Reuses the SSH argv builder (which rejects
 * flag-smuggling targets).
 */
import { spawn } from 'node:child_process';
import type { SshTarget } from '@claude-alive/core';
import { sshBaseArgs, shellQuote } from './sshExecutor.js';

export interface SshBrowseResult {
  /** Resolved absolute path of the listed directory. */
  path: string;
  /** Child directory names (no trailing slash). */
  dirs: string[];
}

export type SshBrowseRun = (args: string[]) => Promise<{ code: number | null; stdout: string; stderr: string }>;

function defaultRun(args: string[]): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn('ssh', args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf-8');
    child.stdout.on('data', (c) => (stdout += c));
    child.stderr.setEncoding('utf-8');
    child.stderr.on('data', (c) => (stderr += c));
    child.on('error', () => resolve({ code: null, stdout, stderr }));
    child.on('exit', (code) => resolve({ code, stdout, stderr }));
  });
}

/**
 * List sub-directories of `path` (default: the remote home) on `target`.
 * Throws (via sshBaseArgs) on an unsafe target; the caller should catch.
 */
export async function sshListDirs(
  target: SshTarget,
  path: string | undefined,
  deps: { run?: SshBrowseRun } = {},
): Promise<SshBrowseResult> {
  // Default to home (~, unquoted so the shell expands it); navigate via the
  // absolute paths returned thereafter.
  const cdTarget = path && path.trim() ? shellQuote(path.trim()) : '~';
  const remote = `cd ${cdTarget} 2>/dev/null && pwd && ls -1p 2>/dev/null | grep '/$'`;
  const args = [...sshBaseArgs(target), remote];
  const run = deps.run ?? defaultRun;
  const { stdout } = await run(args);

  const lines = stdout.split('\n').map((l) => l.replace(/\r$/, '')).filter((l) => l.length > 0);
  const resolved = lines[0] ?? (path && path.trim() ? path.trim() : '~');
  const dirs = lines
    .slice(1)
    .filter((d) => d.endsWith('/')) // only directories (belt-and-suspenders with the remote `grep /$`)
    .map((d) => d.replace(/\/$/, ''))
    .filter((d) => d && d !== '.' && d !== '..');
  return { path: resolved, dirs };
}
