import { describe, it, expect } from 'vitest';
import { extractVerdict, buildVerificationPrompt, createVerifier } from '../ticketVerifier.js';
import type { HeadlessOutcome } from '../headlessClaude.js';

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
    result: result === null ? null : { result, isError: false, sessionId: null, subtype: 'success' },
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

  it('throws (fail-closed) when no verdict can be parsed', async () => {
    const v = createVerifier({ run: async () => outcome('the model rambled with no json') });
    await expect(
      v.verify({ goal: 'g', cwd: '/r', id: '1', state: 'verifying', createdAt: 0 }, 'r'),
    ).rejects.toThrow();
  });
});
