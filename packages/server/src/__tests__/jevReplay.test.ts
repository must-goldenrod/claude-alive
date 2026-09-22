import { describe, expect, it } from 'vitest';
import {
  COVERAGE_LEVELS,
  buildVerificationQuestions,
  buildVerificationState,
  isReplayable,
  selectReplayable,
  wasClipped,
  sweepThresholds,
  tallyAt,
  type ReplayRow,
} from '../jev/replay.js';

const record = {
  ticketId: 't-1',
  goal: 'Fix the login redirect',
  result: 'Renamed a CSS class',
  verdictPassed: true,
  label: 'good' as const,
  humanLabeled: true,
  failureReason: undefined,
};

describe('isReplayable', () => {
  it('accepts a record with a goal, a report and a gate verdict', () => {
    expect(isReplayable(record)).toBe(true);
  });

  it('rejects a record with no agent report — there is nothing to judge', () => {
    expect(isReplayable({ ...record, result: undefined })).toBe(false);
  });

  it('keeps an inconclusive record, which is the case Jev is meant to recover', () => {
    expect(
      isReplayable({ ...record, verdictPassed: undefined, failureReason: 'verification-inconclusive' }),
    ).toBe(true);
  });

  it('rejects a cancelled run: the agent never finished, so its report is not evidence', () => {
    expect(isReplayable({ ...record, verdictPassed: undefined, failureReason: 'cancelled' })).toBe(false);
  });
});

describe('buildVerificationState', () => {
  it('sends the goal and the report as separate fields, not one blob', () => {
    expect(buildVerificationState(record)).toEqual({
      goal: 'Fix the login redirect',
      report: 'Renamed a CSS class',
    });
  });

  it('clips a long report so one record cannot dominate the bill', () => {
    const long = 'x'.repeat(40_000);
    const state = buildVerificationState({ ...record, result: long });
    expect((state.report as string).length).toBeLessThan(20_000);
    expect(state.report as string).toMatch(/truncated/);
  });
});

describe('buildVerificationQuestions', () => {
  it('asks one yes/no on the goal and one rubric on coverage', () => {
    const questions = buildVerificationQuestions();
    expect(questions.met.type).toBe('noul');
    expect(questions.coverage.type).toBe('score');
    expect(questions.coverage).toMatchObject({ criteria: COVERAGE_LEVELS });
  });
});

describe('sweepThresholds', () => {
  const rows: ReplayRow[] = [
    { ticketId: 'a', noul: 0.95, coverage: 3, gate: 'pass', human: 'good' },
    { ticketId: 'b', noul: 0.9, coverage: 3, gate: 'fail', human: 'good' },
    { ticketId: 'c', noul: 0.1, coverage: 0, gate: 'fail', human: 'bad' },
    { ticketId: 'd', noul: 0.2, coverage: 1, gate: 'pass', human: 'bad' },
  ];

  it('counts Jev against the human label at a given threshold', () => {
    const tally = tallyAt(rows, 0.5);
    expect(tally).toMatchObject({ truePass: 2, falsePass: 0, trueFail: 2, falseFail: 0 });
  });

  it('moves rows across the boundary as the threshold rises', () => {
    expect(tallyAt(rows, 0.92).truePass).toBe(1);
    expect(tallyAt(rows, 0.92).falseFail).toBe(1);
  });

  it('reports every threshold in the sweep, ordered', () => {
    const sweep = sweepThresholds(rows, [0.3, 0.5, 0.7]);
    expect(sweep.map((s) => s.threshold)).toEqual([0.3, 0.5, 0.7]);
    expect(sweep[0]!.agreementWithHuman).toBeCloseTo(1);
  });

  it('ignores rows the human never labelled — they cannot score anything', () => {
    const withUnrated: ReplayRow[] = [...rows, { ticketId: 'e', noul: 0.5, coverage: 2, gate: 'pass', human: null }];
    expect(tallyAt(withUnrated, 0.5).judged).toBe(4);
  });

  it('counts where Jev and the gate disagree, which is the point of the exercise', () => {
    const tally = tallyAt(rows, 0.5);
    // b: gate failed, Jev passes, human says good → gate false alarm Jev avoids.
    // d: gate passed, Jev fails, human says bad → gate miss Jev catches.
    expect(tally.gateFalseAlarmsJevAvoided).toBe(1);
    expect(tally.gateMissesJevCaught).toBe(1);
  });
});

describe('selectReplayable — the panel policy applies to the replay too', () => {
  const base = { ...record, route: '/repo/open' };

  it('keeps records whose route is not excluded', () => {
    expect(selectReplayable([base], ['/repo/secret']).map((r) => r.ticketId)).toEqual(['t-1']);
  });

  it('drops a record whose route sits under an excluded root', () => {
    const secret = { ...base, ticketId: 't-2', route: '/repo/secret/nested' };
    expect(selectReplayable([base, secret], ['/repo/secret']).map((r) => r.ticketId)).toEqual(['t-1']);
  });

  it('drops a record with no route at all when any root is excluded — fail closed', () => {
    const unknown = { ...base, ticketId: 't-3', route: undefined };
    expect(selectReplayable([unknown], ['/repo/secret'])).toEqual([]);
  });

  it('keeps a record with no route when nothing is excluded', () => {
    const unknown = { ...base, ticketId: 't-3', route: undefined };
    expect(selectReplayable([unknown], []).map((r) => r.ticketId)).toEqual(['t-3']);
  });

  it('still applies the replayability filter', () => {
    const cancelled = { ...base, ticketId: 't-4', verdictPassed: undefined, failureReason: 'cancelled' };
    expect(selectReplayable([cancelled], [])).toEqual([]);
  });
});

describe('buildVerificationState — clipping is observable', () => {
  it('reports that nothing was clipped for a short record', () => {
    expect(wasClipped(record)).toBe(false);
  });

  it('reports a clipped record so the run can count them', () => {
    expect(wasClipped({ ...record, result: 'x'.repeat(40_000) })).toBe(true);
  });
});
