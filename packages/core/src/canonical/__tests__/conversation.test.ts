import { describe, expect, test } from 'vitest';
import { buildConversation } from '../conversation.js';
import type { CanonicalEvent, CanonicalEventKind } from '../events.js';

let seq = 0;
function evt(kind: CanonicalEventKind, payload: Record<string, unknown> = {}, over: Partial<CanonicalEvent> = {}): CanonicalEvent {
  seq++;
  return {
    schemaVersion: 2,
    eventId: `E${seq}`,
    kind,
    provider: 'claude',
    source: 'hook',
    workspaceId: 'W1',
    sessionId: 'S1',
    occurredAt: 1000 + seq,
    receivedAt: 1000 + seq,
    confidence: 'exact',
    payload,
    ...over,
  };
}

describe('message items', () => {
  test('a user prompt becomes a user item', () => {
    seq = 0;
    const items = buildConversation([evt('message.user', { text: 'fix the bug' })]);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ kind: 'user', text: 'fix the bug' });
  });

  test('the assistant reply carried by run.completed becomes an assistant item', () => {
    // Claude hooks do not stream assistant text; the only assistant content is
    // `last_assistant_message` on Stop.
    seq = 0;
    const items = buildConversation([evt('run.completed', { lastAssistantMessage: 'done, fixed it' })]);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ kind: 'assistant', text: 'done, fixed it' });
  });

  test('a run that completed with no message produces no assistant item', () => {
    seq = 0;
    expect(buildConversation([evt('run.completed', {})])).toEqual([]);
  });
});

describe('tool call items', () => {
  test('a tool start becomes one running item', () => {
    seq = 0;
    const items = buildConversation([evt('tool.started', { toolName: 'Bash', toolUseId: 'tu1' })]);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ kind: 'tool-call', toolName: 'Bash', status: 'running' });
  });

  test('completion updates the same item instead of adding a second one', () => {
    seq = 0;
    const items = buildConversation([
      evt('tool.started', { toolName: 'Bash', toolUseId: 'tu1' }),
      evt('tool.completed', { toolName: 'Bash', toolUseId: 'tu1' }),
    ]);
    expect(items).toHaveLength(1);
    expect(items[0].status).toBe('completed');
  });

  test('failure marks the item failed and keeps the reason', () => {
    seq = 0;
    const items = buildConversation([
      evt('tool.started', { toolName: 'Bash', toolUseId: 'tu1' }),
      evt('tool.failed', { toolName: 'Bash', toolUseId: 'tu1', reason: 'exit 1' }),
    ]);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ status: 'failed', detail: 'exit 1' });
  });

  test('a completion with no preceding start still surfaces as an item', () => {
    // Never drop evidence: a gap in the log must be visible, not silently hidden.
    seq = 0;
    const items = buildConversation([evt('tool.completed', { toolName: 'Bash', toolUseId: 'orphan' })]);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ kind: 'tool-call', status: 'completed' });
  });
});

describe('approval items', () => {
  test('a request becomes a pending approval item', () => {
    seq = 0;
    const items = buildConversation([evt('approval.requested', { approvalId: 'a1', toolName: 'Bash' })]);
    expect(items[0]).toMatchObject({ kind: 'approval', status: 'running', toolName: 'Bash' });
  });

  test('a decision resolves the same item', () => {
    seq = 0;
    const items = buildConversation([
      evt('approval.requested', { approvalId: 'a1', toolName: 'Bash' }),
      evt('approval.decided', { approvalId: 'a1', decision: 'allow' }),
    ]);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ status: 'completed', decision: 'allow' });
  });
});

describe('what is not conversation', () => {
  test('agent.state is state noise, not dialogue', () => {
    seq = 0;
    expect(buildConversation([evt('agent.state', { common: 'thinking' })])).toEqual([]);
  });

  test('usage updates are not dialogue', () => {
    seq = 0;
    expect(buildConversation([evt('usage.updated', { totalTokens: 10 })])).toEqual([]);
  });

  test('session lifecycle appears as a system event', () => {
    seq = 0;
    const items = buildConversation([evt('session.created', { cwd: '/repo' })]);
    expect(items[0]).toMatchObject({ kind: 'system-event' });
  });
});

describe('ordering and provenance', () => {
  test('items follow log order', () => {
    seq = 0;
    const items = buildConversation([
      evt('message.user', { text: 'first' }),
      evt('tool.started', { toolName: 'Bash', toolUseId: 't' }),
      evt('run.completed', { lastAssistantMessage: 'last' }),
    ]);
    expect(items.map((i) => i.kind)).toEqual(['user', 'tool-call', 'assistant']);
  });

  test('each item carries the confidence of the event it came from', () => {
    seq = 0;
    const items = buildConversation([evt('message.user', { text: 'hi' }, { confidence: 'heuristic' })]);
    expect(items[0].confidence).toBe('heuristic');
  });

  test('an empty log yields an empty conversation', () => {
    expect(buildConversation([])).toEqual([]);
  });
});
