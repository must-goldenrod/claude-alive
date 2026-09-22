import { describe, it, expect } from 'vitest';
import {
  extractVerdict,
  buildVerificationPrompt,
  createVerifier,
  describeGateFailure,
  GATE_ATTEMPTS,
} from '../ticketVerifier.js';
import type { HeadlessOutcome } from '../headlessClaude.js';
import type { JevClient } from '../jev/client.js';

describe('extractVerdict', () => {
  it('parses a bare verdict object', () => {
    expect(extractVerdict('{"passed": true, "reason": "build green"}')).toEqual({ passed: true, reason: 'build green' });
  });
  it('parses a verdict embedded in prose', () => {
    const text = 'I checked the repo.\nVerdict:\n{"passed": false, "reason": "tests fail"}\nDone.';
    expect(extractVerdict(text)).toEqual({ passed: false, reason: 'tests fail' });
  });
  it('defaults reason to empty string when missing', () => {
    expect(extractVerdict('{"passed": true}')).toEqual({ passed: true, reason: '' });
  });
  it('returns null for null / non-verdict / malformed text', () => {
    expect(extractVerdict(null)).toBeNull();
    expect(extractVerdict('no json here')).toBeNull();
    expect(extractVerdict('{"foo": 1}')).toBeNull();
  });

  // The old flat-brace scan could not see either of these, and a gate that says
  // nothing readable is recorded as a ticket that failed.
  it('reads a verdict that carries a nested object', () => {
    expect(extractVerdict('{"passed": true, "reason": "ok", "detail": {"tests": 12}}'))
      .toEqual({ passed: true, reason: 'ok' });
  });

  it('reads a verdict whose reason contains braces', () => {
    expect(extractVerdict('{"passed": false, "reason": "config {a: 1} is wrong"}'))
      .toEqual({ passed: false, reason: 'config {a: 1} is wrong' });
  });

  it('reads a verdict inside a fenced block', () => {
    expect(extractVerdict('Here you go:\n```json\n{"passed": true, "reason": "green"}\n```'))
      .toEqual({ passed: true, reason: 'green' });
  });
});

/**
 * Across 30 stored gate verdicts, 20 opened with "verified independently" and
 * none mentioned the goal — the gate was checking that the report's claims were
 * true, not that the goal was met.
 */
describe('the gate is asked about the goal, not only about the report', () => {
  it('asks which part of the goal is least covered, before the verdict', () => {
    const p = buildVerificationPrompt('do A and B', 'I did A');
    expect(p).toContain('COVERAGE');
    expect(p.indexOf('COVERAGE')).toBeLessThan(p.indexOf('Then the verdict'));
    expect(p).toContain('"coverage"');
  });

  it('says outright that true claims are not enough', () => {
    const p = buildVerificationPrompt('g', 'r');
    expect(p).toContain('necessary but not');
    expect(p).toContain('Do not pass something');
    expect(p).toContain('FAILS unless the work covers all of them');
  });

  it('keeps the coverage sentence with the verdict', () => {
    expect(extractVerdict('{"coverage":"B is untouched","passed":false,"reason":"only A"}')).toEqual({
      passed: false,
      reason: 'only A',
      coverage: 'B is untouched',
    });
  });

  it('still reads a verdict from a gate that skipped coverage', () => {
    expect(extractVerdict('{"passed":true,"reason":"ok"}')).toEqual({ passed: true, reason: 'ok' });
  });
});

describe('buildVerificationPrompt', () => {
  it('embeds the goal and reported result and demands JSON', () => {
    const p = buildVerificationPrompt('add feature X', 'I added X');
    expect(p).toContain('add feature X');
    expect(p).toContain('I added X');
    expect(p).toContain('"passed"');
  });
});

