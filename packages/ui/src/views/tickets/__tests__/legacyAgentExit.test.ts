import { describe, it, expect } from 'vitest';
import type { Ticket } from '@claude-alive/core';
import { legacyAgentExit } from '../legacyAgentExit.ts';

function ticket(over: Partial<Ticket> = {}): Ticket {
  return {
    id: 't', seq: 1, goal: 'g', cwd: '/repo', state: 'failed', createdAt: 0,
    failureReason: 'error', ...over,
  } as Ticket;
}

describe('legacyAgentExit', () => {
  it('reads the old 143 message as a SIGTERM from outside', () => {
    const exit = legacyAgentExit(
      ticket({
        error: 'main agent exited (code 143)',
        startedAt: 1_789_005_299_279,
        endedAt: 1_789_005_765_151,
        claudeSessionId: '19e00ff4',
      }),
    );
    expect(exit).toEqual({
      cause: 'terminated',
      code: 143,
      signal: 'SIGTERM',
      signalInferred: true,
      ranMs: 465_872,
      round: 1,
      resumable: true,
    });
  });

  it('reads the old spawn message and marks it unresumable', () => {
    expect(legacyAgentExit(ticket({ error: 'failed to spawn claude' }))).toEqual({
      cause: 'spawn-failed',
      round: 1,
      resumable: false,
    });
  });

  it('keeps an ordinary non-zero code as a plain exit', () => {
    expect(legacyAgentExit(ticket({ error: 'main agent exited (code 1)' }))).toMatchObject({ cause: 'exited', code: 1 });
  });

  it('refuses to guess at any other message', () => {
    expect(legacyAgentExit(ticket({ error: 'working directory does not exist: /nope' }))).toBeUndefined();
    expect(legacyAgentExit(ticket({ error: '' }))).toBeUndefined();
    expect(legacyAgentExit(ticket({ error: 'main agent exited (code 143)', failureReason: 'cancelled' }))).toBeUndefined();
  });
});
