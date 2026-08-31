import { describe, expect, it } from 'vitest';
import type { AgentInfo, Ticket, TicketEvaluation } from '@claude-alive/core';
import type { ResolvedLocation } from '../gitResolver.js';
import { ticketToUpsert, ticketRunOutcome, orphanTicketRunIds } from '../runAdapters/ticketRuns.js';
import { terminalToUpsert } from '../runAdapters/terminalRuns.js';
import { agentToUpsert } from '../runAdapters/agentRuns.js';

const LOC: ResolvedLocation = {
  repository: { repoId: 'r1', root: '/r/proj', name: 'proj', isGit: true },
  worktree: { worktreeId: 'w1', repoId: 'r1', path: '/r/proj', branch: 'main', isPrimary: true },
};

function ticket(over: Partial<Ticket> = {}): Ticket {
  return {
    id: 't-1', seq: 12, goal: '위임 모델 확장', cwd: '/r/proj',
    state: 'running', createdAt: 1000, ...over,
  } as Ticket;
}

describe('ticketToUpsert', () => {
  it('maps running/queued/verifying to a running run', () => {
    for (const state of ['queued', 'running', 'verifying'] as const) {
      expect(ticketToUpsert(ticket({ state }), LOC).state).toBe('running');
    }
  });

  it('maps decision to waiting', () => {
    expect(ticketToUpsert(ticket({ state: 'decision' }), LOC).state).toBe('waiting');
  });

  it('maps done to waiting so a human still has to close it', () => {
    expect(ticketToUpsert(ticket({ state: 'done' }), LOC).state).toBe('waiting');
  });

  it('maps failed to waiting too — a failure is still unfiled work', () => {
    expect(ticketToUpsert(ticket({ state: 'failed' }), LOC).state).toBe('waiting');
  });

  it('carries seq, headline and usage into meta', () => {
    const up = ticketToUpsert(
      ticket({ headline: '검증 완료', usage: { costUsd: 0.42, durationMs: 252000 }, model: 'claude-opus-4-8' }),
      LOC,
    );
    expect(up.meta).toEqual({ seq: 12, headline: '검증 완료', costUsd: 0.42, durationMs: 252000, model: 'claude-opus-4-8' });
  });

  it('uses a stable runId derived from the ticket id', () => {
    expect(ticketToUpsert(ticket(), LOC).runId).toBe('ticket:t-1');
    expect(ticketToUpsert(ticket(), LOC).sourceId).toBe('t-1');
  });

  it('prefers the startedAt timestamp when present', () => {
    expect(ticketToUpsert(ticket({ startedAt: 2000 }), LOC).startedAt).toBe(2000);
    expect(ticketToUpsert(ticket(), LOC).startedAt).toBe(1000);
  });
});

describe('terminalToUpsert', () => {
  it('reports a live terminal tab as running', () => {
    const up = terminalToUpsert({ tabId: 'tab-9', cwd: '/r/proj', title: 'term-2', startedAt: 500 }, LOC);
    expect(up).toMatchObject({ runId: 'terminal:tab-9', sourceId: 'tab-9', kind: 'terminal', state: 'running', title: 'term-2' });
  });
});

describe('agentToUpsert', () => {
  function agent(over: Partial<AgentInfo> = {}): AgentInfo {
    return {
      id: 'a-1', sessionId: 's-1', state: 'active', cwd: '/r/proj',
      displayName: 'proj', projectName: 'proj', createdAt: 700,
      ...over,
    } as AgentInfo;
  }

  it('reports an active agent as running', () => {
    expect(agentToUpsert(agent(), LOC).state).toBe('running');
  });

  it('reports a waiting agent as waiting', () => {
    expect(agentToUpsert(agent({ state: 'waiting' }), LOC).state).toBe('waiting');
  });

  it('reports a finished agent as waiting so it stays until closed', () => {
    expect(agentToUpsert(agent({ state: 'done' }), LOC).state).toBe('waiting');
  });

  it('falls back to the project name, then the session id, for its title', () => {
    expect(agentToUpsert(agent({ displayName: null }), LOC).title).toBe('proj');
    expect(agentToUpsert(agent({ displayName: null, projectName: '' }), LOC).title).toBe('s-1');
  });

  it('uses createdAt as the start time', () => {
    expect(agentToUpsert(agent(), LOC).startedAt).toBe(700);
  });
});

describe('ticketRunOutcome', () => {
  const evaluation = (over: Partial<TicketEvaluation> = {}): TicketEvaluation =>
    ({ ticketId: 't-1', route: '/r/proj', seq: 12, label: 'good', humanLabeled: true, updatedAt: 1 } as TicketEvaluation);

  it('keeps an unevaluated done ticket open — the human still has to look at it', () => {
    expect(ticketRunOutcome(ticket({ state: 'done' }), undefined)).toBeNull();
  });

  it('keeps a done ticket open while the label is only the auto seed', () => {
    expect(ticketRunOutcome(ticket({ state: 'done' }), { ...evaluation(), humanLabeled: false })).toBeNull();
  });

  it('keeps a running ticket open even if somehow labelled', () => {
    expect(ticketRunOutcome(ticket({ state: 'running' }), evaluation())).toBeNull();
  });

  it('files a human-evaluated done ticket away under its headline', () => {
    expect(ticketRunOutcome(ticket({ state: 'done', headline: '검증 완료' }), evaluation())).toBe('검증 완료');
  });

  it('files a human-evaluated failed ticket away under its error', () => {
    expect(ticketRunOutcome(ticket({ state: 'failed', error: 'spawn failed' }), evaluation())).toBe('spawn failed');
  });

  it('falls back to the label when the ticket says nothing', () => {
    expect(ticketRunOutcome(ticket({ state: 'done' }), evaluation())).toBe('good');
  });
});

describe('ticketToUpsert lastActivityAt', () => {
  it('reports the newest turn, not the start', () => {
    const up = ticketToUpsert(
      ticket({ startedAt: 2000, turns: [{ role: 'user', kind: 'prompt', text: 'go', at: 7000 }] }),
      LOC,
    );
    expect(up.lastActivityAt).toBe(7000);
  });

  it('falls back to the start when nothing has happened since', () => {
    expect(ticketToUpsert(ticket({ startedAt: 2000 }), LOC).lastActivityAt).toBe(2000);
  });
});

describe('orphanTicketRunIds', () => {
  const run = (runId: string, kind: 'ticket' | 'terminal', sourceId: string) =>
    ({ runId, kind, sourceId }) as Parameters<typeof orphanTicketRunIds>[0][number];

  it('finds ticket runs whose ticket no longer exists', () => {
    const ids = orphanTicketRunIds(
      [run('ticket:a', 'ticket', 'a'), run('ticket:b', 'ticket', 'b')],
      new Set(['a']),
    );
    expect(ids).toEqual(['ticket:b']);
  });

  it('never touches runs of another kind — they answer to a different store', () => {
    const ids = orphanTicketRunIds([run('term:1', 'terminal', 'tab-1')], new Set());
    expect(ids).toEqual([]);
  });

  it('returns nothing when every ticket is still present', () => {
    expect(orphanTicketRunIds([run('ticket:a', 'ticket', 'a')], new Set(['a']))).toEqual([]);
  });
});
