import { useCallback, useEffect, useState } from 'react';
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

  const [projectNames, setProjectNames] = useState<Record<string, string>>({});
  useEffect(() => {
    fetch(`${API_BASE}/api/projects/names`)
      .then((r) => r.json())
      .then((data: { names?: Record<string, string> }) => {
        if (data.names) setProjectNames(data.names);
      })
      .catch(() => {});
  }, []);

  const handleProjectNameChange = useCallback((cwd: string, name: string | null) => {
    fetch(`${API_BASE}/api/projects/names`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cwd, name }),
    })
      .then((r) => r.json())
      .then((data: { names?: Record<string, string> }) => {
        if (data.names) setProjectNames(data.names);
      })
      .catch(() => {});
  }, []);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', width: '100%', overflow: 'hidden' }}>
      {/* Main content */}
      <div style={{ display: 'flex', flex: 1, overflow: 'hidden', minHeight: 0 }}>
        <ProjectSidebar
          agents={agentList}
          projectNames={projectNames}
          onProjectNameChange={handleProjectNameChange}
        />

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
