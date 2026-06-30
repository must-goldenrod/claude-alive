import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import type { EfficioSessionProfile, EfficioAxisKey } from '@claude-alive/core';
import { trendSlope } from './reportAggregates.ts';

interface Props {
  sessions: readonly EfficioSessionProfile[];
  axis: EfficioAxisKey;
}

// 추세를 "주의" 수준으로 볼 기울기 임계(백분위/세션). 미미한 흔들림을 경고로 키우지 않기 위함.
const ALERT_SLOPE = 1.5;

/** 추세 회귀 알림 — 최근 세션들의 낭비 백분위 선형 추세. 상승(악화) 시 경고색. */
export function TrendAlert({ sessions, axis }: Props) {
  const { t } = useTranslation();
  const trend = useMemo(() => trendSlope(sessions, axis), [sessions, axis]);

  const alerting = trend.rising && trend.slope >= ALERT_SLOPE;
  const label = trend.slope === 0
    ? t('efficio.report.trendFlat')
    : trend.rising
      ? t('efficio.report.trendRising', { slope: trend.slope.toFixed(1) })
      : t('efficio.report.trendFalling', { slope: Math.abs(trend.slope).toFixed(1) });
  const color = alerting ? 'var(--accent-red, #f85149)' : trend.rising ? 'var(--accent-amber, #d29922)' : 'var(--accent-green, #3fb950)';

  return (
    <div className="flex items-center gap-2">
      <span className="text-[16px]" style={{ color }}>
        {trend.slope === 0 ? '→' : trend.rising ? '↗' : '↘'}
      </span>
      <span className="text-[12px] font-medium" style={{ color }}>
        {label}
      </span>
      {alerting && (
        <span className="text-[10px] px-2 py-0.5 rounded-md" style={{ background: 'var(--accent-red, #f85149)', color: '#fff' }}>
          {t('efficio.report.trendAlert')}
        </span>
      )}
    </div>
  );
}
