import { describe, expect, test } from 'vitest';
import { claudeHookToCanonical, type ClaudeHookContext } from '../claudeV1ToV2.js';
import type { HookEventName, HookEventPayload } from '../../events/types.js';

let counter = 0;
const ctx: ClaudeHookContext = {
  sessionId: 'S_ALIVE',
  workspaceId: 'W_ALIVE',
  receivedAt: 2_000,
  newEventId: () => `E${++counter}`,
};

function hook(event: HookEventName, data: Partial<HookEventPayload['data']> = {}): HookEventPayload {
  return {
    event,
    tool: data.tool_name ?? '',
    session_id: 'claude-sess-1',
    timestamp: 1_000,
    data: { session_id: 'claude-sess-1', hook_event_name: event, cwd: '/repo', ...data },
  };
}

describe('claudeHookToCanonical — envelope', () => {
  test('stamps the shared envelope fields on every produced event', () => {
    const [ev] = claudeHookToCanonical(hook('UserPromptSubmit', { prompt: 'do a thing' }), ctx);
    expect(ev.schemaVersion).toBe(2);
    expect(ev.provider).toBe('claude');
    expect(ev.source).toBe('hook');
    expect(ev.sessionId).toBe('S_ALIVE');
    expect(ev.workspaceId).toBe('W_ALIVE');
    expect(ev.occurredAt).toBe(1_000);
    expect(ev.receivedAt).toBe(2_000);
    expect(ev.eventId).toMatch(/^E\d+$/);
  });
});

