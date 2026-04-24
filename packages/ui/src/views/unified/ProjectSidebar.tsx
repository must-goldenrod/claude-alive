import { useState, useMemo, useRef, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import type { AgentInfo } from '@claude-alive/core';
import { useNow } from '../dashboard/hooks/useNow.ts';
import type { TFunction } from 'i18next';
import { generateSpriteSet } from '../pixel/engine/sprites';
import { getSpriteDataUrl } from '../pixel/utils/spriteToImage';
import type { Character } from '../pixel/engine/character';

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

// ── Sprite Thumbnail ────────────────────────────────────────────────────

function getSpriteThumbnail(character: Character | undefined, sessionId: string): string | null {
  if (character) {
    return getSpriteDataUrl(character.paletteIndex, character.sprites.idle.down);
  }
  // Fallback: derive paletteIndex from sessionId hash
  let hash = 0;
  for (let i = 0; i < sessionId.length; i++) {
    hash = ((hash << 5) - hash + sessionId.charCodeAt(i)) | 0;
  }
  const idx = Math.abs(hash) % 6;
  const sprites = generateSpriteSet(idx);
  return getSpriteDataUrl(idx, sprites.idle.down);
}

// ── Compact Agent Card ──────────────────────────────────────────────────

interface CompactCardProps {
  agent: AgentInfo;
  character?: Character;
  onAgentClick?: (sessionId: string) => void;
}

function CompactAgentCard({ agent, character, onAgentClick }: CompactCardProps) {
  const { t } = useTranslation();
  const now = useNow();
  const timeSince = formatTimeSince(now, agent.lastEventTime, t);
  const stateColor = STATE_COLORS[agent.state] ?? 'var(--text-secondary)';
  const displayLabel = agent.displayName || agent.projectName || t('agents.generalAgent');
  const spriteUrl = useMemo(() => getSpriteThumbnail(character, agent.sessionId), [character?.paletteIndex, agent.sessionId]);
  const [hovered, setHovered] = useState(false);

  return (
    <div
      className="rounded-2xl px-5 py-2 transition-all duration-200 cursor-pointer"
      style={{
        background: hovered ? 'rgba(255,255,255,0.08)' : 'transparent',
      }}
      onClick={() => onAgentClick?.(agent.sessionId)}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <div className="flex items-center gap-4">
        {/* Sprite thumbnail — 44px */}
        <div
          className="shrink-0 relative"
          style={{
            width: 44,
            height: 44,
            borderRadius: 14,
            overflow: 'hidden',
            background: 'rgba(255,255,255,0.04)',
            transition: 'transform 0.2s ease',
            transform: hovered ? 'scale(1.06)' : 'scale(1)',
          }}
        >
          {spriteUrl && (
            <img
              src={spriteUrl}
              alt=""
              style={{
                width: '100%',
                height: '100%',
                imageRendering: 'pixelated',
                objectFit: 'contain',
              }}
            />
          )}
          {/* Status dot */}
          <div
            style={{
              position: 'absolute',
              bottom: 0,
              right: 0,
              width: 12,
              height: 12,
              borderRadius: '50%',
              background: stateColor,
              border: '2px solid var(--bg-secondary)',
              boxShadow: agent.state === 'active' ? `0 0 8px ${stateColor}` : 'none',
            }}
          />
        </div>

        {/* Text content */}
        <div className="flex-1 min-w-0">
          <div
            className="text-sm font-medium truncate"
            style={{ color: 'var(--text-primary)', lineHeight: 1.4 }}
          >
            {displayLabel}
          </div>
          <div className="flex items-center gap-2 mt-1.5">
            <span className="text-xs" style={{ color: stateColor }}>
              {t(`states.${agent.state}`, { defaultValue: agent.state })}
            </span>
            {agent.currentTool && (
              <>
                <span className="text-xs" style={{ color: 'var(--text-secondary)', opacity: 0.4 }}>·</span>
                <span className="text-xs truncate" style={{ color: 'var(--text-secondary)', fontFamily: 'var(--font-mono)' }}>
                  {agent.currentTool}
                </span>
              </>
            )}
          </div>
        </div>

        {/* Time — right aligned */}
        {timeSince && (
          <span className="text-xs shrink-0" style={{ color: 'var(--text-secondary)', opacity: 0.6 }}>
            {timeSince}
          </span>
        )}
      </div>
    </div>
  );
}

// ── Sidebar Project Group ───────────────────────────────────────────────

interface SidebarProjectGroupProps {
  projectName: string;
  cwd: string;
  agents: AgentInfo[];
  characters: Map<string, Character>;
  onAgentClick?: (sessionId: string) => void;
  onProjectNameChange?: (cwd: string, name: string | null) => void;
}

function SidebarProjectGroup({
  projectName,
  cwd,
  agents,
  characters,
  onAgentClick,
  onProjectNameChange,
}: SidebarProjectGroupProps) {
  const { t } = useTranslation();
  const [collapsed, setCollapsed] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(projectName);
  const editInputRef = useRef<HTMLInputElement>(null);
  const activeCount = agents.filter(a => a.state === 'active' || a.state === 'listening').length;

  useEffect(() => {
    if (editing) {
      editInputRef.current?.focus();
      editInputRef.current?.select();
    }
  }, [editing]);

  const commit = () => {
    const trimmed = draft.trim();
    onProjectNameChange?.(cwd, trimmed.length > 0 ? trimmed : null);
    setEditing(false);
  };

  const cancel = () => {
    setDraft(projectName);
    setEditing(false);
  };

  return (
    <div>
      <div
        className="w-full flex items-center gap-3 px-6 py-1 text-left transition-all"
        style={{ background: 'transparent' }}
      >
        <button
          onClick={() => setCollapsed(!collapsed)}
          className="shrink-0"
          style={{ background: 'transparent', border: 'none', padding: 0, cursor: 'pointer' }}
        >
          <span
            className="text-[11px] block transition-transform duration-200"
            style={{ color: 'var(--text-secondary)', opacity: 0.5, transform: collapsed ? 'rotate(-90deg)' : 'rotate(0)' }}
          >
            {'\u25BC'}
          </span>
        </button>
        {editing ? (
          <input
            ref={editInputRef}
            className="text-[15px] font-bold rounded-md px-1.5 py-0.5 outline-none flex-1 min-w-0"
            style={{
              background: 'rgba(255,255,255,0.06)',
              color: 'var(--text-primary)',
              border: '1px solid var(--accent-blue)',
            }}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commit();
              else if (e.key === 'Escape') cancel();
            }}
            placeholder={cwd.split('/').filter(Boolean).pop() ?? cwd}
          />
        ) : (
          <button
            onClick={(e) => { e.stopPropagation(); setDraft(projectName); setEditing(true); }}
            className="text-[15px] font-bold truncate flex-1 text-left"
            style={{ color: 'var(--text-primary)', background: 'transparent', border: 'none', padding: 0, cursor: 'text' }}
            title={t('agents.clickToRenameProject', { defaultValue: 'Click to rename this project' })}
          >
            {projectName}
          </button>
        )}
        <div className="flex items-center gap-2.5 ml-auto shrink-0">
          {activeCount > 0 && (
            <span
              className="text-xs px-2.5 py-0.5 rounded-full font-semibold"
              style={{ background: 'rgba(63,185,80,0.12)', color: 'var(--accent-green)' }}
            >
              {activeCount}
            </span>
          )}
          <span className="text-xs" style={{ color: 'var(--text-secondary)', opacity: 0.4 }}>
            {agents.length}
          </span>
        </div>
      </div>

      {!collapsed && (
        <div className="pb-2">
          {agents.map(agent => (
            <CompactAgentCard
              key={agent.sessionId}
              agent={agent}
              character={characters.get(agent.sessionId)}
              onAgentClick={onAgentClick}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ── SSH Presence Section ─────────────────────────────────────────────────
// Lightweight read-only indicator for active SSH tabs. We can't follow remote Claude activity
// (hooks are local only), so we just show *that* a session exists + its output pulse.

interface SshPresenceEntry {
  tabId: string;
  label: string;
  status: 'idle' | 'active' | 'done';
  exited: boolean;
  hasError: boolean;
}

interface SshPresenceGroupProps {
  sessions: SshPresenceEntry[];
}

function SshPresenceGroup({ sessions }: SshPresenceGroupProps) {
  const { t } = useTranslation();
  const [collapsed, setCollapsed] = useState(false);
  if (sessions.length === 0) return null;
  const activeCount = sessions.filter(s => !s.exited && s.status === 'active').length;

  return (
    <div>
      <button
        className="w-full flex items-center gap-3 px-6 py-3.5 text-left transition-all"
        style={{ background: 'transparent' }}
        onClick={() => setCollapsed(!collapsed)}
      >
        <span
          className="text-[11px] shrink-0 transition-transform duration-200"
          style={{ color: 'var(--text-secondary)', opacity: 0.5, transform: collapsed ? 'rotate(-90deg)' : 'rotate(0)' }}
        >
          {'▼'}
        </span>
        <span className="text-[15px] font-bold truncate" style={{ color: 'var(--accent-purple)' }}>
          {t('agents.sshSessions', { defaultValue: 'SSH Sessions' })}
        </span>
        <div className="flex items-center gap-2.5 ml-auto shrink-0">
          {activeCount > 0 && (
            <span
              className="text-xs px-2.5 py-0.5 rounded-full font-semibold"
              style={{ background: 'rgba(188, 140, 255, 0.14)', color: 'var(--accent-purple)' }}
            >
              {activeCount}
            </span>
          )}
          <span className="text-xs" style={{ color: 'var(--text-secondary)', opacity: 0.4 }}>
            {sessions.length}
          </span>
        </div>
      </button>

      {!collapsed && (
        <div className="pb-2">
          {sessions.map(s => {
            const dotColor = s.hasError
              ? 'var(--accent-red)'
              : s.exited
                ? 'var(--text-secondary)'
                : s.status === 'active'
                  ? 'var(--accent-green)'
                  : 'var(--accent-purple)';
            const isPulsing = !s.exited && s.status === 'active';
            return (
              <div
                key={s.tabId}
                className="rounded-2xl px-5 py-3 transition-all duration-200"
                style={{ background: 'transparent' }}
              >
                <div className="flex items-center gap-3">
                  <div
                    className="shrink-0 flex items-center justify-center"
                    style={{
                      width: 32,
                      height: 32,
                      borderRadius: 10,
                      background: 'rgba(188, 140, 255, 0.10)',
                      border: '1px solid rgba(188, 140, 255, 0.25)',
                      color: 'var(--accent-purple)',
                      fontSize: 14,
                      opacity: s.exited ? 0.5 : 1,
                    }}
                  >
                    {s.hasError ? '⚠' : '⇄'}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div
                      className="text-sm font-medium truncate"
                      style={{ color: 'var(--text-primary)', opacity: s.exited ? 0.6 : 1, lineHeight: 1.4 }}
                    >
                      {s.label}
                    </div>
                    <div className="flex items-center gap-2 mt-1">
                      <span
                        style={{
                          width: 6,
                          height: 6,
                          borderRadius: '50%',
                          background: dotColor,
                          display: 'inline-block',
                          animation: isPulsing ? 'sshPulse 1.4s ease-in-out infinite' : undefined,
                        }}
                      />
                      <span className="text-xs" style={{ color: dotColor }}>
                        {s.hasError
                          ? t('agents.sshError', { defaultValue: 'error' })
                          : s.exited
                            ? t('states.done')
                            : s.status === 'active'
                              ? t('states.active')
                              : t('states.idle')}
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
      <style>{`
        @keyframes sshPulse {
          0%, 100% { opacity: 1; transform: scale(1); }
          50% { opacity: 0.45; transform: scale(0.75); }
        }
      `}</style>
    </div>
  );
}

// ── Main Sidebar ────────────────────────────────────────────────────────

interface ProjectSidebarProps {
  agents: AgentInfo[];
  characters?: Map<string, Character>;
  onAgentClick?: (sessionId: string) => void;
  collapsed?: boolean;
  sshSessions?: SshPresenceEntry[];
  /** cwd → project name overrides. Takes precedence over the default pathBasename label. */
  projectNames?: Record<string, string>;
  /** Persist a custom project name for a given cwd (pass null to clear). */
  onProjectNameChange?: (cwd: string, name: string | null) => void;
}

export function ProjectSidebar({
  agents,
  characters,
  onAgentClick,
  collapsed = false,
  sshSessions,
  projectNames,
  onProjectNameChange,
}: ProjectSidebarProps) {
  const { t } = useTranslation();
  const projectGroups = useMemo(() => groupByProject(agents), [agents]);
  const charMap = characters ?? new Map<string, Character>();
  const ssh = sshSessions ?? [];

  return (
    <div
      className="flex flex-col h-full overflow-hidden shrink-0"
      style={{
        width: collapsed ? 0 : 300,
        minWidth: collapsed ? 0 : 300,
        opacity: collapsed ? 0 : 1,
        background: 'var(--bg-secondary)',
        borderRight: collapsed ? 'none' : '1px solid var(--border-color)',
        transition: 'width 200ms ease, min-width 200ms ease, opacity 150ms ease',
      }}
    >
      {/* Sidebar header */}
      <div
        className="px-6 pt-6 pb-4 text-xs font-bold uppercase tracking-wider shrink-0"
        style={{ color: 'var(--text-secondary)', opacity: 0.5 }}
      >
        {t('agents.projects')}
      </div>

      {/* Project list */}
      <div className="flex-1 overflow-y-auto pt-0 pb-4 space-y-2">
        {/* SSH presence — shown above project groups when any SSH tab is open. */}
        {ssh.length > 0 && <SshPresenceGroup sessions={ssh} />}

        {projectGroups.length === 0 && ssh.length === 0 ? (
          <div className="text-center py-16 px-8">
            <div className="text-sm mb-3" style={{ color: 'var(--text-secondary)' }}>
              {t('agents.noAgentsYet')}
            </div>
            <div className="text-xs leading-relaxed" style={{ color: 'var(--text-secondary)', opacity: 0.5 }}>
              {t('agents.startSession')}
            </div>
          </div>
        ) : (
          projectGroups.map(group => (
            <SidebarProjectGroup
              key={group.cwd}
              projectName={projectNames?.[group.cwd] ?? group.projectName}
              cwd={group.cwd}
              agents={group.agents}
              characters={charMap}
              onAgentClick={onAgentClick}
              onProjectNameChange={onProjectNameChange}
            />
          ))
        )}
      </div>
    </div>
  );
}
