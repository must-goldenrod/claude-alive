import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import type { EfficioSessionProfile, EfficioAxisKey } from '@claude-alive/core';
import { wasteColor, compact } from './axes.ts';
import { projectComparison } from './reportAggregates.ts';

interface Props {
  sessions: readonly EfficioSessionProfile[];
  axis: EfficioAxisKey;
}

/** 프로젝트 간 비교 — project별 평균 낭비 백분위를 막대로. 크기 대비 비효율 프로젝트 식별. */
export function ProjectComparison({ sessions, axis }: Props) {
  const { t } = useTranslation();
  const rows = useMemo(() => projectComparison(sessions, axis), [sessions, axis]);

  if (rows.length === 0) {
    return <div className="text-[11px]" style={{ color: 'var(--text-secondary)' }}>{t('efficio.report.noData')}</div>;
  }

  return (
    <div className="flex flex-col gap-2">
      {rows.map((r) => (
        <div key={r.project} className="flex items-center gap-3">
          <span className="w-[120px] shrink-0 truncate text-[11px]" style={{ color: 'var(--text-primary)' }} title={r.project}>
            {r.project}
          </span>
          <div className="relative flex-1 h-4 rounded" style={{ background: 'var(--bg-secondary)' }}>
            <div
              className="absolute inset-y-0 left-0 rounded"
              style={{ width: `${Math.min(100, r.avgPercentile)}%`, background: wasteColor(r.avgPercentile), opacity: 0.55 }}
            />
          </div>
          <span className="shrink-0 w-9 text-right text-[11px] font-semibold" style={{ color: wasteColor(r.avgPercentile), fontFamily: 'var(--font-mono)' }}>
            {Math.round(r.avgPercentile)}%
          </span>
          <span className="shrink-0 w-20 text-right text-[10px]" style={{ color: 'var(--text-secondary)', fontFamily: 'var(--font-mono)' }}>
            {t('efficio.report.nSessions', { count: r.sessionCount })} · {compact(r.avgTokens)}
          </span>
        </div>
      ))}
    </div>
  );
}
