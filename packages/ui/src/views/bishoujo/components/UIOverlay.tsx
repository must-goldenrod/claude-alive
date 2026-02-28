import { useState, useCallback } from 'react';
import type { AgentInfo } from '@claude-alive/core';
import { extractToolDisplayName } from '@claude-alive/core';
import type { CharacterSlot } from '../engine/sceneLayout.ts';
import { slotToPixel } from '../engine/sceneLayout.ts';
import { getAnthropomorphicText } from '../../../utils/bubbleText.ts';

// Approximate internal height of Live2D models (pixels).
// Used to estimate where the character's head is for label placement.
const APPROX_MODEL_HEIGHT = 2500;

interface UIOverlayProps {
  agents: AgentInfo[];
  slotMap: Map<string, CharacterSlot>;
  canvasWidth: number;
  canvasHeight: number;
  onCharacterClick?: (sessionId: string) => void;
}

/**
 * DOM overlay that renders name plates, speech bubbles, and status icons
 * positioned above Live2D characters on the PixiJS canvas below.
 */
export function UIOverlay({ agents, slotMap, canvasWidth, canvasHeight, onCharacterClick }: UIOverlayProps) {
  const [hoveredId, setHoveredId] = useState<string | null>(null);

  const handleClick = useCallback((sessionId: string) => {
    onCharacterClick?.(sessionId);
  }, [onCharacterClick]);

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
        const isHovered = hoveredId === agent.sessionId;

        // Estimate character display height and head position.
        // Model anchor is at (0.5, 0.87), so 87% extends upward from pos.y.
        const charHeight = slot.def.scale * APPROX_MODEL_HEIGHT;
        const headY = pos.y - charHeight * 0.87;
        // Place label above the head with a small gap
        const labelY = headY - 8;

        // Speech bubble text
        const speechText = getAnthropomorphicText(
          agent.state,
          agent.currentTool,
          agent.currentToolAnimation,
        );

        return (
          <div
            key={agent.sessionId}
            style={{
              position: 'absolute',
              left: pos.x,
              top: labelY,
              transform: 'translate(-50%, -100%)',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: 3,
              zIndex: slot.def.z * 10,
            }}
          >
            {/* Speech bubble — shown when active/waiting/error OR hovered */}
            {speechText && (isActive || isWaiting || isError || isHovered) && (
              <div
                style={{
                  ...speechBubbleStyle,
                  ...(isWaiting ? { background: 'rgba(255, 170, 0, 0.9)' } : {}),
                  ...(isError ? { background: 'rgba(244, 67, 54, 0.9)' } : {}),
                  opacity: isHovered ? 1 : 0.85,
                  transform: isHovered ? 'scale(1.05)' : 'scale(1)',
                  transition: 'opacity 0.2s, transform 0.2s',
                }}
              >
                {speechText}
                <div style={bubbleTailStyle} />
              </div>
            )}

            {/* Tool badge — compact, shown when active with tool */}
            {isActive && agent.currentTool && !isHovered && !speechText && (
              <div style={toolBadgeStyle}>
                {extractToolDisplayName(agent.currentTool)}
              </div>
            )}

            {/* Name plate */}
            <div
              style={{
                ...nameStyle,
                color: isHovered ? '#fff' : 'rgba(255, 255, 255, 0.8)',
                fontSize: isHovered ? 11 : 10,
                transition: 'color 0.15s, font-size 0.15s',
              }}
            >
              {name}
            </div>

            {/* Expanded info on hover */}
            {isHovered && agent.currentTool && (
              <div style={expandedInfoStyle}>
                {extractToolDisplayName(agent.currentTool)}
              </div>
            )}
          </div>
        );

        // Hit area is positioned over the character body (separate from label)
      })}

      {/* Hit areas — rendered separately so they cover the character body, not the label */}
      {agents.map(agent => {
        const slot = slotMap.get(agent.sessionId);
        if (!slot) return null;

        const pos = slotToPixel(slot.def, canvasWidth, canvasHeight);
        const charHeight = slot.def.scale * APPROX_MODEL_HEIGHT;
        const hitWidth = Math.max(50, charHeight * 0.4);
        const hitHeight = Math.max(80, charHeight * 0.9);

        return (
          <div
            key={`hit-${agent.sessionId}`}
            onMouseEnter={() => setHoveredId(agent.sessionId)}
            onMouseLeave={() => setHoveredId(null)}
            onClick={() => handleClick(agent.sessionId)}
            style={{
              position: 'absolute',
              left: pos.x - hitWidth / 2,
              top: pos.y - hitHeight * 0.87,
              width: hitWidth,
              height: hitHeight,
              pointerEvents: 'auto',
              cursor: 'pointer',
              zIndex: slot.def.z * 10,
            }}
          />
        );
      })}
    </div>
  );
}

const speechBubbleStyle: React.CSSProperties = {
  position: 'relative',
  background: 'rgba(40, 40, 60, 0.9)',
  color: '#fff',
  fontSize: 11,
  fontWeight: 500,
  padding: '5px 10px',
  borderRadius: 10,
  whiteSpace: 'nowrap',
  backdropFilter: 'blur(6px)',
  maxWidth: 180,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  boxShadow: '0 2px 8px rgba(0,0,0,0.3)',
};

const bubbleTailStyle: React.CSSProperties = {
  position: 'absolute',
  bottom: -5,
  left: '50%',
  transform: 'translateX(-50%)',
  width: 0,
  height: 0,
  borderLeft: '5px solid transparent',
  borderRight: '5px solid transparent',
  borderTop: '5px solid rgba(40, 40, 60, 0.9)',
};

const toolBadgeStyle: React.CSSProperties = {
  background: 'rgba(68, 138, 255, 0.8)',
  color: '#fff',
  fontSize: 9,
  fontWeight: 600,
  padding: '2px 6px',
  borderRadius: 6,
  whiteSpace: 'nowrap',
  maxWidth: 120,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
};

const nameStyle: React.CSSProperties = {
  fontWeight: 600,
  textShadow: '0 1px 4px rgba(0,0,0,0.7)',
  whiteSpace: 'nowrap',
};

const expandedInfoStyle: React.CSSProperties = {
  background: 'rgba(30, 30, 50, 0.7)',
  color: 'rgba(255, 255, 255, 0.7)',
  fontSize: 9,
  padding: '2px 6px',
  borderRadius: 4,
  whiteSpace: 'nowrap',
  backdropFilter: 'blur(4px)',
};
