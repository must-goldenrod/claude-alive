import { useMemo } from 'react';
import type { AgentInfo, EventLogEntry } from '@claude-alive/core';
import { useNow } from '../hooks/useNow';

interface StatsBarProps {
  agents: AgentInfo[];
  events: EventLogEntry[];
}

export function StatsBar({ agents, events }: StatsBarProps) {
  const now = useNow();
  const stats = useMemo(() => {
    const activeAgents = agents.filter((a) => a.state === 'active' || a.state === 'listening').length;

    // Events per minute: count events in last 60s, extrapolate
    const oneMinuteAgo = now - 60_000;
    const recentCount = events.filter((e) => e.timestamp >= oneMinuteAgo).length;

    // Most used tool
    const toolCounts = new Map<string, number>();
    for (const e of events) {
      if (e.tool) {
        toolCounts.set(e.tool, (toolCounts.get(e.tool) ?? 0) + 1);
      }
    }
    let mostUsedTool = '-';
    let maxCount = 0;
    for (const [tool, count] of toolCounts) {
      if (count > maxCount) {
        maxCount = count;
        mostUsedTool = tool;
      }
    }

    return {
      totalEvents: events.length,
      eventsPerMinute: recentCount,
      activeAgents,
      totalAgents: agents.length,
      mostUsedTool,
    };
  }, [agents, events, now]);

  const items = [
    { label: 'Events', value: String(stats.totalEvents) },
    { label: 'Events/min', value: String(stats.eventsPerMinute) },
    { label: 'Active', value: `${stats.activeAgents}/${stats.totalAgents}` },
    { label: 'Top tool', value: stats.mostUsedTool },
  ];

  return (
    <div
      className="grid grid-cols-4 gap-px rounded-lg overflow-hidden border"
      style={{ borderColor: 'var(--border-color)' }}
    >
      {items.map((item) => (
        <div
          key={item.label}
          className="px-4 py-2 text-center"
          style={{ background: 'var(--bg-card)' }}
        >
          <div className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>
            {item.value}
          </div>
          <div className="text-[10px]" style={{ color: 'var(--text-secondary)' }}>
            {item.label}
          </div>
        </div>
      ))}
    </div>
  );
}
