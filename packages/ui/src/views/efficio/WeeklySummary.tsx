import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import type { EfficioSessionProfile, EfficioAxisKey } from '@claude-alive/core';
import { wasteColor } from './axes.ts';
import { weeklyBuckets } from './reportAggregates.ts';

interface Props {
  sessions: readonly EfficioSessionProfile[];
  axis: EfficioAxisKey;
  onSelect: (id: string) => void;
}

const TOP_PER_WEEK = 3;

function weekLabel(weekStart: number): string {
  // epoch seconds → YYYY-MM-DD (주 시작). 로캘 무관 안정 표기.
  return new Date(weekStart * 1000).toISOString().slice(0, 10);
}

/** 기간 요약(주간) — 주별 평균 낭비 + 해당 주 낭비 상위 세션. 정기 점검용 한 장 요약. */
export function WeeklySummary({ sessions, axis, onSelect }: Props) {
  const { t } = useTranslation();
  const buckets = useMemo(() => weeklyBuckets(sessions, axis), [sessions, axis]);

  if (buckets.length === 0) {
    return <div className="text-[11px]" style={{ color: 'var(--text-secondary)' }}>{t('efficio.report.noData')}</div>;
  }

  return (
    <div className="flex flex-col gap-3">
      {buckets.map((b) => {
        const top = [...b.sessions]
          .sort((x, y) => y.axes[axis].wastePercentile - x.axes[axis].wastePercentile)
          .slice(0, TOP_PER_WEEK);
        return (
          <div key={b.weekStart} className="border rounded-lg px-3 py-2" style={{ borderColor: 'var(--border-color)', background: 'var(--bg-secondary)' }}>
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-[11px] font-semibold" style={{ color: 'var(--text-primary)', fontFamily: 'var(--font-mono)' }}>
                {weekLabel(b.weekStart)}
              </span>
              <span className="text-[10px]" style={{ color: 'var(--text-secondary)' }}>
                {t('efficio.report.nSessions', { count: b.sessions.length })} · {t('efficio.report.weekAvg', { pct: Math.round(b.avgPercentile) })}
              </span>
            </div>
            <div className="flex flex-col gap-0.5">
              {top.map((s) => (
                <button
                  key={s.sessionId}
                  onClick={() => onSelect(s.sessionId)}
                  className="w-full text-left flex items-center gap-2 text-[10px] px-1 py-0.5 rounded"
                  style={{ color: 'var(--text-secondary)' }}
                >
                  <span className="shrink-0 w-8 text-right font-semibold" style={{ color: wasteColor(s.axes[axis].wastePercentile), fontFamily: 'var(--font-mono)' }}>
                    {s.axes[axis].isZero ? '—' : `${Math.round(s.axes[axis].wastePercentile)}%`}
                  </span>
                  <span className="flex-1 min-w-0 truncate" title={s.title}>{s.title}</span>
                </button>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
