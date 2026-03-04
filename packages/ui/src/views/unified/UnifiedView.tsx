import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useWebSocket } from '../dashboard/hooks/useWebSocket.ts';
import { ProjectSidebar } from './ProjectSidebar.tsx';
import { RightPanel } from './RightPanel.tsx';
import { NotificationBanner } from '../dashboard/components/NotificationBanner.tsx';

const WS_URL = `ws://${window.location.hostname}:${window.location.port || '3141'}/ws`;
const API_BASE = `${window.location.protocol}//${window.location.hostname}:${window.location.port || '3141'}`;

export function UnifiedView() {
  const { t } = useTranslation();

  const { agents, events, completedSessions, stats } = useWebSocket(WS_URL);
  const agentList = Array.from(agents.values());

  const handleRename = useCallback((sessionId: string, name: string | null) => {
    fetch(`${API_BASE}/api/agents/${sessionId}/name`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    }).catch(() => {});
  }, []);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', width: '100%', overflow: 'hidden' }}>
      {/* Main content */}
      <div style={{ display: 'flex', flex: 1, overflow: 'hidden', minHeight: 0 }}>
        <ProjectSidebar agents={agentList} onRename={handleRename} />

        <div style={{ flex: 1, position: 'relative', minWidth: 0 }}>
          <div
            style={{
              width: '100%',
              height: '100%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: 'var(--text-secondary)',
              fontSize: 13,
            }}
          >
            {agentList.length === 0
              ? t('agents.noAgentsYet')
              : t('header.agentCount', { count: agentList.length })}
          </div>

          <div
            style={{
              position: 'absolute',
              bottom: 16,
              left: 20,
              right: 20,
              zIndex: 10,
              pointerEvents: 'auto',
            }}
          >
            <NotificationBanner agents={agentList} />
          </div>
        </div>

        <RightPanel events={events} agents={agentList} completedSessions={completedSessions} stats={stats} />
      </div>
    </div>
  );
}
