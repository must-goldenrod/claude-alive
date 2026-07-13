import type { WebSocket } from 'ws';
import type { TerminalMode, TerminalSource, WSServerMessage } from '@claude-alive/core';
import { ClaudeTerminal } from './claudeTerminal.js';

/**
 * Server-owned terminals, decoupled from the WebSocket lifecycle.
 *
 * Historically each pty was keyed by the browser's WebSocket, so a refresh or a
 * dropped connection killed the Claude session. Here the pty is owned by the
 * server and keyed by a stable `tabId`. Browsers *subscribe* to a terminal;
 * disconnecting only removes the subscription, the pty keeps running. A
 * reconnecting browser reattaches and replays the scrollback ring buffer.
 */
const SCROLLBACK_MAX_BYTES = 256 * 1024;

export interface ManagedTerminalMeta {
  tabId: string;
  claudeSessionId?: string;
  cwd?: string;
  displayName?: string;
  mode: TerminalMode;
  source: TerminalSource;
  claudeVariant: 'claude' | 'agents';
}

export interface CreateTerminalOptions {
  tabId: string;
  cwd?: string;
  mode?: TerminalMode;
  source?: TerminalSource;
  claudeVariant?: 'claude' | 'agents';
  skipPermissions?: boolean;
  initialCommand?: string;
  claudeSessionId?: string;
  resumeSessionId?: string;
  displayName?: string;
}

interface ManagedTerminal {
  term: ClaudeTerminal;
  scrollback: string;
  subscribers: Set<WebSocket>;
  meta: ManagedTerminalMeta;
  exited: boolean;
  /** Last known pty size — used to force a redraw on reattach. */
  cols: number;
  rows: number;
}

export interface TerminalManagerOptions {
  /** Sends a server message to a single client. */
  send: (ws: WebSocket, msg: WSServerMessage) => void;
  /** Terminal factory — overridable in tests with a fake. */
  createTerminal?: () => ClaudeTerminal;
}

export class TerminalManager {
  private terminals = new Map<string, ManagedTerminal>();
  private send: TerminalManagerOptions['send'];
  private createTerminal: () => ClaudeTerminal;

  constructor(options: TerminalManagerOptions) {
    this.send = options.send;
    this.createTerminal = options.createTerminal ?? (() => new ClaudeTerminal());
  }

  has(tabId: string): boolean {
    return this.terminals.has(tabId);
  }

  /** True when a pty for this tab exists and has not exited. */
  isLive(tabId: string): boolean {
    const managed = this.terminals.get(tabId);
    return managed !== undefined && !managed.exited;
  }

  meta(tabId: string): ManagedTerminalMeta | undefined {
    return this.terminals.get(tabId)?.meta;
  }

  /**
   * Spawn a new terminal and subscribe `ws` to it. If a terminal with this
   * tabId already exists, treat the call as an attach (idempotent spawn).
   */
  create(ws: WebSocket, opts: CreateTerminalOptions): void {
    const existing = this.terminals.get(opts.tabId);
    if (existing) {
      this.subscribe(existing, ws);
      return;
    }

    const isSsh = opts.source === 'ssh';
    const managed: ManagedTerminal = {
      term: this.createTerminal(),
      scrollback: '',
      subscribers: new Set([ws]),
      exited: false,
      cols: 80,
      rows: 24,
      meta: {
        tabId: opts.tabId,
        claudeSessionId: opts.resumeSessionId ?? opts.claudeSessionId,
        cwd: opts.cwd,
        displayName: opts.displayName,
        mode: opts.mode ?? 'claude',
        source: opts.source ?? 'local',
        claudeVariant: opts.claudeVariant ?? 'claude',
      },
    };
    this.terminals.set(opts.tabId, managed);

    managed.term.spawn({
      handler: (data) => {
        this.appendScrollback(managed, data);
        this.fanout(managed, { type: 'terminal:output', tabId: opts.tabId, data });
      },
      cols: 80,
      rows: 24,
      onExit: (exitCode) => {
        managed.exited = true;
        this.fanout(managed, { type: 'terminal:exited', tabId: opts.tabId, exitCode });
      },
      onSshError: isSsh
        ? (err) => {
            this.fanout(managed, {
              type: 'terminal:ssh-error',
              tabId: opts.tabId,
              kind: err.kind,
              line: err.line,
            });
          }
        : undefined,
      cwd: opts.cwd,
      mode: opts.mode ?? 'claude',
      claudeVariant: opts.claudeVariant ?? 'claude',
      skipPermissions: opts.skipPermissions,
      initialCommand: opts.initialCommand,
      detectSshErrors: isSsh,
      claudeSessionId: opts.claudeSessionId,
      resumeSessionId: opts.resumeSessionId,
      displayName: opts.displayName,
    });
  }

