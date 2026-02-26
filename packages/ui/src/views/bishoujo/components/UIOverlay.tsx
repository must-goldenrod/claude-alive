import { useTranslation } from 'react-i18next';
import type { AgentInfo } from '@claude-alive/core';
import { extractToolDisplayName } from '@claude-alive/core';
import type { CharacterSlot } from '../engine/sceneLayout.ts';
import { slotToPixel } from '../engine/sceneLayout.ts';

interface UIOverlayProps {
  agents: AgentInfo[];
  slotMap: Map<string, CharacterSlot>;
  canvasWidth: number;
  canvasHeight: number;
}

/**
 * DOM overlay that renders name plates, speech bubbles, and status icons
 * positioned to match character positions on the PixiJS canvas below.
 */
export function UIOverlay({ agents, slotMap, canvasWidth, canvasHeight }: UIOverlayProps) {
  const { t } = useTranslation();

  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        pointerEvents: 'none',
        overflow: 'hidden',
      }}
    >
      {agents.map(agent => {
        const slot = slotMap.get(agent.sessionId);
        if (!slot) return null;

        const pos = slotToPixel(slot.def, canvasWidth, canvasHeight);
        const name = agent.displayName || agent.projectName;
        const isActive = agent.state === 'active';
        const isWaiting = agent.state === 'waiting';
        const isError = agent.state === 'error';

        return (
          <div
            key={agent.sessionId}
            style={{
              position: 'absolute',
              left: pos.x,
              top: pos.y,
              transform: 'translate(-50%, 0)',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: 4,
            }}
          >
            {/* Status bubble */}
            {(isActive && agent.currentTool) && (
              <div style={bubbleStyle}>
                {extractToolDisplayName(agent.currentTool)}
              </div>
            )}
            {isWaiting && (
              <div style={{ ...bubbleStyle, background: 'rgba(255, 170, 0, 0.85)' }}>
                {t('states.waiting')} ?
              </div>
            )}
            {isError && (
              <div style={{ ...bubbleStyle, background: 'rgba(244, 67, 54, 0.85)' }}>
                {t('states.error')} !
              </div>
            )}

            {/* Name plate */}
            <div style={nameStyle}>
              {name}
            </div>
          </div>
        );
      })}
    </div>
  );
}

const bubbleStyle: React.CSSProperties = {
  background: 'rgba(40, 40, 60, 0.85)',
  color: '#fff',
  fontSize: 10,
  fontWeight: 500,
  padding: '3px 8px',
  borderRadius: 8,
  whiteSpace: 'nowrap',
  backdropFilter: 'blur(4px)',
  pointerEvents: 'auto',
  maxWidth: 140,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
};

const nameStyle: React.CSSProperties = {
  color: 'rgba(255, 255, 255, 0.8)',
  fontSize: 10,
  fontWeight: 600,
  textShadow: '0 1px 3px rgba(0,0,0,0.6)',
  whiteSpace: 'nowrap',
};
