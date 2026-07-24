import { useState, type KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import type { RawMessageSubscribe } from '../../App.tsx';
import { DataView } from '../data/DataView.tsx';
import { WorkTab } from './WorkTab.tsx';

type TopTab = 'work' | 'cost';
const TOP_TABS = ['work', 'cost'] as const satisfies readonly TopTab[];

interface BoardViewProps {
  active: boolean;
  subscribeRaw: RawMessageSubscribe;
  focusSessionId?: string | null;
}

export function BoardView({ active }: BoardViewProps) {
  const { t } = useTranslation();
  const [tab, setTab] = useState<TopTab>('work');

  const selectWithFocus = (nextTab: TopTab) => {
    setTab(nextTab);
    document.getElementById(`board-tab-${nextTab}`)?.focus();
  };

  const handleTabKeyDown = (event: KeyboardEvent<HTMLButtonElement>, currentTab: TopTab) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') {
      return;
    }

    event.preventDefault();
    const currentIndex = TOP_TABS.indexOf(currentTab);
    const offset = event.key === 'ArrowRight' ? 1 : -1;
    const nextIndex = (currentIndex + offset + TOP_TABS.length) % TOP_TABS.length;
    selectWithFocus(TOP_TABS[nextIndex]!);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', width: '100%' }}>
      <div
        role="tablist"
        aria-label={t('viewMode.board')}
        style={{
          display: 'flex',
          gap: 4,
          padding: '8px 16px 0',
          borderBottom: '1px solid var(--border-color)',
          background: 'var(--bg-primary)',
        }}
      >
        <TopTabButton
          id="board-tab-work"
          controls="board-panel-work"
          label={t('board.tab.work')}
          active={tab === 'work'}
          onClick={() => setTab('work')}
          onKeyDown={(event) => handleTabKeyDown(event, 'work')}
        />
        <TopTabButton
          id="board-tab-cost"
          controls="board-panel-cost"
          label={t('board.tab.cost')}
          active={tab === 'cost'}
          onClick={() => setTab('cost')}
          onKeyDown={(event) => handleTabKeyDown(event, 'cost')}
        />
      </div>
      <div style={{ flex: 1, minHeight: 0, overflow: 'hidden' }}>
        <div
          id="board-panel-work"
          role="tabpanel"
          aria-labelledby="board-tab-work"
          tabIndex={0}
          hidden={tab !== 'work'}
          style={{ display: tab === 'work' ? 'block' : 'none', height: '100%' }}
        >
          <WorkTab active={active && tab === 'work'} />
        </div>
        <div
          id="board-panel-cost"
          role="tabpanel"
          aria-labelledby="board-tab-cost"
          tabIndex={0}
          hidden={tab !== 'cost'}
          style={{ display: tab === 'cost' ? 'block' : 'none', height: '100%' }}
        >
          <DataView active={active && tab === 'cost'} />
        </div>
      </div>
    </div>
  );
}

interface TopTabButtonProps {
  id: string;
  controls: string;
  label: string;
  active: boolean;
  onClick: () => void;
  onKeyDown: (event: KeyboardEvent<HTMLButtonElement>) => void;
}

function TopTabButton({
  id,
  controls,
  label,
  active,
  onClick,
  onKeyDown,
}: TopTabButtonProps) {
  return (
    <button
      id={id}
      role="tab"
      aria-selected={active}
      aria-controls={controls}
      tabIndex={active ? 0 : -1}
      onClick={onClick}
      onKeyDown={onKeyDown}
      style={{
        padding: '8px 16px',
        fontSize: 12,
        fontWeight: 600,
        color: active ? 'var(--text-primary)' : 'var(--text-secondary)',
        background: 'transparent',
        border: 'none',
        borderBottom: active ? '2px solid var(--accent-blue)' : '2px solid transparent',
        marginBottom: -1,
        cursor: 'pointer',
      }}
    >
      {label}
    </button>
  );
}
