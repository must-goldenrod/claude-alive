import { describe, it, expect } from 'vitest';
import { verificationHealth, formatVerificationHealth } from '../verificationHealth.js';
import type { TicketEvaluation } from '@claude-alive/core';

const rec = (over: Partial<TicketEvaluation>): TicketEvaluation =>
  ({
    ticketId: 't', seq: 1, route: '/r', goal: 'g',
    autoLabel: 'unrated', label: 'unrated', humanLabeled: false, weight: 3,
    reflected: false, createdAt: 0, updatedAt: 0,
    ...over,
  }) as TicketEvaluation;

describe('verificationHealth', () => {
  it('counts everything that reached the gate, verdict or not', () => {
    const h = verificationHealth([
      rec({ verdictPassed: true }),
      rec({ failureReason: 'verification-failed', verdictPassed: false }),
      rec({ failureReason: 'verification-inconclusive' }),
      // Never reached the gate at all.
      rec({ failureReason: 'cancelled' }),
      rec({}),
    ]);
    expect(h.verified).toBe(3);
    expect(h.inconclusive).toBe(1);
  });

  it('grades the gate only on labels a human actually set', () => {
    const h = verificationHealth([
      rec({ verdictPassed: true, humanLabeled: true, label: 'good' }),
      rec({ verdictPassed: true, humanLabeled: true, label: 'bad' }),
      // Auto-labelled: seeded from the verdict, so it would grade itself.
      rec({ verdictPassed: true, humanLabeled: false, label: 'good' }),
      rec({ failureReason: 'verification-failed', verdictPassed: false, humanLabeled: true, label: 'bad' }),
      rec({ failureReason: 'verification-failed', verdictPassed: false, humanLabeled: true, label: 'good' }),
    ]);
    expect(h.passPrecision).toEqual({ good: 1, judged: 2 });
    expect(h.failPrecision).toEqual({ bad: 1, judged: 2 });
  });

  it('reports no precision at all rather than a made-up one', () => {
    const h = verificationHealth([rec({ verdictPassed: true })]);
    expect(h.passPrecision).toBeNull();
    expect(h.failPrecision).toBeNull();
  });
});

describe('formatVerificationHealth', () => {
  it('says nothing before anything has been verified', () => {
    expect(formatVerificationHealth(verificationHealth([]))).toBeNull();
  });

  it('puts the inconclusive rate in the line, which is the number that hid', () => {
    const line = formatVerificationHealth(
      verificationHealth([
        rec({ verdictPassed: true, humanLabeled: true, label: 'good' }),
        rec({ failureReason: 'verification-inconclusive' }),
      ]),
    );
    expect(line).toContain('verified 2');
    expect(line).toContain('inconclusive 1 (50.0%)');
    expect(line).toContain('PASS confirmed 1/1');
  });
});