describe('claudeHookToCanonical — kind mapping', () => {
  test('UserPromptSubmit → message.user with prompt text', () => {
    const [ev] = claudeHookToCanonical(hook('UserPromptSubmit', { prompt: 'hello world' }), ctx);
    expect(ev.kind).toBe('message.user');
    expect(ev.confidence).toBe('exact');
    expect(ev.payload).toMatchObject({ text: 'hello world' });
  });

  test('PreToolUse → tool.started, sourceEventId is phase-qualified', () => {
    const [ev] = claudeHookToCanonical(
      hook('PreToolUse', { tool_name: 'Bash', tool_use_id: 'tu_1', tool_input: { command: 'ls' } }),
      ctx,
    );
    expect(ev.kind).toBe('tool.started');
    expect(ev.sourceEventId).toBe('tu_1:started');
    expect(ev.payload).toMatchObject({ toolName: 'Bash' });
  });

  test('PostToolUse → tool.completed, phase-qualified sourceEventId', () => {
    const [ev] = claudeHookToCanonical(hook('PostToolUse', { tool_name: 'Read', tool_use_id: 'tu_2' }), ctx);
    expect(ev.kind).toBe('tool.completed');
    expect(ev.sourceEventId).toBe('tu_2:completed');
  });

  test('Pre and Post of the same tool_use_id get distinct dedupe keys', () => {
    const [pre] = claudeHookToCanonical(hook('PreToolUse', { tool_name: 'Bash', tool_use_id: 'tu_x' }), ctx);
    const [post] = claudeHookToCanonical(hook('PostToolUse', { tool_name: 'Bash', tool_use_id: 'tu_x' }), ctx);
    expect(pre.sourceEventId).not.toBe(post.sourceEventId);
  });

  test('a tool event without tool_use_id has no sourceEventId', () => {
    const [ev] = claudeHookToCanonical(hook('PreToolUse', { tool_name: 'Bash' }), ctx);
    expect(ev.sourceEventId).toBeUndefined();
  });

  test('PostToolUseFailure → tool.failed with reason', () => {
    const [ev] = claudeHookToCanonical(
      hook('PostToolUseFailure', { tool_name: 'Bash', reason: 'exit 1' }),
      ctx,
    );
    expect(ev.kind).toBe('tool.failed');
    expect(ev.payload).toMatchObject({ reason: 'exit 1' });
  });

  test('PermissionRequest → approval.requested', () => {
    const [ev] = claudeHookToCanonical(hook('PermissionRequest', { tool_name: 'Bash' }), ctx);
    expect(ev.kind).toBe('approval.requested');
  });

  test('SessionStart → session.created with cwd', () => {
    const [ev] = claudeHookToCanonical(hook('SessionStart', { cwd: '/repo', source: 'startup' }), ctx);
    expect(ev.kind).toBe('session.created');
    expect(ev.payload).toMatchObject({ cwd: '/repo' });
  });

  test('SessionEnd → session.ended', () => {
    const [ev] = claudeHookToCanonical(hook('SessionEnd', { reason: 'clear' }), ctx);
    expect(ev.kind).toBe('session.ended');
  });

  test('Stop → run.completed with last assistant message', () => {
    const [ev] = claudeHookToCanonical(hook('Stop', { last_assistant_message: 'done.' }), ctx);
    expect(ev.kind).toBe('run.completed');
    expect(ev.payload).toMatchObject({ lastAssistantMessage: 'done.' });
  });

  test('SubagentStart → agent.spawned carrying parent session', () => {
    const [ev] = claudeHookToCanonical(
      hook('SubagentStart', { agent_id: 'a_1', agent_type: 'Explore' }),
      ctx,
    );
    expect(ev.kind).toBe('agent.spawned');
    expect(ev.agentId).toBe('a_1');
    expect(ev.payload).toMatchObject({ agentType: 'Explore', parentSessionId: 'S_ALIVE' });
  });

  test('SubagentStop → agent.despawned', () => {
    const [ev] = claudeHookToCanonical(hook('SubagentStop', { agent_id: 'a_1' }), ctx);
    expect(ev.kind).toBe('agent.despawned');
    expect(ev.agentId).toBe('a_1');
  });

  test('Notification → agent.state waiting-user, marked heuristic, keeps message', () => {
    const [ev] = claudeHookToCanonical(hook('Notification', { message: 'waiting for input' }), ctx);
    expect(ev.kind).toBe('agent.state');
    expect(ev.confidence).toBe('heuristic');
    expect(ev.payload).toMatchObject({ common: 'waiting-user', message: 'waiting for input' });
  });

  test('ConfigChange preserves the hook-supplied reason instead of a hardcoded string', () => {
    const [ev] = claudeHookToCanonical(hook('ConfigChange', { reason: 'model switched to opus' }), ctx);
    expect(ev.kind).toBe('session.updated');
    expect(ev.payload).toMatchObject({ reason: 'model switched to opus' });
  });

  test('WorktreeCreate produces no canonical event (out of scope for CP2)', () => {
    expect(claudeHookToCanonical(hook('WorktreeCreate'), ctx)).toEqual([]);
  });
});

describe('claudeHookToCanonical — occurredAt', () => {
  test('falls back to receivedAt when the hook timestamp is missing or invalid', () => {
    const bad: HookEventPayload = { ...hook('Stop'), timestamp: 0 };
    const [ev] = claudeHookToCanonical(bad, ctx);
    expect(ev.occurredAt).toBe(ctx.receivedAt);
  });
});

describe('claudeHookToCanonical — coverage', () => {
  test('every hook event either maps or is explicitly ignored, never throws', () => {
    const events: HookEventName[] = [
      'SessionStart', 'SessionEnd', 'UserPromptSubmit', 'PreToolUse', 'PostToolUse',
      'PostToolUseFailure', 'PermissionRequest', 'Stop', 'Notification', 'SubagentStart',
      'SubagentStop', 'TeammateIdle', 'TaskCompleted', 'ConfigChange', 'PreCompact',
      'WorktreeCreate', 'WorktreeRemove',
    ];
    for (const e of events) {
      expect(() => claudeHookToCanonical(hook(e), ctx)).not.toThrow();
    }
  });
});
