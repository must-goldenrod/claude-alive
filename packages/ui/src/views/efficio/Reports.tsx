import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { EfficioSessionProfile, EfficioAxisKey } from '@claude-alive/core';
import { ProjectComparison } from './ProjectComparison.tsx';
import { TrendAlert } from './TrendAlert.tsx';
import { CacheEfficiency } from './CacheEfficiency.tsx';
import { WeeklySummary } from './WeeklySummary.tsx';

interface Props {
  sessions: readonly EfficioSessionProfile[];
  axis: EfficioAxisKey;
  onSelect: (id: string) => void;
}

function Section({ title, desc, children }: { title: string; desc?: string; children: ReactNode }) {
  return (
    <div>
      <div className="text-[12px] font-semibold mb-1" style={{ color: 'var(--text-primary)' }}>{title}</div>
      {desc && <div className="text-[10px] mb-2 leading-relaxed" style={{ color: 'var(--text-secondary)' }}>{desc}</div>}
      {children}
    </div>
  );
}

/** 리포트 묶음 — 프로젝트 비교 / 추세 회귀 / 캐시 효율 / 기간 요약(주간)을 한 탭에. */
export function Reports({ sessions, axis, onSelect }: Props) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col gap-6">
      <Section title={t('efficio.report.trendTitle')} desc={t('efficio.report.trendDesc')}>
        <TrendAlert sessions={sessions} axis={axis} />
      </Section>
      <Section title={t('efficio.report.projectTitle')} desc={t('efficio.report.projectDesc')}>
        <ProjectComparison sessions={sessions} axis={axis} />
      </Section>
      <Section title={t('efficio.report.cacheTitle')} desc={t('efficio.report.cacheDesc')}>
        <CacheEfficiency sessions={sessions} />
      </Section>
      <Section title={t('efficio.report.weeklyTitle')} desc={t('efficio.report.weeklyDesc')}>
        <WeeklySummary sessions={sessions} axis={axis} onSelect={onSelect} />
      </Section>
    </div>
  );
}
