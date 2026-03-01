import { useRef, useEffect, useMemo } from 'react';
import type { AgentInfo, EventLogEntry } from '@claude-alive/core';

export interface PromptEntry {
  sessionId: string;
  text: string;
  timestamp: number;
}

interface AgentTimelinePanelProps {
  agent: AgentInfo;
  events: EventLogEntry[];
  prompts: PromptEntry[];
  onClose: () => void;
}

const STATE_COLORS: Record<string, string> = {
  spawning: 'var(--accent-purple)',
  idle: 'var(--text-secondary)',
  listening: 'var(--accent-blue)',
  active: 'var(--accent-green)',
  waiting: 'var(--accent-amber)',
  error: 'var(--accent-red)',
  done: 'var(--accent-green)',
  despawning: 'var(--accent-red)',
};

const TOOL_ICONS: Record<string, string> = {
  Read: '\u{1F4D6}',
  Write: '\u{270F}\u{FE0F}',
  Edit: '\u{270F}\u{FE0F}',
  Bash: '\u{1F4BB}',
  Grep: '\u{1F50D}',
  Glob: '\u{1F4C2}',
  WebSearch: '\u{1F310}',
  WebFetch: '\u{1F310}',
  Agent: '\u{1F916}',
  Skill: '\u{26A1}',
};

type TimelineItem =
  | { kind: 'prompt'; text: string; timestamp: number }
  | { kind: 'event'; entry: EventLogEntry };

function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function summarizeEvent(entry: EventLogEntry): string | null {
  switch (entry.event) {
    case 'SessionStart': return 'Session started';
    case 'SessionEnd': return 'Session ended';
    case 'PreToolUse': return entry.tool ? `Using ${entry.tool}` : 'Using tool';
    case 'PostToolUse': return entry.tool ? `Finished ${entry.tool}` : 'Tool finished';
    case 'PostToolUseFailure': return entry.tool ? `Failed: ${entry.tool}` : 'Tool failed';
    case 'PermissionRequest': return 'Waiting for permission';
    case 'Stop': return 'Stopped';
    case 'SubagentStart': return 'Sub-agent spawned';
    case 'SubagentStop': return 'Sub-agent stopped';
    case 'TaskCompleted': return 'Task completed';
    case 'Notification': return 'Notification';
    case 'PreCompact': return 'Context compacting';
    default: return entry.event;
  }
}

// Collapse consecutive PreToolUse+PostToolUse for same tool into one entry
function collapseEvents(items: TimelineItem[]): TimelineItem[] {
  const result: TimelineItem[] = [];
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    if (item.kind === 'event' && item.entry.event === 'PreToolUse') {
      const next = items[i + 1];
      if (next?.kind === 'event' && next.entry.event === 'PostToolUse' && next.entry.tool === item.entry.tool) {
        // Merge into single "Used X" entry
        result.push({ kind: 'event', entry: { ...next.entry, event: 'PostToolUse' } });
        i++; // skip next
        continue;
      }
    }
    result.push(item);
  }
  return result;
}

