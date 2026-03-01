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
  active: '#4A90D9',
  idle: '#333348',
  listening: '#333348',
  spawning: '#333348',
  waiting: '#F39C12',
  error: '#E74C3C',
  done: '#00c853',
  despawning: '#555570',
  removed: '#555570',
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
  const name = agent.displayName || agent.sessionId.slice(0, 8);
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
        gap: 8,
        padding: '6px 10px',
        background: 'rgba(20, 20, 35, 0.85)',
        border: `2px solid ${borderColor}`,
        borderRadius: 4,
        cursor: 'pointer',
        minWidth: 120,
        transition: 'filter 0.15s',
      }}
      onMouseEnter={e => (e.currentTarget.style.filter = 'brightness(1.3)')}
      onMouseLeave={e => (e.currentTarget.style.filter = 'brightness(1)')}
    >
      {spriteUrl && (
        <img
          src={spriteUrl}
          alt=""
          style={{ width: 16, height: 32, imageRendering: 'pixelated' }}
        />
      )}
      <div style={{ minWidth: 0 }}>
        <div style={{
          fontSize: 11,
          fontWeight: 'bold',
          color: '#e0e0e8',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          maxWidth: 90,
        }}>
          {name}
        </div>
        <div style={{
          fontSize: 9,
          color: borderColor,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          maxWidth: 90,
        }}>
          {label}
        </div>
      </div>
    </div>
  );
}
