import { useState, type KeyboardEvent } from 'react';
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

  const selectWithFocus = (nextTab: SubTab) => {
    setSubTab(nextTab);
    document.getElementById(`ticket-detail-tab-${nextTab}`)?.focus();
  };

  const handleTabKeyDown = (event: KeyboardEvent<HTMLButtonElement>, currentTab: SubTab) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') {
      return;
    }

    event.preventDefault();
    const currentIndex = SUBTABS.indexOf(currentTab);
    const offset = event.key === 'ArrowRight' ? 1 : -1;
    const nextIndex = (currentIndex + offset + SUBTABS.length) % SUBTABS.length;
    selectWithFocus(SUBTABS[nextIndex]!);
  };

  if (!record) {
    return <EmptyState message={t('board.empty.pickTicket')} />;
  }

  const renderPanelContent = (panel: SubTab) => {
    if (panel !== subTab) {
      return null;
    }

    if (panel === 'outcome') {
      return (
        <OutcomePanel
          key={record.ticketId}
          record={record}
          guideRefreshKey={guideRefreshKey}
          onLabel={onLabel}
          onReflect={onReflect}
        />
      );
    }

    return (
      <EmptyState
        message={sessionId ? t('board.empty.noData') : t('board.empty.noSession')}
      />
    );
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div
        role="tablist"
        aria-label={t('board.tab.work')}
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
            id={`ticket-detail-tab-${tab}`}
            role="tab"
            aria-selected={subTab === tab}
            aria-controls={`ticket-detail-panel-${tab}`}
            tabIndex={subTab === tab ? 0 : -1}
            onClick={() => setSubTab(tab)}
            onKeyDown={(event) => handleTabKeyDown(event, tab)}
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
      {SUBTABS.map((panel) => (
        <div
          key={panel}
          id={`ticket-detail-panel-${panel}`}
          role="tabpanel"
          aria-labelledby={`ticket-detail-tab-${panel}`}
          tabIndex={0}
          hidden={subTab !== panel}
          style={{
            display: subTab === panel ? 'block' : 'none',
            flex: 1,
            minHeight: 0,
            overflow: 'hidden',
          }}
        >
          {renderPanelContent(panel)}
        </div>
      ))}
    </div>
  );
}
