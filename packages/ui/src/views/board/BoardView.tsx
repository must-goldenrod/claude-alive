import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { RawMessageSubscribe } from '../../App.tsx';
import { DataView } from '../data/DataView.tsx';
import { WorkTab } from './WorkTab.tsx';

type TopTab = 'work' | 'cost';

interface BoardViewProps {
  active: boolean;
  subscribeRaw: RawMessageSubscribe;
  focusSessionId?: string | null;
}

export function BoardView({ active }: BoardViewProps) {
  const { t } = useTranslation();
  const [tab, setTab] = useState<TopTab>('work');

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', width: '100%' }}>
      <div
        role="tablist"
        style={{
          display: 'flex',
          gap: 4,
          padding: '8px 16px 0',
          borderBottom: '1px solid var(--border-color)',
          background: 'var(--bg-primary)',
        }}
      >
        <TopTabButton
          label={t('board.tab.work')}
          active={tab === 'work'}
          onClick={() => setTab('work')}
        />
        <TopTabButton
          label={t('board.tab.cost')}
          active={tab === 'cost'}
          onClick={() => setTab('cost')}
        />
      </div>
      <div style={{ flex: 1, minHeight: 0, overflow: 'hidden' }}>
        <div style={{ display: tab === 'work' ? 'block' : 'none', height: '100%' }}>
          <WorkTab active={active && tab === 'work'} />
        </div>
        <div style={{ display: tab === 'cost' ? 'block' : 'none', height: '100%' }}>
          <DataView active={active && tab === 'cost'} />
        </div>
      </div>
    </div>
  );
}

interface TopTabButtonProps {
  label: string;
  active: boolean;
  onClick: () => void;
}

function TopTabButton({ label, active, onClick }: TopTabButtonProps) {
  return (
    <button
      role="tab"
      aria-selected={active}
      onClick={onClick}
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
