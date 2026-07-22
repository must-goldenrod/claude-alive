/**
 * `codex app-server` stdio supervisor (spec §P2, ADR-0004).
 *
 * Owns one Codex child process and the JSON-RPC framing over its stdio:
 * newline-delimited JSON in both directions, responses correlated by id, and
 * everything else surfaced as a server message for the mapper.
 *
 * Verified against codex-cli 0.144.6: `initialize` returns
 * `{ userAgent, codexHome, platformFamily, platformOs }` and notifications start
 * flowing immediately afterwards.
 *
 * The process is injectable so the framing and dispatch logic is testable
 * without a Codex install (§R.1); production supplies a real `spawn`.
 */

import { spawn } from 'node:child_process';
import type { Readable, Writable } from 'node:stream';
import type { CodexServerMessage } from '@claude-alive/core';

export interface CodexProcessHandle {
  stdin: Writable;
  stdout: Readable;
  stderr: Readable;
  kill(): void;
  onExit(cb: () => void): void;
}

export interface CodexSupervisorOptions {
  spawnProcess?: () => CodexProcessHandle;
  clientInfo?: { name: string; version: string };
  /**
   * Reject a request that goes unanswered. Observed against codex-cli 0.144.6:
   * some methods simply never reply, and an unbounded wait would leak the caller.
   */
  requestTimeoutMs?: number;
  /** Extra env (e.g. an augmented PATH) for the real child process. */
  env?: NodeJS.ProcessEnv;
  cwd?: string;
}

export interface CodexSupervisor {
  /** Spawn (if needed), handshake, and return the initialize result. */
  start(): Promise<Record<string, unknown>>;
  /** Server-initiated messages: notifications and requests. */
  messages(): AsyncIterable<CodexServerMessage>;
  request(method: string, params?: Record<string, unknown>): Promise<Record<string, unknown>>;
  notify(method: string, params?: Record<string, unknown>): void;
  stop(): void;
}

function realProcess(options: CodexSupervisorOptions): CodexProcessHandle {
  // stdio is the default transport; `--stdio` is its documented alias.
  const child = spawn('codex', ['app-server'], {
    stdio: ['pipe', 'pipe', 'pipe'],
    env: options.env ?? process.env,
    cwd: options.cwd,
  });
  return {
    stdin: child.stdin,
    stdout: child.stdout,
    stderr: child.stderr,
    kill: () => child.kill(),
    onExit: (cb) => child.on('exit', cb),
  };
}

export function createCodexSupervisor(options: CodexSupervisorOptions = {}): CodexSupervisor {
  const proc = (options.spawnProcess ?? (() => realProcess(options)))();

  const requestTimeoutMs = options.requestTimeoutMs ?? 30_000;
  let nextId = 1;
  const pending = new Map<
    number,
    { resolve: (v: Record<string, unknown>) => void; reject: (e: Error) => void; timer?: ReturnType<typeof setTimeout> }
  >();

  // Simple async queue: messages arrive on stdout, consumers await them.
  const queue: CodexServerMessage[] = [];
  let waiting: ((v: IteratorResult<CodexServerMessage>) => void) | null = null;
  let closed = false;

  function push(message: CodexServerMessage): void {
    if (waiting) {
      const w = waiting;
      waiting = null;
      w({ value: message, done: false });
    } else {
      queue.push(message);
    }
  }

  function close(): void {
    if (closed) return;
    closed = true;
    if (waiting) {
      const w = waiting;
      waiting = null;
      w({ value: undefined as never, done: true });
    }
    // Never leave a caller awaiting a reply the process can no longer send.
    for (const { reject, timer } of pending.values()) {
      if (timer) clearTimeout(timer);
      reject(new Error('codex app-server exited'));
    }
    pending.clear();
  }

  let buffer = '';
  proc.stdout.on('data', (chunk: Buffer) => {
    buffer += chunk.toString();
    let index: number;
    while ((index = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, index);
      buffer = buffer.slice(index + 1);
      if (!line.trim()) continue;

      let parsed: Record<string, unknown>;
      try {
        parsed = JSON.parse(line) as Record<string, unknown>;
      } catch {
        // A single unparsable line must not tear down the session; the rest of
        // the stream is still usable.
        continue;
      }

      const id = typeof parsed.id === 'number' ? parsed.id : undefined;
      const waiter = id !== undefined ? pending.get(id) : undefined;
      if (waiter) {
        pending.delete(id!);
        if (waiter.timer) clearTimeout(waiter.timer);
        if (parsed.error) {
          const message = (parsed.error as { message?: string })?.message ?? 'codex request failed';
          waiter.reject(new Error(message));
        } else {
          waiter.resolve((parsed.result as Record<string, unknown>) ?? {});
        }
        continue;
      }

      if (typeof parsed.method === 'string') {
        push({ method: parsed.method, params: parsed.params as Record<string, unknown> | undefined });
      }
      // A response with no matching request is dropped: replaying it as a
      // message would fabricate a server notification.
    }
  });

  proc.onExit(close);

  function write(payload: Record<string, unknown>): void {
    proc.stdin.write(JSON.stringify(payload) + '\n');
  }

  return {
    async start() {
      const result = await this.request('initialize', {
        clientInfo: options.clientInfo ?? { name: 'claude-alive', version: '0.0.0' },
      });
      // The server expects the notification before it accepts thread work.
      this.notify('initialized', {});
      return result;
    },

    messages(): AsyncIterable<CodexServerMessage> {
      return {
        [Symbol.asyncIterator]() {
          return {
            next(): Promise<IteratorResult<CodexServerMessage>> {
              const queued = queue.shift();
              if (queued) return Promise.resolve({ value: queued, done: false });
              if (closed) return Promise.resolve({ value: undefined as never, done: true });
              return new Promise((resolve) => {
                waiting = resolve;
              });
            },
          };
        },
      };
    },

    request(method, params = {}) {
      if (closed) return Promise.reject(new Error('codex app-server exited'));
      const id = nextId++;
      return new Promise<Record<string, unknown>>((resolve, reject) => {
        const timer = setTimeout(() => {
          pending.delete(id);
          reject(new Error(`codex request ${method} timed out after ${requestTimeoutMs}ms`));
        }, requestTimeoutMs);
        // Keep a pending reply from holding the process open.
        timer.unref?.();
        pending.set(id, { resolve, reject, timer });
        write({ jsonrpc: '2.0', id, method, params });
      });
    },

    notify(method, params = {}) {
      if (closed) return;
      write({ jsonrpc: '2.0', method, params });
    },

    stop() {
      try {
        proc.kill();
      } catch {
        // Already gone.
      }
      close();
    },
  };
}
