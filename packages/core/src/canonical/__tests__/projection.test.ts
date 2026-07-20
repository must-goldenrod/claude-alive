import { describe, expect, test } from 'vitest';
import { buildProjection, emptyProjection, applyCanonicalEvent } from '../projection.js';
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

describe('projection basics', () => {
  test('an empty projection has no sessions', () => {
    expect(Object.keys(emptyProjection().sessions)).toHaveLength(0);
  });

  test('session.created materialises a session row', () => {
    seq = 0;
    const s = buildProjection([evt('session.created', { cwd: '/repo/a' })]);
    expect(s.sessions.S1).toBeDefined();
    expect(s.sessions.S1.cwd).toBe('/repo/a');
    expect(s.sessions.S1.state).toBe('starting');
  });

  test('events for an unseen session auto-create it (sessions predate the server)', () => {
    seq = 0;
    const s = buildProjection([evt('message.user', { text: 'hi' })]);
    expect(s.sessions.S1).toBeDefined();
    expect(s.sessions.S1.lastPrompt).toBe('hi');
  });

  test('applyCanonicalEvent does not mutate the input state', () => {
    seq = 0;
    const before = buildProjection([evt('session.created', { cwd: '/repo/a' })]);
    const snapshot = JSON.stringify(before);
    applyCanonicalEvent(before, evt('message.user', { text: 'hi' }));
    expect(JSON.stringify(before)).toBe(snapshot);
  });
});

describe('state transitions', () => {
  test('a user message puts the session in thinking', () => {
    seq = 0;
    const s = buildProjection([evt('session.created'), evt('message.user', { text: 'go' })]);
    expect(s.sessions.S1.state).toBe('thinking');
  });

  test('a running tool puts the session in using-tool and records the tool', () => {
    seq = 0;
    const s = buildProjection([
      evt('session.created'),
      evt('tool.started', { toolName: 'Bash', toolUseId: 't1' }),
    ]);
    expect(s.sessions.S1.state).toBe('using-tool');
    expect(s.sessions.S1.currentTool).toBe('Bash');
  });

  test('tool completion clears the current tool and returns to thinking', () => {
    seq = 0;
    const s = buildProjection([
      evt('session.created'),
      evt('tool.started', { toolName: 'Bash', toolUseId: 't1' }),
      evt('tool.completed', { toolName: 'Bash', toolUseId: 't1' }),
    ]);
    expect(s.sessions.S1.state).toBe('thinking');
    expect(s.sessions.S1.currentTool).toBeUndefined();
  });

  test('an approval request blocks on the user and is counted', () => {
    seq = 0;
    const s = buildProjection([evt('session.created'), evt('approval.requested', { approvalId: 'a1' })]);
    expect(s.sessions.S1.state).toBe('waiting-user');
    expect(s.sessions.S1.pendingApprovals).toBe(1);
  });

  test('an approval decision releases the block', () => {
    seq = 0;
    const s = buildProjection([
      evt('session.created'),
      evt('approval.requested', { approvalId: 'a1' }),
      evt('approval.decided', { approvalId: 'a1', decision: 'allow' }),
    ]);
    expect(s.sessions.S1.pendingApprovals).toBe(0);
  });

  test('run completion and session end are terminal', () => {
    seq = 0;
    expect(buildProjection([evt('session.created'), evt('run.completed')]).sessions.S1.state).toBe('completed');
    seq = 0;
    expect(buildProjection([evt('session.created'), evt('session.ended')]).sessions.S1.state).toBe('stopped');
  });

  test('an explicit agent.state event wins and carries its confidence', () => {
    seq = 0;
    const s = buildProjection([
      evt('session.created'),
      evt('agent.state', { common: 'waiting-user', providerState: 'Notification' }, { confidence: 'heuristic' }),
    ]);
    expect(s.sessions.S1.state).toBe('waiting-user');
    expect(s.sessions.S1.stateConfidence).toBe('heuristic');
  });
});

describe('accumulated facts', () => {
  test('tracks unique tools used and total tool calls', () => {
    seq = 0;
    const s = buildProjection([
      evt('session.created'),
      evt('tool.started', { toolName: 'Bash', toolUseId: 't1' }),
      evt('tool.completed', { toolName: 'Bash', toolUseId: 't1' }),
      evt('tool.started', { toolName: 'Read', toolUseId: 't2' }),
      evt('tool.started', { toolName: 'Bash', toolUseId: 't3' }),
    ]);
    expect(s.sessions.S1.toolsUsed).toEqual(['Bash', 'Read']);
    expect(s.sessions.S1.toolCallCount).toBe(3);
  });

  test('captures the first prompt once and keeps it as later prompts arrive', () => {
    // §F.6 rule 7: the title is generated once; a follow-up prompt must not
    // silently rename the session.
    seq = 0;
    const s = buildProjection([
      evt('session.created'),
      evt('message.user', { text: 'refactor the auth module' }),
      evt('message.user', { text: 'now also fix the tests' }),
    ]);
    expect(s.sessions.S1.firstPrompt).toBe('refactor the auth module');
    expect(s.sessions.S1.lastPrompt).toBe('now also fix the tests');
  });

  test('records the transcript path when an event carries it', () => {
    seq = 0;
    const s = buildProjection([evt('session.created', { cwd: '/r', transcriptPath: '/t.jsonl' })]);
    expect(s.sessions.S1.transcriptPath).toBe('/t.jsonl');
  });

  test('subagents are tracked on their parent session, not as separate sessions', () => {
    seq = 0;
    const s = buildProjection([
      evt('session.created'),
      evt('agent.spawned', { agentType: 'Explore' }, { agentId: 'sub1' }),
    ]);
    expect(Object.keys(s.sessions)).toEqual(['S1']);
    expect(s.sessions.S1.subagentIds).toEqual(['sub1']);
  });

  test('advances lastEventAt and counts events', () => {
    seq = 0;
    const s = buildProjection([evt('session.created'), evt('message.user', { text: 'a' })]);
    expect(s.sessions.S1.totalEvents).toBe(2);
    expect(s.sessions.S1.lastEventAt).toBe(1002);
  });
});
