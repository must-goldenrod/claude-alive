import { describe, expect, it } from 'vitest';
import type { Ticket } from '@claude-alive/core';
import { failureLine } from '../failureLine.ts';

const t = (key: string) => key;
const ticket = (over: Partial<Ticket>): Ticket =>
  ({ id: 't', seq: 1, goal: 'g', cwd: '/x', state: 'failed', createdAt: 1, ...over } as Ticket);

describe('failureLine', () => {
  it('prefers the verifier own sentence — it is the only actionable text', () => {
    const out = failureLine(
      ticket({ failureReason: 'verification-failed', verification: { passed: false, reason: '테스트 3건이 여전히 실패' } }),
      t,
    );
    expect(out).toBe('테스트 3건이 여전히 실패');
  });

  it('falls back to the categorised reason when the verifier said nothing', () => {
    expect(failureLine(ticket({ failureReason: 'timeout' }), t)).toBe('tickets.failureReason.timeout');
  });

  it('prefers the crash message over the bare category for an error', () => {
    const out = failureLine(ticket({ failureReason: 'error', error: 'spawn claude ENOENT' }), t);
    expect(out).toBe('spawn claude ENOENT');
  });

  it('ignores a passing verification — it explains nothing about the failure', () => {
    const out = failureLine(
      ticket({ failureReason: 'timeout', verification: { passed: true, reason: '목표 달성' } }),
      t,
    );
    expect(out).toBe('tickets.failureReason.timeout');
  });

  it('falls back to the generic label when there is nothing at all', () => {
    expect(failureLine(ticket({}), t)).toBe('tickets.status.failed');
  });

  it('trims and collapses a multi-line verifier reason to one line', () => {
    const out = failureLine(
      ticket({ failureReason: 'verification-failed', verification: { passed: false, reason: '  첫 줄\n둘째 줄  ' } }),
      t,
    );
    expect(out).toBe('첫 줄 둘째 줄');
  });
});
