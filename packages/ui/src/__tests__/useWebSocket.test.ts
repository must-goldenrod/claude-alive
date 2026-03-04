import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useWebSocket } from '../views/dashboard/hooks/useWebSocket.js';
import type { WSServerMessage, AgentInfo, AgentStats } from '@claude-alive/core';

const emptyStats: AgentStats = { totalAgents: 0, activeAgents: 0, subagentsByType: {}, toolCallsByName: {} };

// --- Mock WebSocket ---
type WSHandler = (event: { data: string }) => void;

class MockWebSocket {
  static instances: MockWebSocket[] = [];
  url: string;
  readyState = 0; // CONNECTING
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onmessage: WSHandler | null = null;
  onerror: ((e: unknown) => void) | null = null;

  constructor(url: string) {
    this.url = url;
    MockWebSocket.instances.push(this);
    // Simulate async open
    setTimeout(() => {
      this.readyState = 1; // OPEN
      this.onopen?.();
    }, 0);
  }

  send(_data: string) { /* noop */ }

  close() {
    this.readyState = 3; // CLOSED
    this.onclose?.();
  }

  /** Test helper: simulate server sending a message */
  simulateMessage(msg: WSServerMessage) {
    this.onmessage?.({ data: JSON.stringify(msg) });
  }
}

function mockAgent(sessionId: string, overrides: Partial<AgentInfo> = {}): AgentInfo {
  return {
    id: sessionId,
    sessionId,
    state: 'idle',
    currentTool: null,
    currentToolAnimation: null,
    cwd: '/tmp',
    lastEvent: 'SessionStart',
    lastEventTime: Date.now(),
    parentId: null,
    createdAt: Date.now(),
    displayName: null,
    projectName: 'test',
    transcriptPath: null,
    totalEvents: 0,
    lastPrompt: null,
    toolsUsed: [],
    toolCallCount: 0,
    toolCallCounts: {},
    tokenUsage: null,
    ...overrides,
  };
}

