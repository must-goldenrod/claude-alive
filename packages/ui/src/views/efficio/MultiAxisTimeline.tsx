import { useTranslation } from 'react-i18next';
import type { EfficioSessionProfile } from '@claude-alive/core';
import { AXES, wasteColor } from './axes.ts';

interface MultiAxisTimelineProps {
  sessions: readonly EfficioSessionProfile[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}

const ROW_H = 56;
const BAR_GAP = 2;

/**
 * 4축 동시 시계열(small multiples). 각 행이 한 축, 막대=세션의 낭비 백분위.
 * 체감(W2)과 행동(Bash) 행을 세로로 나란히 둬 분기를 한눈에 대조한다.
 */
export function MultiAxisTimeline({ sessions, selectedId, onSelect }: MultiAxisTimelineProps) {
  const { t } = useTranslation();
  if (sessions.length === 0) return null;

  return (
    <div className="flex flex-col gap-3">
      {AXES.map((ax) => (
        <div key={ax.key}>
          <div className="flex items-center justify-between mb-1">
            <span className="text-[11px] font-semibold" style={{ color: 'var(--text-primary)' }}>
              {t(`efficio.axis.${ax.key}`)}
            </span>
            <span className="text-[9px] px-1.5 py-0.5 rounded" style={{ background: 'var(--bg-secondary)', color: 'var(--text-secondary)' }} title={t(`efficio.status.${ax.status}`)}>
              {t(`efficio.cluster.${ax.cluster}`)}
            </span>
          </div>
          <div className="flex items-end" style={{ height: ROW_H, gap: BAR_GAP }}>
            {sessions.map((s) => {
              const sc = s.axes[ax.key];
              const selected = s.sessionId === selectedId;
              return (
                <div
                  key={s.sessionId}
                  onClick={() => onSelect(s.sessionId)}
                  title={`${s.title} · ${Math.round(sc.wastePercentile)}%${sc.isZero ? ` (${t('efficio.view.noSignal')})` : ''}`}
                  className="rounded-sm"
                  style={{
                    flex: '1 1 0',
                    height: Math.max(2, (sc.wastePercentile / 100) * ROW_H),
                    background: wasteColor(sc.wastePercentile),
                    opacity: selectedId ? (selected ? 1 : 0.35) : 0.85,
                    outline: selected ? '1px solid var(--text-primary)' : 'none',
                    cursor: 'pointer',
                    transition: 'opacity 120ms',
                  }}
                />
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
