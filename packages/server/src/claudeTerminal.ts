import * as pty from 'node-pty';
import { homedir } from 'node:os';
import type { SSHErrorKind } from '@claude-alive/core';

/** Environment variables that must be removed to avoid nested-session errors */
const CLAUDE_ENV_KEYS = ['CLAUDECODE', 'CLAUDE_CODE_SSE_PORT', 'CLAUDE_CODE_ENTRYPOINT'];

/** Strip ANSI escape sequences so regex matching is reliable. */
// eslint-disable-next-line no-control-regex
const ANSI_PATTERN = /\x1b\[[0-9;?]*[A-Za-z]/g;

/** Ordered list — first match wins. */
const SSH_ERROR_PATTERNS: { kind: SSHErrorKind; pattern: RegExp }[] = [
  { kind: 'host-key-changed', pattern: /REMOTE HOST IDENTIFICATION HAS CHANGED/i },
  { kind: 'host-key', pattern: /Host key verification failed/i },
  { kind: 'permission-denied', pattern: /Permission denied \(publickey|Permission denied, please try again|Permission denied \(.*password/i },
  { kind: 'connection-refused', pattern: /Connection refused/i },
  { kind: 'dns', pattern: /(Could not resolve hostname|Name or service not known|Temporary failure in name resolution)/i },
  { kind: 'timeout', pattern: /(Connection timed out|Operation timed out)/i },
  { kind: 'unknown', pattern: /(kex_exchange_identification|ssh: connect to host .* port .*:)/i },
];

function cleanEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (v !== undefined && !CLAUDE_ENV_KEYS.includes(k)) {
      env[k] = v;
    }
  }
  return env;
}

function userShell(): string {
  return process.env.SHELL || '/bin/zsh';
}

export interface SpawnOptions {
  handler: (data: string) => void;
  cols?: number;
  rows?: number;
  onExit?: (exitCode: number) => void;
  onSshError?: (err: { kind: SSHErrorKind; line: string }) => void;
  cwd?: string;
  mode?: 'claude' | 'shell';
  skipPermissions?: boolean;
  initialCommand?: string;
  detectSshErrors?: boolean;
  /** UUID for `claude --session-id` (ignored if resumeSessionId is set). */
  claudeSessionId?: string;
  /** Existing Claude session UUID for `claude --resume <id>`. */
  resumeSessionId?: string;
  /** Display name for `claude -n <name>`. */
  displayName?: string;
}

/**
 * Escape a string for safe use inside a single-quoted shell argument.
 * Used only for the `-n` display name. Accepts any user input.
 */
function shellSingleQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

/** Claude CLI session UUIDs must be v4 format. Validate defensively. */
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class ClaudeTerminal {
  private ptyProc: pty.IPty | null = null;
  private onData: ((data: string) => void) | null = null;
  private onSshError: ((err: { kind: SSHErrorKind; line: string }) => void) | null = null;
  private detectErrors = false;
  private lineBuffer = '';
  private reportedErrors = new Set<SSHErrorKind>();

  spawn(opts: SpawnOptions): void {
    if (this.ptyProc) {
      this.ptyProc.kill();
      this.ptyProc = null;
    }

    const {
      handler,
      cols = 80,
      rows = 24,
      onExit,
      onSshError,
      cwd,
      mode = 'claude',
      skipPermissions,
      initialCommand,
      detectSshErrors = false,
      claudeSessionId,
      resumeSessionId,
      displayName,
    } = opts;

    this.onData = handler;
    this.onSshError = onSshError ?? null;
    this.detectErrors = detectSshErrors;
    this.lineBuffer = '';
    this.reportedErrors.clear();

    const shell = userShell();
    const env = cleanEnv();
    const cwdResolved = cwd || homedir();

    if (mode === 'claude') {
      const args: string[] = [];
      // --resume takes precedence over --session-id (resuming a past conversation).
      if (resumeSessionId && UUID_V4.test(resumeSessionId)) {
        args.push('--resume', resumeSessionId);
      } else if (claudeSessionId && UUID_V4.test(claudeSessionId)) {
        args.push('--session-id', claudeSessionId);
      }
      if (displayName && displayName.trim().length > 0) {
        args.push('-n', shellSingleQuote(displayName.trim()));
      }
      if (skipPermissions) {
        args.push('--dangerously-skip-permissions');
      }
      const claudeCmd = args.length > 0 ? `claude ${args.join(' ')}` : 'claude';
      this.ptyProc = pty.spawn(shell, ['-l', '-c', claudeCmd], {
        name: 'xterm-256color',
        cols,
        rows,
        cwd: cwdResolved,
        env,
      });
    } else {
      // Interactive shell mode (used for SSH presets and freeform terminals).
      this.ptyProc = pty.spawn(shell, ['-l', '-i'], {
        name: 'xterm-256color',
        cols,
        rows,
        cwd: cwdResolved,
        env,
      });
    }

    this.ptyProc.onData((data) => {
      this.onData?.(data);
      if (this.detectErrors) {
        this.scanForSshErrors(data);
      }
    });

    this.ptyProc.onExit(({ exitCode }) => {
      this.ptyProc = null;
      onExit?.(exitCode);
    });

    if (initialCommand && initialCommand.trim().length > 0) {
      // Delay to let the shell print its prompt first so the command lands on a clean line.
      setTimeout(() => {
        this.ptyProc?.write(`${initialCommand}\r`);
      }, 120);
    }
  }

  /** Assemble lines from PTY output and match SSH error patterns. */
  private scanForSshErrors(chunk: string): void {
    this.lineBuffer += chunk;
    // Keep last ~16KB in buffer to avoid unbounded growth.
    if (this.lineBuffer.length > 16_384) {
      this.lineBuffer = this.lineBuffer.slice(-8_192);
    }

    const parts = this.lineBuffer.split(/\r?\n/);
    // Last element may be an incomplete line — keep it for next chunk.
    this.lineBuffer = parts.pop() ?? '';

    for (const rawLine of parts) {
      const line = rawLine.replace(ANSI_PATTERN, '').trim();
      if (line.length === 0) continue;
      for (const { kind, pattern } of SSH_ERROR_PATTERNS) {
        if (this.reportedErrors.has(kind)) continue;
        if (pattern.test(line)) {
          this.reportedErrors.add(kind);
          this.onSshError?.({ kind, line });
          break;
        }
      }
    }
  }

  write(data: string): void {
    this.ptyProc?.write(data);
  }

  resize(cols: number, rows: number): void {
    this.ptyProc?.resize(cols, rows);
  }

  get isAlive(): boolean {
    return this.ptyProc !== null;
  }

  destroy(): void {
    if (this.ptyProc) {
      this.ptyProc.kill();
      this.ptyProc = null;
    }
    this.onData = null;
    this.onSshError = null;
    this.lineBuffer = '';
    this.reportedErrors.clear();
  }
}
