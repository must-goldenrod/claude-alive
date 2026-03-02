import { describe, it, expect, beforeEach } from 'vitest';
import { SessionStore } from '../state/sessionStore.js';
import type { HookEventPayload, HookEventData } from '../events/types.js';

function makePayload(event: string, sessionId: string, overrides: Partial<HookEventData> = {}): HookEventPayload {
  return {
    event: event as HookEventPayload['event'],
    tool: overrides.tool_name ?? 'system',
    session_id: sessionId,
    timestamp: Date.now(),
    data: {
      session_id: sessionId,
      hook_event_name: event as HookEventData['hook_event_name'],
      cwd: '/tmp/test',
      ...overrides,
    },
  };
}

describe('SessionStore', () => {
  let store: SessionStore;

  beforeEach(() => {
    store = new SessionStore(100, 10);
  });

  describe('agent lifecycle', () => {
    it('creates agent on SessionStart', () => {
      const agent = store.processEvent(makePayload('SessionStart', 'sess-1'));
      expect(agent).not.toBeNull();
      expect(agent!.sessionId).toBe('sess-1');
      expect(agent!.state).toBe('spawning');
    });

    it('tracks agent state transitions', () => {
      store.processEvent(makePayload('SessionStart', 'sess-1'));
      const agent = store.processEvent(makePayload('UserPromptSubmit', 'sess-1', { prompt: 'hello' }));
      expect(agent!.state).toBe('listening');
    });

    it('transitions to active on PreToolUse', () => {
      store.processEvent(makePayload('SessionStart', 'sess-1'));
      const agent = store.processEvent(makePayload('PreToolUse', 'sess-1', { tool_name: 'Write' }));
      expect(agent!.state).toBe('active');
      expect(agent!.currentTool).toBe('Write');
      expect(agent!.currentToolAnimation).toBe('typing');
    });

    it('transitions to despawning on SessionEnd', () => {
      store.processEvent(makePayload('SessionStart', 'sess-1'));
      const agent = store.processEvent(makePayload('SessionEnd', 'sess-1'));
      expect(agent!.state).toBe('despawning');
    });

    it('returns null for SessionEnd of unknown session', () => {
      const agent = store.processEvent(makePayload('SessionEnd', 'nonexistent'));
      expect(agent).toBeNull();
    });

    it('auto-creates agent for events without SessionStart', () => {
      const agent = store.processEvent(makePayload('PreToolUse', 'auto-1', { tool_name: 'Bash' }));
      expect(agent).not.toBeNull();
      expect(agent!.sessionId).toBe('auto-1');
      expect(agent!.state).toBe('active');
    });
  });

  describe('sub-agents', () => {
    it('creates sub-agent on SubagentStart', () => {
      store.processEvent(makePayload('SessionStart', 'parent-1'));
      const agent = store.processEvent(makePayload('SubagentStart', 'parent-1', {
        agent_id: 'sub-1',
        agent_type: 'Explore',
      }));
      expect(agent).not.toBeNull();
      expect(agent!.sessionId).toBe('sub-1');
      expect(agent!.parentId).toBe('parent-1');
      expect(agent!.displayName).toBe('Explore');
    });

    it('despawns sub-agent on SubagentStop', () => {
      store.processEvent(makePayload('SessionStart', 'parent-1'));
      store.processEvent(makePayload('SubagentStart', 'parent-1', { agent_id: 'sub-1' }));
      const agent = store.processEvent(makePayload('SubagentStop', 'parent-1', { agent_id: 'sub-1' }));
      expect(agent!.state).toBe('despawning');
    });

    it('returns null for SubagentStop of unknown sub-agent', () => {
      const agent = store.processEvent(makePayload('SubagentStop', 'parent-1', { agent_id: 'nonexistent' }));
      expect(agent).toBeNull();
    });
  });

  describe('user prompt capture', () => {
    it('captures lastPrompt on UserPromptSubmit', () => {
      store.processEvent(makePayload('SessionStart', 'sess-1'));
      const agent = store.processEvent(makePayload('UserPromptSubmit', 'sess-1', { prompt: 'fix the bug' }));
      expect(agent!.lastPrompt).toBe('fix the bug');
    });
  });

  describe('tool tracking', () => {
    it('accumulates unique tools used', () => {
      store.processEvent(makePayload('SessionStart', 'sess-1'));
      store.processEvent(makePayload('PreToolUse', 'sess-1', { tool_name: 'Write' }));
      store.processEvent(makePayload('PreToolUse', 'sess-1', { tool_name: 'Bash' }));
      store.processEvent(makePayload('PreToolUse', 'sess-1', { tool_name: 'Write' })); // duplicate
      const agent = store.getAgent('sess-1');
      expect(agent!.toolsUsed).toEqual(['Write', 'Bash']);
    });

    it('clears currentTool on Stop', () => {
      store.processEvent(makePayload('SessionStart', 'sess-1'));
      store.processEvent(makePayload('PreToolUse', 'sess-1', { tool_name: 'Read' }));
      const agent = store.processEvent(makePayload('Stop', 'sess-1'));
      expect(agent!.currentTool).toBeNull();
      expect(agent!.currentToolAnimation).toBeNull();
    });
  });

  describe('cwd tracking', () => {
    it('updates cwd when it changes', () => {
      store.processEvent(makePayload('SessionStart', 'sess-1'));
      store.processEvent(makePayload('PreToolUse', 'sess-1', { tool_name: 'Bash', cwd: '/new/path' } as any));
      const agent = store.getAgent('sess-1');
      expect(agent!.cwd).toBe('/new/path');
      expect(agent!.projectName).toBe('path');
    });
  });

  describe('event log', () => {
    it('records events in log', () => {
      store.processEvent(makePayload('SessionStart', 'sess-1'));
      store.processEvent(makePayload('PreToolUse', 'sess-1', { tool_name: 'Write' }));
      const events = store.getRecentEvents(10);
      expect(events.length).toBe(2);
      expect(events[0]!.event).toBe('SessionStart');
      expect(events[1]!.event).toBe('PreToolUse');
    });

    it('respects max log size', () => {
      const smallStore = new SessionStore(5, 10);
      smallStore.processEvent(makePayload('SessionStart', 'sess-1'));
      for (let i = 0; i < 10; i++) {
        smallStore.processEvent(makePayload('PreToolUse', 'sess-1', { tool_name: 'Write' }));
      }
      const events = smallStore.getRecentEvents(100);
      expect(events.length).toBe(5);
    });

    it('assigns incrementing IDs', () => {
      store.processEvent(makePayload('SessionStart', 'sess-1'));
      store.processEvent(makePayload('SessionStart', 'sess-2'));
      const events = store.getRecentEvents(10);
      expect(events[0]!.id).toBe(1);
      expect(events[1]!.id).toBe(2);
    });
  });

  describe('completed sessions', () => {
    it('records completed session when agent was in done state', () => {
      store.processEvent(makePayload('SessionStart', 'sess-1'));
      store.processEvent(makePayload('UserPromptSubmit', 'sess-1', { prompt: 'do work' }));
      store.processEvent(makePayload('Stop', 'sess-1')); // listening → idle
      store.processEvent(makePayload('TaskCompleted', 'sess-1')); // idle → done
      store.processEvent(makePayload('SessionEnd', 'sess-1'));
      const completed = store.getCompletedSessions();
      expect(completed.length).toBe(1);
      expect(completed[0]!.sessionId).toBe('sess-1');
    });

    it('does not record completed session if not in done state', () => {
      store.processEvent(makePayload('SessionStart', 'sess-1'));
      store.processEvent(makePayload('SessionEnd', 'sess-1'));
      expect(store.getCompletedSessions().length).toBe(0);
    });

    it('respects max completed sessions size', () => {
      const smallStore = new SessionStore(1000, 3);
      for (let i = 0; i < 5; i++) {
        const id = `sess-${i}`;
        smallStore.processEvent(makePayload('SessionStart', id));
        smallStore.processEvent(makePayload('Stop', id)); // → idle
        smallStore.processEvent(makePayload('TaskCompleted', id)); // idle → done
        smallStore.processEvent(makePayload('SessionEnd', id));
      }
      expect(smallStore.getCompletedSessions().length).toBe(3);
    });
  });

  describe('agent CRUD', () => {
    it('getAllAgents returns all tracked agents', () => {
      store.processEvent(makePayload('SessionStart', 'sess-1'));
      store.processEvent(makePayload('SessionStart', 'sess-2'));
      expect(store.getAllAgents().length).toBe(2);
    });

    it('getAgent returns undefined for unknown session', () => {
      expect(store.getAgent('nonexistent')).toBeUndefined();
    });

    it('removeAgent deletes the agent', () => {
      store.processEvent(makePayload('SessionStart', 'sess-1'));
      expect(store.removeAgent('sess-1')).toBe(true);
      expect(store.getAgent('sess-1')).toBeUndefined();
    });

    it('removeAgent returns false for unknown session', () => {
      expect(store.removeAgent('nonexistent')).toBe(false);
    });

    it('renameAgent sets displayName', () => {
      store.processEvent(makePayload('SessionStart', 'sess-1'));
      expect(store.renameAgent('sess-1', 'MyAgent')).toBe(true);
      expect(store.getAgent('sess-1')!.displayName).toBe('MyAgent');
    });

    it('renameAgent with null clears displayName', () => {
      store.processEvent(makePayload('SessionStart', 'sess-1'));
      store.renameAgent('sess-1', 'Named');
      store.renameAgent('sess-1', null);
      expect(store.getAgent('sess-1')!.displayName).toBeNull();
    });

    it('renameAgent returns false for unknown session', () => {
      expect(store.renameAgent('nonexistent', 'Name')).toBe(false);
    });
  });

  describe('totalEvents counter', () => {
    it('increments totalEvents on each processed event', () => {
      store.processEvent(makePayload('SessionStart', 'sess-1'));
      store.processEvent(makePayload('PreToolUse', 'sess-1', { tool_name: 'Write' }));
      store.processEvent(makePayload('PostToolUse', 'sess-1', { tool_name: 'Write' }));
      store.processEvent(makePayload('Stop', 'sess-1'));
      // SessionStart handler creates agent (totalEvents=0), then 3 more events
      expect(store.getAgent('sess-1')!.totalEvents).toBe(3);
    });
  });

  describe('transcript path', () => {
    it('captures transcript_path from first event that has it', () => {
      store.processEvent(makePayload('SessionStart', 'sess-1'));
      store.processEvent(makePayload('PreToolUse', 'sess-1', {
        tool_name: 'Write',
        transcript_path: '/tmp/transcript.jsonl',
      }));
      expect(store.getAgent('sess-1')!.transcriptPath).toBe('/tmp/transcript.jsonl');
    });
  });
});
