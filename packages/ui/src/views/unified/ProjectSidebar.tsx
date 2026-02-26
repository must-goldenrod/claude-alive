import { useState, useMemo, useRef, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import type { AgentInfo } from '@claude-alive/core';
import { useNow } from '../dashboard/hooks/useNow.ts';
import type { TFunction } from 'i18next';

const STATE_COLORS: Record<string, string> = {
  spawning: 'var(--accent-purple)',
  idle: 'var(--text-secondary)',
  listening: 'var(--accent-blue)',
  active: 'var(--accent-green)',
  waiting: 'var(--accent-amber)',
  error: 'var(--accent-red)',
  done: 'var(--accent-green)',
  despawning: 'var(--accent-red)',
  removed: 'var(--text-secondary)',
};

function formatTimeSince(now: number, timestamp: number, t: TFunction): string {
  if (!timestamp) return '';
  const seconds = Math.floor((now - timestamp) / 1000);
  if (seconds < 1) return t('time.justNow');
  if (seconds < 60) return t('time.secondsAgo', { count: seconds });
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return t('time.minutesAgo', { count: minutes });
  return t('time.hoursAgo', { count: Math.floor(minutes / 60) });
}

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
    .sort((a, b) => {
      const aActive = a.agents.some(ag => ag.state === 'active' || ag.state === 'listening');
      const bActive = b.agents.some(ag => ag.state === 'active' || ag.state === 'listening');
      if (aActive !== bActive) return aActive ? -1 : 1;
      return a.projectName.localeCompare(b.projectName);
    });
}

// ── Compact Agent Card ──────────────────────────────────────────────────

interface CompactCardProps {
  agent: AgentInfo;
  onRename?: (sessionId: string, name: string | null) => void;
}

function CompactAgentCard({ agent, onRename }: CompactCardProps) {
  const { t } = useTranslation();
  const now = useNow();
  const timeSince = formatTimeSince(now, agent.lastEventTime, t);
  const stateColor = STATE_COLORS[agent.state] ?? 'var(--text-secondary)';
  const displayLabel = agent.displayName || agent.projectName || agent.sessionId.slice(0, 8);

  const [editing, setEditing] = useState(false);
  const [nameInput, setNameInput] = useState(agent.displayName ?? '');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing) inputRef.current?.focus();
  }, [editing]);

  const handleRename = () => {
    const trimmed = nameInput.trim();
    onRename?.(agent.sessionId, trimmed || null);
    setEditing(false);
  };

  return (
    <div
      className="rounded-lg p-4 border transition-all duration-200 relative overflow-hidden"
      style={{
        background: 'var(--bg-card)',
        borderColor: agent.state === 'active' ? stateColor : 'var(--border-color)',
      }}
    >
      <div className="flex items-center gap-3">
        <div
          className="w-2.5 h-2.5 rounded-full shrink-0"
          style={{
            background: stateColor,
            boxShadow: agent.state === 'active' ? `0 0 6px ${stateColor}` : 'none',
          }}
        />
        <div className="flex-1 min-w-0">
          {editing ? (
            <input
              ref={inputRef}
              className="text-xs font-medium w-full rounded px-1.5 py-0.5 outline-none"
              style={{
                background: 'var(--bg-secondary)',
                color: 'var(--text-primary)',
                border: '1px solid var(--accent-blue)',
              }}
              value={nameInput}
              onChange={(e) => setNameInput(e.target.value)}
              onBlur={handleRename}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleRename();
                if (e.key === 'Escape') { setEditing(false); setNameInput(agent.displayName ?? ''); }
              }}
              placeholder={agent.projectName || agent.sessionId.slice(0, 8)}
            />
          ) : (
            <div
              className="text-xs font-medium truncate cursor-pointer hover:underline"
              style={{ color: 'var(--text-primary)' }}
              onClick={() => { setNameInput(agent.displayName ?? ''); setEditing(true); }}
              title={t('agents.clickToRename')}
            >
              {displayLabel}
            </div>
          )}
        </div>
        {timeSince && (
          <span className="text-[11px] shrink-0" style={{ color: 'var(--text-secondary)' }}>
            {timeSince}
          </span>
        )}
      </div>

      {/* Tool + State row */}
      <div className="flex items-center justify-between mt-3">
        <span className="text-[11px] font-medium" style={{ color: stateColor }}>
          {t(`states.${agent.state}`, { defaultValue: agent.state })}
        </span>
        {agent.currentTool && (
          <span
            className="text-[11px] px-2 py-0.5 rounded truncate max-w-[140px]"
            style={{ background: `${stateColor}15`, color: stateColor }}
          >
            {agent.currentTool}
          </span>
        )}
      </div>

      {/* Activity bar */}
      <div
        className="absolute bottom-0 left-0 right-0 h-0.5"
        style={{
          background: agent.state === 'active' ? stateColor : 'transparent',
          opacity: 0.6,
          transition: 'background 0.3s',
        }}
      />
    </div>
  );
}

