import type { AgentInfo, EventLogEntry } from '@claude-alive/core';
import { ActivityPulse } from '../dashboard/components/ActivityPulse.tsx';
import { EventStream } from '../dashboard/components/EventStream.tsx';

interface RightPanelProps {
  events: EventLogEntry[];
  agents: AgentInfo[];
}

export function RightPanel({ events, agents }: RightPanelProps) {
  return (
    <div
      className="flex flex-col h-full overflow-hidden"
      style={{
        width: 320,
        minWidth: 320,
        background: 'var(--bg-secondary)',
        borderLeft: '1px solid var(--border-color)',
      }}
    >
      {/* Activity Pulse */}
      <div className="shrink-0 p-3 pb-0">
        <ActivityPulse events={events} />
      </div>

      {/* Event Stream - fills remaining space */}
      <div className="flex-1 overflow-hidden flex flex-col min-h-0 p-3 pt-3">
        <EventStream events={events} agents={agents} />
      </div>
    </div>
  );
}
