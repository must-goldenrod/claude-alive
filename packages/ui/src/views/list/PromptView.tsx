import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { PromptDashboardView } from './PromptDashboardView';
import { PromptListView } from './PromptListView';

/**
 * Prompt tab shell — hosts two sub-tabs:
 *   • dashboard (default): aggregate metrics, score trend, tier mix,
 *     top improvement areas, and a card grid of recent prompts.
 *   • prompts: the full list → detail experience with per-prompt
 *     improvement suggestions surfaced from rule hits.
 *
 * Cards on the dashboard deep-link into the prompts sub-tab with the
 * clicked row preselected (via the `pendingSelectId` lifted state).
 *
 * Reachability is owned here so each sub-view can stay focused on its
 * own data without re-implementing the unreachable / loading states.
 */

type SubTab = 'dashboard' | 'prompts';

interface PromptViewProps {
  active: boolean;
}

export function PromptView({ active }: PromptViewProps) {
  const { t } = useTranslation();
  const [subTab, setSubTab] = useState<SubTab>('dashboard');
  const [reachable, setReachable] = useState<boolean | null>(null);
  const [pendingSelectId, setPendingSelectId] = useState<string | null>(null);

  // Probe /api/prompts/stats once per visit — cheap and proves the
  // prompt subsystem is mounted on the unified server. If it fails we
  // short-circuit to the unreachable state without each sub-view
  // duplicating the check.
  const probe = useCallback(async () => {
    try {
      const res = await fetch('/api/prompts/stats');
      setReachable(res.ok);
    } catch {
      setReachable(false);
    }
  }, []);

  useEffect(() => {
    if (!active) return;
    probe();
  }, [active, probe]);

  const handleSelectFromCard = useCallback((id: string) => {
    setPendingSelectId(id);
    setSubTab('prompts');
  }, []);

  if (reachable === false) {
    return (
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          height: '100%',
          flexDirection: 'column',
          gap: 16,
          color: 'var(--text-secondary)',
          padding: 40,
          textAlign: 'center',
        }}
      >
        <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--text-primary)' }}>
          {t('prompt.unreachable.title')}
        </div>
        <div style={{ fontSize: 13, maxWidth: 480, lineHeight: 1.5 }}>
          {t('prompt.unreachable.body')}
        </div>
      </div>
    );
  }

  if (reachable === null) {
    return (
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          height: '100%',
          color: 'var(--text-secondary)',
          fontSize: 13,
        }}
      >
        {t('prompt.loading')}
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', width: '100%' }}>
      {/* Sub-tab bar */}
      <div
        style={{
          display: 'flex',
          gap: 4,
          padding: '8px 16px 0',
          borderBottom: '1px solid var(--border-color)',
          background: 'var(--bg-primary)',
        }}
      >
        <SubTabButton
          label={t('prompt.subtab.dashboard', { defaultValue: '대시보드' })}
          active={subTab === 'dashboard'}
          onClick={() => setSubTab('dashboard')}
        />
        <SubTabButton
          label={t('prompt.subtab.prompts', { defaultValue: '프롬프트' })}
          active={subTab === 'prompts'}
          onClick={() => setSubTab('prompts')}
        />
      </div>

      {/* Sub-tab content — both mounted, visibility toggled, so polling
          state persists when switching tabs back and forth. */}
      <div style={{ flex: 1, minHeight: 0, overflow: 'hidden' }}>
        <div
          style={{
            display: subTab === 'dashboard' ? 'block' : 'none',
            height: '100%',
          }}
        >
          <PromptDashboardView
            active={active && subTab === 'dashboard'}
            onSelectPrompt={handleSelectFromCard}
          />
        </div>
        <div
          style={{
            display: subTab === 'prompts' ? 'block' : 'none',
            height: '100%',
          }}
        >
          <PromptListView
            active={active && subTab === 'prompts'}
            requestedSelectId={pendingSelectId}
            onSelectConsumed={() => setPendingSelectId(null)}
          />
        </div>
      </div>
    </div>
  );
}

function SubTabButton({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      style={{
        padding: '8px 16px',
        fontSize: 12,
        fontWeight: 600,
        color: active ? 'var(--text-primary)' : 'var(--text-secondary)',
        background: 'transparent',
        border: 'none',
        borderBottom: active
          ? '2px solid var(--accent-blue)'
          : '2px solid transparent',
        marginBottom: -1,
        cursor: 'pointer',
        transition: 'color 0.15s ease',
      }}
    >
      {label}
    </button>
  );
}
