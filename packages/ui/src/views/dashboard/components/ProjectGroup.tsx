import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { AgentInfo } from '@claude-alive/core';
import { AgentCard } from './AgentCard.tsx';

interface ProjectGroupProps {
  cwd: string;
  projectName: string;
  agents: AgentInfo[];
  onRename?: (sessionId: string, name: string | null) => void;
}

export function ProjectGroup({ cwd, projectName, agents, onRename }: ProjectGroupProps) {
  const { t } = useTranslation();
  const [collapsed, setCollapsed] = useState(false);

  // Separate main agents (no parent) from sub-agents
  const mainAgents = agents.filter(a => !a.parentId);
  const subAgentsByParent = new Map<string, AgentInfo[]>();
  for (const a of agents) {
    if (a.parentId) {
      if (!subAgentsByParent.has(a.parentId)) subAgentsByParent.set(a.parentId, []);
      subAgentsByParent.get(a.parentId)!.push(a);
    }
  }

  // Summary counts
  const activeCount = agents.filter(a => a.state === 'active' || a.state === 'listening').length;
  const totalCount = mainAgents.length;

  return (
    <div
      className="rounded-xl border"
      style={{ borderColor: 'var(--border-color)', background: 'var(--bg-secondary)' }}
    >
      {/* Group header */}
      <button
        className="w-full flex items-center gap-3 px-5 py-3 text-left hover:brightness-110 transition-all"
        style={{ background: 'var(--bg-secondary)' }}
        onClick={() => setCollapsed(!collapsed)}
      >
        <span
          className="text-xs shrink-0 transition-transform duration-200"
          style={{ color: 'var(--text-secondary)', transform: collapsed ? 'rotate(-90deg)' : 'rotate(0)' }}
        >
          {'\u25BC'}
        </span>
        <span className="text-base font-semibold truncate" style={{ color: 'var(--text-primary)' }}>
          {projectName}
        </span>
        <span
          className="text-xs px-2 py-0.5 rounded shrink-0"
          style={{ background: 'var(--bg-card)', color: 'var(--text-secondary)' }}
        >
          {activeCount > 0 ? t('agents.activeSlash', { active: activeCount }) : ''}{t('agents.agentCount', { count: totalCount })}
        </span>
        <span
          className="ml-auto text-xs font-mono truncate max-w-[50%]"
          style={{ color: 'var(--text-secondary)' }}
          title={cwd}
        >
          {cwd}
        </span>
      </button>

      {/* Agent cards */}
      {!collapsed && (
        <div className="p-4 space-y-4" style={{ background: 'var(--bg-primary)' }}>
          {mainAgents.length === 0 ? (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {agents.map(agent => (
                <AgentCard key={agent.sessionId} agent={agent} subAgents={[]} onRename={onRename} />
              ))}
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {mainAgents.map(agent => (
                <AgentCard
                  key={agent.sessionId}
                  agent={agent}
                  subAgents={subAgentsByParent.get(agent.sessionId) ?? []}
                  onRename={onRename}
                />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
