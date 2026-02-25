import { useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useWebSocket } from './hooks/useWebSocket';
import { Header } from './components/Header';
import { StatsBar } from './components/StatsBar';
import { NotificationBanner } from './components/NotificationBanner';
import { ProjectGroup } from './components/ProjectGroup';
import { ActivityPulse } from './components/ActivityPulse';
import { EventStream } from './components/EventStream';
import type { AgentInfo } from '@claude-alive/core';

const WS_URL = `ws://${window.location.hostname}:${window.location.port || '3141'}/ws`;
const API_BASE = `${window.location.protocol}//${window.location.hostname}:${window.location.port || '3141'}`;

interface ProjectGroupData {
  cwd: string;
  projectName: string;
  agents: AgentInfo[];
}

function groupByProject(agents: AgentInfo[]): ProjectGroupData[] {
  const groups = new Map<string, AgentInfo[]>();
  for (const agent of agents) {
    const key = agent.cwd;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(agent);
  }

  return Array.from(groups.entries())
    .map(([cwd, groupAgents]) => ({
      cwd,
      projectName: cwd.split('/').filter(Boolean).pop() ?? cwd,
      agents: groupAgents,
    }))
    // Sort: groups with active agents first, then by name
    .sort((a, b) => {
      const aActive = a.agents.some(ag => ag.state === 'active' || ag.state === 'listening');
      const bActive = b.agents.some(ag => ag.state === 'active' || ag.state === 'listening');
      if (aActive !== bActive) return aActive ? -1 : 1;
      return a.projectName.localeCompare(b.projectName);
    });
}

function App() {
  const { t } = useTranslation();
  const { agents, events, connected } = useWebSocket(WS_URL);
  const agentList = Array.from(agents.values());
  const projectGroups = useMemo(() => groupByProject(agentList), [agentList]);

  const handleRename = useCallback((sessionId: string, name: string | null) => {
    fetch(`${API_BASE}/api/agents/${sessionId}/name`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    }).catch(() => {});
  }, []);

  return (
    <div className="min-h-screen" style={{ background: 'var(--bg-primary)' }}>
      <Header connected={connected} agentCount={agentList.length} />

      <main className="p-8 space-y-8 max-w-screen-2xl mx-auto w-full">
        {/* Stats Bar */}
        <StatsBar agents={agentList} events={events} />

        {/* Notification Banner */}
        <NotificationBanner agents={agentList} />

        {/* Project Groups */}
        <section>
          <h2 className="text-base font-medium mb-4" style={{ color: 'var(--text-secondary)' }}>
            {t('agents.projects')}
          </h2>
          {projectGroups.length === 0 ? (
            <div
              className="rounded-lg border p-10 text-center"
              style={{ borderColor: 'var(--border-color)', background: 'var(--bg-card)' }}
            >
              <div className="text-xl mb-3" style={{ color: 'var(--text-secondary)' }}>{t('agents.noAgentsYet')}</div>
              <div className="text-base" style={{ color: 'var(--text-secondary)' }}>
                {t('agents.startSession')}
              </div>
            </div>
          ) : (
            <div className="space-y-5">
              {projectGroups.map(group => (
                <ProjectGroup
                  key={group.cwd}
                  cwd={group.cwd}
                  projectName={group.projectName}
                  agents={group.agents}
                  onRename={handleRename}
                />
              ))}
            </div>
          )}
        </section>

        {/* Activity Pulse */}
        <ActivityPulse events={events} />

        {/* Event Stream */}
        <section>
          <EventStream events={events} agents={agentList} />
        </section>
      </main>
    </div>
  );
}

export default App;