describe('createVerifier', () => {
  const outcome = (result: string | null): HeadlessOutcome => ({
    exitCode: 0,
    result: result === null ? null : { result, isError: false, sessionId: null, subtype: 'success', model: null },
    sessionId: null,
    stderr: '',
  });

  it('returns the parsed verdict', async () => {
    const v = createVerifier({ run: async () => outcome('{"passed": true, "reason": "ok"}') });
    await expect(v.verify({ goal: 'g', cwd: '/r', id: '1', state: 'verifying', createdAt: 0 }, 'r')).resolves.toEqual({
      passed: true,
      reason: 'ok',
    });
  });

  it('runs the gate with the ticket engine env and the ticket model', async () => {
    const seen: Array<{ flags?: unknown; extraEnv?: unknown }> = [];
    const v = createVerifier({
      run: async (opts) => {
        seen.push({ flags: opts.flags, extraEnv: opts.extraEnv });
        return outcome('{"passed": true, "reason": "ok"}');
      },
      agentEnv: (t) => (t.engine === 'gateway' ? { ANTHROPIC_MODEL: t.requestedModel ?? '' } : undefined),
    });
    await v.verify({ goal: 'g', cwd: '/r', id: '1', state: 'verifying', createdAt: 0, engine: 'gateway', requestedModel: 'glm-5.3', effort: 'high' }, 'r');
    await v.verify({ goal: 'g', cwd: '/r', id: '2', state: 'verifying', createdAt: 0 }, 'r');
    expect(seen[0]).toEqual({ flags: { model: 'glm-5.3', effort: 'high' }, extraEnv: { ANTHROPIC_MODEL: 'glm-5.3' } });
    expect(seen[1]!.extraEnv).toBeUndefined();
  });

  it('throws (fail-closed) when no verdict can be parsed', async () => {
    const v = createVerifier({ run: async () => outcome('the model rambled with no json'), log: () => {} });
    await expect(
      v.verify({ goal: 'g', cwd: '/r', id: '1', state: 'verifying', createdAt: 0 }, 'r'),
    ).rejects.toThrow();
  });

  /**
   * 14 of 266 verified tickets (5.3%) ended inconclusive, every one with a
   * finished agent report — the gate process failed, not the work.
   */
  it('asks again before calling a finished ticket inconclusive', async () => {
    let n = 0;
    const v = createVerifier({
      run: async () => {
        n += 1;
        return n === 1 ? outcome(null) : outcome('{"passed": true, "reason": "ok"}');
      },
      log: () => {},
    });
    await expect(v.verify({ goal: 'g', cwd: '/r', id: '1', state: 'verifying', createdAt: 0 }, 'r')).resolves.toEqual({
      passed: true,
      reason: 'ok',
    });
    expect(n).toBe(2);
  });

  it('retries a gate that could not start at all', async () => {
    let n = 0;
    const v = createVerifier({
      run: async () => {
        n += 1;
        if (n === 1) throw new Error('spawn ENOENT');
        return outcome('{"passed": false, "reason": "tests red"}');
      },
      log: () => {},
    });
    await expect(v.verify({ goal: 'g', cwd: '/r', id: '1', state: 'verifying', createdAt: 0 }, 'r')).resolves.toEqual({
      passed: false,
      reason: 'tests red',
    });
  });

  it('gives up after the fixed number of attempts and says what the gate did', async () => {
    let n = 0;
    const lines: string[] = [];
    const v = createVerifier({
      run: async () => {
        n += 1;
        return outcome('I could not find the repository');
      },
      log: (m) => lines.push(m),
    });
    await expect(
      v.verify({ goal: 'g', cwd: '/r', id: '1', seq: 7, state: 'verifying', createdAt: 0 }, 'r'),
    ).rejects.toThrow(/could not find the repository/);
    expect(n).toBe(GATE_ATTEMPTS);
    // Every attempt is reported, so an inconclusive ticket is explicable later.
    expect(lines).toHaveLength(GATE_ATTEMPTS);
    expect(lines[0]).toContain('#7');
  });
});

describe('describeGateFailure', () => {
  const out = (over: Partial<HeadlessOutcome>): HeadlessOutcome => ({
    exitCode: 0, result: null, sessionId: null, stderr: '', ...over,
  });

  it('quotes what the gate said when it answered without a verdict', () => {
    const d = describeGateFailure(out({
      result: { result: 'I think it is fine', isError: false, sessionId: null, subtype: 'success', model: null },
    }));
    expect(d).toContain('I think it is fine');
  });

  it('reports the exit code and stderr when it said nothing', () => {
    expect(describeGateFailure(out({ exitCode: 1, stderr: 'ENOENT: claude not found' })))
      .toContain('ENOENT: claude not found');
    expect(describeGateFailure(out({ exitCode: 137 }))).toContain('137');
  });
});

describe('createVerifier with a review panel', () => {
  const outcome2 = (result: string): HeadlessOutcome => ({
    exitCode: 0,
    result: { result, isError: false, sessionId: null, subtype: 'success', model: null },
    sessionId: null,
    stderr: '',
  });
  const ticket = { goal: 'g', cwd: '/r', id: '1', state: 'verifying', createdAt: 0 } as const;

  it('lets the panel overturn a gate PASS by majority', async () => {
    const v = createVerifier({
      run: async () => outcome2('{"passed": true, "reason": "looks done"}'),
      panel: {
        models: ['a', 'b'],
        run: async () => [
          { model: 'a', content: '{"passed":false,"reason":"different problem"}' },
          { model: 'b', content: '{"passed":false,"reason":"different problem"}' },
        ],
      },
      now: () => 7,
    });
    const verdict = await v.verify(ticket, 'r');
    expect(verdict.passed).toBe(false);
    expect(verdict.gate).toEqual({ passed: true, reason: 'looks done' });
    expect(verdict.consensus).toEqual({ agree: 2, total: 3 });
  });

  it('keeps the gate verdict untouched when no panel is configured', async () => {
    const v = createVerifier({ run: async () => outcome2('{"passed": true, "reason": "ok"}') });
    await expect(v.verify(ticket, 'r')).resolves.toEqual({ passed: true, reason: 'ok' });
  });
});

