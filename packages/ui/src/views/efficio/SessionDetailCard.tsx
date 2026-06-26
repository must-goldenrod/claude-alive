import { useTranslation } from 'react-i18next';
import type { EfficioSessionProfile } from '@claude-alive/core';
import { AXES, PRIMARY_AXIS, wasteColor, compact } from './axes.ts';

interface SessionDetailCardProps {
  session: EfficioSessionProfile | null;
}

/**
 * 한 세션의 4축 상세 카드(CLI `profile`을 UI로). 축마다 실제 vs 예상(반사실 기준선)을
 * 막대로 대조하고 낭비 백분위를 표시. 선택 세션 없으면 안내 문구.
 */
export function SessionDetailCard({ session }: SessionDetailCardProps) {
  const { t } = useTranslation();

  if (!session) {
    return (
      <div
        className="border rounded-xl px-4 py-8 text-center text-[12px]"
        style={{ background: 'var(--bg-card)', borderColor: 'var(--border-color)', color: 'var(--text-secondary)' }}
      >
        {t('efficio.view.selectSession')}
      </div>
    );
  }

  return (
    <div className="border rounded-xl overflow-hidden" style={{ background: 'var(--bg-card)', borderColor: 'var(--border-color)' }}>
      <div className="px-4 py-3 border-b" style={{ borderColor: 'var(--border-color)', background: 'var(--bg-secondary)' }}>
        <div className="text-[13px] font-semibold truncate" style={{ color: 'var(--text-primary)' }} title={session.title}>
          {session.title}
        </div>
        <div className="text-[10px] mt-0.5 flex gap-3" style={{ color: 'var(--text-secondary)', fontFamily: 'var(--font-mono)' }}>
          <span>{t('efficio.view.turns', { count: session.turns })}</span>
          <span>{t('efficio.view.tokens', { value: compact(session.totalTokens) })}</span>
          <span>{session.sessionId.slice(0, 8)}</span>
        </div>
      </div>

      <div className="px-4 py-3 flex flex-col gap-3">
        {AXES.map((ax) => {
          const sc = session.axes[ax.key];
          const scale = Math.max(sc.actual, sc.baseline, 1);
          const isPrimary = ax.key === PRIMARY_AXIS;
          return (
            <div key={ax.key}>
              <div className="flex items-center justify-between mb-1">
                <span className="text-[11px] font-medium" style={{ color: 'var(--text-primary)' }}>
                  {t(`efficio.axis.${ax.key}`)}
                  {isPrimary && <span className="ml-1 text-[9px]" style={{ color: 'var(--accent-blue)' }}>◀</span>}
                </span>
                <span className="text-[11px] font-semibold" style={{ color: wasteColor(sc.wastePercentile) }}>
                  {sc.isZero ? t('efficio.view.noSignal') : `${Math.round(sc.wastePercentile)}%`}
                </span>
              </div>
              {/* 실제(색) vs 예상(회색) 막대 */}
              <div className="relative h-4 rounded" style={{ background: 'var(--bg-secondary)' }}>
                <div
                  className="absolute inset-y-0 left-0 rounded opacity-40"
                  style={{ width: `${(sc.baseline / scale) * 100}%`, background: 'var(--text-secondary)' }}
                  title={`${t('efficio.view.expected')} ${compact(sc.baseline)}`}
                />
                <div
                  className="absolute inset-y-0 left-0 rounded"
                  style={{ width: `${(sc.actual / scale) * 100}%`, background: wasteColor(sc.wastePercentile), opacity: 0.55 }}
                  title={`${t('efficio.view.actual')} ${compact(sc.actual)}`}
                />
              </div>
              <div className="flex justify-between text-[9px] mt-0.5" style={{ color: 'var(--text-secondary)', fontFamily: 'var(--font-mono)' }}>
                <span>{t('efficio.view.actual')} {compact(sc.actual)}</span>
                <span>{t('efficio.view.expected')} {compact(sc.baseline)}</span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
