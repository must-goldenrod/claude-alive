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
      className="flex flex-col border rounded-xl overflow-hidden flex-1 min-h-0"
      style={{ background: 'var(--bg-card)', borderColor: 'var(--border-color)' }}
    >
      <div
        className="px-5 py-4 text-[13px] font-semibold border-b shrink-0 flex items-center justify-between"
        style={{ color: 'var(--text-secondary)', borderColor: 'var(--border-color)', background: 'var(--bg-secondary)' }}
      >
        <span>{t('eventStream.title')}</span>
        <span className="text-xs font-normal" style={{ color: 'var(--text-secondary)', opacity: 0.6 }}>{events.length}</span>
      </div>
      <div className="overflow-y-auto flex-1 p-3 space-y-0.5">
        {events.length === 0 && (
          <div className="text-center py-8 text-sm" style={{ color: 'var(--text-secondary)' }}>
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
              className="flex items-center gap-3 px-3.5 py-2.5 rounded-lg text-xs hover:bg-white/5 transition-colors"
            >
              <span className="shrink-0 text-xs" style={{ color: 'var(--text-secondary)', fontFamily: 'var(--font-mono)' }}>
                {time}
              </span>
              <span
                className="shrink-0 truncate font-medium text-xs px-2 py-1 rounded-md"
                style={{ background: 'var(--bg-secondary)', color: 'var(--text-primary)', maxWidth: 130 }}
                title={entry.sessionId}
              >
                {agentName}
              </span>
              <span className="truncate text-xs" style={{ color }}>
                {description}
              </span>
              <span
                className="ml-auto shrink-0 px-2.5 py-1 rounded-md text-[11px] font-medium"
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
