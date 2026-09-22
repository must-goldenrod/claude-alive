import { describe, expect, it, vi } from 'vitest';
import { JevError, type JevClient, type JevResult } from '../jev/client.js';
import { JEV_DEFAULT_CALL_BUDGET, guardJevClient, jevEnabled } from '../jev/guard.js';

const answer: JevResult = {
  model: 'jev-1.13.0',
  answers: { met: { type: 'noul', noul: 0.8 } },
};

function fakeClient(impl: () => Promise<JevResult>): JevClient {
  return { model: 'jev-1.13.0', decide: impl };
}

describe('jevEnabled — the off switch', () => {
  it('is on when a key is present and nothing says otherwise', () => {
    expect(jevEnabled({ TYPESAFE_API_KEY: 'k' })).toBe(true);
  });

  it('is off without a key', () => {
    expect(jevEnabled({})).toBe(false);
  });

  it('is off when explicitly disabled, even with a key — no edit to the key file needed', () => {
    for (const value of ['0', 'off', 'false', 'no', 'OFF']) {
      expect(jevEnabled({ TYPESAFE_API_KEY: 'k', CA_JEV_FALLBACK: value })).toBe(false);
    }
  });

  it('stays on for any other value', () => {
    expect(jevEnabled({ TYPESAFE_API_KEY: 'k', CA_JEV_FALLBACK: '1' })).toBe(true);
  });
});

describe('guardJevClient — billing signals disarm it permanently', () => {
  it('passes a normal call straight through', async () => {
    const guarded = guardJevClient(fakeClient(async () => answer));
    await expect(guarded.decide('s', {})).resolves.toEqual(answer);
    expect(guarded.disarmedReason).toBeNull();
  });

  for (const status of [401, 402, 403]) {
    it(`disarms for good on HTTP ${status} and never calls again`, async () => {
      let calls = 0;
      const guarded = guardJevClient(
        fakeClient(async () => {
          calls += 1;
          throw new JevError(`Jev returned HTTP ${status}`, status);
        }),
      );

      await expect(guarded.decide('s', {})).rejects.toThrow(JevError);
      await expect(guarded.decide('s', {})).rejects.toThrow(/disarmed/i);
      await expect(guarded.decide('s', {})).rejects.toThrow(/disarmed/i);

      expect(calls).toBe(1);
      expect(guarded.disarmedReason).toMatch(String(status));
    });
  }

  it('disarms when the account reports no quota left', async () => {
    let calls = 0;
    const guarded = guardJevClient(
      fakeClient(async () => {
        calls += 1;
        return { ...answer, quota: { used: 50, limit: 50, remaining: 0 } };
      }),
    );

    await expect(guarded.decide('s', {})).resolves.toBeDefined();
    await expect(guarded.decide('s', {})).rejects.toThrow(/disarmed/i);
    expect(calls).toBe(1);
  });

  it('does NOT disarm while quota remains', async () => {
    const guarded = guardJevClient(fakeClient(async () => ({ ...answer, quota: { remaining: 3 } })));
    await guarded.decide('s', {});
    await guarded.decide('s', {});
    expect(guarded.disarmedReason).toBeNull();
  });

  it('survives an ordinary failure without disarming — a 500 is not a bill', async () => {
    const guarded = guardJevClient(
      fakeClient(async () => {
        throw new JevError('Jev returned HTTP 503', 503);
      }),
    );
    await expect(guarded.decide('s', {})).rejects.toThrow(JevError);
    expect(guarded.disarmedReason).toBeNull();
  });

  it('stops at the call budget so a loop cannot run up a bill', async () => {
    let calls = 0;
    const guarded = guardJevClient(fakeClient(async () => {
      calls += 1;
      return answer;
    }), { budget: 3 });

    await guarded.decide('s', {});
    await guarded.decide('s', {});
    await guarded.decide('s', {});
    await expect(guarded.decide('s', {})).rejects.toThrow(/budget/i);

    expect(calls).toBe(3);
    expect(guarded.disarmedReason).toMatch(/budget/i);
  });

  it('has a budget by default rather than none', () => {
    expect(JEV_DEFAULT_CALL_BUDGET).toBeGreaterThan(0);
  });

  it('reports each disarm once, loudly', async () => {
    const log = vi.fn();
    const guarded = guardJevClient(
      fakeClient(async () => {
        throw new JevError('Jev returned HTTP 402', 402);
      }),
      { log },
    );

    await expect(guarded.decide('s', {})).rejects.toThrow();
    await expect(guarded.decide('s', {})).rejects.toThrow();

    expect(log).toHaveBeenCalledTimes(1);
    expect(log.mock.calls[0]![0]).toMatch(/402/);
  });

  it('keeps the wrapped model id so a verdict still records what answered', () => {
    expect(guardJevClient(fakeClient(async () => answer)).model).toBe('jev-1.13.0');
  });
});