beforeEach(() => {
  MockWebSocket.instances = [];
  vi.stubGlobal('WebSocket', MockWebSocket);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('useWebSocket', () => {
  it('starts disconnected', () => {
    const { result } = renderHook(() => useWebSocket('ws://localhost:3141/ws'));
    expect(result.current.connected).toBe(false);
    expect(result.current.agents.size).toBe(0);
  });

  it('becomes connected on open', async () => {
    const { result } = renderHook(() => useWebSocket('ws://localhost:3141/ws'));
    // Wait for mock ws to open
    await act(async () => {
      await new Promise((r) => setTimeout(r, 10));
    });
    expect(result.current.connected).toBe(true);
  });

  it('populates agents from snapshot', async () => {
    const { result } = renderHook(() => useWebSocket('ws://localhost:3141/ws'));
    await act(async () => { await new Promise((r) => setTimeout(r, 10)); });

    const ws = MockWebSocket.instances[0]!;
    act(() => {
      ws.simulateMessage({
        type: 'snapshot',
        agents: [mockAgent('snap-1'), mockAgent('snap-2')],
        recentEvents: [],
        completedSessions: [], stats: emptyStats,
      });
    });

    expect(result.current.agents.size).toBe(2);
    expect(result.current.agents.get('snap-1')).toBeDefined();
    expect(result.current.agents.get('snap-2')).toBeDefined();
  });

  it('adds agent on agent:spawn', async () => {
    const { result } = renderHook(() => useWebSocket('ws://localhost:3141/ws'));
    await act(async () => { await new Promise((r) => setTimeout(r, 10)); });

    const ws = MockWebSocket.instances[0]!;
    act(() => {
      ws.simulateMessage({ type: 'snapshot', agents: [], recentEvents: [], completedSessions: [], stats: emptyStats });
    });
    act(() => {
      ws.simulateMessage({ type: 'agent:spawn', agent: mockAgent('new-1') });
    });

    expect(result.current.agents.size).toBe(1);
    expect(result.current.agents.get('new-1')!.sessionId).toBe('new-1');
  });

  it('removes agent on agent:despawn', async () => {
    const { result } = renderHook(() => useWebSocket('ws://localhost:3141/ws'));
    await act(async () => { await new Promise((r) => setTimeout(r, 10)); });

    const ws = MockWebSocket.instances[0]!;
    act(() => {
      ws.simulateMessage({
        type: 'snapshot',
        agents: [mockAgent('del-1')],
        recentEvents: [],
        completedSessions: [], stats: emptyStats,
      });
    });
    expect(result.current.agents.size).toBe(1);

    act(() => {
      ws.simulateMessage({ type: 'agent:despawn', sessionId: 'del-1' });
    });
    expect(result.current.agents.size).toBe(0);
  });

  it('updates agent state on agent:state', async () => {
    const { result } = renderHook(() => useWebSocket('ws://localhost:3141/ws'));
    await act(async () => { await new Promise((r) => setTimeout(r, 10)); });

    const ws = MockWebSocket.instances[0]!;
    act(() => {
      ws.simulateMessage({
        type: 'snapshot',
        agents: [mockAgent('state-1')],
        recentEvents: [],
        completedSessions: [], stats: emptyStats,
      });
    });

    act(() => {
      ws.simulateMessage({
        type: 'agent:state',
        sessionId: 'state-1',
        state: 'active',
        tool: 'Write',
        animation: 'typing',
        timestamp: Date.now(),
      });
    });

    const agent = result.current.agents.get('state-1')!;
    expect(agent.state).toBe('active');
    expect(agent.currentTool).toBe('Write');
    expect(agent.currentToolAnimation).toBe('typing');
    expect(agent.totalEvents).toBe(1);
  });

  it('updates agent prompt on agent:prompt', async () => {
    const { result } = renderHook(() => useWebSocket('ws://localhost:3141/ws'));
    await act(async () => { await new Promise((r) => setTimeout(r, 10)); });

    const ws = MockWebSocket.instances[0]!;
    act(() => {
      ws.simulateMessage({
        type: 'snapshot',
        agents: [mockAgent('prompt-1')],
        recentEvents: [],
        completedSessions: [], stats: emptyStats,
      });
    });

    act(() => {
      ws.simulateMessage({
        type: 'agent:prompt',
        sessionId: 'prompt-1',
        prompt: 'fix the bug',
      });
    });

    expect(result.current.agents.get('prompt-1')!.lastPrompt).toBe('fix the bug');
  });

  it('updates agent name on agent:rename', async () => {
    const { result } = renderHook(() => useWebSocket('ws://localhost:3141/ws'));
    await act(async () => { await new Promise((r) => setTimeout(r, 10)); });

    const ws = MockWebSocket.instances[0]!;
    act(() => {
      ws.simulateMessage({
        type: 'snapshot',
        agents: [mockAgent('name-1')],
        recentEvents: [],
        completedSessions: [], stats: emptyStats,
      });
    });

    act(() => {
      ws.simulateMessage({
        type: 'agent:rename',
        sessionId: 'name-1',
        name: 'MyBot',
      });
    });

    expect(result.current.agents.get('name-1')!.displayName).toBe('MyBot');
  });

  it('appends to events on event:new', async () => {
    const { result } = renderHook(() => useWebSocket('ws://localhost:3141/ws'));
    await act(async () => { await new Promise((r) => setTimeout(r, 10)); });

    const ws = MockWebSocket.instances[0]!;
    act(() => {
      ws.simulateMessage({ type: 'snapshot', agents: [mockAgent('ev-1')], recentEvents: [], completedSessions: [], stats: emptyStats });
    });

    act(() => {
      ws.simulateMessage({
        type: 'event:new',
        entry: { id: 1, timestamp: Date.now(), sessionId: 'ev-1', event: 'PreToolUse', tool: 'Write', agentState: 'active' },
      });
    });

    expect(result.current.events.length).toBe(1);
    expect(result.current.events[0]!.event).toBe('PreToolUse');
  });

  it('tracks toolsUsed on state updates', async () => {
    const { result } = renderHook(() => useWebSocket('ws://localhost:3141/ws'));
    await act(async () => { await new Promise((r) => setTimeout(r, 10)); });

    const ws = MockWebSocket.instances[0]!;
    act(() => {
      ws.simulateMessage({
        type: 'snapshot',
        agents: [mockAgent('tools-1')],
        recentEvents: [],
        completedSessions: [], stats: emptyStats,
      });
    });

    act(() => {
      ws.simulateMessage({ type: 'agent:state', sessionId: 'tools-1', state: 'active', tool: 'Write', animation: 'typing', timestamp: Date.now() });
    });
    act(() => {
      ws.simulateMessage({ type: 'agent:state', sessionId: 'tools-1', state: 'active', tool: 'Bash', animation: 'running', timestamp: Date.now() });
    });
    act(() => {
      ws.simulateMessage({ type: 'agent:state', sessionId: 'tools-1', state: 'active', tool: 'Write', animation: 'typing', timestamp: Date.now() });
    });

    expect(result.current.agents.get('tools-1')!.toolsUsed).toEqual(['Write', 'Bash']);
  });

  it('becomes disconnected on close', async () => {
    const { result } = renderHook(() => useWebSocket('ws://localhost:3141/ws'));
    await act(async () => { await new Promise((r) => setTimeout(r, 10)); });
    expect(result.current.connected).toBe(true);

    act(() => {
      MockWebSocket.instances[0]!.close();
    });
    expect(result.current.connected).toBe(false);
  });

  it('accumulates completedSessions from agent:completed', async () => {
    const { result } = renderHook(() => useWebSocket('ws://localhost:3141/ws'));
    await act(async () => { await new Promise((r) => setTimeout(r, 10)); });

    const ws = MockWebSocket.instances[0]!;
    act(() => {
      ws.simulateMessage({ type: 'snapshot', agents: [], recentEvents: [], completedSessions: [], stats: emptyStats });
    });
    act(() => {
      ws.simulateMessage({
        type: 'agent:completed',
        session: {
          sessionId: 'comp-1',
          cwd: '/tmp',
          projectName: 'test',
          completedAt: Date.now(),
          lastPrompt: 'done',
          displayName: null,
        },
      });
    });

    expect(result.current.completedSessions.length).toBe(1);
    expect(result.current.completedSessions[0]!.sessionId).toBe('comp-1');
  });
});
