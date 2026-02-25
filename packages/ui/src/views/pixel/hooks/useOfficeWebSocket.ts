import { useState, useEffect, useRef, useCallback } from 'react';
import type { WSServerMessage } from '@claude-alive/core';
import type { OfficeState } from '../engine/officeState';
import { spawnCharacter, despawnCharacter } from '../engine/officeState';
import { startToolActivity, setCharacterIdle } from '../engine/character';

export interface OfficeWSStatus {
  connected: boolean;
  agentCount: number;
  url: string;
}

/**
 * Map server ToolAnimation to character animation.
 * The character system only has 'typing' and 'reading'.
 */
function mapToolAnimation(animation: string | null): 'typing' | 'reading' {
  switch (animation) {
    case 'reading':
    case 'searching':
      return 'reading';
    case 'typing':
    case 'running':
    case 'thinking':
    default:
      return 'typing';
  }
}

export function useOfficeWebSocket(
  url: string,
  officeState: OfficeState,
): OfficeWSStatus {
  const [connected, setConnected] = useState(false);
  const [agentCount, setAgentCount] = useState(0);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const stateRef = useRef(officeState);
  stateRef.current = officeState;

  const syncAgentCount = useCallback(() => {
    setAgentCount(stateRef.current.characters.size);
  }, []);

  const handleMessage = useCallback((data: string) => {
    const msg = JSON.parse(data) as WSServerMessage;
    const state = stateRef.current;

    switch (msg.type) {
      case 'snapshot': {
        // Spawn characters for all existing agents
        for (const agent of msg.agents) {
          if (!state.characters.has(agent.sessionId)) {
            const char = spawnCharacter(state, agent.sessionId);

            // Apply current agent state
            if (agent.state === 'active' && agent.currentToolAnimation) {
              startToolActivity(char, mapToolAnimation(agent.currentToolAnimation), state.tileMap);
            } else if (agent.state === 'waiting') {
              char.bubble = 'waiting';
            } else if (agent.state === 'error') {
              char.bubble = 'error';
            }
          }
        }
        syncAgentCount();
        break;
      }

      case 'agent:spawn': {
        spawnCharacter(state, msg.agent.sessionId);
        syncAgentCount();
        break;
      }

      case 'agent:despawn': {
        despawnCharacter(state, msg.sessionId);
        syncAgentCount();
        break;
      }

      case 'agent:state': {
        const char = state.characters.get(msg.sessionId);
        if (!char) break;

        switch (msg.state) {
          case 'active': {
            const anim = mapToolAnimation(msg.animation);
            startToolActivity(char, anim, state.tileMap);
            char.bubble = 'none';
            break;
          }
          case 'idle':
          case 'done': {
            setCharacterIdle(char);
            break;
          }
          case 'listening': {
            // Attentive: face forward (down), stay idle
            setCharacterIdle(char);
            char.direction = 'down';
            break;
          }
          case 'waiting': {
            char.bubble = 'waiting';
            break;
          }
          case 'error': {
            char.bubble = 'error';
            break;
          }
          case 'spawning': {
            // Character already spawned with effect; nothing extra needed
            break;
          }
          case 'despawning': {
            despawnCharacter(state, msg.sessionId);
            syncAgentCount();
            break;
          }
        }
        break;
      }

      case 'agent:prompt': {
        // Brief listening animation: face forward
        const char = state.characters.get(msg.sessionId);
        if (char) {
          char.direction = 'down';
        }
        break;
      }

      case 'system:heartbeat':
      case 'event:new':
        // Ignored in pixel UI
        break;
    }
  }, [syncAgentCount]);

  const connect = useCallback(() => {
    try {
      const ws = new WebSocket(url);
      wsRef.current = ws;

      ws.onopen = () => {
        setConnected(true);
      };

      ws.onclose = () => {
        setConnected(false);
        // Auto-reconnect after 2s
        reconnectTimer.current = setTimeout(connect, 2000);
      };

      ws.onerror = () => {
        // onclose will fire after this
      };

      ws.onmessage = (event) => {
        handleMessage(event.data as string);
      };
    } catch {
      // Reconnect on connection failure
      reconnectTimer.current = setTimeout(connect, 2000);
    }
  }, [url, handleMessage]);

  useEffect(() => {
    connect();
    return () => {
      clearTimeout(reconnectTimer.current);
      wsRef.current?.close();
    };
  }, [connect]);

  return { connected, agentCount, url };
}
