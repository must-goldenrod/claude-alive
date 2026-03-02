import { useMemo } from 'react';
import type { AgentInfo, AgentState } from '@claude-alive/core';
import type { Character } from '../engine/character';
import { getSpriteDataUrl } from '../utils/spriteToImage';

interface AgentNodeProps {
  agent: AgentInfo;
  character: Character | undefined;
  onClick: (sessionId: string) => void;
}

const STATE_BORDERS: Record<string, string> = {
  active: 'var(--accent-blue)',
  idle: 'var(--border-color)',
  listening: 'var(--border-color)',
  spawning: 'var(--border-color)',
  waiting: 'var(--accent-amber)',
  error: 'var(--accent-red)',
  done: 'var(--accent-green)',
  despawning: 'var(--border-color)',
  removed: 'var(--border-color)',
};

const STATE_LABELS: Record<string, string> = {
  active: 'working',
  idle: 'idle',
  listening: 'listening',
  spawning: 'spawning',
  waiting: 'waiting...',
  error: 'error!',
  done: 'done',
  despawning: 'leaving',
  removed: 'gone',
};

function stateLabel(state: AgentState, tool: string | null): string {
  if (state === 'active' && tool) return tool;
  return STATE_LABELS[state] ?? state;
}

export function AgentNode({ agent, character, onClick }: AgentNodeProps) {
  const borderColor = STATE_BORDERS[agent.state] ?? '#333348';
  const name = agent.displayName || 'General Agent';
  const label = stateLabel(agent.state, agent.currentTool);

  const spriteUrl = useMemo(() => {
    if (!character) return null;
    return getSpriteDataUrl(character.paletteIndex, character.sprites.idle.down);
  }, [character?.paletteIndex]);

  return (
    <div
      onClick={() => onClick(agent.sessionId)}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        padding: '10px 14px',
        background: 'rgba(22, 27, 34, 0.9)',
        border: `2px solid ${borderColor}`,
        borderRadius: 12,
        cursor: 'pointer',
        minWidth: 140,
        transition: 'all 0.2s ease',
      }}
      onMouseEnter={e => { e.currentTarget.style.background = 'rgba(33, 38, 45, 0.95)'; e.currentTarget.style.transform = 'translateY(-1px)'; }}
      onMouseLeave={e => { e.currentTarget.style.background = 'rgba(22, 27, 34, 0.9)'; e.currentTarget.style.transform = 'translateY(0)'; }}
    >
      {spriteUrl && (
        <img
          src={spriteUrl}
          alt=""
          style={{ width: 18, height: 36, imageRendering: 'pixelated' }}
        />
      )}
      <div style={{ minWidth: 0 }}>
        <div style={{
          fontSize: 13,
          fontWeight: 600,
          color: 'var(--text-primary)',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          maxWidth: 100,
        }}>
          {name}
        </div>
        <div style={{
          fontSize: 11,
          color: borderColor,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          maxWidth: 100,
          marginTop: 2,
        }}>
          {label}
        </div>
      </div>
    </div>
  );
}
