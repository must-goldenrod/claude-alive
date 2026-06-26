import { useTranslation } from 'react-i18next';
import type { EfficioAxisKey, EfficioSessionProfile } from '@claude-alive/core';
import { wasteColor } from './axes.ts';

interface DistributionHistogramProps {
  sessions: readonly EfficioSessionProfile[];
  axis: EfficioAxisKey;
  selectedId: string | null;
}

const BINS = 10; // 0-10%, 10-20% ... 90-100%
const MAX_H = 160;

/**
 * 선택 축의 낭비 백분위 분포(히스토그램). 10% 단위 빈에 세션을 담아,
 * 특정(선택) 세션이 내 코퍼스 전체에서 어디에 위치하는지 보여준다.
 */
export function DistributionHistogram({ sessions, axis, selectedId }: DistributionHistogramProps) {
  const { t } = useTranslation();
  if (sessions.length === 0) return null;

  const counts = new Array(BINS).fill(0) as number[];
  let selectedBin = -1;
  for (const s of sessions) {
    const pct = s.axes[axis].wastePercentile;
    const bin = Math.min(BINS - 1, Math.floor(pct / (100 / BINS)));
    counts[bin] += 1;
    if (s.sessionId === selectedId) selectedBin = bin;
  }
  const maxCount = Math.max(1, ...counts);

  return (
    <div>
      <div className="text-[11px] mb-2" style={{ color: 'var(--text-secondary)' }}>
        {t('efficio.view.distHint')}
      </div>
      <div className="flex items-end gap-1" style={{ height: MAX_H + 24 }}>
        {counts.map((c, i) => {
          const mid = i * 10 + 5;
          const isSel = i === selectedBin;
          return (
            <div key={i} className="flex flex-col items-center justify-end" style={{ flex: '1 1 0' }}>
              <span className="text-[9px] mb-0.5" style={{ color: 'var(--text-secondary)' }}>
                {c || ''}
              </span>
              <div
                className="w-full rounded-t-sm"
                style={{
                  height: Math.max(2, (c / maxCount) * MAX_H),
                  background: wasteColor(mid),
                  opacity: selectedBin >= 0 ? (isSel ? 1 : 0.4) : 0.8,
                  outline: isSel ? '2px solid var(--text-primary)' : 'none',
                  transition: 'opacity 120ms',
                }}
                title={`${i * 10}–${i * 10 + 10}% · ${c}`}
              />
              <span className="text-[8px] mt-1" style={{ color: 'var(--text-secondary)', fontFamily: 'var(--font-mono)' }}>
                {i * 10}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
