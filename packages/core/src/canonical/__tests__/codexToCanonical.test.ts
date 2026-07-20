import { describe, expect, test } from 'vitest';
import { codexEventToCanonical, type CodexServerMessage } from '../codexToCanonical.js';

let n = 0;
const ctx = {
  sessionId: 'S_ALIVE',
  workspaceId: 'W1',
  receivedAt: 5_000,
  newEventId: () => `E${++n}`,
};

const msg = (method: string, params: Record<string, unknown> = {}): CodexServerMessage => ({
  method,
  params,
});

describe('thread and turn lifecycle', () => {
  test('thread/started opens the session', () => {
    n = 0;
    const [e] = codexEventToCanonical(msg('thread/started', { threadId: 'th_1', cwd: '/repo' }), ctx);
    expect(e.kind).toBe('session.created');
    expect(e.provider).toBe('codex');
    expect(e.source).toBe('structured');
    expect(e.payload).toMatchObject({ cwd: '/repo' });
  });

  test('turn/started begins a run and carries the turn id', () => {
    n = 0;
    const [e] = codexEventToCanonical(msg('turn/started', { turnId: 't_1' }), ctx);
    expect(e.kind).toBe('run.started');
    expect(e.runId).toBe('t_1');
  });

  test('turn/completed ends the run', () => {
    n = 0;
    const [e] = codexEventToCanonical(msg('turn/completed', { turnId: 't_1' }), ctx);
    expect(e.kind).toBe('run.completed');
    expect(e.runId).toBe('t_1');
  });

  test('turn/failed is a failure, not a completion', () => {
    n = 0;
    const [e] = codexEventToCanonical(msg('turn/failed', { turnId: 't_1', error: { message: 'boom' } }), ctx);
    expect(e.kind).toBe('run.failed');
    expect(e.payload).toMatchObject({ reason: 'boom' });
  });
});

describe('items', () => {
  test('a completed agent message becomes an assistant message', () => {
    n = 0;
    const [e] = codexEventToCanonical(
      msg('item/completed', { item: { id: 'i1', type: 'agentMessage', text: 'here you go' } }),
      ctx,
    );
    expect(e.kind).toBe('message.assistant');
    expect(e.payload).toMatchObject({ text: 'here you go' });
  });

  test('a completed reasoning item is reasoning, not an assistant reply', () => {
    n = 0;
    const [e] = codexEventToCanonical(
      msg('item/completed', { item: { id: 'i2', type: 'reasoning', text: 'thinking…' } }),
      ctx,
    );
    expect(e.kind).toBe('message.reasoning');
  });

  test('a started command execution is a tool start with a correlatable id', () => {
    n = 0;
    const [e] = codexEventToCanonical(
      msg('item/started', { item: { id: 'i3', type: 'commandExecution', command: 'ls -la' } }),
      ctx,
    );
    expect(e.kind).toBe('tool.started');
    expect(e.sourceEventId).toBe('i3:started');
    expect(e.payload).toMatchObject({ toolName: 'commandExecution', toolUseId: 'i3' });
  });

  test('a command that exited non-zero completes as a failure', () => {
    n = 0;
    const [e] = codexEventToCanonical(
      msg('item/completed', { item: { id: 'i3', type: 'commandExecution', exitCode: 1 } }),
      ctx,
    );
    expect(e.kind).toBe('tool.failed');
    expect(e.sourceEventId).toBe('i3:failed');
  });

  test('a command that exited zero completes normally', () => {
    n = 0;
    const [e] = codexEventToCanonical(
      msg('item/completed', { item: { id: 'i3', type: 'commandExecution', exitCode: 0 } }),
      ctx,
    );
    expect(e.kind).toBe('tool.completed');
  });

  test('a file change is a tool call too', () => {
    n = 0;
    const [e] = codexEventToCanonical(
      msg('item/started', { item: { id: 'i4', type: 'fileChange', path: '/repo/a.ts' } }),
      ctx,
    );
    expect(e.kind).toBe('tool.started');
    expect(e.payload).toMatchObject({ toolName: 'fileChange' });
  });

  test('streaming deltas are not stored as separate messages', () => {
    // Deltas are a rendering concern; persisting each one would flood the log.
    expect(codexEventToCanonical(msg('item/agentMessage/delta', { delta: 'par' }), ctx)).toEqual([]);
  });
});

describe('approvals', () => {
  test('a command approval request blocks on the user', () => {
    n = 0;
    const [e] = codexEventToCanonical(
      msg('item/commandExecution/requestApproval', { callId: 'ap1', command: 'rm -rf build' }),
      ctx,
    );
    expect(e.kind).toBe('approval.requested');
    expect(e.payload).toMatchObject({ approvalId: 'ap1' });
  });

  test('a file-change approval request is also an approval', () => {
    n = 0;
    const [e] = codexEventToCanonical(
      msg('item/fileChange/requestApproval', { callId: 'ap2', path: '/repo/a.ts' }),
      ctx,
    );
    expect(e.kind).toBe('approval.requested');
    expect(e.payload).toMatchObject({ approvalId: 'ap2' });
  });
});

describe('token usage', () => {
  test('token usage updates are recorded with live confidence', () => {
    n = 0;
    const [e] = codexEventToCanonical(
      msg('thread/tokenUsage/updated', { usage: { inputTokens: 100, outputTokens: 20 } }),
      ctx,
    );
    expect(e.kind).toBe('usage.updated');
    expect(e.confidence).toBe('exact');
    expect(e.payload).toMatchObject({ inputTokens: 100, outputTokens: 20 });
  });
});

describe('unknown shapes', () => {
  test('an unrecognised method produces nothing rather than a guess', () => {
    expect(codexEventToCanonical(msg('some/futureMethod', { x: 1 }), ctx)).toEqual([]);
  });

  test('an item with an unknown type produces nothing', () => {
    expect(
      codexEventToCanonical(msg('item/completed', { item: { id: 'i9', type: 'somethingNew' } }), ctx),
    ).toEqual([]);
  });

  test('a malformed payload never throws', () => {
    expect(() => codexEventToCanonical(msg('item/completed', {}), ctx)).not.toThrow();
    expect(() => codexEventToCanonical({ method: 'item/started' }, ctx)).not.toThrow();
  });
});

describe('envelope', () => {
  test('every event carries the canonical envelope with codex provenance', () => {
    n = 0;
    const [e] = codexEventToCanonical(msg('turn/started', { turnId: 't' }), ctx);
    expect(e.schemaVersion).toBe(2);
    expect(e.provider).toBe('codex');
    expect(e.source).toBe('structured');
    expect(e.sessionId).toBe('S_ALIVE');
    expect(e.workspaceId).toBe('W1');
    expect(e.receivedAt).toBe(5_000);
    expect(e.confidence).toBe('exact');
  });
});
