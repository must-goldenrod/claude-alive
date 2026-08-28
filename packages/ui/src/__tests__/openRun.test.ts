import { describe, expect, it, vi } from 'vitest';
import type { Run } from '@claude-alive/core';
import { openRunIntent } from '../state/openRun.ts';

const base: Omit<Run, 'kind' | 'sourceId' | 'runId'> = {
  repoId: 'r1', worktreeId: 'w1', title: 'goal', state: 'waiting', startedAt: 1,
};

const run = (kind: Run['kind'], sourceId: string): Run =>
  ({ ...base, kind, sourceId, runId: `${kind}:${sourceId}` });

describe('openRunIntent', () => {
  it('routes a ticket run to the ticket detail modal', () => {
    expect(openRunIntent(run('ticket', 't-1'))).toEqual({
      kind: 'ticket', ticketId: 't-1',
    });
  });

  it('routes a terminal run to its tab', () => {
    expect(openRunIntent(run('terminal', 'tab-9'))).toEqual({
      kind: 'terminal', tabId: 'tab-9',
    });
  });

  it('routes an agent run to its session', () => {
    expect(openRunIntent(run('agent', 's-3'))).toEqual({
      kind: 'agent', sessionId: 's-3',
    });
  });
});

describe('dispatchOpenRun', () => {
  it('emits one event carrying the intent', async () => {
    const { dispatchOpenRun, OPEN_RUN_EVENT } = await import('../state/openRun.ts');
    const seen = vi.fn();
    window.addEventListener(OPEN_RUN_EVENT, seen);
    dispatchOpenRun(run('ticket', 't-1'));
    window.removeEventListener(OPEN_RUN_EVENT, seen);

    expect(seen).toHaveBeenCalledTimes(1);
    const event = seen.mock.calls[0]![0] as CustomEvent;
    expect(event.detail).toEqual({ kind: 'ticket', ticketId: 't-1' });
  });
});

describe('shell routing contract', () => {
  it('a ticket intent names the ticket the modal must open', () => {
    const intent = openRunIntent(run('ticket', 'abc-123'));
    expect(intent).toMatchObject({ kind: 'ticket', ticketId: 'abc-123' });
  });

  it('a terminal intent names a tab, never a session', () => {
    const intent = openRunIntent(run('terminal', 'tab-1'));
    expect(intent).not.toHaveProperty('sessionId');
    expect(intent).toHaveProperty('tabId');
  });

  it('an agent intent names a session, never a tab', () => {
    const intent = openRunIntent(run('agent', 'sess-1'));
    expect(intent).not.toHaveProperty('tabId');
    expect(intent).toHaveProperty('sessionId');
  });
});
