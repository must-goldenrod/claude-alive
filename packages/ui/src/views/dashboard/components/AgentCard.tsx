import { useState, useRef, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import type { AgentInfo, ToolAnimation } from '@claude-alive/core';
import { useNow } from '../hooks/useNow.ts';

const STATE_CONFIG: Record<string, { color: string; labelKey: string; animation?: string }> = {
  spawning: { color: 'var(--accent-purple)', labelKey: 'states.spawning', animation: 'pulse 1s infinite' },
  idle: { color: 'var(--text-secondary)', labelKey: 'states.idle' },
  listening: { color: 'var(--accent-blue)', labelKey: 'states.listening', animation: 'pulse 1.5s infinite' },
  active: { color: 'var(--accent-green)', labelKey: 'states.active', animation: 'pulse 0.8s infinite' },
  waiting: { color: 'var(--accent-amber)', labelKey: 'states.waiting', animation: 'blink 1s infinite' },
  error: { color: 'var(--accent-red)', labelKey: 'states.error', animation: 'shake 0.3s ease-in-out' },
  done: { color: 'var(--accent-green)', labelKey: 'states.done' },
  despawning: { color: 'var(--accent-red)', labelKey: 'states.leaving', animation: 'fadeOut 0.5s forwards' },
  removed: { color: 'var(--text-secondary)', labelKey: 'states.removed' },
};

const TOOL_ANIMATION_ICONS: Record<ToolAnimation, string> = {
  typing: '\u2328',
  reading: '\uD83D\uDCD6',
  running: '\u26A1',
  searching: '\uD83D\uDD0D',
  thinking: '\uD83D\uDCAD',
};

const TOOL_ANIMATION_COLORS: Record<ToolAnimation, string> = {
  typing: 'var(--accent-blue)',
  reading: 'var(--accent-purple)',
  running: 'var(--accent-green)',
  searching: 'var(--accent-amber)',
  thinking: 'var(--text-secondary)',
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

function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

interface AgentCardProps {
  agent: AgentInfo;
  subAgents?: AgentInfo[];
  onRename?: (sessionId: string, name: string | null) => void;
}

const IDLE_CONFIG = STATE_CONFIG.idle;

export function AgentCard({ agent, subAgents = [], onRename }: AgentCardProps) {
  const { t } = useTranslation();
  const config = STATE_CONFIG[agent.state] ?? IDLE_CONFIG;
  const shortId = agent.sessionId.slice(0, 8);
  const now = useNow();
  const timeSince = formatTimeSince(now, agent.lastEventTime, t);
  const animation = agent.currentToolAnimation;
  const [editing, setEditing] = useState(false);
  const [nameInput, setNameInput] = useState(agent.displayName ?? '');
  const [showInactiveSubs, setShowInactiveSubs] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing) inputRef.current?.focus();
  }, [editing]);

  const handleRename = () => {
    const trimmed = nameInput.trim();
    onRename?.(agent.sessionId, trimmed || null);
    setEditing(false);
  };

  const displayLabel = agent.displayName || agent.projectName || shortId;

  return (
    <div
      className="rounded-lg p-5 border transition-all duration-300 relative overflow-hidden"
      style={{
        background: 'var(--bg-card)',
        borderColor: agent.state === 'active' ? config.color : 'var(--border-color)',
        animation: agent.state === 'active' ? 'glow 2s ease-in-out infinite' : undefined,
      }}
    >
      {/* Header: Avatar + Name + Time */}
      <div className="flex items-center gap-3 mb-3">
        <div
          className="w-11 h-11 rounded-lg flex items-center justify-center text-lg font-bold shrink-0"
          style={{
            background: `${config.color}20`,
            color: config.color,
            animation: config.animation,
          }}
        >
          {agent.parentId ? 'S' : 'A'}
        </div>
        <div className="flex-1 min-w-0">
          {editing ? (
            <input
              ref={inputRef}
              className="text-base font-medium w-full rounded px-2 py-1 outline-none"
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
              placeholder={agent.projectName || shortId}
            />
          ) : (
            <div
              className="text-base font-medium cursor-pointer hover:underline truncate"
              style={{ color: 'var(--text-primary)' }}
              onClick={() => { setNameInput(agent.displayName ?? ''); setEditing(true); }}
              title={t('agents.clickToRename')}
            >
              {displayLabel}
            </div>
          )}
          <div className="text-xs truncate" style={{ color: 'var(--text-secondary)' }}>
            {agent.parentId ? t('agents.subAgent') : t('agents.agent')} · {shortId}
          </div>
        </div>
        {timeSince && (
          <div className="text-xs shrink-0" style={{ color: 'var(--text-secondary)' }}>
            {timeSince}
          </div>
        )}
      </div>

      {/* Project/folder path */}
      <div
        className="text-xs mb-3 px-2.5 py-1.5 rounded truncate font-mono"
        style={{ background: 'var(--bg-secondary)', color: 'var(--text-secondary)' }}
        title={agent.cwd}
      >
        {agent.cwd}
      </div>

      {/* Meta row: started at, events count, tools used */}
      <div className="flex items-center gap-4 mb-3 text-xs" style={{ color: 'var(--text-secondary)' }}>
        <span title={t('agents.startedAt')}>
          {'\u23F0'} {formatTime(agent.createdAt)}
        </span>
        <span title={t('agents.totalEvents')}>
          {'\u26A1'} {agent.totalEvents ?? 0} {t('agents.events')}
        </span>
        {agent.toolsUsed && agent.toolsUsed.length > 0 && (
          <span title={`Tools: ${agent.toolsUsed.join(', ')}`}>
            {'\uD83D\uDEE0'} {agent.toolsUsed.length} {t('agents.tools')}
          </span>
        )}
      </div>

      {/* Last prompt preview */}
      {agent.lastPrompt && (
        <div
          className="text-xs mb-3 truncate italic"
          style={{ color: 'var(--text-secondary)' }}
          title={agent.lastPrompt}
        >
          "{agent.lastPrompt}"
        </div>
      )}

      {/* Status + Tool */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div
            className="w-2.5 h-2.5 rounded-full"
            style={{ background: config.color, animation: config.animation }}
          />
          <span className="text-sm font-medium" style={{ color: config.color }}>
            {t(config.labelKey)}
          </span>
        </div>
        <div className="flex items-center gap-2">
          {animation && (
            <span className="text-sm" title={animation}>
              {TOOL_ANIMATION_ICONS[animation]}
            </span>
          )}
          {agent.currentTool && (
            <span
              className="text-xs px-2 py-1 rounded"
              style={{ background: `${config.color}15`, color: config.color }}
            >
              {agent.currentTool}
            </span>
          )}
        </div>
      </div>

      {/* Sub-agents */}
      {subAgents.length > 0 && (() => {
        const activeSubs = subAgents.filter(s => s.state !== 'despawning' && s.state !== 'removed');
        const inactiveSubs = subAgents.filter(s => s.state === 'despawning' || s.state === 'removed');
        const visibleSubs = showInactiveSubs ? subAgents : activeSubs;

        return (
          <div
            className="mt-3 pt-3 border-t space-y-1.5"
            style={{ borderColor: 'var(--border-color)' }}
          >
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>
                {t('agents.subAgents')} ({activeSubs.length} active{inactiveSubs.length > 0 ? ` / ${subAgents.length} total` : ''})
              </span>
              {inactiveSubs.length > 0 && (
                <button
                  className="text-xs px-1.5 py-0.5 rounded hover:brightness-125"
                  style={{ color: 'var(--text-secondary)', background: 'var(--bg-secondary)' }}
                  onClick={() => setShowInactiveSubs(!showInactiveSubs)}
                >
                  {showInactiveSubs ? t('agents.hideInactive') : t('agents.inactiveCount', { count: inactiveSubs.length })}
                </button>
              )}
            </div>
            {visibleSubs.map(sub => {
              const subConfig = STATE_CONFIG[sub.state] ?? IDLE_CONFIG;
              return (
                <div
                  key={sub.sessionId}
                  className="flex items-center gap-2 px-2 py-1 rounded text-xs"
                  style={{ background: 'var(--bg-secondary)' }}
                >
                  <div
                    className="w-2 h-2 rounded-full shrink-0"
                    style={{ background: subConfig.color }}
                  />
                  <span className="font-mono truncate" style={{ color: 'var(--text-secondary)' }}>
                    {sub.sessionId.slice(0, 8)}
                  </span>
                  <span className="font-medium" style={{ color: subConfig.color }}>
                    {t(subConfig.labelKey)}
                  </span>
                  {sub.currentTool && (
                    <span
                      className="ml-auto shrink-0 px-1.5 py-0.5 rounded"
                      style={{ background: `${subConfig.color}15`, color: subConfig.color }}
                    >
                      {sub.currentTool}
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        );
      })()}

      {/* Activity indicator bar at bottom */}
      <div
        className="absolute bottom-0 left-0 right-0 h-1"
        style={{
          background: animation
            ? TOOL_ANIMATION_COLORS[animation]
            : agent.state === 'active'
              ? config.color
              : 'transparent',
          opacity: animation ? 0.8 : 0.4,
          transition: 'background 0.3s, opacity 0.3s',
        }}
      />
    </div>
  );
}
