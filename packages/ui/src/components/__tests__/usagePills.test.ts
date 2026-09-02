import { describe, it, expect } from 'vitest';
import type { UsageLimitsSnapshot } from '@claude-alive/core';
import { toUsagePills, formatResetsIn } from '../usagePills.ts';

const snapshot = (over: Partial<UsageLimitsSnapshot> = {}): UsageLimitsSnapshot => ({
  fiveHour: { utilization: 0.05, resetsAt: null },
  sevenDay: { utilization: 0.07, resetsAt: null },
  scopedWeekly: [{ modelName: 'Fable', utilization: 0.12, resetsAt: null }],
  fetchedAt: 0,
  stale: false,
  ...over,
});

describe('toUsagePills', () => {
  it('orders 5H, 7D, then model-scoped windows', () => {
    expect(toUsagePills(snapshot()).map((p) => p.label)).toEqual(['5H', '7D', 'FABLE']);
  });

  it('omits windows the API did not report', () => {
    const pills = toUsagePills(snapshot({ fiveHour: null, scopedWeekly: [] }));
    expect(pills.map((p) => p.label)).toEqual(['7D']);
  });

  it('returns nothing for a null snapshot', () => {
    expect(toUsagePills(null)).toEqual([]);
  });

  it('carries the stale flag onto every pill', () => {
    expect(toUsagePills(snapshot({ stale: true })).every((p) => p.stale)).toBe(true);
  });

  it('clamps the ratio at 1 so an overage bar does not overflow its track', () => {
    const pills = toUsagePills(snapshot({ fiveHour: { utilization: 1.4, resetsAt: null } }));
    expect(pills[0]!.ratio).toBe(1);
    // The displayed percentage still tells the truth about the overage.
    expect(pills[0]!.percent).toBe(140);
  });
});

describe('formatResetsIn', () => {
  const now = Date.UTC(2026, 8, 2, 12, 0, 0);

  it('renders hours and minutes for a window resetting today', () => {
    expect(formatResetsIn(now + 2 * 3600_000 + 30 * 60_000, now)).toBe('2h 30m');
  });

  it('renders minutes only under an hour', () => {
    expect(formatResetsIn(now + 45 * 60_000, now)).toBe('45m');
  });

  it('renders days and hours for a multi-day window', () => {
    expect(formatResetsIn(now + 3 * 86400_000 + 4 * 3600_000, now)).toBe('3d 4h');
  });

  it('returns null when there is no reset time or it already passed', () => {
    expect(formatResetsIn(null, now)).toBeNull();
    expect(formatResetsIn(now - 1000, now)).toBeNull();
  });
});
