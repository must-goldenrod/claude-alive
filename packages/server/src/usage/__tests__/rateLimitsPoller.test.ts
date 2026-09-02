import { describe, it, expect, vi } from 'vitest';
import { parseUsageResponse, UsageLimitsPoller } from '../rateLimitsPoller.js';

/** Trimmed copy of a real `/api/oauth/usage` 200 body. */
const REAL_BODY = {
  five_hour: { utilization: 5.0, resets_at: '2026-09-02T15:39:59.510400+00:00' },
  seven_day: { utilization: 7.0, resets_at: '2026-09-06T00:59:59.510421+00:00' },
  seven_day_opus: null,
  limits: [
    { kind: 'session', group: 'session', percent: 5, resets_at: '2026-09-02T15:39:59.510400+00:00', scope: null },
    { kind: 'weekly_all', group: 'weekly', percent: 7, resets_at: '2026-09-06T00:59:59.510421+00:00', scope: null },
    {
      kind: 'weekly_scoped',
      group: 'weekly',
      percent: 12,
      resets_at: null,
      scope: { model: { id: null, display_name: 'Fable' } },
    },
  ],
};

describe('parseUsageResponse', () => {
  it('reads the 5-hour and 7-day windows as 0..1 fractions', () => {
    const snap = parseUsageResponse(REAL_BODY, 1000);
    expect(snap?.fiveHour).toEqual({
      utilization: 0.05,
      resetsAt: Date.parse('2026-09-02T15:39:59.510400+00:00'),
    });
    expect(snap?.sevenDay?.utilization).toBeCloseTo(0.07);
    expect(snap?.fetchedAt).toBe(1000);
    expect(snap?.stale).toBe(false);
  });

  it('extracts model-scoped weekly windows with their display name', () => {
    const snap = parseUsageResponse(REAL_BODY, 0);
    expect(snap?.scopedWeekly).toEqual([{ modelName: 'Fable', utilization: 0.12, resetsAt: null }]);
  });

  it('falls back to limits[] when the top-level windows are absent', () => {
    const snap = parseUsageResponse({ limits: REAL_BODY.limits }, 0);
    expect(snap?.fiveHour?.utilization).toBeCloseTo(0.05);
    expect(snap?.sevenDay?.utilization).toBeCloseTo(0.07);
  });

  it('returns null for a body carrying no usable window', () => {
    expect(parseUsageResponse({ five_hour: null, seven_day: null, limits: [] }, 0)).toBeNull();
    expect(parseUsageResponse(null, 0)).toBeNull();
    expect(parseUsageResponse('nope', 0)).toBeNull();
  });

  it('ignores windows with a non-numeric utilization rather than emitting NaN', () => {
    const snap = parseUsageResponse(
      { five_hour: { utilization: 'x', resets_at: null }, seven_day: { utilization: 40 } },
      0,
    );
    expect(snap?.fiveHour).toBeNull();
    expect(snap?.sevenDay?.utilization).toBeCloseTo(0.4);
  });
});

describe('UsageLimitsPoller', () => {
  const ok = (body: unknown) => ({ ok: true, status: 200, json: async () => body }) as Response;

  it('publishes a parsed snapshot to subscribers', async () => {
    const poller = new UsageLimitsPoller({
      intervalMs: 60_000,
      readToken: async () => 'tok',
      fetchImpl: async () => ok(REAL_BODY),
    });
    const seen: unknown[] = [];
    poller.subscribe((s) => seen.push(s));
    await poller.pollOnce();
    expect(seen).toHaveLength(1);
    expect(poller.latest()?.fiveHour?.utilization).toBeCloseTo(0.05);
  });

  it('keeps the last snapshot and marks it stale when a poll fails', async () => {
    let fail = false;
    const poller = new UsageLimitsPoller({
      readToken: async () => 'tok',
      fetchImpl: async () => {
        if (fail) throw new Error('network down');
        return ok(REAL_BODY);
      },
    });
    await poller.pollOnce();
    fail = true;
    await poller.pollOnce();

    const latest = poller.latest();
    expect(latest?.stale).toBe(true);
    expect(latest?.fiveHour?.utilization).toBeCloseTo(0.05);
  });

  it('marks stale on a 401 instead of dropping the values', async () => {
    let unauthorized = false;
    const poller = new UsageLimitsPoller({
      readToken: async () => 'tok',
      fetchImpl: async () =>
        unauthorized ? ({ ok: false, status: 401, json: async () => ({}) } as Response) : ok(REAL_BODY),
    });
    await poller.pollOnce();
    unauthorized = true;
    await poller.pollOnce();
    expect(poller.latest()?.stale).toBe(true);
  });

  it('stays null when no token is available and never calls fetch', async () => {
    const fetchImpl = vi.fn();
    const poller = new UsageLimitsPoller({ readToken: async () => null, fetchImpl });
    await poller.pollOnce();
    expect(poller.latest()).toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('re-reads the token on every poll so a refreshed credential is picked up', async () => {
    const tokens = ['old', 'new'];
    const used: string[] = [];
    const poller = new UsageLimitsPoller({
      readToken: async () => tokens.shift() ?? null,
      fetchImpl: async (_url, init) => {
        used.push(String((init?.headers as Record<string, string>)?.Authorization));
        return ok(REAL_BODY);
      },
    });
    await poller.pollOnce();
    await poller.pollOnce();
    expect(used).toEqual(['Bearer old', 'Bearer new']);
  });
});
