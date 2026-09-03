import { describe, it, expect } from 'vitest';
import type { UsageLimitsSnapshot } from '@claude-alive/core';
import { toUsagePills, formatRemaining, usagePillColor } from '../usagePills.ts';

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

  it('marks the 5-hour window hh:mm and the weekly windows dd:hh', () => {
    const pills = toUsagePills(snapshot());
    expect(pills.map((p) => p.remainingUnit)).toEqual(['hm', 'dh', 'dh']);
  });

  it('gives each window its own base colour, none of them the CPU/RAM green', () => {
    const colors = toUsagePills(snapshot()).map((p) => p.baseColor);
    expect(new Set(colors).size).toBe(3);
    expect(colors).not.toContain('var(--accent-green)');
    expect(colors).not.toContain('var(--accent-blue)');
  });
});

describe('formatRemaining', () => {
  const now = Date.UTC(2026, 8, 2, 12, 0, 0);

  it('renders the session window as hours and zero-padded minutes', () => {
    expect(formatRemaining(now + 2 * 3600_000 + 30 * 60_000, now, 'hm')).toBe('2h 30m');
    expect(formatRemaining(now + 45 * 60_000, now, 'hm')).toBe('0h 45m');
    expect(formatRemaining(now + 3600_000 + 5 * 60_000, now, 'hm')).toBe('1h 05m');
  });

  it('renders the weekly window as days and zero-padded hours', () => {
    expect(formatRemaining(now + 3 * 86400_000 + 4 * 3600_000, now, 'dh')).toBe('3d 04h');
    expect(formatRemaining(now + 5 * 3600_000, now, 'dh')).toBe('0d 05h');
  });

  it('returns null when there is no reset time or it already passed', () => {
    expect(formatRemaining(null, now, 'hm')).toBeNull();
    expect(formatRemaining(now - 1000, now, 'dh')).toBeNull();
  });
});

describe('usagePillColor', () => {
  it('keeps the window base colour while usage is normal', () => {
    expect(usagePillColor('var(--accent-teal)', 0.2)).toBe('var(--accent-teal)');
  });

  it('escalates to amber then red as the limit is approached', () => {
    expect(usagePillColor('var(--accent-teal)', 0.7)).toBe('var(--accent-amber)');
    expect(usagePillColor('var(--accent-teal)', 0.9)).toBe('var(--accent-red)');
  });
});
