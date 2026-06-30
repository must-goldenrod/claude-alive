import { describe, it, expect } from 'vitest';
import type { EfficioSessionProfile, EfficioAxisKey } from '@claude-alive/core';
import {
  projectComparison,
  trendSlope,
  cacheReuseRatio,
  weeklyBuckets,
} from '../reportAggregates.ts';

// 최소 세션 팩토리 — 리포트가 읽는 필드만 채운다.
function session(p: Partial<EfficioSessionProfile> & { pct?: number }): EfficioSessionProfile {
  const pct = p.pct ?? 0;
  const axis = (wp: number) => ({ actual: 0, baseline: 0, residual: 0, wastePercentile: wp, isZero: false });
  return {
    sessionId: p.sessionId ?? 'x',
    title: p.title ?? 't',
    project: p.project ?? null,
    tsFirst: p.tsFirst ?? 0,
    turns: p.turns ?? 3,
    totalTokens: p.totalTokens ?? 1000,
    cacheCreation: p.cacheCreation ?? 0,
    cacheRead: p.cacheRead ?? 0,
    axes: p.axes ?? { w2: axis(pct), wc: axis(pct), bash: axis(pct), w3: axis(pct) },
    topBash: p.topBash ?? [],
    topEdits: p.topEdits ?? [],
  };
}

const AXIS: EfficioAxisKey = 'w2';

describe('projectComparison', () => {
  it('groups by project and averages the axis percentile, sorted desc', () => {
    const rows = projectComparison(
      [
        session({ project: 'a', pct: 80 }),
        session({ project: 'a', pct: 60 }),
        session({ project: 'b', pct: 20 }),
      ],
      AXIS,
    );
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ project: 'a', avgPercentile: 70, sessionCount: 2 });
    expect(rows[1]).toMatchObject({ project: 'b', avgPercentile: 20, sessionCount: 1 });
  });

  it('ignores sessions with null project', () => {
    const rows = projectComparison([session({ project: null, pct: 99 })], AXIS);
    expect(rows).toHaveLength(0);
  });
});

describe('trendSlope', () => {
  it('returns positive slope and rising=true for an increasing series', () => {
    const sessions = [10, 20, 30, 40].map((pct, i) => session({ tsFirst: i, pct }));
    const t = trendSlope(sessions, AXIS);
    expect(t.slope).toBeCloseTo(10, 5);
    expect(t.rising).toBe(true);
  });

  it('returns negative slope and rising=false for a decreasing series', () => {
    const sessions = [40, 30, 20, 10].map((pct, i) => session({ tsFirst: i, pct }));
    const t = trendSlope(sessions, AXIS);
    expect(t.slope).toBeLessThan(0);
    expect(t.rising).toBe(false);
  });

  it('returns slope 0 when fewer than 3 points', () => {
    const t = trendSlope([session({ pct: 50 })], AXIS);
    expect(t.slope).toBe(0);
    expect(t.rising).toBe(false);
  });

  it('orders by tsFirst before computing (input order independent)', () => {
    const sessions = [
      session({ tsFirst: 3, pct: 40 }),
      session({ tsFirst: 0, pct: 10 }),
      session({ tsFirst: 2, pct: 30 }),
      session({ tsFirst: 1, pct: 20 }),
    ];
    expect(trendSlope(sessions, AXIS).slope).toBeCloseTo(10, 5);
  });
});

describe('cacheReuseRatio', () => {
  it('computes read / (read + creation)', () => {
    expect(cacheReuseRatio(session({ cacheRead: 90, cacheCreation: 10 }))).toBeCloseTo(0.9, 5);
  });

  it('returns 0 when there is no cache activity', () => {
    expect(cacheReuseRatio(session({ cacheRead: 0, cacheCreation: 0 }))).toBe(0);
  });
});

describe('weeklyBuckets', () => {
  const WEEK = 7 * 24 * 3600;
  it('groups sessions into ISO-week buckets by tsFirst', () => {
    const buckets = weeklyBuckets(
      [
        session({ sessionId: 's1', tsFirst: 0, pct: 10 }),
        session({ sessionId: 's2', tsFirst: 3600, pct: 30 }), // 같은 주
        session({ sessionId: 's3', tsFirst: WEEK + 3600, pct: 50 }), // 다음 주
      ],
      AXIS,
    );
    expect(buckets).toHaveLength(2);
    // 최신 주가 먼저
    expect(buckets[0].sessions).toHaveLength(1);
    expect(buckets[1].sessions).toHaveLength(2);
    expect(buckets[1].avgPercentile).toBe(20);
  });

  it('returns empty for no sessions', () => {
    expect(weeklyBuckets([], AXIS)).toHaveLength(0);
  });
});