// ── Sidebar Project Group ───────────────────────────────────────────────

interface SidebarProjectGroupProps {
  projectName: string;
  cwd: string;
  agents: AgentInfo[];
  onRename?: (sessionId: string, name: string | null) => void;
}

function SidebarProjectGroup({ projectName, agents, onRename }: SidebarProjectGroupProps) {
  const [collapsed, setCollapsed] = useState(false);
  const activeCount = agents.filter(a => a.state === 'active' || a.state === 'listening').length;

  return (
    <div>
      <button
        className="w-full flex items-center gap-2.5 px-4 py-3 text-left hover:brightness-110 transition-all rounded-md"
        style={{ background: 'transparent' }}
        onClick={() => setCollapsed(!collapsed)}
      >
        <span
          className="text-[11px] shrink-0 transition-transform duration-200"
          style={{ color: 'var(--text-secondary)', transform: collapsed ? 'rotate(-90deg)' : 'rotate(0)' }}
        >
          {'\u25BC'}
        </span>
        <span className="text-sm font-semibold truncate" style={{ color: 'var(--text-primary)' }}>
          {projectName}
        </span>
        {activeCount > 0 && (
          <span
            className="text-[11px] px-2 py-0.5 rounded shrink-0"
            style={{ background: 'var(--accent-green)20', color: 'var(--accent-green)' }}
          >
            {activeCount}
          </span>
        )}
        <span className="text-[11px] shrink-0 ml-auto" style={{ color: 'var(--text-secondary)' }}>
          {agents.length}
        </span>
      </button>

      {!collapsed && (
        <div className="pl-4 pr-2 pb-3 space-y-2.5">
          {agents.map(agent => (
            <CompactAgentCard key={agent.sessionId} agent={agent} onRename={onRename} />
          ))}
        </div>
      )}
    </div>
  );
}

// ── Main Sidebar ────────────────────────────────────────────────────────

interface ProjectSidebarProps {
  agents: AgentInfo[];
  onRename?: (sessionId: string, name: string | null) => void;
}

export function ProjectSidebar({ agents, onRename }: ProjectSidebarProps) {
  const { t } = useTranslation();
  const projectGroups = useMemo(() => groupByProject(agents), [agents]);

  return (
    <div
      className="flex flex-col h-full overflow-hidden"
      style={{
        width: 280,
        minWidth: 280,
        background: 'var(--bg-secondary)',
        borderRight: '1px solid var(--border-color)',
      }}
    >
      {/* Sidebar header */}
      <div
        className="px-5 py-4 text-xs font-medium shrink-0 border-b"
        style={{ color: 'var(--text-secondary)', borderColor: 'var(--border-color)' }}
      >
        {t('agents.projects')}
      </div>

      {/* Project list */}
      <div className="flex-1 overflow-y-auto p-3 space-y-2">
        {projectGroups.length === 0 ? (
          <div className="text-center py-10 px-5">
            <div className="text-sm mb-3" style={{ color: 'var(--text-secondary)' }}>
              {t('agents.noAgentsYet')}
            </div>
            <div className="text-xs leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
              {t('agents.startSession')}
            </div>
          </div>
        ) : (
          projectGroups.map(group => (
            <SidebarProjectGroup
              key={group.cwd}
              projectName={group.projectName}
              cwd={group.cwd}
              agents={group.agents}
              onRename={onRename}
            />
          ))
        )}
      </div>
    </div>
  );
}
