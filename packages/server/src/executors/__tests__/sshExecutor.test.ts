import { describe, it, expect } from 'vitest';
import { Readable } from 'node:stream';
import type { SshTarget } from '@claude-alive/core';
import {
  createSshExecutor,
  sshBaseArgs,
  buildRemoteCommand,
  shellQuote,
  type SshProcessSpawner,
} from '../sshExecutor.js';
import type { HeadlessProcessHandle } from '../../headlessClaude.js';

const TARGET: SshTarget = { host: '192.168.100.99', user: 'dev' };

/** A fake process that emits `stdoutText` then exits with `code`. */
function fakeProc(stdoutText: string, code = 0): HeadlessProcessHandle {
  const stdout = new Readable({ read() {} });
  const stderr = new Readable({ read() {} });
  let onExitCb: (c: number | null) => void = () => {};
  setImmediate(() => {
    if (stdoutText) stdout.push(stdoutText);
    stdout.push(null);
    stderr.push(null);
    setImmediate(() => onExitCb(code));
  });
  return { stdout, stderr, kill() {}, onExit(cb) { onExitCb = cb; } };
}

describe('sshBaseArgs', () => {
  it('builds ssh opts + target, adding -i and -p only when needed', () => {
    expect(sshBaseArgs({ host: 'h' })).toEqual([
      '-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=accept-new', 'h',
    ]);
    expect(sshBaseArgs({ host: 'h', user: 'u', port: 2222, identityFile: '/k' })).toEqual([
      '-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=accept-new', '-i', '/k', '-p', '2222', 'u@h',
    ]);
    expect(sshBaseArgs({ host: 'h', port: 22 })).not.toContain('-p'); // default port omitted
  });
});

describe('buildRemoteCommand', () => {
  it('cd + headless claude with -p (prompt via stdin)', () => {
    expect(buildRemoteCommand('/srv/app', 'bypassPermissions')).toBe(
      "cd '/srv/app' && claude -p --output-format stream-json --verbose --permission-mode bypassPermissions",
    );
  });
  it('quotes a cwd with spaces/quotes safely', () => {
    expect(shellQuote("/a b/c'd")).toBe("'/a b/c'\\''d'");
  });
});

describe('createSshExecutor.spawn', () => {
  it('passes goal via stdin and runs the remote command, parsing stream-json', async () => {
    let capturedArgs: string[] = [];
    let capturedStdin: string | undefined;
    const spawnProcess: SshProcessSpawner = (args, stdin) => {
      capturedArgs = args;
      capturedStdin = stdin;
      return fakeProc(
        '{"type":"result","subtype":"success","is_error":false,"result":"done","session_id":"s1","modelUsage":{"claude-opus-4-8[1m]":{"inputTokens":5}}}\n',
      );
    };
    const ex = createSshExecutor(TARGET, { spawnProcess });
    const handle = ex.spawn({ goal: 'multi\nline goal', cwd: '/srv/app', permissionMode: 'bypassPermissions' });
    const outcome = await handle.done;

    // goal went to stdin, not into the remote command
    expect(capturedStdin).toBe('multi\nline goal');
    expect(capturedArgs[capturedArgs.length - 1]).toBe(
      "cd '/srv/app' && claude -p --output-format stream-json --verbose --permission-mode bypassPermissions",
    );
    expect(capturedArgs).toContain('dev@192.168.100.99');
    // stream-json parsed the same as the local path
    expect(outcome.result?.result).toBe('done');
    expect(outcome.sessionId).toBe('s1');
    expect(outcome.result?.model).toBe('claude-opus-4-8');
  });
});

describe('createSshExecutor.validateCwd', () => {
  it('returns null when the remote dir exists (marker present)', async () => {
    const spawnProcess: SshProcessSpawner = () => fakeProc('__CA_CWD_OK__\n');
    const ex = createSshExecutor(TARGET, { spawnProcess });
    expect(await ex.validateCwd('/srv/app')).toBeNull();
  });

  it('returns an error when the marker is absent', async () => {
    const spawnProcess: SshProcessSpawner = () => fakeProc('', 1);
    const ex = createSshExecutor(TARGET, { spawnProcess });
    const err = await ex.validateCwd('/nope');
    expect(err).toContain('/nope');
    expect(err).toContain('192.168.100.99');
  });

  it('runs a test -d probe with the quoted cwd', async () => {
    let args: string[] = [];
    const spawnProcess: SshProcessSpawner = (a) => {
      args = a;
      return fakeProc('__CA_CWD_OK__\n');
    };
    const ex = createSshExecutor(TARGET, { spawnProcess });
    await ex.validateCwd('/srv/app');
    expect(args[args.length - 1]).toBe("test -d '/srv/app' && echo __CA_CWD_OK__");
  });
});
