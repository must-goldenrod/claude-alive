/**
 * Fixtures use the shapes from `codex app-server generate-json-schema`
 * (codex-cli 0.144.6), not assumed ones — an earlier version of this mapper was
 * written against guessed shapes and was materially wrong.
 */

import { describe, expect, test } from 'vitest';
import { codexEventToCanonical, type CodexServerMessage } from '../codexToCanonical.js';

let n = 0;
const ctx = {
  sessionId: 'S_ALIVE',
  workspaceId: 'W1',
  receivedAt: 5_000,
  newEventId: () => `E${++n}`,
};

const msg = (method: string, params: Record<string, unknown> = {}): CodexServerMessage => ({ method, params });

/** `Turn` per the schema: id + status + items, error when it failed. */
const turn = (over: Record<string, unknown> = {}) => ({ id: 't_1', status: 'inProgress', items: [], ...over });

describe('thread lifecycle', () => {
  test('thread/started opens the session from the Thread object', () => {
    n = 0;
    const [e] = codexEventToCanonical(
      msg('thread/started', { thread: { id: 'th_1', cwd: '/repo/alpha', status: { type: 'active' } } }),
      ctx,
    );
    expect(e.kind).toBe('session.created');
    expect(e.provider).toBe('codex');
    expect(e.payload).toMatchObject({ cwd: '/repo/alpha', threadId: 'th_1' });
  });

  test('thread/status/changed reports agent state', () => {
    n = 0;
    const [e] = codexEventToCanonical(
      msg('thread/status/changed', { threadId: 'th_1', status: { type: 'idle' } }),
      ctx,
    );
    expect(e.kind).toBe('agent.state');
    expect(e.payload).toMatchObject({ common: 'ready', providerState: 'idle' });
  });

  test('an active thread is thinking', () => {
    n = 0;
    const [e] = codexEventToCanonical(msg('thread/status/changed', { status: { type: 'active' } }), ctx);
    expect(e.payload).toMatchObject({ common: 'thinking' });
  });

  test('a systemError thread is failed', () => {
    n = 0;
    const [e] = codexEventToCanonical(msg('thread/status/changed', { status: { type: 'systemError' } }), ctx);
    expect(e.payload).toMatchObject({ common: 'failed' });
  });
});

describe('turn lifecycle', () => {
  test('turn/started reads the run id from turn.id, not a turnId field', () => {
    n = 0;
    const [e] = codexEventToCanonical(msg('turn/started', { threadId: 'th_1', turn: turn() }), ctx);
    expect(e.kind).toBe('run.started');
    expect(e.runId).toBe('t_1');
  });

  test('a completed turn is a completion', () => {
    n = 0;
    const [e] = codexEventToCanonical(
      msg('turn/completed', { threadId: 'th_1', turn: turn({ status: 'completed' }) }),
      ctx,
    );
    expect(e.kind).toBe('run.completed');
    expect(e.runId).toBe('t_1');
  });

  test('a failed turn arrives on turn/completed and must not read as success', () => {
    // There is no `turn/failed` notification; failure is `turn.status`.
    n = 0;
    const [e] = codexEventToCanonical(
      msg('turn/completed', { turn: turn({ status: 'failed', error: { message: 'boom' } }) }),
      ctx,
    );
    expect(e.kind).toBe('run.failed');
    expect(e.payload).toMatchObject({ reason: 'boom' });
  });

  test('an interrupted turn is not a success either', () => {
    n = 0;
    const [e] = codexEventToCanonical(msg('turn/completed', { turn: turn({ status: 'interrupted' }) }), ctx);
    expect(e.kind).toBe('run.failed');
  });
});

describe('errors', () => {
  test('the error notification carries the turn and whether it will retry', () => {
    n = 0;
    const [e] = codexEventToCanonical(
      msg('error', { threadId: 'th', turnId: 't_1', willRetry: false, error: { message: 'rate limited' } }),
      ctx,
    );
    expect(e.kind).toBe('run.failed');
    expect(e.runId).toBe('t_1');
    expect(e.payload).toMatchObject({ reason: 'rate limited', willRetry: false });
  });

  test('a retryable error is recorded but not treated as a terminal failure', () => {
    n = 0;
    const [e] = codexEventToCanonical(msg('error', { turnId: 't', willRetry: true, error: { message: 'flaky' } }), ctx);
    expect(e.kind).toBe('agent.state');
    expect(e.payload).toMatchObject({ willRetry: true });
  });
});

