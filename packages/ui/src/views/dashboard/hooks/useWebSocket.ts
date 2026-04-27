import { useState, useEffect, useRef, useCallback } from 'react';
import type { AgentInfo, AgentState, CompletedSession, ToolAnimation, EventLogEntry, WSServerMessage, WSClientMessage, AgentStats } from '@claude-alive/core';

const COMPLETION_SOUND_URL = '/assets/complete_sound.mp3';
const ERROR_SOUND_URL = '/assets/error_sound.mp3';

// Debounce window per sessionId+kind to avoid double-firing when both
// `agent:completed` and a `non-idle → idle` transition arrive close together.
const SOUND_DEBOUNCE_MS = 800;
const lastPlayedAt = new Map<string, number>();

function playSound(url: string, dedupeKey: string, volume = 0.7) {
  const now = Date.now();
  const prev = lastPlayedAt.get(dedupeKey) ?? 0;
  if (now - prev < SOUND_DEBOUNCE_MS) return;
  lastPlayedAt.set(dedupeKey, now);
  try {
    const audio = new Audio(url);
    audio.volume = volume;
    audio.play().catch(() => {
      // Browser may block autoplay before user interaction — silently ignore
    });
  } catch {
    // Audio not supported — silently ignore
  }
}

export function playCompletionSound(sessionId = 'global') {
  playSound(COMPLETION_SOUND_URL, `complete:${sessionId}`);
}

export function playErrorSound(sessionId = 'global') {
  playSound(ERROR_SOUND_URL, `error:${sessionId}`);
}

export interface SystemMetrics {
  /** CPU usage 0..1 (average across cores, rolling 2s window). */
  cpu: number;
  /** Used memory in bytes. */
  memUsed: number;
  /** Total memory in bytes. */
  memTotal: number;
  timestamp: number;
}

export interface DashboardState {
  agents: Map<string, AgentInfo>;
  events: EventLogEntry[];
  completedSessions: CompletedSession[];
  stats: AgentStats | null;
  connected: boolean;
  systemMetrics: SystemMetrics | null;
}

// Auto-prune window for agents in `despawning` state. They linger briefly so
// the user can see the lifecycle ending, then disappear from the list.
const DESPAWN_PRUNE_MS = 60_000;

