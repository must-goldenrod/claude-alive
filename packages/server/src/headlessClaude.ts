/**
 * Spawns `claude -p` in headless stream-json mode and reduces its output to an
 * outcome (spec §아키텍처.2, `headlessClaude.ts`).
 *
 * Not a PTY: headless mode needs no TTY and writes newline-delimited JSON to
 * stdout, so a plain child process suffices. The process is injectable (like
 * `codexSupervisor.ts`) so the runner can be driven in tests with a stub that
 * emits canned stream-json — no `claude` install, no live model calls.
 */
import { spawn } from 'node:child_process';
import type { Readable } from 'node:stream';
import { augmentPath } from '@claude-alive/core';
import { createStreamJsonParser, type StreamEvent, type StreamResult } from './streamJson.js';

/** Removed to avoid nested-session errors when the daemon itself runs under Claude Code. */
const CLAUDE_ENV_KEYS = ['CLAUDECODE', 'CLAUDE_CODE_SSE_PORT', 'CLAUDE_CODE_ENTRYPOINT'];

export interface HeadlessProcessHandle {
  stdout: Readable;
  stderr: Readable;
  kill(): void;
  onExit(cb: (code: number | null) => void): void;
}

export interface HeadlessSpawnArgs {
  goal: string;
  cwd: string;
  permissionMode: string;
  env: NodeJS.ProcessEnv;
}

export interface HeadlessRunOptions {
  goal: string;
  cwd: string;
  /**
   * Required, no default. The privileged `bypassPermissions` mode must be an
   * explicit, visible choice at each call site — never a silent library default
   * (security review #1). Callers pass a mode from trusted server config, not
   * from an HTTP body.
   */
  permissionMode: string;
  /** Injectable spawn for tests. Production builds a real `claude` child process. */
  spawnProcess?: (args: HeadlessSpawnArgs) => HeadlessProcessHandle;
  /** Observe each classified stream event (activity is intentionally opaque). */
  onEvent?: (e: StreamEvent) => void;
}

export interface HeadlessOutcome {
  exitCode: number | null;
  result: StreamResult | null;
  sessionId: string | null;
  stderr: string;
}

export interface HeadlessRunHandle {
  kill(): void;
  done: Promise<HeadlessOutcome>;
}

/** Build the argv for `claude`. `--verbose` is required for stream-json to emit per-turn events. */
export function buildHeadlessArgs(goal: string, permissionMode: string): string[] {
  return ['-p', goal, '--output-format', 'stream-json', '--verbose', '--permission-mode', permissionMode];
}

function cleanEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (v !== undefined && !CLAUDE_ENV_KEYS.includes(k)) env[k] = v;
  }
  env.PATH = augmentPath(env.PATH);
  return env;
}

function realSpawn(args: HeadlessSpawnArgs): HeadlessProcessHandle {
  const child = spawn('claude', buildHeadlessArgs(args.goal, args.permissionMode), {
    cwd: args.cwd,
    env: args.env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  return {
    stdout: child.stdout,
    stderr: child.stderr,
    kill: () => child.kill(),
    onExit: (cb) => {
      child.on('error', () => cb(null)); // e.g. ENOENT: claude not found
      child.on('exit', (code) => cb(code));
    },
  };
}

export function runHeadlessClaude(options: HeadlessRunOptions): HeadlessRunHandle {
  const permissionMode = options.permissionMode ?? 'bypassPermissions';
  const spawnProcess = options.spawnProcess ?? realSpawn;
  const proc = spawnProcess({ goal: options.goal, cwd: options.cwd, permissionMode, env: cleanEnv() });

  let lastResult: StreamResult | null = null;
  let sessionId: string | null = null;
  let stderr = '';
  let settled = false;

  const parser = createStreamJsonParser((e) => {
    if (e.kind === 'init' && e.sessionId) sessionId = e.sessionId;
    if (e.kind === 'result') {
      lastResult = e.result;
      if (e.result.sessionId) sessionId = e.result.sessionId;
    }
    options.onEvent?.(e);
  });

  proc.stdout.setEncoding('utf-8');
  proc.stdout.on('data', (chunk: string) => parser.push(chunk));
  proc.stderr.setEncoding('utf-8');
  proc.stderr.on('data', (chunk: string) => {
    stderr += chunk;
  });

  const done = new Promise<HeadlessOutcome>((resolve) => {
    proc.onExit((code) => {
      if (settled) return;
      settled = true;
      parser.flush();
      resolve({ exitCode: code, result: lastResult, sessionId, stderr });
    });
  });

  return { kill: () => proc.kill(), done };
}
