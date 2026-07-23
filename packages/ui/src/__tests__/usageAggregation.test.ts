import { describe, it, expect } from 'vitest';
import type { Ticket, CompletedSession } from '@claude-alive/core';
import {
  aggregateUsage,
  toRecords,
  startOfWeek,
  startOfMonth,
  emptyTotals,
} from '../views/data/usageAggregation.ts';

// Fixed reference "now": 2026-07-23 (Thursday), local time.
const NOW = new Date(2026, 6, 23, 12, 0, 0).getTime();
const day = (y: number, m: number, d: number, h = 10) => new Date(y, m, d, h).getTime();

function ticket(over: Partial<Ticket>): Ticket {
  return {
    id: over.id ?? 't1',
    seq: over.seq ?? 1,
    goal: 'g',
    cwd: '/tmp',
    state: 'done',
    createdAt: over.createdAt ?? NOW,
    ...over,
  } as Ticket;
}

function session(over: Partial<CompletedSession>): CompletedSession {
  return {
    sessionId: over.sessionId ?? 's1',
    cwd: '/tmp',
    projectName: 'p',
    completedAt: over.completedAt ?? NOW,
    lastPrompt: null,
    displayName: null,
    ...over,
  } as CompletedSession;
}

describe('toRecords', () => {
  it('normalizes ticket main usage, delegations, and sessions', () => {
    const tickets: Ticket[] = [
      ticket({
        id: 'a',
        model: 'claude-opus-4-8',
        endedAt: NOW,
        usage: {
          inputTokens: 100,
          outputTokens: 50,
          cacheReadTokens: 30,
          cacheCreationTokens: 20,
          costUsd: 0.12,
          numTurns: 3,
        },
        delegations: [
          { model: 'gemini/gemini-2.5-flash-lite', inputTokens: 10, outputTokens: 5, costUsd: 0.001, at: NOW },
        ],
      }),
    ];
    const sessions: CompletedSession[] = [
      session({
        completedAt: NOW,
        tokenUsage: {
          inputTokens: 200,
          outputTokens: 80,
          cacheCreationTokens: 0,
          cacheReadTokens: 40,
          totalTokens: 320,
          apiCalls: 7,
          model: 'claude-sonnet-5',
        },
      }),
    ];

    const records = toRecords(tickets, sessions);
    expect(records).toHaveLength(3);

    const main = records.find((r) => r.model === 'claude-opus-4-8')!;
    expect(main.cacheTokens).toBe(50); // 30 + 20
    expect(main.totalTokens).toBe(200); // 100 + 50 + 50 (derived)
    expect(main.costUsd).toBeCloseTo(0.12);
    expect(main.calls).toBe(3);

    const deleg = records.find((r) => r.model.startsWith('gemini'))!;
    expect(deleg.totalTokens).toBe(15);
    expect(deleg.calls).toBe(1);

    const sess = records.find((r) => r.model === 'claude-sonnet-5')!;
    expect(sess.totalTokens).toBe(320); // explicit total honored
    expect(sess.calls).toBe(7);
    expect(sess.costUsd).toBe(0); // sessions carry no cost
  });

  it('falls back to unknown model and drops zero-usage records', () => {
    const tickets: Ticket[] = [
      ticket({ id: 'z', endedAt: NOW, usage: { inputTokens: 5, outputTokens: 5 } }), // no model
      ticket({ id: 'empty', endedAt: NOW, usage: {} }), // nothing to count → dropped
    ];
    const records = toRecords(tickets, []);
    expect(records).toHaveLength(1);
    expect(records[0].model).toBe('unknown');
  });
});

describe('aggregateUsage', () => {
  it('sums grand total and per-model rows sorted by tokens desc', () => {
    const tickets: Ticket[] = [
      ticket({ id: 'a', model: 'opus', endedAt: NOW, usage: { totalTokens: 300, inputTokens: 300, costUsd: 0.3, numTurns: 2 } }),
      ticket({ id: 'b', model: 'sonnet', endedAt: NOW, usage: { totalTokens: 100, inputTokens: 100, costUsd: 0.1, numTurns: 1 } }),
    ];
    const summary = aggregateUsage(tickets, [], NOW);
    expect(summary.total.totalTokens).toBe(400);
    expect(summary.total.costUsd).toBeCloseTo(0.4);
    expect(summary.total.calls).toBe(3);
    expect(summary.byModel.map((m) => m.model)).toEqual(['opus', 'sonnet']);
    expect(summary.modelCount).toBe(2);
    expect(summary.recordCount).toBe(2);
  });

  it('buckets today / thisWeek / thisMonth relative to now', () => {
    const tickets: Ticket[] = [
      ticket({ id: 'today', model: 'm', endedAt: day(2026, 6, 23), usage: { totalTokens: 10, inputTokens: 10 } }),
      ticket({ id: 'yesterday', model: 'm', endedAt: day(2026, 6, 22), usage: { totalTokens: 20, inputTokens: 20 } }),
      ticket({ id: 'lastmonth', model: 'm', endedAt: day(2026, 5, 10), usage: { totalTokens: 40, inputTokens: 40 } }),
    ];
    const summary = aggregateUsage(tickets, [], NOW);
    expect(summary.today.totalTokens).toBe(10);
    // Week of 2026-07-23 (Thu) starts Mon 2026-07-20 → today + yesterday.
    expect(summary.thisWeek.totalTokens).toBe(30);
    // Month = July → today + yesterday (June excluded).
    expect(summary.thisMonth.totalTokens).toBe(30);
    expect(summary.total.totalTokens).toBe(70);
  });

  it('produces ascending day/week/month buckets', () => {
    const tickets: Ticket[] = [
      ticket({ id: 'a', model: 'm', endedAt: day(2026, 6, 22), usage: { totalTokens: 10, inputTokens: 10 } }),
      ticket({ id: 'b', model: 'm', endedAt: day(2026, 6, 23), usage: { totalTokens: 20, inputTokens: 20 } }),
    ];
    const summary = aggregateUsage(tickets, [], NOW);
    expect(summary.byDay).toHaveLength(2);
    expect(summary.byDay[0].start).toBeLessThan(summary.byDay[1].start);
    expect(summary.byDay[1].totalTokens).toBe(20);
    expect(summary.byWeek).toHaveLength(1); // same Mon-based week
    expect(summary.byMonth).toHaveLength(1);
  });

  it('returns zeroed summary for empty input', () => {
    const summary = aggregateUsage([], [], NOW);
    expect(summary.total).toEqual(emptyTotals());
    expect(summary.byModel).toEqual([]);
    expect(summary.firstAt).toBeNull();
    expect(summary.recordCount).toBe(0);
  });
});

describe('period boundaries', () => {
  it('startOfWeek is the Monday 00:00', () => {
    const wed = new Date(2026, 6, 22, 15, 30).getTime(); // Wed
    const mon = new Date(2026, 6, 20, 0, 0, 0).getTime();
    expect(startOfWeek(wed)).toBe(mon);
  });
  it('startOfMonth is the 1st 00:00', () => {
    expect(startOfMonth(new Date(2026, 6, 23, 9).getTime())).toBe(new Date(2026, 6, 1).getTime());
  });
});