export function useWebSocket(url: string, onRawMessage?: (msg: WSServerMessage) => void) {
  const [state, setState] = useState<DashboardState>({
    agents: new Map(),
    events: [],
    completedSessions: [],
    stats: null,
    connected: false,
    systemMetrics: null,
  });
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const despawnTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  const connect = useCallback(() => {
    const ws = new WebSocket(url);
    wsRef.current = ws;

    ws.onopen = () => {
      setState(prev => ({ ...prev, connected: true }));
    };

    ws.onclose = () => {
      setState(prev => ({ ...prev, connected: false }));
      // Reconnect after 2s
      reconnectTimer.current = setTimeout(connect, 2000);
    };

    ws.onmessage = (event) => {
      const msg = JSON.parse(event.data) as WSServerMessage;
      onRawMessage?.(msg);

      if (msg.type === 'agent:completed') {
        playCompletionSound(msg.session.sessionId);
      }

      setState(prev => {
        const agents = new Map(prev.agents);
        let events = prev.events;
        let completedSessions = prev.completedSessions;

        switch (msg.type) {
          case 'snapshot': {
            agents.clear();
            for (const agent of msg.agents) {
              agents.set(agent.sessionId, agent);
            }
            events = msg.recentEvents;
            completedSessions = msg.completedSessions ?? [];
            return { agents, events, completedSessions, stats: msg.stats ?? null, connected: true, systemMetrics: prev.systemMetrics };
          }
          case 'agent:spawn': {
            agents.set(msg.agent.sessionId, msg.agent);
            break;
          }
          case 'agent:despawn': {
            agents.delete(msg.sessionId);
            break;
          }
          case 'agent:state': {
            const agent = agents.get(msg.sessionId);
            if (agent) {
              const toolsUsed = msg.tool && !agent.toolsUsed.includes(msg.tool)
                ? [...agent.toolsUsed, msg.tool]
                : agent.toolsUsed;
              const nextState = msg.state as AgentState;
              // "Agent finished work and went back to waiting": fire completion
              // sound on transitions from an actively-working state into idle.
              // `spawning → idle` is excluded because that's first-appearance,
              // not a task completion. The debounce in playSound() collapses
              // overlap with any concurrent `agent:completed` message.
              if (
                nextState === 'idle' &&
                agent.state !== 'idle' &&
                agent.state !== 'spawning'
              ) {
                playCompletionSound(msg.sessionId);
              }
              agents.set(msg.sessionId, {
                ...agent,
                state: nextState,
                currentTool: msg.tool,
                currentToolAnimation: msg.animation as ToolAnimation | null,
                lastEventTime: msg.timestamp ?? agent.lastEventTime,
                totalEvents: agent.totalEvents + 1,
                toolsUsed,
              });
            }
            break;
          }
          case 'agent:prompt': {
            const pa = agents.get(msg.sessionId);
            if (pa) {
              agents.set(msg.sessionId, { ...pa, lastPrompt: msg.prompt });
            }
            break;
          }
          case 'agent:rename': {
            const ra = agents.get(msg.sessionId);
            if (ra) {
              agents.set(msg.sessionId, { ...ra, displayName: msg.name });
            }
            break;
          }
          case 'agent:completed': {
            completedSessions = [...completedSessions, msg.session];
            break;
          }
          case 'event:new': {
            // Skip duplicates (race between snapshot and event:new)
            if (events.length > 0 && events[events.length - 1]!.id >= msg.entry.id) break;
            events = [...events.slice(-199), msg.entry];
            const ea = agents.get(msg.entry.sessionId);
            if (ea) {
              const toolsUsed = msg.entry.tool && !ea.toolsUsed.includes(msg.entry.tool)
                ? [...ea.toolsUsed, msg.entry.tool]
                : ea.toolsUsed;
              agents.set(msg.entry.sessionId, {
                ...ea,
                lastEventTime: msg.entry.timestamp,
                totalEvents: ea.totalEvents + 1,
                toolsUsed,
              });
            }
            break;
          }
          case 'stats:update': {
            return { ...prev, stats: msg.stats };
          }
          case 'system:heartbeat': {
            // Connection alive
            break;
          }
          case 'system:metrics': {
            return {
              ...prev,
              systemMetrics: {
                cpu: msg.cpu,
                memUsed: msg.memUsed,
                memTotal: msg.memTotal,
                timestamp: msg.timestamp,
              },
            };
          }
        }

        return { agents, events, completedSessions, stats: prev.stats, connected: true, systemMetrics: prev.systemMetrics };
      });
    };
  }, [url, onRawMessage]);

  const send = useCallback((msg: WSClientMessage) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(msg));
    }
  }, []);

  useEffect(() => {
    connect();
    return () => {
      clearTimeout(reconnectTimer.current);
      wsRef.current?.close();
    };
  }, [connect]);

  // Auto-prune `despawning` agents after DESPAWN_PRUNE_MS. Runs on every agents
  // map update, but each operation is idempotent (timer registered only if missing,
  // cleared if the agent recovered or was already removed). Bounded by agent count,
  // so the cost is trivial in practice.
  useEffect(() => {
    const timers = despawnTimers.current;
    for (const [sessionId, agent] of state.agents) {
      const isDespawning = agent.state === 'despawning';
      const hasTimer = timers.has(sessionId);
      if (isDespawning && !hasTimer) {
        const handle = setTimeout(() => {
          timers.delete(sessionId);
          setState(prev => {
            const current = prev.agents.get(sessionId);
            // Skip if the agent recovered to a non-despawning state in the
            // meantime — only prune if it's still despawning.
            if (!current || current.state !== 'despawning') return prev;
            const next = new Map(prev.agents);
            next.delete(sessionId);
            return { ...prev, agents: next };
          });
        }, DESPAWN_PRUNE_MS);
        timers.set(sessionId, handle);
      } else if (!isDespawning && hasTimer) {
        clearTimeout(timers.get(sessionId)!);
        timers.delete(sessionId);
      }
    }
    // Clear timers for agents that disappeared (e.g. via agent:despawn or snapshot).
    for (const sessionId of [...timers.keys()]) {
      if (!state.agents.has(sessionId)) {
        clearTimeout(timers.get(sessionId)!);
        timers.delete(sessionId);
      }
    }
  }, [state.agents]);

  // Final cleanup on unmount.
  useEffect(() => {
    const timers = despawnTimers.current;
    return () => {
      for (const handle of timers.values()) clearTimeout(handle);
      timers.clear();
    };
  }, []);

  return { ...state, send };
}
