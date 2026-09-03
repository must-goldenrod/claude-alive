import { describe, it, expect } from 'vitest';
import type { Ticket } from '@claude-alive/core';
import { reviewPhase, REVIEW_PHASE_BORDER, reviewPhaseKey } from '../views/tickets/ticketDisplay.ts';

const t = (over: Partial<Ticket>): Ticket => ({
  id: 'x', seq: 1, goal: 'g', cwd: '/r', state: 'queued', createdAt: 0, ...over,
});

describe('reviewPhase', () => {
  it('reports work that has not been checked yet', () => {
    expect(reviewPhase(t({ state: 'queued' }))).toBe('unverified');
    expect(reviewPhase(t({ state: 'running' }))).toBe('unverified');
  });

  it('separates a gate in flight from the work that preceded it', () => {
    expect(reviewPhase(t({ state: 'verifying' }))).toBe('verifying');
  });

  it('reports a passed gate', () => {
    expect(reviewPhase(t({ state: 'done', verification: { passed: true, reason: 'ok' } }))).toBe('verified');
  });

  it('distinguishes a failed verification from any other failure', () => {
    expect(reviewPhase(t({ state: 'failed', failureReason: 'verification-failed' }))).toBe('verifyFailed');
    expect(reviewPhase(t({ state: 'failed', failureReason: 'verification-inconclusive' }))).toBe('verifyFailed');
    expect(reviewPhase(t({ state: 'failed', failureReason: 'timeout' }))).toBe('failed');
    expect(reviewPhase(t({ state: 'failed', failureReason: 'cancelled' }))).toBe('failed');
  });

  it('reads the decision sub-status off the advisory panel', () => {
    const d = (stage: 'pending' | 'deciding' | 'decided' | 'failed') =>
      t({ state: 'decision', decisionPanel: { stage, question: 'q', opinions: [], at: 0 } });
    expect(reviewPhase(t({ state: 'decision' }))).toBe('decisionPending');
    expect(reviewPhase(d('pending'))).toBe('decisionPending');
    expect(reviewPhase(d('deciding'))).toBe('decisionRunning');
    expect(reviewPhase(d('decided'))).toBe('decisionDone');
    expect(reviewPhase(d('failed'))).toBe('decisionFailed');
  });

  it('gives every phase a border colour and a translation key', () => {
    for (const phase of Object.keys(REVIEW_PHASE_BORDER) as (keyof typeof REVIEW_PHASE_BORDER)[]) {
      expect(REVIEW_PHASE_BORDER[phase]).toMatch(/^var\(--/);
      expect(reviewPhaseKey(phase)).toBe(`tickets.reviewPhase.${phase}`);
    }
  });

  it('keeps the unchecked state on the neutral border so colour always means "reviewed"', () => {
    expect(REVIEW_PHASE_BORDER.unverified).toContain('--border-default');
  });
});