describe('items', () => {
  test('item notifications carry turnId, which becomes the run id', () => {
    n = 0;
    const [e] = codexEventToCanonical(
      msg('item/started', {
        threadId: 'th',
        turnId: 't_1',
        startedAtMs: 1234,
        item: { id: 'i1', type: 'commandExecution', command: 'ls' },
      }),
      ctx,
    );
    expect(e.runId).toBe('t_1');
    expect(e.occurredAt).toBe(1234);
  });

  test('a user message item is dialogue from the user', () => {
    n = 0;
    const [e] = codexEventToCanonical(
      msg('item/completed', { item: { id: 'u1', type: 'userMessage', content: 'run the tests' } }),
      ctx,
    );
    expect(e.kind).toBe('message.user');
    expect(e.payload).toMatchObject({ text: 'run the tests' });
  });

  test('an agent message is the assistant reply', () => {
    n = 0;
    const [e] = codexEventToCanonical(
      msg('item/completed', { item: { id: 'i2', type: 'agentMessage', text: 'tests pass' } }),
      ctx,
    );
    expect(e.kind).toBe('message.assistant');
  });

  test('a command execution uses status, not just exitCode', () => {
    n = 0;
    const [e] = codexEventToCanonical(
      msg('item/completed', { item: { id: 'i3', type: 'commandExecution', status: 'failed', exitCode: 1 } }),
      ctx,
    );
    expect(e.kind).toBe('tool.failed');
    expect(e.sourceEventId).toBe('i3:failed');
  });

  test('a successful command completes', () => {
    n = 0;
    const [e] = codexEventToCanonical(
      msg('item/completed', { item: { id: 'i3', type: 'commandExecution', status: 'completed', exitCode: 0 } }),
      ctx,
    );
    expect(e.kind).toBe('tool.completed');
  });

  test('file changes and mcp tool calls are tool items too', () => {
    n = 0;
    expect(codexEventToCanonical(msg('item/started', { item: { id: 'f1', type: 'fileChange' } }), ctx)[0].kind).toBe('tool.started');
    expect(codexEventToCanonical(msg('item/started', { item: { id: 'm1', type: 'mcpToolCall' } }), ctx)[0].kind).toBe('tool.started');
  });

  test('every delta notification is skipped', () => {
    for (const method of [
      'item/agentMessage/delta',
      'item/reasoning/textDelta',
      'item/reasoning/summaryTextDelta',
      'item/commandExecution/outputDelta',
      'item/fileChange/outputDelta',
      'item/plan/delta',
    ]) {
      expect(codexEventToCanonical(msg(method, { delta: 'x' }), ctx)).toEqual([]);
    }
  });
});

describe('approvals', () => {
  test.each([
    'item/commandExecution/requestApproval',
    'item/fileChange/requestApproval',
    'item/permissions/requestApproval',
  ])('%s blocks on the user', (method) => {
    n = 0;
    const [e] = codexEventToCanonical(msg(method, { callId: 'ap1', command: 'rm -rf build' }), ctx);
    expect(e.kind).toBe('approval.requested');
    expect(e.payload).toMatchObject({ approvalId: 'ap1' });
  });
});

describe('token usage', () => {
  test('token usage is recorded as exact', () => {
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
    expect(codexEventToCanonical(msg('windows/worldWritableWarning', {}), ctx)).toEqual([]);
  });

  test('an unknown item type produces nothing', () => {
    expect(codexEventToCanonical(msg('item/completed', { item: { id: 'x', type: 'imageGeneration' } }), ctx)).toEqual([]);
  });

  test('a malformed payload never throws', () => {
    expect(() => codexEventToCanonical(msg('item/completed', {}), ctx)).not.toThrow();
    expect(() => codexEventToCanonical({ method: 'turn/completed' }, ctx)).not.toThrow();
  });
});
