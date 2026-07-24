import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TicketEvaluation } from '@claude-alive/core';
import type { EvalLabel } from '../ticketmgmt/api.ts';
import { EmptyState } from './panels/EmptyState.tsx';
import { OutcomePanel } from './panels/OutcomePanel.tsx';

type SubTab = 'outcome' | 'quality' | 'efficiency' | 'process';

const SUBTABS = ['outcome', 'quality', 'efficiency', 'process'] as const satisfies readonly SubTab[];

interface TicketDetailTabsProps {
  record: TicketEvaluation | null;
  sessionId: string | null;
  guideRefreshKey: number;
  onLabel: (input: { label: EvalLabel; weight: number; note: string }) => Promise<void>;
  onReflect: (reflected: boolean) => Promise<void>;
  initialSubTab?: SubTab;
}

export function TicketDetailTabs({
  record,
  sessionId,
  guideRefreshKey,
  onLabel,
  onReflect,
  initialSubTab,
}: TicketDetailTabsProps) {
  const { t } = useTranslation();
  const [subTab, setSubTab] = useState<SubTab>(initialSubTab ?? 'outcome');

  if (!record) {
    return <EmptyState message={t('board.empty.pickTicket')} />;
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div
        role="tablist"
        style={{
          display: 'flex',
          gap: 4,
          padding: '8px 16px 0',
          borderBottom: '1px solid var(--border-color)',
        }}
      >
        {SUBTABS.map((tab) => (
          <button
            key={tab}
            role="tab"
            aria-selected={subTab === tab}
            onClick={() => setSubTab(tab)}
            style={{
              padding: '6px 14px',
              fontSize: 12,
              fontWeight: 600,
              color: subTab === tab ? 'var(--text-primary)' : 'var(--text-secondary)',
              background: 'transparent',
              border: 'none',
              borderBottom:
                subTab === tab ? '2px solid var(--accent-blue)' : '2px solid transparent',
              marginBottom: -1,
              cursor: 'pointer',
            }}
          >
            {t(`board.subtab.${tab}`)}
          </button>
        ))}
      </div>
      <div style={{ flex: 1, minHeight: 0, overflow: 'hidden' }}>
        {subTab === 'outcome' && (
          <OutcomePanel
            record={record}
            guideRefreshKey={guideRefreshKey}
            onLabel={onLabel}
            onReflect={onReflect}
          />
        )}
        {subTab === 'quality' && (
          <EmptyState
            message={sessionId ? t('board.empty.noData') : t('board.empty.noSession')}
          />
        )}
        {subTab === 'efficiency' && (
          <EmptyState
            message={sessionId ? t('board.empty.noData') : t('board.empty.noSession')}
          />
        )}
        {subTab === 'process' && (
          <EmptyState
            message={sessionId ? t('board.empty.noData') : t('board.empty.noSession')}
          />
        )}
      </div>
    </div>
  );
}
