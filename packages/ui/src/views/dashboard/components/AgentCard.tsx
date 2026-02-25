import type { AgentInfo, ToolAnimation } from '@claude-alive/core';
import { useNow } from '../hooks/useNow';

const STATE_CONFIG: Record<string, { color: string; label: string; animation?: string }> = {
  spawning: { color: 'var(--accent-purple)', label: 'spawning', animation: 'pulse 1s infinite' },
  idle: { color: 'var(--text-secondary)', label: 'idle' },
  listening: { color: 'var(--accent-blue)', label: 'listening', animation: 'pulse 1.5s infinite' },
  active: { color: 'var(--accent-green)', label: 'active', animation: 'pulse 0.8s infinite' },
  waiting: { color: 'var(--accent-amber)', label: 'waiting', animation: 'blink 1s infinite' },
  error: { color: 'var(--accent-red)', label: 'error', animation: 'shake 0.3s ease-in-out' },
  done: { color: 'var(--accent-green)', label: 'done' },
  despawning: { color: 'var(--accent-red)', label: 'leaving', animation: 'fadeOut 0.5s forwards' },
  removed: { color: 'var(--text-secondary)', label: 'removed' },
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

function formatTimeSince(now: number, timestamp: number): string {
  if (!timestamp) return '';
  const seconds = Math.floor((now - timestamp) / 1000);
  if (seconds < 1) return 'just now';
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  return `${Math.floor(minutes / 60)}h ago`;
}

interface AgentCardProps {
  agent: AgentInfo;
}

const IDLE_CONFIG = STATE_CONFIG.idle;

export function AgentCard({ agent }: AgentCardProps) {
  const config = STATE_CONFIG[agent.state] ?? IDLE_CONFIG;
  const shortId = agent.sessionId.slice(0, 8);
  const now = useNow();
  const timeSince = formatTimeSince(now, agent.lastEventTime);
  const animation = agent.currentToolAnimation;

  return (
    <div
      className="rounded-lg p-4 border transition-all duration-300 relative overflow-hidden"
      style={{
        background: 'var(--bg-card)',
        borderColor: agent.state === 'active' ? config.color : 'var(--border-color)',
        animation: agent.state === 'active' ? 'glow 2s ease-in-out infinite' : undefined,
      }}
    >
      {/* Avatar + Info */}
      <div className="flex items-center gap-3 mb-3">
        <div
          className="w-10 h-10 rounded-lg flex items-center justify-center text-lg font-bold"
          style={{
            background: `${config.color}20`,
            color: config.color,
            animation: config.animation,
          }}
        >
          {agent.parentId ? 'S' : 'A'}
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
            {agent.parentId ? 'Sub-agent' : 'Agent'} {shortId}
          </div>
          <div className="text-xs truncate" style={{ color: 'var(--text-secondary)' }}>
            {agent.cwd.split('/').pop() || agent.cwd}
          </div>
        </div>
        {timeSince && (
          <div className="text-[10px] shrink-0" style={{ color: 'var(--text-secondary)' }}>
            {timeSince}
          </div>
        )}
      </div>

      {/* Status + Tool */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div
            className="w-2 h-2 rounded-full"
            style={{ background: config.color, animation: config.animation }}
          />
          <span className="text-xs font-medium" style={{ color: config.color }}>
            {config.label}
          </span>
        </div>
        <div className="flex items-center gap-2">
          {animation && (
            <span className="text-xs" title={animation}>
              {TOOL_ANIMATION_ICONS[animation]}
            </span>
          )}
          {agent.currentTool && (
            <span
              className="text-xs px-2 py-0.5 rounded"
              style={{ background: `${config.color}15`, color: config.color }}
            >
              {agent.currentTool}
            </span>
          )}
        </div>
      </div>

      {/* Activity indicator bar at bottom */}
      <div
        className="absolute bottom-0 left-0 right-0 h-0.5"
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
