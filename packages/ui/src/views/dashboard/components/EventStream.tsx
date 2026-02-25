import { useRef, useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import type { AgentInfo, EventLogEntry } from '@claude-alive/core';

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
  agents: AgentInfo[];
}

export function EventStream({ events, agents }: EventStreamProps) {
  const { t } = useTranslation();
  const bottomRef = useRef<HTMLDivElement>(null);

  // Build sessionId → display name lookup
  const agentNameMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const a of agents) {
      map.set(a.sessionId, a.displayName || a.projectName || a.sessionId.slice(0, 8));
    }
    return map;
  }, [agents]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [events.length]);

  return (
    <div
      className="flex flex-col border rounded-lg overflow-hidden"
      style={{ background: 'var(--bg-card)', borderColor: 'var(--border-color)' }}
    >
      <div
        className="px-5 py-3 text-sm font-medium border-b"
        style={{ color: 'var(--text-secondary)', borderColor: 'var(--border-color)', background: 'var(--bg-secondary)' }}
      >
        {t('eventStream.title')} ({events.length})
      </div>
      <div className="overflow-y-auto max-h-[480px] p-3 space-y-1">
        {events.length === 0 && (
          <div className="text-center py-8 text-base" style={{ color: 'var(--text-secondary)' }}>
            {t('eventStream.waiting')}
          </div>
        )}
        {events.map((entry) => {
          const color = EVENT_COLORS[entry.event] ?? 'var(--text-secondary)';
          const time = new Date(entry.timestamp).toLocaleTimeString();
          const agentName = agentNameMap.get(entry.sessionId) ?? entry.sessionId.slice(0, 8);
          const eventLabel = t(`hookEvents.${entry.event}`, { defaultValue: entry.event });
          const stateLabel = t(`states.${entry.agentState}`, { defaultValue: entry.agentState });

          // Build description: event label + tool name if present
          const description = entry.tool
            ? `${eventLabel} — ${entry.tool}`
            : eventLabel;

          return (
            <div
              key={entry.id}
              className="flex items-center gap-3 px-3 py-1.5 rounded text-sm hover:bg-white/5 transition-colors"
            >
              <span className="shrink-0 font-mono text-xs" style={{ color: 'var(--text-secondary)' }}>
                {time}
              </span>
              <span
                className="shrink-0 truncate font-medium text-xs px-1.5 py-0.5 rounded"
                style={{ background: 'var(--bg-secondary)', color: 'var(--text-primary)', maxWidth: 120 }}
                title={entry.sessionId}
              >
                {agentName}
              </span>
              <span className="truncate" style={{ color }}>
                {description}
              </span>
              <span
                className="ml-auto shrink-0 px-2 py-0.5 rounded text-xs"
                style={{ background: `${color}15`, color }}
              >
                {stateLabel}
              </span>
            </div>
          );
        })}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}
