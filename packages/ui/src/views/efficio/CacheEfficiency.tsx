import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import type { EfficioSessionProfile } from '@claude-alive/core';
import { compact } from './axes.ts';
import { cacheReuseRatio } from './reportAggregates.ts';

interface Props {
  sessions: readonly EfficioSessionProfile[];
}

/** 캐시 효율 — read/(read+creation) 재사용 비율. 높을수록 컨텍스트 재사용 좋음(재무효화 적음). */
export function CacheEfficiency({ sessions }: Props) {
  const { t } = useTranslation();
  const { avgRatio, totalRead, totalCreation, n } = useMemo(() => {
    let read = 0;
    let creation = 0;
    let ratioSum = 0;
    let counted = 0;
    for (const s of sessions) {
      read += s.cacheRead;
      creation += s.cacheCreation;
      if (s.cacheRead + s.cacheCreation > 0) {
        ratioSum += cacheReuseRatio(s);
        counted += 1;
      }
    }
    return { avgRatio: counted ? ratioSum / counted : 0, totalRead: read, totalCreation: creation, n: counted };
  }, [sessions]);

  if (n === 0) {
    return <div className="text-[11px]" style={{ color: 'var(--text-secondary)' }}>{t('efficio.report.noData')}</div>;
  }

  const pct = Math.round(avgRatio * 100);
  // 재사용 높을수록 좋음 → 녹색, 낮을수록 경고색.
  const color = pct >= 70 ? 'var(--accent-green, #3fb950)' : pct >= 40 ? 'var(--accent-amber, #d29922)' : 'var(--accent-red, #f85149)';

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-3">
        <div className="relative flex-1 h-4 rounded" style={{ background: 'var(--bg-secondary)' }}>
          <div className="absolute inset-y-0 left-0 rounded" style={{ width: `${pct}%`, background: color, opacity: 0.55 }} />
        </div>
        <span className="shrink-0 w-10 text-right text-[12px] font-semibold" style={{ color, fontFamily: 'var(--font-mono)' }}>
          {pct}%
        </span>
      </div>
      <div className="text-[10px]" style={{ color: 'var(--text-secondary)', fontFamily: 'var(--font-mono)' }}>
        {t('efficio.report.cacheReuse', { read: compact(totalRead), creation: compact(totalCreation), count: n })}
      </div>
    </div>
  );
}
