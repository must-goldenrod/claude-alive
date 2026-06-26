import { useState, useRef, useCallback } from 'react';
import type { AgentInfo, CompletedSession, EventLogEntry, AgentStats as AgentStatsType } from '@claude-alive/core';
import { ActivityPulse } from '../dashboard/components/ActivityPulse.tsx';
import { EventStream } from '../dashboard/components/EventStream.tsx';
import { CompletionLog } from '../dashboard/components/CompletionLog.tsx';
import { AgentStats } from '../dashboard/components/AgentStats.tsx';
import { EfficioPanel } from '../dashboard/components/EfficioPanel.tsx';

const MIN_WIDTH = 280;
const MAX_WIDTH = 600;
const DEFAULT_WIDTH = 360;

interface RightPanelProps {
  events: EventLogEntry[];
  agents: AgentInfo[];
  completedSessions: CompletedSession[];
  stats: AgentStatsType | null;
  collapsed?: boolean;
}

export function RightPanel({ events, agents, completedSessions, stats, collapsed = false }: RightPanelProps) {
  const [width, setWidth] = useState(DEFAULT_WIDTH);
  const dragging = useRef(false);
  const startX = useRef(0);
  const startWidth = useRef(DEFAULT_WIDTH);

  const onMouseDown = useCallback((e: React.MouseEvent) => {
    dragging.current = true;
    startX.current = e.clientX;
    startWidth.current = width;

    const onMouseMove = (ev: MouseEvent) => {
      if (!dragging.current) return;
      // Dragging left increases width (panel is on the right)
      const delta = startX.current - ev.clientX;
      setWidth(Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, startWidth.current + delta)));
    };

    const onMouseUp = () => {
      dragging.current = false;
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };

    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  }, [width]);

  return (
    <div
      className="flex flex-col h-full overflow-hidden relative"
      style={{
        width: collapsed ? 0 : width,
        minWidth: collapsed ? 0 : width,
        opacity: collapsed ? 0 : 1,
        background: 'var(--bg-secondary)',
        borderLeft: collapsed ? 'none' : '1px solid var(--border-color)',
        transition: collapsed ? 'width 200ms ease, min-width 200ms ease, opacity 150ms ease' : undefined,
      }}
    >
      {/* Resize handle */}
      {!collapsed && (
        <div
          onMouseDown={onMouseDown}
          style={{
            position: 'absolute',
            left: 0,
            top: 0,
            bottom: 0,
            width: 5,
            cursor: 'col-resize',
            zIndex: 10,
          }}
        />
      )}

      {/* Agent Stats */}
      <div className="shrink-0 p-3 pb-0">
        <AgentStats stats={stats} agents={agents} />
      </div>

      {/* Activity Pulse */}
      <div className="shrink-0 p-3 pb-0">
        <ActivityPulse events={events} />
      </div>

      {/* Completion Log */}
      {completedSessions.length > 0 && (
        <div className="shrink-0 p-3 pb-0">
          <CompletionLog completedSessions={completedSessions} />
        </div>
      )}

      {/* Efficio — size-adjusted waste residual (read from ~/.efficio/efficio.db) */}
      <div className="shrink-0 p-3 pb-0">
        <EfficioPanel />
      </div>

      {/* Event Stream - fills remaining space */}
      <div className="flex-1 overflow-hidden flex flex-col min-h-0 p-3 pt-3">
        <EventStream events={events} agents={agents} />
      </div>
    </div>
  );
}
