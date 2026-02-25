import { useRef, useEffect } from 'react';
import type { EventLogEntry } from '@claude-alive/core';

const EVENT_COLORS: Record<string, string> = {
  SessionStart: 'var(--accent-purple)',
  SessionEnd: 'var(--accent-red)',
  UserPromptSubmit: 'var(--accent-blue)',
  PreToolUse: 'var(--accent-green)',
  PostToolUse: 'var(--accent-green)',
  PostToolUseFailure: 'var(--accent-red)',
  PermissionRequest: 'var(--accent-amber)',
  Stop: 'var(--text-secondary)',
  Notification: 'var(--accent-amber)',
  SubagentStart: 'var(--accent-purple)',
  SubagentStop: 'var(--accent-purple)',
};

interface EventStreamProps {
  events: EventLogEntry[];
}

export function EventStream({ events }: EventStreamProps) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [events.length]);

  return (
    <div
      className="flex flex-col border rounded-lg overflow-hidden"
      style={{ background: 'var(--bg-card)', borderColor: 'var(--border-color)' }}
    >
      <div
        className="px-4 py-2 text-xs font-medium border-b"
        style={{ color: 'var(--text-secondary)', borderColor: 'var(--border-color)', background: 'var(--bg-secondary)' }}
      >
        Live Event Stream ({events.length})
      </div>
      <div className="overflow-y-auto max-h-96 p-2 space-y-0.5">
        {events.length === 0 && (
          <div className="text-center py-8 text-sm" style={{ color: 'var(--text-secondary)' }}>
            Waiting for events...
          </div>
        )}
        {events.map((entry) => {
          const color = EVENT_COLORS[entry.event] ?? 'var(--text-secondary)';
          const time = new Date(entry.timestamp).toLocaleTimeString();
          return (
            <div
              key={entry.id}
              className="flex items-center gap-3 px-2 py-1 rounded text-xs font-mono hover:bg-white/5 transition-colors"
            >
              <span style={{ color: 'var(--text-secondary)' }}>{time}</span>
              <span className="w-16 truncate" style={{ color: 'var(--text-secondary)' }}>
                {entry.sessionId.slice(0, 8)}
              </span>
              <span className="w-32 font-medium" style={{ color }}>
                {entry.event}
              </span>
              {entry.tool && (
                <span style={{ color: 'var(--text-primary)' }}>{entry.tool}</span>
              )}
              <span
                className="ml-auto px-1.5 py-0.5 rounded text-[10px]"
                style={{ background: `${color}15`, color }}
              >
                {entry.agentState}
              </span>
            </div>
          );
        })}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}
