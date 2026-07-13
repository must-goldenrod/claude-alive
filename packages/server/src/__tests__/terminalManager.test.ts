import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { WebSocket } from 'ws';
import type { WSServerMessage } from '@claude-alive/core';
import { TerminalManager } from '../terminalManager.js';
import type { ClaudeTerminal } from '../claudeTerminal.js';

/** A fake ClaudeTerminal that captures the spawn callbacks so tests can drive output/exit. */
class FakeTerminal {
  handler: ((data: string) => void) | null = null;
  onExit: ((code: number) => void) | null = null;
  written: string[] = [];
  destroyed = false;
  resizes: Array<[number, number]> = [];
  spawn(opts: { handler: (d: string) => void; onExit?: (c: number) => void }): void {
    this.handler = opts.handler;
    this.onExit = opts.onExit ?? null;
  }
  write(data: string): void {
    this.written.push(data);
  }
  resize(cols: number, rows: number): void {
    this.resizes.push([cols, rows]);
  }
  destroy(): void {
    this.destroyed = true;
  }
}

/** A fake WebSocket sink that records every message sent to it. */
function fakeWs(): { ws: WebSocket; received: WSServerMessage[] } {
  const received: WSServerMessage[] = [];
  return { ws: { __received: received } as unknown as WebSocket, received };
}

function makeManager() {
  const fakes: FakeTerminal[] = [];
  const sent: { ws: WebSocket; msg: WSServerMessage }[] = [];
  const manager = new TerminalManager({
    send: (ws, msg) => {
      sent.push({ ws, msg });
      (ws as unknown as { __received: WSServerMessage[] }).__received.push(msg);
    },
    createTerminal: () => {
      const f = new FakeTerminal();
      fakes.push(f);
      return f as unknown as ClaudeTerminal;
    },
  });
  return { manager, fakes, sent };
}

describe('TerminalManager', () => {
  let ctx: ReturnType<typeof makeManager>;
  beforeEach(() => {
    ctx = makeManager();
  });

  it('fans terminal output out to every subscriber and buffers scrollback', () => {
    const a = fakeWs();
    ctx.manager.create(a.ws, { tabId: 'T1', claudeSessionId: 'sid-1' });
    ctx.fakes[0]!.handler!('hello');

    // Output reached the original subscriber.
    expect(a.received).toContainEqual({ type: 'terminal:output', tabId: 'T1', data: 'hello' });

    // A second browser attaches → gets the scrollback replayed via terminal:restore.
    const b = fakeWs();
    const result = ctx.manager.attach('T1', b.ws);
    expect(result).toBe('restored');
    expect(b.received).toContainEqual({ type: 'terminal:restore', tabId: 'T1', data: 'hello' });

    // New output now fans out to both subscribers.
    ctx.fakes[0]!.handler!('world');
    expect(a.received).toContainEqual({ type: 'terminal:output', tabId: 'T1', data: 'world' });
    expect(b.received).toContainEqual({ type: 'terminal:output', tabId: 'T1', data: 'world' });
  });

  it('forces a redraw (two distinct SIGWINCH resizes) when reattaching to a live pty', () => {
    vi.useFakeTimers();
    try {
      const a = fakeWs();
      ctx.manager.create(a.ws, { tabId: 'T1', claudeSessionId: 'sid-1' });
      ctx.manager.resize('T1', 100, 30);
      ctx.fakes[0]!.resizes.length = 0; // ignore the explicit resize above

      const b = fakeWs();
      ctx.manager.attach('T1', b.ws);
      // Bump happens synchronously; restore fires on a later tick.
      expect(ctx.fakes[0]!.resizes).toEqual([[100, 31]]);
      vi.advanceTimersByTime(100);
      expect(ctx.fakes[0]!.resizes).toEqual([
        [100, 31],
        [100, 30],
      ]);
    } finally {
      vi.useRealTimers();
    }
  });

  it('does NOT force a redraw when reattaching to an exited terminal', () => {
    const a = fakeWs();
    ctx.manager.create(a.ws, { tabId: 'T1', claudeSessionId: 'sid-1' });
    ctx.fakes[0]!.onExit!(0);
    ctx.fakes[0]!.resizes.length = 0;

    const b = fakeWs();
    ctx.manager.attach('T1', b.ws);
    expect(ctx.fakes[0]!.resizes).toEqual([]);
  });

  it('keeps the pty alive when a client disconnects', () => {
    const a = fakeWs();
    ctx.manager.create(a.ws, { tabId: 'T1', claudeSessionId: 'sid-1' });
    ctx.manager.detachClient(a.ws);

    expect(ctx.fakes[0]!.destroyed).toBe(false);
    expect(ctx.manager.isLive('T1')).toBe(true);
  });

  it('destroys the pty and forgets the terminal on close', () => {
    const a = fakeWs();
    ctx.manager.create(a.ws, { tabId: 'T1', claudeSessionId: 'sid-1' });
    ctx.manager.close('T1');

    expect(ctx.fakes[0]!.destroyed).toBe(true);
    expect(ctx.manager.has('T1')).toBe(false);
    expect(ctx.manager.isLive('T1')).toBe(false);
  });

  it('reports missing when attaching to an unknown tab', () => {
    const a = fakeWs();
    expect(ctx.manager.attach('nope', a.ws)).toBe('missing');
  });

  it('marks a terminal not-live after its pty exits', () => {
    const a = fakeWs();
    ctx.manager.create(a.ws, { tabId: 'T1', claudeSessionId: 'sid-1' });
    ctx.fakes[0]!.onExit!(0);

    expect(ctx.manager.isLive('T1')).toBe(false);
    expect(a.received).toContainEqual({ type: 'terminal:exited', tabId: 'T1', exitCode: 0 });
  });

  it('treats a spawn for an existing tab as a reattach', () => {
    const a = fakeWs();
    ctx.manager.create(a.ws, { tabId: 'T1', claudeSessionId: 'sid-1' });
    ctx.fakes[0]!.handler!('data');

    const b = fakeWs();
    ctx.manager.create(b.ws, { tabId: 'T1', claudeSessionId: 'sid-1' });

    // Only one pty was ever created.
    expect(ctx.fakes.length).toBe(1);
    // The second client received the scrollback.
    expect(b.received).toContainEqual({ type: 'terminal:restore', tabId: 'T1', data: 'data' });
  });
});
