/**
 * 리포트용 표시 집계 — 순수 함수. 백분위(점수)는 efficio가 계산한 것을 그대로 읽고,
 * 여기서는 평균·추세·비율·기간 그룹 같은 *표시용 집계*만 한다(통계 점수 재계산 아님 →
 * "통계 단일출처=efficio" 원칙 유지). EfficioView의 리포트 탭들이 소비.
 */
import type { EfficioSessionProfile, EfficioAxisKey } from '@claude-alive/core';

export interface ProjectRow {
  project: string;
  avgPercentile: number;
  sessionCount: number;
  avgTokens: number;
}

/** project별로 묶어 해당 축 낭비 백분위 평균을 낸다. 백분위 내림차순(나쁜 프로젝트 먼저). null project 제외. */
export function projectComparison(
  sessions: readonly EfficioSessionProfile[],
  axis: EfficioAxisKey,
): ProjectRow[] {
  const groups = new Map<string, { pctSum: number; tokenSum: number; n: number }>();
  for (const s of sessions) {
    if (!s.project) continue;
    const g = groups.get(s.project) ?? { pctSum: 0, tokenSum: 0, n: 0 };
    groups.set(s.project, {
      pctSum: g.pctSum + s.axes[axis].wastePercentile,
      tokenSum: g.tokenSum + s.totalTokens,
      n: g.n + 1,
    });
  }
  return [...groups.entries()]
    .map(([project, g]) => ({
      project,
      avgPercentile: g.pctSum / g.n,
      sessionCount: g.n,
      avgTokens: g.tokenSum / g.n,
    }))
    .sort((a, b) => b.avgPercentile - a.avgPercentile);
}

export interface Trend {
  /** 최소제곱 선형회귀 기울기(백분위/세션). 양수=악화 추세. */
  slope: number;
  /** slope > 0 (낭비 백분위가 시간에 따라 상승). */
  rising: boolean;
}

/** 시간순(tsFirst) 백분위 계열의 선형 추세 기울기. 점이 3개 미만이면 추세 없음(0). */
export function trendSlope(
  sessions: readonly EfficioSessionProfile[],
  axis: EfficioAxisKey,
): Trend {
  const ys = [...sessions]
    .sort((a, b) => a.tsFirst - b.tsFirst)
    .map((s) => s.axes[axis].wastePercentile);
  const n = ys.length;
  if (n < 3) return { slope: 0, rising: false };
  const mx = (n - 1) / 2; // x = 0..n-1
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i++) {
    num += (i - mx) * (ys[i] - my);
    den += (i - mx) * (i - mx);
  }
  const slope = den === 0 ? 0 : num / den;
  return { slope, rising: slope > 0 };
}

/** 한 세션의 캐시 재사용 비율 = read / (read + creation). 캐시 활동 없으면 0. */
export function cacheReuseRatio(session: EfficioSessionProfile): number {
  const total = session.cacheRead + session.cacheCreation;
  return total === 0 ? 0 : session.cacheRead / total;
}

export interface WeekBucket {
  /** 주 시작 epoch seconds(주 경계로 내림). */
  weekStart: number;
  sessions: EfficioSessionProfile[];
  avgPercentile: number;
}

const WEEK_SECONDS = 7 * 24 * 3600;

/** tsFirst를 주(7일) 경계로 그룹화. 최신 주 먼저. 각 주의 해당 축 평균 백분위 포함. */
export function weeklyBuckets(
  sessions: readonly EfficioSessionProfile[],
  axis: EfficioAxisKey,
): WeekBucket[] {
  const groups = new Map<number, EfficioSessionProfile[]>();
  for (const s of sessions) {
    const weekStart = Math.floor(s.tsFirst / WEEK_SECONDS) * WEEK_SECONDS;
    const arr = groups.get(weekStart);
    if (arr) arr.push(s);
    else groups.set(weekStart, [s]);
  }
  return [...groups.entries()]
    .sort((a, b) => b[0] - a[0]) // 최신 주 먼저
    .map(([weekStart, ss]) => ({
      weekStart,
      sessions: ss,
      avgPercentile: ss.reduce((acc, s) => acc + s.axes[axis].wastePercentile, 0) / ss.length,
    }));
}