  /**
   * Reattach a browser to a live terminal. Returns 'restored' (subscribed and
   * scrollback replayed) or 'missing' (no such live terminal — likely dormant).
   */
  attach(tabId: string, ws: WebSocket): 'restored' | 'missing' {
    const managed = this.terminals.get(tabId);
    if (!managed) return 'missing';
    this.subscribe(managed, ws);
    return 'restored';
  }

  input(tabId: string, data: string): void {
    this.terminals.get(tabId)?.term.write(data);
  }

  resize(tabId: string, cols: number, rows: number): void {
    const managed = this.terminals.get(tabId);
    if (!managed) return;
    managed.cols = cols;
    managed.rows = rows;
    managed.term.resize(cols, rows);
  }

  /** Explicit user close: destroy the pty and forget the terminal entirely. */
  close(tabId: string): void {
    const managed = this.terminals.get(tabId);
    if (!managed) return;
    managed.term.destroy();
    this.terminals.delete(tabId);
  }

  /** A client disconnected — drop it from every subscription. Ptys keep running. */
  detachClient(ws: WebSocket): void {
    for (const managed of this.terminals.values()) {
      managed.subscribers.delete(ws);
    }
  }

  private subscribe(managed: ManagedTerminal, ws: WebSocket): void {
    managed.subscribers.add(ws);
    this.send(ws, { type: 'terminal:restore', tabId: managed.meta.tabId, data: managed.scrollback });
    if (managed.exited) {
      this.send(ws, { type: 'terminal:exited', tabId: managed.meta.tabId, exitCode: 0 });
      return;
    }
    // Replaying raw scrollback does NOT reconstruct a full-screen TUI (e.g. Claude
    // uses the alternate screen + absolute cursor positioning), so a reattaching
    // browser would see a blank screen. Force the app to repaint by toggling the
    // pty size, which fires SIGWINCH. The reattached client is already a
    // subscriber, so the repaint output streams to it.
    this.forceRedraw(managed);
  }

  /**
   * Trigger a SIGWINCH-driven repaint so a reattaching client sees the current
   * frame of a full-screen TUI (Claude). Two synchronous resizes net to no size
   * change and the pty coalesces them into no SIGWINCH, so we bump the size now
   * and restore it on a later tick — two DISTINCT size changes, each delivering a
   * SIGWINCH the TUI actually reacts to. The restore targets the current tracked
   * size in case the client sent its own resize in the interim.
   */
  private forceRedraw(managed: ManagedTerminal): void {
    managed.term.resize(managed.cols, managed.rows + 1);
    setTimeout(() => {
      if (managed.exited) return;
      if (this.terminals.get(managed.meta.tabId) !== managed) return;
      managed.term.resize(managed.cols, managed.rows);
    }, 60);
  }

  private appendScrollback(managed: ManagedTerminal, data: string): void {
    managed.scrollback += data;
    if (managed.scrollback.length > SCROLLBACK_MAX_BYTES) {
      managed.scrollback = managed.scrollback.slice(-SCROLLBACK_MAX_BYTES);
    }
  }

  private fanout(managed: ManagedTerminal, msg: WSServerMessage): void {
    for (const ws of managed.subscribers) {
      this.send(ws, msg);
    }
  }
}