export function AgentTimelinePanel({ agent, events, prompts, onClose }: AgentTimelinePanelProps) {
  const scrollRef = useRef<HTMLDivElement>(null);

  const agentEvents = useMemo(
    () => events.filter(e => e.sessionId === agent.sessionId),
    [events, agent.sessionId],
  );

  const agentPrompts = useMemo(
    () => prompts.filter(p => p.sessionId === agent.sessionId),
    [prompts, agent.sessionId],
  );

  const timeline = useMemo(() => {
    const items: TimelineItem[] = [
      ...agentPrompts.map(p => ({ kind: 'prompt' as const, text: p.text, timestamp: p.timestamp })),
      ...agentEvents.map(e => ({ kind: 'event' as const, entry: e })),
    ];
    items.sort((a, b) => {
      const ta = a.kind === 'prompt' ? a.timestamp : a.entry.timestamp;
      const tb = b.kind === 'prompt' ? b.timestamp : b.entry.timestamp;
      return ta - tb;
    });
    return collapseEvents(items);
  }, [agentEvents, agentPrompts]);

  // Auto-scroll to bottom on new items
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [timeline.length]);

  const displayName = agent.displayName || agent.projectName || agent.sessionId.slice(0, 8);
  const stateColor = STATE_COLORS[agent.state] ?? '#8888a0';

  return (
    <div style={{
      position: 'absolute',
      bottom: 0,
      left: 0,
      right: 0,
      height: '45%',
      minHeight: 200,
      maxHeight: 400,
      zIndex: 15,
      background: 'rgba(13, 17, 23, 0.96)',
      borderTop: '1px solid var(--border-color)',
      display: 'flex',
      flexDirection: 'column',
      backdropFilter: 'blur(12px)',
    }}>
      {/* Header */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        padding: '14px 20px',
        borderBottom: '1px solid var(--border-color)',
        flexShrink: 0,
      }}>
        <div style={{
          width: 10,
          height: 10,
          borderRadius: '50%',
          background: stateColor,
          boxShadow: agent.state === 'active' ? `0 0 8px ${stateColor}` : 'none',
        }} />
        <span style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-primary)' }}>
          {displayName}
        </span>
        <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
          {agent.state}
        </span>
        {agent.currentTool && (
          <span style={{
            fontSize: 12,
            padding: '3px 10px',
            borderRadius: 8,
            background: `${stateColor}20`,
            color: stateColor,
            fontFamily: 'var(--font-mono)',
          }}>
            {agent.currentTool}
          </span>
        )}
        <button
          onClick={onClose}
          style={{
            marginLeft: 'auto',
            background: 'none',
            border: 'none',
            color: 'var(--text-secondary)',
            cursor: 'pointer',
            fontSize: 18,
            padding: '0 4px',
          }}
        >
          &#x2715;
        </button>
      </div>

      {/* Timeline */}
      <div ref={scrollRef} style={{
        flex: 1,
        overflowY: 'auto',
        padding: '12px 20px',
      }}>
        {timeline.length === 0 ? (
          <div style={{ textAlign: 'center', color: 'var(--text-secondary)', fontSize: 14, paddingTop: 36 }}>
            No events yet
          </div>
        ) : (
          timeline.map((item, i) => {
            if (item.kind === 'prompt') {
              return (
                <div key={`p-${i}`} style={{
                  display: 'flex',
                  justifyContent: 'flex-end',
                  marginBottom: 10,
                }}>
                  <div style={{
                    maxWidth: '80%',
                    padding: '10px 14px',
                    borderRadius: '14px 14px 4px 14px',
                    background: 'rgba(88, 166, 255, 0.12)',
                    border: '1px solid rgba(88, 166, 255, 0.2)',
                  }}>
                    <div style={{ fontSize: 13, color: 'var(--text-primary)', lineHeight: 1.6, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                      {item.text}
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 6, textAlign: 'right', fontFamily: 'var(--font-mono)' }}>
                      {formatTime(item.timestamp)}
                    </div>
                  </div>
                </div>
              );
            }

            const { entry } = item;
            const summary = summarizeEvent(entry);
            if (!summary) return null;

            const isError = entry.event === 'PostToolUseFailure';
            const isSystem = entry.event === 'SessionStart' || entry.event === 'SessionEnd' || entry.event === 'Stop';
            const toolIcon = entry.tool ? (TOOL_ICONS[entry.tool] ?? '\u{1F527}') : '';

            if (isSystem) {
              return (
                <div key={`e-${entry.id}`} style={{
                  textAlign: 'center',
                  marginBottom: 8,
                  marginTop: 8,
                }}>
                  <span style={{
                    fontSize: 11,
                    color: 'var(--text-secondary)',
                    padding: '4px 12px',
                    background: 'var(--bg-card)',
                    borderRadius: 12,
                  }}>
                    {summary} &middot; {formatTime(entry.timestamp)}
                  </span>
                </div>
              );
            }

            return (
              <div key={`e-${entry.id}`} style={{
                display: 'flex',
                justifyContent: 'flex-start',
                marginBottom: 8,
              }}>
                <div style={{
                  maxWidth: '80%',
                  padding: '8px 12px',
                  borderRadius: '14px 14px 14px 4px',
                  background: isError ? 'rgba(248, 81, 73, 0.1)' : 'var(--bg-card)',
                  border: `1px solid ${isError ? 'rgba(248, 81, 73, 0.2)' : 'var(--border-color)'}`,
                }}>
                  <div style={{ fontSize: 13, color: isError ? 'var(--accent-red)' : 'var(--text-primary)' }}>
                    {toolIcon && <span style={{ marginRight: 6 }}>{toolIcon}</span>}
                    {summary}
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 4, fontFamily: 'var(--font-mono)' }}>
                    {formatTime(entry.timestamp)}
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