describe('createVerifier — Jev fallback for an inconclusive gate', () => {
  const outcome = (result: string | null): HeadlessOutcome => ({
    exitCode: 0,
    result: result === null ? null : { result, isError: false, sessionId: null, subtype: 'success', model: null },
    sessionId: null,
    stderr: '',
  });

  const ticket = { goal: 'g', cwd: '/r', id: '1', state: 'verifying' as const, createdAt: 0 };

  /** A Jev stand-in that answers with a fixed probability. */
  const jevSaying = (noul: number, coverage = 2.5): JevClient => ({
    model: 'jev-1.13.0',
    decide: async () => ({
      model: 'jev-1.13.0',
      answers: {
        met: { type: 'noul', noul },
        coverage: { type: 'score', score: coverage, confidence: 0.8 },
      },
    }),
  });

  it('still fails closed when no Jev is configured', async () => {
    const v = createVerifier({ run: async () => outcome('not a verdict'), log: () => {} });
    await expect(v.verify(ticket, 'r')).rejects.toThrow();
  });

  it('is never consulted when the gate produced a verdict', async () => {
    let called = 0;
    const jev: JevClient = {
      model: 'jev-1.13.0',
      decide: async () => {
        called += 1;
        throw new Error('should not be called');
      },
    };
    const v = createVerifier({ run: async () => outcome('{"passed": true, "reason": "ok"}'), jev, log: () => {} });

    await expect(v.verify(ticket, 'r')).resolves.toMatchObject({ passed: true });
    expect(called).toBe(0);
  });

  it('produces a verdict when the gate could not, rather than failing the ticket', async () => {
    const v = createVerifier({ run: async () => outcome('not a verdict'), jev: jevSaying(0.82), log: () => {} });

    const verdict = await v.verify(ticket, 'r');

    expect(verdict.passed).toBe(true);
    // Always worth a human glance: this verdict saw no working directory.
    expect(verdict.flagged).toBe(true);
    // The reason has to say what decided it and with what number.
    expect(verdict.reason).toContain('0.82');
    expect(verdict.reason).toMatch(/jev/i);
  });

  it('fails the ticket when Jev puts the goal below the midpoint', async () => {
    const v = createVerifier({ run: async () => outcome('not a verdict'), jev: jevSaying(0.18), log: () => {} });

    const verdict = await v.verify(ticket, 'r');

    expect(verdict.passed).toBe(false);
    expect(verdict.flagged).toBe(true);
  });

  it('does not claim the Claude gate said anything — `gate` stays absent', async () => {
    const v = createVerifier({ run: async () => outcome('not a verdict'), jev: jevSaying(0.9), log: () => {} });
    expect((await v.verify(ticket, 'r')).gate).toBeUndefined();
  });

  it('keeps failing closed when Jev itself errors', async () => {
    const jev: JevClient = {
      model: 'jev-1.13.0',
      decide: async () => {
        throw new Error('429');
      },
    };
    const v = createVerifier({ run: async () => outcome('not a verdict'), jev, log: () => {} });

    await expect(v.verify(ticket, 'r')).rejects.toThrow();
  });

  it('honours a per-ticket resolver that withholds Jev from this ticket', async () => {
    const v = createVerifier({
      run: async () => outcome('not a verdict'),
      jev: () => undefined,
      log: () => {},
    });

    await expect(v.verify(ticket, 'r')).rejects.toThrow();
  });

  it('sends the goal and the report, and nothing else', async () => {
    const seen: unknown[] = [];
    const jev: JevClient = {
      model: 'jev-1.13.0',
      decide: async (state) => {
        seen.push(state);
        return {
          model: 'jev-1.13.0',
          answers: { met: { type: 'noul', noul: 0.7 }, coverage: { type: 'score', score: 2, confidence: 0.5 } },
        };
      },
    };
    const v = createVerifier({ run: async () => outcome('not a verdict'), jev, log: () => {} });

    await v.verify(ticket, 'the report');

    expect(seen[0]).toEqual({ goal: 'g', report: 'the report' });
  });
});
