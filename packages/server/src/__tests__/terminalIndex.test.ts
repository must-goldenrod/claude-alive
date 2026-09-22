import { describe, expect, it } from 'vitest';
import type { WebSocket } from 'ws';
import { TerminalManager } from '../terminalManager.js';
import { isRemoteAllowed } from '../remoteAccess.js';

/** Minimal pty stand-in: records nothing, exits on demand. */
function fakeTerminal() {
  let onExit: ((code: number) => void) | undefined;
  return {
    spawn(opts: { onExit: (code: number) => void }) { onExit = opts.onExit; },
    write() {},
    resize() {},
    destroy() {},
    exit(code = 0) { onExit?.(code); },
  };
}

function manager() {
  const terms: ReturnType<typeof fakeTerminal>[] = [];
  const mgr = new TerminalManager({
    send: () => {},
    createTerminal: () => {
      const t = fakeTerminal();
      terms.push(t);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return t as any;
    },
  });
  return { mgr, terms };
}

const ws = {} as WebSocket;

describe('TerminalManager.list', () => {
  it('reports every server-owned terminal with its origin', () => {
    const { mgr } = manager();
    mgr.create(ws, { tabId: 'tab-1', cwd: '/work/a', mode: 'shell' });
    mgr.create(ws, { tabId: 'tab-2', cwd: '/work/b', mode: 'shell', origin: 'mobile' });

    const rows = mgr.list();
    expect(rows).toHaveLength(2);
    expect(rows.find((r) => r.tabId === 'tab-1')?.origin).toBe('desktop');
    expect(rows.find((r) => r.tabId === 'tab-2')?.origin).toBe('mobile');
    expect(rows.every((r) => r.live)).toBe(true);
  });

  it('puts live terminals ahead of exited ones', () => {
    const { mgr, terms } = manager();
    mgr.create(ws, { tabId: 'dead', mode: 'shell' });
    mgr.create(ws, { tabId: 'alive', mode: 'shell' });
    terms[0]!.exit(0);

    expect(mgr.list().map((r) => r.tabId)).toEqual(['alive', 'dead']);
    expect(mgr.list().find((r) => r.tabId === 'dead')?.live).toBe(false);
  });

  it('carries cwd so a phone can group by project', () => {
    const { mgr } = manager();
    mgr.create(ws, { tabId: 'tab-1', cwd: '/work/a', mode: 'shell' });
    expect(mgr.list()[0]?.cwd).toBe('/work/a');
  });
});

describe('remote route allowlist', () => {
  it('opens the terminal index from the watch level up', () => {
    expect(isRemoteAllowed('GET', '/api/terminals', 'off')).toBe(false);
    expect(isRemoteAllowed('GET', '/api/terminals', 'watch')).toBe(true);
    expect(isRemoteAllowed('GET', '/api/terminals', 'shell')).toBe(true);
  });

  it('opens directory browsing at every level, since the roots fence it', () => {
    expect(isRemoteAllowed('GET', '/api/remote/browse', 'off')).toBe(true);
  });

  it('still refuses the unfenced filesystem browser', () => {
    expect(isRemoteAllowed('GET', '/api/fs/browse', 'shell')).toBe(false);
  });
});
