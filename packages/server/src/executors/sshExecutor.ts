/**
 * SshExecutor — runs the headless agent on a remote host over SSH (spec §3.3).
 *
 * The remote command is `cd <cwd> && claude -p --output-format stream-json …`.
 * The GOAL is written to the ssh process's stdin (claude -p with no prompt arg
 * reads it from stdin), so a multi-line goal never has to be shell-quoted into
 * the remote command. stdout carries the same newline-delimited stream-json the
 * local path produces, so `consumeHeadless` parses it unchanged.
 *
 * Auth: relies on the server host's existing key/agent SSH to the target
 * (`BatchMode=yes` fails fast rather than hanging on a password prompt).
 */
import { spawn } from 'node:child_process';
import { consumeHeadless, type HeadlessProcessHandle, type HeadlessRunHandle } from '../headlessClaude.js';
import type { SshTarget } from '@claude-alive/core';
import type { Executor, AgentSpawnRequest } from './types.js';

/** Injectable process spawner: given argv and optional stdin, return a process handle. */
export type SshProcessSpawner = (args: string[], stdin?: string) => HeadlessProcessHandle;

const OK_MARKER = '__CA_CWD_OK__';

/** Single-quote a value for a POSIX remote shell. */
export function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

/**
 * Reject an ssh target whose fields could be smuggled to `ssh` as options
 * (argv flag injection). A host/user/identityFile beginning with `-` would let a
 * caller inject e.g. `-oProxyCommand=…` — arbitrary command execution. Throwing
 * here protects both spawn and validateCwd (the schema layer rejects these too,
 * but this is the defence-in-depth choke point).
 */
export function assertSafeTarget(target: SshTarget): void {
  const smuggled = (v?: string) => v !== undefined && v.startsWith('-');
  if (smuggled(target.host) || smuggled(target.user) || smuggled(target.identityFile)) {
    throw new Error('invalid ssh target: host/user/identityFile must not start with "-"');
  }
}

/** Base `ssh` argv up to and including the target, before the remote command. */
export function sshBaseArgs(target: SshTarget): string[] {
  assertSafeTarget(target);
  const args = ['-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=accept-new'];
  if (target.identityFile) args.push('-i', target.identityFile);
  if (target.port && target.port !== 22) args.push('-p', String(target.port));
  args.push(target.user ? `${target.user}@${target.host}` : target.host);
  return args;
}

/**
 * PATH augmentation for the remote command. A non-interactive SSH shell does not
 * source the user's interactive rc, so the native-installer location
 * (`~/.local/bin`) and common package dirs are missing and `claude` resolves to
 * "command not found" (same root cause as the local launchd fix). Prepending
 * these keeps the remote invocation working without an interactive shell (which
 * would corrupt the stream-json output).
 */
const REMOTE_PATH_PREFIX =
  'export PATH="$HOME/.local/bin:$HOME/.claude/local:/opt/homebrew/bin:/usr/local/bin:$PATH"; ';

/**
 * The remote command that launches headless claude in `cwd`. `-p` with no prompt
 * arg makes claude read the prompt from stdin (which the ssh process supplies),
 * so a multi-line goal never touches the remote shell's quoting.
 */
export function buildRemoteCommand(cwd: string, permissionMode: string, resumeSessionId?: string): string {
  const flags = ['-p', '--output-format', 'stream-json', '--verbose', '--permission-mode', permissionMode];
  if (resumeSessionId) flags.push('--resume', shellQuote(resumeSessionId));
  return `${REMOTE_PATH_PREFIX}cd ${shellQuote(cwd)} && claude ${flags.join(' ')}`;
}

function realSshSpawn(args: string[], stdin?: string): HeadlessProcessHandle {
  const child = spawn('ssh', args, { stdio: ['pipe', 'pipe', 'pipe'] });
  if (stdin !== undefined) {
    child.stdin.write(stdin);
    child.stdin.end();
  }
  return {
    stdout: child.stdout,
    stderr: child.stderr,
    kill: () => child.kill(),
    onExit: (cb) => {
      child.on('error', () => cb(null));
      child.on('exit', (code) => cb(code));
    },
  };
}

function collect(proc: HeadlessProcessHandle): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    proc.stdout.setEncoding('utf-8');
    proc.stdout.on('data', (c: string) => {
      stdout += c;
    });
    proc.stderr.setEncoding('utf-8');
    proc.stderr.on('data', (c: string) => {
      stderr += c;
    });
    proc.onExit((code) => resolve({ code, stdout, stderr }));
  });
}

export function createSshExecutor(target: SshTarget, options: { spawnProcess?: SshProcessSpawner } = {}): Executor {
  const doSpawn = options.spawnProcess ?? realSshSpawn;

  return {
    async validateCwd(cwd) {
      let baseArgs: string[];
      try {
        baseArgs = sshBaseArgs(target); // throws on an unsafe (flag-smuggling) target
      } catch (e) {
        return e instanceof Error ? e.message : 'invalid ssh target';
      }
      const remote = `test -d ${shellQuote(cwd)} && echo ${OK_MARKER}`;
      const { stdout, stderr } = await collect(doSpawn([...baseArgs, remote]));
      if (stdout.includes(OK_MARKER)) return null;
      const detail = stderr.trim().split('\n')[0] || 'directory not found or host unreachable';
      return `remote cwd unavailable on ${target.host}: ${cwd} (${detail})`;
    },
    spawn(req: AgentSpawnRequest): HeadlessRunHandle {
      const remote = buildRemoteCommand(req.cwd, req.permissionMode, req.resumeSessionId);
      const proc = doSpawn([...sshBaseArgs(target), remote], req.goal);
      return consumeHeadless(proc);
    },
  };
}
